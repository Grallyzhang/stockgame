// 任务链：六章二十八课 + 毕业。判定基于学习行为，不按盈亏。
import { CONCEPTS, INVESTIGATIONS, EVENT_RUMOR, EVENT_EARNINGS, STAGE_TEASER, DIVIDEND, TOTAL_DAYS, companyById } from './data.js';
import { quote, dayChangePct, bestGainDay, fee } from './market.js';
import { mulberry32, fmtCap, fmtMoney, fmtVolume, round2, numOk } from './util.js';
import { showModal, closeModal, toast } from './ui.js';
import { log } from './state.js';
import { boardText } from './town.js';
import { maSeries, detectCross } from './indicators.js';

// ---------- 预测-验证机制（技术分析「教识别 + 当场打假」的核心） ----------
export const PREDICTIONS = {
  engulf:      { lesson: 't12', symbol: 'pinecone', askDay: 24, resolveDay: 27, name: '看涨吞没', card: 'engulf',
    askText: '松果第 23–24 天出现了「看涨吞没」。你预测接下来三天（到第 27 天收盘）它会？',
    resolveText: '这次看涨吞没真的应验了。但统计倾向 ≠ 保证——同样的形态换个环境可能就失灵（你在暮星上会亲眼看到）。' },
  eveningStar: { lesson: 't14', symbol: 'pinecone', askDay: 33, resolveDay: 36, name: '暮星', card: 'eveningStar',
    askText: '松果第 31–33 天走出了教科书式的「暮星」，教科书说它预示下跌。你预测接下来三天（到第 36 天收盘）它会？',
    resolveText: '暮星之后不跌反涨——教科书形态「失灵」了。形态只描述多空力量的变化，挡不住消息与资金。这就是为什么「形态不保证预测」。' },
  goldCross:   { lesson: 't19', symbol: 'pinecone', dynamic: true, window: [47, 55], resolveAfter: 3, name: '金叉', card: 'crossCard',
    askText: 'MA5 上穿 MA10，出现金叉。你预测接下来三天它会？',
    resolveText: '这几天的上涨由传闻驱动，指标只能描述过去、无法告诉你为什么——相关 ≠ 因果。金叉没有「预测」到传闻，它只是传闻的回声。' },
};
const CHOICES = ['看涨', '看跌', '看横盘'];

// 判定：|涨跌|≤1.5% 视为横盘；选对方向 → right；实际横盘 → half；其余 → wrong
export function judge(market, symbol, day0, resolveDay, choice) {
  const bars = market[symbol];
  const c0 = bars[day0 - 1].close, c1 = bars[resolveDay - 1].close;
  const pct = (c1 - c0) / c0;
  const actual = Math.abs(pct) <= 0.015 ? 'flat' : pct > 0 ? 'up' : 'down';
  const picked = ['up', 'down', 'flat'][choice];
  const verdict = picked === actual ? 'right' : actual === 'flat' ? 'half' : 'wrong';
  return { pct, actual, verdict };
}

// 窗口内 MA5 上穿 MA10 的首日（返回天数，无则 null）
function findGoldCross(market, symbol, fromDay, toDay) {
  const bars = market[symbol].slice(0, toDay);
  const ma5 = maSeries(bars, 5), ma10 = maSeries(bars, 10);
  for (let d = fromDay; d <= toDay; d++) {
    if (detectCross(ma5, ma10, d - 1) === 'gold') return d;
  }
  return null;
}

function predictionAsk(ctx, id, day0, resolveDay) {
  const st = ctx.st;
  const P = PREDICTIONS[id];
  const retro = st.day > day0; // 迟激活兜底：信号日已过 → 事后检验
  const card = showModal({
    title: `预测 · ${P.name}`, closable: false,
    bodyHTML: `${CONCEPTS[P.card].body}
      ${retro ? `<p style="color:var(--muted);font-size:13px">（信号日已过，这是一次事后检验：请按你在第 ${day0} 天收盘时能看到的情形作答。）</p>` : ''}
      <p style="margin-top:8px"><b>${P.askText}</b></p>
      <p style="color:var(--muted);font-size:13px">预测会记入研究日志，第 ${resolveDay} 天收盘后自动验证。没有对错惩罚——诚实最重要。</p>`,
  });
  const box = card.querySelector('.modal-btns');
  CHOICES.forEach((label, i) => {
    const b = document.createElement('button');
    b.className = 'btn' + (i === 0 ? ' primary' : '');
    b.textContent = label;
    b.addEventListener('click', () => submitPrediction(ctx, id, i, day0, resolveDay));
    box.appendChild(b);
  });
}

function submitPrediction(ctx, id, choice, day0, resolveDay) {
  const st = ctx.st;
  st.flags.predictions[id] = { phase: 'pending', day0, resolveDay, choice };
  log(st, 'decision', `预测 · ${PREDICTIONS[id].name}：第 ${day0}→${resolveDay} 天 ${CHOICES[choice]}。`);
  closeModal();
  if (!st.achievements.includes('firstPredict')) {
    st.achievements.push('firstPredict');
    toast('成就：第一次预测');
  }
  completeTask(ctx, PREDICTIONS[id].lesson);
  if (st.day >= resolveDay) predictionResolve(ctx, id); // 事后检验：立即验证
}

function predictionResolve(ctx, id) {
  const st = ctx.st;
  const rec = st.flags.predictions[id];
  if (!rec || rec.phase !== 'pending' || st.day < rec.resolveDay) return false;
  const P = PREDICTIONS[id];
  const { pct, actual, verdict } = judge(ctx.market, P.symbol, rec.day0, rec.resolveDay, rec.choice);
  rec.phase = 'resolved';
  rec.verdict = verdict;
  st.stats.predictions[verdict]++;
  const pctText = `${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(1)}%`;
  const actualText = actual === 'up' ? `上涨 ${pctText}` : actual === 'down' ? `下跌 ${pctText}` : `横盘（${pctText}）`;
  const verdictText = { right: '✓ 预测对了', wrong: '✗ 预测错了', half: '～ 半对（实际横盘）' }[verdict];
  log(st, 'event', `预测验证 · ${P.name}：实际${actualText}，你选了「${CHOICES[rec.choice]}」→ ${verdictText}`);
  showModal({
    title: `预测验证 · ${P.name}`,
    bodyHTML: `
      <p>第 ${rec.day0} 天你预测「${CHOICES[rec.choice]}」。到第 ${rec.resolveDay} 天收盘，松果食品实际：<b>${actualText}</b>。</p>
      <p><b>${verdictText}</b></p>
      <p>${P.resolveText}</p>`,
    buttons: [{ label: '继续', primary: true }],
  });
  if (Object.keys(PREDICTIONS).every(k => st.flags.predictions[k]?.phase === 'resolved') && !st.achievements.includes('honestSignal')) {
    st.achievements.push('honestSignal');
    log(st, 'task', '获得成就「信号怀疑论者」：完成三次预测验证，理解信号有统计倾向但不保证。');
    toast('成就：信号怀疑论者');
  }
  return true;
}

// 任务卡「查看我的预测 / 查看验证结果」恢复入口
function predictionInfo(ctx, id) {
  const st = ctx.st;
  const rec = st.flags.predictions[id];
  if (!rec) return predictionAsk(ctx, id, PREDICTIONS[id].askDay ?? st.day, PREDICTIONS[id].resolveDay ?? Math.min(st.day + 3, TOTAL_DAYS));
  const P = PREDICTIONS[id];
  const resolved = rec.phase === 'resolved';
  showModal({
    title: `${P.name} · 我的预测`,
    bodyHTML: `
      <div class="kv"><span class="k">预测区间</span><span class="v">第 ${rec.day0} → ${rec.resolveDay} 天</span></div>
      <div class="kv"><span class="k">我的预测</span><span class="v">${CHOICES[rec.choice]}</span></div>
      ${resolved
        ? `<div class="kv"><span class="k">验证结果</span><span class="v">${{ right: '✓ 对', wrong: '✗ 错', half: '～ 半对' }[rec.verdict]}</span></div><p>${P.resolveText}</p>`
        : `<p style="color:var(--muted);font-size:13px">第 ${rec.resolveDay} 天收盘后自动验证，到时见分晓。</p>`}`,
    buttons: [{ label: '关闭', primary: true }],
  });
}

