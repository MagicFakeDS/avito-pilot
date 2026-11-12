const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (v) => (v == null ? '—' : Math.round(v).toLocaleString('ru-RU'));
const rub = (v) => (v == null ? '—' : `${num(v)} ₽`);
const pct = (v) => `${Math.round(v * 100)}%`;
const short = (v) =>
  v >= 1e6 ? `${+(v / 1e6).toFixed(1)} млн` : v >= 1e3 ? `${+(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)} тыс` : String(Math.round(v));
const dt = (iso) => new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

const STYLE = `
:root {
  color-scheme: light;
  --surface: #fcfcfb; --surface-2: #f3f2ef; --border: #e2e1dc;
  --text: #0b0b0b; --text-2: #52514e; --text-3: #7a7973;
  --series: #2a78d6; --series-hover: #1c5cab; --accent: #2a78d6;
  --danger: #c4372f; --grid: #e8e7e2;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --surface: #1a1a19; --surface-2: #242423; --border: #353533;
    --text: #f0efec; --text-2: #c3c2b7; --text-3: #8f8e86;
    --series: #3987e5; --series-hover: #6da7ec; --accent: #5598e7;
    --danger: #e66767; --grid: #2e2e2c;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--surface); color: var(--text);
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1120px; margin: 0 auto; padding: 28px 20px 60px; }
a { color: var(--accent); }
h1 { font-size: 24px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 0 0 12px; }
h3 { font-size: 15px; margin: 18px 0 6px; }
.muted { color: var(--text-2); }
.small { font-size: 12px; color: var(--text-3); }
.row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.header { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
.btn { display: inline-block; padding: 7px 14px; border: 1px solid var(--border); border-radius: 8px;
  background: var(--surface-2); color: var(--text); text-decoration: none; cursor: pointer; font: inherit; }
.btn:hover { border-color: var(--text-3); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn.danger { color: var(--danger); }
.btn:disabled { opacity: .6; cursor: wait; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 18px; margin-bottom: 16px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 820px) { .grid2 { grid-template-columns: 1fr; } }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 16px; }
.tile { border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; }
.tile .label { font-size: 12px; color: var(--text-2); }
.tile .value { font-size: 24px; font-weight: 600; margin-top: 2px; font-variant-numeric: tabular-nums; }
.tile .sub { font-size: 12px; color: var(--text-3); }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
th { font-size: 12px; font-weight: 600; color: var(--text-2); white-space: nowrap; }
td.n, th.n { text-align: right; white-space: nowrap; }
th[data-sort] { cursor: pointer; user-select: none; }
th[data-sort]:hover { color: var(--text); }
.scroll { overflow-x: auto; }
.tag { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 6px; border: 1px solid var(--border);
  color: var(--text-2); margin: 1px 2px 1px 0; white-space: nowrap; }
.list { list-style: none; padding: 0; margin: 0; }
.list li { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; border-bottom: 1px solid var(--border); }
.list li span:last-child { color: var(--text-2); font-variant-numeric: tabular-nums; }
svg text { fill: var(--text-2); font-size: 11px; }
svg .grid { stroke: var(--grid); stroke-width: 1; }
svg .bar { fill: var(--series); }
svg .hit:hover + .bar, svg .bar:hover { fill: var(--series-hover); }
svg .marker { stroke: var(--text); stroke-width: 1.5; stroke-dasharray: 3 3; }
svg .marker-label { fill: var(--text); font-weight: 600; }
.hbar { display: grid; grid-template-columns: 70px 1fr 90px; align-items: center; gap: 10px; padding: 4px 0; }
.hbar .track { height: 14px; border-radius: 0 4px 4px 0; background: var(--surface-2); position: relative; }
.hbar .fill { position: absolute; inset: 0 auto 0 0; background: var(--series); border-radius: 0 4px 4px 0; }
.hbar .val { text-align: right; color: var(--text-2); font-variant-numeric: tabular-nums; font-size: 13px; }
#tip { position: fixed; pointer-events: none; background: var(--text); color: var(--surface); padding: 6px 9px;
  border-radius: 6px; font-size: 12px; white-space: nowrap; opacity: 0; transition: opacity .1s; z-index: 10; }
.ai { line-height: 1.6; }
.ai ul { padding-left: 20px; margin: 4px 0 10px; }
details summary { cursor: pointer; color: var(--text-2); font-size: 13px; margin-top: 8px; }
input[type=text], input[type=number], textarea { padding: 7px 10px; border: 1px solid var(--border); border-radius: 8px;
  background: var(--surface); color: var(--text); font: inherit; }
input[type=text] { min-width: 260px; }
input[type=number] { width: 70px; }
textarea { width: 100%; resize: vertical; font-size: 12px; font-family: ui-monospace, Consolas, monospace; }
.empty { text-align: center; padding: 40px 20px; color: var(--text-2); }
`;

