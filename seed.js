// Données de démonstration (utiliser avec DATA_DIR=./data-demo, voir `npm run demo`).
import { insert, run } from './db.js';
import { ymd, today } from './logic.js';

const t = today();
const dAgo = (n) => { const d = new Date(t); d.setDate(d.getDate() - n); return ymd(d); };
const bday = (inDays) => { const d = new Date(t); d.setDate(d.getDate() + inDays); return { birth_month: d.getMonth() + 1, birth_day: d.getDate() }; };
const Y = t.getFullYear();

run('DELETE FROM contacts');
const people = [
  { first_name: 'Camille', last_name: 'Martin', category: 'amis_proches', ...bday(3), birth_year: 1991, interests: 'escalade, café de spécialité, BD', gift_birthday: 1, gift_christmas: 1, seen: [12, 70] },
  { first_name: 'Maman', last_name: '', category: 'famille_proche', ...bday(40), birth_year: 1962, interests: 'jardinage, polars', gift_birthday: 1, gift_christmas: 1, seen: [45] },
  { first_name: 'Thomas', last_name: 'Bernard', category: 'amis_proches', ...bday(11), birth_year: 1989, interests: 'vélo, bière artisanale', gift_birthday: 1, gift_christmas: 0, seen: [20] },
  { first_name: 'Julie', last_name: 'Dubois', category: 'amis', ...bday(25), interests: 'yoga, voyages', gift_birthday: 0, gift_christmas: 1, seen: [150] },
  { first_name: 'Antoine', last_name: 'Leroy', category: 'amis', ...bday(120), birth_year: 1988, interests: 'jeux de société', gift_birthday: 1, gift_christmas: 1, seen: [] },
  { first_name: 'Papa', last_name: '', category: 'famille_proche', ...bday(200), birth_year: 1960, interests: 'bricolage, pêche', gift_birthday: 1, gift_christmas: 1, seen: [9] },
  { first_name: 'Sophie', last_name: 'Petit', category: 'famille', ...bday(18), interests: 'cuisine, cinéma', gift_birthday: 1, gift_christmas: 1, seen: [100], freq_days: 45 },
  { first_name: 'Marc', last_name: 'Roux', category: 'connaissances', ...bday(80), seen: [300] },
  { first_name: 'Léa', last_name: 'Moreau', category: 'amis', seen: [30] },
  { first_name: 'Hugo', last_name: 'Fournier', category: 'amis_proches', seen: [] },
];
const ids = {};
for (const { seen, ...p } of people) {
  const id = insert('contacts', p); ids[p.first_name] = id;
  for (const n of seen) insert('visits', { contact_id: id, date: dAgo(n), note: n % 2 ? 'Dîner' : 'Verre en ville', source: 'manual' });
}
const gift = (n, g) => insert('gifts', { contact_id: ids[n], ...g });
gift('Camille', { direction: 'given', occasion: 'birthday', year: Y - 1, description: 'Moulin à café manuel', price: 45 });
gift('Camille', { direction: 'given', occasion: 'christmas', year: Y - 1, description: 'BD « Blacksad » intégrale', price: 35, status: 'given' });
gift('Camille', { direction: 'received', occasion: 'christmas', year: Y - 1, description: 'Livre de photos de montagne' });
gift('Camille', { direction: 'given', occasion: 'christmas', year: Y, description: 'Abonnement torréfacteur', price: 30, status: 'idea' });
gift('Maman', { direction: 'given', occasion: 'christmas', year: Y - 1, description: 'Set d\'outils de jardin', price: 80, is_group: 1, co_givers: 'Papa, Sophie', my_share: 30, status: 'given' });
gift('Maman', { direction: 'given', occasion: 'christmas', year: Y, description: 'Tablier + cours de cuisine', price: 90, status: 'bought', is_group: 1, co_givers: 'Sophie', my_share: 45 });
gift('Maman', { direction: 'received', occasion: 'christmas', year: Y - 1, description: 'Pull en laine' });
gift('Thomas', { direction: 'given', occasion: 'birthday', year: Y - 1, description: 'Pack de 6 bières', price: 20 });
gift('Papa', { direction: 'given', occasion: 'christmas', year: Y - 1, description: 'Canne à pêche télescopique', price: 60 });
gift('Sophie', { direction: 'received', occasion: 'birthday', year: Y - 1, description: 'Bougie parfumée' });
console.log('Démo prête :', people.length, 'contacts');
