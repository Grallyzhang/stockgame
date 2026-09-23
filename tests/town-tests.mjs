// 无头测试：data/market/state/indicators/lessons 纯逻辑（node tests/town-tests.mjs）
import { buildMarket, TOTAL_DAYS, DIVIDEND, COMPANIES, CONCEPTS, ACHIEVEMENTS } from '../js/data.js';
import { quote, placeOrder, advanceDay, limitUp, limitDown, isLimitUpDay, townIndex, totalAssets, bestGainDay } from '../js/market.js';
import { newGame, migrate } from '../js/state.js';
import { numOk, round2 } from '../js/util.js';
import { candleSVG, bookHTML, macdSVG } from '../js/ui.js';
import { maSeries, detectCross, macd } from '../js/indicators.js';
import { judge } from '../js/lessons.js';
import { isUnlocked, unlockProgress, CORE_SCENARIOS } from '../js/live.js';

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log(`ok ${pass + fail} - ${name}`); }
  else { fail++; console.error(`FAIL - ${name}`); }
}

const SEED = 20260922;
const mkt = buildMarket(SEED);

// ---- 行情脚本 ----
t('行情共 60 天', TOTAL_DAYS === 60 && COMPANIES.every(c => mkt[c.id].length === 60));
const mkt2 = buildMarket(SEED);
t('同种子行情可复现', COMPANIES.every(c => mkt[c.id][20].close === mkt2[c.id][20].close));

const p12 = quote(mkt, 'pinecone', 12).close, p13 = quote(mkt, 'pinecone', 13).close;
t('松果第 13 天精确除息 −0.20', p13 === Math.round((p12 - 0.20) * 100) / 100);

const f8 = quote(mkt, 'firefly', 8).close, f9 = quote(mkt, 'firefly', 9).close;
t('萤火第 9 天精确涨停 +10%', f9 === Math.round(f8 * 1.10 * 100) / 100);
t('第 9 天 isLimitUpDay', isLimitUpDay(mkt, 'firefly', 9));
t('第 9 天涨停价=收盘价', limitUp(mkt, 'firefly', 9) === f9);

// ---- 强制教学形态（K 线课，任何种子下精确成立） ----
{
  const b = d => quote(mkt, 'pinecone', d);
  const body15 = (b(15).close - b(15).open) / b(15).open;
  t('d15 大阳线实体 > 3.5%', body15 > 0.035);
  const body16 = (b(16).close - b(16).open) / b(16).open;
  t('d16 大阴线实体 < −3.5%', body16 < -0.035);
  t('d20 十字星 |收−开|/开 < 0.2%', Math.abs(b(20).close - b(20).open) / b(20).open < 0.002);
  t('d24 看涨吞没（开<前收 且 收>前开）', b(24).open < b(23).close && b(24).close > b(23).open);
  t('d29 跳空缺口（low > d28.high）', b(29).low > b(28).high);
  const mid31 = (b(31).open + b(31).close) / 2;
  t('d33 暮星③收盘低于①实体中点', b(33).close < mid31);
}

// ---- d56 行业冲击（旧 d25 后移） ----
const p55 = quote(mkt, 'pinecone', 55).close, p56 = quote(mkt, 'pinecone', 56).close;
const shock = (p56 - p55) / p55;
t('松果第 56 天行业冲击约 −6%', shock > -0.075 && shock < -0.045);
const b55 = quote(mkt, 'beaver', 55).close, b56 = quote(mkt, 'beaver', 56).close;
t('河狸第 56 天不受冲击（对照组）', Math.abs((b56 - b55) / b55) < 0.02);

// t4 引导价 7.60：第 3-6 天在涨跌停范围内（不被拒）且低于每日最低价（不成交）
{
  let inRange = true, unfilled = true;
  for (let d = 3; d <= 6; d++) {
    if (7.60 < limitDown(mkt, 'pinecone', d) || 7.60 > limitUp(mkt, 'pinecone', d)) inRange = false;
    if (7.60 >= quote(mkt, 'pinecone', d).low) unfilled = false;
  }
  t('引导价 7.60 在涨跌停范围内', inRange);
  t('引导价 7.60 不成交（低于每日最低）', unfilled);
}

