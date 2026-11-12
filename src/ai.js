import { askClaude, getClient } from './claude.js';

const SYSTEM = `Ты аналитик рынка Авито. Тебе дают агрегированную статистику по поисковой выдаче
и выборку объявлений. Напиши короткий практичный разбор для продавца, который хочет
выйти в эту нишу или улучшить свои позиции.

Структура (Markdown, заголовки ###):
### Рынок в цифрах — 3–5 пунктов: объём, ценовой коридор, насколько выдача забита продвижением.
### Конкуренты — кто доминирует, чем берут (цена, отзывы, продвижение).
### Цена — где выгодно встать по цене и почему; отдельно для каждой единицы цены, если их несколько.
### Что делать — 4–6 конкретных шагов (заголовок, фото, цена, доставка, продвижение, отзывы).

Опирайся только на данные. Если данных мало (меньше 30 объявлений), прямо скажи об этом.
Пиши по-русски, без воды и без эмодзи, суммы в рублях с пробелами между разрядами.`;

function sampleOf(report) {
  return Object.values(report.items)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 80)
    .map((i) => ({
      rank: i.rank,
      title: i.title,
      price: i.price,
      unit: i.priceUnit,
      promoted: i.promoted || undefined,
      delivery: i.delivery || undefined,
      seller: i.sellerName || undefined,
      rating: i.sellerRating ?? undefined,
      reviews: i.sellerReviews ?? undefined,
      productRating: i.rating ?? undefined,
      productReviews: i.reviews ?? undefined,
      brandName: i.brand || undefined,
      badges: i.badges && i.badges.length ? i.badges.slice(0, 5) : undefined,
      views: i.views ?? undefined,
      viewsToday: i.viewsToday ?? undefined,
      publishedAt: i.publishedAt ? i.publishedAt.slice(0, 10) : undefined,
      text: i.description ? i.description.slice(0, 220) : undefined,
    }));
}
const promptOf = (report, stats, sample) => `Отчёт «${report.name}».\n\nСтатистика:\n${JSON.stringify(stats)}\n\nПервые объявления выдачи:\n${JSON.stringify(sample)}`;

export async function generateInsights(report, stats) {
  const { text, model } = await askClaude({ system: SYSTEM, content: promptOf(report, stats, sampleOf(report)) });
  return { text, model, createdAt: new Date().toISOString() };
}

export const EXT_PERSONA = `Ты — ez-parser, помощник продавцов и маркетологов на Авито, Wildberries, Ozon, Яндекс Маркете и в любых интернет-магазинах. Твоя цель — чтобы человек продавал больше и выгоднее.
Тон: тёплый, уверенный, на «вы», живым языком без канцелярита. Поддерживай: отмечай сильные стороны и возможности, но честно называй риски.
Всегда переводи цифры в действия: цена, заголовок, фото, описание, продвижение, отзывы, доставка, время публикации.
Давай готовое к использованию: конкретную цену или коридор, пример заголовка, первые строки описания, что написать в ответ покупателю.
Для маркетолога: сегменты и ниши, чем берут конкуренты (их УТП), где свободное окно, есть ли смысл платить за продвижение.
Опирайся только на данные; если их мало — скажи об этом мягко и предложи, что собрать ещё.
Оформление: короткие абзацы, главное **жирным**, списки, заголовки ###. Без эмодзи и HTML.
Готовые тексты (заголовок, описание, ответ покупателю) пиши отдельными строками, каждая начинается с «> », без кавычек — у пользователя появится кнопка «Копировать». Суммы в рублях с пробелами между разрядами («14 990 ₽»).`;

const EXT_INSIGHTS_SYSTEM = EXT_PERSONA + `

Тебе дают статистику по выдаче площадки (её название — в начале сообщения) и выборку товаров/объявлений. Напиши разбор рынка для продавца и маркетолога, учитывая особенности этой площадки (на маркетплейсах важны рейтинг и число отзывов товара, на Авито — продавец и продвижение).
Структура:
### Коротко — 2–3 предложения: что за рынок и главный шанс для продавца.
### Цена — рекомендуемая цена или коридор и почему; где дёшево «сливают», где переплачивают.
### Конкуренты — 3–4 пункта: кто в топе и чем берёт (по описаниям: какие обещания, гарантии, примерка, доставка; рейтинг и отзывы продавцов).
### Спрос по просмотрам — если в статистике есть views: сколько просмотров в день собирает типичное объявление (медиана), сколько лидеры, разница продвинутых и обычных, какие цены/заголовки собирают больше всего просмотров сегодня (topToday, topPerDay). Переведи в вывод: есть ли спрос и где он.
### Лидеры — если есть данные лидеров: что в их описаниях цепляет покупателя.
### Цифры рынка — используй deep: где сгущаются цены (hist), доля топ-5 продавцов, города, динамика новых объявлений за 7 дней против прошлых 7, слова из названий, которые чаще в топе (words.boost).
### Как выделиться — готовый пример заголовка и первых строк описания, что показать на фото.
### Продвижение — нужно ли платить за продвижение или рекламу на этой площадке и как (по доле продвинутых/рекламных в выдаче).
### Следующий шаг — одна строка: что я могу сделать дальше (например: «Могу открыть топ-3 конкурентов и разобрать их карточки и отзывы»).`;

