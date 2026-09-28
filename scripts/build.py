#!/usr/bin/env python3
"""Construit les données du site « Qui finance la politique suisse ? ».

Sources (téléchargées à chaque exécution) :
  - CDF / EFK, transparence du financement de la vie politique, via le miroir CSV
    hebdomadaire github.com/lgnbhl/swiss-political-financing (données officielles, « Open use »)
  - Lobbywatch.ch, export hebdomadaire agrégé (CC BY-SA 4.0)
  - swissvotes.ch, votations fédérales (CC BY 4.0), complété par les résultats cantonaux de l'OFS

Python 3.10+ standard uniquement, aucune dépendance.
Si une source échoue, les données précédentes sont conservées et signalées sur le site.
Variables d'environnement pour tester hors ligne : LW_FILE (zip Lobbywatch), EFK_DIR (dossier CSV).
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import sys
import unicodedata
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "data"
HIST = ROOT / "history"

EFK_BASE = "https://raw.githubusercontent.com/lgnbhl/swiss-political-financing/main/data/fr/"
LW_URL = ("https://cms.lobbywatch.ch/sites/lobbywatch.ch/files/exports/"
          "lobbywatch_export_aggregated.json.zip")
LW_INNER = "parlamentarier_nested"
PHOTO_URL = "https://www.parlament.ch/SiteCollectionImages/profil/portrait-260/{}.jpg"  # © ParlCH
SV_URL = "https://swissvotes.ch/page/dataset/swissvotes_dataset.csv"  # CC BY 4.0
BFS_URL = "https://ogd-static.voteinfo-app.ch/v1/ogd/sd-t-17-02-{}-eidgAbstimmung.json"
UA = {"User-Agent": "qui-finance-ch/1.0"}
NOW = datetime.now(timezone.utc)
MIN_ELUS = int(os.environ.get("MIN_ELUS", "100"))

# --------------------------------------------------------------------------
# Utilitaires
# --------------------------------------------------------------------------


def http_get(url: str, timeout: int = 300) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def read_csv(name: str) -> list[dict]:
    local = os.environ.get("EFK_DIR")
    raw = Path(local, name).read_bytes() if local else http_get(EFK_BASE + name)
    return list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig")), delimiter=";"))


def num(v) -> float | None:
    try:
        return round(float(v), 2) if v not in (None, "") else None
    except ValueError:
        return None


LEGAL = {"ag", "sa", "gmbh", "sarl", "ltd", "inc", "genossenschaft", "cooperative",
         "societe", "anonyme", "the", "holding", "schweiz", "suisse", "switzerland"}


def norm(s: str | None, strip_legal: bool = True) -> str:
    """Minuscules, sans accents ni ponctuation (sert à la recherche et aux rapprochements)."""
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    words = s.split()
    if strip_legal:
        words = [w for w in words if w not in LEGAL] or words
    return " ".join(words)


def year_of(*candidates: str | None) -> int | None:
    for s in candidates:
        if not s:
            continue
        m = re.search(r"(20\d\d)", s)
        if m:
            return int(m.group(1))
        if s.isdigit() and 40000 < int(s) < 60000:  # date Excel brute (jours depuis 1899)
            return 1899 + int((int(s) - 1) / 365.2425)
    return None


# Partis : un libellé court commun aux deux sources.
# Ordre important : « Vert'libéraux » est testé avant « Verts ».
PARTY_RULES = [
    ("UDC", r"\b(svp|udc|volkspartei|democratique du centre)\b"),
    ("PS", r"\b(sp|ps|sozialdemokratische|socialiste|juso)\b"),
    ("PLR", r"\b(fdp|plr|freisinnig|liberaux radicaux|liberal radicale?)\b"),
    ("Le Centre", r"\b(mitte|centre|centro)\b"),
    ("Vert'libéraux", r"\b(glp|grunliberale?|vert liberaux|pvl)\b"),
    ("Verts", r"\b(grune|gruene|verts|verdi|gps|basta)\b"),
    ("PEV", r"\b(evp|pev|evangelische volkspartei)\b"),
    ("UDF", r"\b(edu|udf)\b"),
    ("Lega", r"\blega\b"),
    ("MCG", r"\b(mcg|mouvement citoyens genevois)\b"),
]
LW_PARTY = {"SVP": "UDC", "SP": "PS", "FDP": "PLR", "M": "Le Centre", "CVP": "Le Centre",
            "BDP": "Le Centre", "GLP": "Vert'libéraux", "GPS": "Verts", "Grüne": "Verts",
            "EVP": "PEV", "EDU": "UDF", "Lega": "Lega", "MCG": "MCG", "PdA": "PST-POP"}


def party_of(text: str | None) -> str | None:
    t = norm(text, strip_legal=False)
    if not t:
        return None
    # « Evangelische Volkspartei » ne doit pas être lu comme « Volkspartei » (UDC)
    if re.search(PARTY_RULES[6][1], t):
        return "PEV"
    for label, rx in PARTY_RULES:
        if re.search(rx, t):
            return label
    return None


def load_rules(name: str) -> list[tuple[re.Pattern, str]]:
    """Règles éditables dans config/*.csv : « motif;valeur » (motif = regex sur le nom normalisé)."""
    path = ROOT / "config" / name
    if not path.exists():
        return []
    rows = csv.reader(path.open(encoding="utf-8"), delimiter=";")
    next(rows, None)
    return [(re.compile(r[0]), r[1]) for r in rows if len(r) >= 2 and r[0].strip()]


def first_match(rules, text: str) -> str | None:
    t = norm(text, strip_legal=False)
    return next((v for rx, v in rules if rx.search(t)), None)


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def dump(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


# --------------------------------------------------------------------------
# Lobbywatch : élus, liens d'intérêts, badges d'accès
# --------------------------------------------------------------------------


# Codes Lobbywatch pour « verguetung » (public_html/bearbeitung/interessenbindung_jahr.php) :
# -1 = membre cotisant (l'élu paie), 0 = bénévole, 1 = rémunéré montant inconnu,
# 2 / 2502 / 5002 / 10002 / 25002 / 50002 / 100002 = fourchettes, autre valeur > 1 = montant exact.
LW_RANGES = {2, 2502, 5002, 10002, 25002, 50002, 100002}


def paid_status(verg: list[dict]) -> tuple[str, int | None, int | None]:
    """(statut, montant CHF, année) de la rémunération déclarée la plus récente."""
    if not verg:
        return "inconnu", None, None
    last = max(verg, key=lambda v: v.get("jahr") or 0)
    v, y = last.get("verguetung"), last.get("jahr")
    if v is None:
        return "inconnu", None, y
    if v <= 0:  # bénévole, ou membre cotisant (non rémunéré)
        return "benevole", 0, y
    if v == 1 or v in LW_RANGES:  # rémunéré, montant exact non communiqué
        return "remunere", None, y
    return "remunere", int(v), y


def org_name(o: dict) -> str:
    return o.get("name_fr") or o.get("name_de") or o.get("name") or "?"


def build_lobbywatch() -> dict:
    local = os.environ.get("LW_FILE")
    raw = Path(local).read_bytes() if local else http_get(LW_URL)
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        names = [n for n in zf.namelist() if n.endswith(".json") and LW_INNER in n]
        if not names:
            raise RuntimeError(f"format Lobbywatch inattendu : {zf.namelist()[:10]}")
        name = sorted(names, key=lambda n: ("essential" not in n, n))[0]
        records = json.loads(zf.read(name))

    elus, liens, badges, orgs = [], [], [], {}
    for p in records:
        if p.get("aktiv") == 0 or p.get("im_rat_bis"):
            continue
        pid = p["id"]
        code = p.get("partei") or ""
        elus.append({
            "id": pid,
            "nom": f"{p.get('vorname') or ''} {p.get('nachname') or ''}".strip(),
            "parti": LW_PARTY.get(code) or p.get("partei_fr") or code or "Sans parti",
            "canton": p.get("kanton") or "",
            "conseil": p.get("rat_fr") or p.get("rat") or "",
            "commissions": p.get("kommissionen_abkuerzung") or "",
            "profession": p.get("beruf_fr") or p.get("beruf") or "",
            "fraction": p.get("fraktion") or "",
            "photo": PHOTO_URL.format(p["parlament_number"]) if p.get("parlament_number") else "",
            "url": f"https://lobbywatch.ch/fr/daten/parlamentarier/{pid}",
        })
        for ib in p.get("interessenbindungen") or []:
            if ib.get("bis"):
                continue  # mandat terminé
            o = ib.get("organisation") or {}
            groupe = o.get("interessengruppe_fr") or o.get("interessengruppe") or "Non classé"
            secteur = (o.get("interessengruppe_branche_fr") or o.get("interessengruppe_branche")
                       or "Non classé")
            statut, montant, annee = paid_status(ib.get("verguetungen") or [])
            liens.append({
                "p": pid, "org": org_name(o), "groupe": groupe, "secteur": secteur,
                "role": ib.get("art") or "", "fonction": ib.get("funktion_im_gremium") or "",
                "statut": statut, "montant": montant, "annee": annee,
                "principal": bool(ib.get("hauptberuflich")),
            })
            for key in (o.get("name_de"), o.get("name_fr")):
                if key and norm(key):
                    orgs[norm(key)] = (groupe, secteur)
        for z in p.get("zutrittsberechtigungen") or []:
            if z.get("bis"):
                continue
            mandats = [org_name(m.get("organisation") or {})
                       for m in z.get("mandate") or [] if not m.get("bis")]
            badges.append({
                "p": pid,
                "nom": f"{z.get('vorname') or ''} {z.get('nachname') or ''}".strip(),
                "fonction": z.get("funktion") or z.get("beruf_fr") or z.get("beruf") or "",
                "mandats": [m for m in mandats if m and m != "?"][:8],
            })
    if len(elus) < MIN_ELUS:
        raise RuntimeError(f"seulement {len(elus)} élus : export Lobbywatch incomplet ?")
    return {"elus": elus, "liens": liens, "badges": badges, "orgs": orgs}


# --------------------------------------------------------------------------
# CDF / EFK : campagnes et dons
# --------------------------------------------------------------------------

CATEGORIES = {"elections": "Élection", "votes": "Votation", "party": "Parti"}


def build_efk(orgs: dict) -> dict:
    decl = read_csv("exports/declarations.csv")
    contr = read_csv("exports/contributions.csv")
    if len(decl) < 100 or len(contr) < 100:
        raise RuntimeError("export CDF incomplet")

    # Une seule déclaration par acteur et par événement : le décompte final s'il existe,
    # sinon le budget. Sinon les mêmes francs seraient comptés deux fois.
    groups = defaultdict(list)
    for d in decl:
        groups[(d["financing_id"], d["actor_id"] or d["actor"], d["campaign"])].append(d)
    keep = {}
    for rows in groups.values():
        finals = [r for r in rows if r["with_budget"] == "FALSE"]
        for r in finals or rows:
            keep[r["declaration_id"]] = r

    def side(d):
        c = norm(d.get("campaign"), strip_legal=False)
        return "Pour" if "adoption" in c else "Contre" if "rejet" in c else None

    def recipient_party(d):
        return party_of(d["actor"]) or party_of(d.get("candidate_party"))

    def event_year(d):
        return year_of(d.get("event_date"), d.get("event_year"), d.get("event_label"), d.get("date"))

    campagnes = [{
        "id": d["declaration_id"], "cat": CATEGORIES.get(d["category"], d["category"]),
        "evt": d["event_label"], "annee": event_year(d), "acteur": d["actor"],
        "parti": recipient_party(d), "camp": side(d), "budget": d["with_budget"] == "TRUE",
        "total": num(d["total_income_chf"]), "dons": num(d["monetary_donations_chf"]),
    } for d in keep.values()]

    aliases, sectors = load_rules("alias_donateurs.csv"), load_rules("secteurs.csv")
    dons = []
    for c in contr:
        d = keep.get(c["declaration_id"])
        if not d:
            continue
        company = (c.get("donor_company") or "").strip()
        person = f"{c.get('donor_first_name') or ''} {c.get('donor_last_name') or ''}".strip()
        donor = company or person or "Anonyme"
        if company:
            donor = first_match(aliases, company) or donor
        groupe = secteur = None
        if company and party_of(company):
            groupe, secteur = "Partis et associations de soutien", "Politique partisane"
        elif company:
            secteur = first_match(sectors, company) or first_match(sectors, donor)
            if not secteur:
                groupe, secteur = orgs.get(norm(company), (None, None))
        dons.append({
            "id": c["contribution_id"], "donateur": donor,
            "type": "Organisation" if company else ("Anonyme" if donor == "Anonyme" else "Personne"),
            "lieu": c.get("donor_company_domicile") or c.get("donor_residence") or "",
            "montant": num(c["value_chf"]), "nature": c.get("donation_type") or "",
            "annee": event_year(d), "date": c.get("donation_date") or "",
            "cat": CATEGORIES.get(d["category"], d["category"]), "evt": d["event_label"],
            "beneficiaire": d["actor"], "parti": recipient_party(d), "camp": side(d),
            "budget": d["with_budget"] == "TRUE",
            "groupe": groupe or "Non classé",
            "secteur": secteur or ("Particuliers" if person and not company else "Non classé"),
        })
    return {"dons": dons, "campagnes": campagnes}


# --------------------------------------------------------------------------
# Votations fédérales : swissvotes.ch, complété par l'OFS pour les résultats cantonaux
# --------------------------------------------------------------------------

VOTES_SINCE = 2023
CANTONS = "ZH BE LU UR SZ OW NW GL ZG FR SO BS BL SH AR AI SG GR AG TG TI VD VS NE GE JU".split()
VOTE_TYPES = {"1": "Référendum obligatoire", "2": "Référendum facultatif", "3": "Initiative populaire",
              "4": "Contre-projet", "5": "Question subsidiaire"}
# Codebook swissvotes : 1 oui, 2 non, 3 pas de mot d'ordre, 5 liberté de vote,
# 8 / 9 préférence pour le contre-projet / l'initiative (questions subsidiaires)
PAROLES = {"1": "oui", "2": "non", "3": "aucun", "5": "liberté", "8": "contre-projet", "9": "initiative"}
SV_ACTORS = [("svp", "UDC"), ("sps", "PS"), ("mitte", "Le Centre"), ("fdp", "PLR"), ("glp", "Vert'libéraux"),
             ("gps", "Verts"), ("evp", "PEV"), ("edu", "UDF"), ("eco", "economiesuisse"),
             ("sgv", "Union des arts et métiers"), ("sbv", "Union des paysans"), ("sgb", "Union syndicale")]


def fnum(v: str | None) -> float | None:
    v = (v or "").replace("’", "").replace("'", "").strip()
    try:
        return float(v) if v not in ("", ".") else None
    except ValueError:
        return None


def bfs_results(date: str) -> dict:
    """Résultats OFS d'un dimanche de votation : {numéro swissvotes × 10: vorlage}."""
    data = json.loads(http_get(BFS_URL.format(date.replace("-", "")), timeout=120))
    return {v["vorlagenId"]: v for v in data["schweiz"]["vorlagen"]}


def match_campaigns(votes: list[dict], campagnes: list[dict]) -> None:
    """Rattache chaque objet CDF « JJ.MM.AAAA titre » à la votation du même jour au titre le plus proche."""
    def words(s):
        return {w for w in norm(s, strip_legal=False).split() if len(w) > 3}
    evts = {c["evt"] for c in campagnes if c["cat"] == "Votation" and c.get("evt")}
    pairs = []
    for e in evts:
        m = re.match(r"(\d\d)\.(\d\d)\.(\d{4})\s*(.*)", e)
        if not m:
            continue
        day, title = f"{m[3]}-{m[2]}-{m[1]}", words(m[4])
        for v in votes:
            if v["date"] == day and title:
                score = len(title & words(v["titre_off"] + " " + v["titre"])) / len(title)
                pairs.append((score, e, v["id"]))
    used_e, used_v, best = set(), set(), {}
    for score, e, vid in sorted(pairs, reverse=True):
        if score >= 0.5 and e not in used_e and vid not in used_v:
            used_e.add(e), used_v.add(vid)
            best[vid] = e
    for v in votes:
        e = best.get(v["id"])
        camps = [c for c in campagnes if c["evt"] == e] if e else []
        v["argent"] = {"evt": e, "pour": round(sum(c["total"] or 0 for c in camps if c["camp"] == "Pour")),
                       "contre": round(sum(c["total"] or 0 for c in camps if c["camp"] == "Contre"))} if e else None


def build_votes(campagnes: list[dict]) -> list[dict]:
    raw = http_get(SV_URL)
    rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig")), delimiter=";"))
    if len(rows) < 600:
        raise RuntimeError("export swissvotes incomplet")
    today = NOW.date().isoformat()
    bfs_cache: dict[str, dict] = {}
    votes = []
    for r in rows:
        try:
            day = datetime.strptime(r["datum"], "%d.%m.%Y").date().isoformat()
        except ValueError:
            continue
        if int(day[:4]) < VOTES_SINCE:
            continue
        typ = r.get("rechtsform", "")
        cantons = {}
        for c in CANTONS:
            k = c.lower()
            acc = r.get(f"{k}-annahme")
            cantons[c] = {"oui": fnum(r.get(f"{k}-japroz")), "participation": fnum(r.get(f"{k}-bet")),
                          "accepte": True if acc == "1" else False if acc == "0" else None}
        oui, part = fnum(r.get("volkja-proz")), fnum(r.get("bet"))
        # swissvotes publie les détails cantonaux avec retard : on les prend alors à l'OFS
        if day <= today and any(v["oui"] is None for v in cantons.values()):
            try:
                if day not in bfs_cache:
                    bfs_cache[day] = bfs_results(day)
                vl = bfs_cache[day].get(round(float(r["anr"]) * 10))
            except Exception:  # noqa: BLE001  (résultats cantonaux facultatifs)
                vl = None
            if vl:
                oui = oui if oui is not None else vl["resultat"].get("jaStimmenInProzent")
                part = part if part is not None else vl["resultat"].get("stimmbeteiligungInProzent")
                for k in vl.get("kantone") or []:
                    c = CANTONS[int(k["geoLevelnummer"]) - 1]
                    res = k.get("resultat") or {}
                    y = res.get("jaStimmenInProzent")
                    cantons[c]["oui"] = round(y, 2) if y is not None else None
                    cantons[c]["participation"] = round(res.get("stimmbeteiligungInProzent") or 0, 2) or None
                    if cantons[c]["accepte"] is None and y is not None and typ != "5":
                        cantons[c]["accepte"] = y > 50
        volk = r.get("volk")
        if typ == "5":
            statut = ("Contre-projet préféré" if volk == "8" else "Initiative préférée" if volk == "9"
                      else "À venir" if day > today else "Résultat en attente")
        else:
            statut = ("Accepté" if r.get("annahme") == "1" else "Refusé" if r.get("annahme") == "0"
                      else "À venir" if day > today else "Résultat en attente")
        votes.append({
            "id": r["anr"], "date": day, "titre": r.get("titel_kurz_f") or r.get("titel_off_f") or "",
            "titre_off": r.get("titel_off_f") or "", "type": VOTE_TYPES.get(typ, typ), "statut": statut,
            "oui": round(oui, 2) if oui is not None else None,
            "participation": round(part, 2) if part is not None else None,
            "cantons_oui": fnum(r.get("kt-ja")), "cantons_non": fnum(r.get("kt-nein")),
            "cantons": cantons,
            "mots_ordre": {label: PAROLES[r.get(f"p-{k}")] for k, label in SV_ACTORS if r.get(f"p-{k}") in PAROLES},
            "conseil_federal": {"1": "pour", "2": "contre", "8": "contre-projet", "9": "initiative"}.get(r.get("br-pos")),
            "parlement": {k: int(fnum(r.get(k)) or 0) for k in ("nrja", "nrnein", "srja", "srnein")},
            "lien": r.get("swissvoteslink") or "",
        })
    match_campaigns(votes, campagnes)
    votes.sort(key=lambda v: float(v["id"]))
    votes.sort(key=lambda v: v["date"], reverse=True)
    return votes


# --------------------------------------------------------------------------
# Historique : nouveautés et série temporelle
# --------------------------------------------------------------------------


def diff(old: list[dict], new: list[dict], key) -> tuple[list, list]:
    o = {key(x): x for x in old}
    n = {key(x): x for x in new}
    return [n[k] for k in n.keys() - o.keys()], [o[k] for k in o.keys() - n.keys()]


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    HIST.mkdir(parents=True, exist_ok=True)
    meta = load_json(OUT / "meta.json", {"sources": {}})
    old_lobby = load_json(OUT / "lobby.json", None)
    old_money = load_json(OUT / "argent.json", None)
    errors = []

    lobby, orgs = old_lobby, {}
    try:
        lw = build_lobbywatch()
        orgs = lw.pop("orgs")
        lobby = lw
        meta["sources"]["lobbywatch"] = {"statut": "ok", "maj": NOW.isoformat()}
    except Exception as e:  # noqa: BLE001
        errors.append(f"Lobbywatch : {e}")
        meta["sources"].setdefault("lobbywatch", {})["statut"] = f"échec : {e}"[:200]

    money = old_money
    try:
        money = build_efk(orgs)
        meta["sources"]["efk"] = {"statut": "ok", "maj": NOW.isoformat()}
    except Exception as e:  # noqa: BLE001
        errors.append(f"CDF : {e}")
        meta["sources"].setdefault("efk", {})["statut"] = f"échec : {e}"[:200]

    votes = load_json(OUT / "votations.json", None)
    try:
        votes = build_votes(money["campagnes"] if money else [])
        meta["sources"]["swissvotes"] = {"statut": "ok", "maj": NOW.isoformat()}
    except Exception as e:  # noqa: BLE001
        errors.append(f"swissvotes : {e}")
        meta["sources"].setdefault("swissvotes", {})["statut"] = f"échec : {e}"[:200]

    if lobby is None and money is None:
        print("Aucune source disponible :", *errors, sep="\n", file=sys.stderr)
        return 1

    # Nouveautés depuis la dernière exécution
    today = NOW.date().isoformat()
    changes = {"date": today}
    if money and old_money:
        added, _ = diff(old_money["dons"], money["dons"], lambda x: x["id"])
        changes["dons_nouveaux"] = sorted(added, key=lambda x: -(x["montant"] or 0))[:200]
    if lobby and old_lobby:
        added, removed = diff(old_lobby["liens"], lobby["liens"],
                              lambda x: (x["p"], x["org"], x["role"]))
        changes["mandats_nouveaux"], changes["mandats_termines"] = added[:300], removed[:300]
    if any(changes.get(k) for k in ("dons_nouveaux", "mandats_nouveaux", "mandats_termines")):
        dump(HIST / f"changes-{today}.json", changes)
    files = sorted(HIST.glob("changes-*.json"))
    for f in files[:-26]:  # garde environ 6 mois
        f.unlink()
    dump(OUT / "changes.json", [load_json(f, {}) for f in sorted(HIST.glob("changes-*.json"))][::-1])

    # Série hebdomadaire (courbe des tendances)
    ts_path = HIST / "timeline.csv"
    row = {
        "date": today,
        "dons_n": len(money["dons"]) if money else "",
        "dons_chf": round(sum(d["montant"] or 0 for d in money["dons"])) if money else "",
        "mandats_n": len(lobby["liens"]) if lobby else "",
        "mandats_remuneres": sum(x["statut"] == "remunere" for x in lobby["liens"]) if lobby else "",
        "badges_n": len(lobby["badges"]) if lobby else "",
    }
    rows = list(csv.DictReader(ts_path.open(encoding="utf-8"))) if ts_path.exists() else []
    rows = [r for r in rows if r["date"] != today] + [row]
    with ts_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(row))
        w.writeheader()
        w.writerows(rows)
    dump(OUT / "timeline.json", rows)

    if money:
        dump(OUT / "argent.json", money)
    if lobby:
        dump(OUT / "lobby.json", lobby)
    if votes is not None:
        dump(OUT / "votations.json", votes)
    meta["genere"] = NOW.isoformat()
    meta["compteurs"] = {k: len(v) for src in (money or {}, lobby or {}) for k, v in src.items()}
    meta["compteurs"]["votations"] = len(votes or [])
    dump(OUT / "meta.json", meta)

    print(json.dumps(meta, ensure_ascii=False, indent=1))
    for e in errors:
        print("ATTENTION", e, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
