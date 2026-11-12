export const PROVIDER = (process.env.AI_PROVIDER || 'claude').toLowerCase();
const OPENAI = PROVIDER === 'openai';

export const MODEL = OPENAI
  ? (process.env.OPENAI_MODEL || 'gpt-4o')
  : (process.env.CLAUDE_MODEL || 'claude-opus-5-5');

export const FAST_MODEL = OPENAI
  ? (process.env.OPENAI_FAST_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini')
  : (process.env.EXT_FAST_MODEL || 'claude-sonnet-5-5');

const OPENAI_BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');

let client = null;
export async function getClient() {
  if (client) return client;
  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    throw new Error('Не установлен @anthropic-ai/sdk — выполните npm install');
  }
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID;
  client = new Anthropic(workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {});
  return client;
}

function textOf(blocks) {
  return blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

function toOpenAIContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content ?? '');
  return content.map((b) => {
    if (b.type === 'image' && b.source) {
      return { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } };
    }
    if (b.type === 'image_url') return b;
    return { type: 'text', text: String(b.text ?? '') };
  });
}

function toOpenAIMessages(system, messages) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (typeof m.content === 'string') { out.push({ role: m.role, content: m.content }); continue; }
    const blocks = Array.isArray(m.content) ? m.content : [];
    const toolUses = blocks.filter((b) => b.type === 'tool_use');
    const toolResults = blocks.filter((b) => b.type === 'tool_result');
    const rest = blocks.filter((b) => b.type !== 'tool_use' && b.type !== 'tool_result');
    if (toolUses.length) {
      out.push({
        role: 'assistant',
        content: textOf(rest) || null,
        tool_calls: toolUses.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.input || {}) } })),
      });
    } else if (toolResults.length) {
      for (const r of toolResults) out.push({ role: 'tool', tool_call_id: r.tool_use_id, content: String(r.content ?? '') });
      if (rest.length) out.push({ role: m.role, content: toOpenAIContent(rest) });
    } else {
      out.push({ role: m.role, content: toOpenAIContent(blocks) });
    }
  }
  return out;
}

async function openaiCall(body, { onText, signal } = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) { const e = new Error('OPENAI_API_KEY не задан'); e.status = 401; throw e; }
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!onText) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data?.error?.message || `OpenAI ${res.status}`); e.status = res.status; throw e; }
    return data.choices?.[0]?.message || {};
  }
  if (!res.ok || !res.body) { const data = await res.json().catch(() => ({})); const e = new Error(data?.error?.message || `OpenAI ${res.status}`); e.status = res.status; throw e; }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const payload = s.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
        if (delta) { full += delta; onText(full); }
      } catch {}
    }
  }
  return { content: full };
}

export async function askClaude({ system, content, messages, model = MODEL, effort = 'medium', maxTokens = 16000 }) {
  const msgs = messages ?? [{ role: 'user', content }];
  if (OPENAI) {
    const m = await openaiCall({ model, max_tokens: maxTokens, messages: toOpenAIMessages(system, msgs) });
    const text = String(m.content || '').trim();
    if (!text) throw new Error('Пустой ответ модели');
    return { text, model };
  }
  const c = await getClient();
  const response = await c.beta.messages.create({
    model, max_tokens: maxTokens, thinking: { type: 'adaptive' }, output_config: { effort },
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', system, messages: msgs,
  });
  if (response.stop_reason === 'refusal') throw new Error('Модель отказалась отвечать на этот запрос');
  const text = textOf(response.content);
  if (!text) throw new Error('Пустой ответ модели');
  return { text, model: response.model };
}

