// 回放模式界面：场景（K线+公告）、交易面板、公告栏、每日复盘、AI 问答、结算对照页
import * as ui from './ui.js';
import * as replay from './replay.js';
import * as state from './state.js';
import * as debrief from './debrief.js';
import * as ai from './ai.js';
import { SCENARIOS, scenarioById } from './scenarios.js';
import { fmtMoney, changeHTML, pnlHTML, round2 } from './util.js';

// 转义用户/AI 文本，避免注入
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- 入口 ----------
export function mount(st) {
  const ctx = { st, rui: { tab: 'trade', side: 'buy', lots: 1, debriefDay: 0, reviewUnread: false, aiBusy: false, aiDraft: '' }, dispatch: (t, p) => rDispatch(ctx, t, p) };
  if (st.replay.active) attachRun(ctx, st.replay.active);
  wireTopbar(ctx);
  if (st.replay.active) renderReplay(ctx);
  else showPicker(ctx);
  window.__replay = ctx; // 调试/自动化测试钩子
}

function attachRun(ctx, run) {
  ctx.run = run;
  ctx.sc = scenarioById(run.scenarioId);
  ctx.bars = ctx.sc.buildBars(ctx.sc.seed);
  // 旧存档兼容：补齐新增字段
  run.days ||= [];
  run.aiChat ||= [];
  ctx.rui.debriefDay = run.day;
}

// ---------- 顶栏 ----------
function wireTopbar(ctx) {
  const next = document.getElementById('btn-next');
  document.getElementById('btn-auto').style.display = 'none';
  document.getElementById('btn-review').style.display = 'none';
  document.getElementById('btn-reset').style.display = 'none';
  document.getElementById('btn-mode').addEventListener('click', () => ctx.dispatch('r-exit'));
  document.getElementById('timeline-toggle').addEventListener('click', () =>
    document.getElementById('timeline-wrap').classList.toggle('open'));
  next.addEventListener('click', () => {
    if (!ctx.run) return;
    if (ctx.run.day >= ctx.sc.days) ctx.dispatch('r-finish');
    else ctx.dispatch('r-next');
  });
}

function renderStats(ctx) {
  const { run, sc, bars } = ctx;
  const total = replay.equityAt(run, bars, sc.basePrice);
  const posVal = round2(total - run.cash);
  const ret = (total - replay.REPLAY_CASH) / replay.REPLAY_CASH;
  document.getElementById('stats').innerHTML = `
    <span class="stat"><span class="lbl">第</span><b>${run.day}</b><span class="lbl">/${sc.days} 个交易日</span></span>
    <span class="stat"><span class="lbl">现金</span><b>${fmtMoney(run.cash)}</b></span>
    <span class="stat"><span class="lbl">持仓市值</span><b>${fmtMoney(posVal)}</b></span>
    <span class="stat"><span class="lbl">总资产</span><b>${fmtMoney(total)}</b></span>
    <span class="stat"><span class="lbl">收益率</span><b>${changeHTML(ret)}</b></span>`;
  document.getElementById('btn-next').textContent = run.day >= sc.days ? '结束回放 · 查看结算' : '下一交易日';
}

// ---------- 左侧场景：K线 + 公告提示 ----------
function renderScene(ctx) {
  const { run, sc, bars } = ctx;
  const bar = replay.barAt(bars, run.day);
  const visible = bars.slice(0, run.day);
  const pct = replay.dayPct(bars, run.day, sc.basePrice);
  const status = bar.suspended ? '<span class="chg flat">● 今日停牌</span>' : changeHTML(pct);
  document.getElementById('town').innerHTML = `
    <div class="rp-wrap">
      <div class="rp-head">
        <div><span class="rp-name">${sc.name}</span><span class="rp-ind">${sc.industry} · 虚构剧本</span></div>
        <div class="rp-day">第 ${run.day} 个交易日 ${status}</div>
      </div>
      <div class="chart-wrap rp-chart">${ui.candleSVG(visible)}</div>
      <div class="rp-note">只显示已发生的行情，未来不可见 · 灰色虚线 = 停牌日 · 价格为名义成交价（除息日会下调）</div>
    </div>`;
}

// ---------- 任务卡：剧本目标 ----------
function renderTaskCard(ctx) {
  const { run, sc } = ctx;
  const unread = sc.events.filter((e, i) => e.day <= run.day && !run.readAnn.includes(i)).length;
  const isLast = run.day >= sc.days;
  ui.renderTaskCard(ctx, {
    title: `剧本目标：${sc.teaching}`,
    hint: `逐日观察行情与公告，决定是否买卖。目标不是猜对涨跌，而是完整经历并复盘。共 ${sc.days} 个交易日。`,
    buttons: [
      { label: unread ? `查看公告（${unread} 条未读）` : '公告栏', primary: unread > 0, onClick: () => ctx.dispatch('r-tab', { tab: 'ann' }) },
      ...(isLast ? [{ label: '结束回放并结算', primary: true, onClick: () => ctx.dispatch('r-finish') }] : []),
    ],
  });
}

