import { vasLabel } from './extract-state.js';
import { stamp } from './time.js';

const DEFAULT_UNIT = 'за всё';

export function analyze(report) {
  const items = Object.values(report.items).sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  const n = items.length;
  const lastPage = report.pages.at(-1);

  const priced = items.filter((i) => i.price > 0);
  const units = groupBy(priced, (i) => i.priceUnit || DEFAULT_UNIT)
    .map(([unit, list]) => ({ unit, ...priceStats(list.map((i) => i.price)) }))
    .sort((a, b) => b.count - a.count);
  const mainUnit = units[0]?.unit ?? null;
  const mainPrices = mainUnit ? priced.filter((i) => (i.priceUnit || DEFAULT_UNIT) === mainUnit) : [];

  const share = (pred) => (n ? items.filter(pred).length / n : 0);

  const rankBuckets = [
    [1, 10],
    [11, 25],
    [26, 50],
    [51, 100],
    [101, Infinity],
  ]
    .map(([from, to]) => {
      const list = items.filter((i) => i.rank >= from && i.rank <= to);
      return {
        label: to === Infinity ? `${from}+` : `${from}–${to}`,
        count: list.length,
        promoted: list.filter((i) => i.promoted).length,
        share: list.length ? list.filter((i) => i.promoted).length / list.length : 0,
      };
    })
    .filter((b) => b.count > 0);

  const promotedPrices = mainPrices.filter((i) => i.promoted).map((i) => i.price);
  const organicPrices = mainPrices.filter((i) => !i.promoted).map((i) => i.price);

  const sellers = groupBy(
    items.filter((i) => i.sellerId),
    (i) => i.sellerId,
  )
    .map(([sellerId, list]) => {
      const head = list.find((i) => i.sellerName) || list[0];
      const prices = list.filter((i) => (i.priceUnit || DEFAULT_UNIT) === mainUnit && i.price > 0).map((i) => i.price);
      return {
        sellerId,
        name: head.sellerName || sellerId,
        count: list.length,
        promoted: list.filter((i) => i.promoted).length,
        rating: head.sellerRating,
        reviews: head.sellerReviews,
        bestRank: Math.min(...list.map((i) => i.rank || Infinity)),
        medianPrice: prices.length ? quantile(sorted(prices), 0.5) : null,
      };
    })
    .sort((a, b) => b.count - a.count || a.bestRank - b.bestRank);
  const noProfile = items.filter((i) => !i.sellerId).length;
  const top10Count = sellers.slice(0, 10).reduce((s, x) => s + x.count, 0);

  const badges = groupBy(
    items.flatMap((i) => i.badges),
    (b) => b,
  )
    .map(([name, list]) => ({ name, count: list.length }))
    .sort((a, b) => b.count - a.count);

  const locations = groupBy(
    items.filter((i) => i.location),
    (i) => i.location.split(',')[0].trim(),
  )
    .map(([name, list]) => ({ name, count: list.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  return {
    query: lastPage?.title || '',
    totalOnSite: maxOf(report.pages.map((p) => p.total)),
    pagesCollected: new Set(report.pages.map((p) => p.page)).size,
    nextPage: report.pages.reduce((m, p) => Math.max(m, p.page), 0) + 1,
    count: n,
    pricedCount: priced.length,
    units,
    mainUnit,
    histogram: histogram(mainPrices.map((i) => i.price)),
    shares: {
      promoted: share((i) => i.promoted),
      xl: share((i) => i.xl),
      delivery: share((i) => i.delivery),
      discount: share((i) => i.oldPrice > 0),
      withProfile: share((i) => i.sellerId),
    },
    rankBuckets,
    promotedVsOrganic: {
      promoted: promotedPrices.length ? priceStats(promotedPrices) : null,
      organic: organicPrices.length ? priceStats(organicPrices) : null,
    },
    sellers: {
      unique: sellers.length,
      noProfile,
      top10Share: n ? top10Count / n : 0,
      top: sellers.slice(0, 15),
    },
    badges: badges.slice(0, 12),
    locations,
  };
}

export function priceStats(values) {
  const s = sorted(values);
  return {
    count: s.length,
    min: s[0],
    p25: quantile(s, 0.25),
    median: quantile(s, 0.5),
    p75: quantile(s, 0.75),
    max: s.at(-1),
    mean: Math.round(s.reduce((a, b) => a + b, 0) / s.length),
  };
}

function histogram(values, bins = 12) {
  if (values.length < 3) return null;
  const s = sorted(values);
  let lo = quantile(s, 0.05);
  let hi = quantile(s, 0.95);
  if (hi <= lo) {
    lo = s[0];
    hi = s.at(-1);
  }
  if (hi <= lo) return null;
  const step = niceStep((hi - lo) / bins);
  lo = Math.floor(lo / step) * step;
  const count = Math.max(1, Math.ceil((hi - lo) / step));
  const buckets = Array.from({ length: count }, (_, k) => ({
    from: lo + k * step,
    to: lo + (k + 1) * step,
    count: 0,
    openLow: k === 0 && s[0] < lo,
    openHigh: false,
  }));
  buckets.at(-1).openHigh = s.at(-1) >= buckets.at(-1).to;
  for (const v of s) {
    const k = Math.min(count - 1, Math.max(0, Math.floor((v - lo) / step)));
    buckets[k].count++;
  }
  return buckets;
}

function niceStep(raw) {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
}

function quantile(s, q) {
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(s[lo] + (s[hi] - s[lo]) * (pos - lo));
}

const sorted = (arr) => [...arr].sort((a, b) => a - b);
const maxOf = (arr) => arr.filter((x) => x != null).reduce((a, b) => Math.max(a, b), null);

function groupBy(arr, key) {
  const map = new Map();
  for (const x of arr) {
    const k = key(x);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(x);
  }
  return [...map.entries()];
}

export function toCsv(report) {
  const cols = [
    ['rank', 'Позиция'],
    ['page', 'Страница'],
    ['id', 'ID'],
    ['title', 'Заголовок'],
    ['price', 'Цена'],
    ['priceUnit', 'Единица'],
    ['oldPrice', 'Старая цена'],
    ['viewsToday', 'Просмотров за сегодня'],
    ['views', 'Просмотров всего'],
    ['promoted', 'Продвинуто'],
    ['vasText', 'Вид продвижения'],
    ['bumped', 'Поднято (МСК)'],
    ['closedItems', 'Завершённых у продавца'],
    ['delivery', 'Доставка'],
    ['sellerName', 'Продавец'],
    ['sellerRating', 'Рейтинг'],
    ['sellerReviews', 'Отзывов'],
    ['location', 'Локация'],
    ['date', 'Дата'],
    ['badges', 'Бейджи'],
    ['url', 'Ссылка'],
  ];
  const cell = (v) => {
    if (v == null) return '';
    if (typeof v === 'boolean') return v ? 'да' : '';
    if (Array.isArray(v)) v = v.join(', ');
    const s = String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const items = Object.values(report.items)
    .sort((a, b) => a.rank - b.rank)
    .map((it) => ({ ...it, vasText: (it.vas || []).map(vasLabel), bumped: it.bumpedAt ? stamp(it.bumpedAt) : '' }));
  const lines = [cols.map((c) => c[1]).join(';')];
  for (const it of items) lines.push(cols.map(([k]) => cell(it[k])).join(';'));

  return '﻿' + lines.join('\r\n');
}
