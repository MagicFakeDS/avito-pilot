import '../src/env.js';
import { fetchAvitoSearch } from '../src/fetch-avito.js';

const url = process.argv[2] || 'https://www.avito.ru/moskva/mebel_i_interer/divany-ASgBAgICAUSmGKZv?q=диван';
const started = Date.now();
const r = await fetchAvitoSearch(url, { pages: 1 });
const items = r.pages.flatMap((p) => p.items);
console.log(`Заголовок: ${r.title || '(нет)'} | всего на сайте: ${r.total ?? '(нет)'} | объявлений: ${items.length} | разбор: ${r.via}${r.withState ? ' + данные страницы' : ''} | ${((Date.now() - started) / 1000).toFixed(1)} с`);

const fields = {
  'название': (it) => it.title,
  'ссылка': (it) => it.url,
  'цена': (it) => it.price != null,
  'город/метро': (it) => it.location,
  'дата': (it) => it.date,
  'продавец': (it) => it.sellerName,
  'рейтинг': (it) => it.sellerRating != null,
  'продвинуто': (it) => it.promoted,
  'XL': (it) => it.xl,
  'бейджи': (it) => it.badges?.length,
  'поднятие': (it) => it.bumpedAt,
  'вид продв.': (it) => it.vas?.length,
  'завершённых': (it) => it.closedItems != null,
};
for (const [name, has] of Object.entries(fields)) {
  const n = items.filter((it) => has(it)).length;
  console.log(`${name.padEnd(12)} ${String(n).padStart(3)} / ${items.length}`);
}
for (const it of items.slice(0, 5)) {
  console.log(`- ${it.title} | ${it.price} ${it.priceUnit} | ${it.location} | ${it.date} | ${it.sellerName}${it.promoted ? ' | продвинуто' : ''}${it.xl ? ' | XL' : ''}`);
}
process.exit(items.length ? 0 : 1);