// ---------- 任务卡文案 ----------
export function getTaskView(ctx) {
  const st = ctx.st;
  const sub = st.tasks.sub;
  const btn = (label, onClick, primary) => ({ label, onClick, primary });
  switch (st.tasks.active) {
    case 't1': return {
      title: '第 1 课 · 股票是什么', mins: 4,
      hint: '松果食品想扩建厂房但缺钱，镇长给它出了个主意……读第一张概念卡。',
      buttons: [btn('读概念卡', () => lessonStock(ctx), true)],
    };
    case 't2': {
      const both = st.flags.viewed.pinecone && st.flags.viewed.firefly;
      return {
        title: '第 2 课 · 股价低 ≠ 公司便宜', mins: 5,
        hint: both
          ? '两家公司的档案都看完了。比较它们的「总价值」（市值），答对即可解锁交易台。'
          : '松果食品每股 8 元左右，萤火科技每股 120 元左右——价格差了十几倍。点击小镇里两家公司的建筑，打开它们的档案看看。',
        buttons: both ? [
          btn('重看概念卡', () => showConcept(ctx, 'marketCap', true)),
          btn('开始答题', () => quizMarketCap(ctx), true),
        ] : [],
      };
    }
    case 't3': return {
      title: '第 3 课 · 股东的回报：价差 + 分红', mins: 4,
      hint: st.day < 3
        ? `持有股票怎么赚钱？一靠价差，二靠分红。点击「下一天」推进到第 3 天（当前第 ${st.day} 天），公告栏会有消息。`
        : '公告栏贴出了松果食品的新公告——点击小镇中间的「公告栏」读一读。',
      buttons: st.day >= 3 && st.flags.divAnnShown
        ? [btn('重读分红公告', () => dividendAnnounce(ctx), true)]
        : [],
    };
    case 't4': {
      const hints = {
        placeLimit: '打开右侧「交易」面板，选择松果食品：选「限价」，价格填 7.60 元、数量 1 手，提交委托。这个价格比现价低不少，我们先看看会发生什么。',
        advanceObserve: '限价委托已提交。点击顶部「下一天」，观察这笔委托的状态。',
        marketBuy: '现在用「市价」买入 1 手松果食品，体验「立即成交」，注意看成交通知里的佣金。',
      };
      return {
        title: '第 4 课 · 委托与成交', mins: 5,
        hint: hints[sub] || '先读概念卡，再下你的第一笔委托。',
        buttons: [btn('重看概念卡', () => showConcept(ctx, 'order', true))],
      };
    }
    case 't5': return {
      title: '第 5 课 · 盘口与价差', mins: 4,
      hint: '研究室旁的「盘口显示屏」已解锁（点小镇里的屏幕，或右侧「盘口」标签）。打开松果食品的盘口，<b>点击「卖一」那一行</b>——想立即买入，就得接受这个价格。',
      buttons: [
        btn('重看概念卡', () => showConcept(ctx, 'orderBook', true)),
        btn('直接答题', () => quizBook(ctx)),
      ],
    };
    case 't6': {
      const hints = {
        buyT1: '规则一 · T+1：打开「交易」面板，用「市价」买入 1 手萤火科技（约 1.2 万元）。',
        trySell: '萤火科技买入成交了。现在立刻尝试把它「卖出」——看看会发生什么。',
        waitD9: `规则二 · 涨跌停。点击「下一天」推进到第 9 天（当前第 ${st.day} 天），萤火科技可能有大动静。`,
        tryBuyFirefly: '萤火科技今天涨停了！试试用「市价」买入 1 手萤火科技——看看会发生什么。',
      };
      return {
        title: '第 6 课 · 交易规则：T+1 与涨跌停', mins: 5,
        hint: hints[sub] || hints.buyT1,
        buttons: [btn('重看概念卡', () => showConcept(ctx, 'rules', true))],
      };
    }
    case 't7': return {
      title: '第 7 课 · 读懂行情', mins: 4,
      hint: st.day < 10
        ? `点击「下一天」推进到第 10 天（当前第 ${st.day} 天），研究室将装好行情终端。`
        : '行情终端已解锁。打开「行情」面板，<b>点击松果食品涨幅最大的那根 K 线蜡烛</b>（点错没关系，再试）。',
      buttons: st.day >= 10 ? [
        btn('重看概念卡', () => showConcept(ctx, 'kline', true)),
        btn('点不准？改成选择题', () => quizChart(ctx)),
      ] : [],
    };
    case 't8': return {
      title: '第 8 课 · 小镇指数', mins: 3,
      hint: '顶部统计区新增「小镇综指」：三家公司按市值加权、第 1 天 = 1000 点。<b>点击顶部那个综指数字</b>，看看每家公司各占多大权重。',
      buttons: [
        btn('重看概念卡', () => showConcept(ctx, 'indexCard', true)),
        btn('查看权重', () => indexInfoModal(ctx), true),
      ],
    };
    case 't9': return {
      title: '第 9 课 · 除权除息：分红的钱从哪来', mins: 4,
      hint: st.day < DIVIDEND.exDay
        ? `第 ${DIVIDEND.recordDay} 天收盘持有松果食品即可参与分红（每股 ${DIVIDEND.perShare.toFixed(2)} 元）。推进到第 ${DIVIDEND.exDay} 天除息日（当前第 ${st.day} 天），看看账户的变化。`
        : '除息日已过。看看你账户的现金与持仓变化，然后回答下面的问题。',
      buttons: st.day >= DIVIDEND.exDay ? [
        btn('重看概念卡', () => showConcept(ctx, 'exdiv', true)),
        btn('开始算账', () => quizExDiv(ctx), true),
      ] : [],
    };
    // ---------- 第四章 · K 线形态 ----------
    case 't10': return {
      title: '第 10 课 · 大阳线与大阴线', mins: 3,
      hint: st.day < 16
        ? `K 线的「实体」记录了一天的多空战果。点击「下一天」推进到第 16 天（当前第 ${st.day} 天），看两根有故事的蜡烛。`
        : '打开「行情」面板（松果食品），图上已高亮两根蜡烛：<b>点击第 15 天和第 16 天的蜡烛</b>，读出它们的多空信息。',
      buttons: st.day >= 16 ? [btn('点不准？看提示', () => toast('大阳线 = 收盘远高于开盘（买方完胜）；大阴线 = 相反。点高亮的第 15、16 天蜡烛'))] : [],
    };
    case 't11': return {
      title: '第 11 课 · 影线与十字星', mins: 4,
      hint: st.day < 20
        ? `影线记录「冲到过哪、又被打了回来」。点击「下一天」推进到第 20 天（当前第 ${st.day} 天）。`
        : '打开「行情」面板：<b>点击第 18 天（长上影）和第 20 天（十字星）的蜡烛</b>。',
      buttons: st.day >= 20 ? [btn('重看概念卡', () => showConcept(ctx, 'klineBody', true))] : [],
    };
    case 't12': {
      const rec = st.flags.predictions?.engulf;
      return {
        title: '第 12 课 · 看涨吞没（含预测）', mins: 5,
        hint: st.day < 24
          ? `两根 K 线组合起来更有故事。点击「下一天」推进到第 24 天（当前第 ${st.day} 天），看一个经典的「反转组合」。`
          : rec
            ? (rec.phase === 'pending' ? `预测已提交（你选了「${CHOICES[rec.choice]}」）。推进到第 ${rec.resolveDay} 天收盘，自动验证。` : '验证结果已出，点下方按钮回看。')
            : '松果第 23–24 天走出「看涨吞没」——读概念卡，然后做出你的第一次走势预测。',
        buttons: st.day >= 24 ? [rec
          ? btn(rec.phase === 'pending' ? '查看我的预测' : '查看验证结果', () => predictionInfo(ctx, 'engulf'), true)
          : btn('读卡并开始预测', () => predictionAsk(ctx, 'engulf', 24, 27), true)] : [],
      };
    }
    case 't13': return {
      title: '第 13 课 · 跳空缺口', mins: 4,
      hint: st.day < 29
        ? `有些消息会让价格「跳」过一段区间。点击「下一天」推进到第 29 天（当前第 ${st.day} 天）。`
        : '第 29 天松果跳空高开：今天的最低价高过了昨天的最高价，中间留下没有成交的「空档」。打开「行情」面板，<b>点击第 29 天的蜡烛</b>确认缺口。',
      buttons: st.day >= 29 ? [btn('重看概念卡', () => showConcept(ctx, 'gapCard', true))] : [],
    };
    case 't14': {
      const rec = st.flags.predictions?.eveningStar;
      return {
        title: '第 14 课 · 暮星（含预测）', mins: 5,
        hint: st.day < 33
          ? `三根线组合的顶部信号「暮星」正在形成。点击「下一天」推进到第 33 天（当前第 ${st.day} 天）。`
          : rec
            ? (rec.phase === 'pending' ? `预测已提交（你选了「${CHOICES[rec.choice]}」）。推进到第 ${rec.resolveDay} 天收盘，自动验证。` : '验证结果已出，点下方按钮回看。')
            : '松果第 31–33 天走出教科书式的「暮星」——读概念卡，然后做出你的第二次预测。',
        buttons: st.day >= 33 ? [rec
          ? btn(rec.phase === 'pending' ? '查看我的预测' : '查看验证结果', () => predictionInfo(ctx, 'eveningStar'), true)
          : btn('读卡并开始预测', () => predictionAsk(ctx, 'eveningStar', 33, 36), true)] : [],
      };
    }
    case 't15': return {
      title: '第 15 课 · 形态小结：能信吗', mins: 3,
      hint: st.day < 36
        ? `等第二次验证结束后给形态做个小结。点击「下一天」推进到第 36 天（当前第 ${st.day} 天）。`
        : '吞没应验了，暮星失灵了——用一道选择题给「形态」一个诚实的定位。',
      buttons: st.day >= 36 ? [btn('开始总结', () => quizPatternLimit(ctx), true)] : [],
    };
    // ---------- 第五章 · 量价与指标 ----------
    case 't16': return {
      title: '第 16 课 · 成交量：价格的证人', mins: 3,
      hint: st.day < 39
        ? `价格回答「涨了多少」，成交量回答「有多少人参与」。点击「下一天」推进到第 39 天（当前第 ${st.day} 天）。`
        : '打开「行情」面板：<b>点击第 39 天的蜡烛</b>，看看它下方的量柱和前几天有什么不同。',
      buttons: st.day >= 39 ? [btn('重看概念卡', () => showConcept(ctx, 'volumeCard', true))] : [],
    };
    case 't17': return {
      title: '第 17 课 · 量价背离', mins: 4,
      hint: st.day < 41
        ? `连续放量但价格不动，有个专门的名字。点击「下一天」推进到第 41 天（当前第 ${st.day} 天）。`
        : '第 39–41 天连续三天明显放量，价格却原地踏步——这意味着什么？',
      buttons: st.day >= 41 ? [
        btn('重看概念卡', () => showConcept(ctx, 'volPrice', true)),
        btn('开始答题', () => quizVolPrice(ctx), true),
      ] : [],
    };
    case 't18': return {
      title: '第 18 课 · 均线：把噪声熨平', mins: 5,
      hint: st.day < 43
        ? `单日价格充满噪声，均线负责把它熨平。点击「下一天」推进到第 43 天（当前第 ${st.day} 天），行情图将叠加均线。`
        : '读均线概念卡——读完后行情图会叠加 MA5 / MA10 / MA20 三条线。',
      buttons: st.day >= 43 ? [btn('读概念卡并解锁均线', () => maOnboard(ctx), true)] : [],
    };
    case 't19': {
      const rec = st.flags.predictions?.goldCross;
      const crossDay = st.day >= 47 ? findGoldCross(ctx.market, 'pinecone', 47, Math.min(55, st.day)) : null;
      return {
        title: '第 19 课 · 金叉死叉（含预测）', mins: 5,
        hint: st.day < 47
          ? `短期均线上穿长期均线叫「金叉」。点击「下一天」推进到第 47 天以后（当前第 ${st.day} 天），盯住松果的 MA5 与 MA10。`
          : rec
            ? (rec.phase === 'pending' ? `预测已提交（你选了「${CHOICES[rec.choice]}」）。推进到第 ${rec.resolveDay} 天收盘，自动验证。` : '验证结果已出，点下方按钮回看。')
            : crossDay
              ? `第 ${crossDay} 天 MA5 上穿 MA10，<b>金叉出现</b>（图上已高亮）——做出你的第三次预测。`
              : '等待金叉：MA5 上穿 MA10 的那一刻，图上会高亮并请你预测。',
        buttons: st.day >= 47 ? [
          btn('重看概念卡', () => showConcept(ctx, 'crossCard', true)),
          ...(rec ? [btn(rec.phase === 'pending' ? '查看我的预测' : '查看验证结果', () => predictionInfo(ctx, 'goldCross'), true)]
            : crossDay ? [btn('金叉出现！开始预测', () => predictionAsk(ctx, 'goldCross', crossDay, Math.min(crossDay + 3, TOTAL_DAYS)), true)] : []),
        ] : [],
      };
    }
    case 't20': return {
      title: '第 20 课 · 认识 MACD', mins: 4,
      hint: st.day < 48
        ? `MACD 是均线家族的另一名成员。点击「下一天」推进到第 48 天（当前第 ${st.day} 天）。`
        : '读 MACD 概念卡——读完后行情图下方会出现 MACD 副图。',
      buttons: st.day >= 48 ? [btn('读概念卡并解锁副图', () => macdOnboard(ctx), true)] : [],
    };
    case 't21': return {
      title: '第 21 课 · 指标的局限', mins: 3,
      hint: st.day < 50
        ? `三次预测验证加上两个指标上手，该做一次诚实的总结了。点击「下一天」推进到第 50 天（当前第 ${st.day} 天）。`
        : '指标能做什么、不能做什么？一道选择题给第五章收尾。',
      buttons: st.day >= 50 ? [btn('开始总结', () => quizIndicatorLimit(ctx), true)] : [],
    };
    // ---------- 第六章 · 基本面与风险 ----------
    case 't22': {
      if (sub === 'executeBuy') return {
        title: '第 22 课 · 传闻 vs 公告', mins: 6,
        hint: '你决定买入。打开「交易」面板，<b>真实买入松果食品</b>（数量自定，1 手起）——成交后本课完成。',
        buttons: [],
      };
      return {
        title: '第 22 课 · 传闻 vs 公告', mins: 6,
        hint: st.day < 51
          ? `镇上一片平静。点击「下一天」推进到第 51 天（当前第 ${st.day} 天），会有事情发生。`
          : '传闻已出现，跟着弹窗完成调查与决策。',
        buttons: st.day >= 51 && st.flags.eventStarted
          ? [btn('继续调查', () => investigateModal(ctx), true)]
          : [],
      };
    }
    case 't23': return {
      title: '第 23 课 · 财报三要素', mins: 5,
      hint: st.day < 54
        ? `点击「下一天」推进到第 54 天（当前第 ${st.day} 天），松果食品将发布财报。`
        : '财报已发布，跟着弹窗完成复盘。',
    };
    case 't24': return {
      title: '第 24 课 · 估值浅识：市盈率 PE', mins: 4,
      hint: '财报告诉我们「赚了多少」，估值回答「这个价格贵不贵」。读概念卡，动手算一次 PE。',
      buttons: [
        btn('读概念卡', () => showConcept(ctx, 'peCard')),
        btn('开始算账', () => quizPE(ctx), true),
      ],
    };
    case 't25': return {
      title: '第 25 课 · FOMO 心理关', mins: 5,
      hint: st.day < 55
        ? `点击「下一天」推进到第 55 天（当前第 ${st.day} 天），保持冷静。`
        : '萤火科技传闻又起、股价脉冲。做决定之前，<b>先去小镇「公告栏」查证</b>有没有官方消息。',
      buttons: st.day >= 55 && st.flags.fomoShown
        ? [btn('继续做决定', () => fomoModal(ctx), true)]
        : [],
    };
    case 't26': {
      if (sub === 'diversify') {
        const hasBeaver = (st.positions.beaver?.shares || 0) >= 100;
        return {
          title: '第 26 课 · 仓位与集中度', mins: 5,
          hint: hasBeaver
            ? '你已持有河狸物流——持仓不再集中于一个行业。开始答题。'
            : '动手分散：打开「交易」面板，<b>真实买入 1 手河狸物流</b>——把持仓从单一行业变成三个行业。',
          buttons: hasBeaver
            ? [btn('开始答题', () => quizShock(ctx), true)]
            : [btn('现金不足？用例账代替', () => shockCalcQuiz(ctx))],
        };
      }
      return {
        title: '第 26 课 · 仓位与集中度', mins: 5,
        hint: st.day < 56
          ? `点击「下一天」推进到第 56 天（当前第 ${st.day} 天），看看一则行业新闻会冲击谁。`
          : '「进口坚果关税上调」冲击了谁？跟着弹窗算一笔对比账。',
        buttons: st.day >= 56 && st.flags.shockShown
          ? [btn('继续本课', () => shockModal(ctx), true)]
          : [],
      };
    }
    case 't27': return {
      title: '第 27 课 · 回撤与「不摊平」', mins: 5,
      hint: st.day < 58
        ? `松果食品正在阴跌。点击「下一天」推进到第 58 天（当前第 ${st.day} 天），回答一个很多人会纠结的问题。`
        : '面对浮亏，要不要「补仓摊低成本」？先算一笔账，再做决定。',
      buttons: st.day >= 58 && st.flags.avgAsked
        ? [btn('继续本课', () => avgDownModal(ctx), true)]
        : [],
    };
    case 't28': return {
      title: '第 28 课 · 毕业：信号复盘', mins: 4,
      hint: st.day < 60
        ? `最后一课。点击「下一天」推进到第 60 天（当前第 ${st.day} 天），回顾你的三次预测与这一路的决策。`
        : '三次预测验证都已结束。看看你的「信号成绩单」，然后领取毕业报告。',
      buttons: st.day >= 60 ? [btn('查看毕业报告', () => graduateReviewModal(ctx), true)] : [],
    };
    default: return {
      title: '已毕业 · 六章二十八课',
      hint: '可自由练习到第 60 天、点「复盘」回顾并导出「我的日志」，或「重新开始」换个决策再来一局。也可以去「切换模式」挑战历史回放与实时模拟。',
    };
  }
}

