import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseListingPage, normalizeItems, isBlockedPage, isIpBlocked } from './extract-dom.js';
import { PAGE_SIZE, extractListings } from './extract.js';
import { htmlToText } from './page-text.js';
import { parseItemPage } from './item-page.js';
import crypto from 'node:crypto';

const NAV_TIMEOUT = 45000;

const LIST_PAUSE_MS = Math.max(0, Number(process.env.AVITO_LIST_PAUSE_MS) || 4000);

const AVITO_MIN_INTERVAL_MS = Math.max(0, Number(process.env.AVITO_MIN_INTERVAL_MS) || 4000);
let avitoLastHit = 0;
async function paceAvito() {
  const wait = AVITO_MIN_INTERVAL_MS - (Date.now() - avitoLastHit);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  avitoLastHit = Date.now();
}

const PARSER_PROXY = parseProxy(process.env.PARSER_PROXY || process.env.AVITO_PROXY);
function parseProxy(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  try {
    const u = new URL(v.includes('://') ? v : 'http://' + v);
    const proxy = { server: `${u.protocol}//${u.host}` };
    if (u.username) proxy.username = decodeURIComponent(u.username);
    if (u.password) proxy.password = decodeURIComponent(u.password);
    return proxy;
  } catch {
    return null;
  }
}
const UA =
  process.env.AVITO_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const DEFAULT_PROFILE = path.join(fileURLToPath(new URL('..', import.meta.url)), 'browser-profile');

export async function openContext({ headless, display, xauth, viewport } = {}) {
  const { chromium } = await loadPlaywright();
  const profileDir = process.env.AVITO_BROWSER_PROFILE || DEFAULT_PROFILE;

  if (profileResetPending) {
    profileResetPending = false;
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
      console.warn('Профиль браузера сброшен после стойкого блока Авито');
    } catch (err) {
      console.error('не сбросил профиль:', err.message);
    }
  }

  const wantHeadless = headless ?? process.env.AVITO_HEADLESS !== '0';
  const disp = display || (wantHeadless ? '' : process.env.AVITO_DISPLAY || ':0');
  const xa = disp ? xauth || process.env.AVITO_XAUTHORITY || '/var/run/lightdm/root/:0' : '';
  const base = {
    headless: wantHeadless,
    userAgent: UA,
    locale: 'ru-RU',
    viewport: viewport || { width: 1366, height: 900 },
    ...(PARSER_PROXY ? { proxy: PARSER_PROXY } : {}),
    ...(disp ? { env: { ...process.env, DISPLAY: disp, ...(xa ? { XAUTHORITY: xa } : {}) } } : {}),
  };
  const open = (opts) => chromium.launchPersistentContext(profileDir, opts);
  const channel = process.env.AVITO_BROWSER_CHANNEL;
  if (channel) return open({ ...base, channel });

  try {
    return await open({ ...base, channel: 'chrome' });
  } catch {
    try {
      return await open({ ...base, channel: 'msedge' });
    } catch {
      return open(base);
    }
  }
}

const BAN_COOLDOWN_MIN = Math.max(1, Number(process.env.AVITO_BAN_COOLDOWN_MIN) || 5);

const PROFILE_RESET_STRIKES = Math.max(2, Number(process.env.AVITO_PROFILE_RESET_STRIKES) || 2);
let profileResetPending = false;
const BAN_MAX_MIN = Math.max(BAN_COOLDOWN_MIN, Number(process.env.AVITO_BAN_MAX_MIN) || 60);
const IP_RETRY_WAITS = [20_000, 40_000];
const BAN_FILE = process.env.AVITO_BAN_FILE || path.join(fileURLToPath(new URL('..', import.meta.url)), 'data', 'avito-ban.json');
const NO_BAN = { until: 0, strikes: 0, last: 0 };
let ban = { ...NO_BAN };

function readBan() {
  try {
    ban = { ...NO_BAN, ...JSON.parse(fs.readFileSync(BAN_FILE, 'utf8')) };
  } catch {
    ban = { ...NO_BAN };
  }
}
readBan();
export const banLeftMin = () => {
  readBan();
  return Date.now() < ban.until ? Math.ceil((ban.until - Date.now()) / 60_000) : 0;
};

