/* Qui finance la politique suisse ? — site statique, aucune dépendance. */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LEGAL = new Set(["ag", "sa", "gmbh", "sarl", "ltd", "inc", "genossenschaft", "cooperative", "societe", "anonyme", "the", "holding", "schweiz", "suisse", "switzerland"]);
const norm = (s, strip = false) => {
  let t = String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim();
  if (strip) { const w = t.split(/\s+/).filter((x) => !LEGAL.has(x)); if (w.length) t = w.join(" "); }
  return t.replace(/\s+/g, " ");
};
const nf = new Intl.NumberFormat("fr-CH", { maximumFractionDigits: 0 });
const chf = (v) => (v == null ? "–" : nf.format(v) + " CHF");
const short = (v) => v >= 1e6 ? (v / 1e6).toLocaleString("fr-CH", { maximumFractionDigits: 1 }) + " mio" : v >= 1e3 ? Math.round(v / 1e3) + " k" : nf.format(v || 0);
const uniq = (a) => [...new Set(a.filter((x) => x != null && x !== ""))];
const sum = (a, f) => a.reduce((s, x) => s + (f(x) || 0), 0);
const PAGE = 50;

const ROLE = { beirat: "Conseil consultatif", vorstand: "Comité / conseil", geschaeftsfuehrend: "Direction", mitglied: "Membre", taetig: "Activité", patronatskomitee: "Comité de patronage", beratend: "Conseil", finanziell: "Participation financière", gesellschafter: "Associé" };
const FUNC = { praesident: "président·e", vizepraesident: "vice-président·e", mitglied: "membre", geschaeftsfuehrer: "directeur·rice", inhaber: "propriétaire", angestellt: "employé·e", eigentuemerin: "propriétaire" };
const STATUT = { remunere: "Rémunéré", benevole: "Bénévole", inconnu: "Non communiqué" };

let M = {}, A = { dons: [], campagnes: [] }, L = { elus: [], liens: [], badges: [] }, C = [], T = [], V = [];
const idx = { elu: new Map(), donor: new Map(), recip: new Map(), org: new Map(), orgNorm: new Map(), donorNorm: new Map(), vote: new Map(), voteEvt: new Map() };

async function getJSON(name, fallback) {
  try { const r = await fetch(`data/${name}.json`, { cache: "no-cache" }); if (!r.ok) throw 0; return await r.json(); }
  catch { return fallback; }
}

function buildIndexes() {
  for (const e of L.elus) { e.liens = []; e.badges = []; e._n = norm(e.nom); idx.elu.set(e.id, e); }
  for (const l of L.liens) {
    const e = idx.elu.get(l.p); if (e) e.liens.push(l);
    let o = idx.org.get(l.org);
    if (!o) { o = { nom: l.org, groupe: l.groupe, secteur: l.secteur, liens: [], _n: norm(l.org) }; idx.org.set(l.org, o); idx.orgNorm.set(norm(l.org, true), o); }
    o.liens.push(l);
  }
  for (const b of L.badges) { const e = idx.elu.get(b.p); if (e) e.badges.push(b); }
  for (const v of V) { v._n = norm(`${v.titre} ${v.titre_off} ${v.type}`); idx.vote.set(v.id, v); if (v.argent?.evt) idx.voteEvt.set(v.argent.evt, v); }
  for (const d of A.dons) {
    let g = idx.donor.get(d.donateur);
    if (!g) { g = { nom: d.donateur, type: d.type, secteur: d.secteur, lieu: d.lieu, dons: [], total: 0, _n: norm(d.donateur) }; idx.donor.set(d.donateur, g); idx.donorNorm.set(norm(d.donateur, true), g); }
    g.dons.push(d); g.total += d.montant || 0;
    let r = idx.recip.get(d.beneficiaire);
    if (!r) { r = { nom: d.beneficiaire, parti: d.parti, dons: [], total: 0, _n: norm(d.beneficiaire) }; idx.recip.set(d.beneficiaire, r); }
    r.dons.push(d); r.total += d.montant || 0;
  }
}

