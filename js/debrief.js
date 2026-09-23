// 每日复盘与专家复盘分析引擎：纯逻辑模块，不依赖 DOM，可无头测试
// 重要纪律：所有函数只使用 day 当天及以前的行情与公告，绝不引用未来数据（防剧透）
import { barAt, prevClose, dayPct, limitPctOf, isLimitUpDay, isLimitDownDay, REPLAY_CASH } from './replay.js';

// 截至 day 的 n 日均值（仅使用 ≤ day 的数据；停牌日收盘价沿用前收，可参与计算）
function maAt(bars, day, n) {
  const from = Math.max(1, day - n + 1);
  let sum = 0, cnt = 0;
  for (let d = from; d <= day; d++) { sum += bars[d - 1].close; cnt++; }
  return cnt ? sum / cnt : bars[day - 1].close;
}

// 近 5 个非停牌日的平均成交量（不含当天）
function avgVol5(bars, day) {
  let sum = 0, cnt = 0;
  for (let d = day - 1; d >= 1 && cnt < 5; d--) {
    const b = bars[d - 1];
    if (!b.suspended) { sum += b.volume; cnt++; }
  }
  return cnt ? sum / cnt : null;
}

// 连续同向天数（涨/跌/平），从 day 往前数
function streak(bars, day, basePrice) {
  let dir = 0, n = 0;
  for (let d = day; d >= 1; d--) {
    const b = bars[d - 1];
    if (b.suspended) break;
    const p = dayPct(bars, d, basePrice);
    const s = p > 0.001 ? 1 : p < -0.001 ? -1 : 0;
    if (n === 0) { dir = s; n = 1; continue; }
    if (s === dir && dir !== 0) n++;
    else break;
  }
  return { dir, n };
}

// ---------- 每日复盘：结构化数据（界面渲染用） ----------
export function dailyReview(sc, run, bars, day) {
  const bar = barAt(bars, day);
  const prev = prevClose(bars, day, sc.basePrice);
  const pct = dayPct(bars, day, sc.basePrice);
  const v5 = avgVol5(bars, day);
  const volRatio = !bar.suspended && v5 ? bar.volume / v5 : null;
  const range = bar.suspended ? 0 : (bar.high - bar.low) / prev;
  const sk = streak(bars, day, sc.basePrice);
  const snap = run.days?.[day - 1] || null;
  const prevEq = day > 1 ? run.days?.[day - 2]?.equity : REPLAY_CASH;
  const equityChg = snap && prevEq != null ? Math.round((snap.equity - prevEq) * 100) / 100 : null;
  return {
    day, bar, prev, pct,
    suspended: !!bar.suspended,
    limitUp: isLimitUpDay(bars, day, sc),
    limitDown: isLimitDownDay(bars, day, sc),
    limitPct: limitPctOf(sc, day),
    volRatio, range, streak: sk,
    ma5: maAt(bars, day, 5), ma20: maAt(bars, day, 20),
    tradesToday: run.trades.filter(t => t.day === day),
    anns: sc.events.filter(e => e.day === day),
    snap, equityChg,
    isDividendDay: sc.dividend?.day === day,
    isSplitDay: sc.split?.day === day,
  };
}

