import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createDocs, signJwt, verifyJwt } from '../src/docs.js';

const report = (id = 'r1') => ({ id, name: 'диваны, Москва', items: { a: { id: '1', rank: 1, title: 'Диван', price: 10000, vas: ['xl'] } } });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-test-'));
let fetched = null;
const fetchImpl = async (url) => {
  fetched = String(url);
  return { ok: true, arrayBuffer: async () => new TextEncoder().encode('новая версия').buffer };
};
const docs = createDocs({ dataDir: dir, publicUrl: 'https://ez.test/docs/', docsUrl: 'https://ez.test/docs/office', secret: 'k', fetchImpl });

assert.equal(createDocs({ dataDir: dir }).enabled, false);
assert.equal(await createDocs({ dataDir: dir }).publish(report()), null);

const t = signJwt({ a: 1 }, 'k');
assert.deepEqual(verifyJwt(t, 'k'), { a: 1 });
assert.equal(verifyJwt(t, 'другой'), null);
assert.equal(verifyJwt(t.slice(0, -2) + 'xx', 'k'), null);
assert.equal(verifyJwt('мусор', 'k'), null);

const pub = await docs.publish(report(), { now: new Date('2026-10-17T18:05:00Z') });
assert.match(pub.url, /^https:\/\/ez\.test\/docs\/r\/[a-f0-9]{32}$/);
assert.equal(docs.latest('r1').url, pub.url);
assert.ok(docs.file(pub.token).length > 1000);
assert.equal(docs.title(pub.token), 'Отчёт диваны, Москва 17.10 21-05.xlsx');
assert.equal(docs.file('../../etc/passwd'), null);
assert.equal(docs.editorPage('0'.repeat(32)), null);
const page = docs.editorPage(pub.token);
const config = JSON.parse(page.match(/const config = (.*);/)[1]);
assert.equal(config.documentType, 'cell');
assert.equal(config.document.url, `https://ez.test/docs/r/${pub.token}.xlsx`);
assert.equal(config.editorConfig.callbackUrl, `https://ez.test/docs/r/${pub.token}/callback`);
assert.equal(config.editorConfig.lang, 'ru');
assert.equal(config.document.key, `${pub.token}-1`);
const { token: signed, ...unsigned } = config;
assert.deepEqual(verifyJwt(signed, 'k'), unsigned, 'настройки редактора подписаны');
assert.equal(docs.editorPage(pub.token, { mobile: true }).includes('"type":"mobile"'), true);

const before = docs.file(pub.token);
assert.deepEqual(await docs.callback(pub.token, { status: 2, url: 'https://ez.test/docs/office/cache/x.xlsx' }), { error: 1 });
assert.deepEqual(await docs.callback(pub.token, { token: signJwt({ status: 2, url: 'https://evil.test/x.xlsx' }, 'k') }), { error: 1 });
assert.equal(fetched, null);
assert.deepEqual(docs.file(pub.token), before);
assert.deepEqual(await docs.callback(pub.token, { token: signJwt({ status: 1 }, 'k') }), { error: 0 }, 'кто-то редактирует — просто ок');
assert.deepEqual(await docs.callback(pub.token, { token: signJwt({ status: 2, url: 'https://ez.test/docs/office/cache/x.xlsx' }, 'k') }), { error: 0 });
assert.equal(fetched, 'https://ez.test/docs/office/cache/x.xlsx');
assert.equal(docs.file(pub.token).toString('utf8'), 'новая версия');
assert.match(docs.editorPage(pub.token), new RegExp(`"key":"${pub.token}-2"`), 'после сохранения — новый ключ версии');

assert.deepEqual(await docs.callback(pub.token, {}, `Bearer ${signJwt({ payload: { status: 4 } }, 'k')}`), { error: 0 });

const upd = await docs.publish(report('r3'));
assert.equal((await docs.update(upd.token, report('r3'))).url, upd.url);
assert.match(docs.editorPage(upd.token), new RegExp(`"key":"${upd.token}-2"`));
assert.equal(await docs.update(upd.token, report('другая')), null);

for (let i = 0; i < 21; i++) await docs.publish(report('r2'), { now: new Date(Date.UTC(2026, 9, 17, 10, i)) });
const r2 = JSON.parse(fs.readFileSync(path.join(dir, 'docs', 'index.json'), 'utf8'));
assert.equal(Object.values(r2).filter((d) => d.reportId === 'r2').length, 20);
assert.equal(fs.readdirSync(path.join(dir, 'docs')).filter((f) => f.endsWith('.xlsx')).length, 22, '20 у r2, по 1 у r1 и r3');

console.log('Онлайн-отчёты: ссылка, редактор, подпись и сохранение — всё совпало');