// ---------- 概念卡 ----------
export function showConcept(ctx, key, passive = false) {
  const c = CONCEPTS[key];
  const buttons = [];
  if (!passive) {
    if (key === 'marketCap') buttons.push({ label: '开始答题', primary: true, onClick: () => quizMarketCapNum(ctx) });
    if (key === 'order') buttons.push({ label: '去下第一笔委托', primary: true, onClick: () => { ctx.st.tasks.sub = 'placeLimit'; ctx.ui.tab = 'trade'; ctx.dispatch('uiRefresh'); } });
    if (key === 'kline') buttons.push({ label: '去行情终端看看', primary: true, onClick: () => ctx.dispatch('tab', { tab: 'chart' }) });
    if (key === 'orderBook') buttons.push({ label: '去看盘口', primary: true, onClick: () => ctx.dispatch('tab', { tab: 'book' }) });
    if (key === 'indexCard') buttons.push({ label: '开始答题', primary: true, onClick: () => quizIndex(ctx) });
    if (key === 'maCard') buttons.push({ label: '开始答题', primary: true, onClick: () => quizMA(ctx) });
    if (key === 'macdCard') buttons.push({ label: '开始答题', primary: true, onClick: () => quizMACD(ctx) });
    if (key === 'peCard') buttons.push({ label: '开始算账', primary: true, onClick: () => quizPE(ctx) });
  }
  if (!buttons.length) buttons.push({ label: '关闭', primary: true });
  showModal({ title: c.title, bodyHTML: c.body, buttons });
}

// ---------- 通用答题 ----------
function runQuiz(ctx, { question, options, correct, wrongExplain, rightExplain, onCorrect }) {
  const render = (wrongIdx = -1) => {
    const card = showModal({
      title: '想一想', closable: false,
      bodyHTML: `
        <p><b>${question}</b></p>
        ${options.map((o, i) => `<button class="quiz-opt ${i === wrongIdx ? 'wrong' : ''}" data-q="${i}">${o}</button>`).join('')}
        ${wrongIdx >= 0 ? `<div class="quiz-explain">${wrongExplain}</div>` : ''}`,
    });
    card.querySelectorAll('.quiz-opt').forEach(b => b.addEventListener('click', () => {
      const i = Number(b.dataset.q);
      if (i === correct) {
        showModal({ title: '回答正确', bodyHTML: `<p>${rightExplain}</p>`, buttons: [{ label: '继续', primary: true, onClick: onCorrect }] });
      } else {
        ctx.st.stats = ctx.st.stats || { quizWrong: 0 };
        ctx.st.stats.quizWrong++;
        render(i);
      }
    }));
  };
  render();
}

// ---------- 数字答题（输入 + 容差判定，答错不惩罚可重试） ----------
function runQuizNum(ctx, { question, unit = '', answer, wrongExplain, rightExplain, onCorrect }) {
  const render = (wrong = false) => {
    const card = showModal({
      title: '算一算', closable: false,
      bodyHTML: `
        <p><b>${question}</b></p>
        <div class="field"><input id="qn-in" type="number" step="any" placeholder="输入数字">${unit ? `<span style="color:var(--muted)">${unit}</span>` : ''}</div>
        ${wrong ? `<div class="quiz-explain">${wrongExplain}</div>` : ''}`,
      buttons: [{ label: '提交', primary: true, keep: true, onClick: () => {
        const v = parseFloat(document.getElementById('qn-in')?.value);
        if (numOk(v, answer)) {
          showModal({ title: '回答正确', bodyHTML: `<p>${rightExplain}</p>`, buttons: [{ label: '继续', primary: true, onClick: onCorrect }] });
        } else {
          ctx.st.stats = ctx.st.stats || { quizWrong: 0 };
          ctx.st.stats.quizWrong++;
          render(true);
        }
      } }],
    });
    card.querySelector('#qn-in')?.focus();
  };
  render();
}


// ---------- 第 1 课：股票是什么 ----------
function lessonStock(ctx) {
  ctx.st.flags.ipoShown = true;
  showModal({
    title: CONCEPTS.stockIpo.title,
    bodyHTML: CONCEPTS.stockIpo.body,
    buttons: [{ label: '我明白了', primary: true, onClick: () => runQuizNum(ctx, {
      question: '松果食品发行 100 万股股票、每股定价 8 元，这次一共筹到多少万元？（股数 × 股价，注意单位是「万元」）',
      unit: '万元',
      answer: 800,
      wrongExplain: '筹资 = 股数 × 股价 = 100 万股 × 8 元 = 800 万元。再算一次。',
      rightExplain: '100 万股 × 8 元 = 800 万元。发行股票 = 把公司切成小份卖出去换钱，买入的人成了股东。',
      onCorrect: () => completeTask(ctx, 't1'),
    }) }],
  });
}

// ---------- 第 2 课：市值 ----------
function quizMarketCapNum(ctx) {
  const f = quote(ctx.market, 'firefly', ctx.st.day).close;
  const ans = round2(f * 5e6 / 1e8);
  runQuizNum(ctx, {
    question: `动手算：萤火科技股价 ${f.toFixed(2)} 元、总股数 500 万股，它的总市值约多少亿元？（市值 = 股价 × 总股数）`,
    unit: '亿元',
    answer: ans,
    wrongExplain: `市值 = ${f.toFixed(2)} 元 × 500 万股 = ${ans} 亿元。再算一次。`,
    rightExplain: `萤火科技市值约 ${ans} 亿元。接下来和松果食品比一比。`,
    onCorrect: () => quizMarketCap(ctx),
  });
}

function quizMarketCap(ctx) {
  const st = ctx.st;
  const p = quote(ctx.market, 'pinecone', st.day).close;
  const f = quote(ctx.market, 'firefly', st.day).close;
  const pCap = fmtCap(p * 1e8), fCap = fmtCap(f * 5e6);
  runQuiz(ctx, {
    question: `松果食品股价 ${p.toFixed(2)} 元、总股数 1 亿股；萤火科技股价 ${f.toFixed(2)} 元、总股数 500 万股。哪家公司的总市值更高？`,
    options: [
      '萤火科技——它的股价高得多',
      '松果食品',
      '两家公司总价值差不多',
      '股价差这么多，无法比较',
    ],
    correct: 1,
    wrongExplain: `市值 = 股价 × 总股数。松果食品：${p.toFixed(2)} × 1 亿 ≈ ${pCap}元；萤火科技：${f.toFixed(2)} × 500 万 ≈ ${fCap}元。股价高 ≠ 公司总价值大，再想想。`,
    rightExplain: `松果食品市值约 ${pCap}元，萤火科技约 ${fCap}元。股价最低的松果食品，「整个公司」反而更贵。比较公司要看市值，不能只看股价。`,
    onCorrect: () => completeTask(ctx, 't2'),
  });
}

// ---------- 第 3 课：分红预案 ----------
function dividendAnnounce(ctx) {
  const st = ctx.st;
  if (!st.flags.divAnnShown) log(st, 'event', '松果食品公告分红预案：每 10 股派 2 元，第 12 天登记、第 13 天除息。');
  st.flags.divAnnShown = true;
  showModal({
    title: '公告：松果食品分红预案',
    bodyHTML: `
      <p>松果食品公告：<b>每 10 股派现 2 元</b>（每股 ${DIVIDEND.perShare.toFixed(2)} 元）。</p>
      <p>· <b>登记日</b>：第 ${DIVIDEND.recordDay} 天收盘时持有，即可参与分红<br>
         · <b>除息日</b>：第 ${DIVIDEND.exDay} 天，红利到账，股价同步下调 ${DIVIDEND.perShare.toFixed(2)} 元</p>
      ${CONCEPTS.dividend.body}`,
    buttons: [{ label: '我明白了', primary: true, onClick: () => runQuizNum(ctx, {
      question: `如果你持有 100 股松果食品，除息日那天红利到账多少元？（每股派 ${DIVIDEND.perShare.toFixed(2)} 元）`,
      unit: '元',
      answer: round2(100 * DIVIDEND.perShare),
      wrongExplain: `红利 = 持股 × 每股分红 = 100 × ${DIVIDEND.perShare.toFixed(2)} = ${round2(100 * DIVIDEND.perShare)} 元。再算一次。`,
      rightExplain: '红利 = 持股 × 每股分红。第 13 天除息日，这笔钱会真的打进账户——前提是登记日收盘时持有。',
      onCorrect: () => completeTask(ctx, 't3'),
    }) }],
  });
}

