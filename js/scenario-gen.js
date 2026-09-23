// 剧本行情生成器工具（独立模块，供 scenarios.js 与 scenarios2.js 共同使用，避免循环依赖）
import { mulberry32, round2 } from './util.js';

export const REPLAY_DAYS = 60;

// 分段随机游走；单日涨跌幅钳制在 seg.clamp（默认 ±9.95%）以内（明确的涨跌停日除外，由剧本单独生成）
export function segWalk(rng, start, segments) {
  const closes = [];
  let price = start;
  for (const seg of segments) {
    const lim = seg.clamp ?? 0.0995;
    for (let i = 0; i < seg.days; i++) {
      const raw = seg.drift + (rng() * 2 - 1) * seg.vol;
      const ch = Math.max(-lim, Math.min(lim, raw));
      price = round2(price * (1 + ch));
      closes.push(price);
    }
  }
  return closes;
}

// closes → OHLCV；halts: 停牌日集合（无成交、价格沿用最后收盘价）；flatDays: 一字板（开=高=低=收）
// overrides: { 天数: {open,high,low,close,volume} } 覆盖指定日的部分字段（用于天地板、跳空缺口等特殊 K 线）
export function closesToBars(closes, { basePrice, baseVol, rng, halts = new Set(), flatDays = new Set(), volSpike = new Set(), overrides = {} }) {
  const bars = [];
  let prev = basePrice;
  for (let d = 1; d <= closes.length; d++) {
    if (halts.has(d)) {
      bars.push({ day: d, suspended: true, open: prev, high: prev, low: prev, close: prev, volume: 0 });
      continue;
    }
    const close = closes[d - 1];
    let open, high, low;
    if (flatDays.has(d)) {
      open = high = low = close;
    } else {
      open = round2(prev * (1 + (rng() * 2 - 1) * 0.006));
      high = round2(Math.max(open, close) * (1 + rng() * 0.006));
      low = round2(Math.min(open, close) * (1 - rng() * 0.006));
    }
    const spike = volSpike.has(d) ? 2.6 : 1;
    const volume = Math.round(baseVol * (0.7 + rng() * 0.6) * spike);
    const bar = { day: d, open, high, low, close, volume };
    if (overrides[d]) Object.assign(bar, overrides[d]);
    bars.push(bar);
    prev = bar.close;
  }
  return bars;
}

// 连续涨跌停：从某收盘价出发，生成 count 个按 ±10% 涨停/跌停的收盘价
export function limitChain(lastClose, count, dir, round = round2) {
  const out = [];
  let p = lastClose;
  for (let i = 0; i < count; i++) { p = round(p * (1 + 0.10 * dir)); out.push(p); }
  return out;
}

export { mulberry32 };
