// Synchro Google (Agenda + Contacts) sans dépendance : OAuth2 + fetch.
import crypto from 'node:crypto';
import { all, get, run, insert, update, getSetting, setSetting, savePhoto } from './db.js';
import { ymd, parseYmd, addDays, today, pad } from './logic.js';

const SCOPES = [
  'openid', 'email',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/contacts.readonly',
].join(' ');

export const DEFAULT_OPTIONS = {
  importContacts: true,     // Google Contacts -> fiches (noms, photos, anniversaires, emails)
  pullEvents: true,         // événements passés avec un contact -> visites
  matchByName: true,        // reconnaît aussi le nom complet dans le titre
  maxAttendees: 12,         // ignore les gros événements (réunions...)
  lookbackDays: 730,
};

const cfg = () => getSetting('google', {});
const save = (patch) => setSetting('google', { ...cfg(), ...patch });
export const options = () => ({ ...DEFAULT_OPTIONS, ...(cfg().options || {}) });

export function redirectUri(port) {
  const base = (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, '');
  return `${base}/auth/google/callback`;
}

export function status(port) {
  const c = cfg();
  return {
    has_credentials: !!(c.client_id && c.client_secret),
    client_id: c.client_id || '',
    connected: !!c.tokens?.refresh_token,
    email: c.email || null,
    last_sync: c.last_sync || null,
    last_result: c.last_result || null,
    options: options(),
    redirect_uri: redirectUri(port),
  };
}

export function saveCredentials({ client_id, client_secret, options: o }) {
  const patch = {};
  if (client_id !== undefined) patch.client_id = client_id.trim();
  if (client_secret) patch.client_secret = client_secret.trim();
  if (o) patch.options = { ...options(), ...o };
  save(patch);
}

