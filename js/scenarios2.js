// 第二阶段扩充：新增 14 个历史风格剧本（虚构公司 + 虚构行情，仅风格参考真实市场历史）
// 与 scenarios.js 的 4 个基础剧本合并后共 18 个。每个剧本固定种子，行情可复现。
import { round2 } from './util.js';
import { segWalk, closesToBars, limitChain, mulberry32, REPLAY_DAYS } from './scenario-gen.js';

const D = REPLAY_DAYS;

// ---- 5. 宏远地产：长期阴跌慢熊 ----
function buildBear(seed) {
  const rng = mulberry32(seed);
  const closes = segWalk(rng, 18, [
    { days: 25, drift: -0.006, vol: 0.012 },   // 阴跌
    { days: 8, drift: 0.012, vol: 0.015 },     // 超跌反弹
    { days: 27, drift: -0.007, vol: 0.012 },   // 再下台阶
  ]);
  return closesToBars(closes, { basePrice: 18, baseVol: 1800000, rng, volSpike: new Set([26, 33, 48]) });
}

// ---- 6. 蓝湾新材：妖股连板 → 天地板 ----
function buildDemon(seed) {
  const rng = mulberry32(seed);
  const pre = segWalk(rng, 15, [{ days: 12, drift: 0, vol: 0.010 }]);
  const ups = limitChain(pre[11], 8, +1);          // 第 13—20 天：8 连板
  const tianClose = round2(ups[7] * 0.90);         // 第 21 天：天地板（涨停开、跌停收）
  const downs = limitChain(tianClose, 3, -1);      // 第 22—24 天：再 3 个一字跌停
  const post = segWalk(rng, downs[2], [
    { days: 20, drift: 0.004, vol: 0.030 },        // 高波动拉锯
    { days: 16, drift: -0.003, vol: 0.022 },       // 情绪退潮
  ]);
  const closes = [...pre, ...ups, tianClose, ...downs, ...post];
  const flatDays = new Set([13, 14, 15, 16, 17, 18, 19, 20, 22, 23, 24]);
  return closesToBars(closes, {
    basePrice: 15, baseVol: 1200000, rng, flatDays,
    volSpike: new Set([21]),
    overrides: { 21: { open: round2(ups[7] * 1.10), high: round2(ups[7] * 1.10), low: tianClose } }, // 天地板
  });
}

// ---- 7. 康桥食品：突发黑天鹅三连跌停 ----
function buildBlackswan(seed) {
  const rng = mulberry32(seed);
  const pre = segWalk(rng, 22, [{ days: 30, drift: 0.004, vol: 0.010 }]);   // 稳健上行
  const downs = limitChain(pre[29], 3, -1);                                 // 第 31—33 天：一字跌停
  const post = segWalk(rng, downs[2], [{ days: 27, drift: 0.001, vol: 0.018 }]); // 低位修复
  return closesToBars([...pre, ...downs, ...post], {
    basePrice: 22, baseVol: 1400000, rng,
    flatDays: new Set([31, 32, 33]), volSpike: new Set([31, 32, 33, 34]),
  });
}

// ---- 8. 辰光半导体：主升浪 ----
function buildMainwave(seed) {
  const rng = mulberry32(seed);
  const closes = segWalk(rng, 30, [
    { days: 18, drift: 0.001, vol: 0.013 },    // 横盘蓄势
    { days: 30, drift: 0.016, vol: 0.020 },    // 主升浪
    { days: 12, drift: -0.006, vol: 0.020 },   // 高位回落
  ]);
  return closesToBars(closes, { basePrice: 30, baseVol: 2600000, rng, volSpike: new Set([19, 20, 45, 52]) });
}

// ---- 9. 金鼎食品：高位放量滞涨（出货）----
function buildDistribution(seed) {
  const rng = mulberry32(seed);
  const closes = segWalk(rng, 20, [
    { days: 25, drift: 0.012, vol: 0.014 },    // 稳步上行
    { days: 15, drift: -0.001, vol: 0.018 },   // 高位放量滞涨
    { days: 20, drift: -0.011, vol: 0.015 },   // 重心下移
  ]);
  const spike = new Set();
  for (let d = 26; d <= 42; d++) spike.add(d); // 高位持续巨量
  return closesToBars(closes, { basePrice: 20, baseVol: 1600000, rng, volSpike: spike });
}

// ---- 10. 天启航空：急跌 V 型反转 ----
function buildVshape(seed) {
  const rng = mulberry32(seed);
  const closes = segWalk(rng, 9, [
    { days: 15, drift: 0.002, vol: 0.010 },    // 平稳
    { days: 10, drift: -0.045, vol: 0.020 },   // 恐慌急跌
    { days: 5, drift: 0.005, vol: 0.020 },     // 企稳
    { days: 30, drift: 0.014, vol: 0.018 },    // V 型修复
  ]);
  return closesToBars(closes, { basePrice: 9, baseVol: 3000000, rng, volSpike: new Set([16, 17, 18, 26, 27]) });
}