// ---------- 右侧 Tab ----------
const RTABS = [
  { id: 'trade', name: '交易' },
  { id: 'ann', name: '公告' },
  { id: 'debrief', name: '复盘' },
  { id: 'ai', name: 'AI 问答' },
  { id: 'info', name: '说明' },
];

function renderTabs(ctx) {
  const { run, sc, rui } = ctx;
  const unread = run ? sc.events.filter((e, i) => e.day <= run.day && !run.readAnn.includes(i)).length : 0;
  document.getElementById('tabs').innerHTML = RTABS.map(t =>
    `<button class="tab ${rui.tab === t.id ? 'active' : ''}" data-tab="${t.id}">${t.name}${t.id === 'ann' && unread ? ` ·${unread}` : ''}${t.id === 'debrief' && rui.reviewUnread ? ' ·新' : ''}</button>`
  ).join('');
  document.querySelectorAll('#tabs .tab').forEach(b =>
    b.addEventListener('click', () => ctx.dispatch('r-tab', { tab: b.dataset.tab })));
}

// ---------- 面板 ----------
function renderPanel(ctx) {
  const el = document.getElementById('panel');
  const tab = ctx.rui.tab;
  if (tab === 'trade') el.innerHTML = tradeHTML(ctx);
  else if (tab === 'ann') el.innerHTML = annHTML(ctx);
  else if (tab === 'debrief') el.innerHTML = debriefHTML(ctx);
  else if (tab === 'ai') el.innerHTML = aiHTML(ctx);
  else el.innerHTML = infoHTML(ctx);
  bindPanel(ctx, el, tab);
  if (tab === 'ai') {
    const box = el.querySelector('#ai-chat');
    if (box) box.scrollTop = box.scrollHeight;
  }
}

function statusLine(ctx) {
  const { run, sc, bars } = ctx;
  const bar = replay.barAt(bars, run.day);
  const pct = replay.dayPct(bars, run.day, sc.basePrice);
  if (bar.suspended) return '<span class="chg flat">停牌中，不可交易</span>';
  if (replay.isLimitUpDay(bars, run.day, sc)) return `<span class="chg up">▲ 已涨停（${(pct * 100).toFixed(1)}%），不可买入</span>`;
  if (replay.isLimitDownDay(bars, run.day, sc)) return `<span class="chg down">▼ 已跌停（${(pct * 100).toFixed(1)}%），不可卖出</span>`;
  return '<span class="chg flat">正常交易</span>';
}