// 通用公告栏弹窗（非课程关键期点击公告栏时打开）
function boardInfoModal(ctx) {
  const st = ctx.st;
  showModal({
    title: '公告栏',
    bodyHTML: `
      <p>${boardText(st.day)}</p>
      <p style="color:var(--muted);font-size:13px">公告栏只发布<b>官方消息</b>：分红预案、财报等。传闻不会出现在这里——这正是「传闻 vs 公告」的分界线。第 22 课会专门练习查证。</p>`,
    buttons: [{ label: '关闭', primary: true }],
  });
}

// ---------- 第 4 课：委托与成交 ----------
function quizUnfilledOrder(ctx, generic) {
  runQuiz(ctx, generic ? {
    question: '关于「委托」和「成交」，哪句话正确？',
    options: [
      '下了委托就一定会成交',
      '委托只是报价请求；价格不合适，就可能一直不成交',
      '委托和成交是同一个意思',
      '未成交的委托会额外收一笔费用',
    ],
    correct: 1,
    wrongExplain: '委托只是你发出的报价请求：价格匹配才会成交，不合适就保持「未成交」，撤单后资金解冻。本市场只在成交时收佣金（0.1%、最低 1 元）。',
    rightExplain: '委托 ≠ 成交。这正是你刚才看到的：市价单立即成交，价格不合适的限价单会一直等待。',
    onCorrect: () => completeTask(ctx, 't4'),
  } : {
    question: '你以 7.60 元挂出的限价买入单一直没有成交，原因是？',
    options: [
      '系统把委托弄丢了',
      '市场价格一直没跌到 7.60 元，没人愿意用这个价格卖给我',
      '限价单到期会自动变成市价单',
      '现金被冻结了，所以买不了',
    ],
    correct: 1,
    wrongExplain: '限价单只在「市场价格到达你的报价」时成交。这几天松果食品一直在 8.20 元以上，远高于 7.60 元，所以一直未成交。委托可以撤销，资金会解冻。',
    rightExplain: '委托 ≠ 成交：价格不合适，委托就一直等待。现在去体验市价单的「立即成交」吧（注意成交时的佣金）。',
    onCorrect: () => { ctx.st.tasks.sub = 'marketBuy'; toast('现在用「市价」买入 1 手松果食品'); },
  });
}

// ---------- 第 5 课：盘口 ----------
function quizBook(ctx) {
  runQuiz(ctx, {
    question: '你之前挂的 7.60 元限价买入单一直不成交。从盘口看，根本原因是？',
    options: [
      '系统没有接受这笔委托',
      '卖一价远高于 7.60 元——没有卖家愿意这个价格卖，买单只能排队等',
      '限价单每天都会被自动撤掉',
      '7.60 元超出了涨跌停范围',
    ],
    correct: 1,
    wrongExplain: '打开「盘口」看看：买一、卖一都在 8 元上方，7.60 元远低于卖一，你的买单排在很后面。委托没有被拒绝，只是在排队；7.60 元也在当日涨跌停范围之内。',
    rightExplain: '买一 / 卖一之差是价差（spread）；价格不合适就排队。市价单 = 直接接受卖一价（买入时），所以立即成交。',
    onCorrect: () => completeTask(ctx, 't5'),
  });
}

// ---------- 第 6 课：T+1 与涨跌停 ----------
function t1RuleModal(ctx) {
  const st = ctx.st;
  log(st, 'decision', '体验了 T+1：当日买入的股票，当天卖出被规则拒绝。');
  showModal({
    title: '规则：T+1',
    bodyHTML: `
      <p>卖出被拒绝了——这不是故障，是 <b>T+1 规则</b>：<b>当日买入的股票，下一个交易日才能卖出</b>。</p>
      <p>看持仓表的「可卖」列：今天刚买的部分显示为 0，明天才会解冻。昨天以前买入的部分不受影响。</p>
      <div class="example">T+1 让「今天买、今天卖」的日内交易不可行——买之前要想清楚，因为当天没有反悔的机会。</div>`,
    buttons: [{ label: '明白了', primary: true, onClick: () => {
      st.tasks.sub = st.day >= 9 ? 'tryBuyFirefly' : 'waitD9';
      if (st.day >= 9) toast('萤火科技今天有动静——去「交易」面板看看');
    } }],
  });
}

function t1SellFilledModal(ctx) {
  showModal({
    title: '卖出成交了？看看你卖了什么',
    bodyHTML: `
      <p>这笔卖出成交了——但你卖掉的是<b>之前买入、已解冻</b>的部分；今天刚买的那 100 股仍然冻结着。</p>
      <p>看持仓表的「可卖」列，现在它变成了 0。<b>再试一次卖出</b>，就会撞上 T+1 规则。</p>`,
    buttons: [{ label: '再试一次卖出', primary: true }],
  });
}

function limitUpModal(ctx) {
  const st = ctx.st;
  log(st, 'decision', '体验了涨停：萤火科技 +10% 涨停，当日买入被规则拒绝。');
  showModal({
    title: '规则：涨跌停',
    bodyHTML: `
      <p>买入被拒绝了——萤火科技今天<b>涨停</b>（相对昨收 <b>+10%</b>）。</p>
      <p>涨停时，买单在涨停价上排起长队、几乎没人卖出，本模拟中涨停日不可买入；反过来，<b>跌停日不可卖出</b>。一天的波动被限制在前收的 ±10% 以内。</p>
      <div class="example warn">注意你的感受：「买不到了」反而更想买——这就是 FOMO（害怕错过）。记住它，第 25 课还会见面。</div>`,
    buttons: [{ label: '明白了', primary: true, onClick: () => completeTask(ctx, 't6') }],
  });
}

function limitUpFallbackModal(ctx) {
  showModal({
    title: '涨停已经打开',
    bodyHTML: `
      <p>这笔买入成交了——涨停只持续了第 9 天一天，现在价格回落、可以买了。</p>
      <p>回想第 9 天：涨停时买单排队、<b>当日不可买入</b>；涨跌停把一天的波动限制在前收 ±10% 以内。打开行情面板可以回看那根涨停 K 线。</p>`,
    buttons: [{ label: '明白了', primary: true, onClick: () => completeTask(ctx, 't6') }],
  });
}

// ---------- 第 7 课：读图 ----------
function quizChart(ctx) {
  const st = ctx.st;
  const bars = ctx.market.pinecone;
  const best = bestGainDay(ctx.market, 'pinecone', st.day);
  const bestV = (bars[best - 1].close - bars[best - 2].close) / bars[best - 2].close;
  const rng = mulberry32(st.seed + st.day * 131);
  const pool = [];
  for (let d = 2; d <= st.day; d++) if (d !== best) pool.push(d);
  const others = [];
  while (others.length < 3 && pool.length) others.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  const opts = [best, ...others];
  for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; }
  runQuiz(ctx, {
    question: '打开「行情」面板看松果食品的 K 线：到目前为止，哪一天涨幅最大？',
    options: opts.map(d => `第 ${d} 天`),
    correct: opts.indexOf(best),
    wrongExplain: '涨跌幅 =（当日收盘 − 前日收盘）÷ 前日收盘。对照 K 线：红色长实体、且下方百分比数字最大的那天，再试一次。',
    rightExplain: `第 ${best} 天涨幅最大（${(bestV * 100).toFixed(2)}%）。你刚刚做的是「读图」——还原已经发生的事。它不能用来确定地预测未来。`,
    onCorrect: () => completeTask(ctx, 't7'),
  });
}

// ---------- 第 8 课：指数 ----------
function indexInfoModal(ctx) {
  const st = ctx.st;
  const rows = ['pinecone', 'beaver', 'firefly'].map(id => {
    const co = companyById(id);
    return { name: co.name, cap: quote(ctx.market, id, st.day).close * co.shares };
  });
  const total = rows.reduce((s, r) => s + r.cap, 0);
  const body = rows.map(r =>
    `<div class="kv"><span class="k">${r.name}</span><span class="v">市值 ${fmtCap(r.cap)}元 · 权重 ${(r.cap / total * 100).toFixed(1)}%</span></div>`).join('');
  const buttons = [{ label: '关闭' }];
  if (st.tasks.active === 't8') buttons.unshift({ label: '开始答题', primary: true, onClick: () => quizIndex(ctx) });
  showModal({
    title: `小镇综指 · 第 ${st.day} 天`,
    bodyHTML: `<p>综指把三家公司按<b>市值加权</b>合成一个数字，第 1 天 = 1000 点。市值越大，权重越高：</p>${body}`,
    buttons,
  });
}

function quizIndex(ctx) {
  const st = ctx.st;
  const caps = ['pinecone', 'beaver', 'firefly'].map(id =>
    `${companyById(id).name} ${fmtCap(quote(ctx.market, id, st.day).close * companyById(id).shares)}`);
  runQuiz(ctx, {
    question: '假如今天：松果食品 −2%、河狸物流 +3%、萤火科技持平。小镇综指（市值加权）最可能？',
    options: [
      '上涨——河狸物流市值最大、权重最高',
      '下跌——有一家公司跌了 2%',
      '持平——一涨一跌刚好抵消',
      '无法判断——指数和个股无关',
    ],
    correct: 0,
    wrongExplain: `看市值权重（当前约：${caps.join('、')}）。河狸物流市值最大，它 +3% 对指数的拉动，超过市值较小的松果 −2% 的拖累。`,
    rightExplain: `市值加权 = 大块头说话声音大。当前市值约：${caps.join('、')}——河狸权重最高，它涨 3%，指数大概率上涨。`,
    onCorrect: () => completeTask(ctx, 't8'),
  });
}

// ---------- 第 9 课：除权除息 ----------
function exdivExplain(ctx) {
  const st = ctx.st;
  st.flags.exdivShown = true;
  const p = st.positions[DIVIDEND.symbol];
  const shares = p?.shares || 0;
  const credit = round2(shares * DIVIDEND.perShare);
  log(st, 'event', '除息日教学：股价 −0.20 元/股，红利 +0.20 元/股，总资产不变。');
  showModal({
    title: '第 13 天 · 除息日：算一笔账',
    bodyHTML: shares > 0 ? `
      <p>你持有 <b>${shares} 股</b>松果食品：</p>
      <div class="example">
        · 现金：红利到账 <b>+${credit.toFixed(2)} 元</b>（${shares} 股 × 0.20 元）<br>
        · 股价：较前收下调 0.20 元 → 持仓市值 <b>−${credit.toFixed(2)} 元</b><br>
        · 一加一减，<b>总资产不变</b>
      </div>
      <p>分红不是白赚——公司账上的钱变成了你账上的钱，股价相应扣掉。</p>` : `
      <p>这局你目前没有持有松果食品，用一个例子算账：假如持有 100 股——</p>
      <div class="example">
        · 现金：红利到账 <b>+20.00 元</b>（100 股 × 0.20 元）<br>
        · 股价：较前收下调 0.20 元 → 持仓市值 <b>−20.00 元</b><br>
        · 一加一减，<b>总资产不变</b>
      </div>
      <p>分红不是白赚——公司账上的钱变成了你账上的钱，股价相应扣掉。</p>`,
    buttons: [{ label: '我来答题验证', primary: true, onClick: () => quizExDiv(ctx) }],
  });
}

