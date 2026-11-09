import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, all, get, run, insert, update, tx, getSetting, setSetting, savePhoto, PHOTO_DIR, DATA_DIR } from './db.js';
import {
  CATEGORIES, thresholds, contactRows, decorate, birthdayGifts, christmasGifts, christmasSummary,
  ymd, today, diffDays, parseYmd,
} from './logic.js';
import * as google from './google.js';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1'; // 0.0.0.0 dans Docker
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

// ---------- mini routeur ----------
const routes = [];
const route = (method, pattern, handler) =>
  routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler });
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => new HttpError(400, msg);
const notFound = () => new HttpError(404, 'Introuvable');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 15e6) { reject(bad('Corps trop gros')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(bad('JSON invalide')); } });
  });
}

// ---------- validation ----------
const int = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Math.round(Number(v)));
const num = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
const str = (v) => { const s = (v ?? '').toString().trim(); return s === '' ? null : s; };
const bool = (v) => (v === true || v === 1 || v === '1' || v === 'on' || v === 'true' ? 1 : 0);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const CAT_KEYS = new Set(CATEGORIES.map((c) => c.key));

function contactFields(b, partial = false) {
  const out = {};
  const set = (k, v) => { if (!partial || k in b) out[k] = v(b[k]); };
  set('first_name', (v) => str(v) || ''); set('last_name', str); set('nickname', str);
  set('email', str); set('phone', str); set('interests', str); set('notes', str);
  set('birth_month', int); set('birth_day', int); set('birth_year', int);
  set('category', (v) => (CAT_KEYS.has(v) ? v : null));
  set('freq_days', (v) => { const n = int(v); return n && n > 0 ? n : null; });
  set('track', (v) => (v === undefined ? 1 : bool(v)));
  set('gift_birthday', bool); set('gift_christmas', bool); set('hidden', bool);
  if (out.birth_month && (out.birth_month < 1 || out.birth_month > 12)) throw bad('Mois invalide');
  if (out.birth_day && (out.birth_day < 1 || out.birth_day > 31)) throw bad('Jour invalide');
  if ((out.birth_month == null) !== (out.birth_day == null) && !partial) { out.birth_month = null; out.birth_day = null; out.birth_year = null; }
  return out;
}

// ---------- API : méta ----------
route('GET', '/api/meta', () => ({
  categories: CATEGORIES.map((c) => ({ ...c, days: thresholds()[c.key] })),
  today: ymd(today()),
  google_connected: google.isConnected(),
}));

// ---------- API : contacts ----------
route('GET', '/api/contacts', () => contactRows({ withHidden: true }));

route('GET', '/api/contacts/:id', ({ params }) => {
  const row = get('SELECT * FROM contacts WHERE id=?', params.id);
  if (!row) throw notFound();
  const l = get(`SELECT MAX(date) AS d, MAX(CASE WHEN kind='visit' THEN date END) AS s, MAX(CASE WHEN kind='news' THEN date END) AS n FROM visits WHERE contact_id=?`, row.id);
  const c = decorate({ ...row, last_visit: l.d, last_seen: l.s, last_news: l.n });
  const visits = all('SELECT * FROM visits WHERE contact_id=? ORDER BY date DESC, id DESC', row.id);
  const gifts = all('SELECT * FROM gifts WHERE contact_id=? ORDER BY year DESC, id DESC', row.id);
  return { contact: c, visits, gifts };
});

route('POST', '/api/contacts', ({ body }) => {
  const f = contactFields(body);
  if (!f.first_name) throw bad('Le prénom est obligatoire');
  const id = insert('contacts', f);
  return get('SELECT * FROM contacts WHERE id=?', id);
});

route('PUT', '/api/contacts/:id', ({ params, body }) => {
  if (!get('SELECT 1 AS x FROM contacts WHERE id=?', params.id)) throw notFound();
  const f = contactFields(body, true);
  if ('first_name' in f && !f.first_name) throw bad('Le prénom est obligatoire');
  update('contacts', params.id, f);
  return get('SELECT * FROM contacts WHERE id=?', params.id);
});