/* ---------------- Navigation ---------------- */
const TABS = ["chercher", "jouer", "absences", "lobbyistes", "reseaux", "dons", "votations", "parlement", "tendances", "debats", "nouveautes"];
function route() {
  const [tab, ...qs] = decodeURIComponent(location.hash.slice(1)).split(":");
  const q = qs.length ? qs.join(":") : undefined;
  const t = TABS.includes(tab) ? tab : "chercher";
  for (const x of TABS) $(`#tab-${x}`).hidden = x !== t;
  document.querySelectorAll(".tabs a").forEach((a) => (a.dataset.tab === t ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  document.querySelector(`.tabs a[data-tab="${t}"]`)?.scrollIntoView({ inline: "center", block: "nearest" });
  if (t === "chercher" && q != null && $("#q").value !== q) { $("#q").value = q; search(); }
  if (t === "tendances") { renderClassements(); renderTrends(); }
  if (t === "jouer") renderJouer(q);
  if (t === "absences") renderAbsences();
  if (t === "lobbyistes") renderLobbyistes();
  if (t === "reseaux") renderReseaux(q);
  if (t === "debats") renderDebats();
  if (t === "parlement") renderParlVotes();
}

/* ---------------- Recherche globale ---------------- */
function matchAll(hay, tokens) { return tokens.every((t) => hay.includes(t)); }

function search() {
  const raw = $("#q").value.trim(); const box = $("#results");
  history.replaceState(null, "", "#chercher" + (raw ? ":" + encodeURIComponent(raw) : ""));
  if (raw.length < 2) { box.innerHTML = ""; return; }
  const tokens = norm(raw).split(" ");
  const groups = [];
  const donors = [...idx.donor.values()].filter((g) => matchAll(g._n + " " + norm(g.secteur), tokens)).sort((a, b) => b.total - a.total);
  const recips = [...idx.recip.values()].filter((r) => matchAll(r._n + " " + norm(r.parti), tokens)).sort((a, b) => b.total - a.total);
  const elus = L.elus.filter((e) => matchAll(e._n + " " + norm(e.parti) + " " + norm(e.canton), tokens)).sort((a, b) => b.liens.length - a.liens.length);
  const orgs = [...idx.org.values()].filter((o) => matchAll(o._n + " " + norm(o.groupe) + " " + norm(o.secteur), tokens)).sort((a, b) => b.liens.length - a.liens.length);
  const votes = V.filter((v) => matchAll(v._n, tokens));
  const badges = L.badges.filter((b) => matchAll(norm(b.nom + " " + b.fonction + " " + b.mandats.join(" ")), tokens));

  if (donors.length) groups.push(group("Donateurs", donors.length, donors.slice(0, 8).map((g) =>
    hit("m", "donor", g.nom, chf(g.total), `${g.dons.length} don${g.dons.length > 1 ? "s" : ""}. ${g.secteur}${g.lieu ? ". " + g.lieu : ""}`)), donors.length > 8 && `#dons`, raw));
  if (recips.length) groups.push(group("Bénéficiaires (partis, comités, candidats)", recips.length, recips.slice(0, 8).map((r) =>
    hit("m", "recip", r.nom, chf(r.total), `${r.dons.length} don${r.dons.length > 1 ? "s" : ""} reçus${r.parti ? ". " + r.parti : ""}`))));
  if (votes.length) groups.push(group("Votations fédérales", votes.length, votes.slice(0, 6).map((v) =>
    hit("m", "vote", v.titre, v.oui != null ? `${pct(v.oui)} ${ouiLbl(v)}` : v.statut, `${dateFr(v.date)}. ${v.type}. ${v.statut}`, v.id))));
  if (elus.length) groups.push(group("Parlementaires", elus.length, elus.slice(0, 8).map((e) =>
    hit("i", "elu", e.nom, `${e.liens.length} mandats`, `${e.parti}, ${e.canton}, ${e.conseil}. ${e.liens.filter((l) => l.statut === "remunere").length} rémunérés`))));
  if (orgs.length) groups.push(group("Organisations liées à des élus", orgs.length, orgs.slice(0, 8).map((o) =>
    hit("i", "org", o.nom, `${uniq(o.liens.map((l) => l.p)).length} élus`, `${o.groupe}. ${o.secteur}`))));
  if (badges.length) groups.push(group("Titulaires de badges d'accès au Palais fédéral", badges.length, badges.slice(0, 6).map((b) => {
    const e = idx.elu.get(b.p);
    return hit("i", "elu", b.nom, "", `Invité·e de ${e ? e.nom : "?"}${b.fonction ? ". " + b.fonction : ""}${b.mandats.length ? ". " + b.mandats.slice(0, 3).join(", ") : ""}`, b.p);
  })));
  box.innerHTML = groups.join("") || `<p class="empty">Rien trouvé pour « ${esc(raw)} ». Essayez un nom plus court ou sans prénom, ou un secteur (banques, assurances, santé).</p>`;
}

function group(title, n, items, more, raw) {
  const link = more ? `<button class="chip" data-dons-q="${esc(raw)}">Voir les ${n} dans l'onglet Dons</button>` : "";
  return `<div class="group"><h3>${esc(title)} <small>${n}</small></h3>${items.join("")}${link}</div>`;
}
function hit(kind, type, name, right, sub, key) {
  return `<button class="hit ${kind}" data-open="${type}" data-key="${esc(key ?? name)}"><strong>${esc(name)}</strong><span class="amount">${esc(right)}</span><span class="sub">${esc(sub)}</span></button>`;
}

/* ---------------- Fiches détail ---------------- */
function openSheet(type, key) {
  const body = $("#sheet-body"); let html = "";
  if (type === "donor") html = sheetDonor(idx.donor.get(key));
  if (type === "recip") html = sheetRecip(idx.recip.get(key));
  if (type === "elu") html = sheetElu(idx.elu.get(Number(key)));
  if (type === "org") html = sheetOrg(idx.org.get(key));
  if (type === "vote") html = sheetVote(idx.vote.get(key));
  if (type === "scrutin") html = PARL ? sheetScrutin(key) : "";
  if (type === "cantonal") html = CANT ? sheetCantonal(key) : "";
  if (!html && ((type === "scrutin" && !PARL) || (type === "cantonal" && !CANT))) {  // données chargées à la demande
    body.innerHTML = `<p class="note">Chargement…</p>`; $("#sheet").hidden = false;
    (type === "scrutin" ? loadParl() : loadCant()).then(() => openSheet(type, key));
    return;
  }
  if (!html) return;
  body.innerHTML = html; ficheDebats(type, key);
  if (type === "elu") fillEluVotes(idx.elu.get(Number(key)));
  if (type === "vote") fillVoteFinal(idx.vote.get(key)); $("#sheet").hidden = false; $(".sheet-panel").scrollTop = 0; $(".close").focus();
}
const closeSheet = () => { $("#sheet").hidden = true; };
const kpi = (v, l, cls = "") => `<div class="kpi"><b class="${cls}">${esc(v)}</b><span>${esc(l)}</span></div>`;
const years = (ds) => { const y = uniq(ds.map((d) => d.annee)).sort(); return y.length ? (y.length > 1 ? `${y[0]}–${y.at(-1)}` : String(y[0])) : "–"; };
const linkBtn = (type, key, label) => `<button class="link" data-open="${type}" data-key="${esc(key)}">${esc(label)}</button>`;

function donList(ds, who) {
  return listMore([...ds].sort((a, b) => (b.montant || 0) - (a.montant || 0)).map((d) =>
    `<li><span>${who === "recip" ? linkBtn("recip", d.beneficiaire, d.beneficiaire) : linkBtn("donor", d.donateur, d.donateur)}</span><span class="amount money">${chf(d.montant)}</span>
     <span class="sub">${esc(d.cat)}${d.camp ? ` (${d.camp.toLowerCase()})` : ""}. ${esc(d.evt)}${d.budget ? ". Budget, décompte final pas encore publié" : ""}${d.nature && d.nature !== "Monétaire" ? ". " + esc(d.nature) : ""}</span></li>`), 10, "dons");
}
function sheetDonor(g) {
  if (!g) return "";
  const org = idx.orgNorm.get(norm(g.nom, true));
  const parties = {}; g.dons.forEach((d) => { const k = d.parti || (d.cat === "Votation" ? `Votations (${d.camp || "?"})` : "Autres"); parties[k] = (parties[k] || 0) + (d.montant || 0); });
  const split = Object.entries(parties).sort((a, b) => b[1] - a[1]);
  return `<h2>${esc(g.nom)}</h2><p class="note">${deHint(g.nom)} ${esc(g.type)}. ${esc(g.secteur)}${g.lieu ? ". " + esc(g.lieu) : ""}</p>
  <div class="kpis">${kpi(chf(g.total), "donnés au total", "money")}${kpi(g.dons.length, "dons déclarés")}${kpi(years(g.dons), "période")}</div>
  <section><h3>Répartition</h3>${bars(split.map(([k, v]) => ({ label: k, value: v })), "m")}</section>
  ${org ? `<section><h3>Aussi présent au Parlement</h3><p>${linkBtn("org", org.nom, org.nom)} a des liens avec ${uniq(org.liens.map((l) => l.p)).length} parlementaire(s).</p></section>` : ""}
  <section><h3>Tous les dons</h3>${donList(g.dons, "recip")}</section>`;
}
function sheetRecip(r) {
  if (!r) return "";
  const byDonor = {}; r.dons.forEach((d) => { byDonor[d.donateur] = (byDonor[d.donateur] || 0) + (d.montant || 0); });
  const top = Object.entries(byDonor).sort((a, b) => b[1] - a[1]).slice(0, 12);
  return `<h2>${esc(r.nom)}</h2><p class="note">${r.parti ? "Parti : " + esc(r.parti) : "Comité ou acteur de campagne"}</p>
  <div class="kpis">${kpi(chf(r.total), "reçus au total", "money")}${kpi(r.dons.length, "dons")}${kpi(Object.keys(byDonor).length, "donateurs")}</div>
  <section><h3>Principaux donateurs</h3>${bars(top.map(([k, v]) => ({ label: k, value: v, open: ["donor", k] })), "m")}</section>
  <section><h3>Tous les dons reçus</h3>${donList(r.dons, "donor")}</section>`;
}
function sheetElu(e) {
  if (!e) return "";
  const paid = e.liens.filter((l) => l.statut === "remunere");
  const known = sum(paid, (l) => l.montant);
  const sect = {}; e.liens.forEach((l) => { sect[l.secteur] = (sect[l.secteur] || 0) + 1; });
  return `<div class="elu-head">${e.photo ? `<figure class="portrait"><img src="${esc(e.photo)}" alt="${esc(e.nom)}" width="84" height="84" loading="lazy" onerror="this.parentNode.remove()"><figcaption>© ParlCH</figcaption></figure>` : ""}
  <div><h2>${esc(e.nom)}</h2><p class="note">${esc(e.parti)}, ${esc(e.canton)}, ${esc(e.conseil)}${e.profession ? ". " + esc(e.profession) : ""}${e.commissions ? `. Commissions : ${esc(e.commissions)}` : ""}</p></div></div>
  <div class="kpis">${kpi(e.liens.length, "mandats en cours", "infl")}${kpi(paid.length, "rémunérés")}${kpi(known ? chf(known) : "–", "montants communiqués / an")}</div>
  <section><h3>Secteurs</h3>${bars(Object.entries(sect).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v })), "i", (v) => v)}</section>
  <section><h3>Mandats</h3>${e.liens.length ? listMore([...e.liens].sort((a, b) => (b.statut === "remunere") - (a.statut === "remunere") || (b.montant || 0) - (a.montant || 0)).map((l) =>
    `<li><span>${linkBtn("org", l.org, l.org)} ${deHint(l.org)}</span><span class="tag ${l.statut === "remunere" ? "paid" : ""}">${l.montant ? chf(l.montant) : STATUT[l.statut]}</span>
     <span class="sub">${esc(ROLE[l.role] || l.role)}${l.fonction ? ", " + esc(FUNC[l.fonction] || l.fonction) : ""}. ${esc(l.secteur)}${l.principal ? ". Activité principale" : ""}</span></li>`), 8, "mandats") : `<p class="note">Aucun mandat déclaré.</p>`}</section>
  ${e.conseil === "CN" ? `<section><h3>Votes au Conseil national</h3><div id="elu-votes"><p class="note">Chargement…</p></div></section>` : ""}
  ${e.badges.length ? `<section><h3>Badges d'accès donnés</h3><ul class="list">${e.badges.map((b) => `<li><span>${esc(b.nom)}</span><span class="tag ${badgeType(b) === "Lobbyiste" ? "paid" : ""}">${esc(badgeType(b))}</span><span class="sub">${esc(trBadge(b.fonction))} ${deHint(b.fonction)}${b.mandats.length ? ". " + esc(b.mandats.join(", ")) : ""}</span></li>`).join("")}</ul></section>` : ""}
  <p><a href="#reseaux:elu|${e.id}" data-close>Voir son réseau</a> · ${e.parlement ? `<a href="${esc(e.parlement)}" target="_blank" rel="noopener">Fiche officielle sur parlament.ch</a> · ` : ""}<a href="${esc(e.url)}" target="_blank" rel="noopener">Fiche complète sur Lobbywatch</a></p>`;
}
function sheetOrg(o) {
  if (!o) return "";
  const donor = idx.donorNorm.get(norm(o.nom, true));
  return `<h2>${esc(o.nom)}</h2><p class="note">${deHint(o.nom)} ${esc(o.groupe)}. ${esc(o.secteur)}</p>
  <div class="kpis">${kpi(uniq(o.liens.map((l) => l.p)).length, "élus liés", "infl")}${kpi(o.liens.filter((l) => l.statut === "remunere").length, "mandats rémunérés")}${donor ? kpi(chf(donor.total), "dons déclarés", "money") : ""}</div>
  <section><h3>Parlementaires liés</h3>${listMore(o.liens.map((l) => { const e = idx.elu.get(l.p); return e ? `<li><span>${linkBtn("elu", e.id, e.nom)}</span><span class="tag ${l.statut === "remunere" ? "paid" : ""}">${l.montant ? chf(l.montant) : STATUT[l.statut]}</span><span class="sub">${esc(e.parti)}, ${esc(e.canton)}. ${esc(ROLE[l.role] || l.role)}${l.fonction ? ", " + esc(FUNC[l.fonction] || l.fonction) : ""}</span></li>` : ""; }).filter(Boolean), 10, "parlementaires")}</section>
  <p><a href="#reseaux:org|${esc(o.nom)}" data-close>Voir son réseau</a></p>
  ${donor ? `<section><h3>Dons de cette organisation</h3>${donList(donor.dons, "recip")}</section>` : ""}`;
}

/* ---------------- Barres ---------------- */
function bars(items, kind, fmt = short, max) {
  if (!items.length) return `<p class="note">Aucune donnée pour ce filtre.</p>`;
  const top = max ?? Math.max(...items.map((i) => i.value + (i.value2 || 0)));
  return `<div class="bars">${items.map((i) => `<div class="bar"><span class="lbl" title="${esc(i.label)}">${i.open ? `<button data-open="${i.open[0]}" data-key="${esc(i.open[1])}">${esc(i.label)}</button>` : esc(i.label)}</span>
    <span class="track"><span class="fill ${kind}" style="width:${(100 * i.value / top).toFixed(2)}%"></span>${i.value2 ? `<span class="fill i2" style="width:${(100 * i.value2 / top).toFixed(2)}%"></span>` : ""}</span>
    <span class="val">${esc(fmt(i.value + (i.value2 || 0)))}</span></div>`).join("")}</div>`;
}

/* ---------------- Tableaux filtrables ---------------- */
function select(id, label, values, all = "Tous") {
  return `<select id="${id}" aria-label="${esc(label)}"><option value="">${esc(label)} : ${esc(all)}</option>${values.map((v) => `<option>${esc(v)}</option>`).join("")}</select>`;
}
const state = { dons: { page: 0, sort: "montant", dir: -1 }, parl: { page: 0, sort: "n", dir: -1 } };

function setupDons() {
  const d = A.dons;
  $("#f-dons").innerHTML = `<input type="search" id="fd-q" placeholder="Donateur, bénéficiaire, votation…" aria-label="Filtrer les dons">
    ${select("fd-cat", "Type", uniq(d.map((x) => x.cat)).sort())}
    ${select("fd-parti", "Parti", uniq(d.map((x) => x.parti)).sort())}
    ${select("fd-sect", "Secteur", uniq(d.map((x) => x.secteur)).sort())}
    ${select("fd-an", "Année", uniq(d.map((x) => x.annee)).sort().reverse(), "Toutes")}
    ${select("fd-camp", "Camp", ["Pour", "Contre"])}
    <select id="fd-min" aria-label="Montant minimum"><option value="0">Tous montants</option><option value="50000">≥ 50 000</option><option value="100000">≥ 100 000</option><option value="500000">≥ 500 000</option></select>
    <button class="btn ghost" id="fd-csv">Exporter CSV</button>`;
  $("#f-dons").addEventListener("input", () => { state.dons.page = 0; renderDons(); });
  $("#fd-csv").addEventListener("click", () => exportCSV(filteredDons(), "dons.csv"));
  renderDons();
}
function filteredDons() {
  const q = norm($("#fd-q").value).split(" ").filter(Boolean);
  const f = { cat: $("#fd-cat").value, parti: $("#fd-parti").value, sect: $("#fd-sect").value, an: $("#fd-an").value, camp: $("#fd-camp").value, min: +$("#fd-min").value };
  return A.dons.filter((x) => (!f.cat || x.cat === f.cat) && (!f.parti || x.parti === f.parti) && (!f.sect || x.secteur === f.sect)
    && (!f.an || String(x.annee) === f.an) && (!f.camp || x.camp === f.camp) && (x.montant || 0) >= f.min
    && (!q.length || matchAll(norm(`${x.donateur} ${x.beneficiaire} ${x.evt} ${x.lieu}`), q)));
}
function renderDons() {
  const s = state.dons, rows = filteredDons();
  const key = { montant: (x) => x.montant || 0, annee: (x) => x.annee || 0, donateur: (x) => norm(x.donateur), beneficiaire: (x) => norm(x.beneficiaire) }[s.sort];
  rows.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * s.dir);
  $("#s-dons").innerHTML = `${nf.format(rows.length)} dons, <span class="money">${chf(sum(rows, (x) => x.montant))}</span>`;
  const th = (k, l, c = "") => `<th class="${c}"><button data-sort="dons:${k}">${l}</button></th>`;
  const page = rows.slice(s.page * PAGE, (s.page + 1) * PAGE);
  $("#t-dons").innerHTML = `<thead><tr>${th("donateur", "Donateur")}${th("beneficiaire", "Bénéficiaire")}<th class="hide-s">Objet</th>${th("annee", "Année", "num")}${th("montant", "Montant", "num")}</tr></thead>
    <tbody>${page.map((x) => `<tr class="click" data-open="donor" data-key="${esc(x.donateur)}"><td><strong>${esc(x.donateur)}</strong><br><span class="tag">${esc(x.secteur)}</span></td>
    <td>${esc(x.beneficiaire)}${x.parti ? ` <span class="tag">${esc(x.parti)}</span>` : ""}</td>
    <td class="hide-s">${esc(x.cat)}${x.camp ? ` <span class="tag ${x.camp.toLowerCase()}">${x.camp}</span>` : ""}<br><small>${esc(x.evt)}</small></td>
    <td class="num">${x.annee ?? "–"}</td><td class="num money"><strong>${chf(x.montant)}</strong></td></tr>`).join("")}</tbody>`;
  pager("#p-dons", rows.length, s, renderDons);
}

function setupParl() {
  $("#f-parl").innerHTML = `<input type="search" id="fp-q" placeholder="Élu ou organisation…" aria-label="Filtrer les parlementaires">
    <select id="fp-vue" aria-label="Vue"><option value="elus">Vue par élu</option><option value="mandats">Vue par mandat</option></select>
    ${select("fp-parti", "Parti", uniq(L.elus.map((x) => x.parti)).sort())}
    ${select("fp-conseil", "Conseil", uniq(L.elus.map((x) => x.conseil)).sort())}
    ${select("fp-sect", "Secteur", uniq(L.liens.map((x) => x.secteur)).sort())}
    <select id="fp-statut" aria-label="Rémunération"><option value="">Rémunération : toutes</option><option value="remunere">Rémunérés</option><option value="benevole">Bénévoles</option><option value="inconnu">Non communiqué</option></select>
    <button class="btn ghost" id="fp-csv">Exporter CSV</button>`;
  $("#f-parl").addEventListener("input", () => { state.parl.page = 0; renderParl(); });
  $("#fp-csv").addEventListener("click", () => exportCSV(filteredLiens().map((l) => ({ elu: idx.elu.get(l.p)?.nom, parti: idx.elu.get(l.p)?.parti, ...l })), "mandats.csv"));
  renderParl();
}
function filteredLiens() {
  const q = norm($("#fp-q").value).split(" ").filter(Boolean);
  const f = { parti: $("#fp-parti").value, conseil: $("#fp-conseil").value, sect: $("#fp-sect").value, st: $("#fp-statut").value };
  return L.liens.filter((l) => { const e = idx.elu.get(l.p); return e && (!f.parti || e.parti === f.parti) && (!f.conseil || e.conseil === f.conseil)
    && (!f.sect || l.secteur === f.sect) && (!f.st || l.statut === f.st) && (!q.length || matchAll(norm(`${e.nom} ${l.org} ${l.groupe}`), q)); });
}
function renderParl() {
  const s = state.parl, vue = $("#fp-vue").value, liens = filteredLiens();
  const th = (k, l, c = "") => `<th class="${c}"><button data-sort="parl:${k}">${l}</button></th>`;
  let rows, head, row;
  if (vue === "elus") {
    const by = new Map(); liens.forEach((l) => { if (!by.has(l.p)) by.set(l.p, []); by.get(l.p).push(l); });
    const f = { parti: $("#fp-parti").value, conseil: $("#fp-conseil").value };
    const noFilter = !$("#fp-q").value && !$("#fp-sect").value && !$("#fp-statut").value;
    rows = L.elus.filter((e) => by.has(e.id) || (noFilter && (!f.parti || e.parti === f.parti) && (!f.conseil || e.conseil === f.conseil)))
      .map((e) => { const ls = by.get(e.id) || []; const sc = {}; ls.forEach((l) => { sc[l.secteur] = (sc[l.secteur] || 0) + 1; });
        return { e, n: ls.length, paid: ls.filter((l) => l.statut === "remunere").length, top: Object.entries(sc).sort((a, b) => b[1] - a[1])[0]?.[0] || "–", nom: norm(e.nom) }; });
    const key = { n: (x) => x.n, paid: (x) => x.paid, nom: (x) => x.nom }[s.sort] || ((x) => x.n);
    rows.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * s.dir);
    $("#s-parl").innerHTML = `${rows.length} élus, <span class="infl">${liens.length} mandats</span>, dont ${liens.filter((l) => l.statut === "remunere").length} rémunérés`;
    head = `<tr>${th("nom", "Élu")}<th>Parti</th><th class="hide-s">Canton</th>${th("n", "Mandats", "num")}${th("paid", "Rémunérés", "num")}<th class="hide-s">Secteur principal</th></tr>`;
    row = (x) => `<tr class="click" data-open="elu" data-key="${x.e.id}"><td><span class="who">${avatar(x.e)}<span><strong>${esc(x.e.nom)}</strong><br><small>${esc(x.e.conseil)}</small></span></span></td><td>${esc(x.e.parti)}</td><td class="hide-s">${esc(x.e.canton)}</td><td class="num infl"><strong>${x.n}</strong></td><td class="num">${x.paid}</td><td class="hide-s">${esc(x.top)}</td></tr>`;
  } else {
    rows = liens.map((l) => ({ l, e: idx.elu.get(l.p), nom: norm(idx.elu.get(l.p).nom), n: l.montant || 0, paid: l.statut === "remunere" ? 1 : 0 }));
    const key = { n: (x) => x.n, paid: (x) => x.paid, nom: (x) => x.nom }[s.sort] || ((x) => x.n);
    rows.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * s.dir);
    $("#s-parl").innerHTML = `<span class="infl">${rows.length} mandats</span>, dont ${rows.filter((x) => x.paid).length} rémunérés`;
    head = `<tr>${th("nom", "Élu")}<th>Organisation</th><th class="hide-s">Secteur</th><th class="hide-s">Rôle</th>${th("n", "Rémunération", "num")}</tr>`;
    row = (x) => `<tr class="click" data-open="org" data-key="${esc(x.l.org)}"><td><strong>${esc(x.e.nom)}</strong><br><small>${esc(x.e.parti)}, ${esc(x.e.canton)}</small></td><td>${esc(x.l.org)}</td><td class="hide-s">${esc(x.l.secteur)}</td><td class="hide-s">${esc(ROLE[x.l.role] || x.l.role)}</td><td class="num"><span class="tag ${x.paid ? "paid" : ""}">${x.l.montant ? chf(x.l.montant) : STATUT[x.l.statut]}</span></td></tr>`;
  }
  const page = rows.slice(s.page * PAGE, (s.page + 1) * PAGE);
  $("#t-parl").innerHTML = `<thead>${head}</thead><tbody>${page.map(row).join("")}</tbody>`;
  pager("#p-parl", rows.length, s, renderParl);
}
function pager(sel, n, s, render) {
  const pages = Math.max(1, Math.ceil(n / PAGE));
  if (s.page >= pages) s.page = pages - 1;
  $(sel).innerHTML = pages > 1 ? `<button ${s.page ? "" : "disabled"} data-p="-1">Précédent</button><span>Page ${s.page + 1} sur ${pages}</span><button ${s.page < pages - 1 ? "" : "disabled"} data-p="1">Suivant</button>` : "";
  $(sel).onclick = (ev) => { const b = ev.target.closest("[data-p]"); if (!b) return; s.page += +b.dataset.p; render(); $(sel).previousElementSibling.scrollIntoView({ block: "start" }); };
}
function exportCSV(rows, name) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]).filter((k) => typeof rows[0][k] !== "object" || rows[0][k] === null);
  const cell = (v) => { const s = String(v ?? ""); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const text = "\ufeff" + [cols.join(";"), ...rows.map((r) => cols.map((c) => cell(r[c])).join(";"))].join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = name; a.click();
}

/* ---------------- Votations ---------------- */
const pct = (v) => (v == null ? "–" : v.toLocaleString("fr-CH", { maximumFractionDigits: 1 }) + " %");
const num1 = (v) => (v == null ? "–" : v.toLocaleString("fr-CH", { maximumFractionDigits: 1 }));
const dateFr = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("fr-CH", { day: "numeric", month: "long", year: "numeric" });
const ouiLbl = (v) => (v.type === "Question subsidiaire" ? "pour l'initiative" : "oui");
const STATUT_CLS = { "Accepté": "yes", "Refusé": "no" };
const PAROLE = { oui: ["Oui", "pour"], non: ["Non", "contre"], aucun: ["Pas de mot d'ordre", ""], "liberté": ["Liberté de vote", ""],
  "contre-projet": ["Préfère le contre-projet", ""], initiative: ["Préfère l'initiative", ""], pour: ["Pour", "pour"], contre: ["Contre", "contre"] };

function setupVotes() {
  $("#f-votes").innerHTML = `<input type="search" id="fv-q" placeholder="Objet, mot-clé…" aria-label="Filtrer les votations">
    ${select("fv-an", "Année", uniq(V.map((v) => v.date.slice(0, 4))).sort().reverse(), "Toutes")}
    ${select("fv-type", "Type", uniq(V.map((v) => v.type)).sort())}
    ${select("fv-statut", "Résultat", uniq(V.map((v) => v.statut)).sort())}`;
  $("#f-votes").addEventListener("input", renderVotes);
  renderVotes();
}
function renderVotes() {
  if ($("#fv-niveau")?.value === "cantonal") { renderCantonal(); return; }
  const q = norm($("#fv-q").value).split(" ").filter(Boolean);
  const f = { an: $("#fv-an").value, type: $("#fv-type").value, st: $("#fv-statut").value };
  const rows = V.filter((v) => (!f.an || v.date.startsWith(f.an)) && (!f.type || v.type === f.type) && (!f.st || v.statut === f.st) && (!q.length || matchAll(v._n, q)));
  $("#s-votes").textContent = `${rows.length} objet${rows.length > 1 ? "s" : ""}, dont ${rows.filter((v) => v.argent).length} avec des campagnes déclarées au CDF`;
  const byDate = new Map(); rows.forEach((v) => { if (!byDate.has(v.date)) byDate.set(v.date, []); byDate.get(v.date).push(v); });
  $("#l-votes").innerHTML = [...byDate].map(([d, vs]) => `<div class="vote-day"><h3>${esc(dateFr(d))}</h3>${vs.map(voteRow).join("")}</div>`).join("")
    || `<p class="empty">${V.length ? "Aucune votation pour ces filtres." : "Les votations apparaîtront après la prochaine mise à jour des données."}</p>`;
}
function voteRow(v) {
  const a = v.argent, kt = v.cantons_oui != null && v.cantons_non != null && v.cantons_oui + v.cantons_non > 0;
  return `<button class="vote-row" data-open="vote" data-key="${esc(v.id)}">
    <span class="vr-head"><strong>${esc(v.titre)}</strong><span class="pill ${STATUT_CLS[v.statut] || ""}">${esc(v.statut)}</span></span>
    <span class="sub">${esc(v.type)}</span>
    ${v.oui != null ? `<span class="yesno" role="img" aria-label="${pct(v.oui)} ${ouiLbl(v)}"><span style="width:${v.oui}%"></span></span>
    <span class="sub"><b class="infl">${pct(v.oui)} ${ouiLbl(v)}</b> · participation ${pct(v.participation)}${kt ? ` · cantons : ${num1(v.cantons_oui)} oui, ${num1(v.cantons_non)} non` : ""}</span>` : ""}
    ${a ? `<span class="sub">Campagnes déclarées : <b class="infl">${short(a.pour)} CHF pour</b>, <b class="money">${short(a.contre)} CHF contre</b></span>` : ""}
  </button>`;
}
function tileStyle(oui) {
  if (oui == null) return "";
  const t = Math.min(1, Math.abs(oui - 50) / 25), mix = Math.round(12 + 43 * t);  // plafonné pour garder le texte lisible
  return `background:color-mix(in srgb, ${oui >= 50 ? "var(--infl)" : "var(--money)"} ${mix}%, var(--card))`;
}
function sheetVote(v) {
  if (!v) return "";
  const a = v.argent, cs = Object.entries(v.cantons || {});
  const ktOui = v.cantons_oui ?? cs.filter(([, c]) => c.accepte === true).length, ktNon = v.cantons_non ?? cs.filter(([, c]) => c.accepte === false).length;
  const parole = (label, code) => { const [txt, cls] = PAROLE[code] || [code, ""]; return `<li><span>${esc(label)}</span><span class="tag ${cls}">${esc(txt)}</span></li>`; };
  const p = v.parlement || {};
  const byCamp = (c) => { const by = {}; (a ? A.dons.filter((d) => d.evt === a.evt && d.camp === c) : []).forEach((d) => { by[d.donateur] = (by[d.donateur] || 0) + (d.montant || 0); }); return Object.entries(by).sort((x, y) => y[1] - x[1]); };
  const tops = { Pour: byCamp("Pour"), Contre: byCamp("Contre") };
  const mx = Math.max(1, ...[...tops.Pour, ...tops.Contre].map(([, v]) => v));  // même échelle pour les deux camps
  const camp = (c, kind) => { const top = tops[c];
    return top.length ? `<h4>Donateurs du ${c === "Pour" ? "oui" : "non"} <small class="note">${top.length}</small></h4>${bars(top.slice(0, 15).map(([k, v]) => ({ label: k, value: v, open: ["donor", k] })), kind, short, mx)}${top.length > 15 ? `<p class="note">Et ${top.length - 15} autres dans l'onglet Dons.</p>` : ""}` : "";
  };
  const budget = a && A.campagnes.some((x) => x.evt === a.evt && x.budget);
  return `<h2>${esc(v.titre)}</h2><p class="note">${esc(v.type)}, ${esc(dateFr(v.date))}. ${esc(v.titre_off)}</p>
  <p><span class="pill ${STATUT_CLS[v.statut] || ""}">${esc(v.statut)}</span></p>
  <div class="kpis">${v.oui != null ? kpi(pct(v.oui), v.type === "Question subsidiaire" ? "pour l'initiative" : "de oui", "infl") + kpi(pct(v.participation), "participation") + kpi(`${num1(ktOui)} / ${num1(ktNon)}`, "cantons oui / non") : ""}
    ${a ? kpi(short(a.pour), "CHF, campagne du oui", "infl") + kpi(short(a.contre), "CHF, campagne du non", "money") : ""}</div>
  ${cs.some(([, c]) => c.oui != null) ? `<section><h3>Résultat par canton</h3><div class="legend wrap-l"><span><i style="background:var(--infl)"></i>majorité ${ouiLbl(v)}</span><span><i style="background:var(--money)"></i>majorité ${v.type === "Question subsidiaire" ? "pour le contre-projet" : "non"}</span><span>plus la couleur est marquée, plus l'écart est net</span></div>
    <div class="cantons">${cs.map(([k, c]) => `<div class="ct" style="${tileStyle(c.oui)}" title="${k} : ${pct(c.oui)} ${ouiLbl(v)}, participation ${pct(c.participation)}"><b>${k}</b><span>${c.oui != null ? pct(c.oui) : "–"}</span></div>`).join("")}</div></section>` : ""}
  <section><h3>Argent de la campagne</h3>${a ? `<div class="legend"><span><i style="background:var(--infl)"></i>oui</span><span><i style="background:var(--money)"></i>non</span></div><p class="note">Recettes déclarées au CDF par les comités de chaque camp${budget ? ". Certains chiffres sont encore des budgets : le décompte final n'est pas publié" : ""}. Un même comité peut déclarer une campagne commune à plusieurs objets du même jour.</p>${camp("Pour", "i")}${camp("Contre", "m")}`
    : `<p class="note">Aucune campagne déclarée au CDF pour cet objet. L'obligation s'applique depuis le 23 octobre 2023, et seulement aux campagnes de plus de 50 000 CHF.</p>`}</section>
  ${v.vote_final ? `<section id="vote-final"><p class="note">Chargement du vote final…</p></section>` : ""}
  ${Object.keys(v.mots_ordre || {}).length || v.conseil_federal ? `<section><h3>Mots d'ordre</h3><ul class="list">${v.conseil_federal ? parole("Conseil fédéral", v.conseil_federal) : ""}
    ${p.nrja || p.nrnein ? `<li><span>Conseil national</span><span>${p.nrja} oui, ${p.nrnein} non</span></li>` : ""}${p.srja || p.srnein ? `<li><span>Conseil des États</span><span>${p.srja} oui, ${p.srnein} non</span></li>` : ""}
    ${Object.entries(v.mots_ordre || {}).map(([k, c]) => parole(k, c)).join("")}</ul></section>` : ""}
  ${v.lien ? `<p><a href="${esc(v.lien)}" target="_blank" rel="noopener">Fiche complète sur Swissvotes</a></p>` : ""}`;
}

/* ---------------- Composition du Parlement ---------------- */
const FRACTIONS = [["G", "Verts"], ["S", "PS"], ["GL", "Vert'libéraux"], ["M-E", "Le Centre / PEV"], ["RL", "PLR"], ["V", "UDC"]];
const fcls = (f) => (FRACTIONS.some(([k]) => k === f) ? f.replace("-", "") : "X");
const avatar = (e) => (e.photo ? `<img class="avatar" src="${esc(e.photo)}" alt="" width="32" height="32" loading="lazy" onerror="this.remove()">` : "");

function hemicycle(conseil, seats, rows, paint, legend) {
  const order = new Map(FRACTIONS.map(([k], i) => [k, i]));
  const elus = L.elus.filter((e) => e.conseil === conseil)
    .sort((a, b) => (order.get(a.fraction) ?? 9) - (order.get(b.fraction) ?? 9) || a.parti.localeCompare(b.parti) || a.nom.localeCompare(b.nom));
  // Sièges répartis sur des rangées concentriques, proportionnellement au rayon, puis lus de gauche à droite
  const R = 100, O = 8, r0 = rows > 5 ? 38 : 46;
  const radii = Array.from({ length: rows }, (_, i) => r0 + (R - r0) * i / (rows - 1));
  const tot = radii.reduce((s, r) => s + r, 0);
  const counts = radii.map((r) => Math.round(seats * r / tot)); counts[rows - 1] += seats - counts.reduce((s, n) => s + n, 0);
  const pos = [];
  radii.forEach((r, i) => { const n = counts[i]; for (let j = 0; j < n; j++) { const a = Math.PI * (1 - (n === 1 ? 0.5 : j / (n - 1))); pos.push({ a, x: R + O + r * Math.cos(a), y: R + O - r * Math.sin(a) }); } });
  pos.sort((p, q) => q.a - p.a);
  const dot = Math.min((R - r0) / (rows - 1), Math.PI * R / counts[rows - 1]) * 0.42;
  const circles = pos.map((p, i) => { const e = elus[i], at = `cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${dot.toFixed(2)}"`;
    const pt = e && paint ? paint(e) : null;
    return e ? `<circle class="seat${pt?.dim ? " dim" : ""}" ${at} fill="${pt ? pt.fill : `var(--f-${fcls(e.fraction)})`}" data-open="elu" data-key="${e.id}"><title>${esc(e.nom)} (${esc(e.parti)}, ${esc(e.canton)})${pt?.title ? ` : ${esc(pt.title)}` : ""}</title></circle>`
      : `<circle ${at} fill="none" stroke="var(--muted)" stroke-dasharray="1.5 1.5"><title>Siège non encore saisi par Lobbywatch</title></circle>`; }).join("");
  const n = (k) => elus.filter((e) => (FRACTIONS.some(([f]) => f === k) ? e.fraction === k : !FRACTIONS.some(([f]) => f === e.fraction))).length;
  const missing = seats - elus.length;
  return `<svg class="hemi" viewBox="0 0 ${2 * (R + O)} ${R + O + dot + 2}" role="img" aria-label="${esc(conseil === "CN" ? "Conseil national" : "Conseil des États")} : ${FRACTIONS.map(([k, l]) => `${l} ${n(k)}`).join(", ")}">${circles}</svg>
  ${legend ?? `<div class="legend wrap-l">${FRACTIONS.filter(([k]) => n(k)).map(([k, l]) => `<span><i style="background:var(--f-${fcls(k)})"></i>${esc(l)} <b>${n(k)}</b></span>`).join("")}${n("X") ? `<span><i style="background:var(--f-X)"></i>Autres <b>${n("X")}</b></span>` : ""}${missing > 0 ? `<span><i class="vacant"></i>Non saisis <b>${missing}</b></span>` : ""}</div>`}`;
}
function renderHemis() {
  $("#n-elus").textContent = nf.format(L.elus.length);
  if (!L.elus.length) { $("#hemis").innerHTML = ""; return; }
  $("#hemis").innerHTML = card("Conseil national", "200 sièges", hemicycle("CN", 200, 8)) + card("Conseil des États", "46 sièges", hemicycle("CE", 46, 4));
}

