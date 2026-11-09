'use strict';
// ====================== utilitaires ======================
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const OCC = { birthday: 'Anniversaire', christmas: 'Noël', other: 'Autre' };
const STATUS = { idea: ['Idée', '💡'], bought: ['Acheté', '🛍️'], given: ['Offert', '🎁'] };
const NEXT_STATUS = { idea: 'bought', bought: 'given', given: 'idea' };
const eur = (n) => (n == null ? '' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n));
const state = { meta: null, contacts: null, tab: {}, filters: { q: '', cat: '', status: '', sort: 'name' } };

async function api(path, method = 'GET', body) {
  const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
  return j;
}
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = err ? 'err' : ''; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), err ? 5000 : 2200);
}
const fmtDate = (s) => { if (!s) return ''; const [y, m, d] = s.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const fmtDM = (m, d) => `${d} ${MONTHS[m - 1]}`;
const ago = (n) => n === null || n === undefined ? 'Jamais vu' : n === 0 ? "Aujourd'hui" : n === 1 ? 'Hier' : n < 60 ? `il y a ${n} j` : n < 700 ? `il y a ${Math.round(n / 30.4)} mois` : `il y a ${(n / 365).toFixed(1).replace('.', ',')} ans`;
const inDays = (n) => (n === 0 ? "aujourd'hui" : n === 1 ? 'demain' : `dans ${n} j`);
const todayStr = () => state.meta?.today || new Date().toISOString().slice(0, 10);
const catLabel = (k) => state.meta.categories.find((c) => c.key === k)?.label || '';
const initials = (c) => ((c.first_name || '?')[0] + ((c.last_name || '')[0] || '')).toUpperCase();
const fullName = (c) => c.name || [c.first_name, c.last_name].filter(Boolean).join(' ');

const shownName = (c) => c.nickname || fullName(c);
function avatar(c, cls = '') {
  if (c.photo) return `<img class="avatar ${cls}" src="${esc(c.photo)}" alt="" data-init="${esc(initials(c))}" data-hue="${(c.id * 67) % 360}">`;
  return `<div class="avatar ${cls}" style="background:hsl(${(c.id * 67) % 360} 45% 48%)">${esc(initials(c))}</div>`;
}
function catBadge(c) { return c.category ? `<span class="badge">${esc(catLabel(c.category))}</span>` : ''; }
function seenBadge(c) {
  if (!c.tracked) return `<span class="muted small">${ago(c.days_since)}</span>`;
  const cls = c.overdue ? 'bad' : c.ratio > 0.75 ? 'warn' : 'ok';
  return `<span class="badge ${cls}">${ago(c.days_since)}</span>`;
}
function ratioBar(c) {
  if (!c.tracked) return '';
  const pct = Math.min(100, Math.round(Math.min(c.ratio, 2) / 2 * 100));
  return `<div class="bar ${c.overdue ? 'bad' : c.ratio > 0.75 ? 'warn' : ''}"><i style="width:${c.days_since === null ? 100 : pct}%"></i></div>`;
}
async function loadContacts(force) { if (force || !state.contacts) state.contacts = await api('/api/contacts'); return state.contacts; }

// photo introuvable (404) : on retombe sur les initiales au lieu d'une image cassée
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName !== 'IMG' || !img.classList.contains('avatar')) return;
  const d = document.createElement('div');
  d.className = img.className; d.textContent = img.dataset.init || '?';
  d.style.background = `hsl(${img.dataset.hue || 0} 45% 48%)`;
  img.replaceWith(d);
}, true);

// ====================== modale ======================
const dlg = $('#modal');
function openModal(title, html) { $('#modal-title').textContent = title; $('#modal-body').innerHTML = html; if (!dlg.open) dlg.showModal(); setTimeout(() => $('#modal-body input:not([type=hidden]), #modal-body textarea')?.focus(), 30); }
function closeModal() { if (dlg.open) dlg.close(); }
dlg.addEventListener('click', (e) => { if (e.target === dlg) closeModal(); });

// ====================== cadeaux : composants ======================
function giftChip(g, { edit = true } = {}) {
  const [label, icon] = STATUS[g.status] || STATUS.given;
  const money = g.is_group && g.my_share != null ? `${eur(g.my_share)} / ${eur(g.price)}` : eur(g.price);
  return `<span class="gift s-${g.status}">
    ${g.direction === 'given' ? `<span class="st" data-act="cycle-gift" data-id="${g.id}" data-status="${g.status}" title="Changer le statut">${icon} ${label}</span>` : '🎁'}
    <span>${esc(g.description)}</span>
    ${g.is_group ? `<span title="Cadeau groupé">👥${g.co_givers ? ' ' + esc(g.co_givers) : ''}</span>` : ''}
    ${money ? `<span class="muted">${money}</span>` : ''}
    ${edit ? `<button class="icon" data-act="edit-gift" data-id="${g.id}" title="Modifier">✎</button>` : ''}
  </span>`;
}
function giftContext(e, occasion, year) {
  const bits = [];
  if (e.last_given) bits.push(`Offert en ${e.last_given.year} : <b>${esc(e.last_given.description)}</b>${e.last_given.is_group ? ' 👥' : ''}`);
  const r = e.received?.[0];
  if (r) bits.push(`Reçu (${OCC[r.occasion].toLowerCase()} ${r.year}) : <b>${esc(r.description)}</b>`);
  if (e.contact.interests) bits.push(`💭 ${esc(e.contact.interests)}`);
  return bits.length ? `<div class="ctx">${bits.join(' · ')}</div>` : '';
}
function giftBlock(e, occasion, year) {
  const chips = e.current.map((g) => giftChip(g)).join('');
  return `<div class="gifts">${chips}<button class="small" data-act="new-gift" data-contact="${e.contact.id}" data-occasion="${occasion}" data-year="${year}">＋ ${e.current.length ? 'Autre' : 'Idée / cadeau'}</button></div>${giftContext(e, occasion, year)}`;
}

