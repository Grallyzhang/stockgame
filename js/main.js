// 装配：模式路由（教学小镇 / 历史回放）、事件分发
import * as data from './data.js';
import * as state from './state.js';
import * as market from './market.js';
import * as town from './town.js';
import * as ui from './ui.js';
import * as lessons from './lessons.js';
import * as review from './review.js';
import * as replayUI from './replay-ui.js';
import * as liveUI from './live-ui.js';
import { isUnlocked, unlockProgress } from './live.js';
import { scenarioById } from './scenarios.js';

const st = state.load() || state.newGame();

if (!st.mode) showEntry();
else if (st.mode === 'replay') replayUI.mount(st);
else if (st.mode === 'live') liveUI.mount(st);
else bootTown();

// ---------- 入口屏：模式选择 ----------
function showEntry() {
  const townDone = st.tasks.done.length;
  const rpActive = st.replay.active;
  const rpName = rpActive ? scenarioById(rpActive.scenarioId).name : '';
  const rpCount = Object.values(st.replay.history).reduce((s, h) => s + h.length, 0);
  const liveOk = isUnlocked(st);
  const liveProg = unlockProgress(st);
  const liveState = st.live
    ? `进行中：${st.live.reports.length} 份复盘报告`
    : '已解锁 · 未开始';
  const card = ui.showModal({
    title: '股市小镇 · 选择模式',
    bodyHTML: `
      <div class="mode-grid">
        <div class="mode-card" data-mode="town">
          <div class="mode-name">教学小镇</div>
          <div class="mode-desc">在虚构小镇里系统学习股票：六章二十八课，从「股票是什么」到基本面与风险。每课约 3—6 分钟，随时中断存档。</div>
          <div class="mode-prog">${townDone ? `进行中：已完成 ${townDone}/28 课，第 ${st.day} 天` : '未开始'}</div>
        </div>
        <div class="mode-card" data-mode="replay">
          <div class="mode-name">历史风格回放</div>
          <div class="mode-desc">用 A 股风格规则（T+1、涨跌停、停牌）回放 18 个虚构剧本，每日复盘 + 专家分析 + AI 问答，结束后与「买入持有」对照。</div>
          <div class="mode-prog">${rpActive ? `进行中：${rpName} 第 ${rpActive.day} 天` : rpCount ? `已完成 ${rpCount} 次回放` : '未开始'}</div>
        </div>
        <div class="mode-card ${liveOk ? '' : 'locked-mode'}" data-mode="live">
          <div class="mode-name">实时模拟${liveOk ? '' : ' · 锁'}</div>
          <div class="mode-desc">真实 A 股行情（快照，需启动本地行情服务）+ 10 万虚拟资金：盘中盯盘、模拟买卖、每日复盘。</div>
          <div class="mode-prog">${liveOk ? liveState : `未解锁：核心剧本完成 ${liveProg}/4`}</div>
        </div>
      </div>
      <p style="color:var(--muted);font-size:12px;margin-bottom:0">三种模式共用同一个本地存档，可随时通过右上角「切换模式」往返，进度互不影响。</p>`,
    buttons: [],
  });
  card.querySelectorAll('.mode-card').forEach(n =>
    n.addEventListener('click', () => {
      if (n.dataset.mode === 'live' && !isUnlocked(st)) {
        ui.toast(`完成 4 个核心历史剧本后解锁实时模拟（当前 ${unlockProgress(st)}/4）`);
        return;
      }
      st.mode = n.dataset.mode;
      state.save(st);
      location.reload();
    }));
}

