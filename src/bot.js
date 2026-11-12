import { Bot, InlineKeyboard, InputFile, Keyboard } from 'grammy';
import { analyze, toCsv } from './analytics.js';
import { marketMarkdown, listingsMarkdown, md } from './rich.js';
import { parseIntoReport } from './extract.js';
import { fetchIntoReport, fetchDetailsIntoReport, isMarketUrl, marketName, supportsViews } from './markets.js';
import { startCaptchaSession, getCaptchaSession } from './fetch-avito.js';
import { buildWorkbook, excelName } from './excel.js';
import { planTask as defaultPlan, answerMarket as defaultAnswer, searchUrl } from './agent.js';
import { generateInsights } from './ai.js';
import { tools as defaultTools } from './tools.js';
import { humanError } from './claude.js';
import { htmlToText, entitiesToText } from './page-text.js';
import { makeSnapshot, compareSnapshots, watchMarkdown, watchMemo, summarizeWatch } from './watch.js';
import { dayKey, hhmm, stamp } from './time.js';

const MERGE_DELAY_MS = 2500;
const SPLIT_SUSPECT = 3500;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const TG_LIMIT = 4000;
const MORE_PAGES = 2;
const LINK_PAGES = Math.max(1, Math.min(40, Number(process.env.AVITO_PAGES) || 1));

const CAPTCHA_PUBLIC_URL = (process.env.CAPTCHA_PUBLIC_URL || 'https://your-domain.example').replace(/\/$/, '');
const CAPTCHA_WAIT_MS = Math.max(60000, Number(process.env.CAPTCHA_WAIT_MS) || 600000);

const REQUEST_LIMIT = Math.max(0, Number(process.env.BOT_REQUEST_LIMIT) || 0);

const ADMINS = new Set((process.env.BOT_ADMINS || '').split(',').map((s) => Number(s.trim())).filter(Boolean));
const isAdmin = (id) => ADMINS.has(id);