function birthdayRow(e) {
  const c = e.contact, nb = c.next_birthday;
  const flag = c.gift_birthday ? '' : '<span class="tag">pas de cadeau</span>';
  return `<div class="item">
    <a href="#/contact/${c.id}">${avatar(c)}</a>
    <div class="main">
      <div class="title"><a href="#/contact/${c.id}">${esc(fullName(c))}</a>${flag}${c.gift_birthday && !e.current.length ? '<span class="badge warn">à trouver</span>' : ''}</div>
      <div class="sub">🎂 ${fmtDM(c.birth_month, c.birth_day)}${nb.turning ? ` · ${nb.turning} ans` : ''}</div>
      ${c.gift_birthday ? giftBlock(e, 'birthday', nb.year) : ''}
    </div>
    <div class="side"><span class="badge ${nb.days <= 7 ? 'bad' : nb.days <= 14 ? 'warn' : ''}">${inDays(nb.days)}</span></div>
  </div>`;
}

function christmasCard(x, { full = false, collapsible = false } = {}) {
  const s = x.summary, tot = s.total || 1;
  const p = (n) => `${(n / tot) * 100}%`;
  const rows = x.list.map((e) => {
    const c = e.contact;
    return `<div class="item">
      <a href="#/contact/${c.id}">${avatar(c, 'sm')}</a>
      <div class="main">
        <div class="title"><a href="#/contact/${c.id}">${esc(fullName(c))}</a>${catBadge(c)}${!c.gift_christmas ? '<span class="tag">hors liste</span>' : ''}</div>
        ${giftBlock(e, 'christmas', x.year)}
      </div></div>`;
  }).join('');
  const collapsed = collapsible && localStorage.getItem('xmasCollapsed') === '1';
  return `<section class="card xmas ${collapsed ? 'collapsed' : ''}">
    <div class="card-head ${collapsible ? 'toggle' : ''}" ${collapsible ? 'data-act="toggle-xmas"' : ''}><div><h2>${collapsible ? '<span class="chev">▾</span> ' : ''}🎄 Noël ${x.year}${x.days_left != null ? ` — ${x.days_left >= 0 ? `J-${x.days_left}` : 'passé'}` : ''}</h2>
      <div class="muted small">${s.done}/${s.total} offerts · budget engagé ${eur(s.budget) || '0 €'}</div></div>
      ${full ? '' : '<a class="btn small" href="#/gifts" data-stop>Tout voir →</a>'}</div>
    <div class="progress"><i class="p-given" style="width:${p(s.done)}"></i><i class="p-bought" style="width:${p(s.bought)}"></i><i class="p-idea" style="width:${p(s.idea)}"></i></div>
    <div class="legend"><span>🎁 ${s.done} offerts</span><span>🛍️ ${s.bought} achetés</span><span>💡 ${s.idea} idées</span><span>❔ ${s.none} sans idée</span></div>
    <div class="list xmas-list" style="margin-top:12px">${rows || '<div class="empty">Coche « J\'offre un cadeau de Noël » sur les fiches concernées.</div>'}</div>
  </section>`;
}

// ====================== pages ======================
const pages = {};

pages.dashboard = async (main) => {
  const d = await api('/api/dashboard' + (location.search.includes('noel=1') ? '?noel=1' : ''));
  const hour = new Date().getHours();
  main.innerHTML = `
    <div class="page-head"><div><h1>${hour < 18 ? 'Bonjour' : 'Bonsoir'} 👋</h1><p>${fmtDate(d.today)}</p></div>
      <div class="row"><button class="primary" data-act="new-visit">＋ Visite</button><button data-act="new-visit" data-kind="news">💬 Nouvelles</button><button data-act="new-contact">＋ Contact</button></div></div>
    <div class="stats">
      <div class="stat ${d.stats.overdue ? 'warn' : ''}"><b>${d.stats.overdue}</b><span>à revoir</span></div>
      <div class="stat"><b>${d.stats.birthdays30}</b><span>anniversaires (30 j)</span></div>
      <div class="stat"><b>${d.stats.seen30}</b><span>vus ce mois-ci</span></div>
      <div class="stat"><b>${d.stats.contacts}</b><span>contacts</span></div>
    </div>
    ${d.christmas ? christmasCard(d.christmas, { collapsible: true }) : ''}
    <div class="grid2">
      <section class="card"><div class="card-head"><h2>🎂 Anniversaires — 30 prochains jours</h2></div>
        <div class="list">${d.birthdays.map(birthdayRow).join('') || '<div class="empty">Aucun anniversaire dans les 30 jours.</div>'}</div></section>
      <section class="card"><div class="card-head"><h2>👀 À revoir</h2><span class="muted small">${d.overdue_total} en retard</span></div>
        <div class="list">${d.overdue.map(overdueRow).join('') || '<div class="empty">Tout le monde est à jour 🎉</div>'}</div></section>
    </div>`;
};

function overdueRow(c) {
  const late = c.days_since === null ? null : c.days_since - c.threshold;
  return `<div class="item">
    <a href="#/contact/${c.id}">${avatar(c)}</a>
    <div class="main">
      <div class="title"><a href="#/contact/${c.id}">${esc(fullName(c))}</a>${catBadge(c)}</div>
      <div class="sub">${c.days_since === null ? 'Aucun contact enregistré' : `Dernier contact ${ago(c.days_since)} · +${late} j de retard`} · objectif ${c.threshold} j${c.threshold_source === 'override' ? ' (perso)' : ''}</div>
      ${ratioBar(c)}
    </div>
    <div class="side"><button class="small" data-act="seen-today" data-id="${c.id}">🤝 Vu aujourd'hui</button><button class="small" data-act="seen-today" data-kind="news" data-id="${c.id}">💬 Nouvelles</button></div>
  </div>`;
}

