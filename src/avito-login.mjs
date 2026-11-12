import './env.js';
import { openContext, clearBan } from './fetch-avito.js';

const WAIT_MS = Number(process.env.AVITO_LOGIN_WAIT_MS) || 600000;

const context = await openContext({ headless: false });
const page = context.pages()[0] || (await context.newPage());
await page.goto('https://www.avito.ru/moskva?q=диван', { waitUntil: 'domcontentloaded' }).catch(() => {});

console.log('\nОткрылось окно браузера с Авито.');
console.log('Если видите «Доступ ограничен» — нажмите «Продолжить» и пройдите проверку.');
console.log('Когда увидите обычную выдачу объявлений — просто закройте окно или подождите.\n');

let ok = false;
const until = Date.now() + WAIT_MS;
while (Date.now() < until) {
  if (context.pages().length === 0) break;
  const found = await page
    .waitForSelector('[data-marker="item"]', { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (found) {
    ok = true;
    break;
  }
}

if (ok) {
  clearBan();
  console.log('Проверка пройдена, профиль сохранён, пауза снята. Теперь бот будет грузить выдачу сам.');
}
else console.log('Не увидел выдачу. Если проверка так и висит — попробуйте ещё раз: npm run avito:login');

await context.close().catch(() => {});
process.exit(0);