const TIP_SCRIPT = `
const tip = document.getElementById('tip');
document.addEventListener('mousemove', (e) => {
  const t = e.target.closest('[data-tip]');
  if (!t) { tip.style.opacity = 0; return; }
  tip.textContent = t.dataset.tip;
  tip.style.opacity = 1;
  const x = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8);
  tip.style.left = x + 'px';
  tip.style.top = (e.clientY - tip.offsetHeight - 10) + 'px';
});`;

const PASTE_SCRIPT = String.raw`
function avitoLink(href) {
  try {
    const u = new URL(href, 'https://www.avito.ru');
    if (!/(^|\.)avito\.ru$/.test(u.hostname)) return null;
    if (/_\d{6,}$/.test(u.pathname)) return 'https://www.avito.ru' + u.pathname;
    const b = u.pathname.match(/^\/(brands|user)\/[^/]+/);
    return b ? 'https://www.avito.ru' + b[0] : null;
  } catch { return null; }
}
function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  const BLOCK = /^(DIV|P|LI|UL|OL|H[1-6]|SECTION|ARTICLE|HEADER|FOOTER|TR|TABLE|BR)$/;
  (function walk(node) {
    if (node.nodeType === 3) { out.push(node.nodeValue); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toUpperCase();
    if (/^(SCRIPT|STYLE|NOSCRIPT|SVG|IMG|BUTTON|INPUT|SELECT|TEMPLATE|IFRAME|HEAD)$/.test(tag)) return;
    if (tag === 'A') {
      const text = node.textContent.replace(/\s+/g, ' ').trim();
      const link = avitoLink(node.getAttribute('href') || '');
      if (link && text) { out.push(' [' + text + '](' + link + ') '); return; }
    }
    const block = BLOCK.test(tag);
    if (block) out.push('\n');
    for (const c of node.childNodes) walk(c);
    if (block) out.push('\n');
  })(doc.body);
  return out.join('').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
}
const pasteBox = document.getElementById('paste');
pasteBox.addEventListener('paste', (e) => {
  const html = e.clipboardData.getData('text/html');
  if (!html) return; // простой текст вставится как есть
  e.preventDefault();
  pasteBox.value = htmlToText(html);
  const n = new Set(pasteBox.value.match(/_\d{6,}\)/g) || []).size;
  document.getElementById('paste-status').textContent =
    pasteBox.value.length.toLocaleString('ru-RU') + ' символов' + (n ? ', ссылок на объявления: ' + n : '');
});
document.getElementById('file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  pasteBox.value = htmlToText(await f.text());
  document.getElementById('paste-status').textContent = 'Файл загружен: ' + pasteBox.value.length.toLocaleString('ru-RU') + ' символов';
});
`;