export function authUrl(port) {
  const c = cfg();
  if (!c.client_id || !c.client_secret) throw new Error('Renseigne d\'abord le Client ID et le Client secret.');
  const state = crypto.randomBytes(16).toString('hex');
  save({ oauth_state: state });
  const p = new URLSearchParams({
    client_id: c.client_id, redirect_uri: redirectUri(port), response_type: 'code',
    scope: SCOPES, access_type: 'offline', prompt: 'consent', state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function tokenRequest(params) {
  const c = cfg();
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, ...params }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.error || 'Erreur OAuth');
  return j;
}

export async function handleCallback(port, code, state) {
  const c = cfg();
  if (!state || state !== c.oauth_state) throw new Error('État OAuth invalide.');
  const t = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: redirectUri(port) });
  const tokens = {
    access_token: t.access_token,
    refresh_token: t.refresh_token || c.tokens?.refresh_token,
    expires_at: Date.now() + (t.expires_in - 60) * 1000,
  };
  let email = null;
  try {
    const u = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${tokens.access_token}` } })).json();
    email = u.email || null;
  } catch {}
  save({ tokens, email, oauth_state: null });
}

export function disconnect() { save({ tokens: null, email: null }); }

async function accessToken() {
  const c = cfg();
  if (!c.tokens?.refresh_token) throw new Error('Google non connecté.');
  if (c.tokens.access_token && c.tokens.expires_at > Date.now()) return c.tokens.access_token;
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: c.tokens.refresh_token });
  save({ tokens: { ...c.tokens, access_token: t.access_token, expires_at: Date.now() + (t.expires_in - 60) * 1000 } });
  return t.access_token;
}

async function g(url, { method = 'GET', body, okStatuses = [] } = {}) {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${await accessToken()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  if (!res.ok && !okStatuses.includes(res.status)) {
    const t = await res.text();
    throw new Error(`Google ${res.status}: ${t.slice(0, 300)}`);
  }
  return res.status === 404 || res.status === 410 ? null : res.json();
}

const BIRTHDAY_RE = /anniv|birthday|🎂|🎉/i;
const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const emailsOf = (c) => String(c.email || '').split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
const nameOf = (c) => [c.first_name, c.last_name].filter(Boolean).join(' ');

// ---------- 1. Google Contacts -> fiches ----------
async function importContacts(res) {
  let pageToken, created = 0, updated = 0;
  const local = () => all('SELECT * FROM contacts');
  do {
    const url = 'https://people.googleapis.com/v1/people/me/connections?' + new URLSearchParams({
      personFields: 'names,emailAddresses,phoneNumbers,birthdays,photos,nicknames', pageSize: '500', ...(pageToken ? { pageToken } : {}),
    });
    const data = await g(url);
    for (const p of data?.connections || []) {
      const nm = p.names?.[0];
      if (!nm?.givenName && !nm?.familyName && !nm?.displayName) continue;
      const first = nm.givenName || nm.displayName || '';
      const last = nm.familyName || '';
      const emails = (p.emailAddresses || []).map((e) => e.value.toLowerCase());
      const phone = p.phoneNumbers?.[0]?.value || null;
      const b = (p.birthdays || []).find((x) => x.date?.month && x.date?.day)?.date;
      const photo = (p.photos || []).find((x) => x.metadata?.primary && !x.default) || null;
      const rows = local();
      let c = rows.find((r) => r.google_resource === p.resourceName)
        || rows.find((r) => emails.length && emailsOf(r).some((e) => emails.includes(e)))
        || rows.find((r) => norm(nameOf(r)) === norm(`${first} ${last}`));
      if (!c) {
        const id = insert('contacts', {
          first_name: first, last_name: last || null, email: emails.join(', ') || null, phone,
          birth_month: b?.month ?? null, birth_day: b?.day ?? null, birth_year: b?.year ?? null,
          nickname: p.nicknames?.[0]?.value ?? null, google_resource: p.resourceName,
        });
        c = get('SELECT * FROM contacts WHERE id=?', id);
        created++;
      } else {
        const patch = {};
        if (!c.google_resource) patch.google_resource = p.resourceName;
        const merged = [...new Set([...emailsOf(c), ...emails])];
        if (merged.length !== emailsOf(c).length) patch.email = merged.join(', ');
        if (!c.phone && phone) patch.phone = phone;
        if (!c.birth_month && b) Object.assign(patch, { birth_month: b.month, birth_day: b.day, birth_year: b.year ?? null });
        if (Object.keys(patch).length) { update('contacts', c.id, patch); updated++; }
      }
      if (photo && !c.photo) {
        try {
          const r = await fetch(photo.url.replace(/=s\d+$/, '=s400'));
          if (r.ok) savePhoto(c.id, Buffer.from(await r.arrayBuffer()), 'jpg');
        } catch {}
      }
    }
    pageToken = data?.nextPageToken;
  } while (pageToken);
  res.contacts = { created, updated };
}

// ---------- agenda -> visites ----------
function eventDate(e) {
  if (e.start?.date) return e.start.date;
  return e.start?.dateTime ? ymd(new Date(e.start.dateTime)) : null;
}
function eventEnded(e) {
  if (e.start?.date) return e.start.date <= ymd(today());
  return e.end?.dateTime ? new Date(e.end.dateTime) <= new Date() : false;
}

async function pullEvents(res) {
  const o = options();
  const contacts = all('SELECT * FROM contacts');
  const byEmail = new Map();
  for (const c of contacts) for (const e of emailsOf(c)) byEmail.set(e, c);
  const named = contacts.filter((c) => c.last_name && c.first_name).map((c) => ({ c, n: norm(nameOf(c)) }));
  const ignored = new Set(all('SELECT * FROM ignored_events').map((r) => `${r.contact_id}:${r.google_event_id}`));
  const pendingDel = new Set(all('SELECT event_id FROM pending_deletes').map((r) => r.event_id));
  const timeMin = new Date(Date.now() - o.lookbackDays * 864e5).toISOString();
  let pageToken, imported = 0, updated = 0, removed = 0;
  for (const v of all(`SELECT id, note FROM visits WHERE source='google'`)) {
    if (BIRTHDAY_RE.test(v.note || '')) { run('DELETE FROM visits WHERE id=?', v.id); removed++; }
  }
  do {
    const url = CAL + '?' + new URLSearchParams({
      timeMin, timeMax: new Date().toISOString(), singleEvents: 'true', showDeleted: 'true', maxResults: '2500',
      ...(pageToken ? { pageToken } : {}),
    });
    const data = await g(url);
    for (const e of data?.items || []) {
      const priv = e.extendedProperties?.private || {};
      if (pendingDel.has(e.id)) continue;
      // événements créés par cette appli
      if (priv.people_app) {
        if (!priv.people_visit) continue; // anniversaires
        const linked = all('SELECT * FROM visits WHERE google_event_id=?', e.id);
        if (!linked.length) continue;
        if (e.status === 'cancelled') { run('DELETE FROM visits WHERE google_event_id=?', e.id); removed++; continue; }
        const d = eventDate(e);
        if (d && linked[0].date !== d && !linked[0].dirty) { run('UPDATE visits SET date=? WHERE google_event_id=?', d, e.id); updated++; }
        continue;
      }
      if (e.status === 'cancelled') {
        const r = run(`DELETE FROM visits WHERE google_event_id=? AND source='google'`, e.id);
        removed += Number(r.changes);
        continue;
      }
      if (e.eventType === 'birthday' || BIRTHDAY_RE.test(e.summary || '')) continue; // un anniversaire n'est pas une visite
      const date = eventDate(e);
      if (!date || !eventEnded(e)) continue;
      const attendees = e.attendees || [];
      if (attendees.length > o.maxAttendees) continue;
      if (attendees.some((a) => a.self && a.responseStatus === 'declined')) continue;
      const matched = new Map();
      for (const a of attendees) {
        if (a.self || !a.email) continue;
        const c = byEmail.get(a.email.toLowerCase());
        if (c) matched.set(c.id, c);
      }
      if (o.matchByName) {
        const text = norm(`${e.summary || ''} ${e.description || ''}`);
        for (const { c, n } of named) if (n.length > 5 && text.includes(n)) matched.set(c.id, c);
      }
      for (const c of matched.values()) {
        if (ignored.has(`${c.id}:${e.id}`)) continue;
        if (get('SELECT 1 AS x FROM visits WHERE contact_id=? AND google_event_id=?', c.id, e.id)) continue;
        insert('visits', { contact_id: c.id, date, note: e.summary || null, source: 'google', google_event_id: e.id });
        imported++;
      }
    }
    pageToken = data?.nextPageToken;
  } while (pageToken);
  res.events = { imported, updated, removed };
}

// ---------- orchestration ----------
let running = false;
export async function syncAll() {
  if (running) throw new Error('Une synchro est déjà en cours.');
  running = true;
  const o = options();
  const res = { errors: [], started: new Date().toISOString() };
  try {
    const steps = [
      [o.importContacts, importContacts, 'Contacts'],
      [o.pullEvents, pullEvents, 'Agenda → visites'],
    ];
    for (const [on, fn, label] of steps) {
      if (!on) continue;
      try { await fn(res); } catch (e) { res.errors.push(`${label} : ${e.message}`); }
    }
  } finally { running = false; }
  save({ last_sync: new Date().toISOString(), last_result: res });
  return res;
}

export const isConnected = () => !!cfg().tokens?.refresh_token;
