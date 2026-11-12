import crypto from 'node:crypto';
import { runBrowser } from './fetch-avito.js';

const NAV = 45000;
const httpError = (m, s) => Object.assign(new Error(m), { status: s });

export function isWbUrl(raw) {
  try {
    const h = new URL(raw).hostname;
    return /(^|\.)wildberries\.ru$/.test(h) || /(^|\.)wb\.ru$/.test(h);
  } catch {
    return false;
  }
}

function queryOf(url) {
  const u = new URL(url);
  return (u.searchParams.get('search') || u.searchParams.get('text') || u.searchParams.get('query') || '').trim();
}

function apiUrl(query, page) {
  const p = new URLSearchParams({
    ab_testing: 'false', appType: '1', curr: 'rub', dest: '-1257786', lang: 'ru',
    page: String(page), query, resultset: 'catalog', sort: 'popular', spp: '30', suppressSpellcheck: 'false',
  });
  return 'https://search.wb.ru/exactmatch/ru/common/v9/search?' + p.toString();
}

function wbPrice(p) {
  if (typeof p.salePriceU === 'number') {
    return { price: p.salePriceU / 100, old: typeof p.priceU === 'number' ? p.priceU / 100 : null };
  }
  const pr = p.sizes && p.sizes[0] && p.sizes[0].price;
  if (pr) {
    const cur = pr.product != null ? pr.product : pr.total != null ? pr.total : pr.basic;
    return { price: cur != null ? cur / 100 : null, old: pr.basic != null && pr.basic !== cur ? pr.basic / 100 : null };
  }
  if (typeof p.priceU === 'number') return { price: p.priceU / 100, old: null };
  return { price: null, old: null };
}

function toItem(p) {
  const { price, old } = wbPrice(p);
  const rating = p.reviewRating != null ? p.reviewRating : p.rating != null ? p.rating : p.nmReviewRating != null ? p.nmReviewRating : null;
  return {
    id: 'wb' + p.id,
    title: String(p.name || '').trim(),
    url: `https://www.wildberries.ru/catalog/${p.id}/detail.aspx`,
    price,
    priceText: price == null ? 'Цена не указана' : `${price.toLocaleString('ru-RU')} ₽`,
    priceUnit: '',
    oldPrice: old,
    location: '',
    date: '',
    sellerId: String(p.supplierId || ''),
    sellerName: String(p.supplier || p.brand || '').trim(),
    sellerRating: typeof rating === 'number' ? rating : null,
    sellerReviews: typeof p.feedbacks === 'number' ? p.feedbacks : null,
    badges: p.brand ? [String(p.brand)] : [],
    promoted: Boolean(p.log && (p.log.promoPosition || p.log.cpm || p.log.position)),
    xl: false,
    delivery: false,
    photos: 0,
  };
}

async function fetchJson(page, url) {
  let resp;
  try {
    resp = await page.goto(url, { waitUntil: 'commit', timeout: NAV });
  } catch (e) {
    if (/ERR_HTTP_RESPONSE_CODE_FAILURE|ERR_ABORTED/.test(e.message || '')) {
      throw httpError('Wildberries ограничил доступ с этого IP (антибот WAF). Нужен резидентный прокси.', 423);
    }
    throw httpError('Не удалось открыть Wildberries: ' + (e.message || 'ошибка сети'), 423);
  }
  if (!resp) throw httpError('Wildberries не ответил', 423);
  const status = resp.status();
  if (status === 403 || status === 498 || status === 429) {
    throw httpError(`Wildberries ограничил доступ с этого IP (код ${status}). Нужен резидентный прокси.`, 423);
  }
  const body = await resp.text();
  if (!body) return [];
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw httpError('Wildberries вернул не JSON (похоже на антибот). Нужен резидентный прокси.', 423);
  }
  return (data.data && data.data.products) || data.products || [];
}

export function fetchWbIntoReport(store, reportId, url, { pages = 1, fromPage = 1, onProgress } = {}) {
  const query = queryOf(url);
  if (!query) throw httpError('Для Wildberries пришлите ссылку поиска со словом запроса (например …/search.aspx?search=чехол).', 400);
  return runBrowser(async (context) => {
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(NAV);
    let added = 0, found = 0, total = 0, seq = 0;
    for (let i = 0; i < pages; i++) {
      const n = fromPage + i;
      onProgress?.(i + 1, pages);
      const products = await fetchJson(page, apiUrl(query, n));
      if (!products.length) break;
      const items = products.map(toItem).map((it) => { seq += 1; return { ...it, page: n, position: seq, rank: seq }; });
      const r = store.addPage(reportId, { meta: { page: n, title: `Wildberries: ${query}`, total: null }, items });
      added += r.added; found += items.length; total = r.total;
      if (i < pages - 1) await page.waitForTimeout(1500 + Math.random() * 1500);
    }
    if (!found) throw httpError('Wildberries не вернул товаров по этому запросу.', 422);
    return { found, added, total, pagesLoaded: pages, title: `Wildberries: ${query}`, via: 'dom', withState: false };
  });
}