// ---------- contacts ----------
state.sel = new Set(); state.selectMode = false;
pages.contacts = async (main) => {
  await loadContacts(true);
  state.sel.clear();
  main.innerHTML = `
    <div class="page-head"><div><h1>Contacts</h1><p id="count"></p></div>
      <div class="row"><button id="sel-toggle" data-act="toggle-select">☑ Sélection</button><button class="primary" data-act="new-contact">＋ Contact</button></div></div>
    <div class="toolbar">
      <input type="search" id="f-q" placeholder="Rechercher un nom, un intérêt…" value="${esc(state.filters.q)}">
      <select id="f-cat"><option value="">Tous les groupes</option>${state.meta.categories.map((c) => `<option value="${c.key}">${esc(c.label)}</option>`).join('')}<option value="none">Sans groupe</option></select>
      <select id="f-status"><option value="">Tous (hors masqués)</option><option value="overdue">À revoir</option><option value="bday">Anniversaire ≤ 30 j</option><option value="never">Jamais vus</option><option value="hidden">Masqués</option></select>
      <select id="f-sort"><option value="name">Tri : nom</option><option value="seen">Tri : vus il y a le plus longtemps</option><option value="bday">Tri : prochain anniversaire</option></select>
    </div><div id="bulk" class="bulk hide"></div><div class="cgrid" id="clist"></div>`;
  $('#f-cat').value = state.filters.cat; $('#f-status').value = state.filters.status; $('#f-sort').value = state.filters.sort;
  const visible = () => {
    const f = state.filters; const q = f.q.toLowerCase();
    const list = state.contacts.filter((c) =>
      (f.status === 'hidden' ? c.hidden : !c.hidden) &&
      (!q || `${fullName(c)} ${c.nickname || ''} ${c.interests || ''}`.toLowerCase().includes(q)) &&
      (!f.cat || (f.cat === 'none' ? !c.category : c.category === f.cat)) &&
      (!f.status || f.status === 'hidden' || (f.status === 'overdue' ? c.overdue : f.status === 'never' ? c.days_since === null : c.next_birthday && c.next_birthday.days <= 30)));
    if (f.sort === 'seen') list.sort((a, b) => (b.days_since ?? 1e9) - (a.days_since ?? 1e9));
    if (f.sort === 'bday') list.sort((a, b) => (a.next_birthday?.days ?? 1e9) - (b.next_birthday?.days ?? 1e9));
    return list;
  };
  const drawBulk = () => {
    const bar = $('#bulk'); bar.classList.toggle('hide', !state.selectMode);
    $('#sel-toggle').classList.toggle('primary', state.selectMode);
    if (!state.selectMode) return;
    const n = state.sel.size, hiddenView = state.filters.status === 'hidden';
    bar.innerHTML = `<b>${n} sélectionné${n > 1 ? 's' : ''}</b>
      <button class="small" data-act="sel-all">Tout sélectionner (${visible().length})</button><button class="small ghost" data-act="sel-none">Aucun</button>
      <select data-change="bulk-cat" ${n ? '' : 'disabled'}><option value="">Changer de groupe…</option>${state.meta.categories.map((c) => `<option value="${c.key}">${esc(c.label)}</option>`).join('')}<option value="__none">— Sans groupe —</option></select>
      <select data-change="bulk-more" ${n ? '' : 'disabled'}><option value="">Autres actions…</option>
        <option value="${hiddenView ? 'unhide' : 'hide'}">${hiddenView ? '👁 Réafficher' : '🙈 Masquer'}</option>
        <option value="track:0">Ne plus suivre la fréquence</option><option value="track:1">Suivre la fréquence</option>
        <option value="gift_birthday:1">🎂 Cadeau d'anniversaire : oui</option><option value="gift_birthday:0">🎂 Cadeau d'anniversaire : non</option>
        <option value="gift_christmas:1">🎄 Cadeau de Noël : oui</option><option value="gift_christmas:0">🎄 Cadeau de Noël : non</option>
        <option value="freq_days:">Retirer la fréquence perso</option><option value="delete">🗑 Supprimer…</option></select>`;
  };
  const draw = () => {
    const list = visible();
    $('#count').textContent = `${list.length} sur ${state.contacts.length}`;
    $('#clist').innerHTML = list.map((c) => {
      const inner = `${state.selectMode ? `<input type="checkbox" ${state.sel.has(c.id) ? 'checked' : ''} tabindex="-1" style="margin-top:4px">` : ''}${avatar(c)}
        <div class="main"><div class="name">${esc(shownName(c))}${c.hidden ? ' <span class="tag">masqué</span>' : ''}</div>${c.nickname ? `<div class="muted small">${esc(fullName(c))}</div>` : ''}
          <div class="row" style="gap:6px;margin:3px 0">${catBadge(c)}${seenBadge(c)}</div>
          ${ratioBar(c)}
          <div class="sub small" style="margin-top:5px">${c.birth_month ? `🎂 ${fmtDM(c.birth_month, c.birth_day)}` : ''}${c.gift_birthday || c.gift_christmas ? ` · ${c.gift_birthday ? '🎁' : ''}${c.gift_christmas ? '🎄' : ''}` : ''}</div>
          ${c.interests ? `<div class="tags" style="margin-top:5px">${c.interests.split(',').slice(0, 3).map((t) => `<span class="tag">${esc(t.trim())}</span>`).join('')}</div>` : ''}
        </div>`;
      return state.selectMode
        ? `<div class="cc ${state.sel.has(c.id) ? 'selected' : ''}" data-act="toggle-sel" data-id="${c.id}">${inner}</div>`
        : `<a class="cc" href="#/contact/${c.id}">${inner}</a>`;
    }).join('') || '<div class="empty">Aucun contact.</div>';
    drawBulk();
  };
  state.drawContacts = draw; state.visibleContacts = visible;
  draw();
  $('#f-q').oninput = (e) => { state.filters.q = e.target.value; draw(); };
  for (const [id, k] of [['f-cat', 'cat'], ['f-status', 'status'], ['f-sort', 'sort']]) $('#' + id).onchange = (e) => { state.filters[k] = e.target.value; draw(); };
};

// ---------- fiche contact ----------
pages.contact = async (main, id) => {
  if (id === 'new') { return contactForm(main, null); }
  const data = await api(`/api/contacts/${id}`);
  contactForm(main, data);
};

