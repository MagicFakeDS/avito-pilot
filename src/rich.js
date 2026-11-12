import { analyze } from './analytics.js';
import { vasLabel } from './extract-state.js';

const MAX_CHARS = 30000;
const LISTING_ROWS = 40;

const num = (v) => (v == null ? '—' : Math.round(v).toLocaleString('ru-RU'));
const rub = (v) => (v == null ? '—' : `${num(v)} ₽`);
const pct = (v) => `${Math.round(v * 100)}%`;

export function md(s) {
  return String(s ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_[\]~|$=#])/g, '\\$1')
    .trim();
}

const row = (cells) => `| ${cells.join(' | ')} |`;
function table(head, align, rows) {
  return [row(head), row(align), ...rows.map(row)].join('\n');
}

export function pricesTable(s) {
  return table(
    ['Единица', 'Шт.', 'Мин', '25%', 'Медиана', '75%', 'Макс'],
    [':---', '---:', '---:', '---:', '---:', '---:', '---:'],
    s.units.map((u) => [md(u.unit), u.count, rub(u.min), rub(u.p25), `**${rub(u.median)}**`, rub(u.p75), rub(u.max)]),
  );
}

export function promoTable(s) {
  return table(
    ['Места в выдаче', 'Продвинуто'],
    [':---', '---:'],
    s.rankBuckets.map((b) => [b.label, `${pct(b.share)} (${b.promoted} из ${b.count})`]),
  );
}

export function sellersTable(s, limit = 10) {
  return table(
    ['#', 'Продавец', 'Объявл.', 'Продв.', 'Рейтинг', 'Отзывов'],
    ['---:', ':---', '---:', '---:', '---:', '---:'],
    s.sellers.top.slice(0, limit).map((x, i) => [i + 1, md(x.name), x.count, x.promoted, x.rating ?? '—', num(x.reviews)]),
  );
}

export function vasTable(report) {
  const items = Object.values(report.items);
  const counts = {};
  for (const it of items) for (const v of it.vas || []) counts[v] = (counts[v] || 0) + 1;
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '';
  return table(['Вид', 'Объявлений', 'Доля'], [':---', '---:', '---:'], rows.map(([v, n]) => [md(vasLabel(v)), n, pct(n / items.length)]));
}

export function listingsTable(report, limit = LISTING_ROWS) {
  const items = Object.values(report.items)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit);
  return table(
    ['#', 'Объявление', 'Цена', 'Просм./день', 'Продавец'],
    ['---:', ':---', '---:', '---:', ':---'],
    items.map((i) => {
      const title = i.url ? `[${md(i.title)}](${i.url})` : md(i.title);
      const price = i.price == null ? '—' : i.price === 0 ? 'бесплатно' : rub(i.price);
      return [i.rank, title + (i.promoted ? ' (продв.)' : ''), price, i.viewsToday ?? '—', md(i.sellerName) || '—'];
    }),
  );
}

export function marketMarkdown(aiText, report, { stopped = false, footer = '' } = {}) {
  const s = analyze(report);
  const head = [];
  if (stopped) head.push('_Генерация остановлена — ниже то, что успел написать._');
  if (aiText?.trim()) head.push(aiText.trim());

  const data = [
    '---',
    '## Данные по выдаче',
    `Собрано **${num(s.count)}**${s.totalOnSite ? ` из ${num(s.totalOnSite)}` : ''} объявлений · продвинуто ${pct(s.shares.promoted)} · с доставкой ${pct(s.shares.delivery)}`,
  ];
  if (s.units.length) data.push('### Цены', pricesTable(s));
  if (s.rankBuckets.length) data.push('### Продвижение по позициям', promoTable(s));
  const vas = vasTable(report);
  if (vas) data.push('### Виды продвижения', vas);
  if (s.sellers.top.length) data.push('### Крупные продавцы', sellersTable(s));

  const details = `<details><summary>Объявления (${Math.min(s.count, LISTING_ROWS)} из ${num(s.count)})</summary>\n\n${listingsTable(report)}\n\n</details>`;
  const tail = footer ? [footer] : [];

  let out = [...head, ...data, details, ...tail].join('\n\n');

  if (out.length > MAX_CHARS) out = [...head, ...data, '_Полный список объявлений — кнопка «Таблица»._', ...tail].join('\n\n');
  return out.slice(0, MAX_CHARS);
}

export function listingsMarkdown(report) {
  const s = analyze(report);
  return [`## Объявления: ${md(report.name)}`, `Показано ${Math.min(s.count, LISTING_ROWS)} из ${num(s.count)} · «продв.» — продвинутые объявления`, listingsTable(report)].join(
    '\n\n',
  );
}
