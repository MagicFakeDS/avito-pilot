import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseItemPage, parseRuDate } from '../src/item-page.js';
import { extractStateItems } from '../src/extract-state.js';
import { Store } from '../src/store.js';

const now = new Date('2026-10-17T14:00:00Z');

const d = parseItemPage(fs.readFileSync(new URL('./sample-item.html', import.meta.url), 'utf8'), now);
assert.equal(d.views, 8491);
assert.equal(d.viewsToday, 82);
assert.equal(d.publishedAt, '2026-09-29T19:32:00.000Z', '29 сентября в 22:32 по Москве');
assert.match(d.description, /^.{1,4}Дивaны в нaличии/);
assert.ok(d.description.length > 500, 'полный текст, а не обрезок из выдачи');
assert.equal(d.sellerSince, 'с декабря 2025');
assert.equal(d.sellerType, 'company');
assert.equal(d.sellerListings, 80, 'число объявлений продавца, а не отзывов');
assert.equal(parseItemPage('<html><body>Объявление снято</body></html>'), null);

assert.equal(parseRuDate('сегодня в 10:15', now), '2026-10-17T07:15:00.000Z');
assert.equal(parseRuDate('вчера в 23:05', now), '2026-10-16T20:05:00.000Z');
assert.equal(parseRuDate('3 января 2025 в 12:00', now), '2025-01-03T09:00:00.000Z');
assert.equal(parseRuDate('29 декабря в 10:00', new Date('2026-01-05T10:00:00Z')), '2025-12-29T07:00:00.000Z', 'без года и в будущем — прошлый год');
assert.equal(parseRuDate('непонятно', now), '');

const [first] = extractStateItems(fs.readFileSync(new URL('./sample-state.html', import.meta.url), 'utf8'));
assert.equal(first.category, 'Мебель и интерьер');
assert.equal(first.priceLowered, false);
assert.equal(typeof first.description, 'string');

const store = new Store(path.join(os.tmpdir(), `item-test-${Date.now()}.json`));
const { id } = store.createReport('t', 1);
store.addPage(id, {
  meta: { page: 1 },
  items: [{ id: '8089432882', title: 'Диван', price: 14900, description: 'коротко', images: ['https://c70.img.avito.st/image/1/x', 'https://evil.example/x.jpg'], page: 1, position: 1, rank: 1 }],
});
assert.deepEqual(store.getReport(id).items['8089432882'].images, ['https://c70.img.avito.st/image/1/x'], 'фото — только с avito.st');
assert.equal(store.setItemDetails(id, { '8089432882': d, nope: d }), 1);
const it = store.getReport(id).items['8089432882'];
assert.equal(it.views, 8491);
assert.equal(it.viewsToday, 82);
assert.equal(it.sellerType, 'company');
assert.ok(it.description.length > 500, 'полный текст заменил короткий');
store.setItemDetails(id, { '8089432882': { views: 'много', sellerType: 'admin', publishedAt: 'вчера' } });
assert.equal(it.views, null);
assert.equal(it.sellerType, '');
assert.equal(it.publishedAt, '');

console.log('Страница объявления и поля выдачи — всё совпало');
