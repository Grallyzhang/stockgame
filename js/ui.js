// UI：顶栏统计、Tab 面板（公司/交易/盘口/行情/研究）、概念卡弹窗、K 线图、时间线
import { COMPANIES, companyById, INITIAL_CASH, LOT, TOTAL_DAYS, ACHIEVEMENTS } from './data.js';
import { quote, prevClose, dayChangePct, fee, positionValue, frozenCash, lockedShares, totalAssets, limitUp, limitDown, isLimitUpDay, isLimitDownDay, townIndex, townIndexPct } from './market.js';
import { fmtMoney, fmtCap, fmtVolume, changeHTML, pnlHTML, round2, mulberry32 } from './util.js';
import { maSeries, macd, detectCross } from './indicators.js';

// ---------- 顶栏 ----------
export function renderStats(ctx) {
  const { st, market } = ctx;
  const total = totalAssets(st, market);
  const ret = (total - INITIAL_CASH) / INITIAL_CASH;
  document.getElementById('stats').innerHTML = `
    <span class="stat"><span class="lbl">第</span><b>${st.day}</b><span class="lbl">/${TOTAL_DAYS} 天</span></span>
    ${st.unlocked.index ? `<button class="stat stat-btn" id="stat-index" title="点击查看指数权重"><span class="lbl">小镇综指</span><b>${townIndex(market, st.day)}</b> ${changeHTML(townIndexPct(market, st.day))}</button>` : ''}
    <span class="stat"><span class="lbl">现金</span><b>${fmtMoney(st.cash)}</b></span>
    <span class="stat"><span class="lbl">持仓市值</span><b>${fmtMoney(positionValue(st, market))}</b></span>
    <span class="stat"><span class="lbl">总资产</span><b>${fmtMoney(total)}</b></span>
    <span class="stat"><span class="lbl">收益率</span><b>${changeHTML(ret)}</b></span>`;
  document.getElementById('btn-review').disabled = !st.unlocked.review;
  document.getElementById('stat-index')?.addEventListener('click', () => ctx.dispatch('indexInfo'));
}

// ---------- Tab ----------
const TABS = [
  { id: 'company', name: '公司' },
  { id: 'trade', name: '交易', lock: st => !st.unlocked.trade },
  { id: 'book', name: '盘口', lock: st => !st.unlocked.book },
  { id: 'chart', name: '行情', lock: st => !st.unlocked.chart },
  { id: 'research', name: '研究' },
];

export function renderTabs(ctx) {
  const { st, ui } = ctx;
  document.getElementById('tabs').innerHTML = TABS.map(t => {
    const locked = t.lock?.(st);
    return `<button class="tab ${ui.tab === t.id ? 'active' : ''} ${locked ? 'locked' : ''}"
      data-tab="${t.id}">${t.name}${locked ? ' ·锁' : ''}</button>`;
  }).join('');
  document.querySelectorAll('#tabs .tab').forEach(b => {
    b.addEventListener('click', () => ctx.dispatch('tab', { tab: b.dataset.tab }));
  });
}

// ---------- 面板 ----------
export function renderPanel(ctx) {
  const el = document.getElementById('panel');
  const tab = ctx.ui.tab;
  if (tab === 'company') el.innerHTML = companyHTML(ctx);
  else if (tab === 'trade') el.innerHTML = tradeHTML(ctx);
  else if (tab === 'book') el.innerHTML = bookHTML(ctx);
  else if (tab === 'chart') el.innerHTML = chartHTML(ctx);
  else el.innerHTML = researchHTML(ctx);
  bindPanelEvents(ctx, el, tab);
}

function coChips(ctx) {
  return `<div class="co-list">` + COMPANIES.map(c =>
    `<button class="co-chip ${ctx.ui.company === c.id ? 'active' : ''}" data-co="${c.id}">${c.name}</button>`
  ).join('') + `</div>`;
}