// ---- T+1 ----
{
  const st = newGame();
  const r1 = placeOrder(st, mkt, { symbol: 'pinecone', side: 'buy', kind: 'market', lots: 1 });
  t('市价买入成交', r1.ok && r1.order.status === 'filled');
  t('当日买入 sellable=0', st.positions.pinecone.sellable === 0);
  const r2 = placeOrder(st, mkt, { symbol: 'pinecone', side: 'sell', kind: 'market', lots: 1 });
  t('当日卖出被拒（T1）', !r2.ok && r2.code === 'T1');
  advanceDay(st, mkt);
  t('次日 sellable 解冻', st.positions.pinecone.sellable === 100);
  const r3 = placeOrder(st, mkt, { symbol: 'pinecone', side: 'sell', kind: 'market', lots: 1 });
  t('次日卖出成功', r3.ok && r3.order.status === 'filled');
}

// ---- 涨跌停校验 ----
{
  const st = newGame();
  const up = limitUp(mkt, 'pinecone', 1), down = limitDown(mkt, 'pinecone', 1);
  const rHigh = placeOrder(st, mkt, { symbol: 'pinecone', side: 'buy', kind: 'limit', price: up + 0.5, lots: 1 });
  const rLow = placeOrder(st, mkt, { symbol: 'pinecone', side: 'buy', kind: 'limit', price: down - 0.5, lots: 1 });
  t('限价高于涨停被拒（LIMIT_RANGE）', !rHigh.ok && rHigh.code === 'LIMIT_RANGE');
  t('限价低于跌停被拒（LIMIT_RANGE）', !rLow.ok && rLow.code === 'LIMIT_RANGE');
  const rOk = placeOrder(st, mkt, { symbol: 'pinecone', side: 'buy', kind: 'limit', price: 7.60, lots: 1 });
  t('范围内限价单接受', rOk.ok);

  st.day = 9;
  const rUp = placeOrder(st, mkt, { symbol: 'firefly', side: 'buy', kind: 'market', lots: 1 });
  t('涨停日市价买入被拒（LIMIT_UP）', !rUp.ok && rUp.code === 'LIMIT_UP');
}

// ---- 除息恒等式：现金+市值 = 总资产不变 ----
{
  const st = newGame();
  placeOrder(st, mkt, { symbol: 'pinecone', side: 'buy', kind: 'market', lots: 5 }); // 500 股，day1
  while (st.day < 12) advanceDay(st, mkt);
  const before = totalAssets(st, mkt);
  const cashBefore = st.cash;
  advanceDay(st, mkt); // → day 13 除息
  const credit = Math.round(500 * DIVIDEND.perShare * 100) / 100;
  t('除息日红利入账 500×0.2=100', st.cash === Math.round((cashBefore + credit) * 100) / 100);
  const after = totalAssets(st, mkt);
  t('除息恒等式：总资产不变', after === before);
}

// ---- 指数 ----
{
  t('第 1 天指数 = 1000', townIndex(mkt, 1) === 1000);
  const i12 = townIndex(mkt, 12), i13 = townIndex(mkt, 13);
  t('除息日指数不被分红拖累（±1% 内）', Math.abs(i13 - i12) / i12 < 0.01);
  // L8 答题场景：构造假行情验证市值加权方向
  const fake = {
    pinecone: [{ close: 10 }, { close: 9.8 }],   // -2%，市值 10 亿
    beaver: [{ close: 50 }, { close: 51.5 }],    // +3%，市值 10 亿 → 等权时 +0.33%
    firefly: [{ close: 100 }, { close: 100 }],   // 持平，市值 5 亿
  };
  t('指数市值加权方向正确', townIndex(fake, 2) > townIndex(fake, 1));
}

// ---- 指标纯函数 ----
{
  const mk = closes => closes.map(c => ({ close: c }));
  const ma3 = maSeries(mk([1, 2, 3, 4, 5]), 3);
  t('maSeries 前 n-1 个为 null', ma3[0] === null && ma3[1] === null);
  t('maSeries 手算 (1+2+3)/3=2', ma3[2] === 2);
  t('maSeries 手算 (3+4+5)/3=4', ma3[4] === 4);
  t('maSeries 等长', ma3.length === 5);

  // 合成序列：short 第 3 根上穿 long（gold），第 5 根下穿（dead）
  const short = [1, 1, 3, 3, 1], long = [2, 2, 2, 2, 2];
  t('detectCross 上穿 = gold', detectCross(short, long, 2) === 'gold');
  t('detectCross 下穿 = dead', detectCross(short, long, 4) === 'dead');
  t('detectCross 无交叉 = null', detectCross(short, long, 1) === null && detectCross(short, long, 3) === null);
  t('detectCross null 段安全', detectCross([null, 1], [1, 1], 1) === null);

  const m60 = macd(mkt.pinecone);
  t('macd 等长', m60.dif.length === 60 && m60.dea.length === 60 && m60.hist.length === 60);
  t('macd 前 25 个为 null', m60.dif.slice(0, 25).every(v => v === null) && m60.hist[24] === null);
  t('macd 第 26 根起有效', m60.dif[25] !== null && m60.dea[25] !== null && m60.hist[25] !== null);
  const mShort = macd(mkt.pinecone.slice(0, 10));
  t('macd 数据不足 26 根全 null', mShort.dif.every(v => v === null));
}