/* ---------------- Votes au Conseil national ---------------- */
let PARL = null, parlLoading = null;
const DECI = { o: ["Oui", "var(--yes)"], n: ["Non", "var(--no)"], a: ["Abstention", "var(--abst)"], "-": ["Absent·e", "var(--absent)"], e: ["Excusé·e", "var(--excuse)"], p: ["Préside", "var(--absent)"] };
const P_CHANCE = 0.0027;  // probabilité d'un |z| ≥ 3 par pur hasard
function loadParl() {
  return parlLoading ||= getJSON("parlement", null).then((p) => {
    if (!p) return null;
    p.idx = new Map(p.scrutins.map((s) => [String(s[0]), s]));
    p.pnIndex = new Map(p.membres.map((m, i) => [m[0], i]));
    p.scrutins.forEach((s) => { s._n = norm(`${s[2]} ${s[3]} ${s[4]} ${s[5]}`); });
    PARL = p; return p;
  });
}
const affaireUrl = (objet) => { const m = /^(\d\d)\.(\d+)$/.exec(objet || ""); return m ? `https://www.parlament.ch/fr/ratsbetrieb/suche-curia-vista/geschaeft?AffairId=${+m[1] > 50 ? 19 : 20}${m[1]}${m[2].padStart(4, "0")}` : ""; };
const decision = (s, pn) => { const i = PARL.pnIndex.get(pn); return i == null ? " " : (s[8][i] || " "); };
const scrutinTitre = (s) => `${s[3]}${s[5] ? ` (${trVote(s[5])})` : ""}`;
function tally(s) { const c = { o: 0, n: 0, a: 0, "-": 0, e: 0 }; for (const ch of s[8]) if (ch in c) c[ch]++; return c; }

async function renderParlVotes() {
  const box = $("#cn-votes");
  if (!box || box.dataset.ready) return;
  box.innerHTML = `<p class="note">Chargement des votes…</p>`;
  const p = await loadParl();
  if (!p) { box.innerHTML = `<p class="empty">Les votes apparaîtront après la prochaine mise à jour des données.</p>`; return; }
  box.dataset.ready = "1";
  const groupes = Object.entries(p.interets).sort((a, b) => b[1].scrutins.length - a[1].scrutins.length || a[0].localeCompare(b[0]));
  box.innerHTML = `<div class="grid">
    <div class="card wide"><h3>Les élus liés à un groupe d'intérêts votent-ils comme leur parti ?</h3>
      <p class="hint">Pour chaque objet examiné par la commission compétente pour ce groupe, on compare la part de oui chez ses élus à celle qu'on attendrait d'après le vote de leurs propres groupes parlementaires. Un écart est « net » quand il est peu probable par hasard (|z| ≥ 3). Mandats actuels, pas forcément ceux du moment du vote. Un écart n'est pas une preuve d'influence.</p>
      <div class="filters">${`<select id="pv-groupe" aria-label="Groupe d'intérêts">${groupes.map(([g, v]) => `<option value="${esc(g)}">${esc(g)} (${v.scrutins.length} écart${v.scrutins.length > 1 ? "s" : ""})</option>`).join("")}</select>`}</div>
      <div id="pv-ecarts"></div></div>
    <div class="card wide"><h3>Tous les scrutins</h3>
      <div class="filters"><input type="search" id="pv-q" placeholder="Objet, numéro (24.060), mot-clé…" aria-label="Chercher un scrutin"></div>
      <div id="pv-liste"></div></div></div>`;
  $("#pv-groupe").addEventListener("input", renderEcarts);
  $("#pv-q").addEventListener("input", renderScrutins);
  renderEcarts(); renderScrutins();
}
function renderEcarts() {
  const g = $("#pv-groupe").value, v = PARL.interets[g];
  if (!v) { $("#pv-ecarts").innerHTML = ""; return; }
  const hasard = v.testes * P_CHANCE;
  $("#pv-ecarts").innerHTML = `<p class="summary"><span class="infl">${v.elus} élus liés</span> · ${nf.format(v.testes)} scrutins de leur domaine examinés (commission ${esc(v.commissions.join(", "))}) · <b>${v.scrutins.length} écart${v.scrutins.length > 1 ? "s" : ""} net${v.scrutins.length > 1 ? "s" : ""}</b>, dont environ ${hasard.toLocaleString("fr-CH", { maximumFractionDigits: 1 })} attendu${hasard >= 2 ? "s" : ""} par hasard${v.scrutins.length > 2 * hasard + 1 ? ' <span class="tag paid">au-delà du hasard</span>' : ""}</p>
  ${v.scrutins.length ? `<ul class="list">${v.scrutins.map(([id, n, o, a, d, z]) => { const s = PARL.idx.get(String(id));
    return `<li><span>${linkBtn("scrutin", id, scrutinTitre(s))}</span><span class="tag ${d > 0 ? "pour" : "contre"}">${d > 0 ? "+" : ""}${num1(d)} pts</span>
    <span class="sub">${esc(dateFr(s[1]))} · ${esc(s[2])} · oui chez ces ${n} élus : <b>${num1(o)} %</b>, attendu d'après leurs partis : ${num1(a)} %</span></li>`; }).join("")}</ul>`
    : `<p class="note">Ces élus votent comme leurs groupes parlementaires sur les objets de leur domaine : aucun écart net.</p>`}`;
}
function renderScrutins() {
  const q = norm($("#pv-q").value).split(" ").filter(Boolean);
  const rows = (q.length ? PARL.scrutins.filter((s) => matchAll(s._n, q)) : PARL.scrutins).slice(0, 40);
  $("#pv-liste").innerHTML = rows.length ? `<ul class="list">${rows.map((s) => { const c = tally(s);
    return `<li><span>${linkBtn("scrutin", s[0], scrutinTitre(s))}</span><span class="nowrap"><b class="infl">${c.o}</b> / <b class="money">${c.n}</b></span>
    <span class="sub">${esc(dateFr(s[1]))} · ${esc(s[2])}${s[4] ? ` · ${esc(s[4])}` : ""}</span></li>`; }).join("")}</ul>${q.length ? "" : `<p class="note">Les 40 plus récents sur ${nf.format(PARL.scrutins.length)}. Cherchez un objet pour remonter plus loin.</p>`}`
    : `<p class="empty">Aucun scrutin ne correspond.</p>`;
}

function sheetScrutin(id) {
  const s = PARL?.idx.get(String(id));
  if (!s) return "";
  const c = tally(s), url = affaireUrl(s[2]);
  const groupes = {};
  PARL.membres.forEach((m, i) => { const d = s[8][i]; if (!d || d === " ") return; const g = groupes[m[2] || "?"] ||= { o: 0, n: 0, a: 0, "-": 0, e: 0 }; if (d in g) g[d]++; });
  const GLAB = Object.fromEntries(FRACTIONS);
  const options = Object.entries(PARL.interets_membres).sort((a, b) => a[0].localeCompare(b[0]));
  return `<h2>${esc(s[3])}</h2><p class="note">Conseil national, ${esc(dateFr(s[1]))}. Objet ${esc(s[2])}${s[4] ? ` : ${esc(s[4])}` : ""}${s[5] ? `. ${esc(s[5])}` : ""}</p>
  <ul class="list"><li><span><b class="infl">Oui</b> : <span title="${esc(s[6])}">${esc(trVote(s[6]) || "–")}</span></span><span></span></li><li><span><b class="money">Non</b> : <span title="${esc(s[7])}">${esc(trVote(s[7]) || "–")}</span></span><span></span></li></ul>
  <div class="kpis">${kpi(c.o, "oui", "infl")}${kpi(c.n, "non", "money")}${kpi(c.a, "abstentions")}${kpi(c["-"], "absent·e·s")}${kpi(c.e, "excusé·e·s")}</div>
  <section><h3>Qui a voté quoi</h3><div id="sc-hemi" data-id="${esc(String(id))}">${hemiScrutin(s)}</div>
    <div class="filters"><select id="sc-groupe" aria-label="Mettre en évidence un groupe d'intérêts"><option value="">Mettre en évidence : les élus liés à…</option>${options.map(([g]) => `<option>${esc(g)}</option>`).join("")}</select></div>
    <p class="summary" id="sc-ecart"></p></section>
  <section><h3>Par groupe parlementaire</h3><div class="table-wrap"><table><thead><tr><th>Groupe</th><th class="num">Oui</th><th class="num">Non</th><th class="num">Abst.</th><th class="num">Abs.</th></tr></thead>
    <tbody>${Object.entries(groupes).sort((a, b) => (b[1].o + b[1].n) - (a[1].o + a[1].n)).map(([g, v]) => `<tr><td>${esc(GLAB[g] || g)}</td><td class="num infl">${v.o}</td><td class="num money">${v.n}</td><td class="num">${v.a}</td><td class="num">${v["-"] + v.e}</td></tr>`).join("")}</tbody></table></div></section>
  ${url ? `<p><a href="${esc(url)}" target="_blank" rel="noopener">Dossier de l'objet sur parlament.ch</a></p>` : ""}`;
}
function hemiScrutin(s, focus) {
  const set = focus ? new Set(PARL.interets_membres[focus] || []) : null;
  const paint = (e) => { const d = decision(s, e.pn); const [lbl, col] = DECI[d] || ["Pas en fonction", "none"];
    return { fill: col, dim: set && !set.has(e.pn), title: lbl }; };
  const c = tally(s);
  return hemicycle("CN", 200, 8, paint, `<div class="legend wrap-l">${["o", "n", "a", "-", "e"].map((k) => `<span><i style="background:${DECI[k][1]}"></i>${DECI[k][0]} <b>${c[k]}</b></span>`).join("")}</div>`);
}
function focusScrutin(g) {
  const box = $("#sc-hemi"); if (!box) return;
  const s = PARL.idx.get(box.dataset.id);
  box.innerHTML = hemiScrutin(s, g);
  if (!g) { $("#sc-ecart").textContent = ""; return; }
  // Même calcul que scripts/build.py : oui observé contre oui attendu d'après le groupe de chaque élu (sans lui)
  const gy = {}, gn = {};
  PARL.membres.forEach((m, i) => { const d = s[8][i]; if (d === "o") gy[m[2]] = (gy[m[2]] || 0) + 1; if (d === "n") gn[m[2]] = (gn[m[2]] || 0) + 1; });
  let obs = 0, att = 0, n = 0;
  for (const pn of PARL.interets_membres[g] || []) {
    const i = PARL.pnIndex.get(pn), d = s[8][i]; if (d !== "o" && d !== "n") continue;
    const grp = PARL.membres[i][2], reste = (gy[grp] || 0) + (gn[grp] || 0) - 1; if (reste < 1) continue;
    obs += d === "o"; att += ((gy[grp] || 0) - (d === "o")) / reste; n++;
  }
  $("#sc-ecart").innerHTML = n ? `${n} élus liés à « ${esc(g)} » ont voté : <b>${num1(100 * obs / n)} % de oui</b>, contre ${num1(100 * att / n)} % attendus d'après leurs partis (${100 * (obs - att) / n >= 0 ? "+" : ""}${num1(100 * (obs - att) / n)} pts).` : `Aucun élu lié à « ${esc(g)} » n'a voté oui ou non.`;
}
async function fillEluVotes(e) {
  const box = $("#elu-votes"); if (!box) return;
  const p = await loadParl(); if (!p || $("#elu-votes") !== box) return;
  const st = p.elus[e.id];
  if (!st) { box.innerHTML = `<p class="note">Pas de vote nominal pour cette législature.</p>`; return; }
  box.innerHTML = `${e.contexte ? `<p class="ctx">ⓘ ${esc(e.contexte.note)}${e.contexte.source ? ` <a href="${esc(e.contexte.source)}" target="_blank" rel="noopener">Source</a>` : ""}</p>` : ""}<div class="kpis">${kpi(st.participation != null ? pct(st.participation) : "–", "participation aux votes")}${kpi(nf.format(st.absences), "votes manqués sans excuse", "money")}${kpi(nf.format(st.excuses), "absences excusées")}${st.compare_parti ? kpi(pct(100 * st.contre_parti / st.compare_parti), `votes contre son parti (${nf.format(st.contre_parti)})`, "infl") : kpi(nf.format(st.contre_groupe), "votes contre la majorité de son groupe")}</div>
  ${!st.compare_parti ? `<p class="note">Parti trop petit au Conseil national pour comparer à ses collègues de parti : comparaison avec le groupe parlementaire.</p>` : ""}
  ${(st.compare_parti ? st.recents_parti : st.recents).length ? `<p class="note">Derniers votes contre son ${st.compare_parti ? "parti" : "groupe"} :</p><ul class="list">${(st.compare_parti ? st.recents_parti : st.recents).map((id) => { const s = p.idx.get(String(id)); return s ? `<li><span>${linkBtn("scrutin", id, scrutinTitre(s))}</span><span class="tag">${esc(DECI[decision(s, e.pn)]?.[0] || "")}</span><span class="sub">${esc(dateFr(s[1]))} · ${esc(s[2])}</span></li>` : ""; }).join("")}</ul>` : ""}`;
}
async function fillVoteFinal(v) {
  const box = $("#vote-final"); if (!box) return;
  const p = await loadParl(); if (!p || $("#vote-final") !== box) return;
  const s = p.idx.get(String(v.vote_final));
  if (!s) { box.remove(); return; }
  const c = tally(s);
  box.innerHTML = `<h3>Vote final au Conseil national</h3><p>${linkBtn("scrutin", s[0], scrutinTitre(s))}</p>
  <p class="note">${esc(dateFr(s[1]))} : <b class="infl">${c.o} oui</b>, <b class="money">${c.n} non</b>, ${c.a} abstentions. Oui = ${esc(s[6] || "–")}.</p>`;
}

/* ---------------- Votations cantonales ---------------- */
let CANT = null, cantLoading = null;
const ROMANDIE = ["VD", "GE"];
const loadCant = () => cantLoading ||= getJSON("cantonal", []).then((c) => { c.forEach((x) => { x._n = norm(`${x.titre} ${x.canton}`); }); CANT = c; return c; });
async function renderCantonal() {
  const box = $("#l-votes");
  if (!CANT) { box.innerHTML = `<p class="note">Chargement des votations cantonales…</p>`; await loadCant(); }
  if (!$("#fc-canton")) {
    $("#f-cant").innerHTML = `<input type="search" id="fc-q" placeholder="Objet, mot-clé…" aria-label="Filtrer les votations cantonales">
      <select id="fc-canton" aria-label="Canton"><option value="VD,GE">Vaud et Genève</option><option value="">Tous les cantons</option>${uniq(CANT.map((x) => x.canton)).sort().map((c) => `<option>${esc(c)}</option>`).join("")}</select>
      ${select("fc-an", "Année", uniq(CANT.map((x) => x.date.slice(0, 4))).sort().reverse(), "Toutes")}
      <select id="fc-res" aria-label="Résultat"><option value="">Résultat : tous</option><option value="1">Acceptés</option><option value="0">Refusés</option></select>`;
    $("#f-cant").addEventListener("input", renderCantonal);
  }
  const q = norm($("#fc-q").value).split(" ").filter(Boolean), ct = $("#fc-canton").value.split(",").filter(Boolean);
  const f = { an: $("#fc-an").value, res: $("#fc-res").value };
  const rows = CANT.filter((x) => (!ct.length || ct.includes(x.canton)) && (!f.an || x.date.startsWith(f.an)) && (!f.res || String(+x.accepte) === f.res) && (!q.length || matchAll(x._n, q)));
  $("#s-votes").textContent = `${rows.length} objet${rows.length > 1 ? "s" : ""} cantonaux`;
  const byDate = new Map(); rows.forEach((x) => { if (!byDate.has(x.date)) byDate.set(x.date, []); byDate.get(x.date).push(x); });
  box.innerHTML = [...byDate].map(([d, xs]) => `<div class="vote-day"><h3>${esc(dateFr(d))}</h3>${xs.map((x) => `<button class="vote-row" data-open="cantonal" data-key="${esc(x.id)}">
    <span class="vr-head"><strong><span class="tag">${esc(x.canton)}</span> ${esc(x.titre)}</strong><span class="pill ${x.accepte ? "yes" : x.accepte === false ? "no" : ""}">${x.accepte ? "Accepté" : x.accepte === false ? "Refusé" : "En attente"}</span></span>
    ${x.oui != null ? `<span class="yesno" role="img" aria-label="${pct(x.oui)} oui"><span style="width:${x.oui}%"></span></span><span class="sub"><b class="infl">${pct(x.oui)} oui</b> · participation ${pct(x.participation)}</span>` : ""}
  </button>`).join("")}</div>`).join("") || `<p class="empty">Aucun objet pour ces filtres.</p>`;
}
function sheetCantonal(id) {
  const x = CANT?.find((c) => c.id === id);
  if (!x) return "";
  const communes = [...x.communes].filter((c) => c[1] != null).sort((a, b) => b[1] - a[1]);
  const oui = communes.filter((c) => c[1] > 50).length;
  return `<h2>${esc(x.titre)}</h2><p class="note">Votation cantonale, ${esc(x.canton)}, ${esc(dateFr(x.date))}</p>
  <p><span class="pill ${x.accepte ? "yes" : x.accepte === false ? "no" : ""}">${x.accepte ? "Accepté" : x.accepte === false ? "Refusé" : "En attente"}</span></p>
  <div class="kpis">${kpi(pct(x.oui), "de oui", "infl")}${kpi(pct(x.participation), "participation")}${communes.length ? kpi(`${oui} / ${communes.length - oui}`, "communes oui / non") : ""}</div>
  ${communes.length ? `<section><h3>Résultat par commune</h3><div class="legend"><span><i style="background:var(--infl)"></i>oui</span><span>trié du plus favorable au moins favorable</span></div>
    <div class="table-wrap"><table><thead><tr><th>Commune</th><th class="num">Oui</th><th class="num hide-s">Participation</th></tr></thead><tbody>
    ${communes.map(([n, o, p]) => `<tr><td>${esc(n)}</td><td class="num"><span class="mini-bar"><span style="width:${o}%"></span></span> ${pct(o)}</td><td class="num hide-s">${pct(p)}</td></tr>`).join("")}</tbody></table></div></section>` : ""}
  <p class="note">Source : Office fédéral de la statistique. Le financement des campagnes cantonales n'est pas couvert par le Contrôle fédéral des finances.</p>`;
}