function page(title, body, script = '') {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body><main>${body}</main><div id="tip"></div>
<script>${TIP_SCRIPT}${script}</script></body></html>`;
}

export function renderIndex(reports) {
  const rows = reports
    .map(
      (r) => `<tr>
      <td><a href="/r/${r.id}">${esc(r.name)}</a><div class="small">${esc(r.query)}</div></td>
      <td class="n">${num(r.itemCount)}</td><td class="n">${num(r.pageCount)}</td>
      <td class="n">${dt(r.updatedAt)}</td></tr>`,
    )
    .join('');

  const body = `
  <div class="header"><div><h1>Отчёты по выдаче Авито</h1>
  <div class="muted">Скопируйте страницу выдачи Авито — Claude разберёт её на объявления и построит отчёт.</div></div></div>

  <div class="card"><h2>Новый отчёт</h2>
    <form id="create" class="row">
      <input type="text" name="name" placeholder="Например: шкафы-купе, Москва" maxlength="120">
      <button class="btn primary">Создать</button>
    </form>
    <p class="small">На странице отчёта вставляйте по одной странице выдачи — данные копятся в одном отчёте.</p>
  </div>

  <div class="card">${
    reports.length
      ? `<div class="scroll"><table><thead><tr><th>Отчёт</th><th class="n">Объявлений</th><th class="n">Страниц</th><th class="n">Обновлён</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<div class="empty">Отчётов пока нет</div>`
  }</div>`;

  const script = `
document.getElementById('create').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = e.target.name.value;
  const r = await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  const data = await r.json();
  location.href = '/r/' + data.id;
});`;
  return page('Отчёты Авито', body, script);
}

export function renderReport(report, s) {
  const unitNote = s.units.length > 1 ? ` (${esc(s.mainUnit)})` : '';
  const main = s.units[0];

  const tiles = `<div class="tiles">
    ${tile('Собрано объявлений', num(s.count), s.totalOnSite ? `из ${num(s.totalOnSite)} в выдаче` : '')}
    ${tile('Медианная цена' + unitNote, main ? rub(main.median) : '—', main ? `${short(main.p25)}–${short(main.p75)} ₽ у половины` : '')}
    ${tile('Продвинутых', pct(s.shares.promoted), s.shares.xl ? `XL: ${pct(s.shares.xl)}` : 'платное продвижение')}
    ${tile('Продавцов с профилем', num(s.sellers.unique), `топ-10 держат ${pct(s.sellers.top10Share)} выдачи`)}
    ${tile('С доставкой', pct(s.shares.delivery), `со скидкой: ${pct(s.shares.discount)}`)}
  </div>`;

  const empty = !s.count;
  const pasteCard = `<div class="card"><h2>Добавить страницу выдачи</h2>
    <ol class="small" style="margin:0 0 10px;padding-left:18px">
      <li>Откройте на Авито нужный поиск (город, категория, фильтры).</li>
      <li>Нажмите Ctrl+A, затем Ctrl+C (на Mac — Cmd+A, Cmd+C).</li>
      <li>Вставьте сюда Ctrl+V и нажмите «Разобрать». Потом откройте следующую страницу выдачи и повторите.</li>
    </ol>
    <textarea id="paste" rows="6" placeholder="Вставьте сюда скопированную страницу выдачи Авито"></textarea>
    <div class="row" style="margin-top:10px">
      <label class="small">Страница выдачи №&nbsp;<input type="number" id="page" min="1" max="100" value="${s.nextPage}"></label>
      <label class="btn">или файл .html<input type="file" id="file" accept=".html,.htm,.mhtml,text/html" hidden></label>
      <button class="btn primary" id="parse">Разобрать</button>
      <span id="paste-status" class="small"></span>
    </div>
  </div>`;
  const body = `
  <div class="header">
    <div><a href="/" class="small">← все отчёты</a>
      <h1>${esc(report.name)}</h1>
      <div class="muted">${esc(s.query)}${s.query ? ' · ' : ''}страниц собрано: ${s.pagesCollected} · обновлён ${dt(report.updatedAt)}</div>
    </div>
    <div class="row">
      <a class="btn" href="/r/${report.id}.csv">Скачать CSV</a>
      <a class="btn" href="/r/${report.id}.json">JSON</a>
      <button class="btn danger" id="del">Удалить</button>
    </div>
  </div>
  ${pasteCard}
  ${
    empty
      ? ''
      : `${tiles}
  <div class="card"><h2>Распределение цен${unitNote}</h2>
    ${histogramSvg(s.histogram, main)}
    ${histogramTable(s.histogram)}
  </div>

  <div class="grid2">
    <div class="card"><h2>Продвижение по позициям</h2>
      <div class="small" style="margin-bottom:8px">Какая доля объявлений на этих местах выдачи куплена</div>
      ${s.rankBuckets.map((b) => hbar(b.label, b.share, `${pct(b.share)} · ${b.promoted}/${b.count}`)).join('')}
      ${promoVsOrganic(s.promotedVsOrganic)}
    </div>
    <div class="card"><h2>Цены по единицам</h2>
      <div class="scroll"><table><thead><tr><th>Единица</th><th class="n">Шт.</th><th class="n">Мин</th><th class="n">25%</th><th class="n">Медиана</th><th class="n">75%</th><th class="n">Макс</th></tr></thead>
      <tbody>${s.units
        .map(
          (u) => `<tr><td>${esc(u.unit)}</td><td class="n">${u.count}</td><td class="n">${short(u.min)}</td><td class="n">${short(u.p25)}</td>
          <td class="n"><b>${short(u.median)}</b></td><td class="n">${short(u.p75)}</td><td class="n">${short(u.max)}</td></tr>`,
        )
        .join('')}</tbody></table></div>
      <div class="small">С ценой: ${s.pricedCount} из ${s.count}. Суммы в рублях.</div>
    </div>
  </div>

  <div class="card"><h2>Крупнейшие продавцы</h2>
    <div class="scroll"><table><thead><tr><th>Продавец</th><th class="n">Объявлений</th><th class="n">Из них продв.</th>
    <th class="n">Лучшая позиция</th><th class="n">Рейтинг</th><th class="n">Отзывов</th><th class="n">Медиана цены</th></tr></thead>
    <tbody>${s.sellers.top
      .map(
        (x) => `<tr><td>${esc(x.name)}</td><td class="n">${x.count}</td><td class="n">${x.promoted}</td>
        <td class="n">${Number.isFinite(x.bestRank) ? x.bestRank : '—'}</td><td class="n">${x.rating ?? '—'}</td>
        <td class="n">${num(x.reviews)}</td><td class="n">${rub(x.medianPrice)}</td></tr>`,
      )
      .join('')}</tbody></table></div>
    <div class="small">Без профиля (частные лица без отзывов): ${s.sellers.noProfile} объявлений.</div>
  </div>

  <div class="grid2">
    <div class="card"><h2>Бейджи и метки</h2>${listBlock(s.badges)}</div>
    <div class="card"><h2>Где продают</h2>${listBlock(s.locations)}</div>
  </div>

  <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">ИИ-выводы</h2>
    <button class="btn primary" id="ai">${report.ai ? 'Обновить' : 'Сделать выводы'}</button></div>
    <div id="ai-out" class="ai">${
      report.ai
        ? `${markdown(report.ai.text)}<div class="small">${esc(report.ai.model)} · ${dt(report.ai.createdAt)}</div>`
        : `<p class="muted">Claude разберёт статистику и подскажет, как встать в этой выдаче.</p>`
    }</div>
  </div>

  <div class="card"><h2>Все объявления</h2>
    <div class="scroll"><table id="items"><thead><tr>
      <th class="n" data-sort="num">#</th><th data-sort="str">Заголовок</th><th class="n" data-sort="num">Цена</th>
      <th>Метки</th><th data-sort="str">Продавец</th><th class="n" data-sort="num">Рейтинг</th><th data-sort="str">Локация</th><th>Дата</th>
    </tr></thead><tbody>${Object.values(report.items)
      .sort((a, b) => a.rank - b.rank)
      .map(itemRow)
      .join('')}</tbody></table></div>
  </div>`
  }`;

  const script = `${PASTE_SCRIPT}