function quizExDiv(ctx) {
  const st = ctx.st;
  const p = st.positions[DIVIDEND.symbol];
  const shares = p?.shares || 0;
  const credit = round2((shares || 100) * DIVIDEND.perShare);
  runQuizNum(ctx, {
    question: shares > 0
      ? `你持有 ${shares} 股松果食品。除息日红利实际到账多少元？（可对照时间线里的「红利到账」记录）`
      : '假如持有 100 股松果食品，除息日红利到账多少元？',
    unit: '元',
    answer: credit,
    wrongExplain: `红利 = 持股 × 每股 ${DIVIDEND.perShare.toFixed(2)} 元。再算一次。`,
    rightExplain: '现金多了、市值少了，总资产不变。所以「抢在登记日买入等分红」并不稳赚——除息后股价已经扣掉了红利。',
    onCorrect: () => completeTask(ctx, 't9'),
  });
}

// ---------- 第四章 · K 线形态 ----------
// t10：点第 15（大阳）/16（大阴）两根蜡烛
function candleBodyModal(ctx, day) {
  const st = ctx.st;
  st.flags.candles = st.flags.candles || {};
  st.flags.candles[day] = true;
  const both = st.flags.candles[15] && st.flags.candles[16];
  const isYang = day === 15;
  showModal({
    title: isYang ? '第 15 天 · 大阳线：买方完胜' : '第 16 天 · 大阴线：卖方完胜',
    bodyHTML: isYang
      ? `<p>开盘 ≈ 前收，收盘大涨 <b>+4.5%</b>，实体很长——买方从开盘赢到收盘，几乎没遇到抵抗。</p>
         <p>读法：<b>实体越长，胜利越干脆</b>。大阳线说明这一天想买的人占压倒性优势。</p>`
      : `<p>开盘还撑在高位，收盘大跌 <b>−4.5%</b>，长阴线——卖方反攻，把昨天的涨幅吐回去大半。</p>
         <p>两根线连起来读：昨天买方完胜、今天卖方完胜——<b>单根 K 线只说明当天谁赢，不说明明天</b>。</p>`,
    buttons: [{ label: both ? '完成本课' : '再点另一根高亮蜡烛', primary: true, onClick: both ? () => completeTask(ctx, 't10') : null }],
  });
}

// t11：点第 18（长上影）/20（十字星）两根蜡烛
function candleWickModal(ctx, day) {
  const st = ctx.st;
  st.flags.wicks = st.flags.wicks || {};
  st.flags.wicks[day] = true;
  const both = st.flags.wicks[18] && st.flags.wicks[20];
  const isShadow = day === 18;
  showModal({
    title: isShadow ? '第 18 天 · 长上影：冲高了，没守住' : '第 20 天 · 十字星：多空平手',
    bodyHTML: isShadow
      ? `<p>盘中一度冲高 <b>+3% 以上</b>，收盘却只涨一点点——上影线的顶端，就是当天买方「到过但没能守住」的位置。</p>
         <p>读法：长上影 = 上方有人卖。它是一张「战况记录」，不是预言。</p>`
      : `<p>开盘和收盘几乎相同，实体缩成一条线——全天冲高又回落、探底又拉回，多空打成平手。</p>
         <p>读法：十字星 = 犹豫。出现在一段趋势之后，说明原有的力量开始松动。</p>`,
    buttons: [{ label: both ? '完成本课' : '再点另一根高亮蜡烛', primary: true, onClick: both ? () => completeTask(ctx, 't11') : null }],
  });
}

// t13：点第 29 天蜡烛确认缺口
function gapPickModal(ctx) {
  const st = ctx.st;
  const b28 = ctx.market.pinecone[27], b29 = ctx.market.pinecone[28];
  showModal({
    title: '第 29 天 · 跳空缺口',
    bodyHTML: `
      <p>第 28 天最高 <b>${b28.high.toFixed(2)}</b> 元，第 29 天最低 <b>${b29.low.toFixed(2)}</b> 元——中间这段价格<b>没有任何成交</b>，图上留下一个空档，这就是「跳空缺口」。</p>
      <p>想买的人一夜之间变多，只有出到更高的价格才排得上队。缺口是情绪的脚印。</p>`,
    buttons: [{ label: '完成本课', primary: true, onClick: () => completeTask(ctx, 't13') }],
  });
}

// t15：形态小结
function quizPatternLimit(ctx) {
  runQuiz(ctx, {
    question: '回看两次预测验证：看涨吞没之后真涨了，暮星之后却不跌反涨。这说明？',
    options: [
      '形态信号有统计倾向，但不保证未来——只能当风险提示，不能当买卖指令',
      '吞没形态比暮星形态可靠，以后只信吞没',
      '只要严格按形态操作，就能稳定盈利',
      '这两次都是巧合，形态完全没有参考价值',
    ],
    correct: 0,
    wrongExplain: '两次验证一次对、一次错——这正好说明形态是「倾向」而非「保证」。完全不信和全信，都走过头了。',
    rightExplain: '答对了。形态描述的是多空力量的变化，它改变不了消息、资金和基本面。用它做「风险提示」可以，用它做「买卖指令」不行。',
    onCorrect: () => completeTask(ctx, 't15'),
  });
}

// ---------- 第五章 · 量价与指标 ----------
// t16：点第 39 天蜡烛读量柱
function volumePickModal(ctx) {
  const st = ctx.st;
  const b = ctx.market.pinecone[38];
  const prevVol = ctx.market.pinecone.slice(33, 38).reduce((s, x) => s + x.volume, 0) / 5;
  showModal({
    title: '第 39 天 · 量柱突然变高',
    bodyHTML: `
      <p>第 39 天成交约 <b>${fmtVolume(b.volume)}</b> 股，是前几天均量（约 ${fmtVolume(Math.round(prevVol))} 股）的近 3 倍——这就是「放量」。</p>
      <p>价格是结果，成交量是参与度：量突然放大，说明「有事情发生」或分歧加大。这一天价格几乎没动——记住这个组合，下一课要用。</p>`,
    buttons: [{ label: '完成本课', primary: true, onClick: () => completeTask(ctx, 't16') }],
  });
}

// t17：量价背离 quiz
function quizVolPrice(ctx) {
  runQuiz(ctx, {
    question: '第 39–41 天：松果连续三天明显放量，收盘价却几乎不动。这种「放量滞涨」最合理的解读是？',
    options: [
      '上方卖压沉重——放量都推不动价格，可能有人在借人气出货，值得警惕',
      '放量说明买方很强，马上要大涨',
      '量涨价不动，说明这只股票没人要',
      '成交量和价格从来没有任何关系',
    ],
    correct: 0,
    wrongExplain: '「放量」说明交易火爆、参与的人多；「滞涨」说明这么多成交却推不动价格——上方有沉重的卖单在接应。这不是强势，是值得警惕的背离。',
    rightExplain: '量价配合（上涨放量、回调缩量）相对健康；量价背离（放量滞涨、缩量新高）都值得多问一句「为什么」。量能为价格「作证」，也能「拆台」。',
    onCorrect: () => completeTask(ctx, 't17'),
  });
}

// t18：解锁均线 + 答题
function maOnboard(ctx) {
  const st = ctx.st;
  if (!st.flags.maShown) {
    st.flags.maShown = true;
    st.unlocked.ma = true;
    log(st, 'task', '行情图已叠加均线 MA5 / MA10 / MA20。');
    toast('解锁：均线 MA5 / MA10 / MA20');
  }
  showConcept(ctx, 'maCard');
}

function quizMA(ctx) {
  runQuiz(ctx, {
    question: '当价格站在 MA20 上方，且 MA5、MA10、MA20 依次向上发散，说明？',
    options: [
      '近一段时间趋势偏强——但这只是对过去的描述，不保证明天继续涨',
      '明天一定会涨，可以全仓买入',
      '均线只是图上的装饰，没有信息量',
      '说明这家公司的利润正在增长',
    ],
    correct: 0,
    wrongExplain: '均线由历史价格算出，描述的是「已经发生的趋势」；它不含公司利润信息，更预测不了明天。但它的确把「最近谁占优」熨平成了可读的形状。',
    rightExplain: '对——均线是「后视镜」：帮你把噪声熨平、看清已发生的趋势，但挡风玻璃外的路它看不见。',
    onCorrect: () => completeTask(ctx, 't18'),
  });
}

// t20：解锁 MACD + 答题
function macdOnboard(ctx) {
  const st = ctx.st;
  if (!st.flags.macdShown) {
    st.flags.macdShown = true;
    st.unlocked.macd = true;
    log(st, 'task', '行情图下方已出现 MACD 副图（DIF / DEA / 柱体）。');
    toast('解锁：MACD 副图');
  }
  showConcept(ctx, 'macdCard');
}

function quizMACD(ctx) {
  runQuiz(ctx, {
    question: 'MACD 柱由绿转红（DIF 上穿 DEA），表示？',
    options: [
      '短期动能在增强——但它由历史价格推导，不保证未来',
      '公司内部一定发生了利好',
      '接下来一周必定上涨',
      '成交量正在萎缩',
    ],
    correct: 0,
    wrongExplain: 'MACD 完全由历史价格推导：它描述动能变化，不涉及公司消息，也不含成交量信息。「柱由绿转红」= 短期动能在增强，仅此而已。',
    rightExplain: '对。MACD 是仪表盘不是水晶球：震荡行情里它会反复金叉死叉（「钝化」），信号需要结合环境判断。',
    onCorrect: () => completeTask(ctx, 't20'),
  });
}

// t21：指标的局限
function quizIndicatorLimit(ctx) {
  runQuiz(ctx, {
    question: '回顾三次预测验证（吞没对了、暮星错了、金叉撞上传闻），对技术指标最诚实的态度是？',
    options: [
      '指标描述过去的统计倾向，不能告诉你涨跌的原因，更不能保证未来——可当风险提示，不可当买卖指令',
      '只要多个指标同时发出信号，就一定能赚钱',
      '指标既然会错，就一点用都没有',
      '指标失灵只是因为参数没调好，调好就稳了',
    ],
    correct: 0,
    wrongExplain: '三次验证的结果（对 / 错 / 因果错位）正是答案本身：指标有统计倾向，但不告诉你「为什么」。全信和全不信，都不是诚实态度。',
    rightExplain: '这就是本课程的诚实结论：信号有统计倾向，但不保证未来。把它当「风险提醒」和「复盘工具」，而不是「预测神器」。',
    onCorrect: () => completeTask(ctx, 't21'),
  });
}

// ---------- 第六章 · 基本面与风险（新增课） ----------
// t24：估值浅识 PE
function quizPE(ctx) {
  runQuizNum(ctx, {
    question: '松果食品当前市值约 10.4 亿元，去年净利润约 0.52 亿元。它的市盈率 PE 是多少倍？（PE = 市值 ÷ 净利润）',
    unit: '倍',
    answer: 20,
    wrongExplain: 'PE = 市值 ÷ 净利润 = 10.4 ÷ 0.52 = 20 倍。再算一次。',
    rightExplain: 'PE ≈ 20 倍：按现在的利润水平，20 年回本。对照：河狸约 16 倍、萤火约 100 倍——萤火的高 PE 里装着市场预期，也装着波动。PE 要同行业对比着看。',
    onCorrect: () => completeTask(ctx, 't24'),
  });
}