/* ---------------- Images à partager ---------------- */
const SITE_URL = location.origin + location.pathname.replace(/index\.html$/, "");
const SHARES = new Map();
const shareBtn = (key, fn, label = "Partager l'image") => { SHARES.set(key, fn); return `<button class="btn ghost share" data-share="${esc(key)}">${esc(label)}</button>`; };
function wrapLines(ctx, text, maxW) {
  const out = []; let line = "";
  for (const w of String(text).split(/\s+/)) { const t = line ? `${line} ${w}` : w; if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; }
  if (line) out.push(line); return out;
}
async function shareCard({ kicker = "Qui finance ?", title, big, bigColor = "#C8202A", lines = [], text = "", file = "qui-finance.png" }) {
  await document.fonts?.ready;
  const W = 1080, H = 1350, c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d"), F = (w, s) => `${w} ${s}px "Schibsted Grotesk", "Helvetica Neue", Arial, sans-serif`;
  x.fillStyle = "#F3F4F1"; x.fillRect(0, 0, W, H);
  x.fillStyle = "#C8202A"; x.fillRect(0, 0, W / 2, 20); x.fillStyle = "#1F5F8B"; x.fillRect(W / 2, 0, W / 2, 20);
  let y = 130; x.fillStyle = "#5F6873"; x.font = F(700, 32); x.fillText(`${kicker}`.toUpperCase(), 80, y);
  y += 95; x.fillStyle = "#16202A"; x.font = F(800, 66);
  for (const l of wrapLines(x, title, W - 160).slice(0, 5)) { x.fillText(l, 80, y); y += 78; }
  if (big) { x.fillStyle = bigColor; x.font = F(800, big.length > 9 ? 110 : 160); y += 150; x.fillText(big, 80, y); y += 40; }
  x.fillStyle = "#16202A"; x.font = F(500, 40);
  for (const line of lines) for (const l of wrapLines(x, line, W - 160)) { y += 60; if (y > H - 150) break; x.fillText(l, 80, y); }
  x.fillStyle = "#5F6873"; x.font = F(700, 30); x.fillText("TRANSPARENCE DÉMOCRATIQUE", 80, H - 120);
  x.font = F(500, 32); x.fillText(SITE_URL.replace(/^https?:\/\//, ""), 80, H - 70);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const f = new File([blob], file, { type: "image/png" }), msg = `${text} ${SITE_URL}`.trim();
  if (navigator.canShare?.({ files: [f] })) { try { await navigator.share({ files: [f], text: msg }); return; } catch (e) { if (e.name === "AbortError") return; } }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file; a.click();
  navigator.clipboard?.writeText(msg).catch(() => {});
}

/* ---------------- Classements ---------------- */
const pctInt = (v) => `${Math.round(v)} %`;
function argentGagne() {
  const vs = V.filter((v) => v.argent && (v.argent.pour || v.argent.contre) && (v.statut === "Accepté" || v.statut === "Refusé"));
  const rows = vs.map((v) => { const riche = v.argent.pour >= v.argent.contre ? "oui" : "non", gagnant = v.statut === "Accepté" ? "oui" : "non";
    return { v, riche, gagnant, ok: riche === gagnant, ratio: Math.max(v.argent.pour, v.argent.contre) / Math.max(1, Math.min(v.argent.pour, v.argent.contre)) }; });
  return { rows, n: rows.filter((r) => r.ok).length };
}
function coutVoix() {
  const out = [];
  for (const v of V) {
    if (!v.argent) continue;
    if (v.voix_oui && v.argent.pour) out.push({ v, camp: "oui", cout: v.argent.pour / v.voix_oui, gagne: v.statut === "Accepté" });
    if (v.voix_non && v.argent.contre) out.push({ v, camp: "non", cout: v.argent.contre / v.voix_non, gagne: v.statut === "Refusé" });
  }
  return out.sort((a, b) => b.cout - a.cout);
}
const chf2 = (v) => v.toLocaleString("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " CHF";
function multiPartis() {
  return [...idx.donor.values()].map((g) => { const par = {}; g.dons.forEach((d) => { if (d.parti && d.cat !== "Votation") par[d.parti] = (par[d.parti] || 0) + (d.montant || 0); });
    return { g, par: Object.entries(par).sort((a, b) => b[1] - a[1]) }; }).filter((x) => x.par.length >= 2).sort((a, b) => b.par.length - a.par.length || b.g.total - a.g.total);
}
const isLobbyiste = (b) => /interessenvertreter|représentant|repräsentant/i.test(b.fonction);
const orgBadge = (b) => (b.fonction.split(":").slice(1).join(":").trim() || b.mandats[0] || "");
const LEG_DEBUT = "2023-12-04";

function renderClassements() {
  const box = $("#classements"); if (!box || box.dataset.ready) return;
  box.dataset.ready = "1";
  const cards = [];
  // L'argent gagne-t-il ?
  const ag = argentGagne();
  if (ag.rows.length) cards.push(card("L'argent gagne-t-il ?", "Le camp qui a déclaré le plus de recettes au CDF a-t-il remporté la votation ?",
    `<div class="kpis">${kpi(`${ag.n} sur ${ag.rows.length}`, "votations gagnées par le camp le plus riche", "money")}</div>
    <ul class="list">${ag.rows.map((r) => `<li><span>${linkBtn("vote", r.v.id, r.v.titre)}</span><span class="tag ${r.ok ? "paid" : ""}">${r.ok ? "l'argent a gagné" : "l'argent a perdu"}</span>
      <span class="sub">${esc(dateFr(r.v.date))} · le ${r.riche} a dépensé ${num1(r.ratio)} fois plus · résultat : ${esc(r.v.statut.toLowerCase())} (${pct(r.v.oui)})</span></li>`).join("")}</ul>
    ${shareBtn("argent-gagne", () => shareCard({ kicker: "L'argent gagne-t-il ?", title: "Votations fédérales depuis 2023 : le camp qui a dépensé le plus a gagné", big: `${ag.n} fois sur ${ag.rows.length}`, lines: ["Recettes déclarées par les comités au Contrôle fédéral des finances."], text: `L'argent gagne-t-il les votations ? ${ag.n} fois sur ${ag.rows.length}.`, file: "argent-gagne.png" }))}`, true));
  // Combien coûte une voix
  const cv = coutVoix();
  if (cv.length) { const top = cv[0];
    cards.push(card("Combien coûte une voix ?", "Recettes déclarées par un camp, divisées par le nombre de voix qu'il a obtenues.",
    bars(cv.slice(0, 15).map((c) => ({ label: `${c.camp === "oui" ? "Oui" : "Non"} : ${c.v.titre}`, value: c.cout, open: ["vote", c.v.id] })), "m", chf2)
    + shareBtn("cout-voix", () => shareCard({ kicker: "Combien coûte une voix ?", title: `Le ${top.camp} à « ${top.v.titre} » (${dateFr(top.v.date)})`, big: chf2(top.cout), lines: [`par voix obtenue : ${chf(top.camp === "oui" ? top.v.argent.pour : top.v.argent.contre)} de recettes déclarées pour ${nf.format(top.camp === "oui" ? top.v.voix_oui : top.v.voix_non)} voix. ${top.gagne ? "Il a gagné." : "Il a perdu."}`], text: `Le ${top.camp} à « ${top.v.titre} » : ${chf2(top.cout)} par voix.`, file: "cout-voix.png" }))));
  }
  // Donateurs sur plusieurs partis
  const mp = multiPartis();
  if (mp.length) cards.push(card("Ils financent plusieurs partis", "Donateurs qui ont donné à au moins deux partis (hors campagnes de votation).",
    `<ul class="list">${mp.slice(0, 12).map((x) => `<li><span>${linkBtn("donor", x.g.nom, x.g.nom)}</span><span class="amount money">${chf(sum(x.par, (p) => p[1]))}</span>
      <span class="sub">${x.par.map(([p, v]) => `${esc(p)} ${short(v)}`).join(" · ")}</span></li>`).join("")}</ul>
    ${shareBtn("multi-partis", () => shareCard({ kicker: "Ils financent plusieurs partis", title: `${mp[0].g.nom} a donné à ${mp[0].par.length} partis`, big: short(sum(mp[0].par, (p) => p[1])) + " CHF", bigColor: "#C8202A", lines: mp[0].par.map(([p, v]) => `${p} : ${chf(v)}`), text: `${mp[0].g.nom} finance ${mp[0].par.length} partis.`, file: "multi-partis.png" }))}`));
  // Cumul de mandats rémunérés
  const cumul = L.elus.map((e) => ({ e, paid: e.liens.filter((l) => l.statut === "remunere").length })).sort((a, b) => b.paid - a.paid || b.e.liens.length - a.e.liens.length).slice(0, 15);
  cards.push(card("Cumul de mandats rémunérés", "Mandats en cours déclarés comme rémunérés (montant souvent non communiqué).",
    bars(cumul.map((x) => ({ label: `${x.e.nom} (${x.e.parti})`, value: x.paid, open: ["elu", x.e.id] })), "i", (v) => v)
    + shareBtn("cumul", () => shareCard({ kicker: "Cumul de mandats", title: `${cumul[0].e.nom} (${cumul[0].e.parti}, ${cumul[0].e.canton}) déclare`, big: `${cumul[0].paid} mandats`, bigColor: "#1F5F8B", lines: ["rémunérés, en cours, selon Lobbywatch.", `Suivent : ${cumul.slice(1, 4).map((x) => `${x.e.nom} (${x.paid})`).join(", ")}.`], text: `Le record de mandats rémunérés au Parlement : ${cumul[0].paid}.`, file: "cumul-mandats.png" }))));
  // Nouveaux mandats depuis le début de la législature
  const nouveaux = L.elus.map((e) => ({ e, n: e.liens.filter((l) => l.depuis >= LEG_DEBUT).length, paid: e.liens.filter((l) => l.depuis >= LEG_DEBUT && l.statut === "remunere").length })).filter((x) => x.n).sort((a, b) => b.n - a.n).slice(0, 15);
  if (nouveaux.length) cards.push(card("Nouveaux mandats depuis l'élection", "Mandats commencés depuis le début de la législature (4 décembre 2023). Partie foncée : rémunérés. Date de début connue pour environ deux mandats sur trois.",
    bars(nouveaux.map((x) => ({ label: `${x.e.nom} (${x.e.parti})`, value: x.paid, value2: x.n - x.paid, open: ["elu", x.e.id] })), "i", (v) => v)));
  // Qui fait entrer qui
  const lob = L.badges.filter(isLobbyiste), hotes = {};
  lob.forEach((b) => { (hotes[b.p] ||= []).push(b); });
  const topH = Object.entries(hotes).sort((a, b) => b[1].length - a[1].length).slice(0, 12);
  if (lob.length) cards.push(card("Qui fait entrer qui au Palais fédéral", `Chaque élu peut donner deux badges d'accès permanents. ${lob.length} vont à des représentants d'intérêts déclarés.`,
    `<ul class="list">${topH.map(([p, bs]) => { const e = idx.elu.get(+p); return e ? `<li><span>${linkBtn("elu", e.id, e.nom)} <small class="note">${esc(e.parti)}</small></span><span class="tag">${bs.length} lobbyiste${bs.length > 1 ? "s" : ""}</span>
      <span class="sub">${bs.map((b) => `${esc(b.nom)} (${esc(orgBadge(b))})`).join(" · ")}</span></li>` : ""; }).join("")}</ul>`, true));
  // Frondeurs et absents (votes nominaux, chargés à la demande)
  cards.push(`<div class="card" id="cl-frondeurs"><h3>Qui vote le plus souvent contre son groupe ?</h3><p class="note">Chargement des votes…</p></div>`);
  cards.push(`<div class="card" id="cl-absents"><h3>Qui manque le plus de votes ?</h3><p class="note">Chargement des votes…</p></div>`);
  box.innerHTML = cards.join("");
  loadParl().then((p) => {
    if (!p) return;
    const st = L.elus.filter((e) => p.elus[e.id] && e.conseil === "CN").map((e) => ({ e, ...p.elus[e.id] }));
    const fr = st.filter((x) => x.compare_parti >= 500).map((x) => ({ ...x, taux: 100 * x.contre_parti / x.compare_parti })).sort((a, b) => b.taux - a.taux).slice(0, 12);
    const petits = st.filter((x) => x.compare_parti < 500).sort((a, b) => b.contre_groupe - a.contre_groupe);
    const ab = st.filter((x) => x.scrutins).sort((a, b) => b.absences / b.scrutins - a.absences / a.scrutins).slice(0, 12);
    $("#cl-frondeurs").innerHTML = `<h3>Qui vote le plus souvent contre son parti ?</h3><p class="hint">Part des votes où l'élu a voté oui ou non à l'inverse de la majorité des autres élus de son parti, législature en cours, Conseil national.</p>
      ${bars(fr.map((x) => ({ label: `${x.e.nom} (${x.e.parti})`, value: x.taux, open: ["elu", x.e.id] })), "i", (v) => pct(v))}
      ${petits.length ? `<details class="more"><summary>Et les élus de très petits partis (${petits.length})</summary><p class="note">PEV, UDF, MCG, Lega… n'ont qu'un ou deux élus : impossible de les comparer à leur parti. Rattachés à un grand groupe, ils votent logiquement souvent autrement que lui. Votes contre la majorité de leur groupe :</p>
        <ul class="list">${petits.map((x) => `<li><span>${linkBtn("elu", x.e.id, x.e.nom)} <small class="note">${esc(x.e.parti)}</small></span><span>${nf.format(x.contre_groupe)}</span></li>`).join("")}</ul></details>` : ""}
      ${shareBtn("frondeurs", () => shareCard({ kicker: "Les frondeurs du Conseil national", title: `${fr[0].e.nom} (${fr[0].e.parti}, ${fr[0].e.canton}) vote contre son propre parti`, big: pct(fr[0].taux), bigColor: "#1F5F8B", lines: [`des votes depuis décembre 2023 (${nf.format(fr[0].contre_parti)} votes).`, `Suivent : ${fr.slice(1, 4).map((x) => `${x.e.nom}, ${x.e.parti} (${pct(x.taux)})`).join(" ; ")}.`], text: "Qui vote le plus souvent contre son propre parti au Conseil national ?", file: "frondeurs.png" }))}`;
    $("#cl-absents").innerHTML = `<h3>Qui manque le plus de votes ?</h3><p class="hint">Part des votes manqués sans excuse enregistrée, législature en cours, Conseil national. Les données ne disent pas pourquoi un élu était absent.</p>
      ${bars(ab.map((x) => ({ label: `${x.e.nom} (${x.e.parti})`, value: 100 * x.absences / x.scrutins, open: ["elu", x.e.id] })), "m", (v) => pctInt(v))}
      <p><a class="btn ghost" href="#absences">Le classement complet</a></p>`;
  });
}

/* ---------------- Jouer ---------------- */
const GAMES = { match: "Vote comme un élu", quiz: "Le quiz de la semaine", plusmoins: "Plus ou moins ?", canton: "Mes élus" };
let GAME_RUN = 0;  // une seule partie à la fois : une partie lancée remplace la précédente
const stale = (run) => run !== GAME_RUN;
function renderJouer(sub) {
  const g = GAMES[sub] ? sub : "";
  const run = ++GAME_RUN;
  $("#jeux-menu").innerHTML = Object.entries(GAMES).map(([k, l]) => `<a class="chip${k === g ? " on" : ""}" href="#jouer:${k}">${esc(l)}</a>`).join("");
  const box = $("#jeu");
  if (!g) { box.innerHTML = `<div class="grid">${[
    ["match", "Répondez à 10 vrais votes du Conseil national et découvrez quels élus votent comme vous… et qui les finance."],
    ["quiz", "Cinq questions tirées des données de la semaine. Nouveau quiz chaque lundi."],
    ["plusmoins", "Qui a donné le plus ? Qui cumule le plus de mandats ? Enchaînez les bonnes réponses."],
    ["canton", "Les élus de votre canton en un coup d'œil : mandats, rémunérations, présence aux votes."],
  ].map(([k, t]) => `<a class="card game-card" href="#jouer:${k}"><h3>${esc(GAMES[k])}</h3><p class="note">${esc(t)}</p><span class="btn">Jouer</span></a>`).join("")}</div>`; return; }
  ({ match: gameMatch, quiz: gameQuiz, plusmoins: gamePlusMoins, canton: gameCanton })[g](box, run);
}

// Vote comme un élu
async function gameMatch(box, run) {
  box.innerHTML = `<p class="note">Chargement des votes…</p>`;
  const p = await loadParl(); if (stale(run)) return; if (!p) { box.innerHTML = `<p class="empty">Votes indisponibles pour l'instant.</p>`; return; }
  const seen = new Set(), picks = [];
  for (const s of p.scrutins) {  // du plus récent au plus ancien : votes finaux ou d'ensemble, serrés et sur des objets différents
    if (!["Vote final", "Vote sur l'ensemble"].includes(s[5]) || seen.has(s[2])) continue;
    const c = tally(s); if (c.o + c.n < 150 || Math.min(c.o, c.n) / (c.o + c.n) < 0.3) continue;
    seen.add(s[2]); picks.push(s); if (picks.length === 10) break;
  }
  const rep = [];
  const step = () => {
    if (stale(run)) return;
    const i = rep.length;
    if (i === picks.length) return resultats();
    const s = picks[i];
    box.innerHTML = `<div class="card quiz"><p class="note">Vote ${i + 1} sur ${picks.length} · ${esc(dateFr(s[1]))}</p><h3>${esc(s[3])}</h3>
      <p class="note">${s[5] === "Vote final" ? "Vote final : oui = adopter le texte, non = le rejeter." : "Vote sur l'ensemble : oui = accepter le projet, non = le refuser."} Objet ${esc(s[2])}${affaireUrl(s[2]) ? ` · <a href="${esc(affaireUrl(s[2]))}" target="_blank" rel="noopener">en savoir plus</a>` : ""}</p>
      <div class="answers"><button class="btn yes" data-m="o">Oui</button><button class="btn no" data-m="n">Non</button><button class="btn ghost" data-m="">Je ne sais pas</button></div>
      <div class="progress"><span style="width:${100 * i / picks.length}%"></span></div></div>`;
    box.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => { rep.push(b.dataset.m); step(); }));
  };
  const resultats = () => {
    const scores = L.elus.filter((e) => e.conseil === "CN" && e.pn).map((e) => {
      let ok = 0, n = 0;
      picks.forEach((s, i) => { const d = decision(s, e.pn); if (rep[i] && (d === "o" || d === "n")) { n++; ok += d === rep[i]; } });
      return { e, n, pct: n ? 100 * ok / n : null };
    }).filter((x) => x.n >= 5).sort((a, b) => b.pct - a.pct);
    const answered = rep.filter(Boolean).length;
    if (answered < 5 || !scores.length) { box.innerHTML = `<p class="empty">Répondez à au moins 5 votes pour comparer. <a href="#jouer:match" data-restart>Recommencer</a></p>`; return; }
    const parts = {}; scores.forEach((x) => { const k = x.e.parti; (parts[k] ||= []).push(x.pct); });
    const partis = Object.entries(parts).filter(([, v]) => v.length >= 2).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length]).sort((a, b) => b[1] - a[1]);
    const best = scores[0];
    box.innerHTML = `<div class="card"><h3>Vous votez à ${pctInt(best.pct)} comme ${esc(best.e.nom)}</h3>
      <p class="note">${esc(best.e.parti)}, ${esc(best.e.canton)} · sur ${answered} votes répondus, comparés aux votes réels du Conseil national.</p>
      <section><h4>Les élus les plus proches de vous</h4>${bars(scores.slice(0, 8).map((x) => ({ label: `${x.e.nom} (${x.e.parti}, ${x.e.canton})`, value: x.pct, open: ["elu", x.e.id] })), "i", pctInt, 100)}</section>
      <section><h4>Par parti (moyenne de ses élus)</h4>${bars(partis.map(([k, v]) => ({ label: k, value: v, open: idx.recip.has(k) ? ["recip", k] : null })), "m", pctInt, 100)}</section>
      <section><h4>Les plus éloignés</h4>${bars(scores.slice(-3).reverse().map((x) => ({ label: `${x.e.nom} (${x.e.parti})`, value: x.pct, open: ["elu", x.e.id] })), "m", pctInt, 100)}</section>
      <p class="note">Cliquez un élu pour voir ses mandats et qui finance son parti. Les votes comparés sont les derniers votes finaux ou d'ensemble les plus serrés.</p>
      <div class="answers">${shareBtn("match", () => shareCard({ kicker: "Vote comme un élu", title: `Je vote comme ${best.e.nom} (${best.e.parti}, ${best.e.canton})`, big: pctInt(best.pct), bigColor: "#1F5F8B", lines: [`sur ${answered} vrais votes du Conseil national.`, `Mon parti le plus proche : ${partis[0][0]} (${pctInt(partis[0][1])}).`, "Et toi, tu votes comme qui ?"], text: `Je vote à ${pctInt(best.pct)} comme ${best.e.nom}. Et toi ?`, file: "vote-comme-un-elu.png" }))}<a class="btn ghost" href="#jouer:match" data-restart>Recommencer</a></div></div>`;
  };
  step();
}

// Quiz de la semaine (même quiz pour tout le monde, renouvelé à chaque mise à jour)
function rngFrom(str) { let h = 1779033703; for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 3432918353); let a = h >>> 0;
  return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const pickR = (r, arr) => arr[Math.floor(r() * arr.length)];
const shuffle = (r, arr) => arr.map((x) => [r(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
async function gameQuiz(box, run) {
  const semaine = (M.genere || "").slice(0, 10) || new Date().toISOString().slice(0, 10), r = rngFrom(semaine);
  const p = await loadParl(); if (stale(run)) return;
  const Q = [];
  // 1. Plus gros donateur d'un parti
  const partis = uniq(A.dons.map((d) => d.parti)).filter((pt) => { const ds = A.dons.filter((d) => d.parti === pt); return uniq(ds.map((d) => d.donateur)).length >= 4; });
  if (partis.length) { const pt = pickR(r, partis), by = {}; A.dons.filter((d) => d.parti === pt).forEach((d) => { by[d.donateur] = (by[d.donateur] || 0) + (d.montant || 0); });
    const top = Object.entries(by).sort((a, b) => b[1] - a[1]); const autres = shuffle(r, [...idx.donor.keys()].filter((k) => !by[k])).slice(0, 3);
    Q.push({ q: `Qui a le plus donné au parti ${pt} depuis 2023 ?`, opts: shuffle(r, [top[0][0], ...autres]), ok: top[0][0], why: `${top[0][0]} : ${chf(top[0][1])}.`, open: ["recip", idx.recip.has(pt) ? pt : ""] }); }
  // 2. Camp le plus riche d'une votation
  const va = V.filter((v) => v.argent && v.argent.pour !== v.argent.contre);
  if (va.length) { const v = pickR(r, va), ok = v.argent.pour > v.argent.contre ? "Le camp du oui" : "Le camp du non";
    Q.push({ q: `« ${v.titre} » (${dateFr(v.date)}) : quel camp a déclaré le plus de recettes ?`, opts: ["Le camp du oui", "Le camp du non"], ok, why: `Oui : ${chf(v.argent.pour)}, non : ${chf(v.argent.contre)}. Résultat : ${v.statut.toLowerCase()}.`, open: ["vote", v.id] }); }
  // 3. Nombre de mandats d'un élu
  const gros = L.elus.filter((e) => e.liens.length >= 8);
  if (gros.length) { const e = pickR(r, gros), n = e.liens.length, opts = shuffle(r, [n, Math.max(1, Math.round(n * 0.5)), Math.round(n * 1.6) + 1, Math.max(2, Math.round(n * 0.25))].map(String));
    Q.push({ q: `Combien de mandats en cours déclare ${e.nom} (${e.parti}, ${e.canton}) ?`, opts: uniq(opts), ok: String(n), why: `${n} mandats, dont ${e.liens.filter((l) => l.statut === "remunere").length} rémunérés.`, open: ["elu", e.id] }); }
  // 4. Vote d'un élu au vote final
  if (p) { const finals = p.scrutins.filter((s) => s[5] === "Vote final").slice(0, 60), s = pickR(r, finals);
    const cands = L.elus.filter((e) => e.pn && ["o", "n"].includes(decision(s, e.pn)));
    if (s && cands.length) { const e = pickR(r, cands), d = decision(s, e.pn) === "o" ? "Oui" : "Non";
      Q.push({ q: `${e.nom} (${e.parti}) a voté… au vote final sur « ${s[3]} » (${dateFr(s[1])}) ?`, opts: ["Oui", "Non"], ok: d, why: `${e.nom} a voté ${d.toLowerCase()}. Le Conseil national : ${tally(s).o} oui, ${tally(s).n} non.`, open: ["scrutin", s[0]] }); } }
  // 5. Quel parti a reçu le plus d'un donateur
  const mp = multiPartis();
  if (mp.length) { const x = pickR(r, mp.slice(0, 20)), ok = x.par[0][0], autres = shuffle(r, uniq(A.dons.map((d) => d.parti)).filter((pt) => pt !== ok)).slice(0, 3);
    Q.push({ q: `Quel parti a reçu le plus d'argent de ${x.g.nom} ?`, opts: shuffle(r, [ok, ...autres]), ok, why: x.par.map(([pt, v]) => `${pt} ${short(v)}`).join(" · "), open: ["donor", x.g.nom] }); }
  const res = [];
  const step = () => {
    if (stale(run)) return;
    const i = res.length;
    if (i === Q.length) {
      const score = res.filter(Boolean).length, grille = res.map((x) => (x ? "🟩" : "🟥")).join("");
      box.innerHTML = `<div class="card quiz"><h3>${score} sur ${Q.length}</h3><p class="grille">${grille}</p><p class="note">Quiz de la semaine du ${esc(dateFr(semaine))}. Un nouveau quiz chaque lundi, avec les données de la semaine.</p>
        <div class="answers">${shareBtn("quiz", () => shareCard({ kicker: "Le quiz de la semaine", title: `J'ai fait ${score} sur ${Q.length} au quiz « Qui finance ? »`, big: grille, bigColor: "#16202A", lines: ["Dons aux partis, mandats des élus, votes au Parlement.", "Et toi ?"], text: `Quiz Qui finance ? ${score}/${Q.length} ${grille}`, file: "quiz.png" }))}</div></div>`;
      return;
    }
    const q = Q[i];
    box.innerHTML = `<div class="card quiz"><p class="note">Question ${i + 1} sur ${Q.length}</p><h3>${esc(q.q)}</h3>
      <div class="answers col">${q.opts.map((o) => `<button class="btn ghost" data-a="${esc(o)}">${esc(o)}</button>`).join("")}</div><div class="progress"><span style="width:${100 * i / Q.length}%"></span></div></div>`;
    box.querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", () => {
      const ok = b.dataset.a === q.ok; res.push(ok);
      box.querySelectorAll("[data-a]").forEach((x) => { x.disabled = true; if (x.dataset.a === q.ok) x.classList.add("right"); });
      if (!ok) b.classList.add("wrong");
      box.querySelector(".answers").insertAdjacentHTML("afterend", `<p class="${ok ? "infl" : "money"}"><b>${ok ? "Bien vu !" : "Raté."}</b> ${esc(q.why)} ${q.open[1] !== "" ? linkBtn(q.open[0], q.open[1], "Voir la fiche") : ""}</p><button class="btn" data-next>${i + 1 < Q.length ? "Question suivante" : "Voir mon score"}</button>`);
      box.querySelector("[data-next]").addEventListener("click", step);
    }));
  };
  step();
}

// Plus ou moins
function gamePlusMoins(box) {
  const items = [
    ...[...idx.donor.values()].filter((g) => g.total >= 20000).map((g) => ({ label: g.nom, sub: "a donné au total (partis et campagnes)", v: g.total, f: chf, open: ["donor", g.nom] })),
    ...L.elus.filter((e) => e.liens.length).map((e) => ({ label: `${e.nom} (${e.parti})`, sub: "mandats en cours", v: e.liens.length, f: (x) => `${x} mandats`, open: ["elu", e.id] })),
  ];
  const types = (x) => (x.sub.startsWith("mandats") ? "m" : "d");
  const r = Math.random; let serie = 0; const best = +(store.get("qf-plusmoins") || 0);
  let a = pickR(r, items);
  const next = () => {
    let b; do { b = pickR(r, items.filter((x) => types(x) === types(a))); } while (b === a || b.v === a.v);
    box.innerHTML = `<div class="card quiz"><p class="note">Série : <b>${serie}</b> · record : ${Math.max(best, serie)}</p>
      <div class="pm"><div class="pm-item"><h3>${esc(a.label)}</h3><p class="big">${esc(a.f(a.v))}</p><p class="note">${esc(a.sub)}</p></div>
      <div class="pm-item"><h3>${esc(b.label)}</h3><p class="note">${esc(b.sub)} : plus ou moins ?</p><div class="answers"><button class="btn yes" data-pm="1">Plus</button><button class="btn no" data-pm="-1">Moins</button></div></div></div></div>`;
    box.querySelectorAll("[data-pm]").forEach((btn) => btn.addEventListener("click", () => {
      const ok = (+btn.dataset.pm > 0) === (b.v > a.v);
      if (ok) { serie++; a = b; next(); return; }
      if (serie > best) store.set("qf-plusmoins", String(serie));
      box.innerHTML = `<div class="card quiz"><h3>Perdu : ${esc(b.label)}, ${esc(b.f(b.v))}</h3><p class="note">${esc(a.label)} : ${esc(a.f(a.v))}.</p>
        <p class="big">${serie} bonne${serie > 1 ? "s" : ""} réponse${serie > 1 ? "s" : ""} d'affilée</p><p class="note">Record : ${Math.max(best, serie)}</p>
        <div class="answers"><button class="btn" data-restart-pm>Rejouer</button>${linkBtn(b.open[0], b.open[1], "Voir la fiche")}${shareBtn("plusmoins", () => shareCard({ kicker: "Plus ou moins ?", title: "Ma série au jeu « Qui finance ? »", big: `${serie}`, bigColor: "#1F5F8B", lines: ["bonnes réponses d'affilée sur les dons aux partis et les mandats des élus.", "Tu fais mieux ?"], text: `${serie} d'affilée à Plus ou moins ? sur Qui finance ?`, file: "plus-ou-moins.png" }))}</div></div>`;
      box.querySelector("[data-restart-pm]").addEventListener("click", () => renderJouer("plusmoins"));
    }));
  };
  next();
}

// Mes élus
async function gameCanton(box, run) {
  const cantons = uniq(L.elus.map((e) => e.canton)).sort(), saved = store.get("qf-canton");
  const cur = cantons.includes(location.hash.split(":")[2]) ? location.hash.split(":")[2] : cantons.includes(saved) ? saved : "VD";
  store.set("qf-canton", cur);
  const p = await loadParl(); if (stale(run)) return;
  const elus = L.elus.filter((e) => e.canton === cur).sort((a, b) => (a.conseil > b.conseil ? 1 : -1) || a.nom.localeCompare(b.nom));
  box.innerHTML = `<div class="filters"><select id="mc-canton" aria-label="Canton">${cantons.map((c) => `<option${c === cur ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
    <div class="elu-cards">${elus.map((e) => { const paid = e.liens.filter((l) => l.statut === "remunere").length, st = p?.elus[e.id];
      return `<div class="card elu-card"><button class="elu-card-head" data-open="elu" data-key="${e.id}">${e.photo ? `<img src="${esc(e.photo)}" alt="" width="56" height="56" loading="lazy" onerror="this.remove()">` : ""}<span><strong>${esc(e.nom)}</strong><br><small>${esc(e.parti)} · ${esc(e.conseil)}</small></span></button>
        <div class="kpis small">${kpi(e.liens.length, "mandats", "infl")}${kpi(paid, "rémunérés", "money")}${st?.participation != null ? kpi(pctInt(st.participation), "présence aux votes") : ""}${st ? (st.compare_parti ? kpi(pct(100 * st.contre_parti / st.compare_parti), "votes contre son parti") : kpi(nf.format(st.contre_groupe), "votes contre son groupe")) : ""}</div>
        ${shareBtn(`elu-${e.id}`, () => shareCard({ kicker: `Mes élus · ${e.canton}`, title: `${e.nom} (${e.parti}, ${e.conseil === "CN" ? "Conseil national" : "Conseil des États"})`, big: `${e.liens.length} mandats`, bigColor: "#1F5F8B", lines: [`dont ${paid} rémunérés, selon Lobbywatch.`, ...(st ? [`Présence aux votes : ${pctInt(st.participation)}.${st.compare_parti ? ` Vote contre son parti : ${pct(100 * st.contre_parti / st.compare_parti)} des fois.` : ""}`] : []), "Qui sont les élus de ton canton ?"], text: `${e.nom} : ${e.liens.length} mandats dont ${paid} rémunérés.`, file: `elu-${e.id}.png` }), "Partager")}</div>`; }).join("")}</div>`;
  $("#mc-canton").addEventListener("input", (ev) => { location.hash = `#jouer:canton:${ev.target.value}`; });
}

/* ---------------- Traductions indicatives de l'allemand ---------------- */
// Mots fréquents dans les noms d'organisations : affichés en petit, pour les non-germanophones
const GLOSSAIRE = [
  ["krankenversicherung", "assurance-maladie"], ["versicherung", "assurance"], ["bankiervereinigung", "Association des banquiers"],
  ["hauseigentümerverband", "association des propriétaires"], ["gewerkschaftsbund", "union syndicale"], ["gewerkschaft", "syndicat"],
  ["gewerbeverband", "union des arts et métiers"], ["bauernverband", "union des paysans"], ["baumeisterverband", "société des entrepreneurs"],
  ["arbeitgeberverband", "union patronale"], ["handelskammer", "chambre de commerce"], ["pensionskasse", "caisse de pension"],
  ["ausgleichskasse", "caisse de compensation"], ["vorsorge", "prévoyance"], ["landwirtschaft", "agriculture"], ["wirtschaft", "économie"],
  ["genossenschaft", "coopérative"], ["gesellschaft", "société"], ["stiftung", "fondation"], ["vereinigung", "association"],
  ["verband", "association"], ["verein", "association"], ["schweizerisch", "suisse"], ["schweizer", "suisse"], ["schweiz", "Suisse"],
  ["bürgerlich", "bourgeois (centre-droit)"], ["politik", "politique"], ["gesundheit", "santé"], ["spital", "hôpital"], ["ärzte", "médecins"],
  ["apotheker", "pharmaciens"], ["pflege", "soins"], ["umwelt", "environnement"], ["naturschutz", "protection de la nature"],
  ["verkehr", "transports"], ["eisenbahn", "chemin de fer"], ["bildung", "formation"], ["hochschule", "haute école"], ["forschung", "recherche"],
  ["immobilien", "immobilier"], ["treuhand", "fiduciaire"], ["anwalt", "avocat"], ["aufzüge", "ascenseurs"], ["kraftwerk", "centrale"],
  ["strom", "électricité"], ["wasser", "eau"], ["milch", "lait"], ["fleisch", "viande"], ["holz", "bois"], ["wald", "forêt"],
  ["frauen", "femmes"], ["jugend", "jeunesse"], ["tourismus", "tourisme"], ["freiheit", "liberté"], ["bund", "Confédération"],
  ["kanton", "canton"], ["komitee", "comité"], ["beirat", "conseil consultatif"], ["vorstand", "comité"], ["handel", "commerce"], ["unternehmen", "entreprise"],
];
function deHint(text) {
  const words = String(text || "").toLowerCase().split(/[^a-zäöüß]+/).filter((w) => w.length > 3);
  const seen = new Set(), out = [];
  for (const w of words) {
    const hit = GLOSSAIRE.find(([k]) => w.startsWith(k) || (k.length > 6 && w.includes(k)));
    if (hit && !seen.has(hit[1])) { seen.add(hit[1]); out.push(`${hit[0]} = ${hit[1]}`); }
  }
  return out.length ? `<span class="de-hint" title="Traduction indicative des mots allemands">≈ ${esc(out.slice(0, 4).join(" · "))}</span>` : "";
}
// Libellés des votes du Conseil national, parfois publiés en allemand seulement
const PHRASES = [
  [/Empfehlung auf Ablehnung der Volksinitiative/g, "recommandation de rejeter l'initiative"], [/Empfehlung auf Annahme der Volksinitiative/g, "recommandation d'accepter l'initiative"],
  [/Antrag der Mehrheit/g, "Proposition de la majorité de la commission"], [/Antrag der Minderheit/g, "Proposition de la minorité"],
  [/Antrag des Bundesrates/g, "Proposition du Conseil fédéral"], [/und des Bundesrates/g, "et du Conseil fédéral"], [/Antrag/g, "Proposition"],
  [/Annahme der Vorlage/g, "Adoption du projet"], [/Ablehnung der Vorlage/g, "Rejet du projet"], [/Annahme der Motion/g, "Adopter la motion"],
  [/Ablehnung der Motion/g, "Rejeter la motion"], [/Annahme des Postulates/g, "Adopter le postulat"], [/Ablehnung des Postulates/g, "Rejeter le postulat"],
  [/keine Folge geben/g, "ne pas donner suite"], [/Folge geben/g, "donner suite"], [/Nichteintreten/g, "Non-entrée en matière"], [/Eintreten/g, "Entrée en matière"],
  [/keine Rückweisung/g, "pas de renvoi"], [/Rückweisung/g, "renvoi"], [/Zustimmung/g, "approbation"], [/Festhalten/g, "maintenir"], [/Streichen/g, "biffer"],
  [/Annahme/g, "adoption"], [/Ablehnung/g, "rejet"], [/Abschreiben/g, "classer"], [/\bAbs\./g, "al."], [/\bBst\./g, "let."], [/\bZiff\./g, "ch."],
];
const trVote = (s) => PHRASES.reduce((t, [re, fr]) => t.replace(re, fr), String(s || ""));
const trBadge = (s) => String(s || "").replace(/Interessenvertreter\/in/g, "Représentant·e d'intérêts").replace(/Persönliche\/r Mitarbeiter\/in/g, "Collaborateur·trice personnel·le").replace(/^Gast$/, "Invité·e");

/* Contexte édité à la main (config/contexte_elus.csv), affiché à côté des chiffres sensibles */
const ctxNote = (e) => (e.contexte ? `<span class="ctx">ⓘ ${esc(e.contexte.note)}</span>` : "");

/* Listes longues : les premiers éléments, puis « Afficher plus » */
function listMore(items, n = 8, label = "éléments") {
  if (items.length <= n) return `<ul class="list">${items.join("")}</ul>`;
  return `<ul class="list">${items.slice(0, n).join("")}</ul><details class="more"><summary>Afficher les ${items.length - n} autres ${esc(label)}</summary><ul class="list">${items.slice(n).join("")}</ul></details>`;
}

/* ---------------- Absences ---------------- */
async function renderAbsences() {
  const box = $("#t-abs"); if (!box) return;
  const p = await loadParl();
  if (!p) { $("#s-abs").textContent = "Votes indisponibles pour l'instant."; return; }
  const rows = L.elus.filter((e) => e.conseil === "CN" && p.elus[e.id]).map((e) => { const s = p.elus[e.id];
    return { e, s, taux: 100 * s.absences / s.scrutins, tauxE: 100 * s.excuses / s.scrutins, tauxT: 100 - s.participation }; });
  if (!$("#fa-tri")) {
    $("#f-abs").innerHTML = `<select id="fa-tri" aria-label="Tri"><option value="abs">Tri : absences non excusées</option><option value="tot">Tri : absences au total</option><option value="exc">Tri : absences excusées</option></select>
      ${select("fa-parti", "Parti", uniq(rows.map((r) => r.e.parti)).sort())}${select("fa-canton", "Canton", uniq(rows.map((r) => r.e.canton)).sort())}
      <input type="search" id="fa-q" placeholder="Nom…" aria-label="Chercher un élu">`;
    $("#f-abs").addEventListener("input", renderAbsences);
  }
  const f = { tri: $("#fa-tri").value, parti: $("#fa-parti").value, canton: $("#fa-canton").value, q: norm($("#fa-q").value) };
  const list = rows.filter((r) => (!f.parti || r.e.parti === f.parti) && (!f.canton || r.e.canton === f.canton) && (!f.q || r.e._n.includes(f.q)))
    .sort({ abs: (a, b) => b.taux - a.taux, tot: (a, b) => b.tauxT - a.tauxT, exc: (a, b) => b.tauxE - a.tauxE }[f.tri]);
  const moy = sum(rows, (r) => r.taux) / rows.length;
  const moyE = sum(rows, (r) => r.tauxE) / rows.length;
  $("#s-abs").innerHTML = `${list.length} élus · en moyenne, un conseiller national manque <b class="money">${num1(moy)} %</b> des votes sans excuse et <b>${num1(moyE)} %</b> avec excuse ${shareBtn("absences-top", () => { const t = [...rows].sort((a, b) => b.taux - a.taux).slice(0, 3);
    return shareCard({ kicker: "Qui manque le plus de votes ?", title: "Conseil national : les absences non excusées les plus fréquentes depuis décembre 2023", big: `${pctInt(t[0].taux)}`, bigColor: "#C8202A", lines: t.map((r, i) => `${i + 1}. ${r.e.nom} (${r.e.parti}, ${r.e.canton}) : ${nf.format(r.s.absences)} votes manqués sur ${nf.format(r.s.scrutins)}`).concat([`Moyenne : ${num1(moy)} %. Les données ne disent pas pourquoi un élu était absent.`]), text: "Qui manque le plus de votes au Conseil national ?", file: "absences.png" }); })}`;
  box.innerHTML = `<thead><tr><th>Élu</th><th class="num">Non excusées</th><th class="num">Excusées</th><th class="num">Total</th></tr></thead>
    <tbody>${list.map((r) => `<tr class="click" data-open="elu" data-key="${r.e.id}"><td><span class="who">${avatar(r.e)}<span><strong>${esc(r.e.nom)}</strong><br><small>${esc(r.e.parti)}, ${esc(r.e.canton)}</small>${ctxNote(r.e)}</span></span></td>
      <td class="num"><strong class="money">${pct(r.taux)}</strong><br><small>${nf.format(r.s.absences)} votes</small></td>
      <td class="num"><strong>${pct(r.tauxE)}</strong><br><small>${nf.format(r.s.excuses)} votes</small></td>
      <td class="num"><strong>${pct(r.tauxT)}</strong><span class="abs-bar" title="Non excusées ${pct(r.taux)}, excusées ${pct(r.tauxE)}"><span class="ne" style="width:${Math.min(100, 4 * r.taux)}%"></span><span class="ex" style="width:${Math.min(100 - Math.min(100, 4 * r.taux), 4 * r.tauxE)}%"></span></span></td></tr>`).join("")}</tbody>
    <caption class="note">Barre : absences non excusées (rouge) et excusées (gris), échelle 0 à 25 %.</caption>`;
}

/* ---------------- Lobbyistes ---------------- */
const badgeType = (b) => (/interessenvertreter|représentant|repräsentant/i.test(b.fonction) ? "Lobbyiste" : /mitarbeiter|collaborat/i.test(b.fonction) ? "Collaborateur·trice" : /gast|invit/i.test(b.fonction) ? "Invité·e" : "Autre");
function renderLobbyistes() {
  const box = $("#l-lob"); if (!box) return;
  const badges = L.badges.map((b) => ({ b, e: idx.elu.get(b.p), type: badgeType(b), org: orgBadge(b) })).filter((x) => x.e);
  if (!$("#fl-type")) {
    const lob = badges.filter((x) => x.type === "Lobbyiste");
    $("#k-lob").innerHTML = kpi(badges.length, "badges d'accès permanents donnés par des élus") + kpi(lob.length, "à des représentants d'intérêts déclarés", "money") + kpi(uniq(lob.map((x) => x.e.id)).length, "élus font entrer au moins un lobbyiste", "infl");
    $("#f-lob").innerHTML = `<select id="fl-type" aria-label="Type de badge"><option>Lobbyiste</option><option value="">Tous les badges</option><option>Collaborateur·trice</option><option>Invité·e</option></select>
      ${select("fl-parti", "Parti de l'élu", uniq(badges.map((x) => x.e.parti)).sort())}${select("fl-canton", "Canton", uniq(badges.map((x) => x.e.canton)).sort())}
      <input type="search" id="fl-q" placeholder="Lobbyiste, organisation, élu…" aria-label="Chercher">`;
    $("#f-lob").addEventListener("input", renderLobbyistes);
  }
  const f = { type: $("#fl-type").value, parti: $("#fl-parti").value, canton: $("#fl-canton").value, q: norm($("#fl-q").value).split(" ").filter(Boolean) };
  const list = badges.filter((x) => (!f.type || x.type === f.type) && (!f.parti || x.e.parti === f.parti) && (!f.canton || x.e.canton === f.canton)
    && (!f.q.length || matchAll(norm(`${x.b.nom} ${x.b.fonction} ${x.b.mandats.join(" ")} ${x.e.nom}`), f.q)));
  const hotes = new Map(); list.forEach((x) => { if (!hotes.has(x.e.id)) hotes.set(x.e.id, []); hotes.get(x.e.id).push(x); });
  const orgs = {}; list.filter((x) => x.org).forEach((x) => { orgs[x.org] = (orgs[x.org] || 0) + 1; });
  const topOrgs = Object.entries(orgs).sort((a, b) => b[1] - a[1]).filter(([, n]) => n > 1).slice(0, 10);
  box.innerHTML = `${topOrgs.length ? `<div class="card"><h3>Les organisations qui ont le plus de badges</h3>${bars(topOrgs.map(([k, v]) => ({ label: k, value: v })), "m", (v) => v)}</div>` : ""}
    <p class="summary">${list.length} badge${list.length > 1 ? "s" : ""}, donnés par ${hotes.size} élu${hotes.size > 1 ? "s" : ""}</p>
    <div class="elu-cards">${[...hotes.values()].sort((a, b) => b.length - a.length || a[0].e.nom.localeCompare(b[0].e.nom)).map((xs) => { const e = xs[0].e;
      return `<div class="card elu-card"><button class="elu-card-head" data-open="elu" data-key="${e.id}">${e.photo ? `<img src="${esc(e.photo)}" alt="" width="56" height="56" loading="lazy" onerror="this.remove()">` : ""}<span><strong>${esc(e.nom)}</strong><br><small>${esc(e.parti)} · ${esc(e.canton)} · ${esc(e.conseil)}</small></span></button>
        <p class="note">fait entrer au Palais fédéral :</p>
        <ul class="list">${xs.map((x) => `<li><span><strong>${esc(x.b.nom)}</strong></span><span class="tag ${x.type === "Lobbyiste" ? "paid" : ""}">${esc(x.type)}</span>
          <span class="sub">${esc(x.org || trBadge(x.b.fonction))}${x.org ? " " + deHint(x.org) : ""}${x.b.mandats.length && x.b.mandats[0] !== x.org ? ` · aussi : ${esc(x.b.mandats.slice(0, 3).join(", "))}` : ""}</span></li>`).join("")}</ul>
        ${shareBtn(`lob-${e.id}`, () => shareCard({ kicker: "Qui fait entrer qui au Parlement", title: `${e.nom} (${e.parti}, ${e.canton}) a donné son badge d'accès permanent à`, lines: xs.map((x) => `${x.b.nom} : ${x.org || trBadge(x.b.fonction)}`).concat(["Chaque parlementaire peut faire entrer deux personnes au Palais fédéral."]), text: `Qui ${e.nom} fait-il entrer au Parlement ?`, file: `badges-${e.id}.png` }), "Partager")}</div>`; }).join("") || `<p class="empty">Aucun badge pour ces filtres.</p>`}</div>`;
}

/* ---------------- À la une (accueil) ---------------- */
async function renderUne() {
  const box = $("#une"); if (!box) return;
  const lob = L.badges.filter(isLobbyiste), hosts = {}; lob.forEach((b) => { hosts[b.p] = (hosts[b.p] || 0) + 1; });
  const topH = Object.entries(hosts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p]) => idx.elu.get(+p)).filter(Boolean);
  const ag = argentGagne();
  const cardA = (id, body) => `<a class="card une-card" href="#${id}">${body}</a>`;
  const html = (abs) => cardA("absences", `<p class="eyebrow-s">Absences</p><h3>Qui manque le plus de votes au Parlement ?</h3>${abs}<span class="go">Voir le classement →</span>`)
    + cardA("lobbyistes", `<p class="eyebrow-s">Lobbyistes</p><h3>${lob.length} lobbyistes entrent au Palais fédéral grâce au badge d'un élu</h3><p class="note">Parmi ceux qui en font entrer : ${topH.map((e) => esc(e.nom)).join(", ")}…</p><span class="go">Qui fait entrer qui →</span>`)
    + (ag.rows.length ? cardA("tendances", `<p class="eyebrow-s">Votations</p><h3>L'argent gagne-t-il ?</h3><p class="big money">${ag.n} sur ${ag.rows.length}</p><p class="note">votations gagnées par le camp qui a dépensé le plus</p><span class="go">Tous les classements →</span>`) : "");
  box.innerHTML = html(`<p class="note">Chargement…</p>`);
  const p = await loadParl(); if (!p) return;
  const t = L.elus.filter((e) => e.conseil === "CN" && p.elus[e.id]).map((e) => ({ e, taux: 100 * p.elus[e.id].absences / p.elus[e.id].scrutins })).sort((a, b) => b.taux - a.taux).slice(0, 3);
  box.innerHTML = html(`<ol class="podium">${t.map((r) => `<li><span>${esc(r.e.nom)} <small>(${esc(r.e.parti)})</small>${ctxNote(r.e)}</span><b class="money">${pctInt(r.taux)}</b></li>`).join("")}</ol><p class="note">des votes manqués sans excuse, depuis décembre 2023</p>`);
}

