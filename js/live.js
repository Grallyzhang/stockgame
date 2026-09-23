// 实时模式引擎：虚拟账户 + A 股简化规则（T+1、±10% 涨跌停、费用同回放模式）、日结与复盘报告
// 纯逻辑模块：不依赖 DOM、不直接 fetch，行情与时间由调用方注入，可无头测试。
import { round2 } from './util.js';
import { commission, stampTax, LOT } from './replay.js';

export const LIVE_CASH = 100000;
export const MAX_WATCH = 5;
export const MIN_WATCH = 3;

// 解锁门槛：4 个核心历史剧本各完成至少一次（完成 = replay.history[剧本id] 有结算记录）
// 核心剧本 id 与 scenarios.js 前四个保持一致（bull 长牛 / fraud 暴雷 / cycle 周期 / volatile 题材）
export const CORE_SCENARIOS = ['bull', 'fraud', 'cycle', 'volatile'];
export function unlockProgress(st) {
  const h = st?.replay?.history || {};
  return CORE_SCENARIOS.filter(id => (h[id] || []).length > 0).length;
}
export function isUnlocked(st) {
  return unlockProgress(st) >= CORE_SCENARIOS.length;
}

// 预设股票池（主板蓝筹，±10% 涨跌幅；名称以服务端快照为准，这里仅作选择提示）
export const STOCK_POOL = [
  { code: '600519', hint: '贵州茅台 · 白酒' },
  { code: '601318', hint: '中国平安 · 保险' },
  { code: '600036', hint: '招商银行 · 银行' },
  { code: '601398', hint: '工商银行 · 银行' },
  { code: '600900', hint: '长江电力 · 电力' },
  { code: '601857', hint: '中国石油 · 石油' },
  { code: '600028', hint: '中国石化 · 石化' },
  { code: '600276', hint: '恒瑞医药 · 医药' },
  { code: '600887', hint: '伊利股份 · 食品' },
  { code: '600030', hint: '中信证券 · 券商' },
  { code: '601166', hint: '兴业银行 · 银行' },
  { code: '600585', hint: '海螺水泥 · 建材' },
  { code: '601888', hint: '中国中免 · 免税' },
  { code: '601012', hint: '隆基绿能 · 光伏' },
  { code: '000001', hint: '平安银行 · 银行' },
  { code: '000333', hint: '美的集团 · 家电' },
  { code: '000651', hint: '格力电器 · 家电' },
  { code: '000858', hint: '五粮液 · 白酒' },
  { code: '002594', hint: '比亚迪 · 汽车' },
  { code: '600031', hint: '三一重工 · 机械' },
];

export function newLive(today) {
  return {
    cash: LIVE_CASH,
    positions: {},            // code -> { shares, sellable, avgCost, name }
    trades: [],               // { date, time, code, name, side, qty, price, fee, realized?, pct }
    reports: [],              // 日结报告，见 settleDay
    watchlist: [],            // [{ code, name }]
    lastPx: {},               // code -> 最近已知价（快照或结算收盘）
    lastSettledDate: null,    // 已完成日结的最近交易日
    startDate: today,
    log: [{ date: today, type: 'info', text: `实时模拟开始：初始资金 ${LIVE_CASH.toLocaleString('zh-CN')} 元。真实行情快照，虚拟资金交易。` }],
  };
}

// 交易时段：09:30–11:30 / 13:00–15:00（交易日由调用方按日历校验）
export function inSession(now) {
  const m = now.getHours() * 60 + now.getMinutes();
  return (m >= 570 && m <= 690) || (m >= 780 && m <= 900);
}

export function limitUpOf(prevClose) { return round2(prevClose * 1.10); }
export function limitDownOf(prevClose) { return round2(prevClose * 0.90); }

function llog(lv, type, text) { lv.log.push({ date: lv.lastDate || lv.startDate, type, text }); }

function posOf(lv, code) {
  return lv.positions[code] || { shares: 0, sellable: 0, avgCost: 0 };
}

// ctx: { date, time, isTradeDay }
function preCheck(lv, q, lots, ctx) {
  if (!ctx.isTradeDay) return { ok: false, msg: '今天不是交易日，无法下单。可以查看行情与复盘。' };
  if (!ctx.inSession) return { ok: false, msg: '非交易时段（交易时间 09:30–11:30、13:00–15:00）。本模拟不收夜市委托。' };
  if (!lv.watchlist.some(w => w.code === q.code)) return { ok: false, msg: '该股票不在自选股中，先加入自选股。' };
  if (!Number.isInteger(lots) || lots <= 0) return { ok: false, msg: `数量至少为 1 手（${LOT} 股）` };
  if (q.price == null) return { ok: false, msg: '该股票当前无成交价（可能停牌或数据缺失），无法下单。' };
  if (q.stale) return { ok: false, msg: '行情数据可能已过期，为避免误成交，暂不可下单。' };
  return { ok: true };
}