export function clearBan() {
  ban = { ...NO_BAN };
  try {
    fs.writeFileSync(BAN_FILE, JSON.stringify(ban));
  } catch (err) {
    console.error('не сбросил паузу:', err.message);
  }
}
function noteBan() {
  const now = Date.now();
  const strikes = now - ban.last < 6 * 3600_000 ? ban.strikes + 1 : 1;
  const minutes = Math.min(BAN_MAX_MIN, BAN_COOLDOWN_MIN * 2 ** (strikes - 1));
  ban = { until: now + minutes * 60_000, strikes, last: now };
  if (strikes >= PROFILE_RESET_STRIKES) profileResetPending = true;
  try {
    fs.mkdirSync(path.dirname(BAN_FILE), { recursive: true });
    fs.writeFileSync(BAN_FILE, JSON.stringify(ban));
  } catch (err) {
    console.error('не сохранил паузу:', err.message);
  }
  console.warn(`Авито ограничил доступ с IP сервера — пауза ${minutes} мин (блок №${strikes} подряд)`);
}
const waitText = (min) => (min >= 90 ? `${Math.round(min / 60)} ч` : `${min} мин`);
function banError() {
  return Object.assign(
    new Error(`Авито временно ограничил доступ с сервера: с его адреса было слишком много запросов, и Авито просит пройти капчу. Капчу я не прохожу, поэтому делаю паузу — попробуйте через ${waitText(banLeftMin())}. Обычно ограничение снимается само.`),
    { status: 423, banned: true },
  );
}

export function isSearchUrl(raw) {
  try {
    const u = new URL(raw);
    return /(^|\.)avito\.ru$/.test(u.hostname);
  } catch {
    return false;
  }
}

function pageUrl(raw, page) {
  const u = new URL(raw);
  if (page > 1) u.searchParams.set('p', String(page));
  else u.searchParams.delete('p');
  return u.toString();
}

async function loadListing(page, target) {
  let lastDoc = null;
  const onResponse = (r) => {
    if (r.request().resourceType() === 'document' && r.frame() === page.mainFrame() && r.status() === 200) lastDoc = r;
  };
  page.on('response', onResponse);
  const raw = async () => (lastDoc ? await lastDoc.text().catch(() => '') : '');
  try {
    await paceAvito();
    let ipWaits = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.goto(target, { waitUntil: 'domcontentloaded' });

      await page
        .waitForFunction(() => document.querySelector('[data-marker="item"]') || document.querySelector('[itemtype$="/Product"]') || /проблема с IP/i.test(document.title), null, { timeout: 12000 })
        .catch(() => {});
      const html = await page.content();
      if (html.includes('data-marker="item"')) return withState(html, await raw());
      if (isIpBlocked(html)) {
        if (ipWaits >= IP_RETRY_WAITS.length) return html;
        await page.waitForTimeout(IP_RETRY_WAITS[ipWaits++]);
        continue;
      }
      if (!isBlockedPage(html)) return withState(html, await raw());

      if (/geetest|checkbox-captcha|solve|slider/i.test(html.slice(0, 6000)) && attempt > 0) return html;
      await page.waitForTimeout(5000 + attempt * 3000);
    }
    return withState(await page.content(), await raw());
  } finally {
    page.off('response', onResponse);
  }
}

function withState(html, raw) {
  if (/data-mfe-state/.test(html) && html.includes('sortTimeStamp')) return html;
  const scripts = String(raw).match(/<script\b[^>]*data-mfe-state[^>]*>[\s\S]*?<\/script>/gi) || [];
  return scripts.length ? html + '\n' + scripts.join('\n') : html;
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const e = new Error(
      'Не установлен Playwright. В папке server выполните: npm i playwright && npx playwright install chromium',
    );
    e.status = 501;
    throw e;
  }
}

export async function parsePage(html, { allowAi = true, aiExtract = extractListings } = {}) {
  const parsed = parseListingPage(html);
  if (parsed.via !== 'none' || !allowAi) return parsed;
  try {
    const ai = await aiExtract(htmlToText(html));
    if (ai.items.length) {
      return { title: parsed.title || ai.query, count: parsed.count ?? ai.totalOnSite, items: ai.items, via: 'ai', withState: false };
    }
  } catch (err) {
    console.error('запасной разбор нейросетью не удался:', err.message);
  }

  if (parsed.partial?.length) return { ...parsed, items: parsed.partial, via: 'dom' };
  return parsed;
}

