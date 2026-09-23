// 引擎：时间推进、价格读取、委托撮合、费用与账户
// 规则：模拟 A 股 · 简化版（T+1、±10% 涨跌停、佣金 0.1% 最低 1 元、现金分红除息）
import { LOT, FEE_RATE, FEE_MIN, TOTAL_DAYS, DIVIDEND, COMPANIES, companyById } from './data.js';
import { round2 } from './util.js';
import { log } from './state.js';

export const fee = amount => Math.max(FEE_MIN, round2(amount * FEE_RATE));

export function quote(market, id, day) {
  const arr = market[id];
  return arr[Math.min(Math.max(day, 1), arr.length) - 1];
}

export function prevClose(market, id, day) {
  if (day <= 1) return quote(market, id, 1).open;
  return quote(market, id, day - 1).close;
}

export function dayChangePct(market, id, day) {
  const p = prevClose(market, id, day);
  return (quote(market, id, day).close - p) / p;
}

// 截至 day（含）涨幅最大的一天（读图教学用，纯函数可无头测试）
export function bestGainDay(market, symbol, day) {
  const bars = market[symbol].slice(0, day);
  let best = 2, bestV = -Infinity;
  for (let d = 2; d <= day; d++) {
    const v = (bars[d - 1].close - bars[d - 2].close) / bars[d - 2].close;
    if (v > bestV) { bestV = v; best = d; }
  }
  return best;
}

// ---- 涨跌停（相对前收 ±10%，四舍五入到分） ----
export const limitUp = (market, id, day) => round2(prevClose(market, id, day) * 1.10);
export const limitDown = (market, id, day) => round2(prevClose(market, id, day) * 0.90);
export const isLimitUpDay = (market, id, day) => quote(market, id, day).close >= limitUp(market, id, day);
export const isLimitDownDay = (market, id, day) => quote(market, id, day).close <= limitDown(market, id, day);

// ---- 小镇综指：市值加权，第 1 天 = 1000 点；除息按真实指数口径修正（分红不拖累指数） ----
export function townIndex(market, day) {
  let cap = 0, base = 0;
  for (const co of COMPANIES) {
    let c = quote(market, co.id, day).close;
    if (co.id === DIVIDEND.symbol && day >= DIVIDEND.exDay) c += DIVIDEND.perShare;
    cap += c * co.shares;
    base += quote(market, co.id, 1).close * co.shares;
  }
  return Math.round(1000 * cap / base);
}
export function townIndexPct(market, day) {
  if (day <= 1) return 0;
  const a = townIndex(market, day), b = townIndex(market, day - 1);
  return (a - b) / b;
}

// 持仓市值（不含被卖出委托锁定的股数以外的全部持仓）
export function positionValue(st, market) {
  let v = 0;
  for (const [id, p] of Object.entries(st.positions)) {
    v += p.shares * quote(market, id, st.day).close;
  }
  return v;
}

export function frozenCash(st) {
  return st.orders.filter(o => o.status === 'pending' && o.side === 'buy')
    .reduce((s, o) => s + o.frozen, 0);
}

export function lockedShares(st, symbol) {
  return st.orders.filter(o => o.status === 'pending' && o.side === 'sell' && o.symbol === symbol)
    .reduce((s, o) => s + o.qty, 0);
}

export function totalAssets(st, market) {
  return round2(st.cash + frozenCash(st) + positionValue(st, market));
}

function settleBuy(st, order, price, day) {
  const amount = round2(order.qty * price);
  const f = fee(amount);
  const total = round2(amount + f);
  // 委托时已冻结 frozen；若实际花费低于冻结额（市价单按当前价成交），退回差额
  const refund = round2(order.frozen - total);
  if (refund > 0) st.cash = round2(st.cash + refund);
  const p = st.positions[order.symbol] || { shares: 0, avgCost: 0, sellable: 0 };
  const newShares = p.shares + order.qty;
  p.avgCost = round2((p.avgCost * p.shares + total) / newShares);
  p.shares = newShares;   // sellable 不变：T+1，当日买入次日才可卖
  st.positions[order.symbol] = p;
  order.status = 'filled'; order.fillPrice = price; order.fillDay = day;
  st.trades.push({ day, symbol: order.symbol, side: 'buy', qty: order.qty, price, fee: f });
  log(st, 'fill', `成交：买入 ${companyById(order.symbol).name} ${order.qty} 股 @ ${price.toFixed(2)} 元（佣金 ${f.toFixed(2)} 元；T+1，明日才可卖出）`);
}

function settleSell(st, order, price, day) {
  const amount = round2(order.qty * price);
  const f = fee(amount);
  st.cash = round2(st.cash + amount - f);
  const p = st.positions[order.symbol];
  const realized = round2((price - p.avgCost) * order.qty - f);
  p.shares -= order.qty;
  p.sellable = Math.max(0, (p.sellable || 0) - order.qty);
  if (p.shares <= 0) delete st.positions[order.symbol];
  order.status = 'filled'; order.fillPrice = price; order.fillDay = day;
  st.trades.push({ day, symbol: order.symbol, side: 'sell', qty: order.qty, price, fee: f, realized });
  const pnlText = realized >= 0 ? `本次盈利 ${realized.toFixed(2)} 元` : `本次亏损 ${(-realized).toFixed(2)} 元`;
  log(st, 'fill', `成交：卖出 ${companyById(order.symbol).name} ${order.qty} 股 @ ${price.toFixed(2)} 元（佣金 ${f.toFixed(2)} 元，${pnlText}）`);
}

