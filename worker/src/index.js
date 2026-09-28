/* API des débats de « Qui finance ? » — Cloudflare Worker + D1, aucune dépendance.
   Tout ce qui est proposé attend une validation avant publication (page site/admin.html). */

const ORIGINS = ["https://dowdow27.github.io", "http://localhost:8000"];
const REF_TYPES = new Set(["donor", "recip", "elu", "org", "vote", "scrutin", "cantonal", "classement"]);
const MAX = { pseudo: 40, titre: 140, texte: 2000, commentaire: 1000, refs: 6, postsParJour: 5, votantsParIp: 5 };

const fail = (status, message) => Object.assign(new Error(message), { status });
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ORIGINS.includes(origin) ? origin : ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
    let res;
    if (req.method === "OPTIONS") res = new Response(null, { status: 204 });
    else {
      try { res = await route(req, env); }
      catch (e) {
        if (!e.status) console.error(e);
        res = json({ erreur: e.status ? e.message : "Erreur interne" }, e.status || 500);
      }
    }
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
};

async function route(req, env) {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const m = req.method;
  let r;
  if (p === "/hypotheses" && m === "GET") return listHypotheses(env, url);
  if (p === "/hypotheses" && m === "POST") return createHypothese(req, env);
  if ((r = p.match(/^\/hypotheses\/(\d+)$/)) && m === "GET") return getHypothese(env, +r[1]);
  if ((r = p.match(/^\/hypotheses\/(\d+)\/commentaires$/)) && m === "POST") return createCommentaire(req, env, +r[1]);
  if ((r = p.match(/^\/hypotheses\/(\d+)\/vote$/)) && m === "POST") return vote(req, env, +r[1]);
  if ((r = p.match(/^\/sondages\/([a-z0-9-]{3,40})$/)) && m === "GET") return getSondage(env, r[1], url);
  if ((r = p.match(/^\/sondages\/([a-z0-9-]{3,40})\/vote$/)) && m === "POST") return voteSondage(req, env, r[1]);
  if (p === "/confiance" && m === "GET") return getConfiance(env, url);
  if ((r = p.match(/^\/confiance\/(\d{1,6})\/vote$/)) && m === "POST") return voteConfiance(req, env, +r[1]);
  if (p === "/clics" && m === "GET") return getClics(env);
  if (p === "/clics" && m === "POST") return addClic(req, env);
  if (p.startsWith("/admin/")) {
    checkAdmin(req, env);
    if (p === "/admin/file" && m === "GET") return adminFile(env);
    if ((r = p.match(/^\/admin\/(hypotheses|commentaires)\/(\d+)$/)) && m === "POST") return adminAction(req, env, r[1], +r[2]);
  }
  throw fail(404, "Introuvable");
}

/* ---------------- Utilitaires ---------------- */

