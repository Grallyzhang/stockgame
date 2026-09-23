// 回放引擎：A 股风格简化规则（T+1、±10% 涨跌停、停牌、真实费用结构、现金分红除息）
// 纯逻辑模块：不依赖 DOM，可无头测试。
import { round2 } from './util.js';
import { scenarioById } from './scenarios.js';

export const REPLAY_CASH = 100000;
export const LOT = 100;
export const COMMISSION_RATE = 0.00025;  // 佣金 0.025%
export const COMMISSION_MIN = 5;         // 最低 5 元
export const STAMP_RATE = 0.0005;        // 印花税 0.05%（仅卖出）

export const commission = amount => Math.max(COMMISSION_MIN, round2(amount * COMMISSION_RATE));
export const stampTax = amount => round2(amount * STAMP_RATE);

export function newRun(scenarioId) {
  const sc = scenarioById(scenarioId);
  const run = {
    scenarioId,
    day: 1,
    cash: REPLAY_CASH,
    pos: { shares: 0, sellable: 0, avgCost: 0 },  // T+1：当日买入不计入 sellable
    trades: [],
    readAnn: [],        // 已读公告的索引
    dividends: 0,       // 累计分红现金
    equity: [],         // 每日收盘后的总资产（交易后刷新）
    days: [],           // 每日收盘后的账户快照（供每日复盘回看）
    aiChat: [],         // AI 问答对话记录（仅当前剧本内有效）
    finished: false,
    log: [{ day: 1, type: 'info', text: `回放开始：${sc.name}，初始资金 ${REPLAY_CASH.toLocaleString('zh-CN')} 元。未来行情不可见，请逐日决策。` }],
  };
  snapshot(run, sc.buildBars(sc.seed), sc.basePrice); // 第 1 天初始快照（未交易状态）
  return run;
}

export const buildRunBars = run => scenarioById(run.scenarioId).buildBars(scenarioById(run.scenarioId).seed);

export function barAt(bars, day) { return bars[day - 1]; }

// 前收：最近一个非停牌日的收盘价；第 1 天取剧本基准价
export function prevClose(bars, day, basePrice) {
  for (let d = day - 1; d >= 1; d--) {
    const b = bars[d - 1];
    if (!b.suspended) return b.close;
  }
  return basePrice;
}

// 剧本涨跌幅限制：数字或函数（按天，如 ST 期 ±5%）；默认 ±10%
export function limitPctOf(sc, day) {
  const lp = sc.limitPct;
  if (typeof lp === 'function') return lp(day);
  return lp ?? 0.10;
}

// 涨跌停基准价（A 股规则：除权除息日以调整后的参考价为基准，名义缺口不算涨跌停）
export function refClose(bars, day, sc) {
  let ref = prevClose(bars, day, sc.basePrice);
  if (sc.split && sc.split.day === day) ref = ref / sc.split.ratio;
  if (sc.dividend && sc.dividend.day === day) ref = ref - sc.dividend.perShare;
  return ref;
}

export function limitUp(bars, day, sc) { return round2(refClose(bars, day, sc) * (1 + limitPctOf(sc, day))); }
export function limitDown(bars, day, sc) { return round2(refClose(bars, day, sc) * (1 - limitPctOf(sc, day))); }

export function dayPct(bars, day, basePrice) {
  const b = barAt(bars, day);
  if (b.suspended) return 0;
  const p = prevClose(bars, day, basePrice);
  return (b.close - p) / p;
}

export const isLimitUpDay = (bars, day, sc) => {
  const b = barAt(bars, day);
  return !b.suspended && b.close >= limitUp(bars, day, sc);
};
export const isLimitDownDay = (bars, day, sc) => {
  const b = barAt(bars, day);
  return !b.suspended && b.close <= limitDown(bars, day, sc);
};

function rlog(run, type, text) { run.log.push({ day: run.day, type, text }); }

// 当日收盘总资产（停牌日沿用最近收盘价）
export function equityAt(run, bars, basePrice, day = run.day) {
  let close = basePrice;
  for (let d = day; d >= 1; d--) {
    const b = bars[d - 1];
    if (!b.suspended) { close = b.close; break; }
  }
  return round2(run.cash + run.pos.shares * close);
}

function snapshot(run, bars, basePrice) {
  run.equity[run.day - 1] = equityAt(run, bars, basePrice);
  // 每日账户快照：供「每日复盘」回看历史某一天的持仓状态
  run.days[run.day - 1] = {
    day: run.day, cash: run.cash,
    shares: run.pos.shares, sellable: run.pos.sellable, avgCost: run.pos.avgCost,
    equity: run.equity[run.day - 1],
  };
}

