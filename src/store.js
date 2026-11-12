import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class Store {
  constructor(file) {
    this.file = file;
    this.db = { reports: {}, users: {} };
    this.saveTimer = null;
    if (fs.existsSync(file)) {
      this.db = { users: {}, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }

    for (const r of Object.values(this.db.reports)) {
      for (const run of r.runs || []) {
        if (run.status === 'running') Object.assign(run, { status: 'error', error: 'Прервано перезапуском бота', finishedAt: new Date().toISOString() });
      }
    }
  }

  addRun(reportId, { kind, question }) {
    const r = this.db.reports[reportId];
    if (!r) return null;
    const now = new Date().toISOString();
    const run = {
      id: crypto.randomBytes(3).toString('hex'),
      kind,
      question: String(question || '').slice(0, 500),
      status: 'running',
      startedAt: now,
      finishedAt: null,
      result: null,
      error: null,
    };
    (r.runs ||= []).push(run);
    if (r.runs.length > 50) r.runs.shift();
    r.updatedAt = now;
    this.scheduleSave();
    return run.id;
  }

  finishRun(reportId, runId, patch) {
    const run = this.getRun(reportId, runId);
    if (!run) return;
    const now = new Date().toISOString();
    Object.assign(run, patch, { finishedAt: now });
    if (typeof run.result === 'string') run.result = run.result.slice(0, 32000);
    this.db.reports[reportId].updatedAt = now;
    this.scheduleSave();
  }

  getRun(reportId, runId) {
    return this.db.reports[reportId]?.runs?.find((x) => x.id === runId) || null;
  }

  addChat(reportId, role, text) {
    const r = this.db.reports[reportId];
    if (!r || !text) return;
    (r.chat ||= []).push({ role, text: String(text).slice(0, 4000), at: new Date().toISOString() });
    if (r.chat.length > 60) r.chat.splice(0, r.chat.length - 60);
    this.scheduleSave();
  }

  getChat(reportId) {
    return this.db.reports[reportId]?.chat || [];
  }

  clearMarket(reportId, marketUrl) {
    const r = this.db.reports[reportId];
    if (!r) return;
    r.items = {};
    r.pages = [];
    r.marketUrl = marketUrl;
    this.scheduleSave();
  }

  setSchedule(reportId, patch) {
    const r = this.db.reports[reportId];
    if (!r) return null;
    r.schedule = { times: [], pages: 2, done: [], ...r.schedule, ...patch };
    r.schedule.times = [...new Set(r.schedule.times)].sort();
    r.schedule.done = r.schedule.done.slice(-20);
    this.scheduleSave();
    return r.schedule;
  }

  listScheduled() {
    return Object.values(this.db.reports).filter((r) => r.ownerId && r.marketUrl && r.schedule?.times?.length);
  }

  snapshotFile(reportId) {
    return path.join(path.dirname(this.file), 'snapshots', `${String(reportId).replace(/[^\w-]/g, '')}.json`);
  }

  getSnapshots(reportId) {
    try {
      return JSON.parse(fs.readFileSync(this.snapshotFile(reportId), 'utf8'));
    } catch {
      return [];
    }
  }

  addSnapshot(reportId, snapshot, keep = 30) {
    const file = this.snapshotFile(reportId);
    const list = [...this.getSnapshots(reportId), snapshot].slice(-keep);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(list));
    fs.renameSync(file + '.tmp', file);
    return list.length;
  }

  getUser(userId) {
    return this.db.users[userId] || {};
  }

  updateUser(userId, patch) {
    this.db.users[userId] = { ...this.getUser(userId), ...patch };
    this.scheduleSave();
    return this.db.users[userId];
  }

  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.db));
    fs.renameSync(tmp, this.file);
  }

  scheduleSave() {
    if (!this.saveTimer) this.saveTimer = setTimeout(() => this.flush(), 300);
  }

  listReports(ownerId = null) {
    return Object.values(this.db.reports)
      .filter((r) => (r.ownerId ?? null) === ownerId)
      .map(summary)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getReport(id) {
    return this.db.reports[id] || null;
  }

  createReport(name, ownerId = null) {
    const now = new Date().toISOString();
    const report = {
      id: crypto.randomBytes(8).toString('hex'),
      ownerId,
      name: String(name || '').trim().slice(0, 120) || `Отчёт ${now.slice(0, 10)}`,
      createdAt: now,
      updatedAt: now,
      pages: [],
      items: {},
      ai: null,
    };
    this.db.reports[report.id] = report;
    this.scheduleSave();
    return summary(report);
  }

  renameReport(id, name) {
    const r = this.db.reports[id];
    if (!r) return;
    r.name = String(name || '').trim().slice(0, 120) || r.name;
    this.scheduleSave();
  }

  deleteReport(id) {
    const ok = Boolean(this.db.reports[id]);
    delete this.db.reports[id];
    fs.rmSync(this.snapshotFile(id), { force: true });
    this.scheduleSave();
    return ok;
  }

  addPage(id, { meta, items }) {
    const report = this.db.reports[id];
    if (!report) return null;
    const now = new Date().toISOString();
    let added = 0;
    let updated = 0;

    for (const raw of items) {
      const item = sanitizeItem(raw);
      if (!item) continue;
      const prev = report.items[item.id];
      if (prev) {
        report.items[item.id] = {
          ...prev,
          ...item,
          page: prev.page,
          position: prev.position,
          rank: prev.rank,
          firstSeen: prev.firstSeen,
          lastSeen: now,
          seenCount: prev.seenCount + 1,
        };
        updated++;
      } else {
        report.items[item.id] = { ...item, firstSeen: now, lastSeen: now, seenCount: 1 };
        added++;
      }
    }

    report.pages.push({
      page: toInt(meta?.page) || 1,
      title: String(meta?.title || '').slice(0, 300),
      total: toInt(meta?.total),
      count: items.length,
      added,
      collectedAt: now,
    });
    report.updatedAt = now;
    this.scheduleSave();
    return { added, updated, total: Object.keys(report.items).length };
  }

  setItemDetails(id, byItem) {
    const report = this.db.reports[id];
    if (!report) return 0;
    let n = 0;
    for (const [itemId, d] of Object.entries(byItem)) {
      const it = report.items[itemId];
      if (!it || !d) continue;
      Object.assign(it, sanitizeDetails(d));
      if (d.description) it.description = str(d.description, 3000);
      n++;
    }
    this.scheduleSave();
    return n;
  }

  setAi(id, ai) {
    const report = this.db.reports[id];
    if (!report) return;
    report.ai = ai;
    this.scheduleSave();
  }
}