let browserQueue = Promise.resolve();

export function runBrowser(task) {
  const run = browserQueue.then(async () => {
    const context = await openContext();
    try {
      return await task(context);
    } finally {
      await context.close().catch(() => {});
    }
  });
  browserQueue = run.catch(() => {});
  return run;
}

export function solveCaptcha({ url = 'https://www.avito.ru/moskva?q=диван', waitMs = 600000, display = ':0', xauth = '/var/run/lightdm/root/:0', onOpen } = {}) {
  const run = browserQueue.then(async () => {
    const context = await openContext({ headless: false, display, xauth });
    try {
      const page = context.pages()[0] || (await context.newPage());
      await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
      onOpen?.();
      const until = Date.now() + waitMs;
      while (Date.now() < until) {
        if (!context.pages().length) break;
        const ok = await page.waitForSelector('[data-marker="item"]', { timeout: 5000 }).then(() => true).catch(() => false);
        if (ok) { clearBan(); return true; }
      }
      return false;
    } finally {
      await context.close().catch(() => {});
    }
  });
  browserQueue = run.catch(() => false);
  return run;
}

const CAPTCHA_VIEWPORT = { width: 1100, height: 1500 };
const captchaSessions = new Map();
export const getCaptchaSession = (token) => captchaSessions.get(token) || null;

export function startCaptchaSession(url, { waitMs = 600000, display = ':0', xauth = '/var/run/lightdm/root/:0' } = {}) {
  const token = crypto.randomBytes(16).toString('hex');
  let ready;
  const whenReady = new Promise((r) => (ready = r));
  const run = browserQueue.then(async () => {
    let context;
    try {
      context = await openContext({ headless: false, display, xauth, viewport: CAPTCHA_VIEWPORT });
      const page = context.pages()[0] || (await context.newPage());
      await page.setViewportSize(CAPTCHA_VIEWPORT).catch(() => {});
      const sess = { page, context, solved: false, startedAt: Date.now(), viewport: CAPTCHA_VIEWPORT };
      captchaSessions.set(token, sess);
      await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
      ready(token);
      const until = Date.now() + waitMs;
      while (Date.now() < until) {
        if (!context.pages().length) break;
        const ok = await page.waitForSelector('[data-marker="item"]', { timeout: 3000 }).then(() => true).catch(() => false);
        if (ok) { clearBan(); sess.solved = true; break; }
        sess.wall = isIpBlocked(await page.content().catch(() => ''));
      }

      const linger = Date.now() + 6000;
      while (sess.solved && Date.now() < linger && context.pages().length) await page.waitForTimeout(1000).catch(() => {});
    } catch (e) {
      console.error('captcha session:', e.message);
    } finally {
      captchaSessions.delete(token);
      ready(token);
      await context?.close().catch(() => {});
    }
  });
  browserQueue = run.catch(() => {});
  return whenReady;
}
export function fetchAvitoSearch(url, opts = {}) {
  const run = browserQueue.then(() => fetchOnce(url, opts));
  browserQueue = run.catch(() => {});
  return run;
}

function storefrontItems() {
  const items = [];
  const seen = new Set();
  document.querySelectorAll('[itemtype$="/Product"], [itemtype*="schema.org/Product"]').forEach((p) => {
    const nameEl = p.querySelector('[itemprop="name"]');
    const priceEl = p.querySelector('[itemprop="price"]');
    const linkEl = p.querySelector('[itemprop="url"]') || p.querySelector('a[href*="_"]');
    const name = nameEl ? (nameEl.getAttribute('content') || nameEl.textContent || '').trim() : '';
    const href = linkEl ? (linkEl.getAttribute('href') || linkEl.getAttribute('content') || '') : '';
    const m = href.match(/_(\d{6,})(?:\?|$|\/)/);
    if (!name || !m || seen.has(m[1])) return;
    seen.add(m[1]);
    const praw = priceEl ? (priceEl.getAttribute('content') || priceEl.textContent || '') : '';
    const price = praw ? Number(String(praw).replace(/[^\d]/g, '')) : null;
    items.push({ id: m[1], title: name, url: href.split('?')[0], price: Number.isFinite(price) ? price : null, priceUnit: '', oldPrice: null, location: '', date: '', sellerId: '', sellerName: '', sellerRating: null, sellerReviews: null, badges: [], promoted: false, xl: false, delivery: false, photos: 0 });
  });
  return items;
}

