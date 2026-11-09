import { all, getSetting } from './db.js';

export const CATEGORIES = [
  { key: 'famille_proche', label: 'Famille proche', default_days: 30 },
  { key: 'amis_proches', label: 'Amis proches', default_days: 30 },
  { key: 'famille', label: 'Famille', default_days: 90 },
  { key: 'amis', label: 'Amis', default_days: 90 },
  { key: 'connaissances', label: 'Connaissances', default_days: 180 },
];

// ---------- dates ----------
export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
export const diffDays = (a, b) => Math.round((b - a) / 864e5);
export const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function nextBirthday(c, from = today()) {
  if (!c.birth_month || !c.birth_day) return null;
  for (const y of [from.getFullYear(), from.getFullYear() + 1]) {
    const day = c.birth_month === 2 && c.birth_day === 29 && !isLeap(y) ? 28 : c.birth_day;
    const d = new Date(y, c.birth_month - 1, day);
    if (d >= from) {
      return { date: ymd(d), year: y, days: diffDays(from, d), turning: c.birth_year ? y - c.birth_year : null };
    }
  }
  return null;
}

// ---------- seuils ----------
export function thresholds() {
  const s = getSetting('thresholds', {});
  return Object.fromEntries(CATEGORIES.map((c) => [c.key, s[c.key] !== undefined ? s[c.key] : c.default_days]));
}

export function contactRows({ withHidden = false } = {}) {
  const th = thresholds();
  const t = today();
  const rows = all(`
    SELECT c.*, v.last_visit, v.last_seen, v.last_news, COALESCE(v.visit_count,0) AS visit_count
    FROM contacts c
    LEFT JOIN (SELECT contact_id, MAX(date) AS last_visit, MAX(CASE WHEN kind='visit' THEN date END) AS last_seen, MAX(CASE WHEN kind='news' THEN date END) AS last_news, COUNT(*) AS visit_count FROM visits GROUP BY contact_id) v
      ON v.contact_id = c.id
    ${withHidden ? '' : 'WHERE c.hidden = 0'}
    ORDER BY c.first_name COLLATE NOCASE, c.last_name COLLATE NOCASE`);
  return rows.map((c) => decorate(c, th, t));
}

export function decorate(c, th = thresholds(), t = today()) {
  const catDays = c.category ? th[c.category] : null;
  let threshold = null, source = null;
  if (c.freq_days) { threshold = c.freq_days; source = 'override'; }
  else if (catDays) { threshold = catDays; source = 'category'; }
  const days_since = c.last_visit ? diffDays(parseYmd(c.last_visit), t) : null;
  const tracked = !!c.track && !!threshold;
  const overdue = tracked && (days_since === null || days_since > threshold);
  const ratio = !tracked ? 0 : days_since === null ? 99 : days_since / threshold;
  return {
    ...c,
    name: [c.first_name, c.last_name].filter(Boolean).join(' '),
    threshold, threshold_source: source, days_since, tracked, overdue, ratio,
    next_birthday: nextBirthday(c, t),
  };
}

// ---------- cadeaux ----------
export function giftInfo(contactId, occasion, year) {
  const given = all(`SELECT * FROM gifts WHERE contact_id=? AND direction='given' AND occasion=? ORDER BY year DESC, id DESC`, contactId, occasion);
  const received = all(`SELECT * FROM gifts WHERE contact_id=? AND direction='received' ORDER BY year DESC, id DESC LIMIT 3`, contactId);
  return {
    current: given.filter((g) => g.year === year),
    last_given: given.find((g) => g.year < year && g.status === 'given') || null,
    received,
  };
}

export function birthdayGifts(days) {
  const t = today();
  return contactRows()
    .filter((c) => c.next_birthday && c.next_birthday.days <= days)
    .sort((a, b) => a.next_birthday.days - b.next_birthday.days)
    .map((c) => ({ contact: c, ...(c.gift_birthday ? giftInfo(c.id, 'birthday', c.next_birthday.year) : { current: [], last_given: null, received: [] }) }));
}

const catOrder = Object.fromEntries(CATEGORIES.map((c, i) => [c.key, i]));
export function christmasGifts(year) {
  const withGift = new Set(all(`SELECT DISTINCT contact_id FROM gifts WHERE occasion='christmas' AND direction='given' AND year=?`, year).map((r) => r.contact_id));
  return contactRows()
    .filter((c) => c.gift_christmas || withGift.has(c.id))
    .sort((a, b) => (catOrder[a.category] ?? 9) - (catOrder[b.category] ?? 9) || a.name.localeCompare(b.name))
    .map((c) => ({ contact: c, ...giftInfo(c.id, 'christmas', year) }));
}

export function christmasSummary(list) {
  let total = 0, done = 0, bought = 0, idea = 0, none = 0, budget = 0;
  for (const e of list) {
    if (!e.contact.gift_christmas) continue;
    total++;
    const sts = e.current.map((g) => g.status);
    if (sts.includes('given')) done++;
    else if (sts.includes('bought')) bought++;
    else if (sts.includes('idea')) idea++;
    else none++;
  }
  for (const e of list) for (const g of e.current) budget += g.my_share ?? g.price ?? 0;
  return { total, done, bought, idea, none, budget };
}