function tradeHTML(ctx) {
  const { run, sc, bars, rui } = ctx;
  const bar = replay.barAt(bars, run.day);
  const pct = replay.dayPct(bars, run.day, sc.basePrice);
  const up = replay.limitUp(bars, run.day, sc);
  const down = replay.limitDown(bars, run.day, sc);
  const amount = round2(bar.close * rui.lots * replay.LOT);
  const comm = replay.commission(amount);
  const stamp = replay.stampTax(amount);
  const posVal = round2(run.pos.shares * bar.close);
  const floatPnl = run.pos.shares ? round2((bar.close - run.pos.avgCost) * run.pos.shares) : 0;
  const boughtToday = run.pos.shares - run.pos.sellable;
  const maxBuyLots = Math.floor(run.cash / (bar.close * replay.LOT));

  const recent = run.trades.slice(-6).reverse().map(t => `
    <tr><td>第${t.day}天</td><td>${t.side === 'buy' ? '买入' : '卖出'}</td><td>${t.qty}</td>
      <td>${t.price.toFixed(2)}</td><td>${t.side === 'sell' ? pnlHTML(t.realized) : '—'}</td></tr>`).join('');

  return `
    <div class="kv"><span class="k">${sc.name} 现价</span><span class="v">${bar.close.toFixed(2)} 元 ${changeHTML(pct)}</span></div>
    <div class="kv"><span class="k">涨停价 / 跌停价</span><span class="v">${up.toFixed(2)} / ${down.toFixed(2)} 元</span></div>
    <div class="kv"><span class="k">今日状态</span><span class="v">${statusLine(ctx)}</span></div>
    <div class="kv"><span class="k">持仓</span><span class="v">${run.pos.shares} 股（可卖 ${run.pos.sellable} 股${boughtToday ? `，今日买入 ${boughtToday} 股` : ''}）</span></div>
    ${run.pos.shares ? `<div class="kv"><span class="k">成本 / 浮动盈亏</span><span class="v">${run.pos.avgCost.toFixed(2)} 元 · ${pnlHTML(floatPnl)}</span></div>` : ''}
    <div class="trade-row" style="margin-top:10px">
      <div class="seg" id="r-seg">
        <button data-side="buy" class="${rui.side === 'buy' ? 'active' : ''}">买入</button>
        <button data-side="sell" class="${rui.side === 'sell' ? 'active' : ''}">卖出</button>
      </div>
    </div>
    <div class="field"><label>数量</label>
      <div class="qty-ctl">
        <button id="r-minus">−</button>
        <input id="r-lots" type="number" min="1" step="1" value="${rui.lots}">
        <button id="r-plus">＋</button>
      </div>
      <span style="font-size:12px;color:var(--muted)">手</span></div>
    <div class="est">${rui.side === 'buy'
      ? `按收盘价 ${bar.close.toFixed(2)} 元成交<br>金额 ${fmtMoney(amount)} + 佣金 ${fmtMoney(comm)} ≈ <b>${fmtMoney(amount + comm)} 元</b><br>（可用现金 ${fmtMoney(run.cash)} 元，最多约 ${maxBuyLots} 手）`
      : `按收盘价 ${bar.close.toFixed(2)} 元成交<br>金额 ${fmtMoney(amount)} − 佣金 ${fmtMoney(comm)} − 印花税 ${fmtMoney(stamp)} ≈ <b>${fmtMoney(amount - comm - stamp)} 元</b><br>（可卖 ${run.pos.sellable} 股）`}</div>
    <button class="btn primary" id="r-place" style="width:100%">${rui.side === 'buy' ? '买入（按今日收盘价）' : '卖出（按今日收盘价）'}</button>
    <div class="sec-title">最近成交</div>
    ${recent ? `<table class="list"><tr><th>时间</th><th>方向</th><th>股数</th><th>价格</th><th>盈亏</th></tr>${recent}</table>` : '<div class="empty">还没有成交记录。</div>'}
    <div class="rule-note">本回放为<b>模拟 A 股规则 · 简化版</b>：T+1（当日买入次日可卖）；涨跌停 ±10%（ST 期 ±5%；涨停不可买、跌停不可卖）；停牌日不可交易；佣金 0.025% 最低 5 元，卖出另收印花税 0.05%；统一按收盘价成交（不模拟盘中排队）。公告在披露日盘后公开，停牌/除息/除权等安排以公告生效日为准。公司为虚构，行情为剧本。</div>`;
}

function annHTML(ctx) {
  const { run, sc } = ctx;
  const items = sc.events.map((e, i) => ({ ...e, idx: i })).filter(e => e.day <= run.day);
  if (!items.length) return '<div class="empty" style="padding:30px 10px;text-align:center">目前还没有公告或新闻。<br>随着交易日推进，盘后披露的信息会出现在这里。</div>';
  return items.slice().reverse().map(e => `
    <div class="ann-item ${run.readAnn.includes(e.idx) ? '' : 'unread'}" data-ann="${e.idx}">
      <div class="ann-head"><span class="ann-kind">${e.kind}</span><b>${e.title}</b>${run.readAnn.includes(e.idx) ? '' : '<span class="ann-dot"></span>'}</div>
      <div class="ann-day">第 ${e.day} 天 · 盘后披露</div>
    </div>`).join('') + '<div class="rule-note">公告在披露日盘后公开。真实市场中，信息获取的时间顺序本身就是一种优势——回放里请留意「你是什么时候才知道的」。</div>';
}