/* ---------------- Réseaux (carte à bulles élus × organisations) ---------------- */
const F_COLORS = { G: "#6FA83A", S: "#D93A3A", GL: "#B3AE1F", ME: "#EF8C00", RL: "#2F6DB3", V: "#1F6B35", X: "#9AA4AE" };  // pour l'image partagée (thème clair)
let NET = null;  // dernière carte calculée (pour l'image partagée)

const NET_OPT = { depth: 1, isoles: false };
function netData(mode, key) {
  const nodes = new Map(), links = [], seen = new Set();
  const addElu = (e) => { if (!nodes.has(`e:${e.id}`)) nodes.set(`e:${e.id}`, { id: `e:${e.id}`, type: "elu", e, label: e.nom, paid: e.liens.filter((l) => l.statut === "remunere").length }); return nodes.get(`e:${e.id}`); };
  const addOrg = (o) => { if (!nodes.has(`o:${o}`)) nodes.set(`o:${o}`, { id: `o:${o}`, type: "org", label: o, n: 0 }); return nodes.get(`o:${o}`); };
  const link = (e, l) => { const k = `${e.id}|${l.org}|${l.role}`; if (seen.has(k)) return; seen.add(k); const a = addElu(e), b = addOrg(l.org); b.n++; links.push({ s: a.id, t: b.id, paid: l.statut === "remunere", lien: l }); };
  let titre = "", center = null;
  if (mode === "g") {
    const ls = L.liens.filter((l) => l.groupe === key);
    const byOrg = {}; ls.forEach((l) => { (byOrg[l.org] ||= new Set()).add(l.p); });
    const orgsSel = new Set(Object.entries(byOrg).sort((a, b) => b[1].size - a[1].size).slice(0, 60).map(([o]) => o));
    ls.filter((l) => orgsSel.has(l.org)).forEach((l) => { const e = idx.elu.get(l.p); if (e) link(e, l); });
    titre = `Groupe d'intérêts : ${key}`;
  } else if (mode === "elu") {
    const c = idx.elu.get(+key); if (!c) return null;
    center = `e:${c.id}`;
    c.liens.forEach((l) => link(c, l));
    const orgs = new Set(c.liens.map((l) => l.org)), voisins = {};
    L.liens.forEach((l) => { if (l.p !== c.id && orgs.has(l.org)) (voisins[l.p] ||= []).push(l); });
    const proches = Object.entries(voisins).sort((a, b) => b[1].length - a[1].length).slice(0, 25).map(([p, ls]) => [idx.elu.get(+p), ls]).filter(([e]) => e);
    proches.forEach(([e, ls]) => ls.forEach((l) => link(e, l)));
    if (NET_OPT.depth === 2) proches.forEach(([e]) => e.liens.forEach((l) => link(e, l)));  // 2e niveau : liens entre voisins
    titre = `Le réseau de ${c.nom}`;
  } else if (mode === "org") {
    const o = idx.org.get(key); if (!o) return null;
    center = `o:${key}`;
    const elus = uniq(o.liens.map((l) => l.p)).map((p) => idx.elu.get(p)).filter(Boolean);
    o.liens.forEach((l) => { const e = idx.elu.get(l.p); if (e) link(e, l); });
    if (NET_OPT.depth === 2) elus.forEach((e) => e.liens.forEach((l) => link(e, l)));
    else { const autres = {}; elus.forEach((e) => e.liens.forEach((l) => { if (l.org !== key) (autres[l.org] ||= []).push([e, l]); }));
      Object.entries(autres).filter(([, v]) => v.length >= 2).sort((a, b) => b[1].length - a[1].length).slice(0, 30).forEach(([, v]) => v.forEach(([e, l]) => link(e, l))); }
    titre = `Autour de ${key}`;
  }
  const badges = [];
  L.badges.filter(isLobbyiste).forEach((b) => { const org = orgBadge(b), e = idx.elu.get(b.p);
    if (e && nodes.has(`e:${e.id}`) && nodes.has(`o:${org}`)) badges.push({ s: `e:${e.id}`, t: `o:${org}`, badge: b }); });
  return simplify({ titre, center, nodes: [...nodes.values()], links, badges });
}
// Organisations reliées à un seul élu : repliées en « +N mandats » sur l'élu (comme les nœuds isolés masqués d'Obsidian)
function simplify(net) {
  const deg = new Map(); net.links.forEach((l) => deg.set(l.t, (deg.get(l.t) || 0) + 1));
  net.nodes.forEach((n) => { n.extra = 0; });
  net.isolated = []; net.replies = 0;
  if (NET_OPT.isoles) return net;
  const leaf = new Set(net.nodes.filter((n) => n.type === "org" && (deg.get(n.id) || 0) < 2 && n.id !== net.center).map((n) => n.id));
  const byId = new Map(net.nodes.map((n) => [n.id, n]));
  net.links.forEach((l) => { if (leaf.has(l.t)) byId.get(l.s).extra++; });
  net.links = net.links.filter((l) => !leaf.has(l.t));
  const keep = new Set(net.links.flatMap((l) => [l.s, l.t])); if (net.center) keep.add(net.center);
  net.isolated = net.nodes.filter((n) => n.type === "elu" && !keep.has(n.id));
  net.nodes = net.nodes.filter((n) => keep.has(n.id));
  net.badges = net.badges.filter((b) => keep.has(b.s) && keep.has(b.t));
  net.replies = leaf.size;
  return net;
}