// 限价单价格须在当日涨跌停范围内
function limitRangeCheck(market, symbol, day, price) {
  const up = limitUp(market, symbol, day), down = limitDown(market, symbol, day);
  if (price > up || price < down) {
    return { ok: false, code: 'LIMIT_RANGE', msg: `限价超出今日涨跌停范围：须在 ${down.toFixed(2)} ~ ${up.toFixed(2)} 元之间（前收 ±10%）。` };
  }
  return null;
}

// 下委托。返回 { ok, code?, msg?, order? }
export function placeOrder(st, market, { symbol, side, kind, price, lots }) {
  const co = companyById(symbol);
  const qty = lots * LOT;
  if (!Number.isInteger(lots) || lots <= 0) return { ok: false, code: 'QTY', msg: '数量至少为 1 手（100 股）' };
  const cur = quote(market, symbol, st.day).close;

  if (side === 'buy') {
    if (isLimitUpDay(market, symbol, st.day)) {
      return { ok: false, code: 'LIMIT_UP', msg: `今日涨停（${cur.toFixed(2)} 元，+10%）：涨停价上买单排长队、无人卖出，本模拟中涨停日不可买入。` };
    }
    const estPrice = kind === 'market' ? cur : price;
    if (!estPrice || estPrice <= 0) return { ok: false, code: 'PRICE', msg: '请输入有效的限价价格' };
    if (kind === 'limit') {
      const bad = limitRangeCheck(market, symbol, st.day, price);
      if (bad) return bad;
    }
    const need = round2(estPrice * qty + fee(estPrice * qty));
    if (need > st.cash) return { ok: false, code: 'CASH', msg: `现金不足：约需 ${need.toFixed(2)} 元，当前可用 ${st.cash.toFixed(2)} 元` };
    st.cash = round2(st.cash - need); // 冻结
    const order = {
      id: st.orderSeq++, day: st.day, symbol, side, kind,
      price: kind === 'limit' ? round2(price) : null,
      qty, status: 'pending', frozen: need,
    };
    st.orders.push(order);
    if (kind === 'market') {
      settleBuy(st, order, cur, st.day);
    } else {
      log(st, 'order', `委托：限价 ${price.toFixed(2)} 元买入 ${co.name} ${qty} 股，等待成交`);
    }
    return { ok: true, order };
  }

  // 卖出
  if (isLimitDownDay(market, symbol, st.day)) {
    return { ok: false, code: 'LIMIT_DOWN', msg: `今日跌停（${cur.toFixed(2)} 元，-10%）：跌停价上几乎没有买盘，本模拟中跌停日不可卖出。` };
  }
  const p = st.positions[symbol];
  const available = (p?.sellable || 0) - lockedShares(st, symbol);
  if (qty > available) {
    return { ok: false, code: 'T1', msg: `T+1 规则：当日买入的股票次日才能卖出。当前可卖 ${Math.max(0, available)} 股（共持有 ${p?.shares || 0} 股）。` };
  }
  if (kind === 'limit') {
    if (!price || price <= 0) return { ok: false, code: 'PRICE', msg: '请输入有效的限价价格' };
    const bad = limitRangeCheck(market, symbol, st.day, price);
    if (bad) return bad;
  }
  const order = {
    id: st.orderSeq++, day: st.day, symbol, side, kind,
    price: kind === 'limit' ? round2(price) : null,
    qty, status: 'pending', frozen: 0,
  };
  st.orders.push(order);
  if (kind === 'market') {
    settleSell(st, order, cur, st.day);
  } else {
    log(st, 'order', `委托：限价 ${price.toFixed(2)} 元卖出 ${co.name} ${qty} 股，等待成交`);
  }
  return { ok: true, order };
}

export function cancelOrder(st, orderId) {
  const o = st.orders.find(x => x.id === orderId);
  if (!o || o.status !== 'pending') return false;
  o.status = 'cancelled';
  if (o.side === 'buy') st.cash = round2(st.cash + o.frozen);
  log(st, 'order', `撤单：${o.side === 'buy' ? '买入' : '卖出'} ${companyById(o.symbol).name} ${o.qty} 股的委托已撤销`);
  return true;
}

// 推进一个交易日：T+1 解冻、除息入账、处理未成交限价单
export function advanceDay(st, market) {
  if (st.day >= TOTAL_DAYS) return false;
  st.day += 1;
  for (const p of Object.values(st.positions)) p.sellable = p.shares;   // T+1：昨日及以前买入的全部可卖

  // 除息：红利按持有股数划入现金（行情已在除息日下调 0.20 元）
  if (st.day === DIVIDEND.exDay) {
    const p = st.positions[DIVIDEND.symbol];
    if (p && p.shares > 0) {
      const credit = round2(p.shares * DIVIDEND.perShare);
      st.cash = round2(st.cash + credit);
      log(st, 'event', `除息：每股 ${DIVIDEND.perShare.toFixed(2)} 元红利到账 ${credit.toFixed(2)} 元；股价同步下调 0.20 元，总资产不变——分红 ≠ 白赚。`);
    }
  }

  for (const o of st.orders) {
    if (o.status !== 'pending' || o.kind !== 'limit') continue;
    const bar = quote(market, o.symbol, st.day);
    const up = limitUp(market, o.symbol, st.day), down = limitDown(market, o.symbol, st.day);
    if (o.side === 'buy' && o.price >= bar.low && o.price <= up) settleBuy(st, o, o.price, st.day);
    if (o.side === 'sell' && o.price <= bar.high && o.price >= down) settleSell(st, o, o.price, st.day);
  }
  return true;
}

export const hasPendingOrder = st => st.orders.some(o => o.status === 'pending');
export const hasPosition = st => Object.keys(st.positions).length > 0;
