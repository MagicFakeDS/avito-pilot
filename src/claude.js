export const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';

let client = null;

export async function getClient() {
  if (client) return client;
  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    throw new Error('Не установлен @anthropic-ai/sdk — выполните npm install в папке server');
  }

  const workspace = process.env.ANTHROPIC_WORKSPACE_ID;
  client = new Anthropic(workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {});
  return client;
}

export async function askClaude({ system, content, effort = 'medium', maxTokens = 16000 }) {
  const c = await getClient();
  const response = await c.beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort },

    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal') throw new Error('Модель отказалась отвечать на этот запрос');
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('Пустой ответ модели');
  return { text, model: response.model };
}

export async function askClaudeStream({ system, content, messages, effort = 'medium', maxTokens = 16000, onText, signal, model = MODEL }) {
  const c = await getClient();
  const stream = c.beta.messages.stream(
    {
      model,
      max_tokens: maxTokens,
      thinking: { type: 'adaptive' },
      output_config: { effort },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages: messages ?? [{ role: 'user', content }],
    },
    signal ? { signal } : undefined,
  );
  if (onText) stream.on('text', (_delta, snapshot) => onText(snapshot));
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('Модель отказалась отвечать на этот запрос');
  const text = msg.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('Пустой ответ модели');
  return { text, model: msg.model };
}

export async function askClaudeJSON({ system, content, schema, effort = 'low', maxTokens = 2000, model = MODEL }) {
  const c = await getClient();
  const res = await c.beta.messages.create({
    model,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort, format: { type: 'json_schema', schema } },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages: [{ role: 'user', content }],
  });
  if (res.stop_reason === 'refusal') throw new Error('Модель отказалась обрабатывать запрос');
  const txt = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(txt);
  } catch {
    throw new Error('Модель вернула некорректный JSON');
  }
}

const isWorkspaceError = (err) => /anthropic-workspace-id/.test(err.message || '');
export const isAuthError = (err) =>
  !isWorkspaceError(err) && (err.status === 401 || /authentication method|api.?key/i.test(err.message || ''));

export function humanError(err) {
  if (isWorkspaceError(err)) {
    return 'Ключ Claude API не привязан к рабочему пространству: укажите ANTHROPIC_WORKSPACE_ID в .env или выпустите ключ внутри workspace';
  }
  if (isAuthError(err)) return 'Не настроен доступ к Claude API: задайте переменную ANTHROPIC_API_KEY и перезапустите сервер';
  if (err.status === 429) return 'Claude API перегружен или исчерпан лимит — попробуйте через минуту';
  if (err.status === 529 || err.status >= 500) return 'Claude API временно недоступен — попробуйте ещё раз';
  return err.message || 'Внутренняя ошибка';
}
