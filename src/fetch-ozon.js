import crypto from 'node:crypto';
import { runBrowser } from './fetch-avito.js';
import { htmlToText } from './page-text.js';
import { askClaudeJSON } from './claude.js';

const NAV = 45000;
const httpError = (m, s) => Object.assign(new Error(m), { status: s });
const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12);

export function isOzonUrl(raw) {
  try {
    return /(^|\.)ozon\.ru$/.test(new URL(raw).hostname);
  } catch {
    return false;
  }
}

function pageUrl(raw, n) {
  const u = new URL(raw);
  if (n > 1) u.searchParams.set('page', String(n));
  else u.searchParams.delete('page');
  return u.toString();
}

const OZON_BLOCK = /Antibot|Доступ ограничен|Проверка безопасности|нажмите, чтобы продолжить|подтвердите, что вы не робот|are you a robot|just a moment|press & hold|checkbox-captcha|challenge-platform/i;

const SYSTEM = `Ты извлекаешь карточки товаров из текста страницы поиска маркетплейса Ozon,
скопированного из браузера. Ссылки в тексте даны как [текст](url).
Правила:
- Один товар — одна карточка: название, цена, иногда старая (зачёркнутая) цена, рейтинг (0–5), число отзывов, продавец.
- url товара — ближайшая ссылка на /product/… у названия, если есть.
- Цену давай числом в рублях без пробелов и символа ₽. Старую цену — в oldPrice, иначе null.
- promoted = true, если у карточки есть пометка «Реклама».
- Пропускай шапку, фильтры, баннеры, рекомендации и блоки вне выдачи. Порядок сохраняй. Ничего не выдумывай: нет поля — null или пустая строка.`;

const nullable = (type) => ({ anyOf: [{ type }, { type: 'null' }] });
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['query', 'totalOnSite', 'items'],
  properties: {
    query: nullable('string'),
    totalOnSite: nullable('integer'),
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'url', 'price', 'oldPrice', 'sellerName', 'sellerRating', 'sellerReviews', 'promoted'],
        properties: {
          title: { type: 'string' },
          url: nullable('string'),
          price: nullable('number'),
          oldPrice: nullable('number'),
          sellerName: { type: 'string' },
          sellerRating: nullable('number'),
          sellerReviews: nullable('integer'),
          promoted: { type: 'boolean' },
        },
      },
    },
  },
};

function normalize(it) {
  const raw = String(it.url || '');
  const m = raw.match(/ozon\.ru\/[^\s)]*/i);
  const url = m ? 'https://www.' + m[0].replace(/^https?:\/\/(www\.)?/i, '') : '';
  const idm = url.match(/-(\d{5,})\/?$/) || url.match(/(\d{6,})/) || raw.match(/(\d{6,})/);
  const id = 'oz' + (idm ? idm[1] : hash(`${it.title}|${it.price}|${it.sellerName}`));
  const price = typeof it.price === 'number' ? it.price : null;
  return {
    id,
    title: String(it.title || '').trim(),
    url,
    price,
    priceText: price == null ? 'Цена не указана' : `${price.toLocaleString('ru-RU')} ₽`,
    priceUnit: '',
    oldPrice: typeof it.oldPrice === 'number' ? it.oldPrice : null,
    location: '',
    date: '',
    sellerId: '',
    sellerName: String(it.sellerName || '').trim(),
    sellerRating: typeof it.sellerRating === 'number' ? it.sellerRating : null,
    sellerReviews: typeof it.sellerReviews === 'number' ? it.sellerReviews : null,
    badges: [],
    promoted: Boolean(it.promoted),
    xl: false,
    delivery: false,
    photos: 0,
  };
}

export function fetchOzonIntoReport(store, reportId, url, { pages = 1, fromPage = 1, onProgress } = {}) {
  return runBrowser(async (context) => {
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(NAV);
    let added = 0, found = 0, total = 0, seq = 0, title = '';
    for (let i = 0; i < pages; i++) {
      const n = fromPage + i;
      onProgress?.(i + 1, pages);
      await page.goto(pageUrl(url, n), { waitUntil: 'domcontentloaded', timeout: NAV });
      await page.waitForTimeout(3500);
      const html = await page.content();
      const text = htmlToText(html);
      if (text.length < 400 || OZON_BLOCK.test(html.slice(0, 20000))) {
        throw httpError('Ozon показал антибот-проверку вместо выдачи — нужен резидентный прокси.', 423);
      }
      const data = await askClaudeJSON({ system: SYSTEM, content: text.slice(0, 180000), schema: SCHEMA, effort: 'low', maxTokens: 12000 });
      const items = (data.items || []).map(normalize).filter((it) => it.title);
      if (!items.length) break;
      const withPos = items.map((it) => { seq += 1; return { ...it, page: n, position: seq, rank: seq }; });
      title = data.query || title;
      const r = store.addPage(reportId, { meta: { page: n, title: title || 'Ozon', total: data.totalOnSite || null }, items: withPos });
      added += r.added; found += withPos.length; total = r.total;
      if (i < pages - 1) await page.waitForTimeout(4000 + Math.random() * 2500);
    }
    if (!found) throw httpError('На странице Ozon не нашлось товаров — проверьте ссылку (возможно, нужен прокси).', 422);
    return { found, added, total, pagesLoaded: pages, title: title || 'Ozon', via: 'dom', withState: false };
  });
}