// t28：毕业·信号成绩单
function graduateReviewModal(ctx) {
  const st = ctx.st;
  st.flags.gradReviewShown = true;
  const rows = Object.entries(PREDICTIONS).map(([id, P]) => {
    const rec = st.flags.predictions?.[id];
    if (!rec) return `<div class="kv"><span class="k">${P.name}</span><span class="v">未完成</span></div>`;
    const v = rec.phase === 'resolved' ? { right: '✓ 对', wrong: '✗ 错', half: '～ 半对' }[rec.verdict] : '待验证';
    return `<div class="kv"><span class="k">${P.name}（第 ${rec.day0}→${rec.resolveDay} 天）</span><span class="v">${CHOICES[rec.choice]} → ${v}</span></div>`;
  }).join('');
  const p = st.stats?.predictions || { right: 0, wrong: 0, half: 0 };
  showModal({
    title: '你的信号成绩单',
    bodyHTML: `
      ${rows}
      <div class="example">三次预测：<b>${p.right} 对 / ${p.wrong} 错 / ${p.half} 半对</b>。记住这个手感：<b>信号有统计倾向，但不保证未来</b>——这就是我们对待一切「技术分析」的诚实态度。</div>`,
    buttons: [{ label: '领取毕业报告', primary: true, onClick: () => completeTask(ctx, 't28') }],
  });
}

// ---------- 第 22 课：传闻 vs 公告 ----------
function startEvent(ctx) {
  const st = ctx.st;
  st.flags.eventStarted = true;
  log(st, 'event', '传闻：「松果食品新品卖爆了，利润要翻倍！」镇上议论纷纷。');
  showModal({
    title: EVENT_RUMOR.title,
    bodyHTML: EVENT_RUMOR.body,
    buttons: [{ label: '开始调查', primary: true, onClick: () => investigateModal(ctx) }],
  });
}

function investigateModal(ctx) {
  const st = ctx.st;
  const left = st.flags.investigationLeft;
  const done = Object.values(INVESTIGATIONS).filter(iv => st.flags.investigated[iv.key]);
  const opts = Object.values(INVESTIGATIONS).filter(iv => !st.flags.investigated[iv.key]);
  const card = showModal({
    title: `深入调查（还剩 ${left} 次机会）`,
    bodyHTML: `
      ${done.map(iv => `<div class="example"><b>${iv.name}</b><br>${iv.result}</div>`).join('')}
      ${left > 0 ? `<p>选择下一个调查方向：</p>` : '<p><b>调查机会用完了。</b></p>'}`,
    buttons: left > 0 ? [] : [{ label: '作出决定', primary: true, onClick: () => decisionModal(ctx) }],
  });
  if (left > 0) {
    const box = card.querySelector('.modal-btns');
    opts.forEach(iv => {
      const b = document.createElement('button');
      b.className = 'btn'; b.textContent = iv.name;
      b.addEventListener('click', () => ctx.dispatch('investigate', { key: iv.key }));
      box.appendChild(b);
    });
  }
}

function decisionModal(ctx) {
  const card = showModal({
    title: '作出决定',
    bodyHTML: '<p>基于你调查到的信息，你的决定是？（决定本身没有对错，重要的是依据）</p>',
  });
  const box = card.querySelector('.modal-btns');
  [['buy', '买入松果食品'], ['observe', '继续观察，暂不买入']].forEach(([k, label]) => {
    const b = document.createElement('button');
    b.className = 'btn' + (k === 'buy' ? ' primary' : '');
    b.textContent = label;
    b.addEventListener('click', () => reasonModal(ctx, k));
    box.appendChild(b);
  });
}

function reasonModal(ctx, decision) {
  const reasons = [
    ['rumor', '传闻说利润要翻倍'],
    ['sales', '销售数据确认了增长'],
    ['cost', '成本上升可能吃掉利润'],
    ['wait', '信息不足，先谨慎一点'],
  ];
  const card = showModal({
    title: '最主要的依据是？',
    bodyHTML: `<p>你选择了「${decision === 'buy' ? '买入' : '观望'}」。哪个理由最接近你的想法？（会记入你的研究日志）</p>`,
  });
  const box = card.querySelector('.modal-btns');
  reasons.forEach(([k, label]) => {
    const b = document.createElement('button');
    b.className = 'btn'; b.textContent = label;
    b.addEventListener('click', () => ctx.dispatch('decide', { decision, reason: k }));
    box.appendChild(b);
  });
}

// ---------- 第 11 课：财报 ----------
function earningsPre(ctx) {
  const st = ctx.st;
  st.flags.earningsShown = true;
  showModal({
    title: CONCEPTS.earnings.title,
    bodyHTML: CONCEPTS.earnings.body,
    buttons: [{ label: '查看财报', primary: true, onClick: () => showEarnings(ctx) }],
  });
}

function showEarnings(ctx) {
  const st = ctx.st;
  log(st, 'event', '松果食品财报：营收 +32%，净利润 −18%（原材料成本上升）。');
  showModal({
    title: EVENT_EARNINGS.title,
    bodyHTML: EVENT_EARNINGS.body,
    buttons: [{ label: '查看复盘', primary: true, onClick: () => ctx.dispatch('openReview') }],
  });
}

// ---------- 第 12 课：仓位与集中度 ----------
function shockModal(ctx) {
  const st = ctx.st;
  if (!st.flags.shockShown) log(st, 'event', `行业冲击：进口坚果关税上调，松果食品 ${(dayChangePct(ctx.market, 'pinecone', st.day) * 100).toFixed(2)}%；河狸、萤火未受直接影响。`);
  st.flags.shockShown = true;
  const pP = dayChangePct(ctx.market, 'pinecone', st.day);
  const pB = dayChangePct(ctx.market, 'beaver', st.day);
  const pF = dayChangePct(ctx.market, 'firefly', st.day);
  const avg = (pP + pB + pF) / 3;
  const pct = v => (v * 100).toFixed(2) + '%';
  showModal({
    title: '行业冲击：进口坚果关税上调',
    bodyHTML: `
      <p>今天的消息只利空食品行业。算一笔对比账——同样 10 万元本金，两种持法今天的变化：</p>
      <div class="example">
        <b>账户 A：全仓松果食品</b> → 今天 <b>${pct(pP)}</b><br>
        <b>账户 B：松果 / 河狸 / 萤火各三分之一</b> → 今天 <b>${pct(avg)}</b>（${pct(pP)} / ${pct(pB)} / ${pct(pF)} 的平均）
      </div>
      <p>同一条新闻，集中持仓的账户被直接击中；分散持有的账户只有三分之一受伤。<b>现在轮到你了：把手里的持仓也变得分散一些。</b></p>`,
    buttons: [{ label: '继续', primary: true, onClick: () => {
      st.tasks.sub = 'diversify';
      if ((st.positions.beaver?.shares || 0) >= 100) {
        toast('你已持有河狸物流——持仓已分散');
        quizShock(ctx);
      } else {
        toast('去「交易」面板真实买入 1 手河狸物流');
      }
    } }],
  });
}

// 现金不足时的例账兜底（不卡关）
function shockCalcQuiz(ctx) {
  const pP = dayChangePct(ctx.market, 'pinecone', ctx.st.day);
  const ans = round2(100000 * Math.abs(pP));
  runQuizNum(ctx, {
    question: `例账代替：账户 A 全仓松果食品 10 万元，今天松果 ${(pP * 100).toFixed(2)}%，A 账户今天约亏多少元？`,
    unit: '元',
    answer: ans,
    wrongExplain: `亏损 ≈ 100000 × ${(Math.abs(pP) * 100).toFixed(2)}% ≈ ${ans} 元。再算一次。`,
    rightExplain: `全仓松果一天波动约 ${ans} 元；如果三等分持有，同样的新闻只击中三分之一。`,
    onCorrect: () => quizShock(ctx),
  });
}

function quizShock(ctx) {
  runQuiz(ctx, {
    question: '这次行业冲击的对比，说明什么？',
    options: [
      '集中持有一只股票，行业的风吹草动会直接放大账户波动；分散持有能摊薄这种冲击',
      '以后只买物流股就不会亏',
      '关税消息是随机的，和持仓方式无关',
      '分散持有的目的是买到更多涨停股',
    ],
    correct: 0,
    wrongExplain: '分散不是「买得更多」，而是「不把所有钱押在同一个风险上」。行业利空只打击一个行业时，分散持有的账户波动明显更小。',
    rightExplain: '仓位管理的第一课：集中度决定了你对单一行业消息的暴露程度。全仓一只 = 把账户交给一个行业的运气。',
    onCorrect: () => completeTask(ctx, 't26'),
  });
}

// ---------- 第 27 课：回撤与不摊平 ----------
function avgCalcQuiz(ctx) {
  runQuizNum(ctx, {
    question: '松果食品从 10.70 元一路跌到 9.50 元附近。如果你 10.70 元买了 100 股，再在 9.50 元补 100 股，平均成本是多少元？',
    unit: '元',
    answer: 10.10,
    wrongExplain: '平均成本 = 总花费 ÷ 总股数 = (10.70×100 + 9.50×100) ÷ 200 = 10.10 元。再算一次。',
    rightExplain: '(1070 + 950) ÷ 200 = 10.10 元——数字确实「好看」了。但公司因此变好了吗？接下来做一个真实的选择。',
    onCorrect: () => avgDownModal(ctx),
  });
}

function tryRealAvgDown(ctx) {
  const st = ctx.st;
  const price = quote(ctx.market, 'pinecone', st.day).close;
  const need = round2(price * 100 + fee(price * 100));
  if (st.cash >= need) {
    ctx.dispatch('placeOrder', { symbol: 'pinecone', side: 'buy', kind: 'market', price: null, lots: 1 });
    const last = st.trades[st.trades.length - 1];
    if (last && last.side === 'buy' && last.symbol === 'pinecone' && last.day === st.day) {
      log(st, 'decision', `真实补仓：市价买入松果食品 100 股 @ ${last.price.toFixed(2)} 元。`);
      closeModal();
      avgReasonModal(ctx, 'average');
      return;
    }
  }
  showModal({
    title: '无法真实补仓',
    bodyHTML: `<p>买入 1 手松果食品约需 ${need.toFixed(2)} 元，你的可用现金不足——本课用例账完成，不影响进度。</p>`,
    buttons: [{ label: '继续', primary: true, onClick: () => avgReasonModal(ctx, 'average') }],
  });
}

function avgDownModal(ctx) {
  const st = ctx.st;
  st.flags.avgAsked = true;
  const card = showModal({
    title: '要不要「补仓摊低成本」？',
    bodyHTML: `
      <p>松果食品从 10.70 元一路跌到 9.50 元附近。如果你持有它，账面是浮亏的。</p>
      <p>这时候常有人说：<b>「再买点，成本就摊低了，回本更容易。」</b>你认同吗？</p>
      <p style="color:var(--muted);font-size:13px">选「补仓」会尝试<b>真实买入</b> 1 手松果（现金不足则自动改为例账，绝不卡关）；选「不认同」直接说依据。都会记入研究日志。</p>`,
  });
  const box = card.querySelector('.modal-btns');
  [['average', '认同，补仓摊低成本（真实买入）'], ['hold', '不认同，先重新评估']].forEach(([k, label]) => {
    const b = document.createElement('button');
    b.className = 'btn'; b.textContent = label;
    b.addEventListener('click', () => {
      if (k === 'average') tryRealAvgDown(ctx);
      else { closeModal(); avgReasonModal(ctx, k); }
    });
    box.appendChild(b);
  });
}