function bizNews(st, id) {
  if (id === 'pinecone') {
    if (st.day >= 56) return '关税上调推高了原材料成本预期，厂区门口的货车少了些。';
    if (st.day >= 54) return '财报披露：营收增长但利润下滑，市场正在重新评估。';
    if (st.day >= 51) return '门店前排起长队，到处都在讨论新品礼盒——但公告栏上没有正式公告。';
    if (st.day >= 13) return '除息完成，红利已发放给登记日持股的股东。';
    if (st.day >= 3) return '公告：拟每 10 股派现 2 元，第 12 天登记、第 13 天除息。';
    return '生产线正常运转，坚果零食稳定出货。';
  }
  if (id === 'beaver') {
    if (st.day >= 56) return '关税消息与物流业务无关，货车照常进出。';
    if (st.day >= 10) return '新物流中心启用，货车明显变多了。';
    return '每日按时收发货物，订单平稳。';
  }
  if (st.day >= 55 && st.day <= 57) return '「AI 灯具海外大卖」的传闻刷屏，研发楼外聚集了围观者——但没有官方公告。';
  if (st.day === 9) return '「发布会将有重磅新品」的传闻引爆关注，股价开盘直冲涨停。';
  if (st.day >= 12 && st.day <= 14) return '新品发布会吸引了不少关注。';
  return '研发楼里灯火通明，市场对它期待很高。';
}

function companyHTML(ctx) {
  const { st, market, ui } = ctx;
  const co = companyById(ui.company);
  const q = quote(market, co.id, st.day);
  const pct = dayChangePct(market, co.id, st.day);
  const cap = q.close * co.shares;
  return `
    ${coChips(ctx)}
    <div class="profile">
      <h3 style="color:${co.color}">${co.name}</h3>
      <div class="blurb">${co.blurb}</div>
      <div class="kv"><span class="k">当前股价（每股）</span><span class="v">${q.close.toFixed(2)} 元 ${changeHTML(pct)}</span></div>
      <div class="kv"><span class="k">总股数</span><span class="v">${fmtCap(co.shares)}股</span></div>
      <div class="kv"><span class="k">公司总市值</span><span class="v">${fmtCap(cap)}元</span></div>
      <div class="kv"><span class="k">今日成交区间</span><span class="v">${q.low.toFixed(2)} ~ ${q.high.toFixed(2)} 元</span></div>
      <div class="news-box"><div class="t">经营动态</div>${bizNews(st, co.id)}</div>
      <div class="rule-note">提示：点击小镇里的建筑也可以查看对应公司。</div>
    </div>`;
}

