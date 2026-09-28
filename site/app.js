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
const TABS = ["chercher", "dons", "votations", "parlement", "tendances", "debats", "nouveautes"];
function route() {
  const [tab, q] = decodeURIComponent(location.hash.slice(1)).split(":");
  const t = TABS.includes(tab) ? tab : "chercher";
  for (const x of TABS) $(`#tab-${x}`).hidden = x !== t;
  document.querySelectorAll(".tabs a").forEach((a) => (a.dataset.tab === t ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  document.querySelector(`.tabs a[data-tab="${t}"]`)?.scrollIntoView({ inline: "center", block: "nearest" });
  if (t === "chercher" && q != null && $("#q").value !== q) { $("#q").value = q; search(); }
  if (t === "tendances") renderTrends();
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
  return `<ul class="list">${[...ds].sort((a, b) => (b.montant || 0) - (a.montant || 0)).map((d) =>
    `<li><span>${who === "recip" ? linkBtn("recip", d.beneficiaire, d.beneficiaire) : linkBtn("donor", d.donateur, d.donateur)}</span><span class="amount money">${chf(d.montant)}</span>
     <span class="sub">${esc(d.cat)}${d.camp ? ` (${d.camp.toLowerCase()})` : ""}. ${esc(d.evt)}${d.budget ? ". Budget, décompte final pas encore publié" : ""}${d.nature && d.nature !== "Monétaire" ? ". " + esc(d.nature) : ""}</span></li>`).join("")}</ul>`;
}
function sheetDonor(g) {
  if (!g) return "";
  const org = idx.orgNorm.get(norm(g.nom, true));
  const parties = {}; g.dons.forEach((d) => { const k = d.parti || (d.cat === "Votation" ? `Votations (${d.camp || "?"})` : "Autres"); parties[k] = (parties[k] || 0) + (d.montant || 0); });
  const split = Object.entries(parties).sort((a, b) => b[1] - a[1]);
  return `<h2>${esc(g.nom)}</h2><p class="note">${esc(g.type)}. ${esc(g.secteur)}${g.lieu ? ". " + esc(g.lieu) : ""}</p>
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
  <section><h3>Mandats</h3><ul class="list">${[...e.liens].sort((a, b) => (b.statut === "remunere") - (a.statut === "remunere") || (b.montant || 0) - (a.montant || 0)).map((l) =>
    `<li><span>${linkBtn("org", l.org, l.org)}</span><span class="tag ${l.statut === "remunere" ? "paid" : ""}">${l.montant ? chf(l.montant) : STATUT[l.statut]}</span>
     <span class="sub">${esc(ROLE[l.role] || l.role)}${l.fonction ? ", " + esc(FUNC[l.fonction] || l.fonction) : ""}. ${esc(l.secteur)}${l.principal ? ". Activité principale" : ""}</span></li>`).join("") || "<li>Aucun mandat déclaré.</li>"}</ul></section>
  ${e.conseil === "CN" ? `<section><h3>Votes au Conseil national</h3><div id="elu-votes"><p class="note">Chargement…</p></div></section>` : ""}
  ${e.badges.length ? `<section><h3>Badges d'accès donnés</h3><ul class="list">${e.badges.map((b) => `<li><span>${esc(b.nom)}</span><span></span><span class="sub">${esc(b.fonction)}${b.mandats.length ? ". " + esc(b.mandats.join(", ")) : ""}</span></li>`).join("")}</ul></section>` : ""}
  <p>${e.parlement ? `<a href="${esc(e.parlement)}" target="_blank" rel="noopener">Fiche officielle sur parlament.ch</a> · ` : ""}<a href="${esc(e.url)}" target="_blank" rel="noopener">Fiche complète sur Lobbywatch</a></p>`;
}
function sheetOrg(o) {
  if (!o) return "";
  const donor = idx.donorNorm.get(norm(o.nom, true));
  return `<h2>${esc(o.nom)}</h2><p class="note">${esc(o.groupe)}. ${esc(o.secteur)}</p>
  <div class="kpis">${kpi(uniq(o.liens.map((l) => l.p)).length, "élus liés", "infl")}${kpi(o.liens.filter((l) => l.statut === "remunere").length, "mandats rémunérés")}${donor ? kpi(chf(donor.total), "dons déclarés", "money") : ""}</div>
  <section><h3>Parlementaires liés</h3><ul class="list">${o.liens.map((l) => { const e = idx.elu.get(l.p); return e ? `<li><span>${linkBtn("elu", e.id, e.nom)}</span><span class="tag ${l.statut === "remunere" ? "paid" : ""}">${l.montant ? chf(l.montant) : STATUT[l.statut]}</span><span class="sub">${esc(e.parti)}, ${esc(e.canton)}. ${esc(ROLE[l.role] || l.role)}${l.fonction ? ", " + esc(FUNC[l.fonction] || l.fonction) : ""}</span></li>` : ""; }).join("")}</ul></section>
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
const DECI = { o: ["Oui", "var(--yes)"], n: ["Non", "var(--no)"], a: ["Abstention", "var(--abst)"], "-": ["Absent·e", "var(--absent)"], p: ["Préside", "var(--absent)"] };
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
const scrutinTitre = (s) => `${s[3]}${s[5] ? ` (${s[5]})` : ""}`;
function tally(s) { const c = { o: 0, n: 0, a: 0, "-": 0 }; for (const ch of s[8]) if (ch in c) c[ch]++; return c; }

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
  PARL.membres.forEach((m, i) => { const d = s[8][i]; if (!d || d === " ") return; const g = groupes[m[2] || "?"] ||= { o: 0, n: 0, a: 0, "-": 0 }; if (d in g) g[d]++; });
  const GLAB = Object.fromEntries(FRACTIONS);
  const options = Object.entries(PARL.interets_membres).sort((a, b) => a[0].localeCompare(b[0]));
  return `<h2>${esc(s[3])}</h2><p class="note">Conseil national, ${esc(dateFr(s[1]))}. Objet ${esc(s[2])}${s[4] ? ` : ${esc(s[4])}` : ""}${s[5] ? `. ${esc(s[5])}` : ""}</p>
  <ul class="list"><li><span><b class="infl">Oui</b> : ${esc(s[6] || "–")}</span><span></span></li><li><span><b class="money">Non</b> : ${esc(s[7] || "–")}</span><span></span></li></ul>
  <div class="kpis">${kpi(c.o, "oui", "infl")}${kpi(c.n, "non", "money")}${kpi(c.a, "abstentions")}${kpi(c["-"], "absent·e·s")}</div>
  <section><h3>Qui a voté quoi</h3><div id="sc-hemi" data-id="${esc(String(id))}">${hemiScrutin(s)}</div>
    <div class="filters"><select id="sc-groupe" aria-label="Mettre en évidence un groupe d'intérêts"><option value="">Mettre en évidence : les élus liés à…</option>${options.map(([g]) => `<option>${esc(g)}</option>`).join("")}</select></div>
    <p class="summary" id="sc-ecart"></p></section>
  <section><h3>Par groupe parlementaire</h3><div class="table-wrap"><table><thead><tr><th>Groupe</th><th class="num">Oui</th><th class="num">Non</th><th class="num">Abst.</th><th class="num">Abs.</th></tr></thead>
    <tbody>${Object.entries(groupes).sort((a, b) => (b[1].o + b[1].n) - (a[1].o + a[1].n)).map(([g, v]) => `<tr><td>${esc(GLAB[g] || g)}</td><td class="num infl">${v.o}</td><td class="num money">${v.n}</td><td class="num">${v.a}</td><td class="num">${v["-"]}</td></tr>`).join("")}</tbody></table></div></section>
  ${url ? `<p><a href="${esc(url)}" target="_blank" rel="noopener">Dossier de l'objet sur parlament.ch</a></p>` : ""}`;
}
function hemiScrutin(s, focus) {
  const set = focus ? new Set(PARL.interets_membres[focus] || []) : null;
  const paint = (e) => { const d = decision(s, e.pn); const [lbl, col] = DECI[d] || ["Pas en fonction", "none"];
    return { fill: col, dim: set && !set.has(e.pn), title: lbl }; };
  const c = tally(s);
  return hemicycle("CN", 200, 8, paint, `<div class="legend wrap-l">${["o", "n", "a", "-"].map((k) => `<span><i style="background:${DECI[k][1]}"></i>${DECI[k][0]} <b>${c[k]}</b></span>`).join("")}</div>`);
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
  box.innerHTML = `<div class="kpis">${kpi(st.participation != null ? pct(st.participation) : "–", "participation aux votes")}${kpi(nf.format(st.contre_groupe), "votes contre la majorité de son groupe")}</div>
  ${st.recents.length ? `<p class="note">Derniers votes contre son groupe :</p><ul class="list">${st.recents.map((id) => { const s = p.idx.get(String(id)); return s ? `<li><span>${linkBtn("scrutin", id, scrutinTitre(s))}</span><span class="tag">${esc(DECI[decision(s, e.pn)]?.[0] || "")}</span><span class="sub">${esc(dateFr(s[1]))} · ${esc(s[2])}</span></li>` : ""; }).join("")}</ul>` : ""}`;
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
  const pr = ev.target.closest("[data-propose]"); if (pr) { openPropose(pr.dataset.propose); return; }
  const vb = ev.target.closest("[data-vote]"); if (vb) { castVote(vb); return; }
  const cm = ev.target.closest("[data-com]"); if (cm) { toggleComs(cm); return; }
  const ar = ev.target.closest("[data-addref]"); if (ar) { const r = refFromKey(ar.dataset.addref); if (r && PROP.length < 6 && !PROP.some((x) => x.type === r.type && x.key === r.key)) PROP.push(r); renderPropRefs(); $("#p-ref-q").value = ""; $("#p-ref-res").innerHTML = ""; $("#p-ref-q").focus(); return; }
  const dr = ev.target.closest("[data-delref]"); if (dr) { PROP.splice(+dr.dataset.delref, 1); renderPropRefs(); return; }
  const s = ev.target.closest("[data-sort]"); if (s) { const [t, k] = s.dataset.sort.split(":"); const st = state[t]; st.dir = st.sort === k ? -st.dir : -1; st.sort = k; st.page = 0; (t === "dons" ? renderDons : renderParl)(); }
});
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeSheet(); });
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
  buildIndexes(); status(); suggestions(); setupDons(); setupVotes(); setupParl(); renderHemis(); renderNews();
  $("#fdb-tri").addEventListener("input", renderDebats);
  if (!API) $('.tabs a[data-tab="debats"]').hidden = true;  // onglet masqué tant que l'API n'est pas configurée (site/config.js)
  let timer; $("#q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 120); });
  window.addEventListener("hashchange", route); route();
})();
