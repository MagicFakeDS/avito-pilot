import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildWorkbook, excelName } from './excel.js';

const KEEP_PER_REPORT = 20;
const TOKEN = /^[a-f0-9]{32}$/;

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export function signJwt(payload, secret) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

export function verifyJwt(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const expect = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  const got = fromB64url(parts[2]);
  if (got.length !== expect.length || !crypto.timingSafeEqual(got, expect)) return null;
  try {
    const head = JSON.parse(fromB64url(parts[0]).toString('utf8'));
    if (head.alg !== 'HS256') return null;
    return JSON.parse(fromB64url(parts[1]).toString('utf8'));
  } catch {
    return null;
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);
const scriptJson = (v) => JSON.stringify(v).split('<').join('\\u003c').split(LINE_SEP).join('\\u2028').split(PARA_SEP).join('\\u2029');

export function createDocs({ dataDir, publicUrl, docsUrl, secret, fetchImpl = fetch }) {
  const enabled = Boolean(publicUrl && docsUrl && secret);
  const base = String(publicUrl || '').replace(/\/+$/, '');
  const docsBase = String(docsUrl || '').replace(/\/+$/, '');
  const dir = path.join(dataDir, 'docs');
  const indexFile = path.join(dir, 'index.json');
  fs.mkdirSync(dir, { recursive: true });

  let index = {};
  const refresh = () => {
    try {
      index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    } catch {
      index = {};
    }
  };
  const save = () => {
    fs.writeFileSync(indexFile + '.tmp', JSON.stringify(index));
    fs.renameSync(indexFile + '.tmp', indexFile);
  };
  const fileOf = (token) => path.join(dir, `${token}.xlsx`);
  const linkOf = (token) => `${base}/r/${token}`;
  const fileUrl = (token) => `${base}/r/${token}.xlsx`;

  async function publish(report, { now = new Date() } = {}) {
    if (!enabled) return null;
    refresh();
    const token = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(fileOf(token), await buildWorkbook(report, { now }));
    index[token] = { reportId: report.id, title: excelName(report, now), createdAt: new Date(now).toISOString(), version: 1 };

    const mine = Object.entries(index)
      .filter(([, d]) => d.reportId === report.id)
      .sort((a, b) => b[1].createdAt.localeCompare(a[1].createdAt));
    for (const [old] of mine.slice(KEEP_PER_REPORT)) {
      fs.rmSync(fileOf(old), { force: true });
      delete index[old];
    }
    save();
    return { token, url: linkOf(token) };
  }

  function latest(reportId) {
    refresh();
    const found = Object.entries(index)
      .filter(([, d]) => d.reportId === reportId)
      .sort((a, b) => b[1].createdAt.localeCompare(a[1].createdAt))[0];
    return found ? { token: found[0], url: linkOf(found[0]), createdAt: found[1].createdAt } : null;
  }

  function file(token) {
    refresh();
    if (!TOKEN.test(token) || !index[token]) return null;
    try {
      return fs.readFileSync(fileOf(token));
    } catch {
      return null;
    }
  }

  function editorPage(token, { mobile = false } = {}) {
    refresh();
    const d = TOKEN.test(token) && index[token];
    if (!enabled || !d) return null;
    const config = {
      document: {
        fileType: 'xlsx',
        key: `${token}-${d.version}`,
        title: d.title,
        url: fileUrl(token),
        permissions: { edit: true, download: true, print: true, comment: false, review: false },
      },
      documentType: 'cell',
      editorConfig: {
        callbackUrl: `${base}/r/${token}/callback`,
        lang: 'ru',
        mode: 'edit',
        user: { id: 'guest', name: 'Гость' },
        customization: { compactHeader: true, toolbarNoTabs: false, forcesave: false, chat: false, comments: false },
      },
      type: mobile ? 'mobile' : 'desktop',
      width: '100%',
      height: '100%',
    };
    config.token = signJwt(config, secret);
    return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>${esc(d.title)}</title>
<style>html,body{margin:0;height:100%;overflow:hidden;font-family:system-ui,sans-serif}#editor{height:100%}#err{display:none;padding:24px}</style>
</head><body>
<div id="editor"></div>
<div id="err">Редактор не загрузился. <a href="${esc(fileUrl(token))}" download>Скачать Excel-файл</a></div>
<script src="${esc(docsBase)}/web-apps/apps/api/documents/api.js"></script>
<script>
  const config = ${scriptJson(config)};
  if (window.DocsAPI) new DocsAPI.DocEditor('editor', config);
  else document.getElementById('err').style.display = 'block';
</script>
</body></html>`;
  }

  async function callback(token, body, authHeader = '') {
    refresh();
    if (!enabled || !TOKEN.test(token) || !index[token]) return { error: 1 };
    const fromHeader = verifyJwt(String(authHeader).replace(/^Bearer\s+/i, ''), secret);
    const data = (body?.token && verifyJwt(body.token, secret)) || fromHeader?.payload || fromHeader;
    if (!data || typeof data !== 'object') return { error: 1 };
    if ((data.status === 2 || data.status === 6) && data.url) {
      const url = new URL(data.url);
      if (url.host !== new URL(docsBase).host) return { error: 1 };
      const res = await fetchImpl(url);
      if (!res.ok) return { error: 1 };
      fs.writeFileSync(fileOf(token), Buffer.from(await res.arrayBuffer()));
      index[token].version += 1;
      index[token].savedAt = new Date().toISOString();
      save();
    }
    return { error: 0 };
  }

  const title = (token) => (refresh(), (TOKEN.test(token) && index[token]?.title) || '');

  async function update(token, report, { now = new Date() } = {}) {
    refresh();
    if (!enabled || !TOKEN.test(token) || index[token]?.reportId !== report.id) return null;
    fs.writeFileSync(fileOf(token), await buildWorkbook(report, { now }));
    index[token].version += 1;
    index[token].updatedAt = new Date(now).toISOString();
    save();
    return { token, url: linkOf(token) };
  }

  return { enabled, publish, update, latest, file, title, editorPage, callback };
}