function tradeHTML(ctx) {
  const { st, market, ui } = ctx;
  if (!st.unlocked.trade) {
    return `<div class="lock-box"><span class="ico">▣</span>交易台尚未解锁<br>先完成前两个任务：认识公司、理解市值。</div>`;
  }
  const tr = ui.trade;
  const co = companyById(tr.symbol);
  const q = quote(market, tr.symbol, st.day);
  const cur = q.close;
  const up = limitUp(market, tr.symbol, st.day);
  const down = limitDown(market, tr.symbol, st.day);
  const estPrice = tr.kind === 'market' ? cur : (parseFloat(tr.price) || 0);
  const amount = round2(estPrice * tr.lots * LOT);
  const f = fee(amount);
  const p = st.positions[tr.symbol];
  const avail = Math.max(0, (p?.sellable || 0) - lockedShares(st, tr.symbol));

  let rows = Object.entries(st.positions).map(([id, pos]) => {
    const c = companyById(id), cq = quote(market, id, st.day).close;
    const pnl = round2((cq - pos.avgCost) * pos.shares);
    return `<tr><td>${c.name}</td><td>${pos.shares}</td><td>${pos.sellable ?? 0}</td><td>${pos.avgCost.toFixed(2)}</td>
      <td>${cq.toFixed(2)}</td><td>${pnlHTML(pnl)}</td></tr>`;
  }).join('');

  const pending = st.orders.filter(o => o.status === 'pending').map(o => `
    <tr><td>${o.side === 'buy' ? '买入' : '卖出'} ${companyById(o.symbol).name}</td>
      <td>${o.qty}</td><td>限价 ${o.price.toFixed(2)}</td>
      <td><button class="btn small" data-cancel="${o.id}">撤单</button></td></tr>`).join('');

  const limitTag = isLimitUpDay(market, tr.symbol, st.day) ? '<span class="chg up">已涨停，今日不可买入</span>'
    : isLimitDownDay(market, tr.symbol, st.day) ? '<span class="chg down">已跌停，今日不可卖出</span>' : '';

  return `
    ${coChips(ctx)}
    <div class="kv"><span class="k">${co.name} 当前价</span><span class="v">${cur.toFixed(2)} 元 ${changeHTML(dayChangePct(market, tr.symbol, st.day))} ${limitTag}</span></div>
    <div class="kv"><span class="k">今日涨停 / 跌停</span><span class="v">${up.toFixed(2)} / ${down.toFixed(2)} 元</span></div>
    <div class="trade-row" style="margin-top:10px">
      <div class="seg" id="seg-side">
        <button data-side="buy" class="${tr.side === 'buy' ? 'active' : ''}">买入</button>
        <button data-side="sell" class="${tr.side === 'sell' ? 'active' : ''}">卖出</button>
      </div>
      <div class="seg" id="seg-kind">
        <button data-kind="market" class="${tr.kind === 'market' ? 'active' : ''}">市价</button>
        <button data-kind="limit" class="${tr.kind === 'limit' ? 'active' : ''}">限价</button>
      </div>
    </div>
    ${tr.kind === 'limit' ? `
      <div class="field"><label>限价</label>
        <input id="in-price" type="number" step="0.01" min="0.01" value="${tr.price}" placeholder="每股价格"></div>` : ''}
    <div class="field"><label>数量</label>
      <div class="qty-ctl">
        <button id="qty-minus">−</button>
        <input id="in-lots" type="number" min="1" step="1" value="${tr.lots}">
        <button id="qty-plus">＋</button>
      </div>
      <span style="font-size:12px;color:var(--muted)">手（1 手 = ${LOT} 股）</span></div>
    <div class="est" id="est">${estHTML(tr.side, estPrice, amount, f, st.cash, avail)}</div>
    <button class="btn primary" id="btn-place" style="width:100%">${tr.side === 'buy' ? '提交买入委托' : '提交卖出委托'}</button>
    <div class="sec-title">当前持仓</div>
    ${rows ? `<table class="list"><tr><th>公司</th><th>持股</th><th>可卖</th><th>成本</th><th>现价</th><th>浮动盈亏</th></tr>${rows}</table>`
      : `<div class="empty">还没有持仓。买入成交后会在这里显示。</div>`}
    <div class="sec-title">未成交委托</div>
    ${pending ? `<table class="list"><tr><th>委托</th><th>股数</th><th>价格</th><th></th></tr>${pending}</table>`
      : `<div class="empty">没有等待成交的委托。</div>`}
    <div class="rule-note">模拟 A 股规则 · 简化版：1 手 = 100 股；佣金 0.1%、最低 1 元；<b>T+1</b>（当日买入，次日可卖）；<b>涨跌停 ±10%</b>（相对昨收）；
      市价单按当前价立即成交；限价单在市场价格到达时成交。与真实市场规则不同。</div>`;
}

function estHTML(side, estPrice, amount, f, cash, avail) {
  if (!estPrice) return '请输入限价后显示预估';
  if (side === 'buy') {
    return `预计金额 ${fmtMoney(amount)} 元 + 佣金 ${fmtMoney(f)} 元<br>≈ <b>${fmtMoney(amount + f)} 元</b>　（可用现金 ${fmtMoney(cash)} 元）`;
  }
  return `预计金额 ${fmtMoney(amount)} 元 − 佣金 ${fmtMoney(f)} 元<br>≈ <b>${fmtMoney(amount - f)} 元</b>　（今日可卖 ${avail} 股）`;
}

// ---------- 盘口（展示性模拟五档，基于最新价生成，不参与撮合） ----------
export function bookHTML(ctx) {
  const { st, market, ui } = ctx;
  if (!st.unlocked.book) {
    return `<div class="lock-box"><span class="ico">▥</span>盘口显示屏尚未解锁<br>完成任务「委托与成交」后开放。</div>`;
  }
  const co = companyById(ui.company);
  const cur = quote(market, co.id, st.day).close;
  const rng = mulberry32(st.seed + st.day * 7919 + co.id.length * 131);
  const tick = Math.max(0.01, round2(cur * 0.002));
  const lvName = ['一', '二', '三', '四', '五'];
  const asks = [], bids = [];
  for (let i = 5; i >= 1; i--) asks.push({ id: `ask${i}`, lv: `卖${lvName[i - 1]}`, price: round2(cur + tick * i), vol: (Math.floor(rng() * 9) + 1) * 100 });
  for (let i = 1; i <= 5; i++) bids.push({ id: `bid${i}`, lv: `买${lvName[i - 1]}`, price: round2(cur - tick * i), vol: (Math.floor(rng() * 9) + 1) * 100 });
  const spread = round2(asks[4].price - bids[0].price);
  const row = x => `<tr class="${x.lv[0] === '卖' ? 'ask' : 'bid'}" data-row="${x.id}"><td>${x.lv}</td><td>${x.price.toFixed(2)}</td><td>${x.vol}</td></tr>`;
  return `
    ${coChips(ctx)}
    <div class="kv"><span class="k">${co.name} 最新价</span><span class="v">${cur.toFixed(2)} 元</span></div>
    <table class="list book">
      <tr><th>档位</th><th>价格（元）</th><th>挂单量（股）</th></tr>
      ${asks.map(row).join('')}
      <tr class="spread"><td colspan="3">价差（spread）= 卖一 − 买一 = ${spread.toFixed(2)} 元</td></tr>
      ${bids.map(row).join('')}
    </table>
    <div class="rule-note">盘口为教学演示（基于最新价模拟生成，不参与真实撮合）。买入按卖一价立即成交；你挂的低价买单会排在买一后面<b>排队</b>——价格优先、同价先到先成交（简化）。</div>`;
}

