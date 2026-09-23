// AI 问答（DeepSeek API）：教学解释助手
// 设计纪律（对应需求文档）：
//  - AI 只做「解释」，不推荐买卖、不预测涨跌、不承诺收益；
//  - 上下文严格截断到当前交易日，不泄露未来行情与剧本结局（archetype/lesson 不发送）；
//  - 密钥由用户自己填写，仅存其浏览器 localStorage，仅发往 DeepSeek 官方接口，不落任何服务端。
import { prevClose, dayPct, limitPctOf, REPLAY_CASH, equityAt } from './replay.js';
import { fmtVolume, round2 } from './util.js';

const AI_CFG_KEY = 'stock-town-ai-config';
const API_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_MODEL = 'deepseek-chat';

// 站点代理（Cloudflare Worker，见 worker/ 目录）：填上代理地址后，访客无需密钥即可使用 AI 问答。
// 留空则恢复「用户自填密钥」模式。部署方法见 worker/wrangler.toml 顶部注释。
const PROXY_URL = '';

export function loadConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(AI_CFG_KEY) || '{}');
    return { apiKey: c.apiKey || '', model: c.model || DEFAULT_MODEL };
  } catch { return { apiKey: '', model: DEFAULT_MODEL }; }
}
export function saveConfig(cfg) {
  try { localStorage.setItem(AI_CFG_KEY, JSON.stringify({ apiKey: cfg.apiKey || '', model: cfg.model || DEFAULT_MODEL })); } catch { /* ignore */ }
}
// 有用户密钥或站点代理任一即可使用
export const hasKey = () => !!loadConfig().apiKey || !!PROXY_URL;
export const usingProxy = () => !loadConfig().apiKey && !!PROXY_URL;

const SYSTEM_PROMPT = `你是「股市小镇」股票学习游戏里的教学助手，面向零基础学习者。请严格遵守：
1. 只基于用户提供的「截至当日的可见信息」回答，不得编造、暗示或预测未来走势与剧本结局；
2. 不推荐具体买卖操作、不预测涨跌、不承诺收益；用户要求荐股或择时时，把话题引回「买入理由、风险来源、仓位管理」的思考框架；
3. 结合当日行情与公告解释概念，用通俗语言，必要时举小例子；
4. 剧本中的公司与行情均为虚构教学数据；回答控制在 300 字以内，重点突出；
5. 结尾不需要免责声明（界面已统一展示），不要重复问题。`;

// 构建「截至 day 可见」的上下文文本。防剧透：只引用 ≤ day 的行情与公告，不含风格原型与课程总结。
export function buildContext({ sc, bars, run, day }) {
  const lines = [];
  lines.push(`【回放剧本（虚构）】${sc.name}（${sc.industry}）`);
  lines.push(`公司简介：${sc.blurb}`);
  lines.push(`当前进度：第 ${day} / ${sc.days} 个交易日（未来行情不可见）`);

  // 近 12 个交易日的行情（严格 ≤ day）
  const from = Math.max(1, day - 11);
  lines.push(`近期行情（开/高/低/收/成交量）：`);
  for (let d = from; d <= day; d++) {
    const b = bars[d - 1];
    if (b.suspended) { lines.push(`  第${d}天：停牌，无成交`); continue; }
    const pct = dayPct(bars, d, sc.basePrice);
    const tag = Math.abs(pct) >= limitPctOf(sc, d) - 0.001 ? (pct > 0 ? '（涨停）' : '（跌停）') : '';
    lines.push(`  第${d}天：${b.open.toFixed(2)} / ${b.high.toFixed(2)} / ${b.low.toFixed(2)} / ${b.close.toFixed(2)}，${(pct * 100).toFixed(2)}%，量 ${fmtVolume(b.volume)}${tag}`);
  }

  // 已披露公告（严格 ≤ day）
  const anns = sc.events.filter(e => e.day <= day);
  if (anns.length) {
    lines.push(`已披露的公告/新闻（按披露时间）：`);
    for (const e of anns) lines.push(`  第${e.day}天【${e.kind}】《${e.title}》：${e.body}`);
  } else {
    lines.push('目前尚无公告或新闻披露。');
  }

  // 我的账户与操作（截至当前）
  const eq = equityAt(run, bars, sc.basePrice, day);
  lines.push(`我的账户：现金 ${run.cash.toFixed(2)} 元，持仓 ${run.pos.shares} 股（成本 ${run.pos.avgCost.toFixed(2)} 元），总资产约 ${eq.toFixed(2)} 元（初始 ${REPLAY_CASH} 元）。`);
  if (run.trades.length) {
    const recent = run.trades.filter(t => t.day <= day).slice(-5)
      .map(t => `第${t.day}天${t.side === 'buy' ? '买入' : '卖出'}${t.qty}股@${t.price.toFixed(2)}`).join('；');
    lines.push(`我的最近操作：${recent}`);
  } else {
    lines.push('我目前还没有交易过。');
  }
  return lines.join('\n');
}

// 调用 DeepSeek（OpenAI 兼容接口）。返回助手文本；失败抛出带用户可读信息的 Error。
// 用户自填密钥时直连 DeepSeek；无密钥时走站点代理（PROXY_URL，密钥在服务端）。
export async function ask(cfg, contextText, question, { timeoutMs = 45000 } = {}) {
  const viaProxy = !cfg.apiKey && !!PROXY_URL;
  const url = viaProxy ? PROXY_URL : API_URL;
  const headers = { 'Content-Type': 'application/json' };
  if (!viaProxy) headers.Authorization = `Bearer ${cfg.apiKey}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: cfg.model || DEFAULT_MODEL,
        stream: false,
        temperature: 0.7,
        max_tokens: 800,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `${contextText}\n\n【我的问题】${question}` },
        ],
      }),
      signal: ctrl.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('请求超时（45 秒）。网络较慢或接口繁忙，请稍后再试。');
    throw new Error(viaProxy ? '无法连接站点代理（网络异常）。请稍后再试。' : '无法连接 DeepSeek 接口（网络异常或浏览器拦截）。请检查网络后重试。');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(viaProxy ? '站点 AI 服务暂时不可用，请稍后再试。' : 'API 密钥无效或已过期。请在上方设置中检查密钥。');
  }
  if (res.status === 402) throw new Error(viaProxy ? '站点 AI 额度已用完，请稍后再试。' : 'DeepSeek 账户余额不足，请到平台充值后再试。');
  if (res.status === 429) throw new Error('请求过于频繁，稍等几秒再试。');
  if (!res.ok) throw new Error(`接口返回错误（HTTP ${res.status}），请稍后再试。`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('接口返回了空内容，请换个问法再试。');
  return text.trim();
}

// 供测试与界面引用
export { SYSTEM_PROMPT, API_URL, DEFAULT_MODEL };