// ---------- 每日复盘 ----------
function debriefHTML(ctx) {
  const { run, sc, bars, rui } = ctx;
  const day = Math.max(1, Math.min(rui.debriefDay || run.day, run.day));
  const rv = debrief.dailyReview(sc, run, bars, day);
  const notes = debrief.expertNote(sc, bars, day);
  const pctTxt = `${rv.pct >= 0 ? '+' : ''}${(rv.pct * 100).toFixed(1)}%`;
  const status = rv.suspended ? '<span class="chg flat">● 停牌</span>'
    : rv.limitUp ? `<span class="chg up">▲ 涨停（${pctTxt}）</span>`
    : rv.limitDown ? `<span class="chg down">▼ 跌停（${pctTxt}）</span>`
    : '<span class="chg flat">● 正常交易</span>';

  const marketRows = rv.suspended
    ? '<div class="empty">当日停牌，无成交。</div>'
    : `<table class="list"><tr><th>开盘</th><th>最高</th><th>最低</th><th>收盘</th><th>涨跌幅</th><th>成交量</th></tr>
       <tr><td>${rv.bar.open.toFixed(2)}</td><td>${rv.bar.high.toFixed(2)}</td><td>${rv.bar.low.toFixed(2)}</td>
       <td>${rv.bar.close.toFixed(2)}</td><td>${changeHTML(rv.pct)}</td><td>${rv.volRatio ? rv.volRatio.toFixed(1) + ' 倍均量' : '—'}</td></tr></table>`;

  const tradesRows = rv.tradesToday.length
    ? rv.tradesToday.map(t => `<tr><td>${t.side === 'buy' ? '买入' : '卖出'}</td><td>${t.qty} 股</td><td>${t.price.toFixed(2)} 元</td><td>${t.side === 'sell' ? pnlHTML(t.realized) : '—'}</td></tr>`).join('')
    : '';
  const accountRows = rv.snap
    ? `<div class="kv"><span class="k">收盘总资产</span><span class="v">${fmtMoney(rv.snap.equity)} 元${rv.equityChg != null ? `（较上日 ${rv.equityChg >= 0 ? '+' : ''}${fmtMoney(rv.equityChg)}）` : ''}</span></div>
       <div class="kv"><span class="k">现金 / 持仓</span><span class="v">${fmtMoney(rv.snap.cash)} 元 · ${rv.snap.shares} 股${rv.snap.shares ? `（成本 ${rv.snap.avgCost.toFixed(2)} 元）` : ''}</span></div>`
    : '<div class="empty">该日账户快照缺失（旧存档）。</div>';

  const annRows = rv.anns.length
    ? rv.anns.map(e => `<div class="dv-ann">【${e.kind}】《${e.title}》</div>`).join('')
    : '<div class="empty">当日无公告披露。</div>';

  return `
    <div class="dv-nav">
      <button class="btn small" id="dv-prev" ${day <= 1 ? 'disabled' : ''}>◀ 前一天</button>
      <span class="dv-day">第 <b>${day}</b> / ${run.day} 天复盘</span>
      <button class="btn small" id="dv-next" ${day >= run.day ? 'disabled' : ''}>后一天 ▶</button>
    </div>
    <div class="sec-title">行情回顾 ${status}</div>
    ${marketRows}
    ${rv.isDividendDay ? '<div class="dv-ann">除息日：红利到账，股价等额下调。</div>' : ''}
    ${rv.isSplitDay ? `<div class="dv-ann">除权日（${sc.split.label}）：股数 ×${sc.split.ratio}，股价 ÷${sc.split.ratio}。</div>` : ''}
    <div class="sec-title">我的操作与账户</div>
    ${tradesRows ? `<table class="list"><tr><th>方向</th><th>数量</th><th>成交价</th><th>盈亏</th></tr>${tradesRows}</table>` : '<div class="empty">当日无交易。观望也是决策。</div>'}
    ${accountRows}
    <div class="sec-title">当日信息</div>
    ${annRows}
    <div class="sec-title">专家复盘分析</div>
    <div class="dv-notes">${notes.map(n => `<p>· ${n}</p>`).join('')}</div>
    <button class="btn" id="dv-ask" style="width:100%;margin-top:8px">就这一天，问问 AI</button>
    <div class="rule-note">复盘只使用第 ${day} 天及以前的信息。评价决策看「当时知道什么」，而不是事后涨跌——避免后视镜偏差。</div>`;
}

// ---------- AI 问答 ----------
function aiHTML(ctx) {
  const { run, rui } = ctx;
  const cfg = ai.loadConfig();

  if (!cfg.apiKey) {
    return `
      <div class="ai-note">AI 教学助手由 DeepSeek 提供。它只能看到<b>截至第 ${run.day} 天</b>的行情与公告，不会剧透未来走势。</div>
      <div class="sec-title">首次使用：填入 API 密钥</div>
      <div class="field"><label>API 密钥</label><input id="ai-key" type="password" placeholder="sk-..." autocomplete="off"></div>
      <button class="btn primary" id="ai-save-key" style="width:100%">保存密钥并启用</button>
      <div class="rule-note">
        密钥仅保存在<b>你自己的浏览器</b> localStorage 中，只发往 DeepSeek 官方接口（api.deepseek.com），不经过任何其他服务器。<br>
        获取方式：登录 DeepSeek 开放平台（platform.deepseek.com）→「API keys」创建密钥。调用会产生少量 token 费用，由你的 DeepSeek 账户承担。<br>
        未配置密钥时，「复盘」页的每日专家复盘仍可正常使用（规则引擎生成，不依赖网络）。
      </div>`;
  }

  const msgs = (run.aiChat || []).map(m => `
    <div class="ai-msg ${m.role === 'user' ? 'me' : 'bot'}${m.error ? ' err' : ''}">${esc(m.content).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>')}</div>`).join('');
  return `
    <div class="ai-note">AI 只能看到截至第 ${run.day} 天的可见信息。它是教学解释助手：<b>不推荐买卖、不预测涨跌</b>。</div>
    <div class="ai-chat" id="ai-chat">
      ${msgs || '<div class="empty" style="padding:18px 6px">试试这样问：<br>· 「今天这根K线说明什么？」<br>· 「涨停为什么买不进？」<br>· 「我现在该关注什么风险？」</div>'}
      ${rui.aiBusy ? '<div class="ai-msg bot typing">正在思考…</div>' : ''}
    </div>
    <div class="ai-input-row">
      <input id="ai-q" type="text" maxlength="500" placeholder="输入你的问题…" value="${esc(rui.aiDraft)}" ${rui.aiBusy ? 'disabled' : ''}>
      <button class="btn primary" id="ai-send" ${rui.aiBusy ? 'disabled' : ''}>发送</button>
    </div>
    <div class="ai-foot">由 DeepSeek（${cfg.model}）生成，仅供学习参考，不构成投资建议 · ${ai.usingProxy() ? '站点代理免费提供' : '使用你的密钥'} · <a href="javascript:void 0" id="ai-clear-key">${ai.usingProxy() ? '换用自己的密钥' : '更换密钥'}</a></div>`;
}

