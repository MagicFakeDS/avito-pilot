export const VAS_LABEL = {
  CPX_PROMO_V1: 'Продвижение за просмотры',
  bbip: 'Продвижение (пакет)',
  highlight: 'Выделение',
  xl: 'XL',
};
export const vasLabel = (slug) => VAS_LABEL[slug] || (/^CPX/i.test(slug) ? VAS_LABEL.CPX_PROMO_V1 : slug);

const PROMO_SLUG = /^(CPX|bbip|x\d|vip|premium|up|turbo)/i;

function stateScripts(html) {
  const out = [];
  const re = /<script\b[^>]*data-mfe-state[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {
    }
  }
  return out;
}

function findItems(root) {
  let best = null;
  const seen = new Set();
  (function walk(o, depth) {
    if (!o || typeof o !== 'object' || depth > 12 || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) {
      const items = o.filter((x) => x && typeof x === 'object' && x.id && 'sortTimeStamp' in x);
      if (items.length && (!best || items.length > best.length)) best = items;
    }
    for (const v of Object.values(o)) walk(v, depth + 1);
  })(root, 0);
  return best || [];
}

const steps = (it, name) => (Array.isArray(it.iva?.[name]) ? it.iva[name] : []);
const component = (it, name, comp) => steps(it, name).find((c) => c?.componentData?.component === comp)?.payload;
const toInt = (s) => {
  const m = String(s ?? '').replace(/[\s ]/g, '').match(/\d+/);
  return m ? Number(m[0]) : null;
};

function cleanPath(p) {
  try {
    return 'https://www.avito.ru' + new URL(p, 'https://www.avito.ru').pathname;
  } catch {
    return '';
  }
}

function toItem(it) {
  const pd = it.priceDetailed || {};
  const price = pd.hasValue === false ? null : Number.isFinite(pd.value) ? pd.value : toInt(pd.string);
  const seller = component(it, 'UserInfoStep', 'seller-info') || {};
  const sellerLink = seller.profile?.link || it.userLogo?.link || '';
  const rating = seller.rating || it.rating || {};
  const geo = component(it, 'GeoStep', 'geo')?.geoForItems || it.geo || {};
  const delivery = component(it, 'GeoStep', 'delivery');
  const vas = (component(it, 'DateInfoStep', 'vas')?.vas || []).map((v) => String(v.slug || '')).filter(Boolean);
  if (it.isXl && !vas.includes('xl')) vas.push('xl');
  const badges = [
    ...(component(it, 'UserInfoStep', 'seller-badgebar')?.badges || []).map((b) => b.title),
    ...steps(it, 'BadgesStep').flatMap((c) => (c?.payload?.badges || []).map((b) => b.title)),
  ].filter(Boolean);
  const closed = /^Нет/i.test(it.closedItemsText || '') ? 0 : toInt(it.closedItemsText);
  const when = Number(it.sortTimeStamp);

  return {
    id: String(it.id),
    title: String(it.title || ''),
    url: cleanPath(it.urlPath || ''),
    price,
    priceUnit: String(pd.postfix || '').trim(),
    oldPrice: toInt(it.priceWithoutDiscount?.value ?? it.priceWithoutDiscount) || null,
    location: geo.geoReferences?.[0]?.content || geo.addressLocality || it.addressDetailed?.locationName || it.location?.name || '',
    date: '',
    sellerId: sellerLink.match(/\/(?:brands|user)\/([^/?#]+)/)?.[1] || '',
    sellerName: String(seller.profile?.title || ''),
    sellerRating: Number.isFinite(rating.score) ? rating.score : null,
    sellerReviews: toInt(rating.summary),
    badges,
    promoted: vas.some((s) => PROMO_SLUG.test(s)),
    xl: Boolean(it.isXl) || vas.includes('xl'),
    delivery: Boolean(delivery?.text || it.contacts?.delivery),
    photos: Number(it.imagesCount) || 0,

    bumpedAt: Number.isFinite(when) && when > 0 ? new Date(when).toISOString() : '',
    vas,
    closedItems: closed,
    priceLowered: Boolean(pd.wasLowered),
    description: String(component(it, 'DescriptionStep', 'description')?.description || '').trim(),
    address: String(it.coords?.address_user || '').trim(),
    category: String(it.category?.name || ''),
    images: (Array.isArray(it.images) ? it.images : [])
      .map((im) => im?.['636x636'] || Object.values(im || {}).find((v) => typeof v === 'string' && /^https?:/.test(v)))
      .filter(Boolean)
      .slice(0, 10),
  };
}

export function extractStateItems(html) {
  for (const state of stateScripts(html)) {
    const items = findItems(state);
    if (items.length) return items.map(toItem);
  }
  return [];
}