// ---- 11. 青石基建：底部长期磨底后启动 ----
function buildBottoming(seed) {
  const rng = mulberry32(seed);
  const closes = segWalk(rng, 6, [
    { days: 40, drift: -0.001, vol: 0.009 },   // 磨底（利好不涨）
    { days: 20, drift: 0.013, vol: 0.015 },    // 缓慢启动
  ]);
  return closesToBars(closes, { basePrice: 6, baseVol: 2200000, rng, volSpike: new Set([42, 43, 50]) });
}

// ---- 12. 飞扬传媒：高送转除权（10 送 10）----
export const SPLIT_INFO = { day: 26, ratio: 2, label: '10 送 10' };
function buildSplit(seed) {
  const rng = mulberry32(seed);
  const pre = segWalk(rng, 24, [{ days: 25, drift: 0.012, vol: 0.018 }]);   // 抢权行情
  const exClose = round2(pre[24] / SPLIT_INFO.ratio * (1 + (rng() * 2 - 1) * 0.01)); // 除权日：价格减半
  const post = segWalk(rng, exClose, [
    { days: 15, drift: 0.008, vol: 0.020 },    // 「填权」幻觉期
    { days: 19, drift: -0.012, vol: 0.020 },   // 回落
  ]);
  return closesToBars([...pre, exClose, ...post], { basePrice: 24, baseVol: 2000000, rng, volSpike: new Set([19, 26, 40]) });
}

// ---- 13. ST 恒发：摘帽行情（前期 ±5% 涨跌幅）----
export const ST_LIMIT_DAYS = 22; // 第 22 天收市后摘帽，次日起恢复 ±10%
function buildStcap(seed) {
  const rng = mulberry32(seed);
  const closes = segWalk(rng, 3.6, [
    { days: 15, drift: -0.004, vol: 0.018, clamp: 0.0495 },  // ST 期阴跌
    { days: 7, drift: 0.020, vol: 0.022, clamp: 0.0495 },    // 摘帽预期炒作（±5%）
    { days: 8, drift: 0.006, vol: 0.020 },                   // 摘帽落地后
    { days: 30, drift: 0.002, vol: 0.015 },                  // 回归平淡
  ]);
  return closesToBars(closes, { basePrice: 3.6, baseVol: 900000, rng, volSpike: new Set([16, 23, 24]) });
}

// ---- 14. 云启数据：新股上市连板 → 开板巨震 ----
function buildIpo(seed) {
  const rng = mulberry32(seed);
  const d1 = round2(12 * 1.44);                    // 首日 +44%
  const boards = limitChain(d1, 7, +1);            // 第 2—8 天：7 个一字板
  const open9 = round2(boards[6] * 1.05);          // 第 9 天：高开
  const close9 = round2(boards[6] * 0.94);         // 第 9 天：巨量长阴收 -6%
  const post = segWalk(rng, close9, [{ days: 51, drift: -0.004, vol: 0.030 }]); // 价值回归
  const closes = [d1, ...boards, close9, ...post];
  return closesToBars(closes, {
    basePrice: 12, baseVol: 800000, rng,
    flatDays: new Set([2, 3, 4, 5, 6, 7, 8]),
    volSpike: new Set([1, 9, 10]),
    overrides: {
      1: { open: round2(12 * 1.20), high: round2(d1 * 1.005), low: round2(12 * 1.19) },
      9: { open: open9, high: round2(boards[6] * 1.08), low: round2(close9 * 0.985) },
    },
  });
}

// ---- 15. 白象电器：熊市末期白马补跌 ----
function buildBluechip(seed) {
  const rng = mulberry32(seed);
  const closes = segWalk(rng, 35, [
    { days: 30, drift: 0.003, vol: 0.010 },    // 稳健抗跌
    { days: 10, drift: -0.020, vol: 0.015 },   // 补跌
    { days: 20, drift: 0.004, vol: 0.010 },    // 修复
  ]);
  return closesToBars(closes, { basePrice: 35, baseVol: 1900000, rng, volSpike: new Set([31, 32, 33]) });
}

