// SVG 小镇场景：俯视、简洁造型、原创素材
// 经营事件只表现「经营现象」（排队、货物、货车），不直接映射股价涨跌。
import { COMPANIES } from './data.js';
import { quote, dayChangePct } from './market.js';

function priceTag(x, y, st, market, id) {
  const q = quote(market, id, st.day);
  const pct = dayChangePct(market, id, st.day);
  const arrow = pct > 0.00001 ? '▲' : pct < -0.00001 ? '▼' : '●';
  const color = pct > 0.00001 ? '#d0453e' : pct < -0.00001 ? '#2e9e5f' : '#8a8474';
  return `
    <g transform="translate(${x},${y})">
      <rect x="-58" y="-15" width="116" height="30" rx="15" fill="#fffdf7" stroke="#e4dcc8"/>
      <text text-anchor="middle" y="4" font-size="13" fill="#3a372f">${q.close.toFixed(2)} 元
        <tspan fill="${color}" font-weight="700"> ${arrow}</tspan>
      </text>
    </g>`;
}

function lab(st) {
  const lv2 = st.labLevel >= 2;
  return `
  <g class="bld-lab" transform="translate(120,360)">
    <ellipse cx="0" cy="58" rx="86" ry="14" fill="#e2d9c4"/>
    <rect x="-52" y="-6" width="104" height="62" rx="8" fill="#f2e7d3" stroke="#cbb98f" stroke-width="2"/>
    <polygon points="-60,-6 0,-38 60,-6" fill="#c9742c" stroke="#a85c20" stroke-width="2"/>
    ${lv2 ? `
      <rect x="-34" y="-52" width="68" height="34" rx="6" fill="#f7efe0" stroke="#cbb98f" stroke-width="2"/>
      <polygon points="-40,-52 0,-76 40,-52" fill="#d98f45" stroke="#a85c20" stroke-width="2"/>
      <line x1="0" y1="-76" x2="0" y2="-92" stroke="#8a8474" stroke-width="3"/>
      <circle class="glow" cx="0" cy="-96" r="6" fill="#e8b93e"/>` : ''}
    <rect x="-14" y="22" width="28" height="34" rx="4" fill="#8a6a3f"/>
    <rect x="-42" y="8" width="20" height="18" rx="3" fill="#bcd8ea"/>
    <rect x="22" y="8" width="20" height="18" rx="3" fill="#bcd8ea"/>
    <text text-anchor="middle" y="86" font-size="15" font-weight="700" fill="#3a372f">研究室 Lv.${st.labLevel}</text>
  </g>`;
}

function factory(st) {
  const rumor = st.day >= 51 && st.day < 54;
  const reported = st.day >= 54;
  return `
  <g class="bld" data-co="pinecone" transform="translate(140,120)">
    <ellipse cx="0" cy="66" rx="96" ry="14" fill="#e2d9c4"/>
    <rect class="bld-hl" x="-78" y="-40" width="156" height="112" rx="12" fill="#c9742c"/>
    <rect x="-64" y="-24" width="128" height="88" rx="8" fill="#f0dcc0" stroke="#c9862b" stroke-width="2"/>
    <polygon points="-64,-24 0,-58 64,-24" fill="#c9862b" stroke="#a86a1d" stroke-width="2"/>
    <rect x="34" y="-64" width="16" height="42" fill="#b59468" stroke="#8f744c" stroke-width="2"/>
    <circle class="smoke" cx="42" cy="-72" r="6" fill="#d8d2c4"/>
    <circle class="smoke" cx="46" cy="-82" r="4.5" fill="#e2ddd2" style="animation-delay:1s"/>
    <rect x="-48" y="8" width="26" height="22" rx="3" fill="#bcd8ea"/>
    <rect x="-8" y="8" width="26" height="22" rx="3" fill="#bcd8ea"/>
    <rect x="-16" y="38" width="32" height="26" rx="4" fill="#8a6a3f"/>
    ${rumor ? `
      <g class="bounce">
        <rect x="72" y="30" width="18" height="14" rx="2" fill="#d8a75c" stroke="#a87d33"/>
        <rect x="76" y="16" width="18" height="14" rx="2" fill="#d8a75c" stroke="#a87d33"/>
        <rect x="92" y="30" width="18" height="14" rx="2" fill="#d8a75c" stroke="#a87d33"/>
      </g>
      <circle cx="-76" cy="58" r="5" fill="#7a6a55"/><circle cx="-86" cy="52" r="5" fill="#9a8468"/>
      <circle cx="-66" cy="52" r="5" fill="#b09a7a"/>` : ''}
    ${reported ? `<text x="72" y="20" font-size="13" fill="#8a8474">利润下滑…</text>` : ''}
    <text text-anchor="middle" y="92" font-size="15" font-weight="700" fill="#3a372f">松果食品</text>
  </g>`;
}