function contactForm(main, data) {
  const c = data?.contact || { first_name: '', category: '', track: 1 };
  const isNew = !data;
  const catOpts = `<option value="">— Aucun —</option>` + state.meta.categories.map((k) => `<option value="${k.key}" ${c.category === k.key ? 'selected' : ''}>${esc(k.label)} (${k.days ? `${k.days} j` : 'non suivi'})</option>`).join('');
  const monthOpts = `<option value="">Mois</option>` + MONTHS.map((m, i) => `<option value="${i + 1}" ${c.birth_month === i + 1 ? 'selected' : ''}>${m}</option>`).join('');
  const groupDays = c.category ? state.meta.categories.find((k) => k.key === c.category)?.days : null;
  const given = (data?.gifts || []).filter((g) => g.direction === 'given');
  const received = (data?.gifts || []).filter((g) => g.direction === 'received');

  main.innerHTML = `
    <div class="page-head"><div class="row"><a class="btn small" href="#/contacts">← Contacts</a><h1>${isNew ? 'Nouveau contact' : esc(fullName(c))}</h1></div>
      ${isNew ? '' : `<div class="row"><button class="primary" data-act="new-visit" data-id="${c.id}">＋ Visite</button><button data-act="new-visit" data-id="${c.id}" data-kind="news">💬 Nouvelles</button></div>`}</div>
    <div class="profile">
      <form class="card" data-form="contact" data-id="${isNew ? '' : c.id}">
        ${isNew ? '' : `<div class="hero"><div class="avatar-btn" data-act="pick-photo" data-id="${c.id}" title="Changer la photo">${avatar(c, 'lg')}</div>
          <div><div class="row" style="gap:6px">${catBadge(c)}${seenBadge(c)}</div>
          <div class="muted small" style="margin-top:6px">${c.last_seen ? `🤝 Vu le ${fmtDate(c.last_seen)}` : '🤝 Jamais vu'}<br>${c.last_news ? `💬 Nouvelles le ${fmtDate(c.last_news)}` : '💬 Pas de nouvelles notées'}<br>${c.threshold ? `Objectif : tous les ${c.threshold} j${c.threshold_source === 'override' ? ' (perso)' : ''}` : 'Pas de suivi de fréquence'}</div>
          ${c.photo ? `<button type="button" class="ghost small" data-act="del-photo" data-id="${c.id}">Retirer la photo</button>` : ''}</div></div>`}
        <div class="cols"><div class="field"><label>Prénom *</label><input name="first_name" value="${esc(c.first_name)}" required></div>
          <div class="field"><label>Nom</label><input name="last_name" value="${esc(c.last_name)}"></div></div>
        <div class="field"><label>Surnom</label><input name="nickname" value="${esc(c.nickname)}"></div>
        <div class="cols"><div class="field"><label>Email(s)</label><input name="email" value="${esc(c.email)}" placeholder="Sert à reconnaître l'agenda"></div>
          <div class="field"><label>Téléphone</label><input name="phone" value="${esc(c.phone)}"></div></div>
        <div class="field"><label>Anniversaire</label><div class="row">
          <input name="birth_day" type="number" min="1" max="31" placeholder="Jour" value="${c.birth_day ?? ''}" style="width:80px">
          <select name="birth_month" style="width:auto;flex:1">${monthOpts}</select>
          <input name="birth_year" type="number" min="1900" max="2100" placeholder="Année (opt.)" value="${c.birth_year ?? ''}" style="width:120px"></div></div>
        <div class="field"><label>Groupe</label><select name="category" id="cat-select">${catOpts}</select></div>
        <div class="field"><label>Fréquence perso (jours) — remplace le groupe</label>
          <input name="freq_days" type="number" min="1" value="${c.freq_days ?? ''}" placeholder="${groupDays ? `Groupe : ${groupDays} j` : 'Pas de seuil'}">
          <div class="hint">Laisse vide pour suivre le seuil du groupe.</div></div>
        <div class="checks">
          <label class="check"><input type="checkbox" name="hidden" ${c.hidden ? 'checked' : ''}> 🙈 Masquer ce contact (absent du dashboard et des listes)</label>
          <label class="check"><input type="checkbox" name="track" ${c.track ? 'checked' : ''}> Suivre la fréquence des visites</label>
          <label class="check"><input type="checkbox" name="gift_birthday" ${c.gift_birthday ? 'checked' : ''}> 🎂 J'offre un cadeau d'anniversaire</label>
          <label class="check"><input type="checkbox" name="gift_christmas" ${c.gift_christmas ? 'checked' : ''}> 🎄 J'offre un cadeau de Noël</label></div>
        <div class="field"><label>Centres d'intérêt (séparés par des virgules)</label><textarea name="interests" style="min-height:60px">${esc(c.interests)}</textarea></div>
        <div class="field"><label>Notes</label><textarea name="notes">${esc(c.notes)}</textarea></div>
        <div class="row"><button class="primary" type="submit">Enregistrer</button>
          ${isNew ? '' : `<button type="button" class="danger" data-act="del-contact" data-id="${c.id}">Supprimer</button>`}</div>
      </form>
      ${isNew ? '<div></div>' : `<div>
        <section class="card"><div class="card-head"><h2>🗓️ Historique des contacts</h2><span class="muted small">${data.visits.filter((v) => v.kind === 'visit').length} visites · ${data.visits.filter((v) => v.kind === 'news').length} prises de nouvelles</span></div>
          <div class="list">${data.visits.map((v) => `<div class="item"><div class="main"><div class="title">${v.kind === 'news' ? '💬' : '🤝'} ${fmtDate(v.date)}<span class="badge ${v.kind === 'news' ? 'gray' : ''}">${v.kind === 'news' ? 'Nouvelles' : 'Visite'}</span>${v.source === 'google' ? '<span class="badge gray">Agenda Google</span>' : ''}${v.group_key ? '<span class="tag" title="Visite avec plusieurs personnes">👥</span>' : ''}</div>${v.note ? `<div class="sub">${esc(v.note)}</div>` : ''}</div>
            <div class="side"><div class="row" style="gap:2px"><button class="icon" data-act="edit-visit" data-id="${v.id}" data-date="${v.date}" data-kind="${v.kind}" data-note="${esc(v.note || '')}">✎</button><button class="icon" data-act="del-visit" data-id="${v.id}">🗑</button></div></div></div>`).join('') || '<div class="empty">Rien d\'enregistré.</div>'}</div></section>
        <section class="card"><div class="card-head"><h2>🎁 Cadeaux</h2><button class="small" data-act="new-gift" data-contact="${c.id}">＋ Ajouter</button></div>
          <h3 class="muted small" style="text-transform:uppercase;letter-spacing:.04em">Offerts par moi</h3>
          ${giftTable(given, c.id)}
          <h3 class="muted small" style="text-transform:uppercase;letter-spacing:.04em;margin-top:16px">Reçus de sa part</h3>
          ${giftTable(received, c.id)}</section></div>`}
    </div>`;
}