function deleteContact(id) {
  const c = get('SELECT * FROM contacts WHERE id=?', id);
  if (!c) return false;
  run('DELETE FROM contacts WHERE id=?', c.id);
  if (c.photo) fs.rm(path.join(PHOTO_DIR, path.basename(c.photo)), () => {});
  return true;
}

route('DELETE', '/api/contacts/:id', ({ params }) => {
  if (!deleteContact(params.id)) throw notFound();
  return { ok: true };
});

// actions de masse
route('POST', '/api/contacts/bulk', ({ body }) => {
  const ids = [...new Set((body.ids || []).map(int).filter(Boolean))];
  if (!ids.length) throw bad('Aucun contact sélectionné');
  const { action, value } = body;
  const flag = { hide: ['hidden', 1], unhide: ['hidden', 0] };
  let patch;
  if (flag[action]) patch = { [flag[action][0]]: flag[action][1] };
  else if (action === 'category') patch = { category: CAT_KEYS.has(value) ? value : null };
  else if (['track', 'gift_birthday', 'gift_christmas'].includes(action)) patch = { [action]: bool(value) };
  else if (action === 'freq_days') { const n = int(value); patch = { freq_days: n && n > 0 ? n : null }; }
  else if (action !== 'delete') throw bad('Action inconnue');
  tx(() => { for (const id of ids) action === 'delete' ? deleteContact(id) : update('contacts', id, patch); });
  return { ok: true, count: ids.length };
});

route('POST', '/api/contacts/:id/photo', ({ params, body }) => {
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/.exec(body.dataUrl || '');
  if (!m) throw bad('Image invalide');
  if (!get('SELECT 1 AS x FROM contacts WHERE id=?', params.id)) throw notFound();
  return { photo: savePhoto(params.id, Buffer.from(m[2], 'base64'), m[1] === 'jpeg' ? 'jpg' : m[1]) };
});

route('DELETE', '/api/contacts/:id/photo', ({ params }) => {
  const c = get('SELECT photo FROM contacts WHERE id=?', params.id);
  if (c?.photo) fs.rm(path.join(PHOTO_DIR, path.basename(c.photo)), () => {});
  run('UPDATE contacts SET photo=NULL WHERE id=?', params.id);
  return { ok: true };
});

// ---------- API : visites ----------
route('POST', '/api/visits', ({ body }) => {
  const ids = (Array.isArray(body.contact_ids) ? body.contact_ids : [body.contact_id]).map(int).filter(Boolean);
  if (!ids.length) throw bad('Choisis au moins un contact');
  const date = isDate(body.date) ? body.date : ymd(today());
  const key = ids.length > 1 ? crypto.randomUUID() : null;
  return tx(() => ids.map((cid) => {
    if (!get('SELECT 1 AS x FROM contacts WHERE id=?', cid)) throw bad('Contact inconnu');
    return insert('visits', { contact_id: cid, date, kind: body.kind === 'news' ? 'news' : 'visit', note: str(body.note), source: 'manual', group_key: key });
  }));
});

route('PUT', '/api/visits/:id', ({ params, body }) => {
  const v = get('SELECT * FROM visits WHERE id=?', params.id);
  if (!v) throw notFound();
  const patch = {};
  if (body.date !== undefined) { if (!isDate(body.date)) throw bad('Date invalide'); patch.date = body.date; }
  if (body.note !== undefined) patch.note = str(body.note);
  if (body.kind !== undefined) patch.kind = body.kind === 'news' ? 'news' : 'visit';
  if (v.google_event_id && v.source === 'manual') patch.dirty = 1;
  update('visits', v.id, patch);
  // un événement partagé reste cohérent pour tous les contacts du groupe
  if (v.google_event_id && v.source === 'manual') run('UPDATE visits SET date=?, dirty=1 WHERE google_event_id=?', patch.date ?? v.date, v.google_event_id);
  return { ok: true };
});