function warehouse() {
  return `
  <g class="bld" data-co="beaver" transform="translate(640,120)">
    <ellipse cx="0" cy="66" rx="96" ry="14" fill="#e2d9c4"/>
    <rect class="bld-hl" x="-82" y="-36" width="164" height="108" rx="12" fill="#4a7fb5"/>
    <rect x="-70" y="-20" width="140" height="84" rx="8" fill="#d7e4f0" stroke="#4a7fb5" stroke-width="2"/>
    <polygon points="-70,-20 0,-52 70,-20" fill="#4a7fb5" stroke="#386a99" stroke-width="2"/>
    <rect x="-52" y="24" width="40" height="40" rx="3" fill="#9fbfdc" stroke="#4a7fb5"/>
    <line x1="-52" y1="37" x2="-12" y2="37" stroke="#4a7fb5"/><line x1="-52" y1="50" x2="-12" y2="50" stroke="#4a7fb5"/>
    <g class="truck">
      <rect x="16" y="38" width="34" height="18" rx="3" fill="#e8b93e" stroke="#bd9023"/>
      <rect x="50" y="44" width="14" height="12" rx="2" fill="#d98f45"/>
      <circle cx="26" cy="58" r="5" fill="#5a5348"/><circle cx="56" cy="58" r="5" fill="#5a5348"/>
    </g>
    <text text-anchor="middle" y="92" font-size="15" font-weight="700" fill="#3a372f">河狸物流</text>
  </g>`;
}

function tower() {
  return `
  <g class="bld" data-co="firefly" transform="translate(620,340)">
    <ellipse cx="0" cy="78" rx="80" ry="12" fill="#e2d9c4"/>
    <rect class="bld-hl" x="-58" y="-70" width="116" height="152" rx="12" fill="#7a5fc0"/>
    <rect x="-44" y="-58" width="88" height="136" rx="8" fill="#e4ddf5" stroke="#7a5fc0" stroke-width="2"/>
    <polygon points="-44,-58 0,-84 44,-58" fill="#7a5fc0" stroke="#5f489e" stroke-width="2"/>
    ${[-38, -10, 18, 46].map(y => `
      <rect class="glow" x="-28" y="${y}" width="16" height="14" rx="3" fill="#e8b93e" style="animation-delay:${(y + 60) / 40}s"/>
      <rect class="glow" x="12" y="${y}" width="16" height="14" rx="3" fill="#e8b93e" style="animation-delay:${(y + 20) / 30}s"/>`).join('')}
    <text text-anchor="middle" y="104" font-size="15" font-weight="700" fill="#3a372f">萤火科技</text>
  </g>`;
}

export function boardText(day) {
  if (day >= 56) return '关税上调 食品业承压';
  if (day >= 55) return '传闻：萤火 AI 灯具大卖？';
  if (day >= 54) return '松果食品发布财报';
  if (day >= 51) return '传闻：松果利润翻倍？';
  if (day >= 13) return '今日除息：松果每股 0.20 元';
  if (day >= 3) return '公告：松果 10 派 2 元';
  return '今日无事';
}

