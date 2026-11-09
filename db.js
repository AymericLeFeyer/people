import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(here, 'data'));
export const PHOTO_DIR = path.join(DATA_DIR, 'photos');
fs.mkdirSync(PHOTO_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'people.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT,
  nickname TEXT,
  email TEXT,
  phone TEXT,
  photo TEXT,
  birth_month INTEGER, birth_day INTEGER, birth_year INTEGER,
  category TEXT,
  freq_days INTEGER,
  track INTEGER NOT NULL DEFAULT 1,
  interests TEXT,
  notes TEXT,
  gift_birthday INTEGER NOT NULL DEFAULT 0,
  gift_christmas INTEGER NOT NULL DEFAULT 0,
  google_resource TEXT,
  google_birthday_event TEXT,
  google_birthday_sig TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  note TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  google_event_id TEXT,
  group_key TEXT,
  dirty INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS visits_event ON visits(contact_id, google_event_id) WHERE google_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS visits_contact ON visits(contact_id, date);
CREATE TABLE IF NOT EXISTS gifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('given','received')),
  occasion TEXT NOT NULL DEFAULT 'other',
  year INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'given',
  description TEXT NOT NULL,
  price REAL,
  my_share REAL,
  is_group INTEGER NOT NULL DEFAULT 0,
  co_givers TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS gifts_contact ON gifts(contact_id, year);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS ignored_events (
  contact_id INTEGER NOT NULL, google_event_id TEXT NOT NULL,
  PRIMARY KEY (contact_id, google_event_id)
);
CREATE TABLE IF NOT EXISTS pending_deletes (event_id TEXT PRIMARY KEY);
`);

if (!db.prepare('PRAGMA table_info(contacts)').all().some((c) => c.name === 'hidden')) {
  db.exec('ALTER TABLE contacts ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');
}

if (!db.prepare('PRAGMA table_info(visits)').all().some((c) => c.name === 'kind')) {
  // 'visit' = on s'est vus ; 'news' = prise de nouvelles (message, appel). Les visites existantes restent des visites.
  db.exec("ALTER TABLE visits ADD COLUMN kind TEXT NOT NULL DEFAULT 'visit'");
}

/** node:sqlite refuse `undefined` et les booléens : on normalise. */
export const clean = (v) => (v === undefined ? null : typeof v === 'boolean' ? +v : v);

export const all = (sql, ...p) => db.prepare(sql).all(...p.map(clean));
export const get = (sql, ...p) => db.prepare(sql).get(...p.map(clean));
export const run = (sql, ...p) => db.prepare(sql).run(...p.map(clean));

export function insert(table, obj) {
  const keys = Object.keys(obj);
  const r = run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => obj[k]));
  return Number(r.lastInsertRowid);
}
export function update(table, id, obj) {
  const keys = Object.keys(obj);
  if (!keys.length) return;
  run(`UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...keys.map((k) => obj[k]), id);
}
export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function getSetting(key, def = null) {
  const r = get('SELECT value FROM settings WHERE key=?', key);
  if (!r) return def;
  try { return JSON.parse(r.value); } catch { return def; }
}
export function setSetting(key, value) {
  run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value));
}

export const photoExists = (p) => !!p && fs.existsSync(path.join(PHOTO_DIR, path.basename(p)));

export function savePhoto(contactId, buffer, ext = 'jpg') {
  const old = get('SELECT photo FROM contacts WHERE id=?', contactId)?.photo;
  const file = `${contactId}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(PHOTO_DIR, file), buffer);
  run('UPDATE contacts SET photo=? WHERE id=?', `/photos/${file}`, contactId);
  if (old) fs.rm(path.join(PHOTO_DIR, path.basename(old)), () => {});
  return `/photos/${file}`;
}
