import { fetchIntoReport as fetchAvito, isSearchUrl as isAvitoUrl, fetchDetailsIntoReport } from './fetch-avito.js';
import { fetchWbIntoReport, isWbUrl } from './fetch-wb.js';
import { fetchOzonIntoReport, isOzonUrl } from './fetch-ozon.js';

export function detectMarket(raw) {
  if (isAvitoUrl(raw)) return 'avito';
  if (isWbUrl(raw)) return 'wb';
  if (isOzonUrl(raw)) return 'ozon';
  return null;
}

export const isMarketUrl = (u) => detectMarket(u) !== null;

export const supportsViews = (u) => detectMarket(u) === 'avito';

const NAMES = { avito: 'Авито', wb: 'Wildberries', ozon: 'Ozon' };
export const marketName = (u) => NAMES[detectMarket(u)] || 'маркетплейс';

export function fetchIntoReport(store, reportId, url, opts = {}) {
  const m = detectMarket(url);
  if (m === 'wb') return fetchWbIntoReport(store, reportId, url, opts);
  if (m === 'ozon') return fetchOzonIntoReport(store, reportId, url, opts);
  return fetchAvito(store, reportId, url, opts);
}

export { fetchDetailsIntoReport };
