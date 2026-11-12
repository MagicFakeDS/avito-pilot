import { askClaudeStream } from './claude.js';
import { analyze } from './analytics.js';
import { toMessages } from './dialog.js';

const COMMON = `Это продолжение диалога в одной задаче: учитывай, что обсуждалось раньше, и понимай
уточнения («сделай короче», «а для другого товара», «перепиши без эмодзи»).
Пиши по-русски, коротко и по делу. Ответ уходит в Telegram как Rich Markdown (совместим
с GitHub Markdown): заголовки ###, списки «- », таблица Markdown — там, где сравнение удобнее
таблицей (например, стратегии цены). Не используй эмодзи, знак доллара и HTML-теги.
Не выдумывай факты о товаре: если данных не хватает, пометь в тексте [уточнить: …].
Суммы — в рублях, с пробелами между разрядами.`;

export function marketContext(report, limit = 60) {
  if (!report || !Object.keys(report.items).length) return null;
  const s = analyze(report);
  const items = Object.values(report.items)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((i) => ({
      title: i.title,
      price: i.price === 0 ? 'бесплатно' : i.price,
      unit: i.priceUnit || undefined,
      promoted: i.promoted || undefined,
      seller: i.sellerName || undefined,
      rating: i.sellerRating ?? undefined,
      reviews: i.sellerReviews ?? undefined,
    }));
  return {
    query: s.query,
    collected: s.count,
    totalOnSite: s.totalOnSite,
    prices: s.units.map(({ unit, count, min, p25, median, p75, max }) => ({ unit, count, min, p25, median, p75, max })),
    promotedShare: Math.round(s.shares.promoted * 100) + '%',
    deliveryShare: Math.round(s.shares.delivery * 100) + '%',
    items,
  };
}

const withMarket = (text, ctx) =>
  ctx ? `${text}\n\nКонтекст рынка (выдача Авито по похожему запросу):\n${JSON.stringify(ctx)}` : text;

const WRITE = `Ты пишешь объявления для Авито, которые находят и покупают.
По описанию товара или услуги подготовь:
### Заголовки — 3 варианта до 50 символов: главное слово в начале, без капса, эмодзи и «срочно».
### Описание — 600–1200 знаков: первая строка цепляет; выгоды; характеристики списком; условия (доставка, оплата, гарантия); в конце призыв написать в чат.
### Что дописать — чего не хватает, чтобы объявление продавало лучше.
Если есть контекст рынка — используй слова, по которым ищут, и покажи, чем отличиться от конкурентов.
${COMMON}`;

const PRICE = `Ты помогаешь продавцу на Авито выбрать цену.
По описанию товара найди в выдаче сопоставимые объявления (тот же тип товара, та же единица цены) и дай:
### Рекомендация — одна цена и разумный коридор.
### Три стратегии — продать быстро / по рынку / дороже рынка; для дорогой — что нужно, чтобы цена была оправдана.
### На что опирался — 3–5 сопоставимых объявлений с ценами.
Если сопоставимых объявлений мало или единицы цены не совпадают — скажи об этом прямо.
${COMMON}`;

const AUDIT = `Ты проверяешь объявление продавца на Авито.
### Оценка — от 1 до 10 и одной фразой почему.
### Что мешает продажам — конкретно: заголовок, описание, цена, условия.
### Правки — список конкретных изменений.
### Новый заголовок — 2 варианта до 50 символов.
Если есть контекст рынка — сравни с конкурентами: цена относительно медианы, чего у них есть, а у продавца нет.
${COMMON}`;

const REPLY = `Ты помогаешь продавцу на Авито отвечать покупателям в чате.
Дано сообщение покупателя (возможно, с заметками продавца о товаре). Напиши ответ от лица продавца:
вежливо, по-человечески, без канцелярита, с мягким шагом к сделке (договориться о встрече, доставке, оплате).
Ничего не обещай сверх данных — если нужно что-то уточнить, поставь [уточнить: …].
### Короткий — до 300 знаков.
### Развёрнутый — до 700 знаков.
${COMMON}`;

const CHAT = `Тебя зовут Максим, ты помощник продавца на Авито и продолжаешь диалог в рамках одной задачи. Если спрашивают, кто ты, — представься Максимом.
Ответь на сообщение пользователя по существу, опираясь на историю диалога и данные рынка задачи
(если они есть). Не начинай заново — продолжай разговор. Если для ответа нужны свежие данные
с Авито (другой город или товар), скажи об этом и предложи написать запрос вида
«сколько стоят … в …».
${COMMON}`;

const run = (system, content, effort, opts = {}) =>
  askClaudeStream({ system, messages: toMessages(opts.history, content), effort, onText: opts.onText, signal: opts.signal });

export const tools = {
  write: (text, report, opts) => run(WRITE, withMarket(`Товар/услуга:\n${text}`, marketContext(report, 40)), 'medium', opts),
  price: (text, report, opts) => run(PRICE, withMarket(`Что продаю:\n${text}`, marketContext(report, 150)), 'medium', opts),
  audit: (text, report, opts) => run(AUDIT, withMarket(`Объявление продавца:\n${text}`, marketContext(report, 40)), 'medium', opts),
  reply: (text, _report, opts) => run(REPLY, `Сообщение покупателя:\n${text}`, 'low', opts),
  chat: (text, report, opts) => run(CHAT, withMarket(text, marketContext(report, 60)), 'medium', opts),
};
