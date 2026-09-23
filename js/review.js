// 复盘：回放「当时可见信息 → 你的操作 → 结果」，评价基于信息使用，不按盈亏判定
import { INITIAL_CASH, companyById, INVESTIGATIONS, ACHIEVEMENTS, TOTAL_DAYS } from './data.js';
import { totalAssets } from './market.js';
import { fmtMoney, pnlHTML, round2 } from './util.js';
import { showModal } from './ui.js';

function evaluate(st) {
  const f = st.flags;
  const inv = f.investigated || {};
  const comments = [];

  if (f.eventStarted) {
    if (!inv.cost && !inv.source) {
      comments.push('传闻事件：两次调查没有触及「成本数据」和「传闻来源」——这两个方向恰好藏着关键信息。下次优先质疑传闻、检查成本。');
    } else if (inv.cost) {
      comments.push('传闻事件：你查到了成本上升这条关键信息——销量大涨的同时，每盒的利润其实在变薄。');
    }
    if (inv.source) comments.push('传闻事件：你追查了传闻来源，发现它没有官方佐证——区分「事实」和「传闻」是研究的基本功。');

    if (f.decision === 'buy') {
      if (f.decisionReason === 'rumor') comments.push('仅凭传闻买入风险很高：它没有数据佐证。这次无论盈亏，依据都不够扎实。');
      else if (f.decisionReason === 'sales' && !inv.cost) comments.push('销量是事实，但你没查成本——这次利润恰恰是被成本吃掉的。证据不全时下注，属于运气决策。');
      else if (f.decisionReason === 'cost') comments.push('注意到了成本风险仍选择买入——买入不是错，关键是仓位可控、理由写清。');
      else comments.push('你记录了自己的买入依据。有明确理由的决策，输赢都能学到东西。');
    } else if (f.decision === 'observe') {
      if (f.decisionReason === 'cost') comments.push('你识别了成本压力并选择观望——这是基于证据的判断，不是「错过」。');
      else if (f.decisionReason === 'wait') comments.push('承认信息不足、选择等待，也是合理决策。现金也是一种持仓。');
      else if (f.decisionReason === 'rumor') comments.push('对传闻保持怀疑是对的；如果再查一下成本，依据会更完整。');
      else comments.push('观望是合理选择；如果查了成本数据，依据会更充分。');
    }
  }

  if (f.avgChoice === 'average') {
    comments.push(f.avgReason === 'faith'
      ? '回撤抉择：你补仓的依据是「重新评估后仍看好」——这成立；但如果理由是「摊低成本好回本」，那就是把更多钱押给同一个正在变差的判断。'
      : '回撤抉择：「摊低成本」只是让数字好看，本质是把更多钱押给同一个正在变差的判断。回本执念不改变公司基本面。');
  } else if (f.avgChoice === 'hold') {
    comments.push('回撤抉择：你选择暂不补仓、先重新评估——面对浮亏不机械加码，是纪律的体现。');
  }

  if (f.fomoChoice === 'chase') {
    comments.push(f.fomoReason === 'small'
      ? 'FOMO 抉择：追买但限定了小仓位——知道自己在冒险、并给风险设了上限，这比「全仓冲进去」成熟得多。'
      : 'FOMO 抉择：追买的理由是「大家都在买 / 上次涨过」——这正是传闻脉冲最危险的两种依据。第 51 天松果的传闻已经演示过一次。');
  } else if (f.fomoChoice === 'wait') {
    comments.push('FOMO 抉择：面对传闻脉冲你选择先查证——「错过」一段涨幅，好过「接盘」一个传闻。');
  }

  const p = st.stats?.predictions;
  if (p && (p.right + p.wrong + p.half) > 0) {
    comments.push(`预测命中率：3 次信号预测 ${p.right} 对 / ${p.wrong} 错 / ${p.half} 半对——信号有统计倾向，但不保证未来。`);
  }

  if (!comments.length) comments.push('继续推进课程，这里会汇总你每个关键决策的依据与点评。');
  return comments;
}

// ---------- 我的日志（研究日志：动作 + 理由） ----------
function journalHTML(st) {
  const items = st.log.filter(l => l.type === 'decision');
  if (!items.length) return '<div class="empty">还没有决策记录。课程中的调查与抉择会自动记在这里。</div>';
  return items.map(l => `<div class="log"><b>第 ${l.day} 天</b> ${l.text}</div>`).join('');
}

