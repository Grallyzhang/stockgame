// Cloudflare Worker：DeepSeek 问答代理
// 作用：让访客免密使用 AI 问答；密钥只存在于服务端环境变量，不进前端代码。
// 密钥配置（密钥绝不写进本文件）：
//   wrangler secret put DEEPSEEK_API_KEY
// 防滥用：本文件限制模型、消息数、长度；另请在 Cloudflare 仪表盘配置速率限制规则。

const UPSTREAM = 'https://api.deepseek.com/chat/completions';
const MAX_MESSAGES = 12;       // 单次请求最多携带的消息条数
const MAX_CONTENT_LEN = 6000;  // 单条消息最大字符数（system + 上下文 + 问题）

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env);

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405, cors);
    if (!env.DEEPSEEK_API_KEY) return json({ error: 'server misconfigured' }, 500, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400, cors); }

    // 基本校验与截断：防止客户端注入超长上下文刷 token
    const msgs = Array.isArray(body.messages) ? body.messages.slice(-MAX_MESSAGES) : [];
    if (!msgs.length) return json({ error: 'messages required' }, 400, cors);
    for (const m of msgs) {
      if (!m || typeof m.content !== 'string' || m.content.length > MAX_CONTENT_LEN) {
        return json({ error: 'invalid messages' }, 400, cors);
      }
      if (m.role !== 'system' && m.role !== 'user' && m.role !== 'assistant') {
        return json({ error: 'invalid role' }, 400, cors);
      }
    }

    let upstream;
    try {
      upstream = await fetch(UPSTREAM, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
        body: JSON.stringify({
          model: 'deepseek-chat', // 模型写死，防止客户端改用最贵的模型
          stream: false,
          temperature: 0.7,
          max_tokens: 800,
          messages: msgs,
        }),
      });
    } catch {
      return json({ error: 'upstream unreachable' }, 502, cors);
    }

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
    });
  },
};

function corsHeaders(env) {
  return {
    // 部署后建议把 ALLOWED_ORIGIN 设为你的站点域名（wrangler.toml 的 [vars]）
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
  });
}