document.getElementById('parse').addEventListener('click', async () => {
  const btn = document.getElementById('parse');
  const status = document.getElementById('paste-status');
  const text = document.getElementById('paste').value.trim();
  if (!text) { status.textContent = 'Сначала вставьте страницу'; return; }
  btn.disabled = true; status.style.color = '';
  status.textContent = 'Claude разбирает страницу… обычно до минуты';
  const r = await fetch('/api/reports/${report.id}/paste', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, page: document.getElementById('page').value }),
  });
  const data = await r.json().catch(() => ({}));
  if (r.ok) {
    status.textContent = 'Найдено ' + data.found + ', новых ' + data.added + '. Обновляю отчёт…';
    return location.reload();
  }
  btn.disabled = false; status.style.color = 'var(--danger)';
  status.textContent = 'Ошибка: ' + (data.error || r.status);
});
document.getElementById('del').addEventListener('click', async () => {
  if (!confirm('Удалить отчёт со всеми данными?')) return;
  await fetch('/api/reports/${report.id}/delete', { method: 'POST' });
  location.href = '/';
});
const aiBtn = document.getElementById('ai');
if (aiBtn) aiBtn.addEventListener('click', async () => {
  aiBtn.disabled = true; aiBtn.textContent = 'Думаю…';
  const r = await fetch('/api/reports/${report.id}/ai', { method: 'POST' });
  if (r.ok) return location.reload();
  const e = await r.json().catch(() => ({}));
  document.getElementById('ai-out').innerHTML = '<p style="color:var(--danger)"></p>';
  document.querySelector('#ai-out p').textContent = 'Ошибка: ' + (e.error || r.status);
  aiBtn.disabled = false; aiBtn.textContent = 'Повторить';
});
const table = document.getElementById('items');
if (table) table.querySelectorAll('th[data-sort]').forEach((th, col) => {
  const idx = [...th.parentNode.children].indexOf(th);
  th.addEventListener('click', () => {
    const asc = th.dataset.dir !== 'asc';
    th.parentNode.querySelectorAll('th').forEach((h) => delete h.dataset.dir);
    th.dataset.dir = asc ? 'asc' : 'desc';
    const rows = [...table.tBodies[0].rows];
    const val = (r) => r.cells[idx].dataset.v ?? r.cells[idx].textContent.trim();
    rows.sort((a, b) => {
      const [x, y] = [val(a), val(b)];
      const d = th.dataset.sort === 'num' ? (parseFloat(x) || Infinity) - (parseFloat(y) || Infinity) : x.localeCompare(y, 'ru');
      return asc ? d : -d;
    });
    table.tBodies[0].append(...rows);
  });
});`;
  return page(report.name, body, script);
}

function tile(label, value, sub) {
  return `<div class="tile"><div class="label">${esc(label)}</div><div class="value">${value}</div><div class="sub">${esc(sub)}</div></div>`;
}

function hbar(label, share, valueText) {
  return `<div class="hbar" data-tip="${esc(label)}: ${esc(valueText)}"><span class="small">${esc(label)}</span>
    <div class="track"><div class="fill" style="width:${Math.max(share * 100, share > 0 ? 1 : 0)}%"></div></div>
    <span class="val">${esc(valueText)}</span></div>`;
}

function promoVsOrganic(p) {
  if (!p.promoted || !p.organic) return '';
  return `<p class="small" style="margin-top:12px">Медиана цены: продвинутые — <b>${rub(p.promoted.median)}</b>
    (${p.promoted.count} шт.), без продвижения — <b>${rub(p.organic.median)}</b> (${p.organic.count} шт.)</p>`;
}

function listBlock(rows) {
  if (!rows.length) return '<div class="small">Нет данных</div>';
  return `<ul class="list">${rows.map((r) => `<li><span>${esc(r.name)}</span><span>${r.count}</span></li>`).join('')}</ul>`;
}

function itemRow(i) {
  const tags = [
    i.promoted && 'Продвинуто',
    i.xl && 'XL',
    i.delivery && 'Доставка',
    i.oldPrice && `скидка с ${short(i.oldPrice)}`,
  ].filter(Boolean);
  return `<tr>
    <td class="n" data-v="${i.rank}">${i.rank}</td>
    <td><a href="${esc(safeUrl(i.url))}" target="_blank" rel="noopener noreferrer">${esc(i.title)}</a></td>
    <td class="n" data-v="${i.price ?? ''}">${i.price ? rub(i.price) : esc(i.priceText || '—')}${
      i.priceUnit && i.priceUnit !== 'за всё' ? `<div class="small">${esc(i.priceUnit)}</div>` : ''
    }</td>
    <td>${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</td>
    <td>${esc(i.sellerName || '—')}</td>
    <td class="n" data-v="${i.sellerRating ?? ''}">${i.sellerRating ?? '—'}${i.sellerReviews ? `<div class="small">${num(i.sellerReviews)} отз.</div>` : ''}</td>
    <td>${esc(i.location)}</td>
    <td class="small">${esc(i.date)}</td></tr>`;
}

function safeUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && /(^|\.)avito\.ru$/.test(url.hostname) ? url.href : '#';
  } catch {
    return '#';
  }
}

function histogramSvg(buckets, main) {
  if (!buckets) return '<div class="small">Слишком мало объявлений с ценой для гистограммы</div>';
  const W = 760, H = 260, L = 44, R = 12, T = 22, B = 34;
  const max = Math.max(...buckets.map((b) => b.count));
  const yMax = niceMax(max);
  const bw = (W - L - R) / buckets.length;
  const y = (v) => T + (H - T - B) * (1 - v / yMax);
  const ticks = [0, yMax / 2, yMax].filter((v, i, a) => a.indexOf(v) === i);

  const grid = ticks
    .map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`)
    .join('');

  const bars = buckets
    .map((b, k) => {
      const x = L + k * bw + 1;
      const w = bw - 2;
      const top = y(b.count);
      const base = y(0);
      const r = Math.min(4, w / 2, base - top);
      const label = `${b.openLow ? 'до ' + short(b.to) : short(b.from) + '–' + short(b.to)}${b.openHigh ? ' и дороже' : ''} ₽: ${b.count} шт.`;
      const d =
        b.count > 0
          ? `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`
          : '';
      return `<g data-tip="${esc(label)}"><rect class="hit" x="${x - 1}" y="${T}" width="${bw}" height="${H - T - B}" fill="transparent"/>${
        d ? `<path class="bar" d="${d}"/>` : ''
      }</g>`;
    })
    .join('');

  const every = buckets.length > 8 ? 2 : 1;
  const lastLabelled = (buckets.length - 1) % every === 0;
  const xLabels =
    buckets
      .map((b, k) => (k % every === 0 ? `<text x="${L + k * bw}" y="${H - B + 16}" text-anchor="middle">${short(b.from)}</text>` : ''))
      .join('') +
    (lastLabelled && bw < 70 ? '' : `<text x="${W - R}" y="${H - B + 16}" text-anchor="end">${short(buckets.at(-1).to)}</text>`);

  let marker = '';
  if (main) {
    const lo = buckets[0].from;
    const hi = buckets.at(-1).to;
    if (main.median >= lo && main.median <= hi) {
      const mx = L + ((main.median - lo) / (hi - lo)) * (W - L - R);
      marker = `<line class="marker" x1="${mx}" x2="${mx}" y1="${T - 6}" y2="${H - B}"/>
        <text class="marker-label" x="${mx + 5}" y="${T + 4}">медиана ${short(main.median)} ₽</text>`;
    }
  }

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Гистограмма цен">${grid}${bars}${marker}
    <line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--text-3)"/>${xLabels}</svg>
    <div class="small">Ось X — цена, ₽; ось Y — число объявлений. Крайние столбцы включают выбросы.</div>`;
}

function histogramTable(buckets) {
  if (!buckets) return '';
  return `<details><summary>Таблица</summary><table><thead><tr><th>Цена, ₽</th><th class="n">Объявлений</th></tr></thead><tbody>${buckets
    .map((b) => `<tr><td>${b.openLow ? 'до ' + num(b.to) : num(b.from) + ' – ' + num(b.to)}${b.openHigh ? ' и дороже' : ''}</td><td class="n">${b.count}</td></tr>`)
    .join('')}</tbody></table></details>`;
}

function niceMax(v) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

function markdown(src) {
  const out = [];
  let list = null;
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const line of src.split(/\r?\n/)) {
    const t = line.trim();
    let m;
    if (!t) close();
    else if ((m = t.match(/^#{1,6}\s+(.*)/))) {
      close();
      out.push(`<h3>${inline(m[1])}</h3>`);
    } else if ((m = t.match(/^(?:[-*•]|\d+[.)])\s+(.*)/))) {
      const kind = /^\d/.test(t) ? 'ol' : 'ul';
      if (list !== kind) {
        close();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline(m[1])}</li>`);
    } else {
      close();
      out.push(`<p>${inline(t)}</p>`);
    }
  }
  close();
  return out.join('');
}