// ---- 16. 幻影互娱：题材炒作遇监管问询 ----
function buildRegulatory(seed) {
  const rng = mulberry32(seed);
  const closes = segWalk(rng, 8, [
    { days: 20, drift: 0.004, vol: 0.015 },    // 温和上行
    { days: 8, drift: 0.035, vol: 0.025 },     // 蹭概念暴涨
    { days: 2, drift: -0.07, vol: 0.020 },     // 问询后暴跌
    { days: 10, drift: 0.008, vol: 0.020 },    // 反抽
    { days: 20, drift: -0.008, vol: 0.015 },   // 阴跌回归
  ]);
  return closesToBars(closes, { basePrice: 8, baseVol: 1700000, rng, volSpike: new Set([22, 28, 29]) });
}

// ---- 17. 绿田农牧：业绩预告变脸 ----
function buildEarnings(seed) {
  const rng = mulberry32(seed);
  const closes = segWalk(rng, 15, [
    { days: 25, drift: 0.008, vol: 0.015 },    // 预喜驱动上涨
    { days: 5, drift: -0.03, vol: 0.020 },     // 变脸暴跌
    { days: 30, drift: 0.001, vol: 0.015 },    // 低位消化
  ]);
  return closesToBars(closes, { basePrice: 15, baseVol: 1300000, rng, volSpike: new Set([26, 27]) });
}

// ---- 18. 海程航运：周期拐点利好高开 ----
function buildGapup(seed) {
  const rng = mulberry32(seed);
  const pre = segWalk(rng, 7.5, [{ days: 20, drift: -0.003, vol: 0.013 }]); // 低迷
  const gapClose = round2(pre[19] * 1.09);                                    // 第 21 天：高开高走收 +9%
  const post = segWalk(rng, gapClose, [
    { days: 10, drift: 0.015, vol: 0.025 },    // 续涨
    { days: 15, drift: -0.008, vol: 0.020 },   // 运价见顶回落
    { days: 14, drift: 0.005, vol: 0.015 },    // 企稳
  ]);
  return closesToBars([...pre, gapClose, ...post], {
    basePrice: 7.5, baseVol: 2400000, rng,
    volSpike: new Set([21, 22, 35]),
    overrides: { 21: { open: round2(pre[19] * 1.08), high: round2(gapClose * 1.012), low: round2(pre[19] * 1.075) } }, // 跳空缺口
  });
}