function layout(net) {
  const N = net.nodes, byId = new Map(N.map((n) => [n.id, n]));
  N.forEach((n, i) => { n.r = n.type === "elu" ? 7 + Math.min(9, n.paid * 0.7) : 5 + Math.min(11, Math.sqrt(n.n) * 2.4); const a = i * 2.39996; n.x = Math.cos(a) * 12 * Math.sqrt(i + 1); n.y = Math.sin(a) * 12 * Math.sqrt(i + 1); n.vx = 0; n.vy = 0; });
  const E = net.links.concat(net.badges).map((l) => ({ a: byId.get(l.s), b: byId.get(l.t), k: l.badge ? 0.02 : l.paid ? 0.06 : 0.04 }));
  const REP = 1400 + 45 * N.length, REST = 34 + N.length / 2.5;  // cartes chargées : bulles plus espacées
  for (let it = 0; it < 320; it++) {
    const alpha = 1 - it / 320;
    for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {  // répulsion + collision
      const a = N[i], b = N[j]; let dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy || 0.01, d = Math.sqrt(d2);
      let f = REP / d2; const min = a.r + b.r + 4; if (d < min) f += (min - d) * 0.5;
      dx /= d; dy /= d; a.vx -= dx * f; a.vy -= dy * f; b.vx += dx * f; b.vy += dy * f;
    }
    for (const { a, b, k } of E) {  // ressorts
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 0.01, rest = a.r + b.r + REST, f = (d - rest) * k;
      a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f;
    }
    for (const n of N) { n.vx -= n.x * 0.004; n.vy -= n.y * 0.004; n.x += n.vx * alpha * 0.6; n.y += n.vy * alpha * 0.6; n.vx *= 0.55; n.vy *= 0.55; }
  }
  const xs = N.flatMap((n) => [n.x - n.r, n.x + n.r]), ys = N.flatMap((n) => [n.y - n.r, n.y + n.r]);
  net.box = [Math.min(...xs) - 20, Math.min(...ys) - 20, Math.max(...xs) - Math.min(...xs) + 40, Math.max(...ys) - Math.min(...ys) + 40];
  net.E = E; net.byId = byId;
  return net;
}

