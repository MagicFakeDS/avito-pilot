import ExcelJS from 'exceljs';
import { TZ, dayKey } from './time.js';

const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A86E8' } };
const TOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A86E8' } };
const BORDER = { top: { style: 'thin', color: { argb: 'FFBFBFBF' } }, left: { style: 'thin', color: { argb: 'FFBFBFBF' } }, bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } }, right: { style: 'thin', color: { argb: 'FFBFBFBF' } } };
const PHOTO_COLS = 10;

const SELLER_TYPE = { company: 'Компания', shop: 'Магазин', person: 'Частное лицо' };

const promoName = (slug) => (/^CPX/i.test(slug) ? 'За просмотры' : slug === 'bbip' ? 'Продвижение' : slug);
const extraName = (slug) => (slug === 'highlight' ? 'Выделено' : slug === 'xl' ? 'xl' : null);
const isExtra = (slug) => slug === 'highlight' || slug === 'xl';

const msk = (iso) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '') : '';
const yesNo = (v) => (v ? 'Да' : 'Нет');
const median = (xs) => {
  const v = xs.filter((x) => x != null && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
};
const sum = (xs) => (xs.some((x) => x != null) ? xs.reduce((s, x) => s + (x || 0), 0) : null);

function header(ws, titles, widths) {
  ws.columns = titles.map((t, i) => ({ header: t, width: widths[i] ?? 14 }));
  const row = ws.getRow(1);
  row.height = 48;
  row.eachCell((c) => {
    c.fill = HEAD_FILL;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    c.border = BORDER;
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

function body(ws) {
  ws.eachRow((row, n) => {
    if (n === 1) return;
    row.eachCell({ includeEmpty: true }, (c) => {
      c.border = BORDER;
      c.alignment = { vertical: 'top', wrapText: false, ...c.alignment };
    });
  });
}

function listingsSheet(wb, items) {
  const ws = wb.addWorksheet('Анализ объявлений');
  const titles = [
    'Позиция в выдаче', 'Заголовок объявления', 'Цена в объявлении', 'Кол-во просмотров за сегодня', 'Кол-во просмотров за всё время',
    'Какие услуги продвижения применяет', 'Какие доп. услуги применяет', 'Наличие знака о понижении цены', 'Какие используют значки',
    'Текст объявления', 'Кол-во символов в тексте', 'Адрес в объявлении', 'Категория', 'Ссылка на объявление', 'ID продавца',
    'Имя продавца', 'Тип продавца', 'На Авито', 'Объявлений у продавца', 'Завершённых объявлений', 'Рейтинг', 'Кол-во отзывов',
    'Продаёт с Авито Доставкой', 'Дата публикации (МСК)', 'Время поднятия / применения услуги (МСК)', 'Кол-во фото в объявлении',
    ...Array.from({ length: PHOTO_COLS }, (_, i) => `Фото ${i + 1}`),
  ];
  header(ws, titles, [10, 40, 12, 12, 12, 16, 14, 12, 18, 50, 11, 30, 18, 40, 16, 26, 14, 16, 12, 12, 9, 10, 12, 17, 17, 10, ...Array(PHOTO_COLS).fill(30)]);
  for (const it of items) {
    const vas = it.vas || [];
    const text = it.description || '';
    const row = ws.addRow([
      it.rank,
      it.title,
      it.price,
      it.viewsToday ?? null,
      it.views ?? null,
      vas.filter((s) => !isExtra(s)).map(promoName).join(', '),
      vas.map(extraName).filter(Boolean).join('; '),
      yesNo(it.priceLowered),
      (it.badges || []).join('; '),
      text,
      text && it.detailsAt ? text.length : null,
      it.address || it.location || '',
      it.category || '',
      it.url ? { text: it.url, hyperlink: it.url } : '',
      it.sellerId || '',
      it.sellerName || '',
      SELLER_TYPE[it.sellerType] || '',
      it.sellerSince || '',
      it.sellerListings ?? null,
      it.closedItems ?? null,
      it.sellerRating ?? null,
      it.sellerReviews ?? null,
      yesNo(it.delivery),
      msk(it.publishedAt),
      msk(it.bumpedAt),
      (it.images || []).length || it.photos || null,
      ...Array.from({ length: PHOTO_COLS }, (_, i) => it.images?.[i] || ''),
    ]);
    row.getCell(3).numFmt = '#,##0';
    row.getCell(10).alignment = { wrapText: false, vertical: 'top' };
  }
  body(ws);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: titles.length } };
}

function sellersSheet(wb, items, today) {
  const ws = wb.addWorksheet('Конкурентный анализ');
  const groups = new Map();
  for (const it of items) {
    const key = it.sellerId || it.sellerName || `без продавца ${it.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const titles = [
    'Имя продавца', 'ID продавца', 'Тип продавца', 'На Авито', 'Кол-во объяв. у продавца по данной выдаче', 'Лучшее место в выдаче',
    'Медиана цены', 'Кол-во объяв. с платными услугами', 'Какие платные услуги применяет', 'Кол-во просмотров на всех объяв. за всё время',
    'Кол-во просмотров на всех объяв. за сегодня', 'Поднято или опубликовано сегодня', 'Рейтинг', 'Кол-во отзывов на аккаунте',
    'Завершённых объявлений', 'Всего объявлений у продавца',
  ];
  header(ws, titles, [30, 18, 14, 16, 14, 11, 13, 14, 26, 15, 15, 14, 9, 12, 13, 13]);
  const rows = [...groups.values()]
    .map((list) => {
      const first = list.find((x) => x.sellerName) || list[0];
      const counts = {};
      for (const it of list) for (const s of it.vas || []) counts[s] = (counts[s] || 0) + 1;
      const label = (s) => (isExtra(s) ? extraName(s) : promoName(s));
      return {
        list,
        values: [
          first.sellerName || 'Без имени',
          first.sellerId || '',
          SELLER_TYPE[first.sellerType] || '',
          first.sellerSince || '',
          list.length,
          Math.min(...list.map((x) => x.rank)),
          median(list.map((x) => x.price)),
          list.filter((x) => (x.vas || []).length).length,
          Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${label(s)} - ${n} шт.`).join(', '),
          sum(list.map((x) => x.views)),
          sum(list.map((x) => x.viewsToday)),
          list.filter((x) => x.bumpedAt && dayKey(x.bumpedAt) === today).length,
          first.sellerRating ?? null,
          first.sellerReviews ?? null,
          first.closedItems ?? null,
          first.sellerListings ?? null,
        ],
      };
    })
    .sort((a, b) => b.values[4] - a.values[4] || a.values[5] - b.values[5]);
  for (const r of rows) ws.addRow(r.values).getCell(7).numFmt = '#,##0';
  body(ws);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: titles.length } };
}

