import '../src/env.js';
import fs from 'node:fs';
import { extractListings } from '../src/extract.js';

const file = process.argv[2] || new URL('./sample-page1.txt', import.meta.url);
const started = Date.now();
const r = await extractListings(fs.readFileSync(file, 'utf8'));
console.log(`Заголовок: ${r.query} | всего на сайте: ${r.totalOnSite} | найдено: ${r.items.length} | ${((Date.now() - started) / 1000).toFixed(1)} с`);
console.log('Токены:', JSON.stringify(r.usage));
for (const [i, it] of r.items.entries()) {
  console.log(
    `${i + 1}. [${it.id}] ${it.title} | ${it.priceText}${it.oldPrice ? ` (было ${it.oldPrice})` : ''} | ${it.location} | ${it.date || '-'} | ` +
      `${it.sellerName || '-'}${it.sellerRating ? ` ★${it.sellerRating}` : ''}${it.sellerReviews ? ` ${it.sellerReviews} отз.` : ''} | ` +
      `${it.promoted ? 'ПРОДВ ' : ''}${it.delivery ? 'ДОСТ ' : ''}| ${it.badges.join(', ')}`,
  );
}
