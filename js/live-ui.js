// 实时模式界面：行情看板（自选股卡片）、交易面板、持仓、每日复盘报告、数据披露
import * as ui from './ui.js';
import * as live from './live.js';
import * as state from './state.js';
import { commission, stampTax, LOT } from './replay.js';
import { fmtMoney, changeHTML, pnlHTML, round2 } from './util.js';

const API_BASE = 'http://127.0.0.1:8500';
const REFRESH_MS = 60000;

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const timeStr = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

async function api(path, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(API_BASE + path, { signal: ctrl.signal });
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 入口 ----------
export async function mount(st) {
  if (!st.live) { st.live = live.newLive(todayStr()); state.save(st); }

  const ctx = {
    st, lv: st.live,
    lui: { tab: 'trade', code: st.live.watchlist[0]?.code || null, side: 'buy', lots: 1 },
    quotes: {}, quoteMeta: null, calInfo: null, histories: {},
    serverDown: false,
    dispatch: (t, p) => lDispatch(ctx, t, p),
  };
  window.__live = ctx; // 调试/自动化测试钩子

  wireTopbar(ctx);
  renderLoading(ctx);
  await boot(ctx);
}

async function boot(ctx) {
  try {
    const h = await api('/api/health', 5000);
    if (!h.ok) throw new Error(h.error?.msg || '服务异常');
  } catch {
    ctx.serverDown = true;
    renderServerDown(ctx);
    return;
  }
  ctx.serverDown = false;
  try {
    const cal = await api('/api/calendar');
    if (cal.ok) ctx.calInfo = cal.data;
  } catch { ctx.calInfo = null; }

  // 缺席补算：为持仓股票拉历史，补齐错过的交易日日结
  await catchUpMissed(ctx);

  await refreshQuotes(ctx);
  renderAll(ctx);

  if (ctx._timer) clearInterval(ctx._timer);
  ctx._timer = setInterval(async () => {
    await refreshQuotes(ctx);
    if (!ui.isModalOpen()) renderAll(ctx);   // 弹窗打开时只更新数据，不打断阅读
  }, REFRESH_MS);

  if (!ctx.lv.welcomed) {
    ctx.lv.welcomed = true;
    state.save(ctx.st);
    welcomeModal(ctx);
  }
}

// ---------- 数据获取 ----------
async function refreshQuotes(ctx) {
  const codes = ctx.lv.watchlist.map(w => w.code);
  if (!codes.length) return;
  try {
    const r = await api(`/api/quotes?codes=${codes.join(',')}`);
    if (!r.ok) { ui.toast(r.error?.msg || '行情获取失败，稍后自动重试'); return; }
    for (const [code, q] of Object.entries(r.data.quotes)) {
      ctx.quotes[code] = { ...q, stale: !!r.meta.stale };
      if (q.price != null) ctx.lv.lastPx[code] = q.price;
    }
    ctx.quoteMeta = r.meta;
    ctx.quoteError = null;
    ensureHistories(ctx);
  } catch {
    ctx.quoteError = '行情服务连接失败';
  }
}

// 每只自选股懒加载 30 日前复权日线（仅用于卡片迷你走势图；交易与资产用名义价）
function ensureHistories(ctx) {
  for (const w of ctx.lv.watchlist) {
    if (ctx.histories[w.code]) continue;
    ctx.histories[w.code] = [];   // 占位防重复请求
    api(`/api/history?code=${w.code}&days=30&adjust=qfq`).then(r => {
      if (r.ok) ctx.histories[w.code] = r.data.bars;
      else delete ctx.histories[w.code];   // 失败不留占位，下个刷新周期重试
      if (!ui.isModalOpen()) renderAll(ctx);
    }).catch(() => { delete ctx.histories[w.code]; });
  }
}

function sparklineSVG(bars) {
  if (!bars || bars.length < 2) return '';
  const closes = bars.map(b => b.close);
  const W = 160, H = 34, pad = 2;
  const lo = Math.min(...closes), hi = Math.max(...closes);
  const x = i => pad + i * (W - pad * 2) / (closes.length - 1);
  const y = v => pad + (hi - v) / ((hi - lo) || 1) * (H - pad * 2);
  const pts = closes.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const up = closes[closes.length - 1] >= closes[0];
  const color = up ? '#d0453e' : '#2e9e5f';
  return `<svg viewBox="0 0 ${W} ${H}" class="lv-spark"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6"/></svg>`;
}

async function catchUpMissed(ctx) {
  const cal = ctx.calInfo;
  if (!cal) return;
  const now = new Date();
  const todayDone = cal.isTradeDay && (now.getHours() > 15 || (now.getHours() === 15 && now.getMinutes() >= 5));
  const completed = (cal.recent || []).filter(d => d < cal.today || (d === cal.today && todayDone));
  const pending = completed.filter(d => d > (ctx.lv.lastSettledDate || '0000-00-00'));
  if (!pending.length) return;
  const held = Object.keys(ctx.lv.positions);
  const barsByCode = {};
  for (const code of held) {
    try {
      const r = await api(`/api/history?code=${code}&days=30`);
      if (r.ok) barsByCode[code] = r.data.bars;
    } catch { /* 缺数据时用 lastPx 兜底 */ }
  }
  const made = live.catchUp(ctx.lv, completed, barsByCode);
  if (made.length) {
    state.save(ctx.st);
    ui.toast(`已补齐 ${made.length} 个交易日的日结（缺席期间按收盘价结算）`);
  }
}

// ---------- 顶栏 ----------
function wireTopbar(ctx) {
  document.querySelector('.brand .tag').textContent = '实时模拟 · 真实行情（快照延迟）';
  document.getElementById('btn-auto').style.display = 'none';
  document.getElementById('btn-review').style.display = 'none';
  document.getElementById('btn-reset').style.display = 'none';
  const next = document.getElementById('btn-next');
  next.textContent = '生成今日复盘';
  next.addEventListener('click', () => ctx.dispatch('l-settle'));
  document.getElementById('btn-mode').addEventListener('click', () => ctx.dispatch('l-exit'));
  document.getElementById('timeline-toggle').addEventListener('click', () =>
    document.getElementById('timeline-wrap').classList.toggle('open'));
}

function posValue(ctx) {
  let v = 0;
  for (const [code, p] of Object.entries(ctx.lv.positions)) {
    v += p.shares * (ctx.quotes[code]?.price ?? ctx.lv.lastPx[code] ?? p.avgCost);
  }
  return round2(v);
}

function renderStats(ctx) {
  const lv = ctx.lv;
  const pv = posValue(ctx);
  const total = round2(lv.cash + pv);
  const ret = (total - live.LIVE_CASH) / live.LIVE_CASH;
  const dataTime = Object.values(ctx.quotes).map(q => q.dataTime).filter(Boolean).sort().pop();
  document.getElementById('stats').innerHTML = `
    <span class="stat"><span class="lbl">现金</span><b>${fmtMoney(lv.cash)}</b></span>
    <span class="stat"><span class="lbl">持仓市值</span><b>${fmtMoney(pv)}</b></span>
    <span class="stat"><span class="lbl">总资产</span><b>${fmtMoney(total)}</b></span>
    <span class="stat"><span class="lbl">总收益率</span><b>${changeHTML(ret)}</b></span>
    ${dataTime ? `<span class="stat"><span class="lbl">行情时间</span><b>${dataTime.split(' ')[1] || dataTime}</b></span>` : ''}`;
  document.getElementById('btn-next').disabled = !canSettle(ctx).ok;
}

// ---------- 交易时段与状态 ----------
function sessionState(ctx) {
  const cal = ctx.calInfo;
  if (!cal) return { key: 'unknown', label: '交易日历不可用', canTrade: false };
  if (!cal.isTradeDay) return { key: 'closed', label: `今日非交易日（最近交易日 ${cal.lastTradeDate}）`, canTrade: false };
  const now = new Date();
  const m = now.getHours() * 60 + now.getMinutes();
  if (m < 570) return { key: 'pre', label: '今日为交易日 · 尚未开盘（09:30 开盘）', canTrade: false };
  if (m <= 690) return { key: 'open', label: '交易中 · 上午时段', canTrade: true };
  if (m < 780) return { key: 'noon', label: '午间休市（13:00 恢复交易）', canTrade: false };
  if (m <= 900) return { key: 'open', label: '交易中 · 下午时段', canTrade: true };
  return { key: 'after', label: '已收盘 · 可生成今日复盘', canTrade: false };
}

function canSettle(ctx) {
  const cal = ctx.calInfo;
  if (!cal || !cal.isTradeDay) return { ok: false, reason: '今日非交易日' };
  const now = new Date();
  if (now.getHours() < 15) return { ok: false, reason: '收盘后（15:00）可生成' };
  if (ctx.lv.lastSettledDate >= cal.today) return { ok: false, reason: '今日已复盘' };
  if (!Object.keys(ctx.lv.positions).length && !ctx.lv.trades.some(t => t.date === cal.today) && !ctx.lv.reports.length)
    return { ok: false, reason: '尚未开始交易' };
  return { ok: true };
}

// ---------- 左侧：行情看板 ----------
function renderScene(ctx) {
  const lv = ctx.lv;
  const ss = sessionState(ctx);
  const meta = ctx.quoteMeta;
  const disclosure = `数据源：AKShare（公开行情封装，仅供学习研究，不构成投资建议）· 快照约 60 秒刷新` +
    (meta?.fetchedAt ? ` · 服务端取数 ${meta.fetchedAt.split('T')[1]}` : '') +
    (meta?.stale ? ' · <b>数据可能已过期</b>' : '');

  let cards;
  if (!lv.watchlist.length) {
    cards = `<div class="lv-empty">还没有自选股。<br>点击「管理自选股」添加 3–5 只你感兴趣的股票开始观察。</div>`;
  } else {
    cards = '<div class="lv-grid">' + lv.watchlist.map(w => cardHTML(ctx, w)).join('') + '</div>';
  }
  document.getElementById('town').innerHTML = `
    <div class="rp-wrap">
      <div class="lv-status ${ss.key}">${ss.label}</div>
      ${cards}
      <div class="rp-note">${disclosure}<br>行情为快照数据，可能有 1—5 分钟以上延迟；模拟成交按快照价近似，不代表真实市场的排队成交。交易与资产用未复权名义价，K 线图为前复权。</div>
    </div>`;
  document.querySelectorAll('.lv-card').forEach(n =>
    n.addEventListener('click', () => ctx.dispatch('l-select', { code: n.dataset.code })));
}

function cardHTML(ctx, w) {
  const q = ctx.quotes[w.code];
  const pos = ctx.lv.positions[w.code];
  if (ctx.quoteError && !q) {
    return `<div class="lv-card" data-code="${w.code}"><div class="lv-name">${w.name}</div><div class="lv-fail">行情获取失败，稍后自动重试</div></div>`;
  }
  if (!q) {
    return `<div class="lv-card" data-code="${w.code}"><div class="lv-name">${w.name}</div><div class="lv-fail">加载中……</div></div>`;
  }
  const badge = q.stale ? '<span class="lv-badge">数据可能过期</span>' : '';
  if (q.price == null) {
    return `<div class="lv-card" data-code="${w.code}">
      <div class="lv-name">${q.name || w.name} <span class="lv-code">${w.code}</span>${badge}</div>
      <div class="lv-fail">今日无成交（可能停牌），不可交易</div>
      ${pos ? `<div class="lv-pos">持有 ${pos.shares} 股</div>` : ''}</div>`;
  }
  const up = live.limitUpOf(q.prevClose), down = live.limitDownOf(q.prevClose);
  const tag = q.price >= up ? '<span class="chg up">涨停</span>' : q.price <= down ? '<span class="chg down">跌停</span>' : '';
  return `<div class="lv-card ${ctx.lui.code === w.code ? 'active' : ''}" data-code="${w.code}">
    <div class="lv-name">${q.name || w.name} <span class="lv-code">${w.code}</span>${badge}</div>
    <div class="lv-price">${q.price.toFixed(2)} ${changeHTML((q.pct ?? 0) / 100)} ${tag}</div>
    ${sparklineSVG(ctx.histories[w.code])}
    <div class="lv-sub">量 ${fmtVol(q.volume)} · ${q.dataTime ? '数据 ' + q.dataTime.split(' ')[1] : ''}</div>
    ${pos ? `<div class="lv-pos">持有 ${pos.shares} 股（可卖 ${pos.sellable}）</div>` : ''}
  </div>`;
}

const fmtVol = v => v == null ? '—' : v >= 1e8 ? (v / 1e8).toFixed(2) + ' 亿' : v >= 1e4 ? (v / 1e4).toFixed(1) + ' 万' : String(v);

// ---------- 任务卡 ----------
function renderTask(ctx) {
  const stle = canSettle(ctx);
  ui.renderTaskCard(ctx, {
    title: '实时模拟 · 真实行情，虚拟资金',
    hint: '跟随真实市场节奏：盘中观察快照行情并模拟买卖，收盘后生成当日复盘。评价不看单次盈亏，看你能否说清每笔操作的理由。',
    buttons: [
      { label: `管理自选股（${ctx.lv.watchlist.length}/${live.MAX_WATCH}）`, onClick: () => ctx.dispatch('l-watch') },
      { label: stle.ok ? '生成今日复盘' : `今日复盘（${stle.reason}）`, primary: stle.ok, onClick: () => ctx.dispatch('l-settle') },
    ],
  });
}

// ---------- 右侧 Tab ----------
const LTABS = [
  { id: 'trade', name: '交易' },
  { id: 'pos', name: '持仓' },
  { id: 'report', name: '复盘' },
  { id: 'info', name: '说明' },
];

function renderTabs(ctx) {
  document.getElementById('tabs').innerHTML = LTABS.map(t =>
    `<button class="tab ${ctx.lui.tab === t.id ? 'active' : ''}" data-tab="${t.id}">${t.name}${t.id === 'report' && ctx.lv.reports.length ? ` ·${ctx.lv.reports.length}` : ''}</button>`
  ).join('');
  document.querySelectorAll('#tabs .tab').forEach(b =>
    b.addEventListener('click', () => { ctx.lui.tab = b.dataset.tab; renderAll(ctx); }));
}

// ---------- 面板 ----------
function renderPanel(ctx) {
  const el = document.getElementById('panel');
  const tab = ctx.lui.tab;
  if (tab === 'trade') el.innerHTML = tradeHTML(ctx);
  else if (tab === 'pos') el.innerHTML = posHTML(ctx);
  else if (tab === 'report') el.innerHTML = reportsHTML(ctx);
  else el.innerHTML = infoHTML(ctx);
  bindPanel(ctx, el, tab);
}

function tradeHTML(ctx) {
  const { lv, lui } = ctx;
  if (!lv.watchlist.length) return '<div class="empty" style="padding:30px 10px;text-align:center">先添加自选股（3–5 只），再开始模拟交易。</div>';
  const q = ctx.quotes[lui.code];
  const w = lv.watchlist.find(x => x.code === lui.code);
  const chips = '<div class="co-list" style="flex-wrap:wrap">' + lv.watchlist.map(x =>
    `<button class="co-chip ${lui.code === x.code ? 'active' : ''}" data-lco="${x.code}" style="flex:1 1 30%">${x.name}</button>`).join('') + '</div>';
  if (!q || q.price == null) {
    return `${chips}<div class="empty">${w?.name || ''} 当前无可用行情${q?.stale ? '（数据可能过期）' : '（可能停牌）'}，暂不可交易。</div>`;
  }
  const up = live.limitUpOf(q.prevClose), down = live.limitDownOf(q.prevClose);
  const p = lv.positions[lui.code];
  const amount = round2(q.price * lui.lots * LOT);
  const comm = commission(amount);
  const stamp = stampTax(amount);
  const maxLots = Math.floor(lv.cash / (q.price * LOT));

  const recent = lv.trades.slice(-6).reverse().map(t => `
    <tr><td>${t.date.slice(5)} ${t.time}</td><td>${t.side === 'buy' ? '买入' : '卖出'} ${t.name}</td>
      <td>${t.qty}</td><td>${t.price.toFixed(2)}</td><td>${t.side === 'sell' ? pnlHTML(t.realized) : '—'}</td></tr>`).join('');

  return `
    ${chips}
    <div class="kv"><span class="k">${q.name} 现价</span><span class="v">${q.price.toFixed(2)} 元 ${changeHTML((q.pct ?? 0) / 100)}${q.stale ? ' <span class="lv-badge">可能过期</span>' : ''}</span></div>
    <div class="kv"><span class="k">涨停价 / 跌停价</span><span class="v">${up.toFixed(2)} / ${down.toFixed(2)} 元</span></div>
    <div class="kv"><span class="k">持仓</span><span class="v">${p ? `${p.shares} 股（可卖 ${p.sellable} 股）· 成本 ${p.avgCost.toFixed(2)} 元` : '无持仓'}</span></div>
    <div class="trade-row" style="margin-top:10px">
      <div class="seg" id="l-seg">
        <button data-side="buy" class="${lui.side === 'buy' ? 'active' : ''}">买入</button>
        <button data-side="sell" class="${lui.side === 'sell' ? 'active' : ''}">卖出</button>
      </div>
    </div>
    <div class="field"><label>数量</label>
      <div class="qty-ctl">
        <button id="l-minus">−</button>
        <input id="l-lots" type="number" min="1" step="1" value="${lui.lots}">
        <button id="l-plus">＋</button>
      </div>
      <span style="font-size:12px;color:var(--muted)">手</span></div>
    <div class="est">${lui.side === 'buy'
      ? `按快照价 ${q.price.toFixed(2)} 元成交<br>金额 ${fmtMoney(amount)} + 佣金 ${fmtMoney(comm)} ≈ <b>${fmtMoney(amount + comm)} 元</b><br>（可用现金 ${fmtMoney(lv.cash)} 元，最多约 ${maxLots} 手）`
      : `按快照价 ${q.price.toFixed(2)} 元成交<br>金额 ${fmtMoney(amount)} − 佣金 ${fmtMoney(comm)} − 印花税 ${fmtMoney(stamp)} ≈ <b>${fmtMoney(amount - comm - stamp)} 元</b><br>（可卖 ${p?.sellable || 0} 股）`}</div>
    <button class="btn primary" id="l-place" style="width:100%">${lui.side === 'buy' ? '买入（按当前快照价）' : '卖出（按当前快照价）'}</button>
    <div class="sec-title">最近成交</div>
    ${recent ? `<table class="list"><tr><th>时间</th><th>方向</th><th>股数</th><th>价格</th><th>盈亏</th></tr>${recent}</table>` : '<div class="empty">还没有成交记录。</div>'}
    <div class="rule-note">实时模拟为<b>模拟规则 · 简化版</b>：T+1（当日买入次日可卖）；涨跌停 ±10%（涨停不可买、跌停不可卖，仅主板股票）；佣金 0.025% 最低 5 元，卖出另收印花税 0.05%；按快照价成交，不模拟盘中排队。真实市场还有更细的规则，本模式不覆盖。</div>`;
}

function posHTML(ctx) {
  const lv = ctx.lv;
  const rows = Object.entries(lv.positions).map(([code, p]) => {
    const px = ctx.quotes[code]?.price ?? lv.lastPx[code] ?? p.avgCost;
    const val = round2(p.shares * px);
    const pnl = round2((px - p.avgCost) * p.shares);
    return `<tr><td>${p.name || code}<br><span style="color:var(--muted);font-size:11px">${code}</span></td>
      <td>${p.shares}<br><span style="color:var(--muted);font-size:11px">可卖 ${p.sellable}</span></td>
      <td>${p.avgCost.toFixed(2)}</td><td>${px.toFixed(2)}</td><td>${fmtMoney(val)}</td><td>${pnlHTML(pnl)}</td></tr>`;
  }).join('');
  const pv = posValue(ctx);
  return `
    <div class="kv"><span class="k">现金</span><span class="v">${fmtMoney(lv.cash)} 元</span></div>
    <div class="kv"><span class="k">持仓市值</span><span class="v">${fmtMoney(pv)} 元</span></div>
    <div class="kv"><span class="k">总资产</span><span class="v">${fmtMoney(round2(lv.cash + pv))} 元</span></div>
    <div class="sec-title">持仓明细</div>
    ${rows ? `<table class="list"><tr><th>股票</th><th>持股</th><th>成本</th><th>现价</th><th>市值</th><th>浮动盈亏</th></tr>${rows}</table>`
      : '<div class="empty">还没有持仓。到「交易」页买入第一笔。</div>'}
    <div class="rule-note">持仓市值按最新快照价估算；停牌股票按最近已知价格估值。真实持仓遇到现金分红时本模式暂不做除息处理，总资产口径会出现偏差——正式学习分红除息请用「历史回放 · 巨岩能源」剧本。</div>`;
}

function reportsHTML(ctx) {
  const reps = ctx.lv.reports.slice().reverse();
  if (!reps.length) return '<div class="empty" style="padding:30px 10px;text-align:center">还没有复盘报告。<br>交易日 15:00 收盘后点顶栏「生成今日复盘」。</div>';
  return reps.map((r, i) => `
    <div class="rep-item" data-rep="${ctx.lv.reports.length - 1 - i}">
      <div><b>${r.date}</b>${r.absent ? '<span class="lv-badge">缺席补记</span>' : ''}</div>
      <div class="rep-line">总资产 ${fmtMoney(r.equity)} 元 · 当日 ${changeHTML(r.dayRet)} · 操作 ${r.trades} 笔</div>
    </div>`).join('') +
    '<div class="rule-note">复盘报告在收盘后生成，记录当日操作、账户变化与「不操作」对照。评价不看盈亏，看决策过程。</div>';
}

function infoHTML(ctx) {
  return `
    <div class="profile">
      <h3>实时模拟 · 规则与数据说明</h3>
      <div class="kv"><span class="k">初始资金</span><span class="v">${fmtMoney(live.LIVE_CASH)} 元（虚拟）</span></div>
      <div class="kv"><span class="k">交易时段</span><span class="v">交易日 09:30–11:30 / 13:00–15:00</span></div>
      <div class="kv"><span class="k">交易规则</span><span class="v">T+1 · 涨跌停 ±10% · 佣金 0.025%（最低 5 元）· 印花税 0.05%（卖出）</span></div>
      <div class="kv"><span class="k">成交价</span><span class="v">下单时的最新快照价</span></div>
      <div class="kv"><span class="k">自选股</span><span class="v">${live.MIN_WATCH}–${live.MAX_WATCH} 只，主板股票</span></div>
      <div class="news-box"><div class="t">数据披露</div>
        行情数据源：AKShare（公开行情接口封装，上游为新浪财经 / 东方财富等公开数据）。快照约 60 秒刷新一次，可能有 1—5 分钟以上延迟；本模式不掌握盘中逐笔成交。数据仅供学习研究，不构成投资建议，数据权利归原始数据方。AKShare 库本身为 MIT 协议。</div>
      <div class="news-box"><div class="t">与真实市场的差距</div>
        本模式只做主板 ±10% 股票；不模拟集合竞价、盘中排队、滑点、分红送股除息、退市。想练暴雷/停牌/分红情境，请回到「历史回放」模式。</div>
      <div class="rule-note">虚拟资金，不涉及真实交易。收益高低不构成对决策好坏的判定。</div>
    </div>`;
}

function bindPanel(ctx, el, tab) {
  const { lui } = ctx;
  el.querySelectorAll('[data-lco]').forEach(b =>
    b.addEventListener('click', () => ctx.dispatch('l-select', { code: b.dataset.lco })));
  if (tab === 'trade') {
    el.querySelectorAll('#l-seg button').forEach(b =>
      b.addEventListener('click', () => { lui.side = b.dataset.side; renderAll(ctx); }));
    el.querySelector('#l-minus')?.addEventListener('click', () => { lui.lots = Math.max(1, lui.lots - 1); renderAll(ctx); });
    el.querySelector('#l-plus')?.addEventListener('click', () => { lui.lots += 1; renderAll(ctx); });
    el.querySelector('#l-lots')?.addEventListener('change', e => { lui.lots = Math.max(1, Math.floor(Number(e.target.value) || 1)); renderAll(ctx); });
    el.querySelector('#l-place')?.addEventListener('click', () =>
      ctx.dispatch(lui.side === 'buy' ? 'l-buy' : 'l-sell', { lots: lui.lots }));
  }
  if (tab === 'report') {
    el.querySelectorAll('[data-rep]').forEach(n =>
      n.addEventListener('click', () => reportModal(ctx, ctx.lv.reports[Number(n.dataset.rep)])));
  }
}

// ---------- 时间线 ----------
function renderTimeline(ctx) {
  const dots = { event: 'dot-event', fill: 'dot-fill', info: 'dot-info' };
  document.getElementById('timeline').innerHTML = ctx.lv.log.slice(-40).reverse().map(l =>
    `<div class="log"><span class="dot ${dots[l.type] || 'dot-info'}"></span><b>${l.date}</b> ${l.text}</div>`
  ).join('');
}

// ---------- 整体渲染 ----------
function renderAll(ctx) {
  if (ctx.serverDown) return;
  renderStats(ctx);
  renderScene(ctx);
  renderTask(ctx);
  renderTabs(ctx);
  renderPanel(ctx);
  renderTimeline(ctx);
  state.save(ctx.st);
}

function renderLoading(ctx) {
  document.getElementById('town').innerHTML = '<div class="lv-empty">正在连接本地行情服务……</div>';
  document.getElementById('panel').innerHTML = '';
}

// ---------- 服务未启动降级页 ----------
function renderServerDown(ctx) {
  document.getElementById('stats').innerHTML = '<span class="stat"><b>行情服务未连接</b></span>';
  document.getElementById('btn-next').disabled = true;
  document.getElementById('tabs').innerHTML = '';
  document.getElementById('panel').innerHTML = `
    <div class="profile"><h3>启动步骤</h3>
      <div class="news-box"><div class="t">一次性准备</div>pip install -r server\\requirements.txt</div>
      <div class="news-box"><div class="t">每次使用</div>python server\\app.py<br>保持该窗口开着，然后回到本页点「重试」。</div>
      <div class="rule-note">行情服务只运行在你自己的电脑上，数据来自 AKShare（公开行情封装，仅供学习研究，不构成投资建议）。</div>
    </div>`;
  document.getElementById('town').innerHTML = `
    <div class="rp-wrap"><div class="lv-empty">
      <b>未检测到本地行情服务</b><br><br>
      实时模式需要本机的行情服务提供数据（浏览器不直接连接行情源）。<br>
      请在项目目录运行：<code class="lv-cmd">python server\\app.py</code>
    </div>
    <div style="display:flex;gap:10px;justify-content:center">
      <button class="btn primary" id="lv-retry">重试连接</button>
      <button class="btn" id="lv-goreplay">先去玩历史回放</button>
    </div></div>`;
  document.getElementById('lv-retry').addEventListener('click', async () => {
    renderLoading(ctx);
    await boot(ctx);
  });
  document.getElementById('lv-goreplay').addEventListener('click', () => {
    ctx.st.mode = 'replay'; state.save(ctx.st); location.reload();
  });
  ui.renderTaskCard(ctx, {
    title: '实时模拟 · 等待行情服务',
    hint: '服务启动后本页会自动进入行情看板。教学小镇与历史回放不受影响，可随时切换。',
    buttons: [],
  });
}

// ---------- 自选股管理 ----------
function watchPicker(ctx) {
  const lv = ctx.lv;
  const render = () => {
    const poolRows = live.STOCK_POOL.map(s => {
      const inList = lv.watchlist.some(w => w.code === s.code);
      return `<button class="pool-chip ${inList ? 'on' : ''}" data-pool="${s.code}">${s.hint}</button>`;
    }).join('');
    const cur = lv.watchlist.map(w =>
      `<span class="watch-tag">${w.name} ${w.code}<b data-rm="${w.code}">×</b></span>`).join('');
    card.querySelector('.body').innerHTML = `
      <p>当前自选股（${lv.watchlist.length}/${live.MAX_WATCH}）：${cur || '空'}</p>
      <div class="sec-title">从常见股票池选择</div>
      <div class="pool-grid">${poolRows}</div>
      <div class="sec-title">或输入 6 位代码（仅主板 60/00 开头）</div>
      <div class="field"><input id="lv-custom" placeholder="如 600690" maxlength="6" style="flex:1"><button class="btn small" id="lv-add-custom">添加</button></div>
      <p style="color:var(--muted);font-size:12px">仍持有的股票不能移除；创业板/科创板（30/68 开头）涨跌幅为 ±20%，本模式暂不纳入。</p>`;
    card.querySelectorAll('[data-pool]').forEach(b => b.addEventListener('click', async () => {
      const code = b.dataset.pool;
      if (lv.watchlist.some(w => w.code === code)) {
        const r = live.removeWatch(lv, code);
        if (!r.ok) ui.toast(r.msg);
      } else {
        b.textContent = '查询中…';
        try {
          const r = await api(`/api/quote?code=${code}`);
          if (r.ok && r.data.quotes[code]) {
            const rr = live.addWatch(lv, code, r.data.quotes[code].name);
            if (!rr.ok) ui.toast(rr.msg);
            else { ctx.quotes[code] = { ...r.data.quotes[code], stale: false }; }
          } else ui.toast(r.error?.msg || '未找到该股票');
        } catch { ui.toast('行情服务连接失败'); }
      }
      state.save(ctx.st);
      render();
      if (!ui.isModalOpen()) renderAll(ctx);   // 弹窗开着，只刷新数据层面
    }));
    card.querySelectorAll('[data-rm]').forEach(n => n.addEventListener('click', () => {
      const r = live.removeWatch(lv, n.dataset.rm);
      if (!r.ok) ui.toast(r.msg);
      state.save(ctx.st);
      render();
    }));
    card.querySelector('#lv-add-custom').addEventListener('click', async () => {
      const code = card.querySelector('#lv-custom').value.trim();
      if (!live.validCustomCode(code)) { ui.toast('仅支持主板股票（60/00 开头的 6 位代码）'); return; }
      try {
        const r = await api(`/api/quote?code=${code}`);
        if (r.ok && r.data.quotes[code]) {
          const rr = live.addWatch(lv, code, r.data.quotes[code].name);
          ui.toast(rr.ok ? `已添加 ${r.data.quotes[code].name}` : rr.msg);
          if (rr.ok) ctx.quotes[code] = { ...r.data.quotes[code], stale: false };
        } else ui.toast(r.error?.msg || '未找到该股票代码');
      } catch { ui.toast('行情服务连接失败'); }
      state.save(ctx.st);
      render();
    });
  };
  const card = ui.showModal({
    title: '管理自选股',
    bodyHTML: '',
    buttons: [{ label: '完成', primary: true, onClick: async () => { await refreshQuotes(ctx); renderAll(ctx); } }],
  });
  render();
}

// ---------- 复盘报告弹窗 ----------
function reportModal(ctx, r) {
  const dayTrades = ctx.lv.trades.filter(t => t.date === r.date);
  const rows = dayTrades.map(t => `
    <tr><td>${t.time}</td><td>${t.side === 'buy' ? '买入' : '卖出'} ${t.name}</td>
      <td>${t.qty}</td><td>${t.price.toFixed(2)}</td><td>${changeHTML(t.pct)}</td>
      <td>${t.side === 'sell' ? pnlHTML(t.realized) : '—'}</td></tr>`).join('');
  ui.showModal({
    title: `复盘报告 · ${r.date}${r.absent ? '（缺席补记）' : ''}`,
    bodyHTML: `
      <div class="settle-grid">
        <div class="settle-item"><div class="k">总资产</div><div class="v">${fmtMoney(r.equity)} 元</div></div>
        <div class="settle-item"><div class="k">当日收益</div><div class="v">${changeHTML(r.dayRet)}</div></div>
        <div class="settle-item"><div class="k">总收益</div><div class="v">${changeHTML(r.totalRet)}</div></div>
        <div class="settle-item"><div class="k">若今日不操作</div><div class="v">${changeHTML(r.noTradeRet)}</div></div>
        <div class="settle-item"><div class="k">操作</div><div class="v">${r.trades} 笔</div></div>
        <div class="settle-item"><div class="k">当日费用</div><div class="v">${fmtMoney(r.fees)} 元</div></div>
      </div>
      <div class="sec-title">观察（不评价对错）</div>
      <ul class="settle-obs">${r.notes.map(n => `<li>${n}</li>`).join('')}</ul>
      ${rows ? `<div class="sec-title">当日操作</div><table class="list"><tr><th>时间</th><th>方向</th><th>股数</th><th>价格</th><th>当时涨跌</th><th>盈亏</th></tr>${rows}</table>` : ''}
      <div class="rule-note">「若今日不操作」= 今日开盘前的现金与持仓原封不动拿到收盘的对照结果。涨跌不构成对决策好坏的判定——合理决策可能亏损，冒险决策可能偶然获利。</div>`,
    buttons: [{ label: '关闭', primary: true }],
  });
}

// ---------- 欢迎 ----------
function welcomeModal(ctx) {
  ui.showModal({
    title: '欢迎来到实时模拟',
    bodyHTML: `
      <p>这里是<b>真实行情 + 虚拟资金</b>：你看到的价格来自真实 A 股（快照，约 60 秒刷新，可能有延迟），但交易用的是 10 万元虚拟资金。</p>
      <p>规则与回放模式一致：T+1、涨跌停 ±10%、佣金与印花税。每个交易日收盘后可以生成一份<b>复盘报告</b>。</p>
      <p>第一步：点击「管理自选股」，选 3–5 只你想跟踪的股票。</p>`,
    buttons: [{ label: '开始', primary: true, onClick: () => ctx.dispatch('l-watch') }],
  });
}

// ---------- 动作分发 ----------
async function lDispatch(ctx, type, payload = {}) {
  const { lv, lui, st } = ctx;
  switch (type) {
    case 'l-select':
      lui.code = payload.code;
      lui.tab = 'trade';
      break;
    case 'l-buy': case 'l-sell': {
      const q = ctx.quotes[lui.code];
      if (!q) { ui.toast('该股票暂无行情，无法下单'); return; }
      const cal = ctx.calInfo;
      const tradeCtx = {
        date: cal?.today || todayStr(),
        time: timeStr(),
        isTradeDay: cal?.isTradeDay ?? false,
        inSession: live.inSession(new Date()),
      };
      const r = type === 'l-buy' ? live.buy(lv, q, payload.lots, tradeCtx) : live.sell(lv, q, payload.lots, tradeCtx);
      ui.toast(r.ok ? (type === 'l-buy' ? `已买入 ${q.name}（快照价成交）` : `已卖出 ${q.name}（快照价成交）`) : r.msg);
      break;
    }
    case 'l-watch':
      if (ctx.serverDown) { ui.toast('行情服务未连接'); return; }
      watchPicker(ctx);
      return;
    case 'l-settle': {
      const ck = canSettle(ctx);
      if (!ck.ok) { ui.toast(`现在还不能复盘：${ck.reason}`); return; }
      const closeMap = {};
      for (const c of Object.keys(lv.positions)) {
        const px = ctx.quotes[c]?.price;
        if (px != null) closeMap[c] = px;
      }
      const r = live.settleDay(lv, ctx.calInfo.today, closeMap, { absent: false });
      if (r) { state.save(st); reportModal(ctx, r); renderAll(ctx); }
      return;
    }
    case 'l-exit':
      ui.showModal({
        title: '返回模式选择？',
        bodyHTML: '<p>实时模拟的账户与持仓会保留，行情服务可以一直开着。</p>',
        buttons: [
          { label: '取消' },
          { label: '确认', primary: true, onClick: () => { st.mode = null; state.save(st); location.reload(); } },
        ],
      });
      return;
    default:
      return;
  }
  renderAll(ctx);
}