async function sha(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const ip = (req) => req.headers.get("CF-Connecting-IP") || "local";
const ipHash = (req, env) => sha(`${env.HASH_SALT}|ip|${ip(req)}`);

async function body(req) {
  try { return await req.json(); } catch { throw fail(400, "Requête invalide"); }
}
// Texte brut : on retire les caractères de contrôle et on borne la longueur. L'échappement HTML se fait à l'affichage.
function text(v, min, max, label) {
  const s = String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (s.length < min) throw fail(400, `${label} : ${min} caractères minimum`);
  if (s.length > max) throw fail(400, `${label} : ${max} caractères maximum`);
  return s;
}

async function human(req, env, token) {
  if (!env.TURNSTILE_SECRET) throw fail(503, "Anti-robot non configuré");
  if (!token) throw fail(403, "Vérification anti-robot manquante");
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", String(token));
  form.append("remoteip", ip(req));
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const out = await r.json().catch(() => ({}));
  if (!out.success) throw fail(403, "Vérification anti-robot échouée, réessayez");
}

async function rateLimit(env, auteur) {
  const q = `SELECT (SELECT COUNT(*) FROM hypotheses WHERE auteur_hash = ?1 AND cree_le > datetime('now', '-1 day'))
           + (SELECT COUNT(*) FROM commentaires WHERE auteur_hash = ?1 AND cree_le > datetime('now', '-1 day')) AS n`;
  const { n } = await env.DB.prepare(q).bind(auteur).first();
  if (n >= MAX.postsParJour) throw fail(429, `Limite de ${MAX.postsParJour} contributions par jour atteinte`);
}

async function published(env, id) {
  const h = await env.DB.prepare("SELECT id FROM hypotheses WHERE id = ? AND statut = 'publie'").bind(id).first();
  if (!h) throw fail(404, "Hypothèse introuvable");
}

/* ---------------- Public ---------------- */

const SCORE = `
  COALESCE((SELECT SUM(valeur) FROM votes v WHERE v.hypothese_id = h.id), 0) AS score,
  (SELECT COUNT(*) FROM votes v WHERE v.hypothese_id = h.id AND v.valeur = 1) AS pour,
  (SELECT COUNT(*) FROM votes v WHERE v.hypothese_id = h.id AND v.valeur = -1) AS contre,
  (SELECT COUNT(*) FROM commentaires c WHERE c.hypothese_id = h.id AND c.statut = 'publie') AS n_com`;

const parseRefs = (rows) => rows.map((h) => ({ ...h, refs: JSON.parse(h.refs) }));

async function listHypotheses(env, url) {
  const device = url.searchParams.get("d") || "";
  const votant = /^[\w-]{16,64}$/.test(device) ? await sha(`${env.HASH_SALT}|device|${device}`) : "";
  const [type, ...rest] = (url.searchParams.get("ref") || "").split(":");
  const key = rest.join(":");
  const byRef = REF_TYPES.has(type) && key;
  const order = url.searchParams.get("tri") === "recent" ? "h.publie_le DESC" : "score DESC, h.publie_le DESC";
  const q = `SELECT h.id, h.pseudo, h.titre, h.texte, h.refs, h.publie_le, ${SCORE},
      (SELECT valeur FROM votes v WHERE v.hypothese_id = h.id AND v.votant_hash = ?1) AS mon_vote
    FROM hypotheses h WHERE h.statut = 'publie'
    ${byRef ? "AND EXISTS (SELECT 1 FROM json_each(h.refs) j WHERE json_extract(j.value, '$.type') = ?2 AND json_extract(j.value, '$.key') = ?3)" : ""}
    ORDER BY ${order} LIMIT 200`;
  const stmt = env.DB.prepare(q);
  const { results } = await (byRef ? stmt.bind(votant, type, key) : stmt.bind(votant)).all();
  return json({ hypotheses: parseRefs(results) });
}

async function getHypothese(env, id) {
  const h = await env.DB.prepare(`SELECT h.id, h.pseudo, h.titre, h.texte, h.refs, h.publie_le, ${SCORE} FROM hypotheses h WHERE h.id = ? AND h.statut = 'publie'`).bind(id).first();
  if (!h) throw fail(404, "Hypothèse introuvable");
  const { results } = await env.DB.prepare("SELECT id, pseudo, texte, publie_le FROM commentaires WHERE hypothese_id = ? AND statut = 'publie' ORDER BY publie_le").bind(id).all();
  return json({ ...parseRefs([h])[0], commentaires: results });
}

async function createHypothese(req, env) {
  const b = await body(req);
  const pseudo = text(b.pseudo, 2, MAX.pseudo, "Pseudo");
  const titre = text(b.titre, 10, MAX.titre, "Titre");
  const texte = text(b.texte, 20, MAX.texte, "Texte");
  const refs = (Array.isArray(b.refs) ? b.refs : []).slice(0, MAX.refs + 1).map((r) => ({
    type: String(r?.type || ""), key: text(r?.key, 1, 200, "Référence"), label: text(r?.label, 1, 200, "Référence"),
  }));
  if (!refs.length) throw fail(400, "Citez au moins une fiche du site (donateur, élu, organisation, votation…)");
  if (refs.length > MAX.refs) throw fail(400, `${MAX.refs} références au maximum`);
  if (refs.some((r) => !REF_TYPES.has(r.type))) throw fail(400, "Référence invalide");
  await human(req, env, b.turnstile);
  const auteur = await ipHash(req, env);
  await rateLimit(env, auteur);
  const r = await env.DB.prepare("INSERT INTO hypotheses (pseudo, titre, texte, refs, auteur_hash) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .bind(pseudo, titre, texte, JSON.stringify(refs), auteur).first();
  return json({ id: r.id, statut: "attente" }, 201);
}

async function createCommentaire(req, env, id) {
  const b = await body(req);
  const pseudo = text(b.pseudo, 2, MAX.pseudo, "Pseudo");
  const texte = text(b.texte, 2, MAX.commentaire, "Commentaire");
  await published(env, id);
  await human(req, env, b.turnstile);
  const auteur = await ipHash(req, env);
  await rateLimit(env, auteur);
  const r = await env.DB.prepare("INSERT INTO commentaires (hypothese_id, pseudo, texte, auteur_hash) VALUES (?, ?, ?, ?) RETURNING id")
    .bind(id, pseudo, texte, auteur).first();
  return json({ id: r.id, statut: "attente" }, 201);
}

async function vote(req, env, id) {
  const b = await body(req);
  const valeur = Number(b.valeur);
  if (![-1, 0, 1].includes(valeur)) throw fail(400, "Vote invalide");
  if (!/^[\w-]{16,64}$/.test(String(b.device || ""))) throw fail(400, "Appareil invalide");
  await published(env, id);
  await human(req, env, b.turnstile);
  const votant = await sha(`${env.HASH_SALT}|device|${b.device}`);
  const iph = await ipHash(req, env);
  if (valeur === 0) {
    await env.DB.prepare("DELETE FROM votes WHERE hypothese_id = ? AND votant_hash = ?").bind(id, votant).run();
  } else {
    // Plusieurs appareils derrière une même IP (un foyer) : plafonnés pour limiter le bourrage d'urne
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM votes WHERE hypothese_id = ?1 AND ip_hash = ?2 AND votant_hash <> ?3").bind(id, iph, votant).first();
    if (n >= MAX.votantsParIp) throw fail(429, "Trop de votes depuis cette connexion");
    await env.DB.prepare(`INSERT INTO votes (hypothese_id, votant_hash, ip_hash, valeur) VALUES (?, ?, ?, ?)
      ON CONFLICT (hypothese_id, votant_hash) DO UPDATE SET valeur = excluded.valeur, ip_hash = excluded.ip_hash`).bind(id, votant, iph, valeur).run();
  }
  const s = await env.DB.prepare(`SELECT ${SCORE} FROM hypotheses h WHERE h.id = ?`).bind(id).first();
  return json({ score: s.score, pour: s.pour, contre: s.contre, mon_vote: valeur || null });
}

/* ---------------- Sondages (question de la semaine) ---------------- */

const votantHash = (env, device) => sha(`${env.HASH_SALT}|device|${device}`);
async function sondageTotaux(env, q, votant) {
  const t = await env.DB.prepare("SELECT SUM(valeur = 1) AS oui, SUM(valeur = -1) AS non FROM sondages WHERE question = ?").bind(q).first();
  const mine = votant ? await env.DB.prepare("SELECT valeur FROM sondages WHERE question = ? AND votant_hash = ?").bind(q, votant).first() : null;
  return { oui: t?.oui || 0, non: t?.non || 0, mon_vote: mine?.valeur ?? null };
}
async function getSondage(env, q, url) {
  const device = url.searchParams.get("d") || "";
  const votant = /^[\w-]{16,64}$/.test(device) ? await votantHash(env, device) : "";
  return json(await sondageTotaux(env, q, votant));
}
async function voteSondage(req, env, q) {
  const b = await body(req);
  const valeur = Number(b.valeur);
  if (![-1, 1].includes(valeur)) throw fail(400, "Vote invalide");
  if (!/^[\w-]{16,64}$/.test(String(b.device || ""))) throw fail(400, "Appareil invalide");
  await human(req, env, b.turnstile);
  const votant = await votantHash(env, b.device), iph = await ipHash(req, env);
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM sondages WHERE question = ?1 AND ip_hash = ?2 AND votant_hash <> ?3").bind(q, iph, votant).first();
  if (n >= MAX.votantsParIp) throw fail(429, "Trop de votes depuis cette connexion");
  await env.DB.prepare(`INSERT INTO sondages (question, votant_hash, ip_hash, valeur) VALUES (?, ?, ?, ?)
    ON CONFLICT (question, votant_hash) DO UPDATE SET valeur = excluded.valeur, ip_hash = excluded.ip_hash`).bind(q, votant, iph, valeur).run();
  return json(await sondageTotaux(env, q, votant));
}

/* ---------------- Cote de confiance ---------------- */

const CONF_TOT = "SELECT elu, SUM(valeur = 1) AS oui, SUM(valeur = -1) AS non FROM confiance";
async function getConfiance(env, url) {
  const device = url.searchParams.get("d") || "";
  const votant = /^[\w-]{16,64}$/.test(device) ? await votantHash(env, device) : "";
  const [tot, mes] = await env.DB.batch([
    env.DB.prepare(`${CONF_TOT} GROUP BY elu`),
    env.DB.prepare("SELECT elu, valeur FROM confiance WHERE votant_hash = ?").bind(votant || "-"),
  ]);
  return json({ totaux: tot.results, mes: Object.fromEntries(mes.results.map((x) => [x.elu, x.valeur])) });
}
async function voteConfiance(req, env, elu) {
  const b = await body(req);
  const valeur = Number(b.valeur);
  if (![-1, 1].includes(valeur)) throw fail(400, "Vote invalide");
  if (!/^[\w-]{16,64}$/.test(String(b.device || ""))) throw fail(400, "Appareil invalide");
  await human(req, env, b.turnstile);
  const votant = await votantHash(env, b.device), iph = await ipHash(req, env);
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM confiance WHERE elu = ?1 AND ip_hash = ?2 AND votant_hash <> ?3").bind(elu, iph, votant).first();
  if (n >= MAX.votantsParIp) throw fail(429, "Trop de votes depuis cette connexion");
  await env.DB.prepare(`INSERT INTO confiance (elu, votant_hash, ip_hash, valeur) VALUES (?, ?, ?, ?)
    ON CONFLICT (elu, votant_hash) DO UPDATE SET valeur = excluded.valeur, ip_hash = excluded.ip_hash, maj_le = datetime('now')`).bind(elu, votant, iph, valeur).run();
  const t = await env.DB.prepare(`${CONF_TOT} WHERE elu = ?`).bind(elu).first();
  return json({ elu, oui: t?.oui || 0, non: t?.non || 0, mon_vote: valeur });
}

/* ---------------- Clics de la page S'engager ---------------- */

async function getClics(env) {
  const { results } = await env.DB.prepare("SELECT cible, COUNT(*) AS n FROM clics GROUP BY cible").all();
  return json({ clics: results });
}
async function addClic(req, env) {
  const b = await body(req);
  const cible = String(b.cible || "");
  if (!/^[a-z0-9-]{2,30}:(adherer|don|site)$/.test(cible)) throw fail(400, "Cible invalide");
  const iph = await ipHash(req, env);
  await env.DB.prepare("INSERT OR IGNORE INTO clics (cible, jour, ip_hash) VALUES (?, date('now'), ?)").bind(cible, iph).run();
  return json({ ok: true });
}

/* ---------------- Modération ---------------- */

function checkAdmin(req, env) {
  if (!env.ADMIN_TOKEN) throw fail(503, "Modération non configurée");
  if (req.headers.get("Authorization") !== `Bearer ${env.ADMIN_TOKEN}`) throw fail(401, "Accès refusé");
}

async function adminFile(env) {
  const [h, c, pub, sond, conf, clics] = await env.DB.batch([
    env.DB.prepare("SELECT id, pseudo, titre, texte, refs, cree_le FROM hypotheses WHERE statut = 'attente' ORDER BY cree_le"),
    env.DB.prepare(`SELECT c.id, c.pseudo, c.texte, c.cree_le, c.hypothese_id, h.titre AS hypothese
      FROM commentaires c JOIN hypotheses h ON h.id = c.hypothese_id WHERE c.statut = 'attente' ORDER BY c.cree_le`),
    env.DB.prepare(`SELECT h.id, h.pseudo, h.titre, h.refs, h.publie_le, ${SCORE} FROM hypotheses h WHERE h.statut = 'publie' ORDER BY h.publie_le DESC LIMIT 100`),
    env.DB.prepare("SELECT question, SUM(valeur = 1) AS oui, SUM(valeur = -1) AS non FROM sondages GROUP BY question ORDER BY oui + non DESC"),
    env.DB.prepare(`${CONF_TOT} GROUP BY elu ORDER BY oui + non DESC LIMIT 30`),
    env.DB.prepare("SELECT cible, COUNT(*) AS n FROM clics GROUP BY cible ORDER BY n DESC"),
  ]);
  return json({ hypotheses: parseRefs(h.results), commentaires: c.results, publiees: parseRefs(pub.results), sondages: sond.results, confiance: conf.results, clics: clics.results });
}

async function adminAction(req, env, table, id) {
  const b = await body(req);
  const t = table === "hypotheses" ? "hypotheses" : "commentaires";  // liste blanche : jamais de nom de table venant de la requête
  if (b.action === "publier") {
    await env.DB.prepare(`UPDATE ${t} SET statut = 'publie', publie_le = datetime('now'), motif_refus = NULL WHERE id = ?`).bind(id).run();
  } else if (b.action === "refuser") {
    await env.DB.prepare(`UPDATE ${t} SET statut = 'refuse', motif_refus = ? WHERE id = ?`).bind(String(b.motif || "").slice(0, 300), id).run();
  } else if (b.action === "supprimer") {
    const stmts = [env.DB.prepare(`DELETE FROM ${t} WHERE id = ?`).bind(id)];
    if (t === "hypotheses") stmts.unshift(env.DB.prepare("DELETE FROM votes WHERE hypothese_id = ?").bind(id), env.DB.prepare("DELETE FROM commentaires WHERE hypothese_id = ?").bind(id));
    await env.DB.batch(stmts);
  } else throw fail(400, "Action inconnue");
  return json({ ok: true });
}
