import crypto from 'node:crypto';
import { askClaudeJSON, MODEL } from './claude.js';

const MAX_TEXT = 200_000;
export const PAGE_SIZE = 50;

export async function parseIntoReport(store, reportId, text, page) {
  const parsed = await extractListings(text);
  if (!parsed.items.length) throw httpError('Не нашёл объявлений в тексте — это точно страница выдачи?', 422);
  const items = parsed.items.map((it, i) => ({
    ...it,
    page,
    position: i + 1,
    rank: (page - 1) * PAGE_SIZE + i + 1,
  }));
  const result = store.addPage(reportId, { meta: { page, title: parsed.query, total: parsed.totalOnSite }, items });
  if (!result) throw httpError('Отчёт не найден', 404);
  return { ...result, found: items.length, page };
}

const nullable = (type) => ({ anyOf: [{ type }, { type: 'null' }] });

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['query', 'totalOnSite', 'items'],
  properties: {
    query: { ...nullable('string'), description: 'Заголовок выдачи, например «Шкаф-купе»: объявления для Москвы' },
    totalOnSite: { ...nullable('integer'), description: 'Число объявлений в выдаче, указанное рядом с заголовком' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title', 'url', 'price', 'priceUnit', 'oldPrice', 'location', 'date',
          'sellerName', 'sellerUrl', 'sellerRating', 'sellerReviews', 'badges', 'promoted', 'delivery',
        ],
        properties: {
          title: { type: 'string' },
          url: { ...nullable('string'), description: 'Ссылка на объявление, если есть в тексте' },
          price: { ...nullable('number'), description: 'Цена в рублях числом; 0 если «Бесплатно»; null если не указана' },
          priceUnit: { type: 'string', description: 'Единица после цены: «за всё», «за погонный метр», «за услугу»…; пустая строка, если нет' },
          oldPrice: { ...nullable('number'), description: 'Зачёркнутая цена до скидки' },
          location: { type: 'string', description: 'Метро/район/город, как в карточке' },
          date: { type: 'string', description: 'Когда размещено: «3 дня назад», «Вчера»…; пустая строка, если нет' },
          sellerName: { type: 'string', description: 'Имя или название продавца; пустая строка, если нет' },
          sellerUrl: nullable('string'),
          sellerRating: nullable('number'),
          sellerReviews: nullable('integer'),
          badges: { type: 'array', items: { type: 'string' }, description: 'Метки: «Надёжный продавец», «Оплата частями», «Скидка»…' },
          promoted: { type: 'boolean', description: 'В карточке есть «Продвинуто»' },
          delivery: { type: 'boolean', description: 'Есть доставка' },
        },
      },
    },
  },
};

const SYSTEM = `Ты извлекаешь объявления из текста страницы поисковой выдачи Авито,
который пользователь скопировал из браузера. Ссылки в тексте даны в формате [текст](url).

Правила:
- Каждое объявление начинается со ссылки на него (url заканчивается на _<цифры>). Ссылка «Ещё N фото» с тем же url — часть того же объявления, не новое.
- Продавец — ссылка на /brands/ или /user/ после объявления. В её тексте склеены имя, рейтинг (часто продублирован: «4,84,8» значит 4.8) и число отзывов.
- Метка «Продвинуто» относится к объявлению, в блоке которого стоит.
- Описание объявления не выписывай.
- Шапку, фильтры, пагинацию, рекламные блоки и рекомендации вне выдачи пропускай.
- Сохраняй порядок объявлений как на странице. Ничего не придумывай: если поля нет, ставь null или пустую строку.`;

export async function extractListings(rawText) {
  const text = String(rawText || '').trim();
  if (text.length < 50) throw httpError('Текст слишком короткий — скопируйте всю страницу выдачи (Ctrl+A, Ctrl+C)', 400);
  if (text.length > MAX_TEXT) throw httpError('Текст слишком большой — вставляйте по одной странице выдачи', 413);

  let data;
  try {
    data = await askClaudeJSON({ system: SYSTEM, content: text, schema: SCHEMA, effort: 'low', maxTokens: 32000, model: MODEL });
  } catch (err) {
    if (/JSON/i.test(err.message || '')) throw httpError('Модель вернула некорректный JSON', 502);
    throw httpError(err.message || 'Модель не разобрала текст', 422);
  }
  return {
    query: data.query || '',
    totalOnSite: data.totalOnSite ?? null,
    items: (data.items || []).map(normalize),
  };
}

function normalize(it) {
  const url = cleanAvitoUrl(it.url);
  const id = url?.match(/_(\d{6,})$/)?.[1] || 'x' + hash(`${it.title}|${it.price}|${it.location}|${it.sellerName}`);
  const sellerUrl = cleanAvitoUrl(it.sellerUrl);
  const sellerId = sellerUrl?.match(/\/(?:brands|user)\/([^/]+)/)?.[1] || '';
  const priceUnit = (it.priceUnit || '').trim() || (it.price != null ? 'за всё' : '');
  return {
    id,
    title: it.title,
    url: url || '',
    price: it.price,
    priceText: it.price == null ? 'Цена не указана' : it.price === 0 ? 'Бесплатно' : `${it.price.toLocaleString('ru-RU')} ₽ ${priceUnit}`.trim(),
    priceUnit,
    oldPrice: it.oldPrice,
    location: it.location,
    date: it.date,
    sellerId,
    sellerName: it.sellerName,
    sellerRating: it.sellerRating,
    sellerReviews: it.sellerReviews,
    badges: it.badges,
    promoted: it.promoted,
    xl: false,
    delivery: it.delivery,
    photos: 0,
  };
}

function cleanAvitoUrl(u) {
  if (!u) return null;
  try {
    const url = new URL(u, 'https://www.avito.ru');
    if (!/(^|\.)avito\.ru$/.test(url.hostname)) return null;
    return `https://www.avito.ru${url.pathname}`;
  } catch {
    return null;
  }
}

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const httpError = (message, status) => Object.assign(new Error(message), { status });
