import { askClaudeJSON, askClaudeStream } from './claude.js';
import { analyze } from './analytics.js';
import { viewStats } from './ai.js';
import { marketContext } from './tools.js';
import { toMessages, transcript } from './dialog.js';

const nullable = (t) => ({ anyOf: [{ type: t }, { type: 'null' }] });

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'cityName', 'citySlug', 'query', 'pages', 'clarify', 'scheduleAction', 'times', 'schedulePages'],
  properties: {
    intent: { type: 'string', enum: ['market', 'schedule', 'write', 'price', 'audit', 'reply', 'chat', 'unclear'] },
    cityName: nullable('string'),
    citySlug: nullable('string'),
    query: nullable('string'),
    pages: { type: 'integer' },
    clarify: nullable('string'),
    scheduleAction: { anyOf: [{ type: 'string', enum: ['set', 'add', 'remove', 'off', 'show', 'now'] }, { type: 'null' }] },
    times: { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }] },
    schedulePages: nullable('integer'),
  },
};

const PLAN_SYSTEM = `Ты разбираешь сообщение продавца к боту-помощнику по Авито и решаешь, что он хочет. Верни JSON по схеме.

Сообщение — часть диалога в одной задаче (как чат). Учитывай прошлые сообщения: если пользователь
уточняет («а в Казани?», «а угловые?», «подробнее», «сделай короче»), возьми недостающее из диалога.

intent:
- "market" — нужны свежие данные с Авито: цены/конкуренты/спрос по товару в городе (зайти в поиск и
  собрать выдачу). Сюда же уточнения прошлого поиска с ДРУГИМ городом или товаром («а в Казани?»).
- "schedule" — про регулярный сбор статистики (замеры) по расписанию: «каждый вечер в 21:00 собирай
  статистику по конкурентам», «запускай парсер в 9 утра и в 9 вечера», «добавь замер в 15:00»,
  «убери утренний замер», «отключи расписание», «какое у меня расписание?», а также «замерь сейчас»,
  «собери статистику по конкурентам прямо сейчас», «пришли отчёт в Excel», «выгрузи в эксель», «нужна таблица
  как в b2b», «покажи просмотры конкурентов» (разовый замер: выдача, просмотры, поднятия, продвижение и Excel-файл).
- "write" — просит составить или написать объявление (или переписать уже написанное).
- "price" — просит подобрать цену для его товара.
- "audit" — просит проверить или улучшить его готовое объявление.
- "reply" — просит ответить покупателю или на сообщение покупателя.
- "chat" — вопрос или просьба по уже обсуждённому в задаче, где новый поиск не нужен: «почему так
  дорого?», «кто из них лучше?», «объясни», «сравни с прошлым», «а что с доставкой?», «спасибо».
- "unclear" — непонятно, чего хочет.

Для intent "market":
- query — короткий поисковый запрос для Авито (что ищем): «шкаф-купе», «диван угловой», «iphone 13».
  Если в сообщении товара нет, но он был в диалоге — возьми его оттуда.
- cityName — город по-русски; citySlug — код города в адресе Авито.
  Примеры: Москва→moskva, Санкт-Петербург→sankt-peterburg, Казань→kazan, Екатеринбург→ekaterinburg,
  Новосибирск→novosibirsk, Краснодар→krasnodar, Ростов-на-Дону→rostov-na-donu,
  Нижний Новгород→nizhniy_novgorod, Самара→samara, Челябинск→chelyabinsk, Уфа→ufa,
  Красноярск→krasnoyarsk, Пермь→perm, Воронеж→voronezh, Волгоград→volgograd, вся Россия→rossiya.
  Другие города — подбери код по правилам Авито (транслитерация, пробелы → _).
  Если города нет в сообщении, но он был в диалоге — возьми его оттуда.
- Если город так и не известен — citySlug=null и в clarify коротко спроси город.
- pages — сколько страниц выдачи собрать: 1 обычно; 2–3 если просят «весь рынок», «подробно», «побольше». Максимум 3.

Для "schedule":
- scheduleAction: "set" — задать расписание заново (заменить прежнее); "add" — добавить время к
  существующему; "remove" — убрать названное время; "off" — выключить все замеры; "show" — показать
  текущее расписание; "now" — сделать замер прямо сейчас (в том числе просьба прислать Excel или просмотры).
- times — время запусков по Москве в формате "HH:MM" (24 часа): «в 9 вечера» → "21:00", «в полдень» →
  "12:00". Без точного времени: «утром» → "09:00", «днём» → "13:00", «вечером» → "21:00".
  Если пользователь назвал время другого города (например, «по Новосибирску»), переведи в московское.
  Для "remove" — какое время убрать («утренний» — из диалога/расписания, обычно "09:00").
  Для off/show/now — times = null.
- Если для set/add время совсем непонятно — times = null и в clarify спроси время.
- query, cityName, citySlug — заполни, только если в сообщении назван товар и город для замеров
  (как для "market"); иначе null — тогда замеры повторяют последний поиск задачи.
- schedulePages — сколько страниц выдачи собирать, если пользователь сказал («весь рынок» → 3,
  «по 5 страниц» → 5, максимум 5); иначе null.

Для всех интентов, кроме "schedule": scheduleAction, times и schedulePages = null.
Для write/price/audit/reply/chat город и query = null, pages = 1, clarify = null.
Для "unclear" или если для market не хватает города — заполни clarify коротким вопросом; иначе clarify = null.`;

