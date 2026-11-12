import { parse } from 'node-html-parser';
import { extractStateItems } from './extract-state.js';

export function isBlockedPage(html) {
  const head = html.slice(0, 4000);
  return /Доступ ограничен|проверка безопасности|Подтвердите, что запросы|__firewall|geetest|checkbox-captcha/i.test(head);
}

export function isIpBlocked(html) {
  return /проблема с IP|hcaptcha/i.test(String(html).slice(0, 30000));
}

const text = (el) => (el ? (el.structuredText || el.text || '').replace(/\s+/g, ' ').trim() : '');
const toInt = (s) => {
  const n = String(s).replace(/[^\d]/g, '');
  return n ? Number(n) : null;
};

export function extractItemsFromHTML(html) {
  const root = parse(html);
  const count = toInt(text(root.querySelector('[data-marker="page-title/count"]')));
  const title = text(root.querySelector('[data-marker="page-title/text"]'));

  const items = [];
  for (const el of root.querySelectorAll('[data-marker="item"]')) {
    const id = el.getAttribute('data-item-id');
    if (!id) continue;

    const titleEl = el.querySelector('[data-marker="item-title"]');
    const name = titleEl?.getAttribute('title') || text(titleEl);
    const href = titleEl?.getAttribute('href') || '';

    const priceAttr = el.querySelector('[itemprop="price"]')?.getAttribute('content');
    const priceLabel = text(el.querySelector('[data-marker="item-price"]'));
    let price = priceAttr ? Number(priceAttr) : toInt(priceLabel);
    if (/бесплатно/i.test(priceLabel)) price = 0;
    const unitMatch = priceLabel.match(/₽\s*(.+)$/);
    const priceUnit = unitMatch ? unitMatch[1].trim() : price != null ? 'за всё' : '';

    const whole = el.text;
    const seller = sellerFrom(el);

    items.push({
      id,
      title: name,
      url: href,
      price: Number.isFinite(price) ? price : null,
      priceUnit,
      oldPrice: toInt(text(el.querySelector('[data-marker="old-price-value"]'))),
      location: text(el.querySelector('[data-marker="item-location"]')),
      date: text(el.querySelector('[data-marker="item-date"]')),
      sellerId: seller.id,
      sellerName: seller.name,
      sellerRating: seller.rating,
      sellerReviews: seller.reviews,
      badges: [...el.querySelectorAll('[data-marker^="badge-title"]')].map((b) => text(b)).filter(Boolean),
      promoted: /Продвинуто/.test(whole),
      xl: el.hasAttribute('data-is-xl'),
      delivery: /Доставк/.test(whole),
      photos: 0,
    });
  }
  return { title, count, items };
}

function sellerFrom(el) {
  const link = el.querySelectorAll('a').find((a) => /\/(brands|user)\//.test(a.getAttribute('href') || ''));
  if (!link) return { id: '', name: '', rating: null, reviews: null };
  const href = link.getAttribute('href') || '';
  const id = href.match(/\/(?:brands|user)\/([^/?#]+)/)?.[1] || '';
  const t = text(link);
  const rating = t.match(/(\d)[.,](\d)/);
  const reviews = t.match(/(\d+)\s*отзыв/);
  const name = t.replace(/\d[.,]\d.*$/s, '').trim();
  return {
    id,
    name,
    rating: rating ? Number(`${rating[1]}.${rating[2]}`) : null,
    reviews: reviews ? Number(reviews[1]) : null,
  };
}

const healthy = (items) => items.filter((i) => i.title && i.price != null).length >= Math.ceil(items.length * 0.6);

export function parseListingPage(html) {
  const dom = extractItemsFromHTML(html);
  const state = extractStateItems(html);
  const byId = new Map(state.map((s) => [s.id, s]));

  if (dom.items.length && healthy(dom.items)) {
    const items = dom.items.map((it) => {
      const s = byId.get(it.id);
      if (!s) return { ...it, bumpedAt: '', vas: [], closedItems: null };
      return {
        ...it,
        sellerName: it.sellerName || s.sellerName,
        sellerId: it.sellerId || s.sellerId,
        promoted: it.promoted || s.promoted,
        xl: it.xl || s.xl,
        photos: it.photos || s.photos,
        bumpedAt: s.bumpedAt,
        vas: s.vas,
        closedItems: s.closedItems,
        priceLowered: s.priceLowered,
        description: s.description,
        address: s.address,
        category: s.category,
        images: s.images,
      };
    });
    return { title: dom.title, count: dom.count, items, via: 'dom', withState: byId.size > 0 };
  }
  if (state.length) return { title: dom.title, count: dom.count, items: state, via: 'state', withState: true };
  return { title: dom.title, count: dom.count, items: [], via: 'none', withState: false, partial: dom.items };
}

export function normalizeItems(items) {
  return items.map((it) => {
    const url = cleanUrl(it.url);
    const priceUnit = (it.priceUnit || '').trim() || (it.price != null ? 'за всё' : '');
    return {
      ...it,
      id: String(it.id),
      url: url || '',
      priceUnit,
      priceText:
        it.price == null ? 'Цена не указана' : it.price === 0 ? 'Бесплатно' : `${it.price.toLocaleString('ru-RU')} ₽ ${priceUnit}`.trim(),
      sellerId: cleanUrl(it.sellerUrl) ? it.sellerId : it.sellerId || '',
    };
  });
}

function cleanUrl(u) {
  if (!u) return null;
  try {
    const url = new URL(u, 'https://www.avito.ru');
    if (!/(^|\.)avito\.ru$/.test(url.hostname)) return null;
    return `https://www.avito.ru${url.pathname}`;
  } catch {
    return null;
  }
}