function board(st) {
  return `
  <g class="bld" data-board="1" transform="translate(390,250)">
    <rect x="-6" y="0" width="12" height="34" fill="#8a6a3f"/>
    <rect x="-52" y="-34" width="104" height="42" rx="6" fill="#fffdf7" stroke="#c9742c" stroke-width="2"/>
    <text text-anchor="middle" y="-18" font-size="12" font-weight="700" fill="#c9742c">公告栏</text>
    <text text-anchor="middle" y="-3" font-size="11" fill="#8a8474">${boardText(st.day)}</text>
  </g>`;
}

// 盘口显示屏（研究室旁，L5 解锁后可见，点击打开盘口面板）
function bookScreen(st) {
  if (!st.unlocked.book) return '';
  return `
  <g class="bld" data-book="1" transform="translate(262,362)">
    <ellipse cx="0" cy="26" rx="40" ry="8" fill="#e2d9c4"/>
    <rect x="-5" y="-4" width="10" height="30" fill="#8a6a3f"/>
    <rect class="bld-hl" x="-36" y="-44" width="72" height="48" rx="6" fill="#4a7fb5"/>
    <rect x="-32" y="-40" width="64" height="40" rx="5" fill="#fffdf7" stroke="#4a7fb5" stroke-width="2"/>
    <text text-anchor="middle" y="-27" font-size="10" fill="#2e9e5f">卖一 ▲</text>
    <text text-anchor="middle" y="-13" font-size="10" fill="#d0453e">买一 ▼</text>
    <text text-anchor="middle" y="18" font-size="12" font-weight="700" fill="#3a372f">盘口</text>
  </g>`;
}

export function renderTown(el, st, market, onBuilding, onBook, onBoard) {
  el.innerHTML = `
  <svg viewBox="0 0 800 520" role="img" aria-label="股市小镇俯视场景">
    <rect width="800" height="520" fill="#eef3e2"/>
    <rect x="0" y="470" width="800" height="50" fill="#dfe7cc"/>
    <path d="M0,290 Q200,260 400,290 T800,290" stroke="#d9cfae" stroke-width="26" fill="none" stroke-linecap="round"/>
    <path d="M390,240 Q400,360 390,470" stroke="#d9cfae" stroke-width="22" fill="none"/>
    <circle cx="110" cy="255" r="16" fill="#9dc183"/><circle cx="130" cy="262" r="11" fill="#8ab374"/>
    <circle cx="700" cy="230" r="14" fill="#9dc183"/>
    <circle cx="330" cy="420" r="12" fill="#9dc183"/><circle cx="350" cy="428" r="9" fill="#8ab374"/>
    <ellipse cx="230" cy="330" rx="46" ry="20" fill="#bcd8ea" opacity=".8"/>
    ${board(st)}
    ${factory(st)}
    ${warehouse()}
    ${tower()}
    ${lab(st)}
    ${bookScreen(st)}
    ${priceTag(140, 40, st, market, 'pinecone')}
    ${priceTag(640, 40, st, market, 'beaver')}
    ${priceTag(620, 240, st, market, 'firefly')}
    <text x="16" y="506" font-size="12" fill="#8a8474">第 ${st.day} 天 · 虚构教学市场，价格由脚本模拟，不代表真实行情</text>
  </svg>`;
  el.querySelectorAll('.bld[data-co]').forEach(g => {
    g.addEventListener('click', () => onBuilding(g.dataset.co));
  });
  el.querySelectorAll('.bld[data-book]').forEach(g => {
    g.addEventListener('click', () => onBook?.());
  });
  el.querySelectorAll('.bld[data-board]').forEach(g => {
    g.addEventListener('click', () => onBoard?.());
  });
}

export { COMPANIES };