// 买入（按当日收盘价成交）。返回 { ok, msg }
export function buy(run, bars, lots) {
  const sc = scenarioById(run.scenarioId);
  if (run.finished) return { ok: false, msg: '本次回放已结束' };
  if (!Number.isInteger(lots) || lots <= 0) return { ok: false, msg: `数量至少为 1 手（${LOT} 股）` };
  const bar = barAt(bars, run.day);
  if (bar.suspended) return { ok: false, msg: `第 ${run.day} 天停牌，无法交易。停牌期间只能等待复牌。` };
  const lp = Math.round(limitPctOf(sc, run.day) * 100);
  if (isLimitUpDay(bars, run.day, sc)) {
    return { ok: false, msg: `今日涨停（${bar.close.toFixed(2)} 元，+${lp}%）：涨停价上买单排长队、无人卖出，本模拟中涨停日不可买入。` };
  }
  const qty = lots * LOT;
  const amount = round2(bar.close * qty);
  const fee = commission(amount);
  const need = round2(amount + fee);
  if (need > run.cash) return { ok: false, msg: `现金不足：约需 ${need.toFixed(2)} 元（含佣金 ${fee.toFixed(2)} 元），当前可用 ${run.cash.toFixed(2)} 元` };

  run.cash = round2(run.cash - need);
  const p = run.pos;
  const newShares = p.shares + qty;
  p.avgCost = round2((p.avgCost * p.shares + need) / newShares);
  p.shares = newShares;   // sellable 不变：T+1，当日买入次日才可卖
  const pct = dayPct(bars, run.day, sc.basePrice);
  run.trades.push({ day: run.day, side: 'buy', qty, price: bar.close, fee, pct });
  rlog(run, 'fill', `买入 ${sc.name} ${qty} 股 @ ${bar.close.toFixed(2)} 元（佣金 ${fee.toFixed(2)} 元；T+1，明日才可卖出）`);
  snapshot(run, bars, sc.basePrice);
  return { ok: true };
}

// 卖出（按当日收盘价成交）
export function sell(run, bars, lots) {
  const sc = scenarioById(run.scenarioId);
  if (run.finished) return { ok: false, msg: '本次回放已结束' };
  if (!Number.isInteger(lots) || lots <= 0) return { ok: false, msg: `数量至少为 1 手（${LOT} 股）` };
  const bar = barAt(bars, run.day);
  if (bar.suspended) return { ok: false, msg: `第 ${run.day} 天停牌，无法交易。停牌期间只能等待复牌。` };
  const lp = Math.round(limitPctOf(sc, run.day) * 100);
  if (isLimitDownDay(bars, run.day, sc)) {
    return { ok: false, msg: `今日跌停（${bar.close.toFixed(2)} 元，-${lp}%）：跌停价上几乎没有买盘，卖单只能排队，本模拟中跌停日不可卖出。` };
  }
  const qty = lots * LOT;
  if (qty > run.pos.sellable) {
    return { ok: false, msg: `T+1 规则：当日买入的股票次日才能卖出。当前可卖 ${run.pos.sellable} 股（共持有 ${run.pos.shares} 股）。` };
  }
  const amount = round2(bar.close * qty);
  const fee = round2(commission(amount) + stampTax(amount));
  run.cash = round2(run.cash + amount - fee);
  const p = run.pos;
  const realized = round2((bar.close - p.avgCost) * qty - fee);
  p.shares -= qty;
  p.sellable -= qty;
  if (p.shares <= 0) { p.shares = 0; p.sellable = 0; p.avgCost = 0; }
  const pct = dayPct(bars, run.day, sc.basePrice);
  run.trades.push({ day: run.day, side: 'sell', qty, price: bar.close, fee, realized, pct });
  const pnlText = realized >= 0 ? `本次盈利 ${realized.toFixed(2)} 元` : `本次亏损 ${(-realized).toFixed(2)} 元`;
  rlog(run, 'fill', `卖出 ${sc.name} ${qty} 股 @ ${bar.close.toFixed(2)} 元（佣金+印花税 ${fee.toFixed(2)} 元，${pnlText}）`);
  snapshot(run, bars, sc.basePrice);
  return { ok: true };
}