function avgReasonModal(ctx, choice) {
  const reasons = choice === 'average'
    ? [['recover', '成本变低，反弹一点就能回本'], ['faith', '重新评估后仍看好公司'], ['deny', '只是不想承认亏损']]
    : [['facts', '财报变差是事实，不能把更多钱押给同一个正在变差的判断'], ['cash', '先看清楚，现金也是一种持仓']];
  const card = showModal({
    title: '最主要的依据是？',
    bodyHTML: `<p>你选择了「${choice === 'average' ? '补仓摊低' : '暂不补仓'}」。哪个理由最接近你的想法？</p>`,
  });
  const box = card.querySelector('.modal-btns');
  reasons.forEach(([k, label]) => {
    const b = document.createElement('button');
    b.className = 'btn'; b.textContent = label;
    b.addEventListener('click', () => {
      const st = ctx.st;
      st.flags.avgChoice = choice; st.flags.avgReason = k;
      const cText = choice === 'average' ? '补仓摊低成本' : '暂不补仓、重新评估';
      log(st, 'decision', `回撤抉择：${cText}。依据：${label}`);
      closeModal();
      showModal({
        title: '关于「摊平」',
        bodyHTML: `
          <p>「摊低成本」让平均买入价的数字变好看了，但本质是<b>把更多钱押给同一个正在变差的判断</b>——回本执念不改变公司基本面。</p>
          <p>当然，如果重新评估后仍看好，买入也成立；关键是<b>依据</b>，而不是「摊平」这个动作本身。你的选择已记入研究日志，复盘时可以看到。</p>`,
        buttons: [{ label: '完成本课', primary: true, onClick: () => completeTask(ctx, 't27') }],
      });
    });
    box.appendChild(b);
  });
}

// ---------- 第 25 课：FOMO ----------
function boardCheckModal(ctx) {
  showModal({
    title: '公告栏',
    bodyHTML: `
      <p>${boardText(ctx.st.day)}</p>
      <p>你翻遍了公告栏：<b>没有任何关于萤火科技的官方公告</b>。股价两天脉冲近 15%，只有论坛热帖在传「AI 灯具海外大卖」。</p>
      <p style="color:var(--muted);font-size:13px">这情形眼熟吗？第 51 天松果食品的传闻脉冲，也是「有传闻、没公告」。</p>`,
    buttons: [{ label: '我查过了，做决定吧', primary: true, onClick: () => fomoModal(ctx) }],
  });
}

function tryRealChase(ctx) {
  const st = ctx.st;
  const price = quote(ctx.market, 'firefly', st.day).close;
  const need = round2(price * 100 + fee(price * 100));
  if (st.cash >= need) {
    ctx.dispatch('placeOrder', { symbol: 'firefly', side: 'buy', kind: 'market', price: null, lots: 1 });
    const last = st.trades[st.trades.length - 1];
    if (last && last.side === 'buy' && last.symbol === 'firefly' && last.day === st.day) {
      log(st, 'decision', `真实追买：市价买入萤火科技 100 股 @ ${last.price.toFixed(2)} 元。`);
      closeModal();
      fomoReasonModal(ctx, 'chase');
      return;
    }
  }
  showModal({
    title: '想追，但追不了——满仓的代价',
    bodyHTML: `
      <p>买入 1 手萤火科技约需 ${need.toFixed(2)} 元，你的可用现金只有 ${st.cash.toFixed(2)} 元。</p>
      <p>这正是「满仓」的代价：机会（或陷阱）出现时，你连选择权都没有。<b>手里留点现金，本身就是一种仓位策略。</b></p>
      <p style="color:var(--muted);font-size:13px">本课用例账完成，不影响进度。</p>`,
    buttons: [{ label: '继续', primary: true, onClick: () => fomoReasonModal(ctx, 'chase') }],
  });
}

function fomoModal(ctx) {
  const st = ctx.st;
  if (!st.flags.fomoShown) {
    log(st, 'event', '传闻又起：「萤火科技 AI 灯具海外大卖！」股价两日脉冲，公告栏没有官方消息。');
  }
  st.flags.fomoShown = true;
  const card = showModal({
    title: '传闻脉冲：追，还是不追？',
    bodyHTML: `
      <p>论坛热帖：<b>「萤火科技 AI 灯具海外大卖！」</b>股价两天涨了近 15%，镇上一片「再不上车就晚了」。公告栏依旧没有官方消息。</p>
      <p>你怎么办？（买不买由你，重要的是依据——会记入研究日志）</p>
      <p style="color:var(--muted);font-size:13px">选「追买」会尝试<b>真实买入</b> 1 手萤火（现金不足则自动改为例账，绝不卡关）。</p>`,
  });
  const box = card.querySelector('.modal-btns');
  [['chase', '追买——怕错过这波（真实买入）'], ['wait', '不追——先查证再说']].forEach(([k, label]) => {
    const b = document.createElement('button');
    b.className = 'btn'; b.textContent = label;
    b.addEventListener('click', () => {
      if (k === 'chase') tryRealChase(ctx);
      else { closeModal(); fomoReasonModal(ctx, k); }
    });
    box.appendChild(b);
  });
}

function fomoReasonModal(ctx, choice) {
  const reasons = choice === 'chase'
    ? [['crowd', '大家都在买，应该是真的'], ['pattern', '上次发布会就涨过，这次也行'], ['small', '只用小仓位试，错了认栽']]
    : [['noAnn', '没有官方公告，和第 51 天的传闻一个套路'], ['late', '涨完才看到，追进去价格已经高了']];
  const card = showModal({
    title: '最主要的依据是？',
    bodyHTML: `<p>你选择了「${choice === 'chase' ? '追买' : '不追'}」。哪个理由最接近你的想法？</p>`,
  });
  const box = card.querySelector('.modal-btns');
  reasons.forEach(([k, label]) => {
    const b = document.createElement('button');
    b.className = 'btn'; b.textContent = label;
    b.addEventListener('click', () => {
      const st = ctx.st;
      st.flags.fomoChoice = choice; st.flags.fomoReason = k;
      log(st, 'decision', `FOMO 抉择：${choice === 'chase' ? '追买传闻脉冲' : '不追、先查证'}。依据：${label}`);
      closeModal();
      completeTask(ctx, 't25');
    });
    box.appendChild(b);
  });
}

// ---------- 毕业 ----------
function graduateModal(ctx) {
  const st = ctx.st;
  const p = st.stats?.predictions || { right: 0, wrong: 0, half: 0 };
  showModal({
    title: '第一阶段毕业！',
    bodyHTML: `
      <p>你已系统学完<b>六章二十八课</b>：</p>
      <p>· <b>股票与回报</b>：股票是什么、市值比较、价差与分红<br>
         · <b>交易规则</b>：委托成交、盘口价差、T+1、涨跌停、费用<br>
         · <b>读懂市场</b>：K 线、小镇指数、除权除息<br>
         · <b>K 线形态</b>：单根 K 线、组合、缺口、形态——及它们的边界<br>
         · <b>量价与指标</b>：成交量、量价背离、均线、金叉死叉、MACD——及指标的局限<br>
         · <b>基本面与风险</b>：传闻 vs 公告、财报三要素、估值浅识、仓位、不摊平、FOMO</p>
      <div class="example">三次预测验证：<b>${p.right} 对 / ${p.wrong} 错 / ${p.half} 半对</b>——信号有统计倾向，但不保证未来。</div>
      <p>「复盘」页的<b>我的日志</b>记录了你所有的决策与理由，可以导出保存。</p>
      <p>后续阶段（本原型之外）：</p>
      <p>${STAGE_TEASER.map(s => `· ${s}`).join('<br>')}</p>`,
    buttons: [{ label: '继续自由练习', primary: true }],
  });
}

// ---------- 完成任务 ----------
const NEXT = {
  t1: 't2', t2: 't3', t3: 't4', t4: 't5', t5: 't6', t6: 't7', t7: 't8',
  t8: 't9', t9: 't10', t10: 't11', t11: 't12', t12: 't13', t13: 't14',
  t14: 't15', t15: 't16', t16: 't17', t17: 't18', t18: 't19', t19: 't20',
  t20: 't21', t21: 't22', t22: 't23', t23: 't24', t24: 't25', t25: 't26',
  t26: 't27', t27: 't28', t28: 'done',
};

export function completeTask(ctx, id) {
  const st = ctx.st;
  if (st.tasks.done.includes(id)) return; // 幂等：不重复发奖
  st.tasks.done.push(id);
  st.tasks.active = NEXT[id];
  st.tasks.sub = '';

  const A = (aid, text) => { st.achievements.push(aid); log(st, 'task', text); };

  if (id === 't2') {
    st.unlocked.trade = true;
    st.labLevel = 2;
    A('shareholder', '完成任务「股价低 ≠ 公司便宜」：解锁交易台，研究室升到 Lv.2，获得成就「股东证」。');
    toast('解锁：交易台！研究室升级到 Lv.2');
  } else if (id === 't3') {
    log(st, 'task', '完成任务「股东的回报」：理解了价差与分红，等待除息日验证。');
    showConcept(ctx, 'order');
  } else if (id === 't4') {
    st.unlocked.book = true;
    A('order101', '完成任务「委托与成交」，获得成就「委托入门」；解锁盘口显示屏。');
    toast('解锁：盘口显示屏');
    showConcept(ctx, 'orderBook');
  } else if (id === 't5') {
    A('bookreader', '完成任务「盘口与价差」，获得成就「盘口观察」。');
    toast('成就：盘口观察');
  } else if (id === 't6') {
    A('rulesPro', '完成任务「交易规则」，获得成就「懂规则的人」。');
    toast('成就：懂规则的人');
  } else if (id === 't7') {
    st.unlocked.index = true;
    A('chartreader', '完成任务「读懂行情」，获得成就「读图新手」；小镇综指上线。');
    toast('解锁：小镇综指');
    showConcept(ctx, 'indexCard');
  } else if (id === 't8') {
    A('indexreader', '完成任务「小镇指数」，获得成就「指数读者」。');
    toast('成就：指数读者');
  } else if (id === 't9') {
    A('dividend1', '完成任务「除权除息」，获得成就「第一次分红」。');
    toast('成就：第一次分红');
  } else if (id === 't11') {
    A('candleBasics', '完成「影线与十字星」，获得成就「K 线基础」。');
    toast('成就：K 线基础');
  } else if (id === 't15') {
    A('patternHunter', '完成「形态小结」，获得成就「形态猎人」。');
    toast('成就：形态猎人');
  } else if (id === 't19') {
    A('maApprentice', '完成「金叉死叉」，获得成就「均线学徒」。');
    toast('成就：均线学徒');
  } else if (id === 't22') {
    st.unlocked.review = true;
    log(st, 'task', '完成「传闻 vs 公告」的调查与决策，解锁「复盘」（顶栏按钮）。');
    toast('解锁：复盘');
  } else if (id === 't23') {
    A('reviewer', '完成「财报与复盘」，获得成就「独立复盘」。');
    toast('成就：独立复盘');
  } else if (id === 't24') {
    A('peReader', '完成「估值浅识 PE」，获得成就「估值入门」。');
    toast('成就：估值入门');
  } else if (id === 't25') {
    A('calm', '完成「FOMO 心理关」，获得成就「冷静的心」。');
    toast('成就：冷静的心');
  } else if (id === 't26') {
    A('risk101', '完成「仓位与集中度」，获得成就「风险第一课」。');
    toast('成就：风险第一课');
  } else if (id === 't27') {
    log(st, 'task', '完成「回撤与不摊平」：已记录你的判断依据。');
  } else if (id === 't28') {
    log(st, 'task', '六章二十八课全部完成——第一阶段毕业！');
    graduateModal(ctx);
  }
  ctx.dispatch?.('uiRefresh');
}