function infoHTML(ctx) {
  const { sc } = ctx;
  return `
    <div class="profile">
      <h3>${sc.name}</h3>
      <div class="blurb">${sc.blurb}</div>
      <div class="kv"><span class="k">教学重点</span><span class="v">${sc.teaching}</span></div>
      <div class="kv"><span class="k">时长</span><span class="v">${sc.days} 个交易日</span></div>
      <div class="kv"><span class="k">初始资金</span><span class="v">${fmtMoney(replay.REPLAY_CASH)} 元</span></div>
      <div class="news-box"><div class="t">这个剧本在练什么</div>${sc.lesson}</div>
      <div class="rule-note">剧本中的公司与行情均为虚构，仅风格参考真实市场历史，不构成对任何真实公司的评价。结算后揭晓风格原型。</div>
    </div>`;
}

function bindPanel(ctx, el, tab) {
  const { rui, run } = ctx;
  if (tab === 'trade') {
    el.querySelectorAll('#r-seg button').forEach(b =>
      b.addEventListener('click', () => ctx.dispatch('r-side', { side: b.dataset.side })));
    el.querySelector('#r-minus').addEventListener('click', () => ctx.dispatch('r-lots', { lots: rui.lots - 1 }));
    el.querySelector('#r-plus').addEventListener('click', () => ctx.dispatch('r-lots', { lots: rui.lots + 1 }));
    el.querySelector('#r-lots').addEventListener('change', e =>
      ctx.dispatch('r-lots', { lots: Math.floor(Number(e.target.value) || 1) }));
    el.querySelector('#r-place').addEventListener('click', () =>
      ctx.dispatch(rui.side === 'buy' ? 'r-buy' : 'r-sell', { lots: rui.lots }));
  }
  if (tab === 'ann') {
    el.querySelectorAll('[data-ann]').forEach(n =>
      n.addEventListener('click', () => ctx.dispatch('r-openAnn', { idx: Number(n.dataset.ann) })));
  }
  if (tab === 'debrief') {
    el.querySelector('#dv-prev')?.addEventListener('click', () => ctx.dispatch('r-debriefNav', { delta: -1 }));
    el.querySelector('#dv-next')?.addEventListener('click', () => ctx.dispatch('r-debriefNav', { delta: +1 }));
    el.querySelector('#dv-ask')?.addEventListener('click', () => ctx.dispatch('r-askAboutDay', { day: Math.min(rui.debriefDay || run.day, run.day) }));
  }
  if (tab === 'ai') {
    el.querySelector('#ai-save-key')?.addEventListener('click', () => {
      const key = (el.querySelector('#ai-key')?.value || '').trim();
      ctx.dispatch('r-aiSaveKey', { key });
    });
    el.querySelector('#ai-clear-key')?.addEventListener('click', () => ctx.dispatch('r-aiClearKey'));
    el.querySelector('#ai-send')?.addEventListener('click', () =>
      ctx.dispatch('r-aiSend', { q: el.querySelector('#ai-q')?.value || '' }));
    el.querySelector('#ai-q')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') ctx.dispatch('r-aiSend', { q: e.target.value });
    });
  }
}

// ---------- 时间线 ----------
function renderTimeline(ctx) {
  const dots = { event: 'dot-event', fill: 'dot-fill', info: 'dot-info' };
  document.getElementById('timeline').innerHTML = ctx.run.log.slice(-40).reverse().map(l =>
    `<div class="log"><span class="dot ${dots[l.type] || 'dot-info'}"></span><b>第 ${l.day} 天</b> ${l.text}</div>`
  ).join('');
}

// ---------- 整体渲染 ----------
function renderReplay(ctx) {
  renderStats(ctx);
  renderScene(ctx);
  renderTaskCard(ctx);
  renderTabs(ctx);
  renderPanel(ctx);
  renderTimeline(ctx);
  state.save(ctx.st);
}