// 推进一个交易日。返回 { anns: 今日盘后披露的事件, halted: 今日是否停牌, done: 是否已是最后一天之后 }
export function advance(run, bars) {
  const sc = scenarioById(run.scenarioId);
  if (run.day >= sc.days) return { done: true, anns: [], halted: false };
  run.day += 1;
  run.pos.sellable = run.pos.shares;  // T+1：昨日及以前买入的全部可卖

  // 除息：红利按持有股数划入现金（价格已在行情中下调）
  if (sc.dividend && run.day === sc.dividend.day && run.pos.shares > 0) {
    const credit = round2(run.pos.shares * sc.dividend.perShare);
    run.cash = round2(run.cash + credit);
    run.dividends = round2(run.dividends + credit);
    rlog(run, 'event', `除息：每股 ${sc.dividend.perShare.toFixed(2)} 元红利到账 ${credit.toFixed(2)} 元；股价相应下调，总资产基本不变——分红 ≠ 白赚。`);
  }

  // 除权（高送转）：股数 ×ratio、成本 ÷ratio，总市值不变
  if (sc.split && run.day === sc.split.day && run.pos.shares > 0) {
    const p = run.pos;
    const before = p.shares;
    p.shares *= sc.split.ratio;
    p.sellable *= sc.split.ratio;
    p.avgCost = round2(p.avgCost / sc.split.ratio);
    rlog(run, 'event', `除权（${sc.split.label}）：持股 ${before} → ${p.shares} 股，成本价相应下调为 ${p.avgCost.toFixed(2)} 元；股价减半，总资产不变——送转 ≠ 白赚。`);
  }

  const bar = barAt(bars, run.day);
  const anns = sc.events.filter(e => e.day === run.day);
  if (bar.suspended) rlog(run, 'event', `第 ${run.day} 天：停牌，无法交易。`);
  for (const e of anns) rlog(run, 'event', `${e.kind}披露：《${e.title}》`);
  snapshot(run, bars, sc.basePrice);
  return { done: false, anns, halted: !!bar.suspended };
}

// ---- 结算 ----
export function settle(run, bars) {
  const sc = scenarioById(run.scenarioId);
  run.finished = true;
  snapshot(run, bars, sc.basePrice);

  const curve = run.equity.filter(v => v != null);
  const finalEq = curve[curve.length - 1];
  const totalReturn = (finalEq - REPLAY_CASH) / REPLAY_CASH;

  // 最大回撤
  let peak = -Infinity, maxDD = 0;
  for (const v of curve) {
    peak = Math.max(peak, v);
    maxDD = Math.max(maxDD, (peak - v) / peak);
  }

  // 买入持有基准：第 1 天收盘全仓买入（整手），持有到底，含费用、分红与送转
  const c1 = barAt(bars, 1).close;
  let qty = Math.floor(REPLAY_CASH / (c1 * LOT)) * LOT;
  let bfee = commission(round2(c1 * qty));
  while (qty > 0 && round2(c1 * qty) + bfee > REPLAY_CASH) { qty -= LOT; bfee = commission(round2(c1 * qty)); }
  const leftover = round2(REPLAY_CASH - round2(c1 * qty) - bfee);
  const benchQty = d => (sc.split && d >= sc.split.day ? qty * sc.split.ratio : qty); // 除权日起股数翻倍
  const divCredit = sc.dividend ? round2(benchQty(sc.dividend.day) * sc.dividend.perShare) : 0;
  const lastClose = (() => { for (let d = sc.days; d >= 1; d--) { const b = bars[d - 1]; if (!b.suspended) return b.close; } return c1; })();
  const benchFinal = round2(benchQty(sc.days) * lastClose + leftover + divCredit);
  const benchReturn = (benchFinal - REPLAY_CASH) / REPLAY_CASH;
  const benchCurve = bars.map((b, i) => {
    const d = i + 1;
    const div = sc.dividend && d >= sc.dividend.day ? divCredit : 0;
    return round2(benchQty(d) * b.close + leftover + div);
  });

  // 过程指标（粗略统计，供参考）
  const buys = run.trades.filter(t => t.side === 'buy');
  const sells = run.trades.filter(t => t.side === 'sell');
  const chaseBuys = buys.filter(t => t.pct >= 0.03).length;
  const panicSells = sells.filter(t => t.pct <= -0.03).length;
  const holdingDays = run.trades.length ? sc.days - buys[0].day : 0;

  return {
    finalEq, totalReturn, maxDD, curve,
    benchReturn, benchCurve,
    trades: run.trades.length, buys: buys.length, sells: sells.length,
    chaseBuys, panicSells, holdingDays,
    annRead: run.readAnn.length, annTotal: sc.events.length,
    dividends: run.dividends,
  };
}