const CACHE_TTL_MS = Math.max(0, Number(process.env.AVITO_CACHE_TTL_MIN) || 30) * 60_000;
const CACHE_MAX = Math.max(50, Number(process.env.AVITO_CACHE_MAX) || 500);
const pageCache = new Map();
function cacheKey(rawUrl, page) {
  try {
    const u = new URL(rawUrl);
    for (const k of [...u.searchParams.keys()]) if (/^(src|context|utm_|_gl|slocation)/i.test(k)) u.searchParams.delete(k);
    u.searchParams.delete('p');
    if (page > 1) u.searchParams.set('p', String(page));
    return u.origin + u.pathname + (u.search || '');
  } catch {
    return rawUrl + '#' + page;
  }
}
function cachePut(key, val) {
  if (!CACHE_TTL_MS) return;
  if (pageCache.size >= CACHE_MAX) pageCache.delete(pageCache.keys().next().value);
  pageCache.set(key, val);
}

async function fetchOnce(url, { pages = 1, fromPage = 1, onProgress, aiExtract } = {}) {
  if (!isSearchUrl(url)) {
    throw Object.assign(new Error('Это не ссылка на Авито. Пришлите адрес страницы поиска avito.ru'), { status: 400 });
  }
  const collected = [];
  let title = '';
  let total = null;
  let via = 'dom';
  let withState = false;
  let context = null;
  let page = null;

  const ensurePage = async () => {
    if (page) return page;
    if (banLeftMin()) throw banError();
    context = await openContext();
    page = await context.newPage();
    page.setDefaultNavigationTimeout(NAV_TIMEOUT);
    return page;
  };
  try {
    for (let i = 0; i < pages; i++) {
      const n = fromPage + i;
      onProgress?.(i + 1, pages);

      const ck = cacheKey(url, n);
      const hit = CACHE_TTL_MS ? pageCache.get(ck) : null;
      if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
        if (i === 0) { title = hit.title; total = hit.count; }
        if (!hit.items.length) break;
        if (RANK[hit.via] > RANK[via]) via = hit.via;
        withState ||= hit.withState;
        collected.push({ page: n, items: hit.items });
        continue;
      }

      const pg = await ensurePage();
      if (i > 0) await pg.waitForTimeout(LIST_PAUSE_MS + Math.random() * 2000);
      const html = await loadListing(pg, pageUrl(url, n));
      if (!html.includes('data-marker="item"') && isIpBlocked(html)) {
        noteBan();
        if (collected.length) break;
        throw banError();
      }
      if (!html.includes('data-marker="item"') && isBlockedPage(html)) {
        if (collected.length) break;
        throw Object.assign(new Error('Авито показал проверку безопасности вместо выдачи и не пропустил. Попробуйте ещё раз через несколько минут.'), { status: 423 });
      }
      const have = collected.reduce((s, p) => s + p.items.length, 0);
      const allowAi = i === 0 || (total != null && have < total);
      let parsed = await parsePage(html, { allowAi: false, ...(aiExtract ? { aiExtract } : {}) });
      if (!parsed.items.length) {
        const sf = await pg.evaluate(storefrontItems).catch(() => []);
        if (sf.length) parsed = { title: parsed.title, count: parsed.count, items: sf, via: 'dom', withState: false };
      }
      if (!parsed.items.length && allowAi) parsed = await parsePage(html, { allowAi: true, ...(aiExtract ? { aiExtract } : {}) });
      if (i === 0) {
        title = parsed.title;
        total = parsed.count;
      }
      const norm = normalizeItems(parsed.items);
      cachePut(ck, { items: norm, title: parsed.title, count: parsed.count, via: parsed.via, withState: parsed.withState, ts: Date.now() });
      if (!parsed.items.length) break;
      if (RANK[parsed.via] > RANK[via]) via = parsed.via;
      withState ||= parsed.withState;
      collected.push({ page: n, items: norm });
    }
  } finally {
    if (context) await context.close().catch(() => {});
  }
  if (via !== 'dom') console.warn(`Авито: вёрстка не разобралась, объявления взяты способом «${via}» (${url})`);
  return { title, total, via, withState, pages: collected };
}
const RANK = { dom: 0, state: 1, ai: 2 };