function chartHTML(ctx) {
  const { st, market, ui } = ctx;
  if (!st.unlocked.chart) {
    return `<div class="lock-box"><span class="ico">▤</span>行情终端尚未解锁<br>推进到第 10 天完成任务后开放。</div>`;
  }
  const co = companyById(ui.company);
  const bars = market[co.id].slice(0, st.day);
  const last5 = bars.slice(-5).reverse().map(b => {
    const pct = dayChangePct(market, co.id, b.day);
    return `<tr><td>第 ${b.day} 天</td><td>${b.close.toFixed(2)}</td><td>${changeHTML(pct)}</td><td>${fmtVolume(b.volume)}</td></tr>`;
  }).join('');
  const opts = {};
  if (st.unlocked.ma) opts.ma = [5, 10, 20];
  const markers = chartMarkers(ctx);
  if (markers?.length) opts.markers = markers;
  return `
    ${coChips(ctx)}
    ${st.unlocked.ma ? `<div class="ma-legend"><span style="color:#e0a030">— MA5</span><span style="color:#4a7fb5">— MA10</span><span style="color:#8a8474">— MA20</span></div>` : ''}
    <div class="chart-wrap">${candleSVG(bars, opts)}</div>
    ${st.unlocked.macd ? `<div class="chart-wrap macd-pane">${macdSVG(bars)}</div>` : ''}
    <div class="chart-note">红色 ▲ 上涨 / 绿色 ▼ 下跌；下方柱为成交量。读图是还原已发生的事，不等于预测未来。</div>
    <div class="sec-title">最近交易日</div>
    <table class="list"><tr><th>交易日</th><th>收盘</th><th>涨跌幅</th><th>成交量</th></tr>${last5}</table>`;
}

// 当前课的信号日高亮（仅松果：K 线形态与量价课的标本）
function chartMarkers(ctx) {
  if (ctx.ui.company !== 'pinecone') return null;
  const t = ctx.st.tasks.active;
  const M = {
    t10: [{ day: 15, label: '大阳' }, { day: 16, label: '大阴' }],
    t11: [{ day: 18, label: '长上影' }, { day: 20, label: '十字星' }],
    t12: [{ day: 23, label: '阴线' }, { day: 24, label: '吞没' }],
    t13: [{ day: 29, label: '缺口' }],
    t14: [{ day: 31, label: '①' }, { day: 32, label: '②星' }, { day: 33, label: '③' }],
    t16: [{ day: 39, label: '放量' }],
    t17: [{ day: 39, label: '' }, { day: 40, label: '放量' }, { day: 41, label: '滞涨' }],
  };
  if (M[t]) return M[t].filter(m => m.day <= ctx.st.day);
  if (t === 't19') { // 金叉：窗口 [47,55] 内动态检测首日
    const bars = ctx.market.pinecone.slice(0, ctx.st.day);
    const ma5 = maSeries(bars, 5), ma10 = maSeries(bars, 10);
    for (let d = 47; d <= Math.min(55, ctx.st.day); d++) {
      if (detectCross(ma5, ma10, d - 1) === 'gold') return [{ day: d, label: '金叉' }];
    }
  }
  return null;
}