export const FAST_MODEL = process.env.EXT_FAST_MODEL || 'claude-sonnet-5-5';
export async function streamInsights(report, stats, onText, leaders = [], siteName = '') {
  const c = await getClient();
  const stream = c.messages.stream({
    model: FAST_MODEL, max_tokens: 4000, thinking: { type: 'adaptive' }, output_config: { effort: 'low' },
    system: EXT_INSIGHTS_SYSTEM, messages: [{ role: 'user', content: (siteName ? 'Площадка: ' + siteName + '\n\n' : '') + promptOf(report, stats, sampleOf(report).slice(0, 60)) + (leaders.length ? `\n\nЛидеры выдачи — карточки прочитаны полностью (описание, просмотры всего/сегодня, дата публикации, продавец):\n${JSON.stringify(leaders)}` : '') }],
  });
  stream.on('text', (_d, snap) => onText(snap));
  const msg = await stream.finalMessage();
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (!text) throw new Error('Пустой ответ модели');
  return { text, model: msg.model, createdAt: new Date().toISOString() };
}

export function viewStats(items) {
  const now = Date.now();
  const v = items.filter((i) => Number.isFinite(i.views) && i.views >= 0).map((i) => {
    const days = i.publishedAt ? Math.max(1, (now - Date.parse(i.publishedAt)) / 864e5) : null;
    return { title: i.title, url: i.url, price: i.price, views: i.views, today: i.viewsToday || 0, perDay: days ? Math.round(i.views / days) : null, days: days ? Math.round(days) : null, promoted: !!i.promoted };
  });
  if (!v.length) return null;
  const med = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const sum = (a) => a.reduce((x, y) => x + (y || 0), 0);
  const pd = v.filter((x) => x.perDay != null);
  const by = (k) => v.filter((x) => x[k] != null).sort((a, b) => (b[k] || 0) - (a[k] || 0)).slice(0, 5);
  return {
    count: v.length, of: items.length, total: sum(v.map((x) => x.views)), avg: Math.round(sum(v.map((x) => x.views)) / v.length), median: med(v.map((x) => x.views)),
    today: sum(v.map((x) => x.today)), perDayMedian: med(pd.map((x) => x.perDay)), perDayAvg: pd.length ? Math.round(sum(pd.map((x) => x.perDay)) / pd.length) : null,
    promotedPerDay: med(pd.filter((x) => x.promoted).map((x) => x.perDay)), organicPerDay: med(pd.filter((x) => !x.promoted).map((x) => x.perDay)),
    topToday: by('today'), topPerDay: by('perDay'),
  };
}

