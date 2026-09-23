// 第二阶段：历史风格回放剧本（虚构公司 + 虚构行情，仅风格参考真实市场历史）
// 每个剧本固定种子：同一剧本的行情永远一致，保证「同起点对照」可复现。
// 生成器工具在 scenario-gen.js；其余 14 个剧本在 scenarios2.js，此处合并导出。
import { round2 } from './util.js';
import { REPLAY_DAYS, segWalk, closesToBars, mulberry32 } from './scenario-gen.js';
import { NEW_SCENARIOS } from './scenarios2.js';

export { REPLAY_DAYS };

// ---- 剧本 1：泉酿股份（长牛消费）----
function buildBull(seed) {
  const rng = mulberry32(seed);
  const closes = segWalk(rng, 48, [
    { days: 20, drift: 0.011, vol: 0.012 },   // 慢牛主升
    { days: 6, drift: -0.014, vol: 0.015 },   // 第一次回调
    { days: 19, drift: 0.010, vol: 0.012 },   // 再创新高
    { days: 7, drift: -0.009, vol: 0.014 },   // 第二次回调
    { days: 8, drift: 0.012, vol: 0.013 },    // 收尾上行
  ]);
  return closesToBars(closes, { basePrice: 48, baseVol: 900000, rng, volSpike: new Set([22, 45, 55]) });
}

// ---- 剧本 2：瑞昌药业（财务暴雷：质疑 → 停牌 → 复牌连续跌停）----
export const FRAUD_HALT_DAYS = [26, 27, 28, 29, 30, 31, 32];   // 停牌
export const FRAUD_LIMIT_DAYS = [33, 34, 35, 36, 37];          // 复牌后连续一字跌停
function buildFraud(seed) {
  const rng = mulberry32(seed);
  const pre = segWalk(rng, 28, [{ days: 25, drift: 0.002, vol: 0.010 }]);
  let price = pre[pre.length - 1];
  const limitCloses = FRAUD_LIMIT_DAYS.map(() => { price = round2(price * 0.9); return price; });
  const post = segWalk(rng, price, [{ days: 23, drift: 0.001, vol: 0.020 }]);
  // 60 天 = 25 正常 + 7 停牌 + 5 跌停 + 23 低位震荡
  const closes = new Array(60);
  for (let i = 0; i < 25; i++) closes[i] = pre[i];
  for (let i = 0; i < 7; i++) closes[25 + i] = price;          // 停牌占位（不会用到）
  for (let i = 0; i < 5; i++) closes[32 + i] = limitCloses[i];
  for (let i = 0; i < 23; i++) closes[37 + i] = post[i];
  return closesToBars(closes, {
    basePrice: 28, baseVol: 1500000, rng,
    halts: new Set(FRAUD_HALT_DAYS),
    flatDays: new Set(FRAUD_LIMIT_DAYS),
    volSpike: new Set([25, ...FRAUD_LIMIT_DAYS]),
  });
}

// ---- 剧本 3：巨岩能源（周期横盘 + 一次现金分红除息）----
export const CYCLE_DIV = { day: 38, perShare: 0.40 };          // 第 38 个交易日除息
function buildCycle(seed) {
  const rng = mulberry32(seed);
  const pre = segWalk(rng, 12, [{ days: 37, drift: 0, vol: 0.012 }]);
  // 除息日：在前收基础上下调分红金额，再叠加当日噪声
  const exClose = round2((pre[36] - CYCLE_DIV.perShare) * (1 + (rng() * 2 - 1) * 0.006));
  const post = segWalk(rng, exClose, [{ days: 22, drift: -0.0005, vol: 0.012 }]);
  return closesToBars([...pre, exClose, ...post], { basePrice: 12, baseVol: 2600000, rng, volSpike: new Set([31, 38, 46]) });
}