// ---- 预测判定 judge（合成市场三分支） ----
{
  const mUp = { x: [{ close: 100 }, { close: 103 }] };      // +3%
  t('judge 选对方向 = right', judge(mUp, 'x', 1, 2, 0).verdict === 'right');
  t('judge 选错方向 = wrong', judge(mUp, 'x', 1, 2, 1).verdict === 'wrong');
  const mFlat = { x: [{ close: 100 }, { close: 100.5 }] };  // +0.5% ≤ 1.5% → flat
  t('judge 实际横盘选横盘 = right', judge(mFlat, 'x', 1, 2, 2).verdict === 'right');
  t('judge 实际横盘选方向 = half', judge(mFlat, 'x', 1, 2, 0).verdict === 'half');
  const mDown = { x: [{ close: 100 }, { close: 97 }] };     // −3%
  t('judge 选跌对 = right', judge(mDown, 'x', 1, 2, 1).verdict === 'right');
}

// ---- 预测判定 judge（真实行情脚本结局） ----
{
  const r1 = judge(mkt, 'pinecone', 24, 27, 0); // 吞没：选涨
  t('预测① 吞没 d24→27 选涨 = right（真涨）', r1.verdict === 'right' && r1.pct > 0.015);
  const r2 = judge(mkt, 'pinecone', 33, 36, 1); // 暮星：选跌
  t('预测② 暮星 d33→36 选跌 = wrong（不跌反涨，当场打假）', r2.verdict === 'wrong' && r2.pct > 0.015);
}

// ---- 存档迁移 v1/v2 → v3 ----
{
  const v1 = {
    version: 1, seed: 123, day: 20, cash: 99999, positions: { pinecone: { shares: 100, avgCost: 8.3 } },
    orders: [], trades: [], orderSeq: 5, log: [{ day: 1, type: 'info', text: 'x' }],
    unlocked: { trade: true, chart: true, review: true }, labLevel: 2,
    tasks: { active: 't7', done: ['t1', 't2'], sub: '' }, flags: {}, achievements: ['shareholder'],
    reviewSeen: true, mode: 'town',
    replay: { active: null, history: { quanniang: [{ score: 88 }] } },
  };
  const st1 = migrate(v1);
  t('v1 迁移后 version=3', st1.version === 3);
  t('v1 迁移保留回放成绩', st1.replay.history.quanniang?.[0]?.score === 88);
  t('v1 迁移重置教学进度', st1.tasks.done.length === 0 && st1.tasks.active === 't1');
  t('v1 迁移有升级提示', typeof st1.notice === 'string' && st1.notice.length > 0);

  const v2 = { ...v1, version: 2 };
  const st2 = migrate(v2);
  t('v2 迁移后 version=3', st2.version === 3);
  t('v2 迁移保留回放成绩', st2.replay.history.quanniang?.[0]?.score === 88);
  t('迁移后预测统计结构存在', st2.stats?.predictions?.right === 0 && st2.stats.predictions.wrong === 0 && st2.stats.predictions.half === 0);
  t('迁移后预测 flags 结构存在', st2.flags?.predictions !== undefined);
  t('迁移后 unlocked.ma/macd 存在', st2.unlocked.ma === false && st2.unlocked.macd === false);
  t('v3 原样通过', migrate(st2) === st2);
  t('未知版本返回 null', migrate({ version: 99 }) === null);
}

// ---- 内容完整性 ----
t('概念卡共 20 张', Object.keys(CONCEPTS).length === 20);
t('成就共 16 个', ACHIEVEMENTS.length === 16);