const STOP = new Set(['для', 'без', 'под', 'над', 'при', 'или', 'как', 'что', 'это', 'все', 'всё', 'новый', 'новая', 'новое', 'новые', 'продам', 'продаю', 'продается', 'продаётся', 'шт', 'см', 'мм', 'размер', 'цвет', 'the', 'and', 'for', 'with']);
const perDayOf = (i, now) => (Number.isFinite(i.views) && i.publishedAt ? Math.round(i.views / Math.max(1, (now - Date.parse(i.publishedAt)) / 864e5)) : null);
const median = (a) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const quant = (s, p) => s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
function niceStep(raw) { const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1))); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p; return 10 * p; }
export function deepStats(items) {
  const now = Date.now();
  const all = items.map((i) => ({ ...i, perDay: perDayOf(i, now) }));
  const withViews = all.filter((i) => i.perDay != null);
  const hasViews = withViews.length >= Math.min(15, Math.ceil(all.length * 0.3));
  const priced = all.filter((i) => i.price > 0);
  const out = { total: all.length, withViews: withViews.length };
  const ps = priced.map((i) => i.price).sort((a, b) => a - b);
  if (ps.length >= 8) {
    const lo = quant(ps, 0.05), hi = quant(ps, 0.95);
    const step = niceStep(Math.max(1, (hi - lo) / 8));
    const start = Math.floor(lo / step) * step;
    const bins = [];
    for (let f = start; f <= hi && bins.length < 12; f += step) {
      const inBin = priced.filter((i) => i.price >= f && i.price < f + step);
      bins.push({ from: f, to: f + step, count: inBin.length, perDay: hasViews ? median(inBin.map((i) => i.perDay)) : null });
    }
    out.hist = { bins, below: priced.filter((i) => i.price < start).length, above: priced.filter((i) => i.price >= start + step * bins.length).length };
  }
  const group = (key) => {
    const m = new Map();
    for (const i of all) { const k = key(i); if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(i); }
    return [...m].map(([name, list]) => ({ name, count: list.length, share: list.length / all.length, medPrice: median(list.map((i) => i.price > 0 ? i.price : null)), views: hasViews ? list.reduce((s, i) => s + (i.views || 0), 0) : null, perDay: hasViews ? median(list.map((i) => i.perDay)) : null }))
      .sort((a, b) => b.count - a.count);
  };
  const sellers = group((i) => String(i.sellerName || '').trim().slice(0, 60));
  if (sellers.length) out.sellers = { top: sellers.slice(0, 8), distinct: sellers.length, top5share: sellers.slice(0, 5).reduce((s, x) => s + x.count, 0) / all.length };
  const cities = group((i) => String(i.location || '').split(/[,·]/)[0].replace(/^(г\.|город)\s*/i, '').trim().slice(0, 40));
  if (cities.length > 1) out.cities = { top: cities.slice(0, 8), distinct: cities.length };
  const days = new Map();
  for (const i of all) { if (!i.publishedAt) continue; const t = Date.parse(i.publishedAt); if (!Number.isFinite(t) || now - t > 30 * 864e5) continue; const k = new Date(t).toISOString().slice(0, 10); days.set(k, (days.get(k) || 0) + 1); }
  if (days.size >= 3) { const arr = []; for (let d = 29; d >= 0; d--) { const k = new Date(now - d * 864e5).toISOString().slice(0, 10); arr.push({ day: k, count: days.get(k) || 0 }); } out.dynamics = { days: arr, last7: arr.slice(-7).reduce((s, x) => s + x.count, 0), prev7: arr.slice(-14, -7).reduce((s, x) => s + x.count, 0) }; }
  const pr = all.filter((i) => i.promoted), org = all.filter((i) => !i.promoted);
  if (pr.length && org.length) out.promo = { promoted: { count: pr.length, medPrice: median(pr.map((i) => i.price || null)), perDay: hasViews ? median(pr.map((i) => i.perDay)) : null }, organic: { count: org.length, medPrice: median(org.map((i) => i.price || null)), perDay: hasViews ? median(org.map((i) => i.perDay)) : null } };
  const words = new Map();
  for (const i of all) {
    const ws = new Set(String(i.title || '').toLowerCase().replace(/ё/g, 'е').match(/[a-zа-я0-9]{3,}/g) || []);
    for (const w of ws) { if (STOP.has(w) || /^\d+$/.test(w)) continue; if (!words.has(w)) words.set(w, []); words.get(w).push(i); }
  }
  const baseDay = hasViews ? median(withViews.map((i) => i.perDay)) : null;
  const topRank = Math.max(1, Math.ceil(all.length / 4));
  const wl = [...words].filter(([, l]) => l.length >= Math.max(3, Math.ceil(all.length * 0.02)) && l.length <= all.length * 0.8).map(([w, l]) => {
    const lift = hasViews && baseDay ? (median(l.map((i) => i.perDay)) || 0) / baseDay : l.filter((i) => (i.rank || 9e9) <= topRank).length / l.length / 0.25;
    return { word: w, count: l.length, lift: Math.round(lift * 100) / 100, medPrice: median(l.map((i) => i.price || null)) };
  });
  out.words = { by: hasViews ? 'views' : 'rank', boost: wl.filter((x) => x.lift > 1.1).sort((a, b) => b.lift - a.lift).slice(0, 10), common: [...wl].sort((a, b) => b.count - a.count).slice(0, 10) };
  if (all.some((i) => i.delivery)) out.delivery = all.filter((i) => i.delivery).length / all.length;
  return out;
}

const DEMAND_SYSTEM = EXT_PERSONA + `

Просмотры собраны по объявлениям выдачи. Тебе дают сводку просмотров (views: медиана в день, топы, продвинутые vs обычные) и глубокую сводку (deep: спрос по ценовым зонам hist.bins[].perDay, слова с повышенными просмотрами words.boost, продавцы, города, динамика).
Напиши коротко «Спрос по просмотрам» для продавца и маркетолога:
### Спрос — есть ли он и насколько (медиана просмотров в день, сколько собирают лидеры).
### Где цена встречает спрос — в каких ценовых зонах больше просмотров в день и что из этого следует для цены.
### Что цепляет — слова и подачи, которые дают больше просмотров; продвижение окупается или нет.
### Следующий шаг — одна строка.`;
export async function streamDemand(report, stats, onText, siteName = '', note = '') {
  const c = await getClient();
  const top = Object.values(report.items).filter((i) => Number.isFinite(i.views)).sort((a, b) => (b.viewsToday || 0) - (a.viewsToday || 0)).slice(0, 25)
    .map((i) => ({ title: i.title, price: i.price, views: i.views, today: i.viewsToday, published: i.publishedAt ? i.publishedAt.slice(0, 10) : undefined, promoted: i.promoted || undefined }));
  const stream = c.messages.stream({
    model: FAST_MODEL, max_tokens: 2500, thinking: { type: 'adaptive' }, output_config: { effort: 'low' }, system: DEMAND_SYSTEM,
    messages: [{ role: 'user', content: (note ? note + '\n' : '') + (siteName ? 'Площадка: ' + siteName + '\n' : '') + 'Отчёт «' + report.name + '».\n\nviews:\n' + JSON.stringify(stats.views) + '\n\ndeep:\n' + JSON.stringify(stats.deep) + '\n\nТоп по просмотрам сегодня:\n' + JSON.stringify(top) }],
  });
  stream.on('text', (_d, snap) => onText(snap));
  const msg = await stream.finalMessage();
  return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}
