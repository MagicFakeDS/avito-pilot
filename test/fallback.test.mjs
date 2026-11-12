import fs from 'node:fs';
import assert from 'node:assert/strict';
import { extractStateItems, vasLabel } from '../src/extract-state.js';
import { parseListingPage, isIpBlocked } from '../src/extract-dom.js';
import { parsePage } from '../src/fetch-avito.js';

const stateHtml = fs.readFileSync(new URL('./sample-state.html', import.meta.url), 'utf8');
const domHtml = fs.readFileSync(new URL('./sample-serp.html', import.meta.url), 'utf8');

const items = extractStateItems(stateHtml);
assert.equal(items.length, 3, 'баннер без sortTimeStamp не считается объявлением');
const [cpx, xl, plain] = items;
assert.equal(cpx.id, '2622788341');
assert.equal(cpx.title, 'Диван прямой Неста');
assert.equal(cpx.price, 47800);
assert.equal(cpx.url, 'https://www.avito.ru/moskva/mebel_i_interer/divan_pryamoy_nesta_2622788341');
assert.equal(cpx.sellerName, 'Дизайнерская мебель Creatica');
assert.equal(cpx.sellerId, 'creatica');
assert.equal(cpx.sellerRating, 4.7);
assert.equal(cpx.sellerReviews, 129);
assert.equal(cpx.closedItems, 3799);
assert.equal(cpx.location, 'Спортивная');
assert.deepEqual(cpx.vas, ['CPX_PROMO_V1']);
assert.equal(cpx.promoted, true);
assert.equal(cpx.xl, false);
assert.equal(cpx.delivery, true);
assert.deepEqual(cpx.badges, ['Надёжный продавец']);
assert.match(cpx.bumpedAt, /^2026-10-04T\d\d:\d\d:\d\d\.000Z$/, 'время поднятия есть даже у продвинутого');

assert.deepEqual(xl.vas, ['CPX_PROMO_V1', 'highlight', 'xl']);
assert.equal(xl.xl, true);
assert.equal(xl.closedItems, 0, '«Нет завершённых объявлений» — это 0');

assert.deepEqual(plain.vas, []);
assert.equal(plain.promoted, false);
assert.ok(plain.bumpedAt);

assert.equal(vasLabel('CPX_PROMO_V1'), 'Продвижение за просмотры');
assert.equal(vasLabel('CPX_PROMO_V2'), 'Продвижение за просмотры');
assert.equal(vasLabel('highlight'), 'Выделение');

const viaState = parseListingPage(stateHtml);
assert.equal(viaState.via, 'state');
assert.equal(viaState.items.length, 3);
assert.equal(viaState.title, '«Диван»: объявления для Москвы');
assert.equal(viaState.count, 95341);

const viaDom = parseListingPage(domHtml);
assert.equal(viaDom.via, 'dom');
assert.equal(viaDom.items.length, 4);
assert.equal(viaDom.withState, false);

const both = domHtml.replace('</body>', stateHtml.slice(stateHtml.indexOf('<script type="mime/invalid"')).replace(/2622788341/g, '4374325479'));
const merged = parseListingPage(both);
assert.equal(merged.via, 'dom');
assert.equal(merged.withState, true);
assert.equal(merged.items[0].id, '4374325479');
assert.equal(merged.items[0].title, 'Шкафы под заказ — проекты от 2 изделий', 'название — из вёрстки');
assert.deepEqual(merged.items[0].vas, ['CPX_PROMO_V1']);
assert.ok(merged.items[0].bumpedAt);
assert.deepEqual(merged.items[1].vas, [], 'нет в состоянии — пустые поля');

const bare = '<html><body><h1>Диваны</h1><a href="/moskva/divany/divan_1234567890">Диван</a> 10 000 ₽</body></html>';
let aiText = null;
const fakeAi = async (text) => {
  aiText = text;
  return { query: 'Диваны', totalOnSite: 1, items: [{ id: '1234567890', title: 'Диван', url: 'https://www.avito.ru/moskva/divany/divan_1234567890', price: 10000 }] };
};
const viaAi = await parsePage(bare, { aiExtract: fakeAi });
assert.equal(viaAi.via, 'ai');
assert.equal(viaAi.items.length, 1);
assert.match(aiText, /\[Диван\]\(https:\/\/www\.avito\.ru\/moskva\/divany\/divan_1234567890\)/, 'нейросеть получает текст страницы со ссылками');

let called = false;
const none = await parsePage(bare, { allowAi: false, aiExtract: async () => ((called = true), { items: [] }) });
assert.equal(none.via, 'none');
assert.equal(called, false);

const failed = await parsePage(bare, { aiExtract: async () => { throw new Error('нет ключа'); } });
assert.equal(failed.items.length, 0);

let aiUsed = false;
await parsePage(domHtml, { aiExtract: async () => ((aiUsed = true), { items: [] }) });
assert.equal(aiUsed, false);

assert.equal(isIpBlocked('<html><head><title>Доступ ограничен: проблема с IP</title></head></html>'), true);
assert.equal(isIpBlocked(domHtml), false);
assert.equal(isIpBlocked(stateHtml), false);

console.log('Запасной разбор: состояние страницы и нейросеть — всё совпало');