export async function planTask(text, history = []) {
  const content = history.length
    ? `Предыдущий диалог в этой задаче:\n${transcript(history)}\n\nНовое сообщение пользователя: ${text}`
    : text;
  const p = await askClaudeJSON({ system: PLAN_SYSTEM, content, schema: PLAN_SCHEMA, effort: 'low' });
  p.pages = Math.max(1, Math.min(3, Number(p.pages) || 1));
  p.times = Array.isArray(p.times) ? p.times : [];
  return p;
}

export function searchUrl(citySlug, query) {
  const slug = String(citySlug || 'rossiya').replace(/[^a-z0-9_-]/gi, '') || 'rossiya';
  return `https://www.avito.ru/${slug}?q=${encodeURIComponent(query)}`;
}

const ANSWER_SYSTEM = `Тебя зовут Максим, ты помощник продавца и аналитик рынка Авито. Пользователь задал вопрос, ты собрал выдачу по его теме.
Это часть диалога в одной задаче: учитывай, что обсуждалось раньше (например, сравни с прошлым
городом или товаром, если пользователь к этому ведёт). Ответ уходит в Telegram как Rich Markdown
(совместим с GitHub Markdown). Пиши по-русски, опираясь ТОЛЬКО на данные.

Формат:
- Заголовок «## » с сутью ответа, затем прямой ответ на вопрос: 2–4 предложения с ключевыми
  числами, главное выдели **жирным**.
- «### Конкуренты» — 2–4 пункта списком: кто в топе и чем берёт (цена, отзывы, продвижение).
- «### Что делать» — 3–5 конкретных шагов чек-листом, каждый пункт в виде «- [ ] шаг».
- Таблицы с сырыми данными НЕ рисуй: бот сам добавит под твоим ответом точные таблицы цен,
  продвижения, продавцов и объявлений. Не повторяй их содержимое целиком.
- Не используй эмодзи, знак доллара и HTML-теги.

Суммы в рублях с пробелами между разрядами («14 990 ₽»). Если данных мало (меньше 15 объявлений) —
честно скажи об этом.`;

export async function answerMarket(question, report, opts = {}) {
  const s = analyze(report);
  const ctx = marketContext(report, 60);
  const payload = {
    stats: {
      count: s.count,
      totalOnSite: s.totalOnSite,
      units: s.units,
      shares: s.shares,
      rankBuckets: s.rankBuckets,
      promotedVsOrganic: s.promotedVsOrganic,
      topSellers: s.sellers.top.slice(0, 8),
      views: viewStats(Object.values(report.items)),
    },
    sample: ctx?.items || [],
  };
  const { text } = await askClaudeStream({
    system: opts.system || ANSWER_SYSTEM,
    model: opts.model,
    messages: toMessages(opts.history, `Вопрос пользователя: ${question}\n\nДанные рынка (свежая выдача):\n${JSON.stringify(payload)}`),
    effort: opts.effort || 'medium',
    onText: opts.onText,
    signal: opts.signal,
  });
  return text;
}