function summary(r) {
  const last = r.pages.at(-1);
  const lastRun = r.runs?.at(-1);
  return {
    id: r.id,
    name: r.name,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    itemCount: Object.keys(r.items).length,
    pageCount: new Set(r.pages.map((p) => p.page)).size,
    query: last?.title || '',

    status: lastRun?.status || 'new',
    runCount: r.runs?.length || 0,
  };
}

const toInt = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.round(Number(v)) : null);
const toNum = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
const str = (v, max = 300) => (v == null ? '' : String(v).trim().slice(0, max));

const isoOrEmpty = (v) => (/^\d{4}-\d\d-\d\dT[\d:.]+(Z|[+-]\d\d:\d\d)$/.test(String(v || '')) ? new Date(v).toISOString() : '');

function sanitizeDetails(raw) {
  return {
    views: toInt(raw.views),
    viewsToday: toInt(raw.viewsToday),
    publishedAt: isoOrEmpty(raw.publishedAt),
    sellerSince: str(raw.sellerSince, 60),
    sellerType: ['company', 'shop', 'person'].includes(raw.sellerType) ? raw.sellerType : '',
    sellerListings: toInt(raw.sellerListings),
    detailsAt: isoOrEmpty(raw.detailsAt),
  };
}

function sanitizeItem(raw) {
  if (!raw || !/^[\w-]{3,40}$/.test(String(raw.id))) return null;
  return {
    id: String(raw.id),
    title: str(raw.title, 300),
    url: str(raw.url, 500),
    price: toNum(raw.price),
    priceText: str(raw.priceText, 100),
    priceUnit: str(raw.priceUnit, 60),
    oldPrice: toNum(raw.oldPrice),
    location: str(raw.location, 150),
    date: str(raw.date, 60),
    sellerId: str(raw.sellerId, 80),
    sellerName: str(raw.sellerName, 150),
    sellerRating: toNum(raw.sellerRating),
    sellerReviews: toInt(raw.sellerReviews),
    badges: Array.isArray(raw.badges) ? raw.badges.slice(0, 15).map((b) => str(b, 60)).filter(Boolean) : [],
    promoted: Boolean(raw.promoted),
    xl: Boolean(raw.xl),
    delivery: Boolean(raw.delivery),
    photos: toInt(raw.photos) || 0,

    bumpedAt: /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(String(raw.bumpedAt || '')) ? raw.bumpedAt : '',
    vas: Array.isArray(raw.vas) ? raw.vas.slice(0, 10).map((v) => str(v, 40)).filter(Boolean) : [],
    closedItems: toInt(raw.closedItems),
    priceLowered: Boolean(raw.priceLowered),
    description: str(raw.description, 3000),
    rating: toNum(raw.rating),
    reviews: toInt(raw.reviews),
    brand: str(raw.brand, 80),
    site: str(raw.site, 40),
    address: str(raw.address, 200),
    category: str(raw.category, 100),
    images: Array.isArray(raw.images) ? raw.images.filter((u) => /^https:\/\/[\w.-]+\.avito\.st\//.test(u)).slice(0, 10).map((u) => str(u, 400)) : [],
    ...sanitizeDetails(raw),
    page: toInt(raw.page) || 1,
    position: toInt(raw.position) || 0,
    rank: toInt(raw.rank) || 0,
  };
}