// ---- 剧本定义 ----
export const NEW_SCENARIOS = [
  {
    id: 'bear', name: '宏远地产', industry: '房地产开发',
    basePrice: 18, days: D, seed: 20260815,
    blurb: '一家区域房企，前两年扩张激进，如今销售肉眼可见地冷清下来。',
    archetype: '风格原型：长期阴跌慢熊（参考部分地产股 2019—2022 的走势风格）。',
    lesson: '阴跌中「跌了很多」不等于「便宜」。下降趋势里的反弹常是减仓窗口而非反转信号；抄底需要基本面拐点的证据，而不是「价格低」这个感觉。',
    teaching: '趋势的力量、不接飞刀',
    expertFocus: '下降趋势里反弹的性质：减仓窗口还是反转起点',
    buildBars: buildBear,
    events: [
      { day: 20, kind: '公告', title: '月度销售数据公告', body: '公司公告：上月合同销售额同比下滑 32%，回款周期拉长，部分项目暂缓开工。', expert: '阴跌途中的基本面数据是「确认趋势」的，不是「利空出尽」。销售下滑与股价阴跌互为印证——趋势一旦形成，惯性比多数人想象的长。' },
      { day: 34, kind: '新闻', title: '行业融资环境收紧', body: '媒体报道：房地产行业融资渠道持续收紧，多家高杠杆房企承压。', expert: '高杠杆行业对融资环境最敏感。这类新闻出现后，超跌反弹常被老股东视为减仓窗口——反弹失败是常态，反转成功才是新闻。' },
      { day: 48, kind: '公告', title: '业绩预告：年度亏损', body: '受项目减值与结算毛利率下滑影响，公司预计全年净利润为亏损。', expert: '阴跌大半年后「暴雷」并不意外——市场往往提前很久就在定价坏消息。回看这一年，每一次反弹都是离场机会，这就是趋势的力量。' },
    ],
  },
  {
    id: 'demon', name: '蓝湾新材', industry: '新材料',
    basePrice: 15, days: D, seed: 20260816,
    blurb: '一家小市值材料公司，业绩平平，最近突然被短线资金盯上。',
    archetype: '风格原型：妖股连板与天地板（参考 2015 年特力 A 等妖股的炒作风格）。',
    lesson: '连续涨停时「买不到」、天地板时「卖不出」——妖股的收益截图属于在车上的人，风险属于最后上车的人。情绪博弈没有基本面锚，仓位是唯一可控项。',
    teaching: '情绪博弈、连板与天地板',
    expertFocus: '连板期的「买不进」与崩塌时的「卖不出」',
    buildBars: buildDemon,
    events: [
      { day: 14, kind: '公告', title: '股票交易异常波动公告', body: '公司公告：不存在应披露而未披露的重大事项，生产经营情况正常，提醒投资者注意二级市场交易风险。', expert: '连板股的「无事项」公告是规定动作。它澄清的是信息面，不是估值风险——价格早已脱离基本面，驱动它的只剩情绪与筹码博弈。' },
      { day: 18, kind: '新闻', title: '交易所提示炒作风险', body: '交易所对蓝湾新材近期交易情况进行重点监控，提示部分账户涉嫌拉抬炒作。', expert: '监管关注是妖股行情最明确的逆风信号之一。历史上的连板行情，多数终结于监管出手或情绪自然衰竭，而非公司基本面变化。' },
      { day: 21, kind: '公告', title: '风险提示公告', body: '公司公告：当前市盈率已远高于行业平均水平，近期涨幅与公司基本面严重背离，敬请投资者理性投资。', expert: '天地板当天回看，风险提示早已给出。情绪博弈里公告的「正确」挡不住价格的「疯狂」，但它决定了疯狂之后的方向——回到基本面。' },
    ],
  },
  {
    id: 'blackswan', name: '康桥食品', industry: '食品加工',
    basePrice: 22, days: D, seed: 20260817,
    blurb: '老牌食品企业，渠道遍布全国，股价常年稳健，被视为「防御型」标的。',
    archetype: '风格原型：突发黑天鹅事件（参考食品安全事件冲击下的消费股走势风格）。',
    lesson: '黑天鹅无法从 K 线预测。单票重仓遇到突发利空时，跌停板上卖不出去。分散持仓的目的不是多赚，而是保证自己永远留在游戏里。',
    teaching: '黑天鹅与分散持仓',
    expertFocus: '事前无法预测的冲击，只能靠事前仓位应对',
    buildBars: buildBlackswan,
    events: [
      { day: 30, kind: '新闻', title: '晚间突发：产品安全质疑', body: '有媒体曝光康桥食品某批次产品存在严重质量问题，相关话题迅速发酵。公司暂未回应。', expert: '黑天鹅的特征就是事前无信号——昨天的一切技术分析在此刻失效。你唯一能依靠的，是事前就定好的仓位与分散。这正是仓位管理的意义。' },
      { day: 33, kind: '公告', title: '产品召回及监管处罚公告', body: '公司公告召回涉事批次产品，监管部门已立案调查并拟作出处罚。公司致歉并承诺全面整改。', expert: '连续跌停后讨论「开不开板」意义不大。品牌信任坍塌后，重建以年为单位——修复期的每一次反弹，都要先问「信任回来了吗」。' },
      { day: 45, kind: '公告', title: '整改进展公告', body: '公司公告生产线整改完成，涉事产品已全面下架，第三方检测结果合格。', expert: '整改完成的消息带来超跌修复，但「超跌反弹」与「经营反转」是两种钱：前者赚情绪修复，后者要等新财报与动销数据验证。' },
    ],
  },
  {
    id: 'mainwave', name: '辰光半导体', industry: '半导体',
    basePrice: 30, days: D, seed: 20260818,
    blurb: '国产芯片设计公司，技术口碑不错，股价在底部横盘已久，市场关注度低。',
    archetype: '风格原型：产业趋势驱动的主升浪（参考 2019 年半导体板块行情的走势风格）。',
    lesson: '主升浪里最大的错误是「赚一点就跑」后目送；但趋势后期的股东减持与情绪亢奋是风险信号。持有趋势需要理由，也需要离场纪律。',
    teaching: '趋势确认与持有',
    expertFocus: '趋势持有中的「坐住」与离场信号识别',
    buildBars: buildMainwave,
    events: [
      { day: 19, kind: '公告', title: '获得产业基金战略入股', body: '公司公告：国家级产业投资基金拟战略入股，同时公司新一代产品通过头部客户验证并进入量产。', expert: '横盘蓄势 18 个交易日后的实质性利好，是主升浪典型的「点火」方式。此前的磨人横盘，事后看是筹码收集期。' },
      { day: 40, kind: '新闻', title: '行业景气度持续上行', body: '行业数据显示芯片需求旺盛，多家机构上调板块盈利预测，辰光半导体被列为核心标的。', expert: '主升浪中段的利好是「确认」而非「起点」。此时进场的风险报酬比已不同于底部——赚的是趋势延续的钱，就要接受趋势终结时的回撤。' },
      { day: 52, kind: '公告', title: '股东减持计划预披露', body: '公司公告：持股 5% 以上股东拟在未来 6 个月内减持不超过 2% 的股份。', expert: '产业资本在高位减持是经典的「聪明钱」信号。它不代表马上下跌，但值得放进你的离场纪律里：趋势持仓的退出理由，应该是信号而非恐慌。' },
    ],
  },
  {
    id: 'distribution', name: '金鼎食品', industry: '休闲食品',
    basePrice: 20, days: D, seed: 20260819,
    blurb: '网红零食品牌，两年股价翻了三倍，是机构与散户共同的「心头好」。',
    archetype: '风格原型：高位放量滞涨出货（参考部分消费白马 2021 年顶部区域的走势风格）。',
    lesson: '高位「涨不动 + 成交量巨大」常意味着筹码在从强手转移到弱手。利好兑现后放量不涨，是值得警惕的组合——量在价先。',
    teaching: '量价背离、顶部信号',
    expertFocus: '量价关系：放量不涨时，筹码在谁手里',
    buildBars: buildDistribution,
    events: [
      { day: 28, kind: '公告', title: '年度业绩预增 40%', body: '公司预计全年净利润同比增长约 40%，主要得益于新品放量与渠道扩张。', expert: '业绩大增 + 股价不涨 + 巨量成交，三件事同时出现时要问：好消息为什么推不动价格？常见答案是：有人借利好在大量卖出。' },
      { day: 33, kind: '新闻', title: '机构调仓传闻', body: '市场传闻部分机构正在对食品饮料板块进行调仓，资金流向数据出现分歧。', expert: '高位放量滞涨期，资金流向比价格更诚实。价格可以被托盘维持，成交量不会说谎——巨量换手本身就是「有人离场」的证据。' },
      { day: 42, kind: '公告', title: '控股股东减持公告', body: '控股股东拟减持不超过 3% 的股份，用于「自身资金需求」。', expert: '谜底揭晓：此前一个月的巨量成交中，产业资本在离场。回看顶部区域，「利好 + 放量 + 不涨」的组合早已写好答案。' },
    ],
  },
  {
    id: 'vshape', name: '天启航空', industry: '航空运输',
    basePrice: 9, days: D, seed: 20260820,
    blurb: '区域性航空公司，资产负债率偏高，业绩随出行需求波动。',
    archetype: '风格原型：恐慌急跌后的 V 型反转（参考 2020 年疫情底航空股的走势风格）。',
    lesson: '恐慌急跌里，卖出决定最好在事前（仓位）而非事中（恐慌）。V 型修复在事中无法确认，左侧抄底要做好再跌 20% 的准备。',
    teaching: '恐慌与修复',
    expertFocus: '急跌中的决策顺序：先仓位，后判断',
    buildBars: buildVshape,
    events: [
      { day: 16, kind: '新闻', title: '突发公共事件：出行大面积受限', body: '多地出现突发公共卫生事件，航班大面积取消，出行需求骤降，航空股集体重挫。', expert: '恐慌第一天的坏消息是真实的，但价格会跌到「比真实更坏」的位置——因为杠杆盘与止损盘是被迫卖出，与价值判断无关。' },
      { day: 26, kind: '新闻', title: '纾困政策出台', body: '相关部门出台航空业纾困政策：专项贷款、费用减免与流动性支持一揽子落地。', expert: 'V 型反转的拐点通常由外部力量触发，而非经营改善。事前无法确认底部，只能事后归因——所以左侧抄底必须用「输得起」的仓位。' },
      { day: 45, kind: '公告', title: '经营数据环比大幅改善', body: '公司公告：客座率与票价连续四周环比回升，现金流转正。', expert: '数据确认时，股价已修复大半。这就是「等待确认」的代价：用收益换确定性。抄底派与确认派没有对错，只有各自要承受的代价。' },
    ],
  },
  {
    id: 'bottoming', name: '青石基建', industry: '基建工程',
    basePrice: 6, days: D, seed: 20260821,
    blurb: '老牌基建公司，订单稳定但故事乏味，股价跌到净资产附近后无人问津。',
    archetype: '风格原型：底部长期磨底后启动（参考低估值蓝筹 2014 年下半年的走势风格）。',
    lesson: '底部区域利好常常「不涨」——不是利好没用，是筹码交换还没完成。磨底阶段比的是耐心和分批买入的纪律，没人能精确抄到最低点。',
    teaching: '磨底的耐心、分批布局',
    expertFocus: '底部特征：利好不涨不是利空，是磨底的一部分',
    buildBars: buildBottoming,
    events: [
      { day: 15, kind: '公告', title: '中标 12 亿元基建项目', body: '公司公告中标一项 12 亿元的市政工程，工期两年。公告发布后市场反应平淡。', expert: '底部区域的利好「不涨」是常态：不是利好无效，而是套牢盘与怀疑论者的筹码还没交换完。观察利好不涨的积累，比追逐利好本身更重要。' },
      { day: 30, kind: '新闻', title: '行业政策暖风频吹', body: '稳增长政策加码，基建投资增速回升，多家券商发布板块推荐报告。股价仅小幅高开便回落。', expert: '第二次利好仍然没反应——磨底最考验人对「便宜」的信仰，而这恰恰是它便宜的原因：多数人无法忍受「正确但不涨」的日子。' },
      { day: 42, kind: '公告', title: '季度业绩拐点确认', body: '公司季报显示订单转化加速，毛利率环比回升，经营性现金流明显改善。', expert: '业绩拐点确认后，磨底阶段结束。回看前两次利好都是「对的」，只是市场对的时候还没到——底部买入的难点从来不是判断，而是等待中的自我怀疑。' },
    ],
  },
  {
    id: 'split', name: '飞扬传媒', industry: '传媒娱乐',
    basePrice: 24, days: D, seed: 20260822,
    blurb: '一家内容制作公司，股价较高「看着贵」，市场热传公司将推出高送转方案。',
    archetype: '风格原型：高送转除权炒作（参考 2015—2016 年高送转行情的走势风格）。',
    lesson: '10 送 10 后股价减半、股数翻倍，总市值不变——送转本身不创造任何价值，「填权行情」是情绪游戏。更要警惕「高送转 + 减持」的组合拳。',
    teaching: '高送转的数字游戏、除权机制',
    expertFocus: '送转不改变价值：警惕数字便宜幻觉',
    buildBars: buildSplit,
    split: SPLIT_INFO,
    events: [
      { day: 18, kind: '公告', title: '高送转预案：每 10 股送 10 股', body: '公司董事会提议：以资本公积每 10 股转增 10 股。实施后股本翻倍，股价将除权减半。除权日为第 26 个交易日。', expert: '送转本身不创造一毛钱价值：股数翻倍、价格减半、总市值不变。它改变的只是「看起来便不便宜」——而炒作赚的正是这种错觉的钱。' },
      { day: 26, kind: '提示', title: '今日除权', body: '每 10 股送 10 股已实施：你的持股数量翻倍，股价相应减半，总资产不变。', expert: '除权日的价格「缺口」不是下跌，是股本变化的会计结果。判断这类股票要看总市值与除权后走势，而不是「好便宜，才一半的价格」。' },
      { day: 40, kind: '公告', title: '大股东减持计划公告', body: '控股股东拟于未来 6 个月减持不超过 4% 的股份。', expert: '「高送转 + 减持」是历史上反复出现的组合：前者制造流动性与低价幻觉、吸引接盘资金，后者利用它。组合拳的受益者从来不是散户。' },
    ],
  },
  {
    id: 'stcap', name: 'ST恒发', industry: '有色金属',
    basePrice: 3.6, days: D, seed: 20260823,
    blurb: '一家因连续亏损被实施退市风险警示（ST）的矿业公司，近期公告称有望扭亏。',
    archetype: '风格原型：ST 摘帽困境反转（参考 A 股 ST 板块摘帽行情的走势风格）。',
    lesson: 'ST 摘帽是「预期炒作」：涨的是预期，落地时常兑现。困境反转要看主业是否真改善，而不只是保壳财技。注意：ST 期涨跌幅限制为 ±5%。',
    teaching: '困境反转的风险收益、ST 规则',
    expertFocus: '摘帽预期与主业验证：身份问题 ≠ 盈利能力问题',
    buildBars: buildStcap,
    limitPct: day => (day <= ST_LIMIT_DAYS ? 0.05 : 0.10), // ST 期 ±5%，摘帽后恢复 ±10%
    events: [
      { day: 15, kind: '公告', title: '年报预盈：申请撤销风险警示', body: '公司预计全年扭亏为盈（含资产处置收益），已向交易所申请撤销退市风险警示。', expert: '摘帽行情炒的是「预期差」。注意公告细节：扭亏含「资产处置收益」——保壳财技与主业改善是两回事，摘帽前值得分清。' },
      { day: 22, kind: '公告', title: '摘帽生效公告', body: '交易所同意撤销退市风险警示，股票简称恢复为「恒发矿业」，自次一交易日起涨跌幅限制恢复为 10%。', expert: '摘帽落地日是典型的「兑现窗口」：预期炒作结束后，定价权回到基本面。此前 ±5% 限制压住的涨幅，往往意味着预期已提前透支。' },
      { day: 50, kind: '公告', title: '年报细节披露', body: '年报显示：扭亏主要来自资产处置；主业毛利率仍低于行业平均，矿山品位下降问题未解。', expert: '摘帽解决的是「身份问题」，不解决「盈利能力问题」。主业未改善的困境反转，估值修复的空间有限——财报细节比摘帽公告诚实。' },
    ],
  },
  {
    id: 'ipo', name: '云启数据', industry: '数据服务',
    basePrice: 12, days: D, seed: 20260824,
    blurb: '一只刚上市的新股，赛道热门、发行市盈率不低，市场打新热情高涨。',
    archetype: '风格原型：新股上市连板与开板巨震（参考 A 股新股「一字板」时代的走势风格）。',
    lesson: '新股连板是「筹码稀缺 + 情绪」的游戏。开板后追高，是在为此前所有涨停板的获利盘买单。与你无关的基本面，开板后才开始定价。',
    teaching: '新股炒作风险、开板后的定价',
    expertFocus: '开板前是筹码游戏，开板后才是价值定价',
    buildBars: buildIpo,
    events: [
      { day: 1, kind: '提示', title: '新股上市首日', body: '云启数据今日上市，首日上涨 44%。新股上市初期常见连续涨停：中签者惜售、筹码稀缺。注意：本模拟中涨停日无法买入（买单排不到队）。', expert: '新股连板的本质是筹码游戏：打新者的浮盈巨大但无人卖出，价格由「最小阻力位」决定。这段涨幅与基本面无关，也几乎与你无关——涨停板上排不到队。' },
      { day: 9, kind: '新闻', title: '开板巨量长阴：获利盘涌出', body: '云启数据在连续 7 个一字涨停后今日开板，盘中巨量剧震，换手剧烈，此前排队买入的资金终于成交。', expert: '开板日的巨量长阴意味着：打新盛宴结束，二级市场定价从这一刻才真正开始。此时买入的人，是在为此前 7 个涨停板的获利盘提供流动性。' },
      { day: 30, kind: '公告', title: '业绩快报：增速低于招股预期', body: '公司业绩快报显示：营收增速低于招股说明书中的预测区间，市场竞争加剧。', expert: '新股估值常以「最乐观的招股叙事」定价。业绩证伪后的价值回归以月为单位——开板日追高的人，等的不是反弹，是下一次叙事。' },
    ],
  },
  {
    id: 'bluechip', name: '白象电器', industry: '家用电器',
    basePrice: 35, days: D, seed: 20260825,
    blurb: '家喻户晓的白电龙头，业绩稳定、分红慷慨，被市场视为「防御型白马」。',
    archetype: '风格原型：系统性调整末期的白马补跌（参考熊市末期优质蓝筹的补跌风格）。',
    lesson: '熊市末期，流动性好的白马反而会被卖出（因为卖得出去）——补跌不是基本面恶化。区分「公司出问题」和「市场出问题」，答案不同，应对也相反。',
    teaching: '系统性风险与补跌',
    expertFocus: '补跌 ≠ 变质：区分公司问题与市场问题',
    buildBars: buildBluechip,
    events: [
      { day: 8, kind: '新闻', title: '市场系统性调整，白马相对抗跌', body: '市场持续调整，题材股领跌；白象电器等业绩稳定的白马股相对抗跌，被资金视为避风港。', expert: '熊市前中期，白马因基本面扎实而抗跌——「相对收益」为正。但注意：抗跌是资金抱团的结果，不是免疫力的证明。' },
      { day: 31, kind: '新闻', title: '流动性冲击：机构被迫减持优质资产', body: '市场流动性骤然收紧，传闻部分机构因赎回压力被迫卖出流动性好的持仓，白马股集体补跌。', expert: '补跌的逻辑很反直觉：机构被赎回时，卖得出去的优质资产先被卖。公司没问题，是市场出问题了——这两种下跌的性质和结局完全不同。' },
      { day: 45, kind: '公告', title: '季度业绩：符合预期', body: '公司季报显示营收与利润稳定增长，分红政策不变，经营一切正常。', expert: '基本面没变而股价一度跌去近 18%——这是「市场先生」的经典剧本。区分定价错误与价值毁灭，是逆向投资的基本功：前者是机会，后者是陷阱。' },
    ],
  },
  {
    id: 'regulatory', name: '幻影互娱', industry: '网络游戏',
    basePrice: 8, days: D, seed: 20260826,
    blurb: '一家中小型游戏公司，主业平淡，但管理层「善于蹭热点」，市场上概念缠身。',
    archetype: '风格原型：题材炒作遇监管问询熄火（参考 A 股多次概念炒作与问询案例的走势风格）。',
    lesson: '蹭概念炒作的核心问题是「故事与公司无关」。问询函回复里的收入占比数字，比任何 K 线形态都诚实。',
    teaching: '题材炒作与监管风险',
    expertFocus: '题材与报表的对照：收入占比是试金石',
    buildBars: buildRegulatory,
    events: [
      { day: 21, kind: '新闻', title: '蹭上热门概念', body: '幻影互娱在互动平台表示「正在研究热门技术在业务中的布局」，被市场归入当下最热概念板块，股价连续大涨。', expert: '「正在研究」「拟布局」是题材股的标志性措辞——它制造想象空间，同时什么都不承诺。概念行情的涨幅，大致等于想象与现实的差距。' },
      { day: 28, kind: '公告', title: '收到交易所问询函', body: '交易所下发问询函，要求公司说明相关业务的具体进展、收入占比，以及是否存在蹭热点、误导投资者的情形。', expert: '问询函的核心问题永远是「相关业务到底贡献多少收入」。这个问题 K 线回答不了，报表能——它是题材炒作最锋利的试金石。' },
      { day: 29, kind: '公告', title: '问询函回复：相关收入占比不足 1%', body: '公司回复：相关业务尚处早期探索阶段，最近一年收入占比不足 1%，请投资者注意风险。', expert: '谜底揭晓：故事讲了 8 个交易日，收入占比不到 1%。题材炒作的终点都是基本面称重的时刻——或早或晚。' },
    ],
  },
  {
    id: 'earnings', name: '绿田农牧', industry: '农牧养殖',
    basePrice: 15, days: D, seed: 20260827,
    blurb: '一家养殖企业，此前连续两年亏损，近期发布预喜公告，称经营明显好转。',
    archetype: '风格原型：业绩预告变脸（参考 A 股多次「预喜转预亏」案例的走势风格）。',
    lesson: '业绩预告是「估计」，不是承诺。变脸常见于存货与资产减值。持有预喜股要问：利润从哪来？经得起一次减值吗？',
    teaching: '业绩预告的跟踪验证',
    expertFocus: '预喜的利润质量：从哪里来，经得起减值吗',
    buildBars: buildEarnings,
    events: [
      { day: 10, kind: '公告', title: '业绩预告：预计全年扭亏为盈', body: '公司预计全年实现扭亏为盈，主要原因是产品价格上涨与成本管控见效。', expert: '预喜值得欢迎，但预告是「估计」不是「审计」。跟踪的重点是利润结构：价格上涨带来的利润，会随价格回落消失；这才是变脸的地基。' },
      { day: 26, kind: '公告', title: '业绩预告修正：由盈转亏', body: '公司修正业绩预告：因存栏生物资产减值与产品价格回落，预计全年由盈利转为亏损。', expert: '业绩变脸的常见载体是「减值」：存货、商誉、生物资产。预喜时就该问：这个利润经得起一次减值吗？变脸不是黑天鹅，是预喜利润质量的证伪。' },
      { day: 40, kind: '公告', title: '问询函回复：减值原因说明', body: '公司回复交易所问询，详细说明减值测算过程，并称「前期信息披露不存在故意误导」。', expert: '变脸后的第一次反弹常伴随「利空出尽」的说法。但信任修复需要下一次经审计财报确认——在此之前，反弹的性质是超跌修复而非基本面反转。' },
    ],
  },
  {
    id: 'gapup', name: '海程航运', industry: '远洋航运',
    basePrice: 7.5, days: D, seed: 20260828,
    blurb: '一家远洋航运公司，运价低迷已久，股价跟随运价指数在底部徘徊。',
    archetype: '风格原型：强周期拐点的高开行情（参考航运股在运价周期反转时的走势风格）。',
    lesson: '周期股的利好公布时，股价往往已提前反应。高开意味着「买在一致预期」；周期反转的第一根大阳线，是研究的起点而不是终点。',
    teaching: '周期拐点与追高',
    expertFocus: '高开日的核心问题：价格已经包含了多少预期',
    buildBars: buildGapup,
    events: [
      { day: 20, kind: '公告', title: '运价指数单周暴涨', body: '盘后数据显示：国际运价指数单周上涨超 30%，主要航线舱位紧张。公司晚间公告提示经营环境改善。', expert: '周期品的利好是可公开验证的价格数据——这很扎实。但注意：明天的高开意味着消息已无差价可赚，你买入的是「运价继续涨」的预期。' },
      { day: 21, kind: '提示', title: '大幅高开', body: '受运价暴涨消息刺激，股价大幅高开约 8%。追高买入的本质，是为「一致预期」支付溢价。', expert: '高开日的关键问题不是「利好是不是真的」，而是「价格已经包含了多少预期」。一致预期越拥挤，后续的接力资金越难找。' },
      { day: 35, kind: '新闻', title: '运价见顶回落，机构分歧加大', body: '最新运价指数环比回落，部分机构认为周期高点已现，另一部分认为只是短暂调整。', expert: '周期股看价格拐点：运价见顶后，股价通常先于运价回落——因为股价定价的是预期。跟踪运价数据，比跟踪股价本身更接近本质。' },
    ],
  },
];
