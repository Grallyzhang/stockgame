// 工具函数：种子随机数（保证行情可复现）、数字格式化
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function round2(n) { return Math.round(n * 100) / 100; }

// 数字答题判定：答案在 ±tolPct 容差内即算对（教学不苛求精确小数）
export function numOk(v, ans, tolPct = 0.02) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  return Math.abs(v - ans) <= Math.abs(ans) * tolPct + 0.005;
}

export function fmtMoney(n) {
  return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtCap(n) {
  if (n >= 1e8) return (n / 1e8).toFixed(2) + ' 亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + ' 万';
  return fmtMoney(n);
}

export function fmtVolume(n) {
  if (n >= 1e8) return (n / 1e8).toFixed(2) + ' 亿股';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + ' 万股';
  return n + ' 股';
}

// 涨跌三重表达：▲/▼ 符号 + 数值 + 文字（不只靠颜色区分）
export function changeHTML(pct) {
  const p = (pct * 100).toFixed(2);
  if (pct > 0.00001) return `<span class="chg up">▲ +${p}% 上涨</span>`;
  if (pct < -0.00001) return `<span class="chg down">▼ ${p}% 下跌</span>`;
  return `<span class="chg flat">● ${p}% 持平</span>`;
}

export function pnlHTML(n) {
  if (n > 0.004) return `<span class="chg up">+${fmtMoney(n)}</span>`;
  if (n < -0.004) return `<span class="chg down">-${fmtMoney(-n)}</span>`;
  return `<span class="chg flat">${fmtMoney(n)}</span>`;
}