// ---- 剧本 4：星火智能（高波动科技：传闻拉升 → 利好兑现暴跌 → 澄清再跌）----
function buildVolatile(seed) {
  const rng = mulberry32(seed);
  const closes = segWalk(rng, 26, [
    { days: 15, drift: 0, vol: 0.020 },       // 横盘
    { days: 10, drift: 0.035, vol: 0.030 },   // 传闻拉升
    { days: 3, drift: -0.090, vol: 0.020 },   // 利好兑现暴跌
    { days: 12, drift: 0.010, vol: 0.030 },   // 反弹
    { days: 4, drift: -0.050, vol: 0.020 },   // 澄清再跌
    { days: 16, drift: 0.004, vol: 0.025 },   // 震荡收尾
  ]);
  return closesToBars(closes, { basePrice: 26, baseVol: 2100000, rng, volSpike: new Set([18, 26, 41]) });
}

// ---- 剧本定义 ----
// 事件中 day 为「盘后披露日」：玩家在当天看到公告；停牌/除息等生效日均晚于披露日。
export const SCENARIOS = [
  {
    id: 'bull', name: '泉酿股份', industry: '白酒酿造',
    basePrice: 48, days: REPLAY_DAYS, seed: 20260811,
    blurb: '一家地方酒企，核心产品是高端白酒，品牌历史悠久，渠道稳定。',
    archetype: '风格原型：高端白酒式「慢牛长牛」（参考贵州茅台 2016—2020 的走势风格）。',
    lesson: '长牛途中也有多次 10% 上下的回调。能否拿得住，取决于你买入的理由是否还在，而不是账户短期的红绿。',
    teaching: '持有与波动耐受',
    expertFocus: '回调中检查「买入理由是否还在」，而非盯着账户红绿',
    buildBars: buildBull,
    events: [
      { day: 22, kind: '公告', title: '股价异动说明公告', body: '公司公告：近期股价波动属于市场情绪变化，公司经营一切正常，主打产品动销稳定，不存在应披露而未披露的事项。', expert: '长牛途中的「无事项」异动公告是标准动作。回调开始后，专家关注的焦点不是股价跌了多少，而是「买入理由是否被破坏」——这份公告说经营没变，那变化的就只有情绪。' },
      { day: 45, kind: '公告', title: '业绩预增公告', body: '公司预计前三季度净利润同比增长 25%—35%，主要来自核心产品销量增长与产品结构升级。', expert: '业绩预增验证了此前的上涨并非纯情绪。长牛股的中期回调，常在「业绩确认」后结束——价格等的是基本面的追认。' },
      { day: 55, kind: '公告', title: '年度业绩快报', body: '公司全年营收与净利润实现双增长，与此前业绩预告一致。', expert: '符合预期的快报是「持有逻辑仍在」的证据。长牛的持有者赚的不是波动的钱，是企业成长的钱——前提是你拿得住。' },
    ],
  },
  {
    id: 'fraud', name: '瑞昌药业', industry: '医药制造',
    basePrice: 28, days: REPLAY_DAYS, seed: 20260812,
    blurb: '一家中型药企，财报长期「稳健增长」，账面存货规模较大。',
    archetype: '风格原型：财务造假暴雷（参考康美药业 2019 年的走势风格）。',
    lesson: '财务造假暴雷时，最大的风险不是「跌」，而是「想卖卖不掉」：停牌期间无法交易，复牌后连续跌停没有买盘。流动性风险比价格波动更致命。',
    teaching: '流动性风险、财务质疑信号',
    expertFocus: '财务质疑信号与「卖不出去」的流动性风险',
    buildBars: buildFraud,
    halts: FRAUD_HALT_DAYS,
    events: [
      { day: 25, kind: '新闻', title: '媒体报道：质疑财务真实性', body: '某财经媒体发布调查报道，质疑瑞昌药业的存货数据与收入规模存在明显矛盾。公司尚未作出回应。', expert: '财务质疑报道是第一张多米诺骨牌。回看历史，「存货与收入规模矛盾」是造假的高发信号——此时最重要的不是判断真假，而是意识到：一旦停牌，你将失去所有选择权。' },
      { day: 25, kind: '公告', title: '停牌核查公告', body: '因媒体质疑事项需要核查，公司股票自次一交易日（第 26 天）起停牌，复牌时间另行通知。', expert: '停牌 = 流动性归零。停牌期间你的持仓既涨不了也卖不掉，所有「止损计划」都被冻结。这就是为什么仓位大小要在坏消息之前决定。' },
      { day: 32, kind: '公告', title: '复牌公告：核查结果', body: '核查确认公司存在虚增收入与利润的情形，相关责任人已被立案调查。公司股票于次一交易日（第 33 天）复牌。', expert: '造假坐实后，复牌连续跌停几乎没有悬念。跌停板上巨量卖单排队、无人接盘——「卖不出去」不是修辞，是此刻的物理现实。' },
    ],
  },
  {
    id: 'cycle', name: '巨岩能源', industry: '石油石化',
    basePrice: 12, days: REPLAY_DAYS, seed: 20260813,
    blurb: '大型石化企业，业绩随油价周期起落，估值常年看起来「很便宜」。',
    archetype: '风格原型：周期股「价值陷阱」（参考部分石油石化股 2015—2019 的走势风格）。',
    lesson: '长期横盘意味着资金有机会成本。现金分红会除息：红利到账的同时股价下调，总资产不变——分红不是白赚。判断周期股要看周期位置，而不是只看「便宜」。',
    teaching: '机会成本、股息与除息',
    expertFocus: '横盘的「机会成本」与除息机制',
    buildBars: buildCycle,
    dividend: CYCLE_DIV,
    events: [
      { day: 30, kind: '公告', title: '分红预案公告', body: '公司拟每股派发现金红利 0.40 元（含税），除息日为第 38 个交易日。注意：除息日股价会按分红金额相应下调。', expert: '高分红预案看着诱人，但记住除息机制：红利到账的同时股价等额下调。分红改变的是「钱的存在形式」，不是「钱的总量」。' },
      { day: 38, kind: '提示', title: '今日除息', body: '每股 0.40 元红利已划入你的现金账户；同时股价除息下调约 0.40 元。除息前后你的总资产基本不变——分红 ≠ 白赚。', expert: '对照除息前后的总资产：几乎没变。K 线上的「缺口」不是亏损，是钱从股票账户搬进了现金账户。' },
      { day: 45, kind: '公告', title: '经营情况公告', body: '受国际油价回落与下游需求疲软影响，公司预计全年利润同比小幅下滑。', expert: '周期股的「便宜」往往是周期顶点的幻觉：利润高点算出的低市盈率，会在利润回落时自动变贵。看周期股要先看周期位置。' },
    ],
  },
  {
    id: 'volatile', name: '星火智能', industry: '智能硬件',
    basePrice: 26, days: REPLAY_DAYS, seed: 20260814,
    blurb: '年轻的智能硬件公司，题材热门，市场情绪容易大起大落。',
    archetype: '风格原型：题材科技股高波动（参考 2015 年创业板题材炒作的走势风格）。',
    lesson: '传闻推动的上涨里，「利好兑现」往往是卖点而非买点；仓位决定你能承受多大的回撤。高波动品种上，仓位管理比判断方向更重要。',
    teaching: '仓位管理、利好兑现',
    expertFocus: '传闻与兑现的节奏差、仓位决定承受力',
    buildBars: buildVolatile,
    events: [
      { day: 18, kind: '新闻', title: '市场传闻：疑似斩获大额订单', body: '多个论坛流传星火智能拿下「头部客户大额订单」，公司未作回应。近期股价持续走强，成交量明显放大。', expert: '传闻期上涨的特征：无量启动、放量加速、公司沉默。此时买入是在为「传闻为真」付全款——先想清楚传闻落空时跌多少。' },
      { day: 25, kind: '公告', title: '合作协议公告', body: '公司与某厂商签署智能模组供货框架协议，首年预计贡献收入约 8000 万元（占去年营收约 12%）。此前的市场传闻部分兑现。', expert: '「利好兑现即下跌」是高波动品种的经典剧本：传闻期买入的人在公告日卖出给看公告买入的人。8000 万订单撑不起传闻期翻倍的想象。' },
      { day: 40, kind: '公告', title: '澄清公告', body: '公司澄清：不存在市场传闻的「追加十倍订单」，目前在手订单规模与此前披露一致。请投资者注意风险。', expert: '澄清公告戳破的是传闻的「超额部分」。传闻行情的跌幅，大致等于传闻中虚构的那部分想象空间。' },
    ],
  },
  ...NEW_SCENARIOS,
];

export const scenarioById = id => SCENARIOS.find(s => s.id === id);