// ---------- 公告弹窗 ----------
function showAnnModal(ctx, idx, all = null) {
  const { run, sc } = ctx;
  const list = all || [sc.events[idx]];
  for (const e of list) {
    const i = sc.events.indexOf(e);
    if (!run.readAnn.includes(i)) run.readAnn.push(i);
  }
  ui.showModal({
    title: `第 ${run.day} 天 · 盘后披露`,
    bodyHTML: list.map(e => `
      <p><span class="ann-kind">${e.kind}</span> <b>${e.title}</b></p>
      <p>${e.body}</p>`).join('') +
      '<p style="color:var(--muted);font-size:12px">公告在盘后披露；停牌、除息等安排以公告中注明的生效日为准。</p>',
    buttons: [{ label: '知道了', primary: true }],
  });
  state.save(ctx.st);
}

// ---------- 剧本选择 ----------
function showPicker(ctx) {
  const hist = ctx.st.replay.history;
  const cards = SCENARIOS.map((sc, i) => {
    const h = hist[sc.id] || [];
    const last = h[0];
    const best = h.length ? Math.max(...h.map(x => x.ret)) : null;
    return `
      <div class="sc-card" data-sc="${sc.id}">
        <div class="sc-name">${sc.name}</div>
        <div class="sc-ind">${sc.industry} · ${sc.days} 个交易日</div>
        <div class="sc-teach">教学重点：${sc.teaching}</div>
        <div class="sc-hist">${last
          ? `上次 ${(last.ret * 100).toFixed(1)}%（基准 ${(last.bench * 100).toFixed(1)}%） · 最好 ${(best * 100).toFixed(1)}% · 已玩 ${h.length} 次`
          : '尚未玩过'}</div>
      </div>`;
  }).join('');
  const card = ui.showModal({
    title: '历史风格回放 · 选择剧本',
    bodyHTML: `
      <p>共 <b>${SCENARIOS.length} 个剧本</b>：长牛、慢熊、暴雷、妖股、周期、分红、高送转、ST 摘帽、新股、黑天鹅……公司与行情均为<b>虚构</b>，仅风格参考真实市场历史（不只有赚钱的样本）。</p>
      <p>规则：T+1 · 涨跌停（ST ±5%，其余 ±10%）· 停牌 · 除息除权 · 真实费用结构。每个交易日附带<b>每日复盘 + 专家分析</b>，可用 AI 问答深入讨论。同一剧本行情固定，可重玩对照。</p>
      <div class="sc-grid sc-grid-many">${cards}</div>`,
    buttons: [{ label: '返回模式选择' }],
  });
  card.querySelector('.modal-btns .btn').addEventListener('click', () => { ctx.st.mode = null; state.save(ctx.st); location.reload(); });
  card.querySelectorAll('.sc-card').forEach(n =>
    n.addEventListener('click', () => ctx.dispatch('r-start', { scenarioId: n.dataset.sc })));
  card.style.maxWidth = '780px'; // 18 个剧本需要更宽的选择弹窗
}

