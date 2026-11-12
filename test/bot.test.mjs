import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { startBot, splitMessage, markdownToTelegram, MENU } from '../src/bot.js';
import { md } from '../src/rich.js';
import { toMessages } from '../src/dialog.js';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import { createDocs } from '../src/docs.js';

const store = new Store(path.join(os.tmpdir(), `bot-test-${Date.now()}.json`));
const botInfo = { id: 42, is_bot: true, first_name: 'Test', username: 'test_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false };

const intentOnly = (intent) => ({ intent, cityName: null, citySlug: null, query: null, pages: 1, clarify: null });
const planCalls = [];
function fakePlan(text, history = []) {
  planCalls.push({ text, history: history.length });
  const t = text.toLowerCase();
  if (/каждый|расписани|замер/.test(t)) {
    const times = [...t.matchAll(/(\d{1,2}):(\d{2})/g)].map((m) => `${m[1].padStart(2, '0')}:${m[2]}`);
    const scheduleAction = /сейчас/.test(t) ? 'now' : /отключи|выключи/.test(t) ? 'off' : /убери|удали/.test(t) ? 'remove' : /добавь/.test(t) ? 'add' : /какое/.test(t) ? 'show' : 'set';
    const moscow = /москв/.test(t);
    const query = (t.match(/диван\w*/) || [null])[0];
    return { intent: 'schedule', cityName: moscow ? 'Москва' : null, citySlug: moscow ? 'moskva' : null, query, pages: 1, clarify: null, scheduleAction, times, schedulePages: /весь рынок/.test(t) ? 3 : null };
  }
  if (/почему|объясни|сравни/.test(t)) return intentOnly('chat');
  if (/напиши|объявлени/.test(t) && !/провер/.test(t)) return intentOnly('write');
  if (/ответ|покупател/.test(t)) return intentOnly('reply');
  if (/провер/.test(t)) return intentOnly('audit');
  if (/подбери.*цен|подобрать цен/.test(t)) return intentOnly('price');
  let citySlug = null, cityName = null;
  if (/москв/.test(t)) { citySlug = 'moskva'; cityName = 'Москва'; }
  else if (/казан/.test(t)) { citySlug = 'kazan'; cityName = 'Казань'; }
  const query = (t.match(/диван\w*|шкаф[-\w]*|сломано/) || ['товар'])[0];
  return { intent: 'market', cityName, citySlug, query, pages: 1, clarify: citySlug ? null : 'В каком городе?' };
}

const answerCalls = [];
async function fakeAnswer(question, report, opts = {}) {
  answerCalls.push({ question, history: (opts.history || []).length });
  const n = Object.keys(report.items).length;
  opts.onText?.('## Ответ (черновик)');
  if (/долго/.test(question)) {
    await new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  }
  const full = `## Ответ\n- по запросу: ${question.slice(0, 15)} · объявлений ${n}\n- [ ] шаг`;
  opts.onText?.(full);
  return full;
}
const fetchCalls = [];
async function fakeFetch(st, reportId, url, { pages = 1, fromPage = 1 } = {}) {
  fetchCalls.push({ url, pages, fromPage });
  if (decodeURIComponent(url).includes('сломано')) throw Object.assign(new Error('Авито показал проверку безопасности'), { status: 423 });
  let added = 0, found = 0, total = 0;
  for (let k = 0; k < pages; k++) {
    const page = fromPage + k;

    const items = [0, 1, 2].map((i) => ({
      id: `${url.length}${page}0000${i}`, title: `Объяв ${page}-${i} | $5 <b>`, url: `https://www.avito.ru/x_${url.length}${page}0000${i}`,
      price: 1000 + page * 100 + i, priceUnit: 'за всё', promoted: i === 0, delivery: false, badges: [],
      sellerId: i ? '' : 'shop', sellerName: i ? '' : 'Магазин', page, position: i + 1, rank: (page - 1) * 50 + i + 1,
    }));
    const r = st.addPage(reportId, { meta: { page, title: 'Рынок', total: 999 }, items });
    added += r.added; found += items.length; total = r.total;
  }
  return { found, added, total, pagesLoaded: pages, title: 'Рынок' };
}
async function fakeParse(st, reportId, text, page) {
  const ids = [...new Set([...text.matchAll(/_(\d{6,})/g)].map((m) => m[1]))];
  const items = ids.map((id, i) => ({
    id, title: `Вставка ${id}`, url: `https://www.avito.ru/x_${id}`, price: 5000 + i, priceUnit: 'за всё',
    promoted: false, delivery: false, badges: [], sellerId: '', sellerName: '', page, position: i + 1, rank: i + 1,
  }));
  const r = st.addPage(reportId, { meta: { page, title: 'Вставка', total: 10 }, items });
  return { ...r, found: items.length, page };
}

const detailCalls = [];
async function fakeDetails(st, reportId, { onProgress } = {}) {
  const items = Object.values(st.getReport(reportId).items).sort((a, b) => a.rank - b.rank);
  detailCalls.push(items.length);
  items.forEach((_, i) => onProgress?.(i + 1, items.length));
  const byItem = Object.fromEntries(items.map((it) => [it.id, {
    views: 1000 * (10 - it.rank), viewsToday: 10 * (10 - it.rank), publishedAt: '2026-10-01T09:00:00.000Z',
    sellerType: 'company', sellerSince: 'с 2020', sellerListings: 7, detailsAt: new Date().toISOString(), description: `Полный текст ${it.title}`,
  }]));
  st.setItemDetails(reportId, byItem);
  return { total: items.length, got: items.length, opened: items.length, cached: 0, blocked: false };
}
const toolCalls = [];
const fakeTools = Object.fromEntries(
  ['write', 'price', 'audit', 'reply', 'chat'].map((name) => [
    name,
    async (text, _report, opts = {}) => {
      toolCalls.push({ name, text, history: (opts.history || []).length });
      opts.onText?.(`### ${name}`);
      return { text: `### ${name}\n- готово: ${text.slice(0, 15)}` };
    },
  ]),
);

function makeBot(opts = {}, { failRich = false, failEdit = false } = {}) {
  const calls = [];
  const { bot, tick } = startBot({
    store, token: '1:fake', botInfo,
    plan: fakePlan, answer: fakeAnswer, fetchPages: fakeFetch, parsePage: fakeParse, toolset: fakeTools, fetchDetails: fakeDetails,
    ...opts,
  });
  let msgId = 100;
  bot.api.config.use(async (prev, method, payload) => {
    calls.push({ method, payload });
    if (failEdit && method === 'editMessageText' && !payload.rich_message) {
      return { ok: false, error_code: 400, description: "Bad Request: message can't be edited" };
    }
    if (failRich && (method === 'sendRichMessage' || (method === 'editMessageText' && payload.rich_message))) {
      return { ok: false, error_code: 400, description: 'Bad Request: rich messages are not supported' };
    }
    const result = method.startsWith('send') && method !== 'sendRichMessageDraft'
      ? { message_id: ++msgId, date: 0, chat: { id: payload.chat_id, type: 'private' } }
      : true;
    return { ok: true, result };
  });
  let updateId = 1;
  const send = (text, from = 1) =>
    bot.handleUpdate({
      update_id: updateId++,
      message: {
        message_id: updateId, date: 0, text,
        chat: { id: from, type: 'private' }, from: { id: from, is_bot: false, first_name: 'U' },
        entities: text.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] : undefined,
      },
    });
  const click = (data, from = 1) =>
    bot.handleUpdate({
      update_id: updateId++,
      callback_query: { id: String(updateId), chat_instance: 'c', data, from: { id: from, is_bot: false, first_name: 'U' },
        message: { message_id: 1, date: 0, chat: { id: from, type: 'private' } } },
    });

  const stop = (chatId, draftId) =>
    bot.handleUpdate({ update_id: updateId++, stopped_message_generation: { chat: { id: chatId, type: 'private' }, draft_id: draftId } });
  const final = calls.filter.bind(calls);

  const texts = () => final((c) => c.method !== 'sendRichMessageDraft').map((c) => c.payload.text ?? c.payload.rich_message?.markdown).filter(Boolean);
  const drafts = () => final((c) => c.method === 'sendRichMessageDraft');
  const last = () => final((c) => (c.method.startsWith('send') && c.method !== 'sendRichMessageDraft') || c.method === 'editMessageText').at(-1);
  const lastButtons = () => (last().payload.reply_markup?.inline_keyboard || []).flat();
  return { calls, send, click, stop, tick, texts, drafts, last, lastButtons, reset: () => (calls.length = 0) };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const data = (buttons) => buttons.map((b) => b.callback_data);
const active = (userId) => store.getReport(store.getUser(userId).activeReport);
const runsOf = (userId) => active(userId).runs || [];

const t = makeBot();

t.reset();
await t.send('/start');
assert.equal(t.calls.filter((c) => c.method === 'sendMessage').length, 1, 'приветствие — одним сообщением');
const intro = t.last();
assert.equal(intro.payload.parse_mode, 'HTML');
assert.match(intro.payload.text, /^<b>Помощник Максим<\/b>\nПривет! Я Максим/);
assert.match(intro.payload.text, /<b>Как работать<\/b>\n1\. Создайте задачу/);
assert.doesNotMatch(intro.payload.text, /[а-яё,]\n[а-яё]/, 'без ручных переносов посреди фразы');
assert.deepEqual(data(t.lastButtons()), [MENU.task, MENU.sessions, MENU.about], 'меню — inline под приветствием');
assert.ok(t.calls.some((c) => c.method === 'deleteMessage'), 'команда /start убрана из чата');
const homeId = store.getUser(1).menuMsgId;
assert.ok(homeId, 'приветствие — «живое» меню');

t.reset();
await t.send('Без лимита');
assert.match(t.texts().at(-1), /^<b>Помощник Максим<\/b>/);
assert.deepEqual(data(t.lastButtons()), [MENU.task, MENU.sessions, MENU.about]);
const deleted = t.calls.filter((c) => c.method === 'deleteMessage').map((c) => c.payload.message_id);
assert.equal(deleted.length, 2, 'убраны нажатие кнопки и прежнее меню');
assert.ok(deleted.includes(homeId), 'прежнее меню удалено — в чате одно меню');

await t.click(MENU.about);
const about = t.texts().at(-1);
assert.match(about, /^<b>Я — Максим, помощник продавца на Авито<\/b>/);
assert.match(about, /<b>Чем могу помочь<\/b>[\s\S]*<b>Как со мной работать<\/b>[\s\S]*<b>Чего я не делаю<\/b>/);
assert.doesNotMatch(about, /[а-яё,]\n[а-яё]/, 'без ручных переносов посреди фразы');
assert.equal(t.last().method, 'editMessageText', '«Кто я» открывается на месте меню');
assert.deepEqual(data(t.lastButtons()), [MENU.home]);

t.reset();
await t.send('сколько стоят диваны в москве и кто лидеры');
await wait(30);
assert.equal(fetchCalls.length, 0, 'без задачи никуда не ходим');
assert.match(t.texts().at(-1), /Сначала создайте задачу/);
assert.deepEqual(data(t.lastButtons()), [MENU.taskRun, MENU.task, MENU.sessions]);

await t.click(MENU.taskRun);
await wait(60);
assert.match(fetchCalls.at(-1).url, /moskva\?q=/);
assert.match(decodeURIComponent(fetchCalls.at(-1).url), /диван/);
assert.equal(active(1).name, 'диван, Москва', 'задача получила имя по первому запросу');
assert.equal(runsOf(1).at(-1).status, 'done');
assert.equal(runsOf(1).at(-1).kind, 'market');

const statusMsg = t.calls.find((c) => /Захожу на Авито/.test(c.payload.text || ''));
assert.equal(statusMsg.payload.reply_markup, undefined, 'статус без нижней клавиатуры — иначе Telegram не даст его изменить');
const kbMsg = t.calls.find((c) => c.payload.reply_markup?.keyboard);
assert.ok(kbMsg, 'нижняя кнопка с остатком пришла отдельным сообщением');
assert.equal(t.calls.filter((c) => c.payload.reply_markup?.keyboard).length, 1, 'и только один раз, пока надпись та же');
const dr = t.drafts();
assert.ok(dr.length >= 1, 'ответ стримится черновиками');
assert.match(dr[0].payload.rich_message.markdown, /^<tg-thinking>.+<\/tg-thinking>$/, 'первый черновик — «Думаю…»');
assert.equal(dr[0].payload.can_stop, true, 'под черновиком есть кнопка «стоп»');
assert.ok(dr.every((d) => d.payload.draft_id === dr[0].payload.draft_id && d.payload.draft_id > 0), 'один draft_id на весь ответ');
assert.equal(t.last().method, 'sendRichMessage', 'итог — Rich Message');
const report = t.texts().at(-1);
assert.match(report, /## Ответ\n/);
assert.match(report, /## Данные по выдаче/);
assert.match(report, /\| Единица \| Шт\. \| Мин \| 25% \| Медиана \| 75% \| Макс \|/, 'таблица цен');
assert.match(report, /\| Места в выдаче \| Продвинуто \|/, 'таблица продвижения');
assert.match(report, /<details><summary>Объявления/, 'список объявлений — сворачиваемым блоком');
assert.ok(report.includes(md('Объяв 1-0 | $5 <b>')), 'текст с Авито экранирован');
assert.ok(!report.includes('| $5 <b>'), 'сырые | $ < не попадают в разметку');
assert.deepEqual(data(t.lastButtons()), ['csv', 'table', 'more'], 'под ответом — CSV, Таблица, Ещё страницы');
assert.equal(runsOf(1).at(-1).result, report, 'результат сохранён в задаче');

await t.click('csv');
assert.ok(t.calls.some((c) => c.method === 'sendDocument'));
await t.click('table');
assert.equal(t.last().method, 'sendRichMessage');
assert.match(t.texts().at(-1), /\| # \| Объявление \| Цена \| Продавец \|/, 'таблица объявлений');
await t.click('more');
await wait(60);
assert.equal(fetchCalls.at(-1).fromPage, 2, 'догрузка со следующей страницы');
assert.equal(fetchCalls.at(-1).pages, 2);
assert.match(t.texts().at(-1), /## Ответ\n/);
assert.equal(Object.keys(active(1).items).length, 9, 'догрузка добавилась в ту же задачу');
assert.equal(runsOf(1).at(-1).kind, 'more');

t.reset();
await t.click(MENU.sessions);
const list = t.lastButtons().filter((b) => b.callback_data.startsWith('use:'));
assert.match(list[0].text, /^диван, Москва — Готово \(открыта\) · 9$/);
await t.click(list[0].callback_data);
const card = t.texts().at(-1);
assert.match(card, /^<b>диван, Москва<\/b>/);
assert.match(card, /Статус: <b>Готово<\/b>/);
assert.match(card, /Запросов в задаче: 2 \(готово 2\)/);
assert.match(card, /Объявлений собрано: 9/);
assert.match(card, /<i>Проверено в \d\d:\d\d:\d\d<\/i>/, '«Обновить статус» всегда видимо перерисовывает карточку');
const id1 = active(1).id;
const cardBtns = data(t.lastButtons());
const resBtn = cardBtns.find((d) => d.startsWith('res:'));
for (const b of [resBtn, `hist:${id1}`, 'csv', `ctbl:${id1}`, `use:${id1}`, MENU.sessions, MENU.home]) assert.ok(b && cardBtns.includes(b), `в карточке есть ${b}`);

await t.click(resBtn);
assert.equal(t.last().method, 'editMessageText');
assert.ok(t.last().payload.rich_message, 'результат с таблицами — rich');
assert.match(t.texts().at(-1), /^\*\*Готово\*\* · [\s\S]*## Данные по выдаче/);
assert.deepEqual(data(t.lastButtons()), [`use:${id1}`, 'csv', `ctbl:${id1}`]);

await t.click(`ctbl:${id1}`);
assert.equal(t.last().method, 'editMessageText');
assert.match(t.texts().at(-1), /\| # \| Объявление \| Цена \| Продавец \|/);
assert.deepEqual(data(t.lastButtons()), [`use:${id1}`]);

await t.click(`hist:${id1}`);
const hist = t.lastButtons();
const histRuns = hist.filter((b) => b.callback_data.startsWith('res:'));
assert.equal(histRuns.length, 2);
assert.ok(histRuns.every((b) => b.text.startsWith('Готово · ')));
assert.equal(hist.at(-1).callback_data, `use:${id1}`);

await t.click(`use:${id1}`);
assert.match(t.texts().at(-1), /^<b>диван, Москва<\/b>/);
await t.click(MENU.home);
assert.match(t.texts().at(-1), /^<b>Помощник Максим<\/b>/);
assert.equal(t.calls.filter((c) => c.method.startsWith('send')).length, 0, 'навигация не прислала ни одного нового сообщения');
assert.ok(t.calls.filter((c) => c.method === 'editMessageText').every((c) => c.payload.message_id === 1), 'всё время одно и то же сообщение');

const chat1 = () => store.getChat(active(1).id);
assert.equal(chat1().length, 4, 'два обмена репликами: анализ и догрузка');
assert.deepEqual(chat1().map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
assert.equal(chat1()[0].text, 'сколько стоят диваны в москве и кто лидеры');
assert.match(chat1()[1].text, /## Ответ[\s\S]*\[Данные выдачи: собрано 3 объявлений из 999; медиана 1101 ₽ за всё/, 'в памяти — ответ и ключевые цифры');
assert.equal(answerCalls.at(-1).history, 2, 'догрузка отвечает с учётом прошлого обмена');

const fetchesBefore = fetchCalls.length;
await t.send('почему у лидеров дороже?');
await wait(40);
assert.equal(planCalls.at(-1).history, 4, 'планировщик видит диалог задачи');
assert.equal(toolCalls.at(-1).name, 'chat');
assert.equal(toolCalls.at(-1).history, 4, 'ответ строится с учётом всего разговора');
assert.equal(fetchCalls.length, fetchesBefore, 'за свежей выдачей не ходили');
assert.equal(t.last().method, 'sendRichMessage');
assert.equal(chat1().length, 6);
assert.equal(runsOf(1).at(-1).kind, 'chat');

await t.click(`use:${active(1).id}`);
assert.match(t.texts().at(-1), /Последний ответ: «chat готово: почему у лидеро»/);
assert.match(t.texts().at(-1), /Чат открыт/);

assert.deepEqual(
  toMessages([{ role: 'assistant', text: 'лишнее' }, { role: 'user', text: 'а' }, { role: 'user', text: 'б' }, { role: 'assistant', text: 'в' }], 'г'),
  [{ role: 'user', content: 'а\n\nб' }, { role: 'assistant', content: 'в' }, { role: 'user', content: 'г' }],
);
assert.deepEqual(toMessages([{ role: 'user', text: 'без ответа' }], 'новое'), [{ role: 'user', content: 'без ответа\n\nновое' }]);
assert.deepEqual(toMessages([], 'первое'), [{ role: 'user', content: 'первое' }]);

await t.click(MENU.task, 8);
assert.match(t.texts().at(-1), /^<b>Задача 1<\/b> создана — это новый чат/);
assert.equal(t.last().method, 'editMessageText');
assert.equal(active(8).runs?.length ?? 0, 0);
await t.click(MENU.sessions, 8);
assert.match(t.lastButtons()[0].text, /^Задача 1 — Новая \(открыта\)$/, 'новая задача без запросов — «Новая»');
await t.send('диваны в москве', 8);
await wait(60);
assert.equal(store.listReports(8).length, 1, 'запрос попал в созданную задачу');
assert.equal(active(8).name, 'диван, Москва');

await t.send('шкаф в москве', 8);
await wait(60);
assert.equal(Object.keys(active(8).items).length, 3, 'старая выдача заменена новой');
assert.equal(active(8).runs.length, 2);

await t.click(MENU.task, 11);
await t.send('сломано в москве', 11);
await wait(60);
assert.equal(runsOf(11).at(-1).status, 'error');
await t.click(`use:${active(11).id}`, 11);
assert.match(t.texts().at(-1), /Статус: <b>Ошибка<\/b>[\s\S]*Причина: Авито показал проверку безопасности/);

await t.click(MENU.task, 9);
t.reset();
const pending = t.send('диваны в москве долго', 9);
await wait(60);
await t.click(`use:${active(9).id}`, 9);
assert.match(t.texts().at(-1), /Статус: <b>В работе<\/b>[\s\S]*Работа ещё идёт/);
const draftId = t.drafts().find((d) => d.payload.chat_id === 9).payload.draft_id;
await t.stop(9, draftId);
await pending;
await wait(20);
assert.equal(t.last().method, 'sendRichMessage');
assert.match(t.texts().at(-1), /Генерация остановлена[\s\S]*Ответ \(черновик\)/);
assert.equal(runsOf(9).at(-1).status, 'stopped');
assert.match(runsOf(9).at(-1).result, /Ответ \(черновик\)/);

await t.click(MENU.task, 4);
await t.send('сколько стоят диваны', 4);
await wait(40);
assert.match(t.texts().at(-1), /В каком городе/);
const fc = fetchCalls.length;
await t.send('Москва', 4);
await wait(60);
assert.match(fetchCalls.at(-1).url, /moskva/);
assert.ok(fetchCalls.length > fc);

await t.click(MENU.task, 5);
await t.send('напиши объявление на шкаф-купе 2 метра белый', 5);
await wait(40);
assert.equal(toolCalls.at(-1).name, 'write');
assert.equal(t.last().method, 'sendRichMessage');
assert.match(t.texts().at(-1), /### write/);
assert.deepEqual(data(t.lastButtons()), ['again']);
assert.equal(runsOf(5).at(-1).kind, 'write');
assert.equal(runsOf(5).at(-1).status, 'done');
assert.match(active(5).name, /^напиши объявление/);
await t.click('again', 5);
await wait(40);
assert.equal(toolCalls.filter((c) => c.name === 'write').length, 2);
assert.equal(runsOf(5).length, 2, '«Ещё вариант» — тоже запрос в задаче');

await t.click(MENU.task, 6);
await t.send('https://www.avito.ru/moskva/mebel_i_interer?q=диван', 6);
await wait(60);
assert.equal(fetchCalls.at(-1).url, 'https://www.avito.ru/moskva/mebel_i_interer?q=диван');
assert.match(t.texts().at(-1), /## Ответ\n/);
assert.equal(runsOf(6).at(-1).kind, 'link');

await t.click(MENU.task, 7);
await t.send('[Шкаф](https://www.avito.ru/moskva/shkaf_8544904075)\n6 500 ₽ за всё\nНаписать', 7);
await wait(60);
assert.match(t.texts().at(-1), /Добавлено 1/);
const pasteEdit = t.calls.filter((c) => c.method === 'editMessageText').at(-1);
assert.deepEqual(data(pasteEdit.payload.reply_markup.inline_keyboard.flat()), ['csv', 'table']);
assert.equal(runsOf(7).at(-1).kind, 'paste');

const old = makeBot({}, { failRich: true });
await old.click(MENU.task, 10);
await old.send('сколько стоят диваны в москве', 10);
await wait(60);
assert.equal(old.last().method, 'sendMessage');
assert.equal(old.last().payload.parse_mode, 'HTML');
assert.match(old.texts().at(-1), /<b>Ответ<\/b>/);
assert.deepEqual(data(old.lastButtons()), ['csv', 'table', 'more']);
await old.click('table', 10);
assert.match(old.texts().at(-1), /^<pre>/, 'таблица — моноширинным блоком');
await old.click(`use:${active(10).id}`, 10);
const oldRes = data(old.lastButtons()).find((d) => d.startsWith('res:'));
await old.click(oldRes, 10);
assert.equal(old.last().method, 'sendMessage', 'rich-редактирование не прошло — результат пришёл обычным сообщением');
assert.match(old.texts().at(-1), /<b>Ответ<\/b>/);

t.reset();
await t.click(MENU.task);
const emptyId = active(1).id;
await t.click(`sch:${emptyId}`);
assert.match(t.texts().at(-1), /ещё не было поиска на Авито/);
assert.deepEqual(data(t.lastButtons()), [`use:${emptyId}`]);

await t.send('сколько стоят диваны в Москве');
await wait(50);
const wid = active(1).id;
assert.equal(wid, emptyId);
await t.click(`use:${wid}`);
assert.ok(data(t.lastButtons()).includes(`sch:${wid}`), 'в карточке есть «Расписание»');

t.reset();
await t.click(`sch:${wid}`);
assert.equal(t.last().method, 'editMessageText', 'расписание — на месте карточки');
assert.match(t.texts().at(-1), /^<b>Расписание: /);
assert.match(t.texts().at(-1), /Замеры каждый день по Москве: <b>не настроены<\/b>/);
assert.deepEqual(t.lastButtons().slice(0, 6).map((b) => b.text), ['09:00', '12:00', '15:00', '18:00', '21:00', '23:00']);

await t.click(`scht:${wid}:2100`);
assert.match(t.texts().at(-1), /<b>21:00<\/b>/);
assert.ok(t.lastButtons().some((b) => b.text === '21:00 — вкл'));
await t.click(`schp:${wid}`);
assert.match(t.texts().at(-1), /Глубина: 3 стр\. выдачи/);

await t.click(`schc:${wid}`);
assert.match(t.texts().at(-1), /Напишите время по Москве/);
t.reset();
await t.send('7:30');
assert.deepEqual(store.getReport(wid).schedule.times, ['07:30', '21:00']);
assert.match(t.texts().at(-1), /<b>07:30, 21:00<\/b>/);
assert.ok(t.lastButtons().some((b) => b.text === '07:30 — вкл'), 'своё время тоже кнопкой');
assert.ok(t.calls.filter((c) => c.method === 'deleteMessage').length >= 2, 'сообщение со временем и прежний экран убраны');
await t.click(`schc:${wid}`);
await t.send('25:99');
assert.match(t.texts().at(-1), /Не понял время/);

const toolsBefore = toolCalls.length;
await t.send('почему у лидеров дороже, объясни подробно');
await wait(50);
assert.equal(toolCalls.length, toolsBefore + 1);
assert.equal(store.getUser(1).awaiting, null);

await t.click(`use:${wid}`);
assert.ok(data(t.lastButtons()).includes(`xls:${wid}`));
const fetchesBeforeXls = fetchCalls.length;
await t.click(`xls:${wid}`);
assert.equal(t.calls.at(-1).method, 'sendDocument');
assert.equal(fetchCalls.length, fetchesBeforeXls);

await t.click(`use:${wid}`);
assert.match(t.texts().at(-1), /Замеры по расписанию: каждый день в 07:30, 21:00 \(МСК\)/);

let round = 0;
async function watchFetch(st, reportId, url, { pages = 1 } = {}) {
  fetchCalls.push({ url, pages, watch: true });
  round++;
  let base = [
    { id: '9000000001', title: 'Диван А', sellerId: 'a', sellerName: 'Мебель А', price: 20000, vas: ['CPX_PROMO_V1'], promoted: true, bumpedAt: '2026-10-10T10:00:00.000Z', closedItems: 120 },
    { id: '9000000002', title: 'Диван Б', sellerId: 'b', sellerName: 'Диваны Б', price: 15000, vas: [], bumpedAt: '2026-10-16T09:00:00.000Z', closedItems: 0 },
    { id: '9000000003', title: 'Диван В', sellerId: 'b', sellerName: 'Диваны Б', price: 18000, vas: ['highlight', 'xl'], xl: true, bumpedAt: '2026-10-15T09:00:00.000Z', closedItems: 0 },
  ];
  if (round > 1) {
    base[1] = { ...base[1], bumpedAt: '2026-10-17T15:30:00.000Z' };
    base[2] = { ...base[2], price: 16000 };
    base = base.reverse();
    base.push({ id: '9000000004', title: 'Диван Г', sellerId: 'c', sellerName: 'Новичок', price: 9000, vas: [], bumpedAt: '2026-10-17T12:00:00.000Z' });
  }
  const items = base.map((it, i) => ({ url: `https://www.avito.ru/x_${it.id}`, priceUnit: 'за всё', delivery: false, badges: [], promoted: false, ...it, page: 1, position: i + 1, rank: i + 1 }));
  const r = st.addPage(reportId, { meta: { page: 1, title: '«Диван»: объявления для Москвы', total: 500 }, items });
  return { found: items.length, added: r.added, total: r.total, pagesLoaded: 1, title: 'x', via: round > 1 ? 'state' : 'dom' };
}
const summaries = [];
const summarize = async (m) => (summaries.push(m), '- Диваны Б поднимают объявления чаще всех');
const day1 = new Date('2026-10-16T18:05:00Z');
const w1 = makeBot({ fetchPages: watchFetch, summarize, now: () => day1, alertTo: [1] });
assert.equal((await Promise.all(w1.tick(new Date('2026-10-16T18:00:00Z')))).length, 1, 'в 21:00 МСК — замер');
assert.equal(w1.tick(day1).length, 0, 'тот же слот второй раз не запускается');
assert.equal(w1.tick(new Date('2026-10-16T18:25:00Z')).length, 0);
assert.equal(fetchCalls.at(-1).pages, 3, 'глубина из расписания');
const first = w1.texts().at(-1);
assert.match(first, /^## Замер рынка: /);
assert.match(first, /Это первый замер/);
assert.match(first, /поднимали или разместили сегодня \*\*1\*\*/);
assert.equal(store.getSnapshots(wid).length, 1);
assert.ok(!w1.calls.some((c) => c.method === 'sendMessage' && /вёрстку/.test(c.payload.text)), 'вёрстка в порядке — админам не пишем');

const day2 = new Date('2026-10-17T18:05:00Z');
const w2 = makeBot({ fetchPages: watchFetch, summarize, now: () => day2, alertTo: [1] });
assert.equal(w2.tick(new Date('2026-10-17T17:00:00Z')).length, 0, 'до 21:00 замера нет');
assert.equal(w2.tick(new Date('2026-10-17T19:00:00Z')).length, 0, 'больше 20 минут после — пропущен');
await Promise.all(w2.tick(day2));
const rep = w2.calls.filter((c) => c.method === 'sendRichMessage').at(-1);
assert.deepEqual(rep.payload.reply_markup.inline_keyboard.flat().map((b) => b.callback_data), [`use:${wid}`, `sch:${wid}`]);

assert.equal(detailCalls.at(-1), 4);
const statuses = w2.calls.filter((c) => c.method === 'editMessageText').map((c) => c.payload.text);
assert.ok(statuses.some((x) => /открываю каждое за просмотрами — 4 из 4/.test(x)), 'ход открытия объявлений в статусе');
assert.match(statuses.at(-1), /собрал 4 объявлений и просмотры по 4, отчёт и Excel ниже/);

const doc = w2.calls.filter((c) => c.method === 'sendDocument').at(-1);
assert.ok(doc, 'после отчёта пришёл Excel');
assert.equal(doc.calls, undefined);
assert.match(doc.payload.document.filename, /^Отчёт диван, Москва 17.10 21-05.xlsx$/);
const xbuf = doc.payload.document.fileData;
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(xbuf);
assert.deepEqual(wb.worksheets.map((w) => w.name), ['Анализ объявлений', 'Конкурентный анализ', 'Сводка по кол-ву публикаций']);
const s1 = wb.getWorksheet('Анализ объявлений');
assert.equal(s1.getCell('A1').value, 'Позиция в выдаче');
assert.equal(s1.getCell('D1').value, 'Кол-во просмотров за сегодня');
assert.deepEqual([s1.getCell('A2').value, s1.getCell('B2').value, s1.getCell('D2').value, s1.getCell('E2').value, s1.getCell('G2').value], [1, 'Диван В', 90, 9000, 'Выделено; xl']);
assert.equal(s1.rowCount, 5);
const s2 = wb.getWorksheet('Конкурентный анализ');
assert.deepEqual([s2.getCell('A2').value, s2.getCell('E2').value, s2.getCell('K2').value], ['Диваны Б', 2, 170]);
const second = w2.texts().at(-1);
assert.match(second, /17\.10 21:05 по Москве/);
assert.match(second, /С прошлого замера \(16\.10 21:05\): новых в выдаче 1, ушло 0, поднимали 1, сменили цену 1/);
assert.match(second, /### Вывод\n\n- Диваны Б поднимают объявления чаще всех/);
assert.match(second, /\| Продвижение за просмотры \| 1 \| 25% \|/);
assert.match(second, /\| Выделение \| 1 \| 25% \|/);
assert.match(second, /\| Диваны Б \| 2 \| 1 \| 15\s500 ₽ \| Выделение 1, XL 1 \| 170 \| 1 \| 0 \|/);
assert.match(second, /### Поднятия сегодня \(2\)/);
assert.match(second, /\| 18:30 \| 2 \| \[Диван Б\]/);
assert.match(second, /Просмотров сегодня у собранных объявлений: \*\*300\*\*/);
assert.match(second, /### Больше всего просмотров сегодня\n\n[^\n]+\n[^\n]+\n\| 1 \| \[Диван В\]\([^)]+\) \| Диваны Б \| 90 \| 9\s000 \|/);
assert.match(second, /\| 15:00 \| 4 \| \[Диван Г\]\([^)]+\) \(новое в выдаче\) \| Новичок \|/);
assert.match(second, /\[Диван В\]\([^)]+\) \| Диваны Б \| 3 \| 1 \| \+2 \|/);
assert.match(second, /\[Диван А\]\([^)]+\) \| Мебель А \| 1 \| 3 \| -2 \|/);
assert.match(second, /### Изменения цен\n\n[\s\S]*\| 18\s000 ₽ \| 16\s000 ₽ \|/);
assert.match(second, /ставку \(цену просмотра\) Авито показывает только самому продавцу/);
assert.match(summaries.at(-1), /### Конкуренты/, 'нейросеть получает отчёт с таблицами');
const alert = w2.calls.find((c) => c.method === 'sendMessage' && /поменял вёрстку/.test(c.payload.text));
assert.ok(alert && alert.payload.chat_id === 1, 'админу пришло предупреждение о смене вёрстки');
assert.equal(store.getSnapshots(wid).length, 2);
const watchRun = store.getReport(wid).runs.at(-1);
assert.equal(watchRun.kind, 'watch');
assert.equal(watchRun.status, 'done');
assert.match(store.getChat(wid).at(-1).text, /Плановый замер 17\.10 21:05: 4 объявлений из 500/);

store.setSchedule(wid, { done: [] });
const w3 = makeBot({ fetchPages: watchFetch, summarize: async () => { throw new Error('нет ключа'); }, now: () => day2, alertTo: [] });
await Promise.all(w3.tick(day2));
assert.match(w3.texts().at(-1), /^## Замер рынка: /);
assert.doesNotMatch(w3.texts().at(-1), /### Вывод/);

t.reset();
await t.click(`schn:${wid}`);
await wait(50);
assert.match(t.texts().at(-1), /^## Замер рынка: /);
await t.click(`scho:${wid}`);
assert.deepEqual(store.getReport(wid).schedule.times, []);
assert.match(t.texts().at(-1), /<b>не настроены<\/b>/);
assert.equal(t.tick(day2).length, 0, 'без расписания замеров нет');

t.reset();
await t.click(MENU.task);
const nl = active(1).id;
await t.send('замерь сейчас');
assert.match(t.texts().at(-1), /^Что и где собирать\?/, 'без поиска — спрашивает, что собирать');

await t.send('каждый день в 21:00 собирай статистику по диванам в Москве');
assert.deepEqual(store.getReport(nl).schedule.times, ['21:00']);
assert.match(store.getReport(nl).marketUrl, /^https:\/\/www\.avito\.ru\/moskva\?q=/, 'поиск взят из сообщения');
const setMsg = t.last();
assert.equal(setMsg.method, 'sendMessage');
assert.match(setMsg.payload.text, /^Готово\. Замеры <b>диван, Москва<\/b>: каждый день в <b>21:00<\/b> по Москве, 2 стр\. выдачи\./);
assert.match(setMsg.payload.text, /замерь сейчас/, 'подсказка про разовый замер, пока замеров не было');
assert.equal(setMsg.payload.reply_markup, undefined, 'без кнопок — всё словами');

await t.send('добавь замер в 9:00');
assert.deepEqual(store.getReport(nl).schedule.times, ['09:00', '21:00']);
assert.match(t.texts().at(-1), /каждый день в <b>09:00, 21:00<\/b>/);
await t.send('убери замер в 09:00');
assert.deepEqual(store.getReport(nl).schedule.times, ['21:00']);
await t.send('каждый день в 20:30, весь рынок');
assert.deepEqual(store.getReport(nl).schedule.times, ['20:30'], '«set» заменяет прежнее время');
assert.equal(store.getReport(nl).schedule.pages, 3);
await t.send('какое расписание у меня?');
assert.match(t.texts().at(-1), /^Сейчас замеры <b>диван, Москва<\/b>: каждый день в <b>20:30<\/b> по Москве, 3 стр\./);

await t.send('замерь сейчас');
await wait(50);
assert.match(t.texts().at(-1), /^## Замер рынка: диван, Москва/);
assert.equal(store.getReport(nl).runs.at(-1).kind, 'watch');

await t.send('отключи расписание');
assert.deepEqual(store.getReport(nl).schedule.times, []);
assert.match(t.texts().at(-1), /^Расписание выключено/);
assert.ok(store.getChat(nl).some((m) => m.role === 'assistant' && /каждый день в 21:00/.test(m.text)), 'ответы про расписание — в памяти задачи');

const docsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-bot-'));
const onlineDocs = createDocs({ dataDir: docsDir, publicUrl: 'https://ez.test/docs', docsUrl: 'https://ez.test/docs/office', secret: 'test-secret' });
const od = makeBot({ docs: onlineDocs });
const LINK = /^https:\/\/ez\.test\/docs\/r\/([a-f0-9]{32})$/;
await od.click(MENU.task, 30);
await od.send('сколько стоят диваны в Москве', 30);
await wait(50);
const answerMsg = od.calls.filter((c) => c.method === 'sendRichMessage').at(-1);
const answerBtns = answerMsg.payload.reply_markup.inline_keyboard.flat();
assert.equal(answerBtns[0].text, 'Открыть отчёт');
assert.match(answerBtns[0].url, LINK, 'под ответом — ссылка на онлайн-отчёт');
assert.ok(!answerBtns.some((b) => b.callback_data === 'csv' || b.callback_data === 'table'), 'CSV и «Таблицы» больше нет');
assert.ok(answerBtns.some((b) => b.callback_data === 'more'));
const docToken = answerBtns[0].url.match(LINK)[1];
assert.match(onlineDocs.editorPage(docToken), /https:\/\/ez\.test\/docs\/office\/web-apps\/apps\/api\/documents\/api\.js/);
assert.ok(onlineDocs.file(docToken).length > 1000, 'Excel-файл лежит по ссылке');

await wait(100);
const viewsStatus = od.calls.filter((c) => c.method === 'editMessageText' && /Просмотры собраны/.test(c.payload.text || '')).at(-1);
assert.equal(viewsStatus?.payload.text, 'Просмотры собраны по 3 объявлениям — отчёт по кнопке «Открыть отчёт» обновлён.');
assert.match(onlineDocs.editorPage(docToken), new RegExp(`"key":"${docToken}-2"`), 'та же ссылка, новая версия файла');
const withViews = new ExcelJS.Workbook();
await withViews.xlsx.load(onlineDocs.file(docToken));
assert.equal(withViews.getWorksheet('Анализ объявлений').getCell('D2').value, 90, 'в отчёте появились просмотры за сегодня');

await od.click(`use:${active(30).id}`, 30);
const cardBtns30 = od.lastButtons();
assert.ok(cardBtns30.some((b) => b.text === 'Открыть отчёт' && b.url === answerBtns[0].url));
assert.ok(!cardBtns30.some((b) => b.callback_data === 'csv'));

od.reset();
await od.send('замерь сейчас', 30);
await wait(50);
const watchMsg = od.calls.filter((c) => c.method === 'sendRichMessage').at(-1);
const watchBtns = watchMsg.payload.reply_markup.inline_keyboard.flat();
assert.match(watchBtns[0].url, LINK);
assert.notEqual(watchBtns[0].url, answerBtns[0].url, 'у каждого замера своя ссылка');
assert.ok(!od.calls.some((c) => c.method === 'sendDocument'), 'файл не шлём — он открывается по ссылке');
assert.match(od.calls.filter((c) => c.method === 'editMessageText').at(-1).payload.text, /таблица — по кнопке «Открыть отчёт»/);

const ne = makeBot({}, { failEdit: true });
await ne.click(MENU.task, 40);
await ne.send('сломано в Москве', 40);
await wait(50);
const errMsg = ne.calls.filter((c) => c.method === 'sendMessage').at(-1);
assert.match(errMsg.payload.text, /^Ошибка: Авито показал проверку безопасности/, 'ошибка не потерялась');

t.reset();
await t.click(`use:${active(1).id}`, 5);
assert.equal(t.texts().at(-1), 'Задача не найдена.');

const locked = makeBot({ allowedUsers: [777] });
await locked.send('привет', 5);
assert.match(locked.texts().at(-1), /Нет доступа. Ваш id: 5/);

const rid = active(1).id;
const hangingRun = store.addRun(rid, { kind: 'market', question: 'шёл во время перезапуска' });
store.flush();
const reloadedRun = new Store(store.file).getRun(rid, hangingRun);
assert.equal(reloadedRun.status, 'error');
assert.match(reloadedRun.error, /перезапуском/);

assert.deepEqual(splitMessage('a\nb\nc', 3), ['a\nb', 'c']);
assert.equal(markdownToTelegram('### Итог\n- **цена** <5000'), '<b>Итог</b>\n• <b>цена</b> &lt;5000');
assert.equal(md('a|b $c <d> *e*'), 'a\\|b \\$c &lt;d&gt; \\*e\\*');

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2300}-\u{23FF}\u{2605}]/u;
for (const c of [...t.calls, ...old.calls, ...w1.calls, ...w2.calls, ...w3.calls, ...od.calls]) {
  const body = JSON.stringify([c.payload.text, c.payload.rich_message, c.payload.reply_markup]);
  assert.ok(!EMOJI.test(body), `эмодзи в ${c.method}: ${body.slice(0, 200)}`);
}

console.log('Все проверки бота пройдены');
process.exit(0);