// ---------- 自动触发检查 ----------
export function maybeAuto(ctx) {
  const st = ctx.st, t = st.tasks.active;

  // 预测验证优先：到期且 pending → 弹验证（每次最多一个，防连弹）
  for (const id of Object.keys(PREDICTIONS)) {
    const rec = st.flags.predictions?.[id];
    if (rec?.phase === 'pending' && st.day >= rec.resolveDay) {
      if (predictionResolve(ctx, id)) return;
    }
  }

  if (t === 't3' && st.day >= 3 && !st.flags.divAnnShown && !st.flags.divHintToasted) {
    st.flags.divHintToasted = true;
    toast('公告栏贴出了新公告——点击小镇中间的「公告栏」读一读');
  }
  else if (t === 't6' && st.tasks.sub === 'waitD9' && st.day >= 9) {
    st.tasks.sub = 'tryBuyFirefly';
    toast('萤火科技今天有动静——去「交易」面板看看');
  }
  else if (t === 't7' && st.day >= 10 && !st.unlocked.chart) {
    st.unlocked.chart = true;
    log(st, 'task', '行情终端已解锁。');
    toast('解锁：行情终端');
    showConcept(ctx, 'kline');
  }
  else if (t === 't9' && st.day >= DIVIDEND.exDay && !st.flags.exdivShown) exdivExplain(ctx);
  // 第四章 · K 线形态：预测①②到点提问
  else if (t === 't12' && st.day >= 24 && !st.flags.predictions?.engulf) predictionAsk(ctx, 'engulf', 24, 27);
  else if (t === 't14' && st.day >= 33 && !st.flags.predictions?.eveningStar) predictionAsk(ctx, 'eveningStar', 33, 36);
  // 第五章 · 量价与指标
  else if (t === 't18' && st.day >= 43 && !st.flags.maShown && !st.flags.maHintToasted) {
    st.flags.maHintToasted = true;
    toast('可以解锁均线了——点任务卡的「读概念卡并解锁均线」');
  }
  else if (t === 't19' && st.day >= 47 && !st.flags.predictions?.goldCross) {
    const crossDay = findGoldCross(ctx.market, 'pinecone', 47, Math.min(55, st.day));
    if (crossDay) predictionAsk(ctx, 'goldCross', crossDay, Math.min(crossDay + PREDICTIONS.goldCross.resolveAfter, TOTAL_DAYS));
  }
  else if (t === 't20' && st.day >= 48 && !st.flags.macdShown && !st.flags.macdHintToasted) {
    st.flags.macdHintToasted = true;
    toast('可以解锁 MACD 副图了——点任务卡的「读概念卡并解锁副图」');
  }
  // 第六章 · 基本面与风险（旧课改号后移：传闻 51 / 财报 54 / 冲击 56 / 摊平 58 / FOMO 55）
  else if (t === 't22' && st.day >= 51 && !st.flags.eventStarted) startEvent(ctx);
  else if (t === 't23' && st.day >= 54 && !st.flags.earningsShown) earningsPre(ctx);
  else if (t === 't26' && st.day >= 56 && !st.flags.shockShown) shockModal(ctx);
  else if (t === 't27' && st.day >= 58 && !st.flags.avgAsked) {
    st.flags.avgAsked = true;
    avgCalcQuiz(ctx);
  }
  else if (t === 't25' && st.day >= 55 && !st.flags.fomoShown && !st.flags.fomoToasted) {
    st.flags.fomoToasted = true;
    toast('论坛又热传「萤火 AI 灯具大卖」——先去公告栏查证一下');
  }
  else if (t === 't28' && st.day >= 60 && !st.flags.gradReviewShown) graduateReviewModal(ctx);
}

// ---------- 动作入口 ----------
export function onAction(ctx, type, payload = {}) {
  const st = ctx.st;
  const t = st.tasks.active;
  const sub = st.tasks.sub;

  if (type === 'welcomeDone' && t === 't1' && !st.flags.ipoShown) lessonStock(ctx);

  if (type === 'viewCompany') {
    st.flags.viewed[payload.id] = true;
    if (t === 't2' && st.flags.viewed.pinecone && st.flags.viewed.firefly && !st.flags.capShown) {
      st.flags.capShown = true;
      showConcept(ctx, 'marketCap');
    }
  }

  // 第 4 课：限价单 → 观察 → 市价单
  if (type === 'orderPlaced' && t === 't4') {
    const o = payload.order;
    if (sub === 'placeLimit' || sub === '') {
      if (o.kind === 'limit' && o.side === 'buy') {
        st.tasks.sub = 'advanceObserve';
        toast('限价单已提交。点击「下一天」观察它的状态');
      } else if (o.status === 'filled') {
        st.tasks.sub = 'quizMarketFirst';
        quizUnfilledOrder(ctx, true);
      }
    } else if (sub === 'marketBuy' && o.kind === 'market' && o.status === 'filled') {
      completeTask(ctx, 't4');
    }
  }

  if (type === 'nextDay' && t === 't4' && sub === 'advanceObserve') {
    if (st.orders.some(o => o.status === 'pending')) quizUnfilledOrder(ctx, false);
    else st.tasks.sub = 'placeLimit'; // 限价单意外成交了，重新体验一次
  }

  // 第 6 课：T+1 与涨停（两次「被拒绝」体验）
  if (type === 'orderPlaced' && t === 't6') {
    const o = payload.order;
    if ((sub === '' || sub === 'buyT1') && o.side === 'buy' && o.status === 'filled') {
      st.tasks.sub = 'trySell';
      toast('买入成交。现在立刻尝试卖出它');
    } else if (sub === 'trySell' && o.side === 'sell' && o.status === 'filled') {
      t1SellFilledModal(ctx);   // 卖出成交：卖的是已解冻的旧持仓，再试一次就会撞上 T+1
    } else if (sub === 'tryBuyFirefly' && o.side === 'buy' && o.status === 'filled') {
      limitUpFallbackModal(ctx); // 涨停日已过：补讲规则后完成
    }
  }
  if (type === 'orderRejected' && t === 't6') {
    if (sub === 'trySell' && payload.code === 'T1') t1RuleModal(ctx);
    else if (sub === 'tryBuyFirefly' && payload.code === 'LIMIT_UP') limitUpModal(ctx);
  }

  if (type === 'investigate') {
    const iv = INVESTIGATIONS[payload.key];
    if (iv && !st.flags.investigated[iv.key] && st.flags.investigationLeft > 0) {
      st.flags.investigated[iv.key] = true;
      st.flags.investigationLeft--;
      log(st, 'decision', `调查了「${iv.name}」`);
      investigateModal(ctx);
    }
  }

  if (type === 'decide') {
    st.flags.decision = payload.decision;
    st.flags.decisionReason = payload.reason;
    const dText = payload.decision === 'buy' ? '买入松果食品' : '继续观察，暂不买入';
    const rText = { rumor: '传闻说利润要翻倍', sales: '销售数据确认了增长', cost: '成本上升可能吃掉利润', wait: '信息不足，先谨慎一点' }[payload.reason];
    log(st, 'decision', `传闻决策：${dText}。主要依据：${rText}`);
    closeModal();
    if (payload.decision === 'buy') {
      st.tasks.sub = 'executeBuy';
      toast('去「交易」面板真实买入 1 手松果食品（现金不足也没关系，会有兜底）');
    } else {
      completeTask(ctx, 't22');
    }
  }

  // 第 22 课：真实买入（成交 → 完成；现金不足 → 兜底说明后完成，不卡关）
  if (type === 'orderPlaced' && t === 't22' && sub === 'executeBuy') {
    const o = payload.order;
    if (o.side === 'buy' && o.symbol === 'pinecone' && o.status === 'filled') {
      log(st, 'decision', `真实买入松果食品 ${o.qty} 股 @ ${o.fillPrice.toFixed(2)} 元。`);
      completeTask(ctx, 't22');
    }
  }
  if (type === 'orderRejected' && t === 't22' && sub === 'executeBuy' && payload.code === 'CASH') {
    showModal({
      title: '现金不足——这也值得记录',
      bodyHTML: `
        <p>你的现金不足以买入 1 手松果食品（现金去向可查「复盘」里的持仓）。</p>
        <p>想买买不了，说明之前的仓位已经占满了资金。<b>仓位管理不只是「买了什么」，还包括「还剩多少机动资金」。</b>本课按完成计，决策与依据已记入研究日志。</p>`,
      buttons: [{ label: '完成本课', primary: true, onClick: () => completeTask(ctx, 't22') }],
    });
  }

  if (type === 'reviewShown' && t === 't23') completeTask(ctx, 't23');

  // 第 26 课：真实买入河狸 → 进入答题
  if (type === 'orderPlaced' && t === 't26' && sub === 'diversify') {
    const o = payload.order;
    if (o.side === 'buy' && o.symbol === 'beaver' && o.status === 'filled') {
      log(st, 'decision', `分散持仓：真实买入河狸物流 ${o.qty} 股 @ ${o.fillPrice.toFixed(2)} 元。`);
      quizShock(ctx);
    }
  }

  // 小镇公告栏
  if (type === 'openBoard') {
    if (t === 't3' && !st.flags.divAnnShown) dividendAnnounce(ctx);
    else if (t === 't25' && st.flags.fomoToasted) (st.flags.fomoShown ? fomoModal(ctx) : boardCheckModal(ctx));
    else boardInfoModal(ctx);
  }

  // 盘口行点击（第 5 课亮点操作）
  if (type === 'bookRow') {
    if (t === 't5' && payload.symbol !== 'pinecone') {
      toast('本课看的是「松果食品」的盘口——先在上方切换到松果食品');
    } else if (t === 't5' && payload.row === 'ask1') {
      toast('对，想立即买入就得接受卖一价');
      quizBook(ctx);
    } else if (t === 't5') {
      toast('再看看「卖一」那一行——立即买入要接受的是它');
    } else {
      boardRowInfo(ctx, payload.row);
    }
  }

  // K 线蜡烛点击（第 7/10/11/13/16 课亮点操作）
  if (type === 'candlePick') {
    const candleLessons = { t10: [15, 16], t11: [18, 20], t13: [29], t16: [39] };
    if ((t === 't7' || candleLessons[t]) && payload.symbol !== 'pinecone') {
      toast('本课要看的是「松果食品」——先在上方切换到松果食品，再点蜡烛');
    } else if (t === 't7') {
      const best = bestGainDay(ctx.market, 'pinecone', st.day);
      if (payload.day === best) {
        showModal({
          title: '回答正确',
          bodyHTML: `<p>第 ${best} 天蜡烛的「身体最长、方向向上」——它是迄今涨幅最大的一天。读图就是还原过去发生了什么。</p>`,
          buttons: [{ label: '完成本课', primary: true, onClick: () => completeTask(ctx, 't7') }],
        });
      } else {
        ctx.st.stats.quizWrong = (ctx.st.stats.quizWrong || 0) + 1;
        toast(`第 ${payload.day} 天不是涨幅最大的。比较蜡烛「身体」（开收价差）再试，或点任务卡改成选择题`);
      }
    } else if (candleLessons[t]) {
      if (candleLessons[t].includes(payload.day)) {
        if (t === 't10') candleBodyModal(ctx, payload.day);
        else if (t === 't11') candleWickModal(ctx, payload.day);
        else if (t === 't13') gapPickModal(ctx);
        else if (t === 't16') volumePickModal(ctx);
      } else {
        toast(`本课要看的是第 ${candleLessons[t].join('、')} 天的蜡烛（图上已高亮）`);
      }
    }
  }

  // 顶栏综指点击（第 8 课入口）
  if (type === 'indexInfo') indexInfoModal(ctx);

  if (type === 'quiz') {
    if (payload.id === 'marketCap') quizMarketCap(ctx);
    if (payload.id === 'chart') quizChart(ctx);
  }
  maybeAuto(ctx);
}

// 非 t5 时点盘口行：给出一句通用解释
function boardRowInfo(ctx, row) {
  const side = row.startsWith('ask') ? '卖' : '买';
  const lv = row.slice(-1);
  toast(`这是「${side}${lv}」：等待${side === '卖' ? '卖出' : '买入'}的第 ${lv} 优报价`);
}