const SCHEDULE_PRESETS = ['09:00', '12:00', '15:00', '18:00', '21:00', '23:00'];
const PAGE_STEPS = [1, 2, 3, 5];
const MAX_TIMES = 6;
const SLOT_GRACE_MIN = 20;
const TICK_MS = 30_000;
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export function parseTime(s) {
  const m = String(s).trim().match(/^(\d{1,2})\s*[:.\-\s]?\s*(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

export const MENU = { home: 'm:home', task: 'm:task', taskRun: 'm:taskrun', sessions: 'm:sessions', about: 'm:about' };
const MENU_INLINE = new InlineKeyboard()
  .text('Новая задача', MENU.task)
  .text('Мои задачи', MENU.sessions)
  .row()
  .text('Кто я', MENU.about);

export const BTN = { task: '➕ Задача', sessions: '📂 Мои задачи', about: '❓ Кто я' };

const QUOTA_BTN = /^(💳 |♾ )?(Осталось запросов|Безлимит|Без лимита)/;

export const BOT_NAME = 'Помощник Максим';

const ABOUT = [
  '<b>Я — Максим, помощник продавца на Авито</b>',
  'Помогаю продавцам и онлайн-менеджерам понять свой рынок и продавать больше. Смотрю на Авито глазами покупателя: открываю поиск, читаю объявления конкурентов и разбираюсь, кто сколько просит, кто в топе и почему.',
  '',
  '<b>Чем могу помочь</b>',
  '• <b>Разобрать рынок.</b> Скажите, что и где продаёте, — соберу выдачу и покажу цены, лидеров и долю платного продвижения. Цифры в таблицах я считаю по реальным объявлениям, а не придумываю.',
  '• <b>Следить за конкурентами по расписанию.</b> Напишите, например, <i>«каждый день в 21:00 собирай статистику по диванам в Москве»</i> — и в это время я сам соберу выдачу и пришлю отчёт: кто поднимал объявления, у кого какое продвижение, кто вырос и упал, кто поменял цену. Поменять или отключить — тоже словами.',
  '• <b>Написать объявление.</b> Предложу заголовок и описание с учётом того, как пишут конкуренты и по каким словам ищут покупатели.',
  '• <b>Подобрать цену.</b> Назову цену и коридор, объясню, как продать быстрее и за счёт чего можно стоить дороже рынка.',
  '• <b>Проверить объявление.</b> Найду, что мешает продажам, и предложу конкретные правки.',
  '• <b>Ответить покупателю.</b> Подготовлю вежливый ответ, который ведёт к сделке.',
  '',
  '<b>Как со мной работать</b>',
  'Каждая задача — отдельный разговор, как чат. Я помню всё, что мы в нём обсуждали, поэтому можно просто уточнять: <i>«а в Казани?»</i>, <i>«почему у лидеров дороже?»</i>, <i>«сделай короче»</i>. Вернуться к любой задаче можно через «Мои задачи» — там же видно, готова ли работа.',
  '',
  '<b>Чего я не делаю</b>',
  'Не накручиваю просмотры и не обманываю площадку — ваши аккаунты в безопасности. Если данных мало или Авито не пустил меня в поиск, я скажу об этом прямо, а не стану гадать.',
].join('\n');

const INTRO = [
  `<b>${BOT_NAME}</b>`,
  'Привет! Я Максим, помогаю продавцам на Авито: захожу в поиск, собираю объявления конкурентов и отвечаю — цены, лидеры, что делать.',
  '',
  '<b>Как работать</b>',
  '1. Создайте задачу — это отдельный чат, я помню всё, что в нём обсуждали.',
  '2. Напишите, что узнать: <i>«сколько стоят диваны в Москве и кто лидеры»</i>.',
  '3. Уточняйте: <i>«а в Казани?»</i>, <i>«почему у лидеров дороже?»</i>, <i>«напиши объявление под этот рынок»</i>.',
  '',
  'Ещё могу каждый день в нужное время собирать статистику по конкурентам (<i>«каждый вечер в 21:00 собирай статистику»</i>), подобрать цену, проверить объявление и ответить покупателю — просто попросите словами.',
].join('\n');

const TOOL_NAMES = ['write', 'price', 'audit', 'reply', 'chat'];

export const STATUS = { new: 'Новая', running: 'В работе', done: 'Готово', error: 'Ошибка', stopped: 'Остановлено' };
const KIND = { watch: 'Замер рынка', market: 'Анализ рынка', more: 'Догрузка выдачи', link: 'Анализ по ссылке', paste: 'Вставка выдачи', write: 'Текст объявления', price: 'Подбор цены', audit: 'Проверка объявления', reply: 'Ответ покупателю', chat: 'Вопрос по задаче' };
const DEFAULT_NAME = /^Задача \d+$/;

export function startBot({
  store,
  token,
  publicUrl = '',
  allowedUsers = [],
  botInfo,
  plan = defaultPlan,
  answer = defaultAnswer,
  parsePage = parseIntoReport,
  fetchPages = fetchIntoReport,
  toolset = defaultTools,
  insights = generateInsights,
  summarize = summarizeWatch,
  fetchDetails = fetchDetailsIntoReport,
  buildExcel = buildWorkbook,
  now = () => new Date(),
  alertTo = [...ADMINS],
  docs = null,

  autoViews = process.env.AVITO_AUTO_VIEWS !== '0',
  autoViewsLimit = Math.max(1, Number(process.env.AVITO_AUTO_VIEWS_LIMIT) || 30),
}) {
  const bot = new Bot(token, botInfo ? { botInfo } : undefined);
  const allowed = new Set(allowedUsers);
  const pending = new Map();
  const queues = new Map();
  const lastTool = new Map();
  const generating = new Map();

  bot.on('stopped_message_generation', (ctx) => {
    const s = ctx.update.stopped_message_generation;
    generating.get(`${s.chat.id}:${s.draft_id}`)?.abort();
  });

  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== 'private') return;
    if (allowed.size && !allowed.has(ctx.from?.id)) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery();
      return ctx.reply(`Нет доступа. Ваш id: ${ctx.from?.id} — передайте его администратору.`);
    }
    await next();
  });

  const onButton = (trigger, handler) =>
    bot.callbackQuery(trigger, async (ctx) => {
      await ctx.answerCallbackQuery().catch(() => {});
      await handler(ctx);
    });

  const enqueue = (chatId, job) => {
    const run = (queues.get(chatId) || Promise.resolve()).then(job).catch((err) => console.error('bot job:', err));
    queues.set(chatId, run);
    return run;
  };

  const activeReport = (userId) => {
    const id = store.getUser(userId).activeReport;
    const r = id && store.getReport(id);
    return r && r.ownerId === userId ? r : null;
  };

  async function sendRich(ctx, markdown, kb, fallbackHtml) {
    try {
      await ctx.api.sendRichMessage(ctx.chat.id, { markdown }, kb ? { reply_markup: kb } : {});
    } catch (err) {
      console.error('rich message не прошёл, шлю HTML:', err.description || err.message);
      await sendLong(ctx, fallbackHtml ?? markdownToTelegram(markdown), kb);
    }
  }

  async function streamAnswer(ctx, { thinking, generate, build, fallback, kb }) {
    const chatId = ctx.chat.id;
    const draftId = 1 + Math.floor(Math.random() * 2_000_000_000);
    const key = `${chatId}:${draftId}`;
    const controller = new AbortController();
    generating.set(key, controller);

    let inFlight = null;
    let queued = null;
    let done = false;
    let lastSent = 0;
    let latest = '';
    const pushDraft = (markdown) => {
      if (done) return;
      if (inFlight) {
        queued = markdown;
        return;
      }
      inFlight = ctx.api
        .sendRichMessageDraft(chatId, draftId, { markdown }, { can_stop: true })
        .catch(() => {})
        .finally(() => {
          inFlight = null;
          if (queued) {
            const q = queued;
            queued = null;
            pushDraft(q);
          }
        });
    };

    pushDraft(`<tg-thinking>${thinking}</tg-thinking>`);
    const onText = (snapshot) => {
      latest = snapshot;
      const now = Date.now();
      if (now - lastSent >= 600) {
        lastSent = now;
        pushDraft(snapshot);
      }
    };

    let text = '';
    let stopped = false;
    try {
      text = await generate({ onText, signal: controller.signal });
    } catch (err) {
      if (!controller.signal.aborted) throw err;
      stopped = true;
      text = latest;
    } finally {
      generating.delete(key);
      done = true;
      queued = null;
      await inFlight;
    }
    const markdown = build(text, stopped);
    await sendRich(ctx, markdown, kb, fallback?.(text, stopped));
    return { markdown, stopped, text };
  }

  const niceError = (err) => {
    if (err.status === 400 || err.status === 422 || err.status === 423 || err.status === 501) return err.message;
    if (!err.status) return 'Не удалось открыть страницу Авито. Проверьте запрос или попробуйте позже.';
    return humanError(err);
  };

  async function reportLink(reportId) {
    const report = store.getReport(reportId);
    if (!docs?.enabled || !report || !Object.keys(report.items).length) return null;
    try {
      return (await docs.publish(report, { now: now() })).url;
    } catch (err) {
      console.error('онлайн-отчёт:', err.message);
      return null;
    }
  }
  const latestLink = (reportId) => (docs?.enabled ? docs.latest(reportId)?.url || null : null);
  const dataButtons = (kb, url, table = 'table') => (url ? kb.url('Открыть отчёт', url) : kb.text('CSV', 'csv').text('Таблица', table));
  const resultKb = (url) => dataButtons(new InlineKeyboard(), url).row().text('Ещё страницы', 'more');

  const userLimit = (userId) => {
    if (isAdmin(userId)) return Infinity;
    const q = store.getUser(userId).quota;
    const lim = Number.isFinite(q) ? q : REQUEST_LIMIT;
    return lim > 0 ? lim : Infinity;
  };
  const remaining = (userId) => {
    const l = userLimit(userId);
    return l === Infinity ? null : Math.max(0, l - (store.getUser(userId).used || 0));
  };
  const limitMsg = 'Лимит запросов исчерпан. Обратитесь к администратору, чтобы пополнить.';

  function spend(userId) {
    const l = userLimit(userId);
    if (l === Infinity) return true;
    const used = store.getUser(userId).used || 0;
    if (used >= l) return false;
    store.updateUser(userId, { used: used + 1 });
    return true;
  }

  const sessionCount = (userId) => store.listReports(userId).length;

  const quotaLabel = (userId) => {
    if (isAdmin(userId)) return 'Безлимит';
    const r = remaining(userId);
    return r == null ? 'Без лимита' : `Осталось запросов: ${r}`;
  };
  const quotaKb = (userId) => new Keyboard().text(quotaLabel(userId)).resized().persistent();

  const fmtTime = (iso) =>
    iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  const nowTime = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const statusOf = (r) => r.runs?.at(-1)?.status || 'new';
  const cut = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
  const isMarketRun = (run) => ['market', 'more', 'link', 'watch'].includes(run.kind);

  function menuFooter(userId) {
    const lines = [];
    const active = activeReport(userId);
    if (active) lines.push(`Открыта задача: <b>${esc(active.name)}</b> — пишите запрос, он пойдёт в неё.`);
    if (isAdmin(userId)) lines.push('Запросов: <b>безлимит</b>');
    else if (remaining(userId) != null) lines.push(`Осталось запросов: <b>${remaining(userId)}</b>`);
    return lines.length ? `\n\n${lines.join('\n')}` : '';
  }

  const toCard = (reportId) => new InlineKeyboard().text('Назад к задаче', `use:${reportId}`);

  const screens = {
    home: (userId) => ({ text: INTRO + menuFooter(userId), kb: MENU_INLINE }),

    about: (userId) => ({ text: ABOUT + menuFooter(userId), kb: new InlineKeyboard().text('Меню', MENU.home) }),

    created: (report) => ({
      text: `<b>${esc(report.name)}</b> создана — это новый чат.\n\nНапишите, что нужно сделать — например: <i>«сколько стоят диваны в Москве и кто лидеры»</i>. Я буду помнить весь разговор в этой задаче, так что дальше можно просто уточнять.`,
      kb: new InlineKeyboard().text('Мои задачи', MENU.sessions).text('Меню', MENU.home),
    }),

    sessions: (userId) => {
      const list = store.listReports(userId);
      const current = store.getUser(userId).activeReport;
      const kb = new InlineKeyboard();
      for (const r of list.slice(0, 20)) {
        kb.text(`${cut(r.name, 36)} — ${STATUS[r.status]}${r.id === current ? ' (открыта)' : ''}${r.itemCount ? ' · ' + r.itemCount : ''}`, `use:${r.id}`).row();
      }
      kb.text('Новая задача', MENU.task).text('Меню', MENU.home);
      const text = list.length ? '<b>Мои задачи</b>\nНажмите задачу, чтобы открыть её.' : '<b>Мои задачи</b>\nЗадач пока нет — создайте первую.';
      return { text, kb };
    },

    card: (report) => {
      const runs = report.runs || [];
      const last = runs.at(-1);
      const status = statusOf(report);
      const n = Object.keys(report.items).length;
      const lines = [`<b>${esc(report.name)}</b>`, `Статус: <b>${STATUS[status]}</b>`];
      if (last) {
        lines.push(`Последний запрос: «${esc(cut(last.question, 120))}»`);
        lines.push(`${KIND[last.kind] || 'Запрос'} · ${fmtTime(last.startedAt)}${last.finishedAt ? ' → ' + fmtTime(last.finishedAt) : ''}`);
        if (last.status === 'error' && last.error) lines.push(`Причина: ${esc(cut(last.error, 200))}`);
        lines.push(`Запросов в задаче: ${runs.length} (готово ${runs.filter((x) => x.status === 'done').length})`);
      } else {
        lines.push('Запросов ещё не было — напишите, что нужно сделать.');
      }
      if (n) lines.push(`Объявлений собрано: ${n}`);
      const times = report.schedule?.times || [];
      if (times.length && report.marketUrl) lines.push(`Замеры по расписанию: каждый день в ${times.join(', ')} (МСК)`);
      if (status === 'running') lines.push('\nРабота ещё идёт — результат придёт в чат, когда будет готов.');

      const lastReply = [...(report.chat || [])].reverse().find((m) => m.role === 'assistant');
      if (lastReply) {
        const plain = lastReply.text.replace(/\[Данные выдачи:[^\]]*\]/, '').replace(/[#*_>`|-]+/g, ' ').replace(/\s+/g, ' ').trim();
        lines.push(`Последний ответ: «${esc(cut(plain, 220))}»`);
      }
      lines.push('\nЧат открыт — продолжайте писать, я помню весь разговор в этой задаче.');

      lines.push(`<i>Проверено в ${nowTime()}</i>`);

      const kb = new InlineKeyboard();
      const lastResult = [...runs].reverse().find((x) => x.result);
      if (lastResult) kb.text('Результат', `res:${report.id}:${lastResult.id}`);
      if (runs.length) kb.text('История', `hist:${report.id}`);
      kb.row();
      if (n && docs?.enabled) {
        const link = latestLink(report.id);
        (link ? kb.url('Открыть отчёт', link) : kb.text('Открыть отчёт', `doc:${report.id}`)).row();
      } else if (n) kb.text('CSV', 'csv').text('Таблица', `ctbl:${report.id}`).text('Excel', `xls:${report.id}`).row();
      kb.text('Расписание', `sch:${report.id}`).text('Обновить статус', `use:${report.id}`).row();
      kb.text('Мои задачи', MENU.sessions).text('Меню', MENU.home);
      return { text: lines.join('\n'), kb };
    },

    schedule: (report) => {
      const sc = { times: [], pages: 2, ...report.schedule };
      const lines = [`<b>Расписание: ${esc(report.name)}</b>`];
      if (!report.marketUrl) {
        lines.push(
          '',
          'В этой задаче ещё не было поиска на Авито. Сначала напишите, что и где смотреть, например <i>«диваны в Москве»</i>, — расписание будет повторять этот поиск.',
        );
        return { text: lines.join('\n'), kb: toCard(report.id) };
      }
      const query = report.pages.at(-1)?.title;
      lines.push(`Поиск: ${esc(query || cut(report.marketUrl, 80))}`);
      lines.push(`Замеры каждый день по Москве: <b>${sc.times.length ? sc.times.join(', ') : 'не настроены'}</b>`);
      lines.push(`Глубина: ${sc.pages} стр. выдачи (до ${sc.pages * 50} объявлений)`);
      const lastSnap = store.getSnapshots(report.id).at(-1);
      if (lastSnap) lines.push(`Последний замер: ${stamp(lastSnap.at)}`);
      lines.push(
        '',
        'В назначенное время я сам открою этот поиск, соберу выдачу и пришлю отчёт: конкуренты, виды продвижения, кто поднимал объявления сегодня, кто вырос и упал в выдаче, кто поменял цену — в сравнении с прошлым замером. Один замер — один запрос.',
        '',
        'Нажмите время, чтобы включить или выключить его, или просто напишите мне: <i>«каждый день в 20:30»</i>, <i>«убери утренний замер»</i>.',
      );

      const kb = new InlineKeyboard();
      const all = [...new Set([...SCHEDULE_PRESETS, ...sc.times])].sort();
      all.forEach((t, i) => {
        kb.text(sc.times.includes(t) ? `${t} — вкл` : t, `scht:${report.id}:${t.replace(':', '')}`);
        if (i % 3 === 2) kb.row();
      });
      kb.row().text('Своё время', `schc:${report.id}`).text(`Страниц: ${sc.pages}`, `schp:${report.id}`).row();
      kb.text('Замерить сейчас', `schn:${report.id}`);
      if (sc.times.length) kb.text('Выключить всё', `scho:${report.id}`);
      kb.row().text('Назад к задаче', `use:${report.id}`);
      return { text: lines.join('\n'), kb };
    },

    history: (report) => {
      const runs = (report.runs || []).slice(-10).reverse();
      const kb = new InlineKeyboard();
      for (const run of runs) {
        const label = `${STATUS[run.status]} · ${fmtTime(run.startedAt)} · ${cut(run.question, 30)}`;
        kb.text(label, run.result ? `res:${report.id}:${run.id}` : `use:${report.id}`).row();
      }
      kb.text('Назад к задаче', `use:${report.id}`);
      const text = runs.length
        ? `<b>История: ${esc(report.name)}</b>\nНажмите запрос, чтобы открыть результат.`
        : `<b>История: ${esc(report.name)}</b>\nВ задаче пока нет запросов.`;
      return { text, kb };
    },

    result: (report, run) => {
      const kb = toCard(report.id);
      if (isMarketRun(run) && Object.keys(report.items).length) dataButtons(kb.row(), latestLink(report.id), `ctbl:${report.id}`);
      const head = `**${STATUS[run.status]}** · ${fmtTime(run.finishedAt)} · «${md(cut(run.question, 80))}»`;
      return { rich: `${head}\n\n---\n\n${run.result}`, kb };
    },

    table: (report) => ({ rich: listingsMarkdown(report), kb: toCard(report.id) }),
  };

  async function show(ctx, screen) {
    const extra = { reply_markup: screen.kb };
    const msg = ctx.callbackQuery?.message;
    if (msg) {
      try {
        if (screen.rich) await ctx.api.editMessageText(ctx.chat.id, msg.message_id, undefined, { rich_message: { markdown: screen.rich }, ...extra });
        else await ctx.api.editMessageText(ctx.chat.id, msg.message_id, screen.text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });
        store.updateUser(ctx.from.id, { menuMsgId: msg.message_id });
        return msg.message_id;
      } catch (err) {
        if (/not modified/i.test(err.description || err.message || '')) return msg.message_id;
        console.error('экран не перерисован, шлю новым сообщением:', err.description || err.message);
      }
    }
    let sent;
    if (screen.rich) {
      sent = await ctx.api.sendRichMessage(ctx.chat.id, { markdown: screen.rich }, extra).catch((err) => {
        console.error('rich message не прошёл, шлю HTML:', err.description || err.message);
        return ctx.reply(markdownToTelegram(screen.rich).slice(0, TG_LIMIT), { parse_mode: 'HTML', ...extra });
      });
    } else {
      sent = await ctx.reply(screen.text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });
    }
    store.updateUser(ctx.from.id, { menuMsgId: sent.message_id });
    return sent.message_id;
  }

  async function openHome(ctx) {
    if (ctx.message) ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {});
    const prev = store.getUser(ctx.from.id).menuMsgId;
    if (prev) ctx.api.deleteMessage(ctx.chat.id, prev).catch(() => {});
    await show(ctx, screens.home(ctx.from.id));
  }

  async function showStart(ctx) {
    console.log(`/start от пользователя ${ctx.from.id}${ctx.from.username ? ` (@${ctx.from.username})` : ''}`);
    await openHome(ctx);
  }

  async function newTask(ctx, { silent = false } = {}) {
    const n = sessionCount(ctx.from.id) + 1;
    const created = store.createReport(`Задача ${n}`, ctx.from.id);
    store.updateUser(ctx.from.id, { activeReport: created.id, pendingText: null });
    const report = store.getReport(created.id);
    if (!silent) await show(ctx, screens.created(report));
    return report;
  }

  async function askForTask(ctx, pendingText) {
    store.updateUser(ctx.from.id, { pendingText: pendingText ?? null });
    const kb = new InlineKeyboard();
    if (pendingText) kb.text('Создать задачу и выполнить', MENU.taskRun).row();
    kb.text('Пустая задача', MENU.task).text('Мои задачи', MENU.sessions);
    await show(ctx, { text: 'Сначала создайте задачу — так результат сохранится, и вы сможете вернуться к нему в «Мои задачи».', kb });
  }

  function remember(reportId, userText, assistantText) {
    store.addChat(reportId, 'user', userText);
    store.addChat(reportId, 'assistant', assistantText);
  }

  function marketMemo(reportId, text, stopped) {
    const s = analyze(store.getReport(reportId));
    const u = s.units[0];
    const facts = [
      `собрано ${s.count} объявлений${s.totalOnSite ? ` из ${s.totalOnSite}` : ''}`,
      u ? `медиана ${Math.round(u.median)} ₽ ${u.unit} (половина в ${Math.round(u.p25)}–${Math.round(u.p75)} ₽)` : null,
      `продвинуто ${Math.round(s.shares.promoted * 100)}%`,
      s.query ? `выдача: ${s.query}` : null,
    ].filter(Boolean);
    return `${text || ''}${stopped ? '\n\n(ответ остановлен пользователем)' : ''}\n\n[Данные выдачи: ${facts.join('; ')}]`.trim();
  }

  function nameTask(reportId, name) {
    const r = store.getReport(reportId);
    if (r && DEFAULT_NAME.test(r.name)) store.renameReport(reportId, cut(name, 60));
  }

  async function startStatus(ctx, text) {
    const userId = ctx.from.id;
    const label = quotaLabel(userId);
    if (store.getUser(userId).kbLabel !== label) {
      await ctx.reply(isAdmin(userId) || label === 'Без лимита' ? 'Запросы: без лимита.' : `${label}.`, { reply_markup: quotaKb(userId) }).catch(() => {});
      store.updateUser(userId, { kbLabel: label });
    }
    let id = (await ctx.reply(text)).message_id;
    return async (next) => {
      try {
        await ctx.api.editMessageText(ctx.chat.id, id, next);
      } catch (err) {
        if (/not modified/i.test(err.description || err.message || '')) return;
        console.error('статус не изменился, шлю новым сообщением:', err.description || err.message);
        const m = await ctx.reply(next).catch(() => null);
        if (m) id = m.message_id;
      }
    };
  }

  async function doMarket(ctx, { reportId, runId, url, pages, question, reportName, userText, history = [] }) {
    const userId = ctx.from.id;
    nameTask(reportId, reportName);

    if (store.getReport(reportId).marketUrl !== url) store.clearMarket(reportId, url);
    const setStatus = await startStatus(ctx, `Захожу на ${marketName(url)} и собираю выдачу… это может занять до минуты`);
    let r;
    try {
      r = await fetchPages(store, reportId, url, { pages });
    } catch (err) {
      console.error('market:', err);
      store.finishRun(reportId, runId, { status: 'error', error: niceError(err) });
      remember(reportId, userText ?? question, `Не получилось собрать выдачу: ${niceError(err)}`);
      if (err?.banned || err?.status === 423) captchaRelay(url);
      return setStatus(`Ошибка: ${niceError(err)}`);
    }
    alertLayout(r.via, url);
    store.updateUser(userId, { lastSearch: { url, nextPage: pages + 1, question, reportId } });
    await setStatus(`Собрал ${r.found} объявлений, анализ ниже.`);
    const link = await deliverMarket(ctx, { question, reportId, runId, history, userText: userText ?? question }, `Собрал ${r.found} объявлений, анализирую рынок…`);
    if (supportsViews(url)) backgroundViews(ctx, reportId, link);
  }

  async function deliverMarket(ctx, { question, reportId, runId, history, userText }, thinking) {
    const link = await reportLink(reportId);
    try {
      const { markdown, stopped, text } = await streamAnswer(ctx, {
        thinking,
        generate: (o) => answer(question, store.getReport(reportId), { ...o, history }),
        build: (text, s) => marketMarkdown(text, store.getReport(reportId), { stopped: s }),
        fallback: (text) => markdownToTelegram(text),
        kb: resultKb(link),
      });
      store.finishRun(reportId, runId, { status: stopped ? 'stopped' : 'done', result: markdown });
      remember(reportId, userText, marketMemo(reportId, text, stopped));
      return link;
    } catch (err) {
      console.error('answer:', err);
      store.finishRun(reportId, runId, { status: 'error', error: humanError(err) });
      remember(reportId, userText, `Не получилось ответить: ${humanError(err)}`);
      await ctx.reply(`Ошибка: ${esc(humanError(err))}`, { parse_mode: 'HTML' });
    }
  }

  const viewsRunning = new Set();
  function backgroundViews(ctx, reportId, link) {
    if (!autoViews || !link || viewsRunning.has(reportId)) return null;
    viewsRunning.add(reportId);
    return (async () => {
      const setStatus = await startStatus(ctx, 'Открываю объявления за просмотрами — пара минут, отчёт по кнопке «Открыть отчёт» обновится сам.');
      let shown = 0;
      const det = await fetchDetails(store, reportId, {
        limit: autoViewsLimit,
        onProgress: (i, n) => {
          if (Date.now() - shown < 8000 && i !== n) return;
          shown = Date.now();
          setStatus(`Открываю объявления за просмотрами — ${i} из ${n}…`);
        },
      });
      const token = docs?.enabled ? docs.latest(reportId)?.token : null;
      const updated = token && det.got ? await docs.update(token, store.getReport(reportId), { now: now() }) : null;
      if (!det.got) return setStatus('Просмотры собрать не удалось: Авито сейчас ограничил открытие объявлений. Остальные данные в отчёте есть.');
      const note = det.blocked ? ` Авито ограничил открытие объявлений — просмотры есть у ${det.got} из ${det.total}.` : '';
      await setStatus(`Просмотры собраны по ${det.got} объявлениям${updated ? ' — отчёт по кнопке «Открыть отчёт» обновлён' : ''}.${note}`);
    })()
      .catch((err) => console.error('просмотры:', err))
      .finally(() => viewsRunning.delete(reportId));
  }

  async function doMore(ctx) {
    const userId = ctx.from.id;
    const ls = store.getUser(userId).lastSearch;
    const report = ls && store.getReport(ls.reportId);
    if (!report || report.ownerId !== userId) return ctx.reply('Нет активного поиска — напишите, что проанализировать.');
    if (remaining(userId) === 0) return ctx.reply(limitMsg);
    await enqueue(ctx.chat.id, async () => {
      if (!spend(userId)) return ctx.reply(limitMsg);
      const runId = store.addRun(report.id, { kind: 'more', question: ls.question });
      const history = store.getChat(report.id);
      const setStatus = await startStatus(ctx, `Догружаю ещё ${MORE_PAGES} стр. выдачи…`);
      let r;
      try {
        r = await fetchPages(store, report.id, ls.url, { pages: MORE_PAGES, fromPage: ls.nextPage });
      } catch (err) {
        console.error('more:', err);
        store.finishRun(report.id, runId, { status: 'error', error: niceError(err) });
        remember(report.id, 'Догрузи ещё страницы выдачи', `Не получилось: ${niceError(err)}`);
        return setStatus(`Ошибка: ${niceError(err)}`);
      }
      alertLayout(r.via, ls.url);
      store.updateUser(userId, { lastSearch: { ...ls, nextPage: ls.nextPage + MORE_PAGES } });
      await setStatus(`Теперь в задаче ${r.total} объявлений, анализ ниже.`);
      const link = await deliverMarket(
        ctx,
        { question: ls.question, reportId: report.id, runId, history, userText: 'Догрузи ещё страницы выдачи и обнови анализ' },
        `Теперь в задаче ${r.total} объявлений, пересобираю анализ…`,
      );
      backgroundViews(ctx, report.id, link);
    });
  }

  async function runTool(ctx, mode, text, reportId, runId, history = store.getChat(reportId)) {
    const userId = ctx.from.id;
    lastTool.set(userId, { mode, text, reportId });
    nameTask(reportId, text);
    const label = {
      write: ['Пишу объявление', 'Пишу объявление…'],
      price: ['Подбираю цену', 'Подбираю цену…'],
      audit: ['Проверяю объявление', 'Проверяю объявление…'],
      reply: ['Готовлю ответ покупателю', 'Готовлю ответ покупателю…'],
      chat: ['Отвечаю', 'Думаю…'],
    }[mode];
    await startStatus(ctx, `${label[0]}, ответ ниже.`);
    try {
      const { markdown, stopped, text: out } = await streamAnswer(ctx, {
        thinking: label[1],
        generate: async (o) => (await toolset[mode](text, store.getReport(reportId), { ...o, history })).text,
        build: (out, s) => [s ? '_Генерация остановлена — ниже то, что успел написать._' : '', out].filter(Boolean).join('\n\n'),
        fallback: (out) => markdownToTelegram(out),
        kb: new InlineKeyboard().text('Ещё вариант', 'again'),
      });
      store.finishRun(reportId, runId, { status: stopped ? 'stopped' : 'done', result: markdown });
      remember(reportId, text, stopped ? `${out}\n\n(ответ остановлен пользователем)` : out);
    } catch (err) {
      console.error(`tool ${mode}:`, err);
      store.finishRun(reportId, runId, { status: 'error', error: humanError(err) });
      remember(reportId, text, `Не получилось ответить: ${humanError(err)}`);
      await ctx.reply(`Ошибка: ${esc(humanError(err))}`, { parse_mode: 'HTML' });
    }
  }

  async function handleTask(ctx, text) {
    const userId = ctx.from.id;
    const report = activeReport(userId);
    if (!report) return askForTask(ctx, text);

    const user = store.getUser(userId);
    if (user.awaiting === 'city' && user.pendingQuery) {
      store.updateUser(userId, { awaiting: null, pendingQuery: null });
      text = `${user.pendingQuery} в городе ${text}`;
    }
    if (remaining(userId) === 0) return ctx.reply(limitMsg);

    await enqueue(ctx.chat.id, async () => {
      const status = await ctx.reply('Разбираю запрос…');
      const history = store.getChat(report.id);
      let p;
      try {
        p = await plan(text, history);
      } catch (err) {
        console.error('plan:', err);
        return ctx.api.editMessageText(ctx.chat.id, status.message_id, `Ошибка: ${esc(humanError(err))}`);
      }

      if (p.intent === 'market') {
        if (!p.query) return ctx.api.editMessageText(ctx.chat.id, status.message_id, p.clarify || 'Что поискать на Авито?');
        if (!p.citySlug) {
          store.updateUser(userId, { awaiting: 'city', pendingQuery: p.query });
          return ctx.api.editMessageText(ctx.chat.id, status.message_id, p.clarify || `В каком городе смотреть «${p.query}»?`);
        }
        if (!spend(userId)) return ctx.api.editMessageText(ctx.chat.id, status.message_id, limitMsg);
        await ctx.api.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});
        const runId = store.addRun(report.id, { kind: 'market', question: text });
        const name = `${p.query}${p.cityName ? ', ' + p.cityName : ''}`;
        await doMarket(ctx, { reportId: report.id, runId, url: searchUrl(p.citySlug, p.query), pages: p.pages, question: text, reportName: name, history });
        return;
      }

      if (p.intent === 'schedule') {
        await ctx.api.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});
        return applySchedule(ctx, report, p, text);
      }

      if (TOOL_NAMES.includes(p.intent)) {
        if (!spend(userId)) return ctx.api.editMessageText(ctx.chat.id, status.message_id, limitMsg);
        await ctx.api.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});
        const runId = store.addRun(report.id, { kind: p.intent, question: text });
        return runTool(ctx, p.intent, text, report.id, runId, history);
      }

      await ctx.api.editMessageText(
        ctx.chat.id,
        status.message_id,
        p.clarify || 'Напишите, что нужно — например: «сколько стоят диваны в Москве». Я соберу рынок и отвечу.',
      );
    });
  }

  async function fetchLink(ctx, url) {
    const report = activeReport(ctx.from.id);
    if (!report) return askForTask(ctx, url);
    if (remaining(ctx.from.id) === 0) return ctx.reply(limitMsg);
    await enqueue(ctx.chat.id, async () => {
      if (!spend(ctx.from.id)) return ctx.reply(limitMsg);
      const runId = store.addRun(report.id, { kind: 'link', question: url });
      await doMarket(ctx, {
        reportId: report.id,
        runId,
        url,
        pages: LINK_PAGES,
        question: 'Сделай общий анализ этого рынка: цены, конкуренты, совет.',
        reportName: 'Анализ по ссылке',
        userText: `Проанализируй выдачу по ссылке: ${url}`,
        history: store.getChat(report.id),
      });
    });
  }

  async function processPage(ctx, text) {
    const report = activeReport(ctx.from.id);
    if (!report) return askForTask(ctx, text);
    const runId = store.addRun(report.id, { kind: 'paste', question: 'Вставленная страница выдачи' });
    nameTask(report.id, `Вставка ${new Date().toLocaleDateString('ru-RU')}`);
    const page = report.pages.reduce((m, p) => Math.max(m, p.page), 0) + 1;
    const status = await ctx.reply('Разбираю вставленную страницу…');
    try {
      const r = await parsePage(store, report.id, text, page);
      const msg = `Добавлено ${r.found}, новых ${r.added}. В задаче всего ${r.total}.`;
      store.finishRun(report.id, runId, { status: 'done', result: msg });
      remember(report.id, 'Вставил страницу выдачи Авито', msg);
      await ctx.api.editMessageText(ctx.chat.id, status.message_id, `${msg}\n\nМожно вставить ещё страницу или спросить про этот рынок словами.`, {
        reply_markup: dataButtons(new InlineKeyboard(), await reportLink(report.id)),
      });
    } catch (err) {
      console.error('paste:', err);
      store.finishRun(report.id, runId, { status: 'error', error: humanError(err) });
      await ctx.api.editMessageText(ctx.chat.id, status.message_id, `Ошибка: ${esc(humanError(err))}`);
    }
  }

  async function sendCsv(ctx) {
    const report = activeReport(ctx.from.id);
    if (!report || !Object.keys(report.items).length) return ctx.reply('Пока нечего выгружать — сначала соберите рынок.');
    await ctx.replyWithDocument(new InputFile(Buffer.from(toCsv(report), 'utf8'), `avito-${report.id}.csv`), {
      caption: 'Все объявления — открывается в Excel',
    });
  }

  async function sendTable(ctx) {
    const report = activeReport(ctx.from.id);
    if (!report || !Object.keys(report.items).length) return ctx.reply('Пока нет данных для таблицы — сначала соберите рынок.');
    try {
      await ctx.api.sendRichMessage(ctx.chat.id, { markdown: listingsMarkdown(report) });
    } catch (err) {
      console.error('rich table не прошла, шлю моноширинную:', err.description || err.message);
      for (const block of listingTable(report)) {
        await ctx.reply(block, { parse_mode: 'HTML' });
      }
    }
  }

  const alerted = new Map();
  function alertLayout(via, url) {
    if (!via || via === 'dom') return;
    if (Date.now() - (alerted.get(via) || 0) < 6 * 3600_000) return;
    alerted.set(via, Date.now());
    const how = via === 'ai' ? 'нейросеть прочитала текст страницы' : 'объявления взяты из данных страницы';
    const text = `Внимание: Авито поменял вёрстку выдачи. Сбор работает запасным способом (${how}), отчёты верные, но разбор вёрстки стоит обновить.\n${url}`;
    for (const id of alertTo) bot.api.sendMessage(id, text, { link_preview_options: { is_disabled: true } }).catch(() => {});
  }

  let captchaBusy = false;
  async function captchaRelay(url) {
    if (captchaBusy || !alertTo.length) return;
    captchaBusy = true;
    try {
      const token = await startCaptchaSession(url, { waitMs: CAPTCHA_WAIT_MS });
      const link = `${CAPTCHA_PUBLIC_URL}/captcha/${token}`;
      const ask = `🧩 Авито просит капчу. Открой ссылку и пройди проверку — дальше соберу сам:\n${link}\n\nЗапрос: ${url}`;
      for (const id of alertTo) bot.api.sendMessage(id, ask, { link_preview_options: { is_disabled: true } }).catch(() => {});
      let solved = false;
      let wall = false;
      for (;;) {
        const sx = getCaptchaSession(token);
        if (!sx) break;
        if (sx.solved) solved = true;
        if (sx.wall) wall = true;
        await new Promise((r) => setTimeout(r, 3000));
      }
      const fin = solved
        ? '✅ Капча пройдена, пауза снята — повтори запрос, соберу выдачу.'
        : wall
          ? '⌛ Это не капча, а временный блок IP Авито («проблема с IP») — проходить нечего. Подожди ~30 мин и повтори запрос.'
          : '⌛ Капча не пройдена вовремя. Повтори запрос и открой ссылку заново.';
      for (const id of alertTo) bot.api.sendMessage(id, fin, { link_preview_options: { is_disabled: true } }).catch(() => {});
    } catch (e) {
      console.error('captcha relay:', e.message);
    } finally {
      captchaBusy = false;
    }
  }

  const chatCtx = (userId) => ({
    chat: { id: userId, type: 'private' },
    from: { id: userId },
    api: bot.api,
    reply: (text, extra) => bot.api.sendMessage(userId, text, extra),
  });

  async function runWatch(ctx, reportId, slot = null) {
    const report = store.getReport(reportId);
    if (!report?.marketUrl) return;
    const userId = report.ownerId;
    const url = report.marketUrl;
    const label = slot ? `Замер по расписанию ${slot}` : 'Замер рынка';
    if (!spend(userId)) return ctx.reply(`${label} «${report.name}» пропущен. ${limitMsg}`);
    const runId = store.addRun(reportId, { kind: 'watch', question: label });
    const setStatus = await startStatus(ctx, `${label} «${cut(report.name, 40)}»: собираю выдачу…`);
    let r;
    try {
      store.clearMarket(reportId, url);
      r = await fetchPages(store, reportId, url, { pages: report.schedule?.pages || 2 });
    } catch (err) {
      console.error('watch:', err);
      store.finishRun(reportId, runId, { status: 'error', error: niceError(err) });
      remember(reportId, label, `Замер не получился: ${niceError(err)}`);
      return setStatus(`${label}: не получилось. ${niceError(err)}`);
    }
    alertLayout(r.via, url);

    let det = null;
    let shown = 0;
    try {
      det = await fetchDetails(store, reportId, {
        onProgress: (i, n) => {
          if (Date.now() - shown < 8000 && i !== n) return;
          shown = Date.now();
          setStatus(`${label} «${cut(report.name, 40)}»: собрал ${r.found} объявлений, открываю каждое за просмотрами — ${i} из ${n}…`);
        },
      });
    } catch (err) {
      console.error('просмотры:', err);
    }

    const fresh = store.getReport(reportId);
    const snap = makeSnapshot(fresh, now());
    const prev = store.getSnapshots(reportId).filter((x) => x.url === url).at(-1);
    store.addSnapshot(reportId, snap);
    const stats = compareSnapshots(snap, prev);
    const viewsNote = !det ? ' Просмотры собрать не удалось.' : det.blocked ? ` Авито ограничил открытие объявлений — просмотры есть у ${det.got} из ${det.total}.` : '';
    await setStatus(`${label}: собрал ${r.found} объявлений${det?.got ? ` и просмотры по ${det.got}` : ''}, ${docs?.enabled ? 'отчёт ниже, таблица — по кнопке «Открыть отчёт»' : 'отчёт и Excel ниже'}.${viewsNote}`);
    let summary = '';
    try {
      summary = await summarize(watchMarkdown(fresh.name, stats));
    } catch (err) {
      console.error('вывод замера:', err.message);
    }
    const markdown = watchMarkdown(fresh.name, stats, { summary });

    const link = await reportLink(reportId);
    const kb = new InlineKeyboard();
    if (link) kb.url('Открыть отчёт', link).row();
    kb.text('Открыть задачу', `use:${reportId}`).text('Расписание', `sch:${reportId}`);
    await sendRich(ctx, markdown, kb);
    if (!link) await sendExcel(ctx, fresh);
    store.finishRun(reportId, runId, { status: 'done', result: markdown });
    remember(reportId, label, watchMemo(stats));
  }

  async function sendExcel(ctx, report) {
    try {
      const buf = await buildExcel(report, { now: now() });
      await ctx.api.sendDocument(ctx.chat.id, new InputFile(buf, excelName(report, now())), {
        caption: 'Excel-отчёт: объявления с просмотрами, конкуренты, публикации и поднятия по датам и часам.',
      });
    } catch (err) {
      console.error('excel:', err);
      await ctx.reply('Excel-файл собрать не получилось — данные есть в отчёте выше и по кнопке CSV.');
    }
  }

  function tick(at = now()) {
    const today = dayKey(at);
    const nowMin = toMin(hhmm(at));
    const jobs = [];
    for (const r of store.listScheduled()) {
      if (allowed.size && !allowed.has(r.ownerId)) continue;
      for (const t of r.schedule.times) {
        const slot = `${today} ${t}`;
        const late = nowMin - toMin(t);
        if (late < 0 || late > SLOT_GRACE_MIN || r.schedule.done?.includes(slot)) continue;
        store.setSchedule(r.id, { done: [...(r.schedule.done || []), slot] });
        jobs.push(enqueue(r.ownerId, () => runWatch(chatCtx(r.ownerId), r.id, t)));
      }
    }
    return jobs;
  }

  async function applySchedule(ctx, report, p, text) {
    const say = async (html) => {
      await ctx.reply(html, { parse_mode: 'HTML' });
      remember(report.id, text, html.replace(/<[^>]+>/g, ''));
    };

    if (p.query && !p.citySlug) return say(esc(p.clarify || `В каком городе смотреть «${p.query}»?`));
    if (p.query && p.citySlug) {
      const url = searchUrl(p.citySlug, p.query);
      if (url !== report.marketUrl) store.clearMarket(report.id, url);
      nameTask(report.id, `${p.query}${p.cityName ? ', ' + p.cityName : ''}`);
    }
    const r = store.getReport(report.id);
    const action = p.scheduleAction || 'show';
    const sc = { times: [], pages: 2, ...r.schedule };
    const where = r.pages.at(-1)?.title || (p.query ? `${p.query}${p.cityName ? ', ' + p.cityName : ''}` : '');

    if (!r.marketUrl && action !== 'off') {
      return say('Что и где собирать? Напишите, например: <i>«каждый день в 21:00 собирай статистику по диванам в Москве»</i>.');
    }
    if (action === 'now') return runWatch(chatCtx(ctx.from.id), r.id);

    const asked = (p.times || []).map(parseTime).filter(Boolean);
    if ((action === 'set' || action === 'add') && !asked.length) {
      return say(esc(p.clarify || 'Во сколько запускать замеры? Например: «каждый день в 21:00».'));
    }
    let times = sc.times;
    if (action === 'set') times = asked;
    if (action === 'add') times = [...sc.times, ...asked];
    if (action === 'remove') times = sc.times.filter((t) => !asked.includes(t));
    if (action === 'off') times = [];
    times = [...new Set(times)].sort();
    const dropped = times.length > MAX_TIMES;
    times = times.slice(0, MAX_TIMES);
    const pages = p.schedulePages ? Math.max(1, Math.min(5, p.schedulePages)) : sc.pages;
    if (action !== 'show') store.setSchedule(r.id, { times, pages });

    if (!times.length) {
      return say(action === 'off' || action === 'remove'
        ? 'Расписание выключено — замеров по времени больше не будет. Включить снова: напишите, например, <i>«каждый день в 21:00»</i>.'
        : 'Замеров по расписанию пока нет. Напишите, например: <i>«каждый день в 21:00 собирай статистику»</i>.');
    }
    const lines = [
      `${action === 'show' ? 'Сейчас замеры' : 'Готово. Замеры'} <b>${esc(r.name)}</b>${where && where !== r.name ? ` (${esc(where)})` : ''}: каждый день в <b>${times.join(', ')}</b> по Москве, ${pages} стр. выдачи.`,
      'В это время я сам соберу выдачу, открою каждое объявление за просмотрами и пришлю отчёт и Excel-файл: конкуренты, их продвижение и просмотры, кто поднимал объявления за день, кто вырос и упал, кто поменял цену — в сравнении с прошлым замером. Замер занимает несколько минут.',
    ];
    if (dropped) lines.push(`Больше ${MAX_TIMES} замеров в день не ставлю — оставил первые ${MAX_TIMES}.`);
    if (!store.getSnapshots(r.id).length) lines.push('Нужен отчёт прямо сейчас — напишите <i>«замерь сейчас»</i>.');
    return say(lines.join('\n\n'));
  }

  function toggleTime(report, t) {
    const times = report.schedule?.times || [];
    if (times.includes(t)) return store.setSchedule(report.id, { times: times.filter((x) => x !== t) });
    if (times.length >= MAX_TIMES) return null;
    return store.setSchedule(report.id, { times: [...times, t] });
  }

  bot.command(['start', 'help'], showStart);

  bot.command('captcha', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.reply('Открываю тестовую сессию — сейчас пришлю ссылку на капчу…').catch(() => {});
    captchaRelay('https://www.avito.ru/moskva?q=диван');
  });

  onButton(MENU.home, (ctx) => show(ctx, screens.home(ctx.from.id)));
  onButton(MENU.task, (ctx) => newTask(ctx));
  onButton(MENU.sessions, (ctx) => show(ctx, screens.sessions(ctx.from.id)));
  onButton(MENU.about, (ctx) => show(ctx, screens.about(ctx.from.id)));

  onButton(MENU.taskRun, async (ctx) => {
    const text = store.getUser(ctx.from.id).pendingText;
    const report = await newTask(ctx, { silent: Boolean(text) });
    if (!text) return;
    await show(ctx, { text: `Создал задачу <b>${esc(report.name)}</b> и выполняю ваш запрос.` });
    await routeText(ctx, text);
  });

  bot.hears(QUOTA_BTN, openHome);

  bot.hears([BTN.task, BTN.sessions, BTN.about], openHome);

  onButton('csv', sendCsv);
  onButton('table', sendTable);
  onButton('more', doMore);
  onButton('again', async (ctx) => {
    const last = lastTool.get(ctx.from.id);
    if (!last || !store.getReport(last.reportId)) return ctx.reply('Нечего повторять.');
    if (remaining(ctx.from.id) === 0) return ctx.reply(limitMsg);
    await enqueue(ctx.chat.id, async () => {
      if (!spend(ctx.from.id)) return ctx.reply(limitMsg);
      const runId = store.addRun(last.reportId, { kind: last.mode, question: last.text });
      await runTool(ctx, last.mode, last.text, last.reportId, runId);
    });
  });

  const ownReport = (ctx, id) => {
    const r = store.getReport(id);
    return r && r.ownerId === ctx.from.id ? r : null;
  };

  onButton(/^use:([a-f0-9]+)$/, async (ctx) => {
    const report = ownReport(ctx, ctx.match[1]);
    if (!report) return ctx.reply('Задача не найдена.');
    store.updateUser(ctx.from.id, { activeReport: report.id });
    await show(ctx, screens.card(report));
  });

  onButton(/^hist:([a-f0-9]+)$/, async (ctx) => {
    const report = ownReport(ctx, ctx.match[1]);
    if (!report) return ctx.reply('Задача не найдена.');
    await show(ctx, screens.history(report));
  });

  onButton(/^res:([a-f0-9]+):([a-f0-9]+)$/, async (ctx) => {
    const report = ownReport(ctx, ctx.match[1]);
    const run = report && store.getRun(report.id, ctx.match[2]);
    if (!run?.result) return ctx.reply('Результат не найден.');
    store.updateUser(ctx.from.id, { activeReport: report.id });
    await show(ctx, screens.result(report, run));
  });

  onButton(/^ctbl:([a-f0-9]+)$/, async (ctx) => {
    const report = ownReport(ctx, ctx.match[1]);
    if (!report || !Object.keys(report.items).length) return ctx.reply('Пока нет данных для таблицы.');
    await show(ctx, screens.table(report));
  });

  onButton(/^doc:([a-f0-9]+)$/, async (ctx) => {
    const report = ownReport(ctx, ctx.match[1]);
    if (!report || !Object.keys(report.items).length) return ctx.reply('Пока нечего показать — сначала соберите рынок.');
    if (!(await reportLink(report.id))) return sendExcel(ctx, report);
    await show(ctx, screens.card(store.getReport(report.id)));
  });

  onButton(/^xls:([a-f0-9]+)$/, async (ctx) => {
    const report = ownReport(ctx, ctx.match[1]);
    if (!report || !Object.keys(report.items).length) return ctx.reply('Пока нечего выгружать — сначала соберите рынок.');
    await sendExcel(ctx, report);
  });

  const onSchedule = (prefix, handler) =>
    onButton(new RegExp(`^${prefix}:([a-f0-9]+)(?::(\\d{4}))?$`), async (ctx) => {
      const report = ownReport(ctx, ctx.match[1]);
      if (!report) return ctx.reply('Задача не найдена.');
      store.updateUser(ctx.from.id, { activeReport: report.id, awaiting: null });
      await handler(ctx, report, ctx.match[2]);
    });

  onSchedule('sch', (ctx, report) => show(ctx, screens.schedule(report)));
  onSchedule('scht', async (ctx, report, hm) => {
    const t = parseTime(hm);
    if (t && report.marketUrl && !toggleTime(report, t)) {
      return show(ctx, { text: `Можно не больше ${MAX_TIMES} замеров в день — сначала выключите какое-нибудь время.`, kb: new InlineKeyboard().text('К расписанию', `sch:${report.id}`) });
    }
    await show(ctx, screens.schedule(store.getReport(report.id)));
  });
  onSchedule('schp', async (ctx, report) => {
    const cur = report.schedule?.pages || 2;
    store.setSchedule(report.id, { pages: PAGE_STEPS[(PAGE_STEPS.indexOf(cur) + 1) % PAGE_STEPS.length] });
    await show(ctx, screens.schedule(store.getReport(report.id)));
  });
  onSchedule('scho', async (ctx, report) => {
    store.setSchedule(report.id, { times: [] });
    await show(ctx, screens.schedule(store.getReport(report.id)));
  });

  onSchedule('schc', async (ctx, report) => {
    store.updateUser(ctx.from.id, { awaiting: 'schedTime', awaitingReport: report.id });
    await show(ctx, {
      text: `<b>Своё время замера</b>\nНапишите время по Москве, например <i>20:30</i>. Замер будет каждый день в это время.`,
      kb: new InlineKeyboard().text('Отмена', `sch:${report.id}`),
    });
  });

  onSchedule('schn', async (ctx, report) => {
    if (!report.marketUrl) return show(ctx, screens.schedule(report));
    if (remaining(ctx.from.id) === 0) return ctx.reply(limitMsg);
    await enqueue(ctx.chat.id, () => runWatch(chatCtx(ctx.from.id), report.id));
  });

  async function takeScheduleTime(ctx, msg) {
    const user = store.getUser(ctx.from.id);
    if (user.awaiting !== 'schedTime') return false;
    const report = ownReport(ctx, user.awaitingReport);
    const t = parseTime(msg);
    if (!report || (!t && msg.trim().length > 8)) {
      store.updateUser(ctx.from.id, { awaiting: null, awaitingReport: null });
      return false;
    }
    if (!t) {
      await ctx.reply('Не понял время. Напишите, например, 20:30.');
      return true;
    }
    store.updateUser(ctx.from.id, { awaiting: null, awaitingReport: null });
    const times = report.schedule?.times || [];
    if (!times.includes(t) && !toggleTime(report, t)) {
      await ctx.reply(`Можно не больше ${MAX_TIMES} замеров в день — сначала выключите какое-нибудь время.`);
      return true;
    }

    ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {});
    const prev = store.getUser(ctx.from.id).menuMsgId;
    if (prev) ctx.api.deleteMessage(ctx.chat.id, prev).catch(() => {});
    await show(ctx, screens.schedule(store.getReport(report.id)));
    return true;
  }

  const looksLikePage = (t) =>
    /avito\.ru\/[^\s)]*_\d{6,}/.test(t) || (t.length > 2000 && /₽/.test(t) && /(Написать|Продвинуто|мин\.)/.test(t));

  bot.on('message:document', async (ctx) => {
    const doc = ctx.message.document;
    const name = doc.file_name || '';
    if (!/\.(html?|txt)$/i.test(name) && !/html|text/.test(doc.mime_type || '')) {
      return ctx.reply('Пришлите страницу выдачи файлом .html (Ctrl+S в браузере), ссылку или просто напишите запрос.');
    }
    if (doc.file_size > MAX_FILE_BYTES) return ctx.reply('Файл больше 20 МБ — Telegram не даст его скачать.');
    const file = await ctx.getFile();
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
    if (!res.ok) return ctx.reply('Не удалось скачать файл, попробуйте ещё раз.');
    const raw = await res.text();
    const text = /\.txt$/i.test(name) ? raw : htmlToText(raw);
    await enqueue(ctx.chat.id, () => processPage(ctx, text));
  });

  bot.on('message:text', async (ctx) => {
    const msg = ctx.message.text;
    if (msg.startsWith('/')) return showStart(ctx);
    await routeText(ctx, msg, ctx.message.entities);
  });

  async function routeText(ctx, msg, entities) {
    const trimmed = msg.trim();
    if (ctx.message && (await takeScheduleTime(ctx, trimmed))) return;
    if (/^https?:\/\/\S+$/i.test(trimmed) && isMarketUrl(trimmed)) return fetchLink(ctx, trimmed);

    const part = entitiesToText(msg, entities);

    const buf = pending.get(ctx.chat.id);
    if (buf || (looksLikePage(part) && msg.length >= SPLIT_SUSPECT)) {
      const next = buf || { parts: [] };
      clearTimeout(next.timer);
      next.parts.push(part);
      next.timer = setTimeout(() => {
        pending.delete(ctx.chat.id);
        enqueue(ctx.chat.id, () => processPage(ctx, next.parts.join('\n')));
      }, MERGE_DELAY_MS);
      pending.set(ctx.chat.id, next);
      return;
    }
    if (looksLikePage(part)) return enqueue(ctx.chat.id, () => processPage(ctx, part));

    await handleTask(ctx, trimmed);
  }

  bot.catch((err) => console.error('bot error:', err.error || err));

  return {
    bot,
    tick,
    async start() {
      await bot.api.deleteMyCommands();
      await syncProfile(bot.api);
      setInterval(() => tick(), TICK_MS);
      bot.start({ onStart: (me) => console.log(`Telegram-бот @${me.username} запущен`) });
    },
  };
}