export function candleSVG(bars, opts = {}) {
  const W = 620, H = 320, padL = 48, padR = 10, padT = 12, volH = 48, gap = 8, bottomPad = 20;
  const priceH = H - padT - volH - gap - bottomPad;
  const n = bars.length;
  const hi = Math.max(...bars.map(b => b.high));
  const lo = Math.min(...bars.map(b => b.low));
  const vmax = Math.max(...bars.map(b => b.volume));
  const xw = (W - padL - padR) / n;
  const y = p => padT + (hi - p) / ((hi - lo) || 1) * priceH;
  const volBase = H - bottomPad;

  let s = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block">`;
  for (let i = 0; i <= 2; i++) {
    const p = lo + (hi - lo) * i / 2;
    const yy = y(p);
    s += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="#eee6d2"/>`;
    s += `<text x="${padL - 4}" y="${yy + 4}" font-size="10" fill="#8a8474" text-anchor="end">${p.toFixed(2)}</text>`;
  }
  // 信号日高亮竖带（置于蜡烛之下，不拦截点击）
  if (opts.markers?.length) {
    for (const m of opts.markers) {
      const i = bars.findIndex(b => b.day === m.day);
      if (i < 0) continue;
      const cx = padL + i * xw + xw / 2;
      s += `<rect class="sig-marker" x="${(cx - xw / 2).toFixed(1)}" y="${padT}" width="${xw.toFixed(1)}" height="${priceH + gap + volH}" pointer-events="none"/>`;
      if (m.label) s += `<text x="${cx.toFixed(1)}" y="${padT + 9}" font-size="8" fill="#c9742c" text-anchor="middle" pointer-events="none">${m.label}</text>`;
    }
  }
  bars.forEach((b, i) => {
    const cx = padL + i * xw + xw / 2;
    const hit = `<rect class="candle-hit" data-day="${b.day}" x="${cx - xw / 2}" y="${padT}" width="${xw}" height="${H - padT - bottomPad}" fill="transparent"/>`;
    if (b.suspended) { // 停牌日：灰色虚线标记，无成交
      s += `<line x1="${cx - xw / 2}" y1="${y(b.close)}" x2="${cx + xw / 2}" y2="${y(b.close)}" stroke="#b7b0a0" stroke-width="1.2" stroke-dasharray="2 3"/>`;
      s += `<text x="${cx}" y="${y(b.close) - 4}" font-size="8" fill="#b7b0a0" text-anchor="middle">停</text>`;
      s += hit;
      return;
    }
    const up = b.close >= b.open;
    const color = up ? '#d0453e' : '#2e9e5f';
    const bw = Math.max(2, xw * 0.6);
    s += `<line x1="${cx}" y1="${y(b.high)}" x2="${cx}" y2="${y(b.low)}" stroke="${color}" stroke-width="1.4"/>`;
    s += `<rect x="${cx - bw / 2}" y="${Math.min(y(b.open), y(b.close))}" width="${bw}" height="${Math.max(1.5, Math.abs(y(b.open) - y(b.close)))}" fill="${up ? '#fffdf7' : color}" stroke="${color}" stroke-width="1.4"/>`;
    const vh = (b.volume / vmax) * volH;
    s += `<rect x="${cx - bw / 2}" y="${volBase - vh}" width="${bw}" height="${vh}" fill="${color}" opacity="0.45"/>`;
    s += hit;
  });
  // 均线叠加（null 段跳过，不拦截蜡烛点击）
  if (opts.ma?.length) {
    const colors = { 5: '#e0a030', 10: '#4a7fb5', 20: '#8a8474' };
    for (const mn of opts.ma) {
      const ma = maSeries(bars, mn);
      const pts = [];
      for (let i = 0; i < ma.length; i++) {
        if (ma[i] == null) continue;
        pts.push(`${(padL + i * xw + xw / 2).toFixed(1)},${y(ma[i]).toFixed(1)}`);
      }
      if (pts.length) s += `<polyline class="ma-line" points="${pts.join(' ')}" fill="none" stroke="${colors[mn] || '#999'}" stroke-width="1.4" pointer-events="none"/>`;
    }
  }
  const step = Math.ceil(n / 6);
  for (let i = 0; i < n; i += step) {
    s += `<text x="${padL + i * xw + xw / 2}" y="${H - 4}" font-size="10" fill="#8a8474" text-anchor="middle">D${bars[i].day}</text>`;
  }
  return s + '</svg>';
}

// MACD 副图：DIF/DEA 双线 + hist 红绿柱（独立 64px 高面板）
export function macdSVG(bars) {
  const W = 620, H = 64, padL = 48, padR = 10, padT = 6, padB = 10;
  const { dif, dea, hist } = macd(bars);
  let s = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block">`;
  const vals = [];
  for (let i = 0; i < bars.length; i++) if (dif[i] != null) vals.push(dif[i], dea[i], hist[i]);
  if (!vals.length) return s + `<text x="${padL}" y="${H / 2}" font-size="10" fill="#8a8474">MACD 需要至少 26 个交易日数据</text></svg>`;
  const hi = Math.max(...vals, 0), lo = Math.min(...vals, 0);
  const span = (hi - lo) || 1;
  const y = v => padT + (hi - v) / span * (H - padT - padB);
  const xw = (W - padL - padR) / bars.length;
  const y0 = y(0);
  s += `<line x1="${padL}" y1="${y0}" x2="${W - padR}" y2="${y0}" stroke="#eee6d2"/>`;
  const bw = Math.max(1.5, xw * 0.5);
  for (let i = 0; i < bars.length; i++) {
    if (hist[i] == null) continue;
    const cx = padL + i * xw + xw / 2;
    const yy = y(hist[i]);
    s += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${Math.min(y0, yy).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, Math.abs(yy - y0)).toFixed(1)}" fill="${hist[i] >= 0 ? '#d0453e' : '#2e9e5f'}" opacity="0.7"/>`;
  }
  const line = (arr, color) => {
    const pts = [];
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] == null) continue;
      pts.push(`${(padL + i * xw + xw / 2).toFixed(1)},${y(arr[i]).toFixed(1)}`);
    }
    return pts.length ? `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.3" pointer-events="none"/>` : '';
  };
  s += line(dif, '#4a7fb5') + line(dea, '#e0a030');
  s += `<text x="${padL + 2}" y="${padT + 8}" font-size="9" fill="#4a7fb5">DIF</text>`;
  s += `<text x="${padL + 26}" y="${padT + 8}" font-size="9" fill="#e0a030">DEA</text>`;
  s += `<text x="${padL - 4}" y="${y0 + 3}" font-size="9" fill="#8a8474" text-anchor="end">0</text>`;
  return s + '</svg>';
}

