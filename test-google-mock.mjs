// Test de la synchro Google avec un faux Google (aucun réseau). Lancer : DATA_DIR=/tmp/people-t node test-google-mock.mjs
import assert from 'node:assert/strict';
import { insert, all, get, setSetting } from './db.js';
import * as google from './google.js';
import { ymd, today, addDays } from './logic.js';

const calls = [];
const events = new Map(); // id -> event
const yesterday = addDays(ymd(today()), -1);
events.set('ext1', { id: 'ext1', status: 'confirmed', summary: 'Café', start: { date: yesterday }, end: { date: addDays(yesterday, 1) },
  attendees: [{ email: 'me@x.com', self: true }, { email: 'alice@x.com' }] });
events.set('ext2', { id: 'ext2', status: 'confirmed', summary: 'Dîner avec Bob Martin', start: { date: yesterday }, end: { date: addDays(yesterday, 1) } });
events.set('ext3', { id: 'ext3', status: 'confirmed', summary: 'Réunion', start: { date: yesterday }, end: { date: addDays(yesterday, 1) },
  attendees: [{ email: 'alice@x.com' }, { email: 'me@x.com', self: true, responseStatus: 'declined' }] });

globalThis.fetch = async (url, opts = {}) => {
  url = String(url); const method = opts.method || 'GET'; calls.push(`${method} ${url.split('?')[0]}`);
  const json = (o, status = 200) => ({ ok: status < 400, status, json: async () => o, text: async () => JSON.stringify(o) });
  if (url.includes('oauth2.googleapis.com/token')) return json({ access_token: 'AT', expires_in: 3600 });
  if (url.includes('people.googleapis.com')) return json({ connections: [
    { resourceName: 'people/1', names: [{ givenName: 'Alice', familyName: 'Durand' }], emailAddresses: [{ value: 'alice@x.com' }], birthdays: [{ date: { month: 5, day: 17, year: 1990 } }] },
    { resourceName: 'people/2', names: [{ givenName: 'Nouveau', familyName: 'Venu' }], phoneNumbers: [{ value: '0601' }] }] });
  if (url.includes('/calendar/v3/')) {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (method === 'POST') { const id = 'ev' + (events.size + 1); events.set(id, { id, status: 'confirmed', ...body }); return json({ id }); }
    if (method === 'PATCH') { const id = url.split('/events/')[1].split('?')[0]; if (!events.has(id)) return json({}, 404); Object.assign(events.get(id), body); return json({ id }); }
    if (method === 'DELETE') { const id = url.split('/events/')[1]; const e = events.get(id); if (e) e.status = 'cancelled'; return { ok: true, status: 204, json: async () => ({}) }; }
    return json({ items: [...events.values()] });
  }
  return json({}, 404);
};

setSetting('google', { client_id: 'a', client_secret: 'b', tokens: { access_token: 'AT', refresh_token: 'RT', expires_at: Date.now() + 1e6 } });
const alice = insert('contacts', { first_name: 'Alice', last_name: 'Durand', email: 'alice@x.com' });
const bob = insert('contacts', { first_name: 'Bob', last_name: 'Martin', birth_month: 3, birth_day: 2 });
insert('visits', { contact_id: bob, date: '2026-10-01', note: 'Ciné', source: 'manual' });

events.set('bd1', { id: 'bd1', status: 'confirmed', summary: 'Anniversaire de Bob Martin', start: { date: yesterday }, end: { date: addDays(yesterday, 1) } });
events.set('bd2', { id: 'bd2', status: 'confirmed', summary: 'Fête', eventType: 'birthday', start: { date: yesterday }, end: { date: addDays(yesterday, 1) }, attendees: [{ email: 'alice@x.com' }] });
insert('visits', { contact_id: bob, date: yesterday, note: 'Anniversaire de Bob', source: 'google', google_event_id: 'old' });

let r = await google.syncAll();
assert.deepEqual(r.errors, []);
assert.equal(r.contacts.created, 1, 'Alice existe déjà (email) → seul « Nouveau » est créé');
assert.equal(get('SELECT birth_month AS m FROM contacts WHERE id=?', alice).m, 5);
const v = all('SELECT * FROM visits ORDER BY id');
assert.ok(v.find((x) => x.contact_id === alice && x.google_event_id === 'ext1'), 'ext1 → visite Alice (email)');
assert.ok(v.find((x) => x.contact_id === bob && x.google_event_id === 'ext2'), 'ext2 → visite Bob (nom dans le titre)');
assert.ok(!v.find((x) => x.google_event_id === 'ext3'), 'ext3 refusé → ignoré');
assert.ok(!v.find((x) => ['bd1', 'bd2', 'old'].includes(x.google_event_id)), 'anniversaires ≠ visites (et ancien nettoyé)');
assert.ok(!calls.some((c) => /^(POST|PATCH|DELETE) .*calendar/.test(c)), "aucune écriture dans l'agenda");

const n = all('SELECT * FROM visits').length;
await google.syncAll();
assert.equal(all('SELECT * FROM visits').length, n, 'pas de doublons');

events.get('ext1').status = 'cancelled';
await google.syncAll();
assert.ok(!all('SELECT * FROM visits').find((x) => x.google_event_id === 'ext1'), 'supprimé dans Google → supprimé ici');
console.log('✅ synchro Google OK (lecture seule) —', calls.length, 'appels simulés');