export async function askClaudeStream({ system, content, messages, effort = 'medium', maxTokens = 16000, onText, signal, model = MODEL }) {
  const msgs = messages ?? [{ role: 'user', content }];
  if (OPENAI) {
    const r = await openaiCall({ model, max_tokens: maxTokens, stream: true, messages: toOpenAIMessages(system, msgs) }, { onText, signal });
    const text = String(r.content || '').trim();
    if (!text) throw new Error('Пустой ответ модели');
    return { text, model };
  }
  const c = await getClient();
  const stream = c.beta.messages.stream(
    {
      model, max_tokens: maxTokens, thinking: { type: 'adaptive' }, output_config: { effort },
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', system, messages: msgs,
    },
    signal ? { signal } : undefined,
  );
  if (onText) stream.on('text', (_delta, snapshot) => onText(snapshot));
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('Модель отказалась отвечать на этот запрос');
  const text = textOf(msg.content);
  if (!text) throw new Error('Пустой ответ модели');
  return { text, model: msg.model };
}

export async function askClaudeJSON({ system, content, messages, schema, effort = 'low', maxTokens = 2000, model = MODEL }) {
  const msgs = messages ?? [{ role: 'user', content }];
  if (OPENAI) {
    const m = await openaiCall({
      model, max_tokens: maxTokens, messages: toOpenAIMessages(system, msgs),
      response_format: { type: 'json_schema', json_schema: { name: 'result', schema, strict: false } },
    });
    try { return JSON.parse(m.content || ''); } catch { throw new Error('Модель вернула некорректный JSON'); }
  }
  const c = await getClient();
  const res = await c.beta.messages.create({
    model, max_tokens: maxTokens, thinking: { type: 'adaptive' },
    output_config: { effort, format: { type: 'json_schema', schema } },
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', system, messages: msgs,
  });
  if (res.stop_reason === 'refusal') throw new Error('Модель отказалась обрабатывать запрос');
  const txt = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return JSON.parse(txt); } catch { throw new Error('Модель вернула некорректный JSON'); }
}

export async function agentStep({ system, messages, tools, model = MODEL, maxTokens = 2500 }) {
  if (OPENAI) {
    const m = await openaiCall({
      model, max_tokens: maxTokens, messages: toOpenAIMessages(system, messages),
      tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
    });
    const blocks = [];
    if (m.content) blocks.push({ type: 'text', text: m.content });
    for (const tc of m.tool_calls || []) {
      let input = {};
      try { input = JSON.parse(tc.function.arguments || '{}'); } catch {}
      blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
    }
    return blocks;
  }
  const c = await getClient();
  const r = await c.beta.messages.create({
    model, max_tokens: maxTokens, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', system, tools, messages,
  });
  return r.content
    .filter((b) => b.type === 'text' || b.type === 'tool_use')
    .map((b) => (b.type === 'text' ? { type: 'text', text: b.text } : { type: 'tool_use', id: b.id, name: b.name, input: b.input }));
}

const isWorkspaceError = (err) => /anthropic-workspace-id/.test(err.message || '');
export const isAuthError = (err) =>
  !isWorkspaceError(err) && (err.status === 401 || /authentication method|api.?key|OPENAI_API_KEY/i.test(err.message || ''));

export function humanError(err) {
  if (OPENAI) {
    if (err.status === 401 || /OPENAI_API_KEY|api.?key|authentication/i.test(err.message || ''))
      return 'Не настроен доступ к OpenAI: задайте OPENAI_API_KEY (и при необходимости OPENAI_BASE_URL/OPENAI_MODEL) и перезапустите сервер';
    if (err.status === 429) return 'OpenAI перегружен или исчерпан лимит — попробуйте через минуту';
    if (err.status >= 500) return 'Провайдер временно недоступен — попробуйте ещё раз';
    return err.message || 'Внутренняя ошибка';
  }
  if (isWorkspaceError(err)) return 'Ключ Claude API не привязан к рабочему пространству: укажите ANTHROPIC_WORKSPACE_ID в .env';
  if (isAuthError(err)) return 'Не настроен доступ к Claude API: задайте ANTHROPIC_API_KEY и перезапустите сервер';
  if (err.status === 429) return 'Claude API перегружен или исчерпан лимит — попробуйте через минуту';
  if (err.status === 529 || err.status >= 500) return 'Claude API временно недоступен — попробуйте ещё раз';
  return err.message || 'Внутренняя ошибка';
}