// ---------- 专家复盘分析：规则化生成 + 事件日手写解读 ----------
export function expertNote(sc, bars, day) {
  const notes = [];
  const bar = barAt(bars, day);
  const prev = prevClose(bars, day, sc.basePrice);
  const pct = dayPct(bars, day, sc.basePrice);

  // 第 1 天：给出本剧本的观察重点
  if (day === 1 && sc.expertFocus) {
    notes.push(`本剧本观察重点：${sc.expertFocus}。复盘不看单日盈亏，看决策与信息的匹配。`);
  }

  // 特殊交易日
  if (bar.suspended) {
    notes.push('停牌日：无成交、无报价。持仓被冻结，所有交易计划暂停执行——这正是流动性风险的具象化。');
    return appendEvents(sc, day, notes);
  }
  if (isLimitUpDay(bars, day, sc)) {
    const actual = `+${(pct * 100).toFixed(1)}%`;
    notes.push(pct > limitPctOf(sc, day) + 0.005
      ? `收于涨停价（当日 ${actual}）：单日涨幅超过常规 ${Math.round(limitPctOf(sc, day) * 100)}% 限制，属于特殊定价日（如新股首日）。这类价格由稀缺筹码决定，与基本面无关。`
      : `涨停收盘（${actual}）：买盘排队、卖盘稀缺。涨停板上「买不到」是价格发现被临时冻结的状态——注意区分「想买」与「能成交」。`);
    return appendEvents(sc, day, notes);
  }
  if (isLimitDownDay(bars, day, sc)) {
    notes.push(`跌停收盘（${(pct * 100).toFixed(1)}%）：卖盘排队、买盘稀缺。跌停板上「卖不出」——事前仓位是唯一的逃生通道。`);
    return appendEvents(sc, day, notes);
  }

  // 除权日：名义价格缺口是股本变化的会计结果，直接返回，不走基于名义涨跌幅的规则
  if (sc.split?.day === day) {
    notes.push(`除权日（${sc.split.label}）：股数翻倍、股价减半，总市值不变。除权后的「便宜」是数字幻觉，判断贵贱要看总市值与基本面。`);
    return appendEvents(sc, day, notes);
  }

  // 除息
  if (sc.dividend?.day === day) {
    notes.push(`除息日：每股红利 ${sc.dividend.perShare.toFixed(2)} 元到账，股价等额下调。K 线上的「缺口」不是亏损，是钱换了口袋——总资产不变。`);
  }

  // 跳空
  const gap = (bar.open - prev) / prev;
  if (gap >= 0.05) notes.push(`跳空高开 ${(gap * 100).toFixed(1)}%：隔夜消息被一次性定价。高开日追入，本质是为「一致预期」付溢价。`);
  else if (gap <= -0.05) notes.push(`跳空低开 ${(gap * 100).toFixed(1)}%：隔夜利空被一次性定价。恐慌低开日的卖出，常常卖在情绪的极值点。`);

  // 涨跌幅
  if (pct >= 0.05) notes.push(`大涨 ${(pct * 100).toFixed(1)}%：放量大涨是注意力最集中的时刻——也是最需要区分「基本面驱动」与「情绪驱动」的时刻。`);
  else if (pct <= -0.05) notes.push(`大跌 ${(pct * 100).toFixed(1)}%：先问「公司出问题了，还是市场出问题了」，再决定动作。两种下跌的性质与结局完全不同。`);

  // 成交量
  const v5 = avgVol5(bars, day);
  if (v5) {
    const vr = bar.volume / v5;
    if (vr >= 1.8) notes.push(`显著放量（约为近 5 日均量 ${vr.toFixed(1)} 倍）：巨量意味着分歧巨大——有大量买盘，就有等量的卖盘。关注放量之后价格的方向选择。`);
    else if (vr <= 0.55) notes.push(`明显缩量（约为近 5 日均量 ${vr.toFixed(1)} 倍）：缩量代表关注度退潮，价格信号的可信度下降。`);
  }

  // 均线位置（第 20 天起给出双线判断）
  if (day >= 20) {
    const ma5 = maAt(bars, day, 5), ma20 = maAt(bars, day, 20);
    if (bar.close > ma5 && ma5 > ma20) notes.push('均线多头排列（价 > 5 日线 > 20 日线）：短期趋势向上。趋势是你的朋友——直到它不是。');
    else if (bar.close < ma5 && ma5 < ma20) notes.push('均线空头排列（价 < 5 日线 < 20 日线）：短期趋势向下。下降趋势中的反弹，先假设它是反弹而非反转。');
    else notes.push('价格处于均线纠缠区：方向不明。这种时候「不操作」本身就是一种操作。');
  }

  // 连续同向
  const sk = streak(bars, day, sc.basePrice);
  if (sk.n >= 3 && sk.dir === 1) notes.push(`连续 ${sk.n} 日上涨：连涨会放大乐观情绪。回看买入理由是否还成立，比预测明天更重要。`);
  if (sk.n >= 3 && sk.dir === -1) notes.push(`连续 ${sk.n} 日下跌：连跌会放大恐慌情绪。检查基本面是否真的恶化，比盯着账户浮亏更有价值。`);

  // 上影线（冲高回落）
  const rng = bar.high - bar.low;
  if (!bar.suspended && rng / prev > 0.03 && (bar.high - Math.max(bar.open, bar.close)) / rng > 0.6) {
    notes.push('长上影线：盘中冲高后被打回，说明上方抛压沉重——追高者在当天就被套牢。');
  }

  // 无显著异动时的兜底
  if (!notes.length) notes.push('平淡交易日：没有显著的量价异动。多数交易日都是这样——投资的大部分时间是等待，而不是行动。');

  return appendEvents(sc, day, notes);
}

function appendEvents(sc, day, notes) {
  for (const e of sc.events.filter(e => e.day === day && e.expert)) {
    notes.push(`【${e.title}】${e.expert}`);
  }
  return notes;
}

// ---------- 结算页用：全程关键日复盘摘要（仅挑有信息量的日子） ----------
export function notableDays(sc, bars) {
  const out = [];
  for (let day = 1; day <= sc.days; day++) {
    const bar = bars[day - 1];
    const pct = dayPct(bars, day, sc.basePrice);
    const hasEvent = sc.events.some(e => e.day === day);
    const notable = hasEvent || bar.suspended || isLimitUpDay(bars, day, sc) || isLimitDownDay(bars, day, sc)
      || Math.abs(pct) >= 0.05 || sc.dividend?.day === day || sc.split?.day === day;
    if (notable) out.push({ day, notes: expertNote(sc, bars, day) });
  }
  return out;
}