route('DELETE', '/api/visits/:id', ({ params }) => {
  const v = get('SELECT * FROM visits WHERE id=?', params.id);
  if (!v) throw notFound();
  run('DELETE FROM visits WHERE id=?', v.id);
  if (v.google_event_id) {
    if (v.source === 'google') run('INSERT OR IGNORE INTO ignored_events VALUES(?,?)', v.contact_id, v.google_event_id);
  }
  return { ok: true };
});

// ---------- API : cadeaux ----------
function giftFields(b, partial = false) {
  const out = {};
  const set = (k, v) => { if (!partial || k in b) out[k] = v(b[k]); };
  set('contact_id', int); set('direction', (v) => (v === 'received' ? 'received' : 'given'));
  set('occasion', (v) => (['birthday', 'christmas'].includes(v) ? v : 'other'));
  set('year', (v) => int(v) || new Date().getFullYear());
  set('status', (v) => (['idea', 'bought', 'given'].includes(v) ? v : 'given'));
  set('description', (v) => str(v)); set('price', num); set('my_share', num);
  set('is_group', bool); set('co_givers', str); set('note', str);
  if ('description' in out && !out.description) throw bad('Décris le cadeau');
  if (out.direction === 'received') out.status = 'given';
  if (out.is_group === 0) { out.co_givers = null; out.my_share = null; }
  return out;
}

route('GET', '/api/gifts', ({ query }) => {
  const w = [], p = [];
  for (const k of ['contact_id', 'direction', 'occasion', 'year', 'status']) if (query.get(k)) { w.push(`g.${k}=?`); p.push(query.get(k)); }
  return all(`SELECT g.*, c.first_name, c.last_name, c.photo FROM gifts g JOIN contacts c ON c.id=g.contact_id
    ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY g.year DESC, g.id DESC`, ...p);
});

route('POST', '/api/gifts', ({ body }) => {
  const f = giftFields(body);
  if (!f.contact_id || !get('SELECT 1 AS x FROM contacts WHERE id=?', f.contact_id)) throw bad('Contact inconnu');
  return get('SELECT * FROM gifts WHERE id=?', insert('gifts', f));
});

route('PUT', '/api/gifts/:id', ({ params, body }) => {
  if (!get('SELECT 1 AS x FROM gifts WHERE id=?', params.id)) throw notFound();
  update('gifts', params.id, giftFields(body, true));
  return get('SELECT * FROM gifts WHERE id=?', params.id);
});

route('DELETE', '/api/gifts/:id', ({ params }) => { run('DELETE FROM gifts WHERE id=?', params.id); return { ok: true }; });

route('GET', '/api/gifts/overview', ({ query }) => {
  const year = int(query.get('year')) || new Date().getFullYear();
  const list = christmasGifts(year);
  return { year, christmas: list, christmas_summary: christmasSummary(list), birthdays: birthdayGifts(90) };
});

// ---------- API : dashboard ----------
route('GET', '/api/dashboard', ({ query }) => {
  const t = today();
  const contacts = contactRows();
  const showChristmas = t.getMonth() >= 10 || query.get('noel') === '1';
  const overdue = contacts.filter((c) => c.overdue).sort((a, b) => b.ratio - a.ratio);
  const birthdays = birthdayGifts(30);
  const year = t.getFullYear();
  const xmas = showChristmas ? christmasGifts(year) : null;
  return {
    today: ymd(t),
    stats: {
      contacts: contacts.length,
      tracked: contacts.filter((c) => c.tracked).length,
      overdue: overdue.length,
      birthdays30: birthdays.length,
      seen30: contacts.filter((c) => c.days_since !== null && c.days_since <= 30).length,
    },
    birthdays,
    overdue: overdue.slice(0, 40),
    overdue_total: overdue.length,
    christmas: xmas && { year, days_left: diffDays(t, new Date(year, 11, 25)), list: xmas, summary: christmasSummary(xmas) },
  };
});

