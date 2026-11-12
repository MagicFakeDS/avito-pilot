import { md } from './rich.js';
import { vasLabel } from './extract-state.js';
import { dayKey, hhmm, stamp } from './time.js';
import { askClaude } from './claude.js';

const MAX_CHARS = 30000;

const num = (v) => (v == null ? '—' : Math.round(v).toLocaleString('ru-RU'));
const rub = (v) => (v == null ? '—' : v === 0 ? 'бесплатно' : `${num(v)} ₽`);
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const cut = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
const median = (xs) => {
  const v = xs.filter((x) => x != null && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const sellerKey = (it) => it.sellerId || it.sellerName || '';
const sumKnown = (xs) => (xs.some((x) => x != null) ? xs.reduce((a, x) => a + (x || 0), 0) : null);

export function makeSnapshot(report, at = new Date()) {
  const items = Object.values(report.items)
    .sort((a, b) => a.rank - b.rank)
    .map((it) => ({
      id: it.id,
      rank: it.rank,
      title: cut(it.title || '', 90),
      url: it.url || '',
      price: it.price ?? null,
      sellerId: it.sellerId || '',
      sellerName: cut(it.sellerName || '', 60),
      promoted: Boolean(it.promoted),
      xl: Boolean(it.xl),
      vas: it.vas || [],
      bumpedAt: it.bumpedAt || '',
      closedItems: it.closedItems ?? null,
      views: it.views ?? null,
      viewsToday: it.viewsToday ?? null,
    }));
  const lastPage = report.pages.at(-1);
  return { at: new Date(at).toISOString(), url: report.marketUrl || '', title: lastPage?.title || '', total: lastPage?.total ?? null, items };
}

export function compareSnapshots(cur, prev) {
  const today = dayKey(cur.at);
  const prevById = new Map((prev?.items || []).map((x) => [x.id, x]));
  const isToday = (iso) => iso && dayKey(iso) === today;
  const bumpedSincePrev = (it) => {
    const p = prevById.get(it.id);
    return Boolean(p && it.bumpedAt && p.bumpedAt && it.bumpedAt > p.bumpedAt);
  };

  const vas = {};
  for (const it of cur.items) for (const s of it.vas) vas[s] = (vas[s] || 0) + 1;

  const withBump = cur.items.filter((it) => it.bumpedAt);
  const bumpedToday = cur.items
    .filter((it) => isToday(it.bumpedAt))
    .sort((a, b) => b.bumpedAt.localeCompare(a.bumpedAt))
    .map((it) => ({ ...it, wasRank: prevById.get(it.id)?.rank ?? null, known: prevById.has(it.id) }));

  const groups = new Map();
  for (const it of cur.items) {
    const key = sellerKey(it);
    if (!key) continue;
    const g = groups.get(key) || { key, name: it.sellerName || it.sellerId, items: [] };
    g.items.push(it);
    groups.set(key, g);
  }
  const prevSellerCount = new Map();
  for (const it of prev?.items || []) {
    const k = sellerKey(it);
    if (k) prevSellerCount.set(k, (prevSellerCount.get(k) || 0) + 1);
  }
  const sellers = [...groups.values()]
    .map((g) => {
      const vasCount = {};
      for (const it of g.items) for (const s of it.vas) vasCount[s] = (vasCount[s] || 0) + 1;
      return {
        name: g.name,
        listings: g.items.length,
        was: prev ? prevSellerCount.get(g.key) || 0 : null,
        bestRank: Math.min(...g.items.map((x) => x.rank)),
        medianPrice: median(g.items.map((x) => x.price)),
        promoted: g.items.filter((x) => x.promoted).length,
        vas: vasCount,
        bumpedToday: g.items.filter((x) => isToday(x.bumpedAt)).length,
        bumpedSincePrev: g.items.filter(bumpedSincePrev).length,
        closedItems: Math.max(-1, ...g.items.map((x) => x.closedItems ?? -1)),
        viewsToday: sumKnown(g.items.map((x) => x.viewsToday)),
        views: sumKnown(g.items.map((x) => x.views)),
      };
    })
    .sort((a, b) => b.listings - a.listings || a.bestRank - b.bestRank);

  const both = prev ? cur.items.filter((it) => prevById.has(it.id)) : [];
  const moves = both
    .map((it) => ({ ...it, wasRank: prevById.get(it.id).rank, delta: prevById.get(it.id).rank - it.rank }))
    .filter((x) => x.delta !== 0);
  const up = [...moves].filter((x) => x.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5);
  const down = [...moves].filter((x) => x.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 5);
  const prices = both
    .map((it) => ({ ...it, wasPrice: prevById.get(it.id).price }))
    .filter((x) => x.price != null && x.wasPrice != null && x.price !== x.wasPrice);
  const curIds = new Set(cur.items.map((x) => x.id));

  return {
    at: cur.at,
    prevAt: prev?.at || null,
    title: cur.title,
    total: cur.total,
    count: cur.items.length,
    promoted: cur.items.filter((x) => x.promoted).length,
    vas,
    withBump: withBump.length,
    viewsKnown: cur.items.filter((x) => x.viewsToday != null).length,
    viewsToday: sumKnown(cur.items.map((x) => x.viewsToday)),
    topViews: cur.items
      .filter((x) => x.viewsToday != null)
      .sort((a, b) => b.viewsToday - a.viewsToday || a.rank - b.rank)
      .slice(0, 10),
    bumpedToday,
    bumpedSincePrev: cur.items.filter(bumpedSincePrev).length,
    sellers,
    newCount: prev ? cur.items.filter((x) => !prevById.has(x.id)).length : null,
    goneCount: prev ? prev.items.filter((x) => !curIds.has(x.id)).length : null,
    up,
    down,
    prices,
  };
}

const row = (cells) => `| ${cells.join(' | ')} |`;
const table = (head, align, rows) => [row(head), row(align), ...rows.map(row)].join('\n');
const link = (it) => (it.url ? `[${md(cut(it.title, 50))}](${it.url})` : md(cut(it.title, 50)));
const vasShort = (v) =>
  Object.entries(v)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${md(vasLabel(s))} ${n}`)
    .join(', ') || '—';
const signed = (n) => (n > 0 ? `+${n}` : String(n));

export function watchMarkdown(name, s, { summary = '' } = {}) {
  const parts = [`## Замер рынка: ${md(name)}`];
  const head = [`${stamp(s.at)} по Москве${s.title ? ` · ${md(s.title)}` : ''}`];
  head.push(
    `Собрано **${num(s.count)}**${s.total ? ` из ${num(s.total)}` : ''} объявлений · продвинуто ${s.promoted} (${pct(s.promoted, s.count)}) · поднимали или разместили сегодня **${s.bumpedToday.length}**`,
  );
  if (s.viewsKnown) {
    head.push(
      `Просмотров сегодня у собранных объявлений: **${num(s.viewsToday)}**${s.viewsKnown < s.count ? ` (по ${s.viewsKnown} из ${s.count} объявлений)` : ''}`,
    );
  }
  if (s.prevAt) {
    head.push(
      `С прошлого замера (${stamp(s.prevAt)}): новых в выдаче ${s.newCount}, ушло ${s.goneCount}, поднимали ${s.bumpedSincePrev}, сменили цену ${s.prices.length}`,
    );
  } else {
    head.push('_Это первый замер — со следующего покажу, что изменилось: кто вырос, кто упал, кто поднимал и менял цену._');
  }
  parts.push(head.join('\n\n'));
  if (summary.trim()) parts.push('### Вывод', summary.trim());

  if (Object.keys(s.vas).length) {
    parts.push(
      '### Продвижение',
      table(
        ['Вид', 'Объявлений', 'Доля'],
        [':---', '---:', '---:'],
        Object.entries(s.vas)
          .sort((a, b) => b[1] - a[1])
          .map(([slug, n]) => [md(vasLabel(slug)), n, pct(n, s.count)]),
      ),
      '_Вид продвижения виден в выдаче, а ставку (цену просмотра) Авито показывает только самому продавцу в кабинете — её не видно никому, ни нам, ни другим сервисам._',
    );
  }

  if (s.sellers.length) {
    parts.push(
      '### Конкуренты',
      table(
        ['Продавец', 'Объявл.', 'Лучшее место', 'Медиана', 'Продвижение', ...(s.viewsKnown ? ['Просм. сегодня'] : []), 'Поднято сегодня', 'Завершённых'],
        [':---', '---:', '---:', '---:', ':---', ...(s.viewsKnown ? ['---:'] : []), '---:', '---:'],
        s.sellers.slice(0, 15).map((x) => [
          md(cut(x.name, 40)),
          x.was == null || x.was === x.listings ? x.listings : `${x.listings} (было ${x.was})`,
          x.bestRank,
          rub(x.medianPrice),
          vasShort(x.vas),
          ...(s.viewsKnown ? [num(x.viewsToday)] : []),
          x.bumpedToday,
          x.closedItems >= 0 ? num(x.closedItems) : '—',
        ]),
      ),
    );
  }

  if (s.topViews?.length) {
    parts.push(
      '### Больше всего просмотров сегодня',
      table(
        ['Место', 'Объявление', 'Продавец', 'Сегодня', 'Всего'],
        ['---:', ':---', ':---', '---:', '---:'],
        s.topViews.map((x) => [x.rank, link(x), md(cut(x.sellerName, 30)) || '—', num(x.viewsToday), num(x.views)]),
      ),
    );
  }

  if (s.bumpedToday.length) {
    parts.push(
      `### Поднятия сегодня (${s.bumpedToday.length})`,
      table(
        ['Время', 'Место', 'Объявление', 'Продавец'],
        ['---:', '---:', ':---', ':---'],
        s.bumpedToday.slice(0, 20).map((x) => [
          hhmm(x.bumpedAt),
          x.wasRank != null && x.wasRank !== x.rank ? `${x.rank} (было ${x.wasRank})` : x.rank,
          link(x) + (x.known ? '' : ' (новое в выдаче)'),
          md(cut(x.sellerName, 30)) || '—',
        ]),
      ),
      '_Время — когда объявление в последний раз поднималось в выдаче (у новых — когда разместили). Продвижение за просмотры поднимает место, но это время не меняет._',
    );
  } else if (!s.withBump) {
    parts.push('_Время поднятий Авито на этой странице не отдал — поднятия посчитать не получилось._');
  }

  if (s.up.length || s.down.length) {
    parts.push(
      '### Кто вырос и упал',
      table(
        ['Объявление', 'Продавец', 'Было', 'Стало', 'Изменение'],
        [':---', ':---', '---:', '---:', '---:'],
        [...s.up, ...s.down].map((x) => [link(x), md(cut(x.sellerName, 30)) || '—', x.wasRank, x.rank, signed(x.delta)]),
      ),
    );
  }

  if (s.prices.length) {
    parts.push(
      '### Изменения цен',
      table(
        ['Объявление', 'Продавец', 'Было', 'Стало'],
        [':---', ':---', '---:', '---:'],
        s.prices.slice(0, 15).map((x) => [link(x), md(cut(x.sellerName, 30)) || '—', rub(x.wasPrice), rub(x.price)]),
      ),
    );
  }

  return parts.join('\n\n').slice(0, MAX_CHARS);
}

export function watchMemo(s) {
  const top = s.sellers
    .slice(0, 3)
    .map((x) => `${x.name} ${x.listings} объявл., подняли сегодня ${x.bumpedToday}`)
    .join('; ');
  return [
    `Плановый замер ${stamp(s.at)}: ${s.count} объявлений${s.total ? ` из ${s.total}` : ''}, продвинуто ${s.promoted}, поднимали или разместили сегодня ${s.bumpedToday.length}.`,
    s.viewsKnown ? `Просмотров сегодня у собранных объявлений: ${s.viewsToday}.` : '',
    s.prevAt ? `С прошлого замера: новых ${s.newCount}, ушло ${s.goneCount}, сменили цену ${s.prices.length}.` : '',
    top ? `Крупнейшие продавцы: ${top}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

const SUMMARY_SYSTEM = `Тебя зовут Максим, ты помощник продавца на Авито. Ниже отчёт планового замера выдачи: конкуренты, виды продвижения, поднятия за сегодня, движение по местам и изменения цен.
Напиши 3–5 коротких пунктов для продавца: кто из конкурентов активнее всего (поднимает объявления, вкладывается в продвижение), что изменилось с прошлого замера и что из этого стоит сделать. Опирайся только на цифры из отчёта, ничего не придумывай. Ставку продвижения конкурентов не угадывай: её не видно.
Формат: маркированный список Markdown, без заголовков, таблиц, эмодзи, HTML и знака доллара.`;

export async function summarizeWatch(markdown) {
  const { text } = await askClaude({ system: SUMMARY_SYSTEM, content: markdown, effort: 'low', maxTokens: 8000 });
  return text;
}