function eventsOf(items) {
  const events = [];
  for (const it of items) {
    if (it.publishedAt) events.push({ at: it.publishedAt, kind: 'new' });
    if (it.bumpedAt && (!it.publishedAt || Math.abs(Date.parse(it.bumpedAt) - Date.parse(it.publishedAt)) > 30 * 60_000)) {
      events.push({ at: it.bumpedAt, kind: 'bump' });
    }
  }
  return events;
}

function summarySheet(wb, items, now, days = 21, heatDays = 7) {
  const ws = wb.addWorksheet('Сводка по кол-ву публикаций');
  const dates = Array.from({ length: days }, (_, i) => dayKey(Date.parse(now) - i * 86400_000));
  const ru = (ymd) => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}`;
  const events = eventsOf(items);
  const count = (d, kind) => events.filter((e) => e.kind === kind && dayKey(e.at) === d).length;
  const viewsBy = (d) => sum(items.filter((it) => it.publishedAt && dayKey(it.publishedAt) === d).map((it) => it.views));

  const headCell = (c) => {
    c.fill = HEAD_FILL;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    c.border = BORDER;
  };
  const put = (r, c, v, style) => {
    const cell = ws.getCell(r, c);
    cell.value = v;
    cell.border = BORDER;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    if (style === 'head') headCell(cell);
    if (style === 'total') {
      cell.fill = TOTAL_FILL;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    }
    return cell;
  };

  ['Дата', 'Кол-во новых объявлений', 'Кол-во поднятых объявлений', 'Кол-во новых и поднятых объявлений'].forEach((t, i) => put(1, 1 + i, t, 'head'));
  ['Дата', 'Кол-во просмотров на всех объяв. за всё время по дате публикации'].forEach((t, i) => put(1, 7 + i, t, 'head'));
  ws.getRow(1).height = 48;
  let totals = [0, 0, 0, 0];
  dates.forEach((d, i) => {
    const n = count(d, 'new');
    const b = count(d, 'bump');
    const v = viewsBy(d) || 0;
    put(2 + i, 1, ru(d));
    put(2 + i, 2, n);
    put(2 + i, 3, b);
    put(2 + i, 4, n + b);
    put(2 + i, 7, ru(d));
    put(2 + i, 8, v);
    totals = [totals[0] + n, totals[1] + b, totals[2] + n + b, totals[3] + v];
  });
  const tr = 2 + dates.length;
  put(tr, 1, 'ВСЕГО:', 'total');
  put(tr, 2, totals[0], 'total');
  put(tr, 3, totals[1], 'total');
  put(tr, 4, totals[2], 'total');
  put(tr, 7, 'ВСЕГО:', 'total');
  put(tr, 8, totals[3], 'total');

  const top = tr + 3;
  const heat = dates.slice(0, heatDays);
  ws.mergeCells(top, 1, top, 1 + heat.length);
  put(top, 1, 'Кол-во новых и поднятых объявлений по датам и временным слотам', 'head');
  ws.getRow(top).height = 28;
  put(top + 1, 1, 'Временные слоты', 'head');
  heat.forEach((d, i) => put(top + 1, 2 + i, ru(d).slice(0, 10), 'head'));
  const hour = (iso) => Number(new Date(iso).toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false })) % 24;
  for (let h = 0; h < 24; h++) {
    const r = top + 2 + h;
    put(r, 1, `${String(h).padStart(2, '0')}:00 - ${String(h + 1).padStart(2, '0')}:00`);
    heat.forEach((d, i) => put(r, 2 + i, events.filter((e) => dayKey(e.at) === d && hour(e.at) === h).length));
  }
  const col = (n) => String.fromCharCode(64 + n);
  ws.addConditionalFormatting({
    ref: `B${top + 2}:${col(1 + heat.length)}${top + 25}`,
    rules: [{ type: 'colorScale', priority: 1, cfvo: [{ type: 'min' }, { type: 'max' }], color: [{ argb: 'FFFFFFFF' }, { argb: 'FFF4A460' }] }],
  });
  [14, 14, 14, 14, 4, 4, 14, 22].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  heat.slice(3).forEach((_, i) => (ws.getColumn(5 + i).width = Math.max(ws.getColumn(5 + i).width || 0, 12)));
}

export async function buildWorkbook(report, { now = new Date() } = {}) {
  const items = Object.values(report.items).sort((a, b) => a.rank - b.rank);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Помощник Максим';
  wb.created = new Date(now);
  listingsSheet(wb, items);
  sellersSheet(wb, items, dayKey(now));
  summarySheet(wb, items, new Date(now).toISOString());
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function excelName(report, now = new Date()) {
  const when = new Date(now).toLocaleString('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '').replace(':', '-');
  return `Отчёт ${report.name} ${when}.xlsx`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ');
}