// ---------- 结算对照页 ----------
function equityChart(curve, bench) {
  const W = 620, H = 230, padL = 46, padR = 12, padT = 12, padB = 20;
  const n = curve.length;
  const base0 = curve[0], bench0 = bench[0];
  const a = curve.map(v => v / base0 * 100);
  const b = bench.slice(0, n).map(v => v / bench0 * 100);
  const lo = Math.min(...a, ...b), hi = Math.max(...a, ...b);
  const y = v => padT + (hi - v) / ((hi - lo) || 1) * (H - padT - padB);
  const x = i => padL + i * (W - padL - padR) / Math.max(1, n - 1);
  const pts = arr => arr.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  let s = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block">`;
  for (let i = 0; i <= 2; i++) {
    const v = lo + (hi - lo) * i / 2, yy = y(v);
    s += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="#eee6d2"/>`;
    s += `<text x="${padL - 4}" y="${yy + 4}" font-size="10" fill="#8a8474" text-anchor="end">${v.toFixed(0)}</text>`;
  }
  s += `<polyline points="${pts(b)}" fill="none" stroke="#b7b0a0" stroke-width="2"/>`;
  s += `<polyline points="${pts(a)}" fill="none" stroke="#4a7fb5" stroke-width="2.4"/>`;
  s += `<text x="${W - padR}" y="${padT + 10}" font-size="11" fill="#4a7fb5" text-anchor="end">— 我的操作</text>`;
  s += `<text x="${W - padR}" y="${padT + 24}" font-size="11" fill="#b7b0a0" text-anchor="end">— 买入持有</text>`;
  s += `<text x="${padL}" y="${H - 4}" font-size="10" fill="#8a8474">第1天</text>`;
  s += `<text x="${W - padR}" y="${H - 4}" font-size="10" fill="#8a8474" text-anchor="end">第${n}天</text>`;
  return s + '</svg>';
}

function settlementModal(ctx, r) {
  const { run, sc, st } = ctx;
  const hist = st.replay.history[sc.id] || [];
  const last = hist[1]; // [0] 是本次
  const cmp = r.totalReturn - r.benchReturn;
  const tradeRows = run.trades.map(t => `
    <tr><td>第${t.day}天</td><td>${t.side === 'buy' ? '买入' : '卖出'}</td><td>${t.qty}</td>
      <td>${t.price.toFixed(2)}</td><td>${changeHTML(t.pct)}</td>
      <td>${t.side === 'sell' ? pnlHTML(t.realized) : '—'}</td></tr>`).join('');

  const obs = [];
  if (r.chaseBuys) obs.push(`有 ${r.chaseBuys} 笔买入发生在单日涨幅 ≥3% 之后（粗略的「追涨」信号，供参考）`);
  if (r.panicSells) obs.push(`有 ${r.panicSells} 笔卖出发生在单日跌幅 ≥3% 之中（粗略的「杀跌」信号，供参考）`);
  if (r.annRead < r.annTotal) obs.push(`有 ${r.annTotal - r.annRead} 条公告没有打开阅读——真实市场里，忽略公告往往是代价最高的省略`);
  if (r.trades === 0) obs.push('全程没有交易：观望也是一种决策，关键是它是否有理由');
  if (!obs.length) obs.push('交易节奏平稳，公告全部阅读——过程指标良好');

  // 全程关键日的专家复盘摘要（事件日 / 涨跌停 / 异动日）
  const nd = debrief.notableDays(sc, ctx.bars);
  const debriefBlock = `
    <details class="settle-debrief">
      <summary>全程关键日专家复盘（${nd.length} 天，点击展开）</summary>
      ${nd.map(d => `<div class="nd-item"><b>第 ${d.day} 天</b>${d.notes.slice(0, 2).map(n => `<p>· ${n}</p>`).join('')}</div>`).join('')}
    </details>`;

  ui.showModal({
    title: `回放结算 · ${sc.name}`,
    bodyHTML: `
      <div class="news-box"><div class="t">揭晓：这个剧本像谁</div>${sc.archetype}<br>${sc.lesson}</div>
      <div class="settle-grid">
        <div class="settle-item"><div class="k">我的收益率</div><div class="v">${changeHTML(r.totalReturn)}</div></div>
        <div class="settle-item"><div class="k">买入持有基准</div><div class="v">${changeHTML(r.benchReturn)}</div></div>
        <div class="settle-item"><div class="k">超额</div><div class="v">${changeHTML(cmp)}</div></div>
        <div class="settle-item"><div class="k">最大回撤</div><div class="v">${(r.maxDD * 100).toFixed(1)}%</div></div>
        <div class="settle-item"><div class="k">交易次数</div><div class="v">${r.trades}（买 ${r.buys} / 卖 ${r.sells}）</div></div>
        <div class="settle-item"><div class="k">分红到账</div><div class="v">${fmtMoney(r.dividends)} 元</div></div>
        ${last ? `<div class="settle-item"><div class="k">上次收益率</div><div class="v">${changeHTML(last.ret)}</div></div>` : ''}
      </div>
      <div class="chart-wrap" style="margin-top:10px">${equityChart(r.curve, r.benchCurve)}</div>
      <div class="sec-title">过程指标（评价不看单次盈亏）</div>
      <ul class="settle-obs">${obs.map(o => `<li>${o}</li>`).join('')}</ul>
      <div class="sec-title">决策回放（每笔成交与当日涨跌幅）</div>
      ${tradeRows ? `<table class="list"><tr><th>时间</th><th>方向</th><th>股数</th><th>价格</th><th>当日涨跌</th><th>盈亏</th></tr>${tradeRows}</table>` : '<div class="empty">本次没有交易。</div>'}
      ${debriefBlock}
      <div class="rule-note">同一剧本行情固定，可重玩对照。结算假设：全部按收盘价成交；基准为第 1 天收盘全仓买入并持有（含费用${sc.dividend ? '与分红' : ''}${sc.split ? '与送转' : ''}）。收益高低不构成对决策好坏的判定。</div>`,
    buttons: [
      { label: '再玩一次', onClick: () => ctx.dispatch('r-again') },
      { label: '选择其他剧本', primary: true, onClick: () => ctx.dispatch('r-pick') },
      { label: '返回模式选择', onClick: () => { st.mode = null; state.save(st); location.reload(); } },
    ],
  });
}

// ---------- 动作分发 ----------
function rDispatch(ctx, type, payload = {}) {
  const { run, sc, bars, rui, st } = ctx;
  switch (type) {
    case 'r-tab':
      rui.tab = payload.tab;
      if (payload.tab === 'debrief') { rui.reviewUnread = false; if (!rui.debriefDay) rui.debriefDay = run.day; }
      break;
    case 'r-side': rui.side = payload.side; break;
    case 'r-lots': rui.lots = Math.max(1, payload.lots); break;
    case 'r-debriefNav':
      rui.debriefDay = Math.max(1, Math.min((rui.debriefDay || run.day) + payload.delta, run.day));
      break;
    case 'r-askAboutDay':
      rui.tab = 'ai';
      rui.aiDraft = `请帮我复盘第 ${payload.day} 天：这天的行情和公告说明了什么？我的决策该关注什么？`;
      break;
    case 'r-aiSaveKey': {
      if (!payload.key) { ui.toast('请输入 API 密钥'); return; }
      ai.saveConfig({ apiKey: payload.key, model: ai.DEFAULT_MODEL });
      ui.toast('密钥已保存在本机浏览器');
      break;
    }
    case 'r-aiClearKey':
      ai.saveConfig({ apiKey: '', model: ai.DEFAULT_MODEL });
      ui.toast('已清除本机保存的密钥');
      break;
    case 'r-aiSend': {
      const q = (payload.q || '').trim();
      if (!q) { ui.toast('先输入一个问题'); return; }
      if (rui.aiBusy) { ui.toast('上一条回答中，请稍候'); return; }
      run.aiChat.push({ role: 'user', content: q });
      rui.aiDraft = '';
      rui.aiBusy = true;
      rui.tab = 'ai';
      renderReplay(ctx);
      const cfg = ai.loadConfig();
      const contextText = ai.buildContext({ sc, bars, run, day: run.day });
      ai.ask(cfg, contextText, q)
        .then(text => run.aiChat.push({ role: 'assistant', content: text }))
        .catch(err => run.aiChat.push({ role: 'assistant', content: `⚠ ${err.message}`, error: true }))
        .finally(() => {
          rui.aiBusy = false;
          run.aiChat = run.aiChat.slice(-20); // 只保留最近 20 条
          renderReplay(ctx);
        });
      return; // 异步流程自行渲染
    }
    case 'r-buy': case 'r-sell': {
      const r = type === 'r-buy' ? replay.buy(run, bars, payload.lots) : replay.sell(run, bars, payload.lots);
      ui.toast(r.ok ? (type === 'r-buy' ? '已按收盘价买入' : '已按收盘价卖出') : r.msg);
      break;
    }
    case 'r-next': {
      if (ui.isModalOpen()) { ui.toast('先处理当前的事项'); return; }
      const res = replay.advance(run, bars);
      if (res.done) { ui.toast('已是最后一个交易日，请结算'); break; }
      rui.debriefDay = run.day;
      rui.reviewUnread = true;
      if (res.halted) ui.toast(`第 ${run.day} 天：停牌，无法交易`);
      if (res.anns.length) showAnnModal(ctx, null, res.anns);
      break;
    }
    case 'r-openAnn': showAnnModal(ctx, payload.idx); break;
    case 'r-finish': {
      if (ui.isModalOpen()) { ui.toast('先处理当前的事项'); return; }
      const r = replay.settle(run, bars);
      const hist = st.replay.history[run.scenarioId] || [];
      hist.unshift({ at: Date.now(), ret: round2(r.totalReturn * 10000) / 10000, maxDD: round2(r.maxDD * 10000) / 10000, trades: r.trades, bench: round2(r.benchReturn * 10000) / 10000 });
      st.replay.history[run.scenarioId] = hist.slice(0, 5);
      st.replay.active = null;
      state.save(st);
      settlementModal(ctx, r);
      return; // 结算弹窗接管，不再渲染主界面
    }
    case 'r-again': {
      const nr = replay.newRun(sc.id);
      st.replay.active = nr;
      attachRun(ctx, nr);
      rui.tab = 'trade'; rui.side = 'buy'; rui.lots = 1;
      break;
    }
    case 'r-pick': showPicker(ctx); return;
    case 'r-start': {
      const nr = replay.newRun(payload.scenarioId);
      st.replay.active = nr;
      attachRun(ctx, nr);
      ui.closeModal();
      ui.toast(`回放开始：${ctx.sc.name}（${ctx.sc.days} 个交易日）`);
      break;
    }
    case 'r-exit': {
      ui.showModal({
        title: '返回模式选择？',
        bodyHTML: '<p>当前回放进度会保存在本地，下次可继续。</p>',
        buttons: [
          { label: '取消' },
          { label: '确认', primary: true, onClick: () => { st.mode = null; state.save(st); location.reload(); } },
        ],
      });
      return;
    }
    default: return;
  }
  renderReplay(ctx);
}
