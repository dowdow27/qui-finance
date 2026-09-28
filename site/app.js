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

let M = {}, A = { dons: [], campagnes: [] }, L = { elus: [], liens: [], badges: [] }, C = [], T = [];
const idx = { elu: new Map(), donor: new Map(), recip: new Map(), org: new Map(), orgNorm: new Map(), donorNorm: new Map() };

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
const TABS = ["chercher", "dons", "parlement", "tendances", "nouveautes"];
function route() {
  const [tab, q] = decodeURIComponent(location.hash.slice(1)).split(":");
  const t = TABS.includes(tab) ? tab : "chercher";
  for (const x of TABS) $(`#tab-${x}`).hidden = x !== t;
  document.querySelectorAll(".tabs a").forEach((a) => (a.dataset.tab === t ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  document.querySelector(`.tabs a[data-tab="${t}"]`)?.scrollIntoView({ inline: "center", block: "nearest" });
  if (t === "chercher" && q != null && $("#q").value !== q) { $("#q").value = q; search(); }
  if (t === "tendances") renderTrends();
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
  const badges = L.badges.filter((b) => matchAll(norm(b.nom + " " + b.fonction + " " + b.mandats.join(" ")), tokens));

  if (donors.length) groups.push(group("Donateurs", donors.length, donors.slice(0, 8).map((g) =>
    hit("m", "donor", g.nom, chf(g.total), `${g.dons.length} don${g.dons.length > 1 ? "s" : ""}. ${g.secteur}${g.lieu ? ". " + g.lieu : ""}`)), donors.length > 8 && `#dons`, raw));
  if (recips.length) groups.push(group("Bénéficiaires (partis, comités, candidats)", recips.length, recips.slice(0, 8).map((r) =>
    hit("m", "recip", r.nom, chf(r.total), `${r.dons.length} don${r.dons.length > 1 ? "s" : ""} reçus${r.parti ? ". " + r.parti : ""}`))));
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
  if (!html) return;
  body.innerHTML = html; $("#sheet").hidden = false; $(".sheet-panel").scrollTop = 0; $(".close").focus();
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
  return `<h2>${esc(e.nom)}</h2><p class="note">${esc(e.parti)}, ${esc(e.canton)}, ${esc(e.conseil)}${e.profession ? ". " + esc(e.profession) : ""}${e.commissions ? `. Commissions : ${esc(e.commissions)}` : ""}</p>
  <div class="kpis">${kpi(e.liens.length, "mandats en cours", "infl")}${kpi(paid.length, "rémunérés")}${kpi(known ? chf(known) : "–", "montants communiqués / an")}</div>
  <section><h3>Secteurs</h3>${bars(Object.entries(sect).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v })), "i", (v) => v)}</section>
  <section><h3>Mandats</h3><ul class="list">${[...e.liens].sort((a, b) => (b.statut === "remunere") - (a.statut === "remunere") || (b.montant || 0) - (a.montant || 0)).map((l) =>
    `<li><span>${linkBtn("org", l.org, l.org)}</span><span class="tag ${l.statut === "remunere" ? "paid" : ""}">${l.montant ? chf(l.montant) : STATUT[l.statut]}</span>
     <span class="sub">${esc(ROLE[l.role] || l.role)}${l.fonction ? ", " + esc(FUNC[l.fonction] || l.fonction) : ""}. ${esc(l.secteur)}${l.principal ? ". Activité principale" : ""}</span></li>`).join("") || "<li>Aucun mandat déclaré.</li>"}</ul></section>
  ${e.badges.length ? `<section><h3>Badges d'accès donnés</h3><ul class="list">${e.badges.map((b) => `<li><span>${esc(b.nom)}</span><span></span><span class="sub">${esc(b.fonction)}${b.mandats.length ? ". " + esc(b.mandats.join(", ")) : ""}</span></li>`).join("")}</ul></section>` : ""}
  <p><a href="${esc(e.url)}" target="_blank" rel="noopener">Fiche complète sur Lobbywatch</a></p>`;
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
    row = (x) => `<tr class="click" data-open="elu" data-key="${x.e.id}"><td><strong>${esc(x.e.nom)}</strong><br><small>${esc(x.e.conseil)}</small></td><td>${esc(x.e.parti)}</td><td class="hide-s">${esc(x.e.canton)}</td><td class="num infl"><strong>${x.n}</strong></td><td class="num">${x.paid}</td><td class="hide-s">${esc(x.top)}</td></tr>`;
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
     <div class="diverge">${vlist.map(([k, v]) => `<div class="dv-row"><span>${esc(k.replace(/^\d\d\.\d\d\.\d{4}\s*/, ""))} <small class="note">${v.annee ?? ""}</small></span>
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
    (bad.length ? ` <span class="warn">Dernière collecte en échec pour ${bad.map(([k]) => (k === "efk" ? "le CDF" : "Lobbywatch")).join(" et ")} : données de la semaine précédente affichées.</span>` : "");
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
  const s = ev.target.closest("[data-sort]"); if (s) { const [t, k] = s.dataset.sort.split(":"); const st = state[t]; st.dir = st.sort === k ? -st.dir : -1; st.sort = k; st.page = 0; (t === "dons" ? renderDons : renderParl)(); }
});
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeSheet(); });

(async function init() {
  [M, A, L, C, T] = await Promise.all([getJSON("meta", {}), getJSON("argent", { dons: [], campagnes: [] }), getJSON("lobby", { elus: [], liens: [], badges: [] }), getJSON("changes", []), getJSON("timeline", [])]);
  buildIndexes(); status(); suggestions(); setupDons(); setupParl(); renderNews();
  let timer; $("#q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 120); });
  window.addEventListener("hashchange", route); route();
})();
