import { fetchIntoReport as fetchAvito, isSearchUrl as isAvitoUrl, fetchDetailsIntoReport } from './fetch-avito.js';
import { fetchWbIntoReport, isWbUrl } from './fetch-wb.js';
import { fetchOzonIntoReport, isOzonUrl } from './fetch-ozon.js';

const MARKETS = [
  { id: 'avito', name: 'Авито', test: isAvitoUrl, fetch: fetchAvito, views: true },
  { id: 'wb', name: 'Wildberries', test: isWbUrl, fetch: fetchWbIntoReport },
  { id: 'ozon', name: 'Ozon', test: isOzonUrl, fetch: fetchOzonIntoReport },
];

const find = (u) => MARKETS.find((m) => { try { return m.test(u); } catch { return false; } });

export const detectMarket = (u) => find(u)?.id || null;
export const isMarketUrl = (u) => !!find(u);
export const supportsViews = (u) => !!find(u)?.views;
export const marketName = (u) => find(u)?.name || 'маркетплейс';
export const markets = MARKETS.map(({ id, name }) => ({ id, name }));

export function fetchIntoReport(store, reportId, url, opts = {}) {
  return (find(url) || MARKETS[0]).fetch(store, reportId, url, opts);
}

export { fetchDetailsIntoReport };