// ---------- API : admin / réglages ----------
route('GET', '/api/settings', () => ({ categories: CATEGORIES.map((c) => ({ ...c, days: thresholds()[c.key] })) }));
route('PUT', '/api/settings/thresholds', ({ body }) => {
  const out = {};
  for (const c of CATEGORIES) if (c.key in body) { const n = int(body[c.key]); out[c.key] = n && n > 0 ? n : null; }
  setSetting('thresholds', { ...getSetting('thresholds', {}), ...out });
  return { ok: true };
});

route('GET', '/api/export', () => ({
  version: 1, exported_at: new Date().toISOString(),
  contacts: all('SELECT * FROM contacts'), visits: all('SELECT * FROM visits'), gifts: all('SELECT * FROM gifts'),
  thresholds: getSetting('thresholds', {}),
}));

route('POST', '/api/import', ({ body }) => {
  if (!Array.isArray(body.contacts)) throw bad('Fichier invalide');
  tx(() => {
    run('DELETE FROM gifts'); run('DELETE FROM visits'); run('DELETE FROM contacts');
    for (const [table, rows] of [['contacts', body.contacts], ['visits', body.visits || []], ['gifts', body.gifts || []]]) {
      for (const r of rows) {
        const o = { ...r };
        if (table === 'contacts') { o.google_birthday_event = null; o.google_birthday_sig = null; }
        if (table === 'visits') { o.google_event_id = null; o.dirty = 0; }
        insert(table, o);
      }
    }
    if (body.thresholds) setSetting('thresholds', body.thresholds);
  });
  return { ok: true, contacts: body.contacts.length };
});

// ---------- API : Google ----------
route('GET', '/api/google/status', () => google.status(PORT));
route('PUT', '/api/google/config', ({ body }) => {
  const o = {};
  if (body.options) {
    for (const [k, v] of Object.entries(body.options)) {
      if (!(k in google.DEFAULT_OPTIONS)) continue;
      o[k] = typeof google.DEFAULT_OPTIONS[k] === 'boolean' ? bool(v) === 1 : Math.max(1, int(v) || google.DEFAULT_OPTIONS[k]);
    }
  }
  google.saveCredentials({ client_id: body.client_id, client_secret: body.client_secret, options: o });
  return google.status(PORT);
});
route('POST', '/api/google/disconnect', () => { google.disconnect(); return google.status(PORT); });
route('POST', '/api/google/sync', async () => {
  if (!google.isConnected()) throw bad('Google non connecté');
  return google.syncAll();
});

// ---------- HTTP ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const send = (status, data, headers = {}) => {
    const isStr = typeof data === 'string' || Buffer.isBuffer(data);
    res.writeHead(status, { 'content-type': isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', ...headers });
    res.end(isStr ? data : JSON.stringify(data));
  };
  try {
    // OAuth Google
    if (url.pathname === '/auth/google/start') {
      res.writeHead(302, { location: google.authUrl(PORT) }); return res.end();
    }
    if (url.pathname === '/auth/google/callback') {
      try {
        if (url.searchParams.get('error')) throw new Error(url.searchParams.get('error'));
        await google.handleCallback(PORT, url.searchParams.get('code'), url.searchParams.get('state'));
        res.writeHead(302, { location: '/#/admin?google=ok' });
      } catch (e) {
        res.writeHead(302, { location: '/#/admin?google=' + encodeURIComponent(e.message) });
      }
      return res.end();
    }
    if (url.pathname.startsWith('/api/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
        const out = await r.handler({ params: m.groups || {}, body, query: url.searchParams });
        return send(200, out ?? { ok: true });
      }
      throw notFound();
    }
    // fichiers
    let file;
    if (url.pathname.startsWith('/photos/')) file = path.join(PHOTO_DIR, path.basename(url.pathname));
    else file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    const base = url.pathname.startsWith('/photos/') ? PHOTO_DIR : PUBLIC;
    if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) throw notFound();
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    send(e.status || 500, { error: e.message || 'Erreur serveur' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  People → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}\n  Données : ${DATA_DIR}\n`);
});

// synchro auto toutes les 20 minutes si Google est connecté
setInterval(() => { if (google.isConnected()) google.syncAll().catch((e) => console.error('sync:', e.message)); }, 20 * 60 * 1000);