function researchHTML(ctx) {
  const { st } = ctx;
  const list = ACHIEVEMENTS.map(a => {
    const got = st.achievements.includes(a.id);
    return `<div class="ach ${got ? '' : 'off'}">
      <div class="badge">${got ? '✓' : '·'}</div>
      <div><div class="n">${a.name}</div><div class="d">${a.desc}</div></div></div>`;
  }).join('');
  return `
    <div class="kv"><span class="k">研究室等级</span><span class="v">Lv.${st.labLevel}</span></div>
    <div class="kv"><span class="k">已完成课程</span><span class="v">${st.tasks.done.length} / 28</span></div>
    <div class="kv"><span class="k">本局种子</span><span class="v">${st.seed}</span></div>
    <div class="sec-title">研究成就</div>${list}
    <div class="rule-note">成就来自可验证的学习行为，不能靠频繁买卖刷取；已解锁的能力不会因亏损消失。</div>`;
}

function bindPanelEvents(ctx, el, tab) {
  el.querySelectorAll('.co-chip').forEach(b =>
    b.addEventListener('click', () => ctx.dispatch('selectCompany', { id: b.dataset.co })));

  if (tab === 'book') {
    el.querySelectorAll('tr[data-row]').forEach(r =>
      r.addEventListener('click', () => ctx.dispatch('bookRow', { symbol: ctx.ui.company, row: r.dataset.row })));
  }

  if (tab === 'chart') {
    el.querySelectorAll('.candle-hit').forEach(r =>
      r.addEventListener('click', () => ctx.dispatch('candlePick', { symbol: ctx.ui.company, day: Number(r.dataset.day) })));
  }

  if (tab === 'trade' && ctx.st.unlocked.trade) {
    const tr = ctx.ui.trade;
    el.querySelectorAll('#seg-side button').forEach(b =>
      b.addEventListener('click', () => { tr.side = b.dataset.side; ctx.dispatch('uiRefresh'); }));
    el.querySelectorAll('#seg-kind button').forEach(b =>
      b.addEventListener('click', () => {
        tr.kind = b.dataset.kind;
        if (tr.kind === 'limit' && !tr.price) tr.price = quote(ctx.market, tr.symbol, ctx.st.day).close.toFixed(2);
        ctx.dispatch('uiRefresh');
      }));
    el.querySelector('#qty-minus').addEventListener('click', () => { tr.lots = Math.max(1, tr.lots - 1); ctx.dispatch('uiRefresh'); });
    el.querySelector('#qty-plus').addEventListener('click', () => { tr.lots = tr.lots + 1; ctx.dispatch('uiRefresh'); });
    el.querySelector('#in-lots').addEventListener('change', e => {
      tr.lots = Math.max(1, Math.floor(Number(e.target.value) || 1)); ctx.dispatch('uiRefresh');
    });
    const priceIn = el.querySelector('#in-price');
    if (priceIn) priceIn.addEventListener('input', e => {
      tr.price = e.target.value;
      const estPrice = parseFloat(tr.price) || 0;
      const amount = round2(estPrice * tr.lots * LOT);
      const pos = ctx.st.positions[tr.symbol];
      const avail = Math.max(0, (pos?.sellable || 0) - lockedShares(ctx.st, tr.symbol));
      el.querySelector('#est').innerHTML = estHTML(tr.side, estPrice, amount, fee(amount), ctx.st.cash, avail);
    });
    el.querySelector('#btn-place').addEventListener('click', () => {
      ctx.dispatch('placeOrder', {
        symbol: tr.symbol, side: tr.side, kind: tr.kind,
        price: tr.kind === 'limit' ? parseFloat(tr.price) : null, lots: tr.lots,
      });
    });
    el.querySelectorAll('[data-cancel]').forEach(b =>
      b.addEventListener('click', () => ctx.dispatch('cancelOrder', { id: Number(b.dataset.cancel) })));
  }
}