const ITEM_LIMIT = Math.max(1, Number(process.env.AVITO_ITEM_PAGES) || 50);
const ITEM_CACHE_MIN = Math.max(0, Number(process.env.AVITO_ITEM_CACHE_MIN) || 120);
const ITEM_PAUSE_MS = Math.max(0, Number(process.env.AVITO_ITEM_PAUSE_MS) || 3000);
const itemCache = new Map();

export function fetchItemPages(urls, opts = {}) {
  const run = browserQueue.then(() => fetchItemsOnce(urls, opts));
  browserQueue = run.catch(() => {});
  return run;
}

async function fetchItemsOnce(urls, { onProgress } = {}) {
  const details = new Map();
  let blocked = false;
  if (banLeftMin()) return { details, blocked: true };
  const context = await openContext();
  try {
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(NAV_TIMEOUT);
    for (const [i, url] of urls.entries()) {
      onProgress?.(i + 1, urls.length);
      try {
        let html = '';

        for (let attempt = 0; attempt < 3; attempt++) {
          await page.goto(url, { waitUntil: 'domcontentloaded' });
          await page.waitForSelector('[data-marker="item-view/total-views"]', { timeout: 15000 }).catch(() => {});
          html = await page.content();
          if (html.includes('item-view/total-views') || !isBlockedPage(html)) break;
          if (isIpBlocked(html) && attempt > 0) break;
          if (attempt < 2) await page.waitForTimeout(isIpBlocked(html) ? IP_RETRY_WAITS[0] : attempt ? 15000 : 5000);
        }
        const d = parseItemPage(html);
        if (d) details.set(url, d);
        else if (isIpBlocked(html)) {
          noteBan();
          blocked = true;
          break;
        } else if (isBlockedPage(html)) {
          blocked = true;
          break;
        }
      } catch (err) {
        console.error('объявление не открылось:', url, err.message);
      }
      if (i < urls.length - 1) await page.waitForTimeout(ITEM_PAUSE_MS + Math.random() * 2000);
    }
  } finally {
    await context.close().catch(() => {});
  }
  return { details, blocked };
}

export async function fetchDetailsIntoReport(store, reportId, { onProgress, limit = ITEM_LIMIT } = {}) {
  const items = Object.values(store.getReport(reportId)?.items || {})
    .filter((it) => it.url && /avito\.ru/.test(it.url))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit);
  const fresh = (id) => {
    const c = itemCache.get(id);
    return c && Date.now() - Date.parse(c.detailsAt) < ITEM_CACHE_MIN * 60_000;
  };
  const todo = items.filter((it) => !fresh(it.id));
  const { details, blocked } = todo.length ? await fetchItemPages(todo.map((it) => it.url), { onProgress }) : { details: new Map(), blocked: false };
  for (const it of todo) if (details.has(it.url)) itemCache.set(it.id, details.get(it.url));
  const byItem = Object.fromEntries(items.filter((it) => itemCache.has(it.id)).map((it) => [it.id, itemCache.get(it.id)]));
  store.setItemDetails(reportId, byItem);
  return { total: items.length, got: Object.keys(byItem).length, opened: todo.length, cached: items.length - todo.length, blocked };
}

export async function fetchIntoReport(store, reportId, url, { pages = 1, fromPage = 1, onProgress } = {}) {
  const res = await fetchAvitoSearch(url, { pages, fromPage, onProgress });
  let added = 0;
  let found = 0;
  let total = 0;
  for (const { page, items } of res.pages) {
    const withPos = items.map((it, i) => ({ ...it, page, position: i + 1, rank: (page - 1) * PAGE_SIZE + i + 1 }));
    const r = store.addPage(reportId, { meta: { page, title: res.title, total: res.total }, items: withPos });
    added += r.added;
    found += withPos.length;
    total = r.total;
  }
  if (!found) throw Object.assign(new Error('На странице не нашлось объявлений — проверьте ссылку'), { status: 422 });
  return { found, added, total, pagesLoaded: res.pages.length, title: res.title, via: res.via, withState: res.withState };
}