function giftTable(list, contactId) {
  if (!list.length) return '<div class="empty" style="padding:8px 0">Rien pour l\'instant.</div>';
  return `<table><tbody>${list.map((g) => `<tr><td style="width:90px"><b>${OCC[g.occasion]}</b><div class="muted small">${g.year}</div></td>
    <td>${esc(g.description)}${g.is_group ? `<div class="small muted">👥 Cadeau groupé${g.co_givers ? ' avec ' + esc(g.co_givers) : ''}</div>` : ''}${g.note ? `<div class="small muted">${esc(g.note)}</div>` : ''}</td>
    <td style="text-align:right;white-space:nowrap">${g.direction === 'given' && g.status !== 'given' ? `<span class="badge warn">${STATUS[g.status][0]}</span> ` : ''}${g.is_group && g.my_share != null ? `${eur(g.my_share)}<div class="muted small">sur ${eur(g.price)}</div>` : eur(g.price)}</td>
    <td style="width:40px"><button class="icon" data-act="edit-gift" data-id="${g.id}">✎</button></td></tr>`).join('')}</tbody></table>`;
}

// ---------- cadeaux ----------
pages.gifts = async (main) => {
  const tab = state.tab.gifts || 'xmas';
  const year = state.tab.giftYear || new Date().getFullYear();
  const o = await api(`/api/gifts/overview?year=${year}`);
  const tabs = [['xmas', '🎄 Noël'], ['bday', '🎂 Anniversaires'], ['history', '📜 Historique']];
  let body = '';
  if (tab === 'xmas') {
    body = `<div class="row" style="margin-bottom:14px"><label style="margin:0">Année</label>
      <select data-change="gift-year" style="width:auto">${[year + 1, year, year - 1, year - 2, year - 3].filter((v, i, a) => a.indexOf(v) === i).map((y) => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select></div>`
      + christmasCard({ year: o.year, list: o.christmas, summary: o.christmas_summary }, { full: true });
  } else if (tab === 'bday') {
    body = `<section class="card"><div class="card-head"><h2>Anniversaires des 90 prochains jours</h2></div><div class="list">${o.birthdays.map(birthdayRow).join('') || '<div class="empty">Aucun.</div>'}</div></section>`;
  } else {
    const all = await api('/api/gifts');
    const f = state.tab.hist || { dir: '', occ: '', q: '' };
    const rows = all.filter((g) => (!f.dir || g.direction === f.dir) && (!f.occ || g.occasion === f.occ) &&
      (!f.q || `${g.description} ${g.first_name} ${g.last_name || ''} ${g.co_givers || ''}`.toLowerCase().includes(f.q.toLowerCase())));
    body = `<div class="toolbar"><input type="search" placeholder="Rechercher…" value="${esc(f.q)}" data-change="hist-q">
      <select data-change="hist-dir"><option value="">Offerts + reçus</option><option value="given" ${f.dir === 'given' ? 'selected' : ''}>Offerts</option><option value="received" ${f.dir === 'received' ? 'selected' : ''}>Reçus</option></select>
      <select data-change="hist-occ"><option value="">Toutes occasions</option>${Object.entries(OCC).map(([k, v]) => `<option value="${k}" ${f.occ === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <section class="card"><table><thead><tr><th>Année</th><th>Qui</th><th>Cadeau</th><th></th><th style="text-align:right">Montant</th><th></th></tr></thead><tbody>
      ${rows.map((g) => `<tr><td>${g.year}</td><td><a href="#/contact/${g.contact_id}"><b>${esc(g.first_name)} ${esc(g.last_name || '')}</b></a></td>
        <td>${esc(g.description)}${g.is_group ? `<div class="small muted">👥 groupé${g.co_givers ? ' avec ' + esc(g.co_givers) : ''}</div>` : ''}</td>
        <td><span class="badge ${g.direction === 'received' ? 'gray' : ''}">${g.direction === 'received' ? '⬇ Reçu' : '⬆ Offert'}</span> <span class="tag">${OCC[g.occasion]}</span>${g.direction === 'given' && g.status !== 'given' ? ` <span class="badge warn">${STATUS[g.status][0]}</span>` : ''}</td>
        <td style="text-align:right">${g.is_group && g.my_share != null ? `${eur(g.my_share)}<div class="muted small">sur ${eur(g.price)}</div>` : eur(g.price)}</td>
        <td><button class="icon" data-act="edit-gift" data-id="${g.id}">✎</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Aucun cadeau.</td></tr>'}
      </tbody></table></section>`;
  }
  main.innerHTML = `<div class="page-head"><div><h1>Cadeaux</h1><p>Noël, anniversaires, cadeaux groupés, et ce que tu as reçu.</p></div>
    <button class="primary" data-act="new-gift">＋ Cadeau</button></div>
    <div class="tabs">${tabs.map(([k, l]) => `<button class="${k === tab ? 'active' : ''}" data-act="tab" data-tab="${k}">${l}</button>`).join('')}</div>${body}`;
};

// ---------- admin ----------
pages.admin = async (main, _, query) => {
  const [settings, gs] = await Promise.all([api('/api/settings'), api('/api/google/status')]);
  const o = gs.options;
  const chk = (k, label, hint) => `<label class="check" style="margin-bottom:8px"><input type="checkbox" data-change="g-opt" data-key="${k}" ${o[k] ? 'checked' : ''}><span>${label}${hint ? `<div class="hint" style="margin:0">${hint}</div>` : ''}</span></label>`;
  const r = gs.last_result;
  main.innerHTML = `
    <div class="page-head"><div><h1>Admin</h1><p>Seuils de fréquence, synchronisation Google, données.</p></div></div>
    ${query.get('google') ? `<div class="card" style="margin-bottom:18px">${query.get('google') === 'ok' ? '✅ Google connecté.' : '⚠️ Connexion Google : ' + esc(query.get('google'))}</div>` : ''}
    <section class="card"><div class="card-head"><h2>⏱️ Fréquence de visite par groupe</h2></div>
      <p class="muted" style="margin-top:0">Nombre de jours maximum entre deux visites avant qu'un contact apparaisse dans « À revoir ». Vide = pas de suivi. Chaque fiche peut surcharger ce seuil.</p>
      <form data-form="thresholds" class="cols">${settings.categories.map((c) => `<div class="field"><label>${esc(c.label)}</label><div class="row" style="gap:6px"><input type="number" min="1" name="${c.key}" value="${c.days ?? ''}" placeholder="—"><span class="muted">jours</span></div></div>`).join('')}
      <div class="field" style="align-self:end"><button class="primary">Enregistrer</button></div></form></section>

    <section class="card"><div class="card-head"><h2>🔗 Google Agenda &amp; Contacts</h2>${gs.connected ? `<span class="badge ok">Connecté${gs.email ? ' · ' + esc(gs.email) : ''}</span>` : '<span class="badge gray">Non connecté</span>'}</div>
      ${gs.connected ? `
        <p class="muted" style="margin-top:0">Lecture seule : l'appli ne crée ni ne modifie rien dans ton agenda (automatique toutes les 20 min).</p>
        ${chk('importContacts', 'Importer les contacts Google', 'Noms, emails, téléphones, anniversaires et photos (ne remplace jamais ce que tu as déjà saisi).')}
        ${chk('pullEvents', 'Créer des visites depuis les événements passés', 'Un événement passé avec un invité dont l\'email est sur une fiche devient une visite (les anniversaires sont ignorés).')}
        ${chk('matchByName', 'Reconnaître aussi le nom complet dans le titre', 'Ex. « Dîner avec Camille Martin ».')}
        <div class="row" style="margin-top:12px"><button class="primary" data-act="g-sync">🔄 Synchroniser maintenant</button><button class="danger" data-act="g-disconnect">Déconnecter</button></div>
        ${gs.last_sync ? `<div class="result"><b>Dernière synchro :</b> ${new Date(gs.last_sync).toLocaleString('fr-FR')}<br>${syncSummary(r)}</div>` : ''}
      ` : `
        <p style="margin-top:0">Pour relier ton agenda, crée ton propre accès Google (gratuit, 5 minutes) :</p>
        <ol class="steps">
          <li>Va sur <a href="https://console.cloud.google.com/" target="_blank" class="badge">Google Cloud Console ↗</a> et crée un projet.</li>
          <li>« API et services » → <b>Bibliothèque</b> : active <b>Google Calendar API</b> et <b>People API</b>.</li>
          <li><b>Écran de consentement OAuth</b> : type « Externe », ajoute ton adresse Gmail comme <i>utilisateur test</i>.</li>
          <li><b>Identifiants</b> → Créer → <b>ID client OAuth</b>, type « Application Web », avec cette URI de redirection :<br><code>${esc(gs.redirect_uri)}</code></li>
          <li>Colle l'ID client et le secret ci-dessous.</li></ol>
        <form data-form="google-creds"><div class="cols"><div class="field"><label>Client ID</label><input name="client_id" value="${esc(gs.client_id)}" required></div>
          <div class="field"><label>Client secret</label><input name="client_secret" type="password" placeholder="${gs.has_credentials ? '••••••• (enregistré)' : ''}" ${gs.has_credentials ? '' : 'required'}></div></div>
          <div class="row"><button>Enregistrer</button>${gs.has_credentials ? '<a class="btn primary" href="/auth/google/start">Se connecter à Google →</a>' : ''}</div></form>`}
    </section>

    <section class="card"><div class="card-head"><h2>💾 Données</h2></div>
      <p class="muted" style="margin-top:0">Tout est stocké en local dans le dossier <code>data/</code> (base SQLite + photos). Copie ce dossier pour sauvegarder.</p>
      <div class="row"><a class="btn" href="/api/export" download="people-export.json">⬇ Exporter (JSON)</a><button data-act="import">⬆ Importer (remplace tout)</button></div></section>`;
};

function syncSummary(r) {
  if (!r) return '';
  const p = [];
  if (r.contacts) p.push(`Contacts : ${r.contacts.created} créés, ${r.contacts.updated} complétés`);
  if (r.events) p.push(`Visites importées : ${r.events.imported}${r.events.removed ? `, ${r.events.removed} supprimées` : ''}`);
  if (r.errors?.length) p.push(`<span style="color:var(--bad)">⚠️ ${r.errors.map(esc).join('<br>')}</span>`);
  return p.join('<br>') || 'Rien à faire.';
}

// ====================== modales (formulaires) ======================
async function visitModal({ ids = [], visit, kind = 'visit' } = {}) {
  const contacts = (await loadContacts()).filter((c) => !c.hidden);
  const k = visit?.kind || kind;
  openModal(visit ? 'Modifier' : k === 'news' ? 'Prise de nouvelles' : 'Nouvelle visite', `
    <form data-form="visit" data-id="${visit?.id || ''}">
      <div class="field"><div class="row"><label class="check"><input type="radio" name="kind" value="visit" ${k === 'visit' ? 'checked' : ''}> 🤝 On s'est vus</label>
        <label class="check"><input type="radio" name="kind" value="news" ${k === 'news' ? 'checked' : ''}> 💬 Prise de nouvelles (message, appel…)</label></div></div>
      <div class="field"><label>Date</label><input type="date" name="date" value="${visit?.date || todayStr()}" required></div>
      ${visit ? '' : `<div class="field"><label>Avec qui ?</label><input type="search" placeholder="Filtrer…" data-change="picker-filter"><div class="picker">
        ${contacts.map((c) => `<label class="check" data-name="${esc(`${c.nickname || ''} ${fullName(c)}`.toLowerCase())}"><input type="checkbox" name="contact_ids" value="${c.id}" ${ids.includes(c.id) ? 'checked' : ''}> ${esc(shownName(c))}${c.nickname ? ` <span class="muted small">${esc(fullName(c))}</span>` : ''} ${c.overdue ? '<span class="badge bad">à revoir</span>' : ''}</label>`).join('')}</div>
        <div class="hint">Plusieurs personnes = une seule sortie, comptée pour chacun.</div></div>`}
      <div class="field"><label>Note (lieu, sujet…)</label><input name="note" value="${esc(visit?.note || '')}"></div>
      <button class="primary">Enregistrer</button></form>`);
}

async function giftModal({ gift, contact, occasion, year } = {}) {
  const contacts = (await loadContacts()).filter((c) => !c.hidden || c.id === +(gift?.contact_id || contact));
  const g = gift || { direction: 'given', occasion: occasion || 'other', year: year || new Date().getFullYear(), status: occasion ? 'idea' : 'given', contact_id: contact };
  const opt = (v, l, sel) => `<option value="${v}" ${sel ? 'selected' : ''}>${l}</option>`;
  openModal(gift ? 'Modifier le cadeau' : 'Nouveau cadeau', `
    <form data-form="gift" data-id="${gift?.id || ''}" id="gift-form">
      <div class="field"><label>Contact</label><select name="contact_id" required ${contact && !gift ? 'style="pointer-events:none;opacity:.7"' : ''}><option value="">Choisir…</option>${contacts.map((c) => opt(c.id, esc(fullName(c)), c.id === +g.contact_id)).join('')}</select></div>
      <div class="field"><div class="row"><label class="check"><input type="radio" name="direction" value="given" ${g.direction === 'given' ? 'checked' : ''}> ⬆ Je l'offre / l'ai offert</label>
        <label class="check"><input type="radio" name="direction" value="received" ${g.direction === 'received' ? 'checked' : ''}> ⬇ Je l'ai reçu</label></div></div>
      <div class="cols"><div class="field"><label>Occasion</label><select name="occasion">${Object.entries(OCC).map(([k, v]) => opt(k, v, g.occasion === k)).join('')}</select></div>
        <div class="field"><label>Année</label><input type="number" name="year" value="${g.year}" required></div>
        <div class="field" data-only="given"><label>Statut</label><select name="status">${Object.entries(STATUS).map(([k, v]) => opt(k, `${v[1]} ${v[0]}`, g.status === k)).join('')}</select></div></div>
      <div class="field"><label>Cadeau</label><input name="description" value="${esc(g.description || '')}" placeholder="Ex. Moulin à café manuel" required></div>
      <div class="field"><label>Prix total (€)</label><input type="number" step="0.01" name="price" value="${g.price ?? ''}"></div>
      <div class="field" data-only="given"><label class="check"><input type="checkbox" name="is_group" ${g.is_group ? 'checked' : ''}> 👥 Cadeau groupé (plusieurs personnes se sont cotisées)</label></div>
      <div class="cols hide" id="group-fields"><div class="field"><label>Avec qui ?</label><input name="co_givers" value="${esc(g.co_givers || '')}" placeholder="Papa, Sophie…"></div>
        <div class="field"><label>Ma part (€)</label><input type="number" step="0.01" name="my_share" value="${g.my_share ?? ''}"></div></div>
      <div class="field"><label>Note</label><input name="note" value="${esc(g.note || '')}" placeholder="Taille, couleur, où l'acheter, réaction…"></div>
      <div class="row"><button class="primary">Enregistrer</button>${gift ? `<button type="button" class="danger" data-act="del-gift" data-id="${gift.id}">Supprimer</button>` : ''}</div></form>`);
  syncGiftForm();
}
function syncGiftForm() {
  const f = $('#gift-form'); if (!f) return;
  const dir = f.direction.value;
  f.querySelectorAll('[data-only=given]').forEach((el) => el.classList.toggle('hide', dir !== 'given'));
  $('#group-fields').classList.toggle('hide', !(dir === 'given' && f.is_group.checked));
}

// ====================== actions / formulaires ======================
const refresh = async () => { const y = scrollY; await render(); scrollTo(0, y); };

const bulk = async (action, value) => {
  const ids = [...state.sel]; if (!ids.length) return;
  await api('/api/contacts/bulk', 'POST', { ids, action, value });
  toast(`${ids.length} contact${ids.length > 1 ? 's' : ''} modifié${ids.length > 1 ? 's' : ''} ✓`);
  state.sel.clear(); state.contacts = null; refresh();
};

const actions = {
  'toggle-xmas': (el, e) => {
    if (e.target.closest('[data-stop]')) return;
    const card = el.closest('.xmas'); const c = card.classList.toggle('collapsed');
    try { localStorage.setItem('xmasCollapsed', c ? '1' : '0'); } catch {}
  },
  'toggle-select': () => { state.selectMode = !state.selectMode; state.sel.clear(); state.drawContacts(); },
  'toggle-sel': (el) => { const id = +el.dataset.id; state.sel.has(id) ? state.sel.delete(id) : state.sel.add(id); state.drawContacts(); },
  'sel-all': () => { state.visibleContacts().forEach((c) => state.sel.add(c.id)); state.drawContacts(); },
  'sel-none': () => { state.sel.clear(); state.drawContacts(); },
  'close-modal': () => closeModal(),
  'new-contact': () => (location.hash = '#/contact/new'),
  'new-visit': (el) => visitModal({ ids: el.dataset.id ? [+el.dataset.id] : [], kind: el.dataset.kind || 'visit' }),
  'edit-visit': (el) => visitModal({ visit: { id: el.dataset.id, date: el.dataset.date, kind: el.dataset.kind, note: el.dataset.note } }),
  'seen-today': async (el) => { await api('/api/visits', 'POST', { contact_ids: [+el.dataset.id], date: todayStr(), kind: el.dataset.kind || 'visit' }); toast(el.dataset.kind === 'news' ? 'Nouvelles enregistrées ✓' : 'Visite enregistrée ✓'); state.contacts = null; refresh(); },
  'del-visit': async (el) => { await api(`/api/visits/${el.dataset.id}`, 'DELETE'); state.contacts = null; refresh(); },
  'del-contact': async (el) => { if (!confirm('Supprimer ce contact et tout son historique ?')) return; await api(`/api/contacts/${el.dataset.id}`, 'DELETE'); state.contacts = null; location.hash = '#/contacts'; },
  'del-photo': async (el) => { await api(`/api/contacts/${el.dataset.id}/photo`, 'DELETE'); state.contacts = null; refresh(); },
  'pick-photo': (el) => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files[0]; if (!file) return;
      const img = await createImageBitmap(file); const s = Math.min(1, 480 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas'); cv.width = img.width * s; cv.height = img.height * s;
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      await api(`/api/contacts/${el.dataset.id}/photo`, 'POST', { dataUrl: cv.toDataURL('image/jpeg', 0.85) });
      state.contacts = null; toast('Photo mise à jour'); refresh();
    }; input.click();
  },
  'new-gift': (el) => giftModal({ contact: el.dataset.contact ? +el.dataset.contact : undefined, occasion: el.dataset.occasion, year: el.dataset.year ? +el.dataset.year : undefined }),
  'edit-gift': async (el) => { const g = (await api('/api/gifts')).find((x) => x.id === +el.dataset.id); giftModal({ gift: g }); },
  'del-gift': async (el) => { if (!confirm('Supprimer ce cadeau ?')) return; await api(`/api/gifts/${el.dataset.id}`, 'DELETE'); closeModal(); refresh(); },
  'cycle-gift': async (el) => { await api(`/api/gifts/${el.dataset.id}`, 'PUT', { status: NEXT_STATUS[el.dataset.status] }); refresh(); },
  tab: (el) => { state.tab.gifts = el.dataset.tab; refresh(); },
  'g-sync': async (el) => { el.disabled = true; el.textContent = '⏳ Synchronisation…'; try { const r = await api('/api/google/sync', 'POST'); state.contacts = null; toast(r.errors.length ? 'Synchro terminée avec des erreurs' : 'Synchro terminée ✓', !!r.errors.length); } finally { refresh(); } },
  'g-disconnect': async () => { if (!confirm('Déconnecter Google ? (Les données locales sont conservées.)')) return; await api('/api/google/disconnect', 'POST'); refresh(); },
  import: () => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/json';
    input.onchange = async () => {
      if (!confirm('Cela REMPLACE tous les contacts, visites et cadeaux actuels. Continuer ?')) return;
      const r = await api('/api/import', 'POST', JSON.parse(await input.files[0].text())); state.contacts = null; toast(`${r.contacts} contacts importés`);
    }; input.click();
  },
};

const forms = {
  async contact(fd, el) {
    const b = Object.fromEntries(fd.entries());
    for (const k of ['track', 'gift_birthday', 'gift_christmas', 'hidden']) b[k] = fd.has(k);
    const id = el.dataset.id;
    const saved = id ? await api(`/api/contacts/${id}`, 'PUT', b) : await api('/api/contacts', 'POST', b);
    state.contacts = null; toast('Enregistré ✓');
    if (!id) location.hash = `#/contact/${saved.id}`; else refresh();
  },
  async visit(fd, el) {
    const b = { kind: fd.get('kind'), date: fd.get('date'), note: fd.get('note'), contact_ids: fd.getAll('contact_ids').map(Number) };
    if (el.dataset.id) await api(`/api/visits/${el.dataset.id}`, 'PUT', { kind: b.kind, date: b.date, note: b.note });
    else await api('/api/visits', 'POST', b);
    closeModal(); state.contacts = null; toast('Visite enregistrée ✓'); refresh();
  },
  async gift(fd, el) {
    const b = Object.fromEntries(fd.entries()); b.is_group = fd.has('is_group');
    el.dataset.id ? await api(`/api/gifts/${el.dataset.id}`, 'PUT', b) : await api('/api/gifts', 'POST', b);
    closeModal(); toast('Cadeau enregistré ✓'); refresh();
  },
  async thresholds(fd) {
    await api('/api/settings/thresholds', 'PUT', Object.fromEntries([...fd.entries()]));
    state.meta = await api('/api/meta'); toast('Seuils enregistrés ✓'); refresh();
  },
  async 'google-creds'(fd) { await api('/api/google/config', 'PUT', Object.fromEntries(fd.entries())); toast('Enregistré ✓'); refresh(); },
};

const changes = {
  'bulk-cat': (el) => { if (el.value) bulk('category', el.value === '__none' ? '' : el.value); },
  'bulk-more': (el) => {
    const [a, v] = el.value.split(':'); if (!a) return;
    if (a === 'delete' && !confirm(`Supprimer définitivement ${state.sel.size} contact(s) avec leurs visites et cadeaux ?\n(Pour juste les écarter, utilise « Masquer ».)`)) { el.value = ''; return; }
    bulk(a, v);
  },
  'gift-year': (el) => { state.tab.giftYear = +el.value; refresh(); },
  'hist-q': (el) => { (state.tab.hist ||= {}).q = el.value; refresh(); },
  'hist-dir': (el) => { (state.tab.hist ||= {}).dir = el.value; refresh(); },
  'hist-occ': (el) => { (state.tab.hist ||= {}).occ = el.value; refresh(); },
  'g-opt': async (el) => { await api('/api/google/config', 'PUT', { options: { [el.dataset.key]: el.checked } }); toast('Option enregistrée'); },
  'picker-filter': (el) => { const q = el.value.toLowerCase(); document.querySelectorAll('.picker label').forEach((l) => l.classList.toggle('hide', !l.dataset.name.includes(q))); },
};

document.addEventListener('click', async (e) => {
  if (e.target.closest('[data-stop]')) return;
  const el = e.target.closest('[data-act]'); if (!el || !actions[el.dataset.act]) return;
  e.preventDefault();
  try { await actions[el.dataset.act](el, e); } catch (err) { toast(err.message, true); }
});
document.addEventListener('submit', async (e) => {
  const el = e.target.closest('[data-form]'); if (!el) return;
  e.preventDefault();
  try { await forms[el.dataset.form](new FormData(el), el); } catch (err) { toast(err.message, true); }
});
document.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-change]');
  if (el && changes[el.dataset.change]) { try { await changes[el.dataset.change](el); } catch (err) { toast(err.message, true); } }
  if (e.target.closest('#gift-form')) syncGiftForm();
});
document.addEventListener('input', (e) => { if (e.target.dataset?.change === 'picker-filter') changes['picker-filter'](e.target); });

// ====================== routeur ======================
async function render() {
  const [path, qs] = location.hash.slice(1).split('?');
  const parts = (path || '/').split('/').filter(Boolean);
  const name = parts[0] || 'dashboard';
  const main = $('#main');
  document.querySelectorAll('#nav [data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === (name === 'contact' ? 'contacts' : name)));
  try {
    if (!state.meta) state.meta = await api('/api/meta');
    await (pages[name] || pages.dashboard)(main, parts[1], new URLSearchParams(qs || ''));
  } catch (err) { main.innerHTML = `<div class="card">⚠️ ${esc(err.message)}</div>`; }
}
window.addEventListener('hashchange', () => { closeModal(); render(); scrollTo(0, 0); });
render();

// PWA : service worker (disponible en https ou sur localhost)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