// ---- 实时模式解锁门槛（main.js 模式卡依赖） ----
{
  const st = newGame();
  t('新存档实时模式未解锁', !isUnlocked(st) && unlockProgress(st) === 0);
  t('核心剧本共 4 个', CORE_SCENARIOS.length === 4);
  for (const id of CORE_SCENARIOS.slice(0, 3)) st.replay.history[id] = [{ ret: 0.1 }];
  t('完成 3/4 未解锁', !isUnlocked(st) && unlockProgress(st) === 3);
  st.replay.history[CORE_SCENARIOS[3]] = [{ ret: -0.05 }];
  t('完成 4/4 解锁', isUnlocked(st) && unlockProgress(st) === 4);
}

// ---- 实操化改造：纯函数与渲染命中层 ----
{
  // bestGainDay 与独立暴力实现一致
  const brute = (() => {
    let best = 2, bestV = -Infinity;
    for (let d = 2; d <= 10; d++) {
      const pct = (mkt.pinecone[d - 1].close - mkt.pinecone[d - 2].close) / mkt.pinecone[d - 2].close;
      if (pct > bestV) { bestV = pct; best = d; }
    }
    return best;
  })();
  t('bestGainDay 与暴力一致', bestGainDay(mkt, 'pinecone', 10) === brute);

  // numOk 容差判定：±2% 内通过，之外拒绝，非法输入拒绝
  t('numOk +1.9% 通过', numOk(101.9, 100));
  t('numOk +2.1% 拒绝', !numOk(102.1, 100));
  t('numOk NaN 拒绝', !numOk(NaN, 100));
  t('numOk 非数字拒绝', !numOk(undefined, 100) && !numOk('8', 8));

  // 课程计算题答案
  t('t3 红利 100×0.20=20', round2(100 * DIVIDEND.perShare) === 20);
  t('t27 摊平 (1070+950)/200=10.10', round2((10.70 * 100 + 9.50 * 100) / 200) === 10.10);
  const shockAns = round2(100000 * Math.abs(shock));
  t('t26 例账全仓松果 day56 亏约 6000', shockAns > 4500 && shockAns < 7500);

  // candleSVG 每根蜡烛都有点击命中层（含停牌日）
  const bars = mkt.pinecone.slice(0, 10);
  t('candleSVG 命中层数=bars 数', (candleSVG(bars).match(/candle-hit/g) || []).length === bars.length);
  const barsS = [...mkt.pinecone.slice(0, 5), { day: 99, open: 8, close: 8, high: 8, low: 8, volume: 0, suspended: true }];
  t('停牌日也有命中层', (candleSVG(barsS).match(/candle-hit/g) || []).length === barsS.length);

  // candleSVG opts.ma：3 条均线 polyline；opts.markers：信号竖带
  const svgMa = candleSVG(mkt.pinecone.slice(0, 30), { ma: [5, 10, 20] });
  t('candleSVG ma=[5,10,20] 画 3 条 ma-line', (svgMa.match(/class="ma-line"/g) || []).length === 3);
  t('candleSVG 单参无 ma-line', (candleSVG(bars).match(/ma-line/g) || []).length === 0);
  const svgMk = candleSVG(bars, { markers: [{ day: 3, label: '吞没' }] });
  t('candleSVG markers 画 sig-marker', (svgMk.match(/sig-marker/g) || []).length === 1);
  t('candleSVG MA 线不拦截点击', svgMa.includes('pointer-events="none"'));

  // macdSVG：60 根 → 35 根 hist 柱（前 25 根 null）；短数据提示
  const svgMacd = macdSVG(mkt.pinecone);
  t('macdSVG hist 柱数 = 60−25', (svgMacd.match(/<rect/g) || []).length === 35);
  t('macdSVG 含 DIF/DEA 双线', (svgMacd.match(/<polyline/g) || []).length === 2);
  t('macdSVG 短数据给提示', macdSVG(mkt.pinecone.slice(0, 10)).includes('至少需要 26 个交易日') || macdSVG(mkt.pinecone.slice(0, 10)).includes('至少 26'));

  // 盘口行带 data-row（卖一 ask1 用于 t5 判定）
  const stB = newGame();
  stB.unlocked.book = true;
  const bookH = bookHTML({ st: stB, market: mkt, ui: { company: 'pinecone' } });
  t('盘口含 data-row="ask1"', bookH.includes('data-row="ask1"'));
  t('盘口含 data-row="bid5"', bookH.includes('data-row="bid5"'));
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
