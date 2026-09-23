// 技术指标纯函数：均线 / EMA / MACD / 金叉死叉检测（可无头测试）
import { round2 } from './util.js';

// 收盘 n 日简单移动平均 → 等长数组，前 n-1 个为 null
export function maSeries(bars, n) {
  const out = new Array(bars.length).fill(null);
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close;
    if (i >= n) sum -= bars[i - n].close;
    if (i >= n - 1) out[i] = round2(sum / n);
  }
  return out;
}

// 指数移动平均（EMA），首个有效值 = 第一根收盘价
export function emaSeries(bars, n) {
  const out = new Array(bars.length).fill(null);
  if (!bars.length) return out;
  const k = 2 / (n + 1);
  let prev = bars[0].close;
  out[0] = round2(prev);
  for (let i = 1; i < bars.length; i++) {
    prev = bars[i].close * k + prev * (1 - k);
    out[i] = round2(prev);
  }
  return out;
}

// MACD：dif = EMA12 − EMA26；dea = dif 的 EMA9；hist = (dif − dea) × 2
// dif/dea/hist 前 25 个为 null（EMA26 从第 26 根起才有意义）
export function macd(bars) {
  const len = bars.length;
  const dif = new Array(len).fill(null);
  const dea = new Array(len).fill(null);
  const hist = new Array(len).fill(null);
  if (len < 26) return { dif, dea, hist };
  const e12 = emaSeries(bars, 12);
  const e26 = emaSeries(bars, 26);
  const k9 = 2 / (9 + 1);
  let deaPrev = null;
  for (let i = 25; i < len; i++) {
    const d = round2(e12[i] - e26[i]);
    dif[i] = d;
    deaPrev = deaPrev === null ? d : round2(d * k9 + deaPrev * (1 - k9));
    dea[i] = deaPrev;
    hist[i] = round2((d - deaPrev) * 2);
  }
  return { dif, dea, hist };
}

// 第 i 根 short 上穿 long → 'gold'，下穿 → 'dead'，否则 null（含 null 段安全处理）
export function detectCross(short, long, i) {
  if (i < 1 || i >= short.length || i >= long.length) return null;
  const s0 = short[i - 1], s1 = short[i];
  const l0 = long[i - 1], l1 = long[i];
  if (s0 == null || s1 == null || l0 == null || l1 == null) return null;
  if (s0 <= l0 && s1 > l1) return 'gold';
  if (s0 >= l0 && s1 < l1) return 'dead';
  return null;
}
