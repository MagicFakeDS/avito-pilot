const TURNS = 12;
const PER_MESSAGE = 1500;

export function toMessages(history = [], finalUser) {
  const out = [];
  for (const m of history.slice(-TURNS)) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const text = String(m.text || '').slice(0, PER_MESSAGE).trim();
    if (!text) continue;
    if (!out.length && role === 'assistant') continue;
    if (out.length && out.at(-1).role === role) out.at(-1).content += `\n\n${text}`;
    else out.push({ role, content: text });
  }
  if (out.length && out.at(-1).role === 'user') out.at(-1).content += `\n\n${finalUser}`;
  else out.push({ role: 'user', content: finalUser });
  return out;
}

export function transcript(history = [], limit = 8) {
  return history
    .slice(-limit)
    .map((m) => `${m.role === 'assistant' ? 'Бот' : 'Пользователь'}: ${String(m.text || '').replace(/\s+/g, ' ').slice(0, 400)}`)
    .join('\n');
}
