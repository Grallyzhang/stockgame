// 游戏状态与本地存档（localStorage）
import { INITIAL_CASH } from './data.js';

const SAVE_KEY = 'stock-town-save-v1';   // key 名保留不变；版本由 version 字段控制

export function newGame() {
  const seed = (Math.random() * 2 ** 31) | 0;
  return {
    version: 3,
    seed,
    day: 1,
    cash: INITIAL_CASH,
    positions: {},      // id -> { shares, avgCost, sellable }（sellable：T+1 可卖数量）
    orders: [],         // 全部委托（含已成交/已撤销）
    trades: [],         // 成交记录
    orderSeq: 1,
    log: [{ day: 1, type: 'info', text: '欢迎来到股市小镇！点击镇上的公司建筑，先看看它们吧。' }],
    unlocked: { trade: false, chart: false, review: false, book: false, index: false, ma: false, macd: false },
    labLevel: 1,
    tasks: { active: 't1', done: [], sub: '' },
    flags: { viewed: {}, investigated: {}, investigationLeft: 2, decision: null, decisionReason: '', predictions: {} },
    stats: { predictions: { right: 0, wrong: 0, half: 0 } },
    achievements: [],
    reviewSeen: false,
    mode: null,                       // 'town' | 'replay' | 'live' | null（未选择，先进入口屏）
    replay: { active: null, history: {} },  // 回放：进行中的对局 + 各剧本历史成绩
    live: null,                       // 实时模拟账户（首次进入实时模式时由 live.newLive 创建）
  };
}

// v1/v2 → v3 迁移：教学大纲升级为「六章二十八课」（60 天），教学进度重置；历史回放成绩保留
export function migrate(st) {
  if (!st || st.version === 3) return st;
  if (st.version === 1 || st.version === 2) {
    const fresh = newGame();
    fresh.replay = st.replay || fresh.replay;
    fresh.mode = st.mode === undefined ? 'town' : st.mode;
    fresh.notice = '教学大纲已升级为「六章二十八课」（60 天，新增 K 线形态、量价均线、MACD、估值与三次预测-验证）。教学进度与旧持仓已重置，历史回放成绩完整保留。';
    return fresh;
  }
  return null;
}

export function load() {
  try {
    const s = localStorage.getItem(SAVE_KEY);
    if (!s) return null;
    const st = migrate(JSON.parse(s));
    if (st && st.live === undefined) st.live = null;   // 实时模式存档分支（null=未开始）
    return st;
  } catch { return null; }
}

export function save(st) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(st)); } catch { /* 存储失败不阻塞游戏 */ }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

export function log(st, type, text) {
  st.log.push({ day: st.day, type, text });
}