export function buy(lv, q, lots, ctx) {
  const pre = preCheck(lv, q, lots, ctx);
  if (!pre.ok) return pre;
  const up = limitUpOf(q.prevClose);
  if (q.price >= up) {
    return { ok: false, msg: `已涨停（${q.price.toFixed(2)} 元，+10%）：涨停价买单排长队，本模拟中不可买入。` };
  }
  const qty = lots * LOT;
  const amount = round2(q.price * qty);
  const fee = commission(amount);
  const need = round2(amount + fee);
  if (need > lv.cash) return { ok: false, msg: `现金不足：约需 ${need.toFixed(2)} 元（含佣金 ${fee.toFixed(2)} 元），当前可用 ${lv.cash.toFixed(2)} 元` };

  lv.cash = round2(lv.cash - need);
  const p = posOf(lv, code(q));
  const newShares = p.shares + qty;
  p.avgCost = round2((p.avgCost * p.shares + need) / newShares);
  p.shares = newShares;   // sellable 不变：T+1，次日才可卖
  p.name = q.name;
  lv.positions[code(q)] = p;
  lv.lastPx[code(q)] = q.price;
  lv.trades.push({ date: ctx.date, time: ctx.time, code: code(q), name: q.name, side: 'buy', qty, price: q.price, fee, pct: (q.pct ?? 0) / 100 });
  llog(lv, 'fill', `买入 ${q.name} ${qty} 股 @ ${q.price.toFixed(2)} 元（佣金 ${fee.toFixed(2)} 元；T+1，明日才可卖出）`);
  return { ok: true };
}

export function sell(lv, q, lots, ctx) {
  const pre = preCheck(lv, q, lots, ctx);
  if (!pre.ok) return pre;
  const down = limitDownOf(q.prevClose);
  if (q.price <= down) {
    return { ok: false, msg: `已跌停（${q.price.toFixed(2)} 元，-10%）：跌停价几乎没有买盘，本模拟中不可卖出。` };
  }
  const qty = lots * LOT;
  const p = posOf(lv, code(q));
  if (qty > p.sellable) {
    return { ok: false, msg: `T+1 规则：当日买入的股票次日才能卖出。当前可卖 ${p.sellable} 股（共持有 ${p.shares} 股）。` };
  }
  const amount = round2(q.price * qty);
  const fee = round2(commission(amount) + stampTax(amount));
  lv.cash = round2(lv.cash + amount - fee);
  const realized = round2((q.price - p.avgCost) * qty - fee);
  p.shares -= qty;
  p.sellable -= qty;
  if (p.shares <= 0) { delete lv.positions[code(q)]; } else { lv.positions[code(q)] = p; }
  lv.lastPx[code(q)] = q.price;
  lv.trades.push({ date: ctx.date, time: ctx.time, code: code(q), name: q.name, side: 'sell', qty, price: q.price, fee, realized, pct: (q.pct ?? 0) / 100 });
  const pnlText = realized >= 0 ? `本次盈利 ${realized.toFixed(2)} 元` : `本次亏损 ${(-realized).toFixed(2)} 元`;
  llog(lv, 'fill', `卖出 ${q.name} ${qty} 股 @ ${q.price.toFixed(2)} 元（佣金+印花税 ${fee.toFixed(2)} 元，${pnlText}）`);
  return { ok: true };
}

function code(q) { return q.code; }

// 总资产：closeMap 缺价时用 lastPx，再退化到成本价
export function equityAt(lv, closeMap = {}) {
  let v = lv.cash;
  for (const [c, p] of Object.entries(lv.positions)) {
    const px = closeMap[c] ?? lv.lastPx[c] ?? p.avgCost;
    v += p.shares * px;
  }
  return round2(v);
}

