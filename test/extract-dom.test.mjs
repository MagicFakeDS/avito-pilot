import fs from 'node:fs';
import assert from 'node:assert/strict';
import { extractItemsFromHTML, normalizeItems, isBlockedPage } from '../src/extract-dom.js';

const html = fs.readFileSync(new URL('./sample-serp.html', import.meta.url), 'utf8');
const { title, count, items } = extractItemsFromHTML(html);

assert.equal(title, '«Шкаф-купе»: объявления для Москвы');
assert.equal(count, 60835);
assert.equal(items.length, 4);

const [a, b, c, d] = items;

assert.equal(a.id, '4374325479');
assert.equal(a.title, 'Шкафы под заказ — проекты от 2 изделий');
assert.equal(a.price, 14990);
assert.equal(a.priceUnit, 'за погонный метр');
assert.equal(a.promoted, true);
assert.equal(a.xl, true);
assert.equal(a.sellerId, 'i115371416');
assert.equal(a.sellerName, 'Мебельная фабрика "Формула Мебели"');
assert.equal(a.sellerRating, 4.8);
assert.equal(a.sellerReviews, 121);
assert.deepEqual(a.badges, ['Надёжный продавец']);

assert.equal(b.price, 6500);
assert.equal(b.priceUnit, 'за всё');
assert.equal(b.delivery, true);
assert.equal(b.promoted, false);
assert.equal(b.date, '7 дней назад');
assert.equal(b.sellerId, '');

assert.equal(c.oldPrice, 15000);
assert.equal(c.sellerName, 'ШКАФ+');
assert.equal(c.sellerRating, 5);
assert.equal(c.sellerReviews, 197);

assert.equal(d.price, 0);

const norm = normalizeItems(items);
assert.equal(norm[0].url, 'https://www.avito.ru/moskva/mebel_i_interer/shkafy_pod_zakaz_proekty_ot_2_izdeliy_4374325479');
assert.equal(norm[0].priceText.replace(/\s/g, ' '), '14 990 ₽ за погонный метр');
assert.equal(norm[3].priceText, 'Бесплатно');

assert.equal(isBlockedPage('<title>Доступ ограничен: проверка безопасности</title>'), true);
assert.equal(isBlockedPage(html), false);

console.log(`Разбор DOM: ${items.length} объявлений, всё совпало`);
