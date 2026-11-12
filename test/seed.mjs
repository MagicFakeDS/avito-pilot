import fs from 'node:fs';
import { Store } from '../src/store.js';

const [, , samplePath, dbPath] = process.argv;
const text = fs.readFileSync(samplePath, 'utf8');
const lines = text.split('\n');

const items = [];
let cur = null;
for (const line of lines) {
  const link = line.match(/^\[(.+?)\]\((https:\/\/www\.avito\.ru\/\S+?_(\d{6,}))\)$/);
  if (link) {
    if (link[1].startsWith('Ещё')) continue;
    cur = { id: link[3], title: link[1], url: link[2], badges: [], promoted: false, delivery: false };
    items.push(cur);
    continue;
  }
  if (!cur) continue;
  const price = line.match(/^([\d ]+) ₽\s*(.*)$/);
  if (price && cur.price == null) {
    cur.price = Number(price[1].replace(/\s/g, ''));
    cur.priceUnit = price[2] || 'за всё';
  } else if (price) cur.oldPrice = Number(price[1].replace(/\s/g, ''));
  if (line === 'Бесплатно') cur.price = 0;
  if (line === 'Продвинуто') cur.promoted = true;
  if (/Доставка/.test(line)) cur.delivery = true;
  if (/мин\.|Зеленоград/.test(line) && !cur.location) cur.location = line;
  if (/назад|Вчера/.test(line)) cur.date = line;
  const seller = line.match(/^\[(.+?)(\d,\d)\2·(\d+) отзыв\S*\]\(https:\/\/www\.avito\.ru\/brands\/([^)]+)\)$/);
  if (seller) Object.assign(cur, { sellerName: seller[1], sellerRating: Number(seller[2].replace(',', '.')), sellerReviews: Number(seller[3]), sellerId: seller[4] });
  if (/^(Надёжный продавец|Оплата частями|Скидка|Документы проверены|Реквизиты проверены)$/.test(line)) cur.badges.push(line);
}

const store = new Store(dbPath);
const { id } = store.createReport('Тест: шкафы-купе, Москва');
const page = (n, list) =>
  store.addPage(id, {
    meta: { page: n, title: '«Шкаф-купе»: объявления для Москвы', total: 60835 },
    items: list.map((it, i) => ({ ...it, page: n, position: i + 1, rank: (n - 1) * 50 + i + 1 })),
  });
console.log('page 1:', page(1, items));

console.log('page 1 again:', page(1, items));
store.flush();
console.log('report id:', id, 'items:', items.length);
