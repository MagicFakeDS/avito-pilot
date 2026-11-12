import { parse } from 'node-html-parser';
import { TZ } from './time.js';

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const digits = (s) => {
  const m = String(s ?? '').replace(/[\s ]/g, '').match(/\d+/);
  return m ? Number(m[0]) : null;
};
const text = (el) => (el ? el.text.replace(/[\s ]+/g, ' ').trim() : '');

export function parseRuDate(s, now = new Date()) {
  const t = String(s || '').toLowerCase().replace(/[· ]/g, ' ').trim();
  const time = t.match(/(\d{1,2}):(\d{2})/);
  const hh = time ? time[1].padStart(2, '0') : '00';
  const mi = time ? time[2] : '00';
  const today = new Date(now).toLocaleDateString('sv-SE', { timeZone: TZ });
  let ymd = null;
  if (/сегодня/.test(t)) ymd = today;
  else if (/вчера/.test(t)) ymd = new Date(Date.parse(`${today}T12:00:00+03:00`) - 86400_000).toISOString().slice(0, 10);
  else {
    const m = t.match(/(\d{1,2})\s+([а-я]+)(?:\s+(\d{4}))?/);
    const month = m ? MONTHS.indexOf(m[2]) : -1;
    if (month < 0) return '';
    let year = m[3] ? Number(m[3]) : Number(today.slice(0, 4));
    const mk = (y) => `${y}-${String(month + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (!m[3] && Date.parse(`${mk(year)}T00:00:00+03:00`) > Date.parse(now) + 86400_000) year -= 1;
    ymd = mk(year);
  }
  const d = new Date(`${ymd}T${hh}:${mi}:00+03:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function jsonField(html, key) {
  const m = html.match(new RegExp(`\\\\?"${key}\\\\?":\\s*(\\\\?"((?:[^"\\\\]|\\\\u[0-9a-f]{4})*)\\\\?"|true|false|\\d+)`, 'i'));
  if (!m) return null;
  if (m[2] !== undefined) return m[2].replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return m[1] === 'true' ? true : m[1] === 'false' ? false : Number(m[1]);
}

export function parseItemPage(html, now = new Date()) {
  if (!/item-view\/(total-views|title-info)/.test(html)) return null;
  const root = parse(html);
  const q = (marker) => root.querySelector(`[data-marker="${marker}"]`);
  const dateText = text(q('item-view/item-date')).replace(/^[\s·]+/, '');

  const at = html.indexOf('publicProfileInfo');
  const profile = at >= 0 ? html.slice(at, at + 6000) : '';
  const isShop = jsonField(profile, 'isShop');
  const isCompany = jsonField(profile, 'isCompany');
  const summary = String(jsonField(profile, 'summary') || '');
  return {
    views: digits(text(q('item-view/total-views'))),
    viewsToday: digits(text(q('item-view/today-views'))),
    publishedAt: parseRuDate(dateText, now),
    description: (q('item-view/item-description')?.structuredText || '').trim(),
    sellerSince: String(jsonField(profile, 'howOldInfo') || '').replace(/^На Авито\s*/i, ''),
    sellerType: isShop === true ? 'shop' : isCompany === true ? 'company' : isShop === false && isCompany === false ? 'person' : '',
    sellerListings: /объявлен/.test(summary) ? digits(summary) : null,
    detailsAt: new Date(now).toISOString(),
  };
}