// ---------- 任务卡 ----------
export function renderTaskCard(ctx, view) {
  const el = document.getElementById('task-card');
  el.innerHTML = `
    <div class="task-title">${view.title}${view.mins ? `<span class="task-mins">约 ${view.mins} 分钟</span>` : ''}</div>
    <div class="task-hint">${view.hint}</div>
    ${view.buttons?.length ? `<div class="task-btns">${view.buttons.map((b, i) =>
      `<button class="btn small ${b.primary ? 'primary' : ''}" data-tb="${i}">${b.label}</button>`).join('')}</div>` : ''}`;
  el.querySelectorAll('[data-tb]').forEach(b =>
    b.addEventListener('click', () => view.buttons[Number(b.dataset.tb)].onClick()));
}

// ---------- 时间线 ----------
export function renderTimeline(ctx) {
  const dots = { event: 'dot-event', order: 'dot-order', fill: 'dot-fill', task: 'dot-task', decision: 'dot-decision', info: 'dot-info' };
  document.getElementById('timeline').innerHTML = ctx.st.log.slice(-40).reverse().map(l =>
    `<div class="log"><span class="dot ${dots[l.type] || 'dot-info'}"></span><b>第 ${l.day} 天</b> ${l.text}</div>`
  ).join('');
}

// ---------- 弹窗 ----------
export function showModal({ title, bodyHTML, buttons = [], closable = false }) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-mask"><div class="modal-card" role="dialog" aria-modal="true">
      <h2>${title}</h2>
      <div class="body">${bodyHTML}</div>
      <div class="modal-btns"></div>
    </div></div>`;
  const btnBox = root.querySelector('.modal-btns');
  buttons.forEach(cfg => {
    const b = document.createElement('button');
    b.className = 'btn' + (cfg.primary ? ' primary' : '') + (cfg.danger ? ' danger' : '');
    b.textContent = cfg.label;
    b.addEventListener('click', () => { if (!cfg.keep) closeModal(); cfg.onClick?.(); });
    btnBox.appendChild(b);
  });
  if (closable) root.querySelector('.modal-mask').addEventListener('click', e => {
    if (e.target.classList.contains('modal-mask')) closeModal();
  });
  return root.querySelector('.modal-card');
}

export function closeModal() { document.getElementById('modal-root').innerHTML = ''; }
export function isModalOpen() { return !!document.querySelector('#modal-root .modal-card'); }

// ---------- Toast ----------
export function toast(msg) {
  const root = document.getElementById('toast-root');
  const div = document.createElement('div');
  div.className = 'toast';
  div.textContent = msg;
  root.appendChild(div);
  setTimeout(() => div.remove(), 2600);
}