// ---------- 教学模式（第一阶段） ----------
function bootTown() {
  const mkt = data.buildMarket(st.seed);

  const ctx = {
    st, market: mkt,
    ui: { tab: 'company', company: 'pinecone', trade: { symbol: 'pinecone', side: 'buy', kind: 'market', price: '', lots: 1 } },
    dispatch,
  };

  function render() {
    town.renderTown(document.getElementById('town'), st, mkt,
      id => dispatch('viewCompany', { id }),
      () => dispatch('tab', { tab: 'book' }),
      () => dispatch('openBoard'));
    ui.renderStats(ctx);
    ui.renderTabs(ctx);
    ui.renderPanel(ctx);
    ui.renderTaskCard(ctx, lessons.getTaskView(ctx));
    ui.renderTimeline(ctx);
    state.save(st);
  }

  function doNextDay() {
    if (ui.isModalOpen()) { ui.toast('先处理当前的事项'); return; }
    if (st.day >= data.TOTAL_DAYS) { ui.toast('第一阶段体验结束，可点「重新开始」再来一局'); stopAuto(); return; }
    market.advanceDay(st, mkt);
    const news = data.DAY_NEWS[st.day];
    if (news) { state.log(st, 'event', news); ui.toast(news); }
    lessons.onAction(ctx, 'nextDay');
  }

  let autoTimer = null;
  function stopAuto() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    document.getElementById('btn-auto').textContent = '自动播放';
  }
  function toggleAuto() {
    if (autoTimer) { stopAuto(); return; }
    document.getElementById('btn-auto').textContent = '暂停';
    autoTimer = setInterval(() => {
      if (ui.isModalOpen()) return;
      dispatch('nextDay');
    }, 1800);
  }

  function dispatch(type, payload = {}) {
    switch (type) {
      case 'viewCompany':
        ctx.ui.tab = 'company'; ctx.ui.company = payload.id;
        lessons.onAction(ctx, 'viewCompany', payload);
        break;
      case 'selectCompany':
        ctx.ui.company = payload.id; ctx.ui.trade.symbol = payload.id;
        lessons.onAction(ctx, 'viewCompany', payload);
        break;
      case 'tab': {
        if (payload.tab === 'trade' && !st.unlocked.trade) { ui.toast('交易台尚未解锁：先完成当前任务'); break; }
        if (payload.tab === 'book' && !st.unlocked.book) { ui.toast('盘口显示屏尚未解锁：先完成当前任务'); break; }
        if (payload.tab === 'chart' && !st.unlocked.chart) { ui.toast('行情终端尚未解锁：先完成当前任务'); break; }
        ctx.ui.tab = payload.tab;
        break;
      }
      case 'placeOrder': {
        const r = market.placeOrder(st, mkt, payload);
        if (!r.ok) {
          ui.toast(r.msg);
          lessons.onAction(ctx, 'orderRejected', { ...payload, code: r.code, msg: r.msg });
        } else {
          ui.toast(r.order.status === 'filled' ? '已成交' : '委托已提交，等待成交');
          lessons.onAction(ctx, 'orderPlaced', { order: r.order });
        }
        break;
      }
      case 'cancelOrder':
        market.cancelOrder(st, payload.id);
        break;
      case 'nextDay':
        doNextDay();
        break;
      case 'openReview':
        review.showReview(ctx, () => { lessons.onAction(ctx, 'reviewShown'); render(); });
        break;
      case 'reset': {
        ui.showModal({
          title: '重新开始？',
          bodyHTML: '<p>将清空当前存档（现金、持仓、任务进度与回放记录），从零开始新的一局。</p>',
          buttons: [
            { label: '取消' },
            { label: '确认重开', danger: true, onClick: () => { state.clearSave(); location.reload(); } },
          ],
        });
        break;
      }
      case 'uiRefresh':
        break;
      default:
        lessons.onAction(ctx, type, payload);
    }
    lessons.maybeAuto(ctx);
    render();
  }

  // ---- 顶栏与底部 ----
  document.getElementById('btn-next').addEventListener('click', () => dispatch('nextDay'));
  document.getElementById('btn-auto').addEventListener('click', toggleAuto);
  document.getElementById('btn-review').addEventListener('click', () => dispatch('openReview'));
  document.getElementById('btn-reset').addEventListener('click', () => dispatch('reset'));
  document.getElementById('btn-mode').addEventListener('click', () => {
    ui.showModal({
      title: '切换模式？',
      bodyHTML: '<p>教学小镇的进度会保留，随时可以切回来。</p>',
      buttons: [
        { label: '取消' },
        { label: '去模式选择', primary: true, onClick: () => { st.mode = null; state.save(st); location.reload(); } },
      ],
    });
  });
  document.getElementById('timeline-toggle').addEventListener('click', () =>
    document.getElementById('timeline-wrap').classList.toggle('open'));

  // ---- 首次进入：欢迎引导；旧存档升级提示 ----
  if (st.notice) {
    ui.showModal({
      title: '教学大纲已升级',
      bodyHTML: `<p>${st.notice}</p>`,
      buttons: [{ label: '开始新课程', primary: true }],
    });
    delete st.notice;
  } else if (st.log.length === 1 && st.day === 1) {
    ui.showModal({
      title: '欢迎来到股市小镇',
      bodyHTML: `
        <p>这是一个<b>虚构的股票学习市场</b>：所有公司、事件和价格都是教学模拟，不涉及真实资金。</p>
        <p>你将从一间小研究室开始，用 <b>六章二十八课</b> 系统认识股票：从「股票是什么」，到委托、盘口、T+1 与涨跌停，再到 K 线形态、量价指标、估值与风险心理。</p>
        <p>左下角是你的<b>当前任务</b>，跟着它走就可以。</p>`,
      buttons: [{ label: '开始第 1 课', primary: true, onClick: () => dispatch('welcomeDone') }],
    });
  }

  window.__game = ctx; // 调试/自动化测试钩子

  render();
}