export function journalMarkdown(st) {
  const names = id => ACHIEVEMENTS.find(a => a.id === id)?.name || id;
  const lines = [
    '# 我的投资日志（股市小镇 · 第一阶段）', '',
    `- 导出时间：第 ${st.day} 天 / 共 ${TOTAL_DAYS} 天`,
    `- 已完成课程：${st.tasks.done.length} / 28`,
    `- 已获得成就：${st.achievements.length ? st.achievements.map(names).join('、') : '无'}`,
    `- 本局种子：${st.seed}`, '',
    '## 决策与理由', '',
  ];
  const decisions = st.log.filter(l => l.type === 'decision');
  if (decisions.length) decisions.forEach(l => lines.push(`- **第 ${l.day} 天** ${l.text}`));
  else lines.push('（暂无）');
  lines.push('', '## 完整时间线', '');
  st.log.forEach(l => lines.push(`- 第 ${l.day} 天 [${l.type}] ${l.text}`));
  lines.push('', '> 本日志由虚构教学市场生成，仅用于学习，不构成任何投资建议。');
  return lines.join('\n');
}

function exportJournal(st) {
  const blob = new Blob([journalMarkdown(st)], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `我的投资日志-第${st.day}天.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function showReview(ctx, onClose) {
  const st = ctx.st;
  const f = st.flags;
  const total = totalAssets(st, ctx.market);
  const pnl = round2(total - INITIAL_CASH);

  const badges = [
    ['sales', '销量确认'], ['cost', '成本侦探'], ['source', '溯源意识'],
  ].map(([k, name]) => `<span class="review-badge ${f.investigated?.[k] ? 'on' : 'off'}">${name}${f.investigated?.[k] ? '' : '（未获得）'}</span>`).join('');

  const startDay = Math.max(1, (f.eventStarted ? 15 : 1) - 1);
  const keyLogs = st.log.filter(l => l.day >= startDay && ['event', 'order', 'fill', 'decision'].includes(l.type)).slice(-14);
  const timeline = keyLogs.length
    ? keyLogs.map(l => `<div class="log"><b>第 ${l.day} 天</b> ${l.text}</div>`).join('')
    : '<div class="empty">这段时间没有操作记录。</div>';

  const posRows = Object.entries(st.positions).map(([id, p]) =>
    `<tr><td>${companyById(id).name}</td><td>${p.shares}</td><td>${p.avgCost.toFixed(2)}</td></tr>`).join('');

  const card = showModal({
    title: '复盘：这次决策怎么样？',
    bodyHTML: `
      <div class="review-sec"><h4>账户（结果不是评价标准）</h4>
        初始资金 ${fmtMoney(INITIAL_CASH)} 元 → 当前总资产 ${fmtMoney(total)} 元（${pnlHTML(pnl)}）
        ${posRows ? `<table class="list"><tr><th>持仓</th><th>股数</th><th>成本</th></tr>${posRows}</table>` : ''}
      </div>
      <div class="review-sec"><h4>时间线：信息 → 操作 → 结果</h4>${timeline}</div>
      <div class="review-sec"><h4>调查评估</h4>${badges}</div>
      <div class="review-sec"><h4>评语</h4>${evaluate(st).map(c => `<p>· ${c}</p>`).join('')}</div>
      <div class="review-sec"><h4>我的日志</h4>${journalHTML(st)}</div>
      <div class="review-sec"><h4>本阶段小结</h4>
        <p>· 股票 = 公司的一小份；市值 = 股价 × 总股数，股价低 ≠ 公司便宜。<br>
           · 委托 ≠ 成交；盘口买一 / 卖一之差是价差，价格不合适就排队。<br>
           · T+1：当日买入次日可卖；涨跌停 ±10%；成交收佣金。<br>
           · 分红除息：现金 +红利、股价 −红利，总资产不变——分红不是白赚。<br>
           · 指数按市值加权；读图是还原过去，不能保证预测未来。<br>
           · 传闻要查证来源；仓位集中会放大行业冲击；别把摊平当救命稻草。</p>
        <p style="color:var(--muted);font-size:12px">评价依据是你的信息使用与决策理由，与本次盈亏无关。</p>
      </div>`,
    buttons: [
      { label: '导出我的日志', keep: true, onClick: () => exportJournal(st) },
      { label: '关闭', primary: true, onClick: () => onClose?.() },
    ],
  });
  card.style.maxWidth = '640px';
}