const PROFILE = {
  name: BOT_NAME,
  short:
    'Максим — помощник продавца на Авито: разбирает рынок и конкурентов, подбирает цену, пишет объявления и ответы.',
  description:
    'Привет! Я Максим, помощник продавца на Авито. Скажите, что и где продаёте, — я зайду в поиск, соберу объявления конкурентов и покажу цены, лидеров и что делать. Ещё напишу объявление, подберу цену и помогу ответить покупателю. Нажмите «Начать».',
};

async function syncProfile(api) {
  const steps = [
    [() => api.getMyName(), (r) => r.name, (v) => api.setMyName(v), PROFILE.name],
    [() => api.getMyShortDescription(), (r) => r.short_description, (v) => api.setMyShortDescription(v), PROFILE.short],
    [() => api.getMyDescription(), (r) => r.description, (v) => api.setMyDescription(v), PROFILE.description],
  ];
  for (const [get, pick, set, value] of steps) {
    try {
      if (pick(await get()) !== value) await set(value);
    } catch (err) {
      console.error('профиль бота не обновлён:', err.description || err.message);
    }
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const num = (v) => (v == null ? '—' : Math.round(v).toLocaleString('ru-RU'));
const pct = (v) => `${Math.round(v * 100)}%`;

export function formatSummary(report, s) {
  const lines = [`<b>${esc(report.name)}</b>`];
  if (s.query) lines.push(esc(s.query));
  lines.push(`Собрано: <b>${num(s.count)}</b>${s.totalOnSite ? ` из ${num(s.totalOnSite)}` : ''} · страниц: ${s.pagesCollected}`, '');
  lines.push('<b>Цены</b>');
  for (const u of s.units.slice(0, 4)) {
    lines.push(`• ${esc(u.unit)} (${u.count} шт.): медиана <b>${num(u.median)} ₽</b>, половина в ${num(u.p25)}–${num(u.p75)} ₽`);
  }
  if (!s.units.length) lines.push('• объявлений с ценой нет');
  lines.push('', `<b>Продвижение</b>: ${pct(s.shares.promoted)} · с доставкой: ${pct(s.shares.delivery)}`);
  if (s.sellers.top.length) {
    lines.push('', `<b>Продавцы</b>: ${s.sellers.unique} с профилем, топ-10 держат ${pct(s.sellers.top10Share)} выдачи`);
    s.sellers.top.slice(0, 5).forEach((x, i) => lines.push(`${i + 1}. ${esc(x.name)} — ${x.count} объявл.`));
  }
  return lines.join('\n');
}

const padEnd = (s, n) => { s = String(s); return s.length >= n ? s.slice(0, n - 1) + '…' : s + ' '.repeat(n - s.length); };
const padStart = (s, n) => { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; };

export function listingTable(report, limit = 40) {
  const items = Object.values(report.items).sort((a, b) => a.rank - b.rank).slice(0, limit);
  const header = padStart('#', 3) + ' ' + padEnd('Цена', 11) + '  ' + 'Продавец / товар';
  const sep = '─'.repeat(28);
  const rows = items.map((i) => {
    const price = i.price == null ? '—' : i.price === 0 ? 'беспл.' : `${num(i.price)}₽`;
    const who = i.sellerName || i.title || '';
    return padStart(i.rank, 3) + ' ' + padEnd(price, 11) + (i.promoted ? '* ' : '  ') + esc(who);
  });
  if (!rows.length) return [`<pre>${header}\n(пусто)</pre>`];
  const chunks = [];
  for (let k = 0; k < rows.length; k += 30) {
    chunks.push(`<pre>${[header, sep, ...rows.slice(k, k + 30)].join('\n')}</pre>`);
  }
  return chunks;
}

export function markdownToTelegram(md) {
  return md
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
      let m;
      if ((m = t.match(/^#{1,6}\s+(.*)/))) return `\n<b>${inline(m[1])}</b>`;
      if ((m = t.match(/^[-*•]\s+(.*)/))) return `• ${inline(m[1])}`;
      return inline(t);
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function splitMessage(text, limit = TG_LIMIT) {
  const chunks = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if (cur && cur.length + line.length + 1 > limit) {
      chunks.push(cur);
      cur = '';
    }
    cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

async function sendLong(ctx, html, replyMarkup) {
  const chunks = splitMessage(html);
  for (const [i, chunk] of chunks.entries()) {
    await ctx.reply(chunk, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(i === chunks.length - 1 && replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }
}