function renderReseaux(q) {
  const box = $("#net"); if (!box) return;
  const groupes = uniq(L.liens.map((l) => l.groupe)).filter((g) => g !== "Non classé" && g !== "Partis").sort((a, b) => a.localeCompare(b));
  const [mode, ...rest] = (q || "").split("|"), key = rest.join("|");
  const m = ["g", "elu", "org"].includes(mode) && key ? mode : "g", k = m === "g" && !groupes.includes(key) ? (groupes.includes("Assurances") ? "Assurances" : groupes[0]) : key;
  $("#f-net").innerHTML = `<select id="fn-groupe" aria-label="Groupe d'intérêts"><option value="">Groupe d'intérêts…</option>${groupes.map((g) => `<option${m === "g" && g === k ? " selected" : ""}>${esc(g)}</option>`).join("")}</select>
    <input type="search" id="fn-q" list="fn-list" placeholder="Ou un élu, une organisation…" aria-label="Centrer sur un élu ou une organisation"><datalist id="fn-list"></datalist>
    ${m !== "g" ? `<select id="fn-depth" aria-label="Profondeur"><option value="1"${NET_OPT.depth === 1 ? " selected" : ""}>Voisins directs</option><option value="2"${NET_OPT.depth === 2 ? " selected" : ""}>Voisins des voisins</option></select>` : ""}
    <label class="check"><input type="checkbox" id="fn-isoles"${NET_OPT.isoles ? " checked" : ""}> Mandats isolés</label>`;
  const net = netData(m, k);
  if (!net || !net.nodes.length) { box.innerHTML = `<p class="empty">Rien à afficher.</p>`; return; }
  NET = layout(net);
  const deg = new Map(); NET.links.forEach((l) => { deg.set(l.s, (deg.get(l.s) || 0) + 1); deg.set(l.t, (deg.get(l.t) || 0) + 1); });
  NET.deg = deg;
  // Niveau d'étiquette : 1 toujours visible, 2 en zoomant, 3 en zoomant fort (comme le « text fade threshold » d'Obsidian)
  const petit = NET.nodes.length <= 55;  // petite carte : tous les noms d'emblée
  const lvl = (n) => (n.id === NET.center || petit ? 1 : n.type === "org" ? (n.n >= 4 ? 1 : n.n >= 3 ? 2 : 3) : ((deg.get(n.id) || 0) >= 3 ? 1 : (deg.get(n.id) || 0) >= 2 ? 2 : 3));
  const [x0, y0, w, h] = NET.box;
  const ln = (l, cls, title) => { const a = NET.byId.get(l.s), b = NET.byId.get(l.t); return `<line data-s="${esc(l.s)}" data-t="${esc(l.t)}" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" class="${cls}"><title>${esc(title)}</title></line>`; };
  const lines = NET.links.map((l) => ln(l, l.paid ? "l-paid" : "l-free", `${NET.byId.get(l.s).label} → ${NET.byId.get(l.t).label} : ${ROLE[l.lien.role] || l.lien.role}${l.paid ? ", rémunéré" : ""}`)).join("")
    + NET.badges.map((l) => ln(l, "l-badge", `${NET.byId.get(l.s).label} fait entrer ${l.badge.nom} (${NET.byId.get(l.t).label}) au Palais fédéral`)).join("");
  const circles = NET.nodes.map((n) => {
    const lbl = n.type === "elu" ? `${n.label.split(" ").slice(-1)[0]}${n.extra ? ` +${n.extra}` : ""}` : (n.label.length > 26 ? n.label.slice(0, 24) + "…" : n.label);
    return `<g class="node ${n.type} lvl${lvl(n)}${n.id === NET.center ? " center" : ""}" data-id="${esc(n.id)}" data-net="${n.type === "elu" ? `elu|${n.e.id}` : `org|${esc(n.label)}`}" tabindex="0" role="button" aria-label="${esc(n.label)}">
      <circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r.toFixed(1)}" ${n.type === "elu" ? `fill="var(--f-${fcls(n.e.fraction)})"` : ""}><title>${esc(n.label)}${n.type === "elu" ? ` (${esc(n.e.parti)}, ${esc(n.e.canton)}) : ${n.paid} mandats rémunérés${n.extra ? `, ${n.extra} mandats sans autre élu sur cette carte` : ""}` : ` : ${n.n} élu${n.n > 1 ? "s" : ""} sur cette carte`}</title></circle>
      <text x="${n.x.toFixed(1)}" y="${(n.y + n.r + 9).toFixed(1)}">${esc(lbl)}</text></g>`; }).join("");
  const nElus = NET.nodes.filter((n) => n.type === "elu").length, nOrgs = NET.nodes.length - nElus;
  const carrefours = NET.nodes.filter((n) => n.type === "org").sort((a, b) => b.n - a.n).slice(0, 10);
  const connectes = NET.nodes.filter((n) => n.type === "elu").sort((a, b) => (deg.get(b.id) || 0) - (deg.get(a.id) || 0) || b.paid - a.paid).slice(0, 10);
  const item = (n, right) => `<li><button class="link" data-net-focus="${esc(n.id)}">${esc(n.label)}</button><span class="note">${esc(right)}</span></li>`;
  box.innerHTML = `<p class="summary">${esc(NET.titre)} · <span class="infl">${nElus} élus</span>, ${nOrgs} organisations partagées${NET.replies ? ` (${NET.replies} mandats isolés repliés en « +N »)` : ""}${NET.badges.length ? `, ${NET.badges.length} badge${NET.badges.length > 1 ? "s" : ""} de lobbyiste` : ""}</p>
    <div class="net-layout"><div class="net-wrap">
      <div class="net-tools"><button class="btn ghost" data-zoom="in" aria-label="Zoomer">+</button><button class="btn ghost" data-zoom="out" aria-label="Dézoomer">−</button><button class="btn ghost" data-zoom="reset" aria-label="Recentrer">⟲</button></div>
      <svg class="net" viewBox="${x0.toFixed(0)} ${y0.toFixed(0)} ${w.toFixed(0)} ${h.toFixed(0)}" role="img" aria-label="${esc(NET.titre)}" data-z="1" style="--k:1"><g class="vp">${lines}${circles}</g></svg>
    </div>
    <aside class="net-side">
      <h4>Carrefours</h4><p class="note">Organisations qui réunissent le plus d'élus sur la carte</p><ul class="list">${carrefours.map((n) => item(n, `${n.n} élus`)).join("") || "<li class='note'>Aucune</li>"}</ul>
      <h4>Élus les plus connectés</h4><ul class="list">${connectes.map((n) => { const d = deg.get(n.id) || 0; return item(n, `${d} lien${d > 1 ? "s" : ""} · ${n.e.parti}`); }).join("")}</ul>
      ${NET.isolated.length ? `<details class="more"><summary>${NET.isolated.length} élus sans organisation partagée</summary><ul class="list">${NET.isolated.map((n) => `<li>${linkBtn("elu", n.e.id, n.e.nom)}<span class="note">${esc(n.e.parti)}</span></li>`).join("")}</ul></details>` : ""}
    </aside></div>
    <div class="legend wrap-l"><span><i style="background:var(--money)"></i>mandat rémunéré</span><span><i style="background:var(--rule)"></i>mandat bénévole ou non communiqué</span><span><i class="dash"></i>badge d'accès donné à un lobbyiste</span><span><i class="org-dot"></i>organisation</span><span>bulle colorée : élu (couleur du groupe) · « +N » : mandats sans autre élu sur la carte</span></div>
    <p class="note">Survolez ou touchez une bulle pour voir ses liens. Molette ou pincement pour zoomer, glisser pour se déplacer : les noms apparaissent en zoomant. Un lien n'est pas une faute : c'est une information.</p>
    <div id="net-info"></div>
    ${shareBtn("reseau", shareNet)}`;
  netInteractions($("svg.net"));
  if (NET.center) netHighlight(NET.center, true);
  $("#fn-groupe").addEventListener("change", (ev) => { if (ev.target.value) location.hash = `#reseaux:g|${ev.target.value}`; });
  $("#fn-depth")?.addEventListener("change", (ev) => { NET_OPT.depth = +ev.target.value; renderReseaux(q); });
  $("#fn-isoles").addEventListener("change", (ev) => { NET_OPT.isoles = ev.target.checked; renderReseaux(q); });
  $("#fn-q").addEventListener("input", (ev) => {
    const t = norm(ev.target.value).split(" ").filter(Boolean); if (!t.length) return;
    const hits = [...L.elus.filter((e) => matchAll(e._n, t)).slice(0, 5).map((e) => [e.nom, `elu|${e.id}`]), ...[...idx.org.values()].filter((o) => matchAll(o._n, t)).slice(0, 5).map((o) => [o.nom, `org|${o.nom}`])];
    $("#fn-list").innerHTML = hits.map(([l]) => `<option value="${esc(l)}">`).join("");
    const exact = hits.find(([l]) => l === ev.target.value); if (exact) location.hash = `#reseaux:${exact[1]}`;
  });
}

// Zoom (molette, pincement, boutons) et déplacement (glisser), comme la vue graphe d'Obsidian
function netInteractions(svg) {
  const g = svg.querySelector(".vp"); let k = 1, tx = 0, ty = 0, moved = false;
  const pts = new Map(); let pinch0 = null;
  const apply = () => { g.setAttribute("transform", `translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${k.toFixed(3)})`); svg.style.setProperty("--k", k.toFixed(3)); svg.dataset.z = k >= 2.2 ? "3" : k >= 1.4 ? "2" : "1"; };
  const user = (cx, cy) => { const p = svg.createSVGPoint(); p.x = cx; p.y = cy; return p.matrixTransform(svg.getScreenCTM().inverse()); };
  const zoomAt = (f, cx, cy) => { const p = user(cx, cy), nk = Math.min(8, Math.max(0.6, k * f)); tx = p.x - (p.x - tx) * nk / k; ty = p.y - (p.y - ty) * nk / k; k = nk; apply(); };
  const rect = () => svg.getBoundingClientRect();
  svg._net = {
    zoom(f) { const r = rect(); zoomAt(f, r.left + r.width / 2, r.top + r.height / 2); },
    reset() { k = 1; tx = 0; ty = 0; apply(); },
    focus(x, y) { const vb = svg.viewBox.baseVal; if (k < 1.8) k = 1.8; tx = vb.x + vb.width / 2 - x * k; ty = vb.y + vb.height / 2 - y * k; apply(); },
  };
  svg.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX, e.clientY); }, { passive: false });
  svg.addEventListener("pointerdown", (e) => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = false; if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); } });
  svg.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && pinch0) { const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y); zoomAt(d / pinch0, (a.x + b.x) / 2, (a.y + b.y) / 2); pinch0 = d; moved = true; return; }
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y; if (Math.abs(dx) + Math.abs(dy) < 1) return;
    if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    if (!moved) svg.setPointerCapture(e.pointerId);
    moved = true; const s = svg.viewBox.baseVal.width / rect().width; tx += dx * s; ty += dy * s; apply();
  });
  const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch0 = null; };
  svg.addEventListener("pointerup", up); svg.addEventListener("pointercancel", up);
  svg.addEventListener("click", (e) => { if (moved) { e.stopPropagation(); moved = false; return; } if (!e.target.closest(".node")) netHighlight(null, true); }, true);
  // Survol à la souris : surbrillance temporaire des voisins
  svg.addEventListener("pointerover", (e) => { const n = e.target.closest(".node"); if (n && e.pointerType === "mouse" && !pts.size) netHighlight(n.dataset.id, false); });
  svg.addEventListener("pointerout", (e) => { const n = e.target.closest(".node"); if (n && e.pointerType === "mouse") netHighlight(svg.dataset.sel || null, false); });
  apply();
}
function netHighlight(id, sticky) {
  const svg = $("svg.net"); if (!svg) return;
  if (sticky) { if (id) svg.dataset.sel = id; else delete svg.dataset.sel; }
  svg.classList.toggle("sel", !!id);
  const near = new Set(id ? [id] : []);
  svg.querySelectorAll("line").forEach((l) => { const on = !!id && (l.dataset.s === id || l.dataset.t === id); l.classList.toggle("dim", !!id && !on); l.classList.toggle("hl", on); if (on) { near.add(l.dataset.s); near.add(l.dataset.t); } });
  svg.querySelectorAll(".node").forEach((n) => { n.classList.toggle("dim", !!id && !near.has(n.dataset.id)); n.classList.toggle("hl", !!id && near.has(n.dataset.id)); });
}
function netInfo(ref) {
  const [type, ...rest] = ref.split("|"), key = rest.join("|");
  const e = type === "elu" ? idx.elu.get(+key) : null, o = type === "org" ? idx.org.get(key) : null;
  $("#net-info").innerHTML = `<div class="card net-card"><strong>${esc(e ? e.nom : key)}</strong> <small class="note">${e ? `${esc(e.parti)}, ${esc(e.canton)} · ${e.liens.length} mandats` : o ? `${esc(o.groupe)} · ${uniq(o.liens.map((l) => l.p)).length} élus liés` : ""}</small>
    <div class="answers"><a class="btn" href="#reseaux:${esc(ref)}">Centrer la carte sur ${e ? "cet élu" : "cette organisation"}</a>${linkBtn(e ? "elu" : "org", e ? e.id : key, "Ouvrir la fiche")}</div></div>`;
}
function netSelect(ref) {
  const [type, ...rest] = ref.split("|");
  netHighlight(type === "elu" ? `e:${rest[0]}` : `o:${rest.join("|")}`, true);
  netInfo(ref);
}
function netFocus(id) {
  const n = NET?.byId.get(id), svg = $("svg.net"); if (!n || !svg) return;
  svg._net.focus(n.x, n.y); netSelect(n.type === "elu" ? `elu|${n.e.id}` : `org|${n.label}`);
  svg.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function shareNet() {
  if (!NET) return;
  await document.fonts?.ready;
  const W = 1080, H = 1350, c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d");
  const Fnt = (w, s) => `${w} ${s}px "Schibsted Grotesk", "Helvetica Neue", Arial, sans-serif`;
  x.fillStyle = "#F3F4F1"; x.fillRect(0, 0, W, H); x.fillStyle = "#C8202A"; x.fillRect(0, 0, W / 2, 20); x.fillStyle = "#1F5F8B"; x.fillRect(W / 2, 0, W / 2, 20);
  x.fillStyle = "#5F6873"; x.font = Fnt(700, 32); x.fillText("QUI FINANCE ? · RÉSEAUX", 60, 100);
  x.fillStyle = "#16202A"; x.font = Fnt(800, 54); let y = 170; for (const l of wrapLines(x, NET.titre, W - 120).slice(0, 2)) { x.fillText(l, 60, y); y += 62; }
  const [x0, y0, w, h] = NET.box, top = y + 10, area = [60, top, W - 120, H - top - 170], s = Math.min(area[2] / w, area[3] / h);
  const P = (n) => [area[0] + (n.x - x0) * s + (area[2] - w * s) / 2, area[1] + (n.y - y0) * s + (area[3] - h * s) / 2];
  for (const l of NET.links) { const [ax, ay] = P(NET.byId.get(l.s)), [bx, by] = P(NET.byId.get(l.t)); x.strokeStyle = l.paid ? "rgba(200,32,42,.75)" : "rgba(95,104,115,.3)"; x.lineWidth = l.paid ? 2.5 : 1.2; x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); x.stroke(); }
  x.setLineDash([6, 5]); for (const l of NET.badges) { const [ax, ay] = P(NET.byId.get(l.s)), [bx, by] = P(NET.byId.get(l.t)); x.strokeStyle = "#1F5F8B"; x.lineWidth = 2; x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); x.stroke(); } x.setLineDash([]);
  x.textAlign = "center";
  for (const n of NET.nodes) { const [nx, ny] = P(n), r = Math.max(4, n.r * s);
    x.beginPath(); x.arc(nx, ny, r, 0, 2 * Math.PI); x.fillStyle = n.type === "elu" ? F_COLORS[fcls(n.e.fraction)] : "#FFFFFF"; x.fill(); x.strokeStyle = n.type === "elu" ? "#FFFFFF" : "#5F6873"; x.lineWidth = 1.5; x.stroke();
    const lbl = n.type === "elu" ? n.label.split(" ").slice(-1)[0] : n.n >= 3 ? n.label.slice(0, 24) : "";
    if (lbl) { x.fillStyle = "#16202A"; x.font = Fnt(n.type === "elu" ? 500 : 700, 20); x.fillText(lbl, nx, ny + r + 20); } }
  x.textAlign = "left"; x.fillStyle = "#5F6873"; x.font = Fnt(500, 28);
  x.fillText("Rouge : mandat rémunéré · pointillé : badge de lobbyiste · couleur : groupe", 60, H - 120);
  x.font = Fnt(500, 30); x.fillText(SITE_URL.replace(/^https?:\/\//, ""), 60, H - 70);
  const blob = await new Promise((r) => c.toBlob(r, "image/png")), f = new File([blob], "reseau.png", { type: "image/png" }), msg = `${NET.titre} : qui est lié à qui au Parlement ? ${SITE_URL}`;
  if (navigator.canShare?.({ files: [f] })) { try { await navigator.share({ files: [f], text: msg }); return; } catch (e) { if (e.name === "AbortError") return; } }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "reseau.png"; a.click(); navigator.clipboard?.writeText(msg).catch(() => {});
}

/* ---------------- Débats ---------------- */
const { API = "", TS_KEY = "" } = window.QF || {};
const DEBAT_TYPES = new Set(["donor", "recip", "elu", "org", "vote", "scrutin", "cantonal"]);
const REF_LABEL = { donor: "Donateur", recip: "Bénéficiaire", elu: "Élu", org: "Organisation", vote: "Votation", scrutin: "Vote au CN", cantonal: "Votation cantonale" };
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* navigation privée */ } } };
let DEVICE;
const device = () => DEVICE ||= store.get("qf-device") || (store.set("qf-device", crypto.randomUUID()), store.get("qf-device")) || crypto.randomUUID();
const dateShort = (s) => (s ? new Date(s.replace(" ", "T") + "Z").toLocaleDateString("fr-CH", { day: "numeric", month: "short", year: "numeric" }) : "");

async function api(path, data) {
  if (!API) throw new Error("les débats ne sont pas encore ouverts");
  const r = await fetch(API + path, data ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : {});
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.erreur || "service indisponible");
  return out;
}
let tsLoad, tsId;
function humanToken() {
  if (!TS_KEY) return Promise.reject(new Error("anti-robot non configuré"));
  tsLoad ||= new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; s.async = true;
    s.onload = () => ok(window.turnstile); s.onerror = () => { tsLoad = null; ko(new Error("anti-robot injoignable")); };
    document.head.append(s);
  });
  return tsLoad.then((ts) => new Promise((ok, ko) => {
    if (tsId != null) ts.remove(tsId);
    tsId = ts.render("#ts-box", { sitekey: TS_KEY, appearance: "interaction-only", callback: ok, "error-callback": () => ko(new Error("vérification anti-robot échouée")) });
  }));
}

function hypoCard(h) {
  const refs = h.refs.map((r) => `<button class="chip ref" data-open="${esc(r.type)}" data-key="${esc(r.key)}"><small>${esc(REF_LABEL[r.type] || r.type)}</small> ${esc(r.label)}</button>`).join("");
  return `<article class="hypo" data-hid="${h.id}">
    <div class="votebox" role="group" aria-label="Voter">
      <button class="vbtn up" data-vote="1" aria-pressed="${h.mon_vote === 1}" aria-label="Hypothèse fondée">▲</button>
      <b class="score">${h.score}</b>
      <button class="vbtn down" data-vote="-1" aria-pressed="${h.mon_vote === -1}" aria-label="Hypothèse pas fondée">▼</button>
    </div>
    <div class="hypo-body"><h3>${esc(h.titre)}</h3>
      <p class="meta">${esc(h.pseudo)}, ${esc(dateShort(h.publie_le))} · <span class="counts">${h.pour} pour, ${h.contre} contre</span> <span class="vmsg" role="status"></span></p>
      <p class="texte">${esc(h.texte)}</p><div class="chips">${refs}</div>
      <button class="link" data-com="${h.id}">${h.n_com ? `${h.n_com} commentaire${h.n_com > 1 ? "s" : ""}` : "Commenter"}</button><div class="coms" hidden></div>
    </div></article>`;
}
async function renderDebats() {
  const box = $("#l-debats");
  if (!API) { box.innerHTML = `<p class="empty">Les débats ouvrent bientôt.</p>`; return; }
  box.innerHTML = `<p class="note">Chargement…</p>`;
  try {
    const { hypotheses } = await api(`/hypotheses?tri=${$("#fdb-tri").value}&d=${device()}`);
    box.innerHTML = hypotheses.map(hypoCard).join("") || `<p class="empty">Aucune hypothèse publiée pour l'instant. Proposez la première !</p>`;
  } catch (e) { box.innerHTML = `<p class="empty">Débats momentanément indisponibles : ${esc(e.message)}.</p>`; }
}
function ficheDebats(type, key) {
  if (!API || !DEBAT_TYPES.has(type)) return;
  const ref = `${type}:${key}`, body = $("#sheet-body");
  body.dataset.ref = ref;
  body.insertAdjacentHTML("beforeend", `<section class="fiche-debats"><h3>Hypothèses sur cette fiche</h3><div class="fd-list"><p class="note">Chargement…</p></div>
    <button class="btn ghost" data-propose="${esc(ref)}">Proposer une hypothèse</button></section>`);
  api(`/hypotheses?ref=${encodeURIComponent(ref)}&d=${device()}`).then(({ hypotheses }) => {
    if (body.dataset.ref !== ref) return;  // une autre fiche a été ouverte entre-temps
    $(".fd-list", body).innerHTML = hypotheses.map(hypoCard).join("") || `<p class="note">Aucune hypothèse publiée sur cette fiche.</p>`;
  }).catch(() => { if (body.dataset.ref === ref) $(".fd-list", body).innerHTML = `<p class="note">Débats momentanément indisponibles.</p>`; });
}