// 日结：生成当日复盘报告；T+1 滚仓（次日全部可卖）
// closeMap: code -> 当日收盘价；absent: 是否为缺席补记
export function settleDay(lv, date, closeMap = {}, { absent = false } = {}) {
  if (lv.lastSettledDate && date <= lv.lastSettledDate) return null;

  // 重建「今日不操作」对照：由当前状态反推今日开盘前状态
  const todayTrades = lv.trades.filter(t => t.date === date);
  const cashStart = round2(lv.cash + todayTrades.reduce((s, t) =>
    s + (t.side === 'buy' ? round2(t.price * t.qty) + t.fee : -(round2(t.price * t.qty) - t.fee)), 0));
  const sharesStart = {};
  for (const [c, p] of Object.entries(lv.positions)) sharesStart[c] = p.shares;
  for (const t of todayTrades) {
    sharesStart[t.code] = (sharesStart[t.code] || 0) + (t.side === 'buy' ? -t.qty : t.qty);
  }
  let noTrade = cashStart;
  for (const [c, sh] of Object.entries(sharesStart)) {
    if (sh > 0) noTrade += sh * (closeMap[c] ?? lv.lastPx[c] ?? 0);
  }
  noTrade = round2(noTrade);

  const equity = equityAt(lv, closeMap);
  const prevReport = lv.reports[lv.reports.length - 1];
  const prevEquity = prevReport ? prevReport.equity : LIVE_CASH;

  const notes = [];
  const chases = todayTrades.filter(t => t.side === 'buy' && t.pct >= 0.03).length;
  const panics = todayTrades.filter(t => t.side === 'sell' && t.pct <= -0.03).length;
  if (chases) notes.push(`有 ${chases} 笔买入发生在当日涨幅 ≥3% 时（粗略的「追涨」信号，供参考）`);
  if (panics) notes.push(`有 ${panics} 笔卖出发生在当日跌幅 ≥3% 时（粗略的「杀跌」信号，供参考）`);
  const fees = round2(todayTrades.reduce((s, t) => s + t.fee, 0));
  if (fees > 0) notes.push(`今日交易费用合计 ${fees.toFixed(2)} 元——频繁交易的成本会悄悄累积`);
  if (!todayTrades.length && !absent) notes.push('今日没有操作：观望也是一种决策，关键是它是否有理由');
  if (!notes.length) notes.push('今日操作平稳。复盘的重点不是盈亏，而是「当时的理由是否兑现」');

  const report = {
    date, equity, prevEquity,
    dayRet: prevEquity ? (equity - prevEquity) / prevEquity : 0,
    totalRet: (equity - LIVE_CASH) / LIVE_CASH,
    noTrade, noTradeRet: prevEquity ? (noTrade - prevEquity) / prevEquity : 0,
    trades: todayTrades.length, fees, notes, absent,
  };
  lv.reports.push(report);

  // T+1 滚仓 + 记录最新价
  for (const [c, p] of Object.entries(lv.positions)) {
    p.sellable = p.shares;
    if (closeMap[c] != null) lv.lastPx[c] = closeMap[c];
  }
  lv.lastSettledDate = date;
  lv.lastDate = date;
  llog(lv, 'event', `${date} 日结：总资产 ${equity.toFixed(2)} 元（当日 ${(report.dayRet * 100).toFixed(2)}%）`);
  return report;
}

// 缺席补算：对 lastSettledDate 之后的每个已完成交易日依次日结
// tradeDates: 升序交易日列表；barsByCode: code -> 日线 bars（含 date/close）
export function catchUp(lv, tradeDates, barsByCode) {
  const from = lv.lastSettledDate || lv.startDate;
  const pending = tradeDates.filter(d => d > (lv.lastSettledDate || '0000-00-00') && d >= from);
  const made = [];
  for (const d of pending) {
    const hasTrades = lv.trades.some(t => t.date === d);
    const hasPos = Object.keys(lv.positions).length > 0;
    // 空仓、当日无操作且尚未有过任何报告：账户未启用，跳过不产生噪音报告
    if (!hasTrades && !hasPos && !lv.reports.length) { lv.lastSettledDate = d; continue; }
    const closeMap = {};
    for (const c of Object.keys(lv.positions)) {
      const bar = (barsByCode[c] || []).find(b => b.date === d);
      if (bar) closeMap[c] = bar.close;
    }
    const r = settleDay(lv, d, closeMap, { absent: !hasTrades });
    if (r) made.push(r);
  }
  return made;
}

// 自选股
export function addWatch(lv, code, name) {
  if (lv.watchlist.some(w => w.code === code)) return { ok: false, msg: '已在自选股中' };
  if (lv.watchlist.length >= MAX_WATCH) return { ok: false, msg: `自选股最多 ${MAX_WATCH} 只，先移除一只再添加` };
  lv.watchlist.push({ code, name });
  return { ok: true };
}

export function removeWatch(lv, code) {
  const p = lv.positions[code];
  if (p && p.shares > 0) return { ok: false, msg: '仍持有该股票，卖出后才能移出自选股' };
  lv.watchlist = lv.watchlist.filter(w => w.code !== code);
  return { ok: true };
}

// 自定义代码限制：主板（60/00 开头），回避 ±20% 的创业板/科创板与 ±5% 的 ST
export function validCustomCode(code) {
  return /^(60|00)\d{4}$/.test(code);
}