/* Proposer une hypothèse */
let PROP = [];
function refFromKey(ref) {
  const [type, ...rest] = ref.split(":"); const key = rest.join(":");
  const label = { donor: () => idx.donor.get(key)?.nom, recip: () => idx.recip.get(key)?.nom, org: () => idx.org.get(key)?.nom,
    elu: () => idx.elu.get(Number(key))?.nom, vote: () => idx.vote.get(key)?.titre,
    scrutin: () => { const s = PARL?.idx.get(key); return s && scrutinTitre(s); }, cantonal: () => { const x = CANT?.find((c) => c.id === key); return x && `${x.canton} : ${x.titre}`; } }[type]?.();
  return label ? { type, key, label } : null;
}
function searchRefs(q) {
  const t = norm(q).split(" ").filter(Boolean); if (!t.length) return [];
  const pick = (type, arr, key, label, n) => arr.filter((x) => matchAll(x._n, t)).slice(0, n).map((x) => ({ type, key: String(key(x)), label: label(x) }));
  return [...pick("vote", V, (v) => v.id, (v) => v.titre, 3), ...pick("elu", L.elus, (e) => e.id, (e) => e.nom, 3),
    ...pick("donor", [...idx.donor.values()], (g) => g.nom, (g) => g.nom, 3), ...pick("org", [...idx.org.values()], (o) => o.nom, (o) => o.nom, 3),
    ...pick("recip", [...idx.recip.values()], (r) => r.nom, (r) => r.nom, 2),
    ...(PARL ? pick("scrutin", PARL.scrutins, (x) => x[0], scrutinTitre, 3) : []), ...(CANT ? pick("cantonal", CANT, (x) => x.id, (x) => `${x.canton} : ${x.titre}`, 3) : [])];
}
function renderPropRefs() {
  $("#p-refs").innerHTML = PROP.map((r, i) => `<span class="chip ref"><small>${esc(REF_LABEL[r.type])}</small> ${esc(r.label)} <button type="button" class="x" data-delref="${i}" aria-label="Retirer ${esc(r.label)}">×</button></span>`).join("")
    || `<span class="note">Aucune fiche citée pour l'instant.</span>`;
}
function openPropose(pref) {
  PROP = []; const r = pref && refFromKey(pref); if (r) PROP.push(r);
  const body = $("#sheet-body"); delete body.dataset.ref;
  body.innerHTML = `<h2>Proposer une hypothèse</h2>
  <p class="note">Formulez une hypothèse ou une question que les données permettent de discuter, et citez au moins une fiche du site. Tout est relu avant publication : pas d'accusation, pas d'attaque personnelle.</p>
  ${API ? `<form id="f-propose" class="form">
    <label>Pseudo <input name="pseudo" required minlength="2" maxlength="40" autocomplete="nickname" value="${esc(store.get("qf-pseudo") || "")}"></label>
    <label>Hypothèse <input name="titre" required minlength="10" maxlength="140" placeholder="Ex. : les assureurs financent surtout le non aux votations sur la santé"></label>
    <label>Ce que montrent les données <textarea name="texte" required minlength="20" maxlength="2000" rows="6" placeholder="Chiffres, fiches, comparaisons…"></textarea></label>
    <fieldset><legend>Fiches citées (au moins une)</legend><div class="chips" id="p-refs"></div>
      <input id="p-ref-q" type="search" placeholder="Chercher un donateur, un élu, une votation…" autocomplete="off" aria-label="Ajouter une fiche"><div id="p-ref-res" class="ref-res"></div></fieldset>
    <p class="form-msg" id="p-msg" role="status"></p>
    <button class="btn" type="submit">Envoyer pour relecture</button></form>` : `<p class="empty">Les débats ouvrent bientôt.</p>`}`;
  $("#sheet").hidden = false; $(".sheet-panel").scrollTop = 0;
  if (API) renderPropRefs();
}
async function submitPropose(form) {
  const msg = $("#p-msg"), btn = $("button[type=submit]", form), f = new FormData(form);
  if (!PROP.length) { msg.textContent = "Citez au moins une fiche du site."; $("#p-ref-q").focus(); return; }
  btn.disabled = true; msg.textContent = "Vérification…";
  try {
    const turnstile = await humanToken();
    await api("/hypotheses", { pseudo: f.get("pseudo"), titre: f.get("titre"), texte: f.get("texte"), refs: PROP, turnstile });
    store.set("qf-pseudo", f.get("pseudo"));
    form.outerHTML = `<p class="empty">Merci ! Votre hypothèse sera publiée après relecture.</p>`;
  } catch (e) { msg.textContent = `Envoi impossible : ${e.message}.`; btn.disabled = false; }
}

/* Votes et commentaires */
async function castVote(btn) {
  const art = btn.closest(".hypo"), id = art.dataset.hid, v = +btn.dataset.vote;
  const valeur = btn.getAttribute("aria-pressed") === "true" ? 0 : v;
  const btns = art.querySelectorAll(".vbtn"), vmsg = $(".vmsg", art);
  btns.forEach((b) => (b.disabled = true)); vmsg.textContent = "";
  try {
    const r = await api(`/hypotheses/${id}/vote`, { valeur, device: device(), turnstile: await humanToken() });
    $(".score", art).textContent = r.score; $(".counts", art).textContent = `${r.pour} pour, ${r.contre} contre`;
    btns.forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.vote === r.mon_vote)));
  } catch (e) { vmsg.textContent = `Vote impossible : ${e.message}`; }
  btns.forEach((b) => (b.disabled = false));
}
async function toggleComs(btn) {
  const box = btn.nextElementSibling, id = btn.dataset.com;
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false; box.innerHTML = `<p class="note">Chargement…</p>`;
  try {
    const h = await api(`/hypotheses/${id}`);
    box.innerHTML = `<ul class="list">${h.commentaires.map((c) => `<li><span><strong>${esc(c.pseudo)}</strong> <small class="note">${esc(dateShort(c.publie_le))}</small></span><span></span><span class="sub texte">${esc(c.texte)}</span></li>`).join("")}</ul>
      <form class="form f-com" data-hid="${id}"><label>Pseudo <input name="pseudo" required minlength="2" maxlength="40" value="${esc(store.get("qf-pseudo") || "")}"></label>
      <label>Commentaire <textarea name="texte" required minlength="2" maxlength="1000" rows="3"></textarea></label><p class="form-msg" role="status"></p><button class="btn ghost" type="submit">Envoyer pour relecture</button></form>`;
  } catch (e) { box.innerHTML = `<p class="note">Commentaires indisponibles : ${esc(e.message)}.</p>`; }
}
async function submitCom(form) {
  const msg = $(".form-msg", form), btn = $("button[type=submit]", form), f = new FormData(form);
  btn.disabled = true; msg.textContent = "Vérification…";
  try {
    await api(`/hypotheses/${form.dataset.hid}/commentaires`, { pseudo: f.get("pseudo"), texte: f.get("texte"), turnstile: await humanToken() });
    store.set("qf-pseudo", f.get("pseudo"));
    form.outerHTML = `<p class="note">Merci ! Votre commentaire sera publié après relecture.</p>`;
  } catch (e) { msg.textContent = `Envoi impossible : ${e.message}.`; btn.disabled = false; }
}

/* ---------------- Tendances ---------------- */
function renderTrends() {
  if (!$("#ft-an")) {
    $("#f-trend").innerHTML = select("ft-an", "Année des dons", uniq(A.dons.map((x) => x.annee)).sort().reverse(), "Toutes");
    $("#ft-an").addEventListener("input", renderTrends);
  }
  const an = $("#ft-an").value;
  const dons = A.dons.filter((d) => !an || String(d.annee) === an);
  const agg = (arr, k) => { const m = {}; arr.forEach((d) => { const key = k(d); if (key) m[key] = (m[key] || 0) + (d.montant || 0); }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const cards = [];

  cards.push(card("Plus gros donateurs", "Total des dons déclarés. Cliquez un nom pour voir le détail.",
    bars(agg(dons, (d) => d.donateur).slice(0, 15).map(([k, v]) => ({ label: k, value: v, open: ["donor", k] })), "m")));
  cards.push(card("D'où vient l'argent", "Dons par secteur du donateur (classement automatique, voir config/secteurs.csv).",
    bars(agg(dons, (d) => d.secteur).map(([k, v]) => ({ label: k, value: v })), "m")));
  cards.push(card("Qui reçoit : partis", "Dons reçus par les partis et leurs sections, élections comprises.",
    bars(agg(dons, (d) => d.parti).map(([k, v]) => ({ label: k, value: v })), "m")));

  const votes = {}; A.campagnes.filter((c) => c.cat === "Votation" && (!an || String(c.annee) === an)).forEach((c) => {
    const v = votes[c.evt] || (votes[c.evt] = { Pour: 0, Contre: 0, annee: c.annee }); if (c.camp) v[c.camp] += c.total || 0; });
  const vlist = Object.entries(votes).sort((a, b) => (b[1].annee || 0) - (a[1].annee || 0) || (b[1].Pour + b[1].Contre) - (a[1].Pour + a[1].Contre));
  const vmax = Math.max(1, ...vlist.map(([, v]) => Math.max(v.Pour, v.Contre)));
  cards.push(card("Votations : budget du oui contre budget du non", "Recettes déclarées par les comités de campagne de chaque camp.",
    `<div class="legend"><span><i style="background:var(--infl)"></i>Pour</span><span><i style="background:var(--money)"></i>Contre</span></div>
     <div class="diverge">${vlist.map(([k, v]) => `<div class="dv-row"><span>${idx.voteEvt.has(k) ? linkBtn("vote", idx.voteEvt.get(k).id, idx.voteEvt.get(k).titre) : esc(k.replace(/^\d\d\.\d\d\.\d{4}\s*/, ""))} <small class="note">${v.annee ?? ""}</small></span>
     <div class="dv-bars"><span class="l"><span style="width:${(100 * v.Pour / vmax).toFixed(1)}%"></span></span><span class="r"><span style="width:${(100 * v.Contre / vmax).toFixed(1)}%"></span></span></div>
     <div class="dv-vals"><span>${short(v.Pour)}</span><span>${short(v.Contre)}</span></div></div>`).join("") || "<p class='note'>Aucune votation pour cette année.</p>"}</div>`, true));

  const sect = {}; L.liens.forEach((l) => { const s = sect[l.secteur] || (sect[l.secteur] = { p: 0, o: 0 }); l.statut === "remunere" ? s.p++ : s.o++; });
  cards.push(card("Secteurs les plus présents au Parlement", "Nombre de mandats en cours. Partie foncée : mandats rémunérés.",
    bars(Object.entries(sect).sort((a, b) => (b[1].p + b[1].o) - (a[1].p + a[1].o)).slice(0, 15).map(([k, v]) => ({ label: k, value: v.p, value2: v.o })), "i", (v) => v)));
  const parts = {}; L.elus.forEach((e) => { const p = parts[e.parti] || (parts[e.parti] = { elus: 0, n: 0, paid: 0 }); p.elus++; p.n += e.liens.length; p.paid += e.liens.filter((l) => l.statut === "remunere").length; });
  cards.push(card("Mandats rémunérés par élu, selon le parti", "Moyenne par parlementaire. Partie claire : mandats bénévoles ou non communiqués.",
    bars(Object.entries(parts).filter(([, p]) => p.elus >= 2).map(([k, p]) => ({ label: `${k} (${p.elus})`, value: p.paid / p.elus, value2: (p.n - p.paid) / p.elus })).sort((a, b) => b.value - a.value), "i", (v) => v.toFixed(1))));
  const topElus = [...L.elus].sort((a, b) => b.liens.length - a.liens.length).slice(0, 15);
  cards.push(card("Élus avec le plus de mandats", "", bars(topElus.map((e) => ({ label: `${e.nom} (${e.parti})`, value: e.liens.filter((l) => l.statut === "remunere").length, value2: e.liens.filter((l) => l.statut !== "remunere").length, open: ["elu", e.id] })), "i", (v) => v)));
  cards.push(card("Évolution semaine après semaine", "Un point par mise à jour automatique.", timeline(), true));
  $("#charts").innerHTML = cards.join("");
}
function card(title, hint, body, wide) { return `<div class="card${wide ? " wide" : ""}"><h3>${esc(title)}</h3>${hint ? `<p class="hint">${esc(hint)}</p>` : ""}${body}</div>`; }
function timeline() {
  const pts = T.filter((r) => r.mandats_n !== "" || r.dons_n !== "");
  if (pts.length < 2) return `<p class="note">La courbe se remplira à partir de la deuxième mise à jour hebdomadaire.</p>`;
  const W = 640, H = 180, P = 30;
  const line = (key, color) => { const v = pts.map((r) => +r[key] || 0), mx = Math.max(...v), mn = Math.min(...v), span = mx - mn || 1;
    const d = v.map((y, i) => `${i ? "L" : "M"}${(P + i * (W - 2 * P) / (v.length - 1)).toFixed(1)},${(H - P - (y - mn) * (H - 2 * P) / span).toFixed(1)}`).join("");
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.5"/>`; };
  return `<div class="legend"><span><i style="background:var(--money)"></i>Nombre de dons publiés</span><span><i style="background:var(--infl)"></i>Mandats en cours</span></div>
  <svg class="line" viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution hebdomadaire">${line("dons_n", "var(--money)")}${line("mandats_n", "var(--infl)")}
  <text x="${P}" y="${H - 6}" font-size="12" fill="currentColor">${esc(pts[0].date)}</text><text x="${W - P}" y="${H - 6}" font-size="12" text-anchor="end" fill="currentColor">${esc(pts.at(-1).date)}</text></svg>`;
}

/* ---------------- Nouveautés ---------------- */
function renderNews() {
  if (!C.length) { $("#news").innerHTML = `<p class="empty">Les nouveautés apparaîtront après la prochaine mise à jour : chaque semaine, le site compare les registres avec la version précédente.</p>`; return; }
  $("#news").innerHTML = C.map((w) => {
    const dn = w.dons_nouveaux || [], mn = w.mandats_nouveaux || [], mt = w.mandats_termines || [];
    const elu = (p) => idx.elu.get(p)?.nom || "?";
    return `<div class="week"><h3>Semaine du ${esc(new Date(w.date).toLocaleDateString("fr-CH", { day: "numeric", month: "long", year: "numeric" }))}</h3>
    ${dn.length ? `<p><strong class="money">${dn.length} nouveaux dons</strong>, ${chf(sum(dn, (d) => d.montant))}</p><ul>${dn.slice(0, 15).map((d) => `<li>${linkBtn("donor", d.donateur, d.donateur)} donne ${chf(d.montant)} à ${esc(d.beneficiaire)}</li>`).join("")}</ul>` : ""}
    ${mn.length ? `<p><strong class="infl">${mn.length} nouveaux mandats</strong></p><ul>${mn.slice(0, 15).map((l) => `<li>${linkBtn("elu", l.p, elu(l.p))} entre chez ${linkBtn("org", l.org, l.org)} (${esc(l.secteur)})</li>`).join("")}</ul>` : ""}
    ${mt.length ? `<p><strong>${mt.length} mandats terminés</strong></p><ul>${mt.slice(0, 10).map((l) => `<li>${esc(elu(l.p))} quitte ${esc(l.org)}</li>`).join("")}</ul>` : ""}</div>`;
  }).join("");
}

/* ---------------- Démarrage ---------------- */
function status() {
  const s = M.sources || {}, d = M.genere ? new Date(M.genere).toLocaleDateString("fr-CH", { day: "numeric", month: "long", year: "numeric" }) : "?";
  const bad = Object.entries(s).filter(([, v]) => v.statut && v.statut !== "ok");
  $("#status").innerHTML = `Mis à jour le ${esc(d)}. ${nf.format(A.dons.length)} dons, ${nf.format(L.elus.length)} élus, ${nf.format(L.liens.length)} mandats.` +
    (bad.length ? ` <span class="warn">Dernière collecte en échec pour ${bad.map(([k]) => ({ efk: "le CDF", lobbywatch: "Lobbywatch", swissvotes: "les votations" }[k] || k)).join(" et ")} : données de la semaine précédente affichées.</span>` : "");
}
function suggestions() {
  const donors = [...idx.donor.values()].sort((a, b) => b.total - a.total).slice(0, 4).map((g) => g.nom);
  const elus = [...L.elus].sort((a, b) => b.liens.length - a.liens.length).slice(0, 2).map((e) => e.nom.split(" ").at(-1));
  $("#suggest").innerHTML = [...donors, ...elus, "assurance", "banque"].map((s) => `<button class="chip" data-q="${esc(s)}">${esc(s)}</button>`).join("");
}

document.addEventListener("click", (ev) => {
  const o = ev.target.closest("[data-open]"); if (o) { ev.preventDefault(); openSheet(o.dataset.open, o.dataset.key); return; }
  if (ev.target.closest("[data-close]")) { closeSheet(); return; }
  const q = ev.target.closest("[data-q]"); if (q) { $("#q").value = q.dataset.q; search(); return; }
  const dq = ev.target.closest("[data-dons-q]"); if (dq) { location.hash = "#dons"; $("#fd-q").value = dq.dataset.donsQ; renderDons(); return; }
  const nn = ev.target.closest("[data-net]"); if (nn) { netSelect(nn.dataset.net); return; }
  const nf = ev.target.closest("[data-net-focus]"); if (nf) { netFocus(nf.dataset.netFocus); return; }
  const zb = ev.target.closest("[data-zoom]"); if (zb) { const n = $("svg.net")?._net; if (n) zb.dataset.zoom === "reset" ? n.reset() : n.zoom(zb.dataset.zoom === "in" ? 1.4 : 1 / 1.4); return; }
  const sh = ev.target.closest("[data-share]"); if (sh) { SHARES.get(sh.dataset.share)?.(); return; }
  const rs = ev.target.closest("[data-restart]"); if (rs) { ev.preventDefault(); renderJouer("match"); return; }
  const pr = ev.target.closest("[data-propose]"); if (pr) { openPropose(pr.dataset.propose); return; }
  const vb = ev.target.closest("[data-vote]"); if (vb) { castVote(vb); return; }
  const cm = ev.target.closest("[data-com]"); if (cm) { toggleComs(cm); return; }
  const ar = ev.target.closest("[data-addref]"); if (ar) { const r = refFromKey(ar.dataset.addref); if (r && PROP.length < 6 && !PROP.some((x) => x.type === r.type && x.key === r.key)) PROP.push(r); renderPropRefs(); $("#p-ref-q").value = ""; $("#p-ref-res").innerHTML = ""; $("#p-ref-q").focus(); return; }
  const dr = ev.target.closest("[data-delref]"); if (dr) { PROP.splice(+dr.dataset.delref, 1); renderPropRefs(); return; }
  const s = ev.target.closest("[data-sort]"); if (s) { const [t, k] = s.dataset.sort.split(":"); const st = state[t]; st.dir = st.sort === k ? -st.dir : -1; st.sort = k; st.page = 0; (t === "dons" ? renderDons : renderParl)(); }
});
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeSheet(); if (ev.key === "Enter" && ev.target.dataset?.net) netSelect(ev.target.dataset.net); });
document.addEventListener("submit", (ev) => {
  if (ev.target.id === "f-propose") { ev.preventDefault(); submitPropose(ev.target); }
  else if (ev.target.classList.contains("f-com")) { ev.preventDefault(); submitCom(ev.target); }
});
document.addEventListener("input", (ev) => {
  if (ev.target.id === "sc-groupe") { focusScrutin(ev.target.value); return; }
  if (ev.target.id === "fv-niveau") { const c = ev.target.value === "cantonal"; $("#f-votes").hidden = c; $("#f-cant").hidden = !c; renderVotes(); return; }
  if (ev.target.id !== "p-ref-q") return;
  $("#p-ref-res").innerHTML = searchRefs(ev.target.value).map((r) => `<button type="button" class="ref-hit" data-addref="${esc(r.type)}:${esc(r.key)}"><small>${esc(REF_LABEL[r.type])}</small> ${esc(r.label)}</button>`).join("");
});

(async function init() {
  [M, A, L, C, T, V] = await Promise.all([getJSON("meta", {}), getJSON("argent", { dons: [], campagnes: [] }), getJSON("lobby", { elus: [], liens: [], badges: [] }), getJSON("changes", []), getJSON("timeline", []), getJSON("votations", [])]);
  buildIndexes(); status(); suggestions(); renderUne(); setupDons(); setupVotes(); setupParl(); renderHemis(); renderNews();
  $("#fdb-tri").addEventListener("input", renderDebats);
  if (!API) $('.tabs a[data-tab="debats"]').hidden = true;  // onglet masqué tant que l'API n'est pas configurée (site/config.js)
  let timer; $("#q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 120); });
  window.addEventListener("hashchange", route); route();
})();
