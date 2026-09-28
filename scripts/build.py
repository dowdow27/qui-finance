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
import time
import unicodedata
import urllib.parse
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
BIO_URL = "https://www.parlament.ch/fr/biografie?CouncillorId={}"
SV_URL = "https://swissvotes.ch/page/dataset/swissvotes_dataset.csv"  # CC BY 4.0
BFS_URL = "https://ogd-static.voteinfo-app.ch/v1/ogd/sd-t-17-02-{}-eidgAbstimmung.json"
PARL_API = "https://ws.parlament.ch/odata.svc/"  # votes nominaux du Conseil national (Services du Parlement)
KANT_PKG = ("https://ckan.opendata.swiss/api/3/action/package_show?"
            "id=echtzeitdaten-am-abstimmungstag-zu-kantonalen-abstimmungsvorlagen")
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
    commissions = defaultdict(set)  # groupe d'intérêts -> commissions parlementaires de sa branche (« WAK », « SGK »…)
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
            "parlement": BIO_URL.format(p["parlament_biografie_id"]) if p.get("parlament_biografie_id") else "",
            "pn": p.get("parlament_biografie_id"),  # = PersonNumber des votes nominaux de parlament.ch
            "depuis": p.get("im_rat_seit") or "",
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
                "depuis": ib.get("von") or "",
            })
            for key in (o.get("name_de"), o.get("name_fr")):
                if key and norm(key):
                    orgs[norm(key)] = (groupe, secteur)
            for k in ("interessengruppe_branche_kommission1_abkuerzung", "interessengruppe_branche_kommission2_abkuerzung"):
                if o.get(k):
                    commissions[groupe].add(o[k].split("-")[0])
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
    # Contexte à afficher à côté de certains chiffres (absences…), édité à la main : config/contexte_elus.csv
    path = ROOT / "config" / "contexte_elus.csv"
    if path.exists():
        ctx = {r["nom"].strip(): r for r in csv.DictReader(path.open(encoding="utf-8"), delimiter=";") if r.get("nom")}
        for e in elus:
            if e["nom"] in ctx:
                e["contexte"] = {"note": ctx[e["nom"]]["contexte"].strip(), "source": (ctx[e["nom"]].get("source") or "").strip()}
    if len(elus) < MIN_ELUS:
        raise RuntimeError(f"seulement {len(elus)} élus : export Lobbywatch incomplet ?")
    return {"elus": elus, "liens": liens, "badges": badges, "orgs": orgs,
            "commissions": {g: sorted(c) for g, c in commissions.items()}}


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
        voix_oui, voix_non = fnum(r.get("volkja")), fnum(r.get("volknein"))
        # swissvotes publie les détails (cantons, voix) avec retard : on les prend alors à l'OFS
        if day <= today and (voix_oui is None or any(v["oui"] is None for v in cantons.values())):
            try:
                if day not in bfs_cache:
                    bfs_cache[day] = bfs_results(day)
                vl = bfs_cache[day].get(round(float(r["anr"]) * 10))
            except Exception:  # noqa: BLE001  (résultats cantonaux facultatifs)
                vl = None
            if vl:
                oui = oui if oui is not None else vl["resultat"].get("jaStimmenInProzent")
                voix_oui = voix_oui if voix_oui is not None else vl["resultat"].get("jaStimmenAbsolut")
                voix_non = voix_non if voix_non is not None else vl["resultat"].get("neinStimmenAbsolut")
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
            "voix_oui": int(voix_oui) if voix_oui is not None else None, "voix_non": int(voix_non) if voix_non is not None else None,
            "cantons": cantons,
            "mots_ordre": {label: PAROLES[r.get(f"p-{k}")] for k, label in SV_ACTORS if r.get(f"p-{k}") in PAROLES},
            "conseil_federal": {"1": "pour", "2": "contre", "8": "contre-projet", "9": "initiative"}.get(r.get("br-pos")),
            "parlement": {k: int(fnum(r.get(k)) or 0) for k in ("nrja", "nrnein", "srja", "srnein")},
            "lien": r.get("swissvoteslink") or "",
            "objet": (r.get("gesch_nr") or "").strip(),
        })
    match_campaigns(votes, campagnes)
    votes.sort(key=lambda v: float(v["id"]))
    votes.sort(key=lambda v: v["date"], reverse=True)
    return votes


# --------------------------------------------------------------------------
# Votes nominaux du Conseil national (parlament.ch), croisés avec les liens d'intérêts
# --------------------------------------------------------------------------

LEGISLATURE = 52  # depuis décembre 2023
# oui, non, abstention, n'a pas participé, excusé (art. 57 al. 4 LParl : maladie, maternité, mission officielle), président
DECISION = {1: "o", 2: "n", 3: "a", 5: "-", 6: "e", 7: "p"}
CACHE_VERSION = 2  # à incrémenter quand le codage des votes change
SUJETS = {"Schlussabstimmung": "Vote final", "Gesamtabstimmung": "Vote sur l'ensemble", "Eintreten": "Entrée en matière",
          "Rückweisungsantrag": "Proposition de renvoi", "Ausgabenbremse": "Frein aux dépenses"}
PARL_CACHE = HIST / "parlement_cache.json"
MIN_ELUS_GROUPE, MAX_ELUS_GROUPE, MIN_Z = 5, 60, 3.0  # groupes d'intérêts assez précis ; écarts nets seulement


def odata(entity: str, filt: str, select: str) -> list[dict]:
    """Toutes les lignes d'une requête OData (pages de 5000, trois nouvelles tentatives)."""
    out, skip = [], 0
    while True:
        q = urllib.parse.urlencode({"$filter": filt, "$select": select, "$top": 5000, "$skip": skip, "$format": "json"},
                                   quote_via=urllib.parse.quote)
        for attempt in range(4):
            try:
                d = json.loads(http_get(f"{PARL_API}{entity}?{q}", timeout=120))["d"]
                break
            except Exception:  # noqa: BLE001
                if attempt == 3:
                    raise
                time.sleep(5 * (attempt + 1))
        rows = d.get("results", d) if isinstance(d, dict) else d
        out += rows
        if len(rows) < 5000:
            return out
        skip += 5000


def odata_date(s: str) -> str:
    m = re.search(r"\d+", s or "")
    return datetime.fromtimestamp(int(m[0]) / 1000, timezone.utc).date().isoformat() if m else ""


def fetch_parlement() -> dict:
    """Met à jour le cache des scrutins : seuls les scrutins absents du cache sont téléchargés."""
    cache = load_json(PARL_CACHE, {})
    if cache.get("version") != CACHE_VERSION:  # codage des votes changé : on reconstruit le cache
        cache = {"version": CACHE_VERSION, "ordre": [], "membres": {}, "scrutins": {}}
    meta = odata("Vote", f"Language eq 'FR' and IdLegislativePeriod eq {LEGISLATURE}",
                 "ID,BusinessShortNumber,BusinessTitle,BillTitle,Subject,MeaningYes,MeaningNo,VoteEnd")
    if len(meta) < 100:
        raise RuntimeError("liste des scrutins incomplète")
    missing = sorted(v["ID"] for v in meta if str(v["ID"]) not in cache["scrutins"])
    rows_by_vote = defaultdict(list)
    for i in range(0, len(missing), 24):  # ~24 scrutins × 200 élus < 5000 lignes par requête
        chunk = missing[i:i + 24]
        for r in odata("Voting", f"Language eq 'FR' and IdVote ge {chunk[0]} and IdVote le {chunk[-1]}",
                       "IdVote,PersonNumber,Decision,ParlGroupCode,FirstName,LastName,Canton"):
            rows_by_vote[r["IdVote"]].append(r)
    for v in meta:
        vid = str(v["ID"])
        if vid in cache["scrutins"] or not rows_by_vote.get(v["ID"]):
            continue
        votes = {}
        for r in rows_by_vote[v["ID"]]:
            pn = str(r["PersonNumber"])
            m = cache["membres"].get(pn)
            if not m:
                cache["ordre"].append(pn)  # liste qui ne fait que s'allonger : les anciens codes restent valables
            if not m or v["ID"] >= m.get("vu", 0):  # nom et groupe les plus récents
                cache["membres"][pn] = {"nom": f"{r['FirstName']} {r['LastName']}", "groupe": r.get("ParlGroupCode") or "",
                                        "canton": r.get("Canton") or "", "vu": v["ID"]}
            votes[pn] = DECISION.get(r["Decision"], "-")
        code = "".join(votes.get(pn, " ") for pn in cache["ordre"]).rstrip()
        cache["scrutins"][vid] = {
            "date": odata_date(v["VoteEnd"]), "objet": v.get("BusinessShortNumber") or "",
            "titre": v.get("BillTitle") or v.get("BusinessTitle") or "", "affaire": v.get("BusinessTitle") or "",
            "sujet": SUJETS.get(v.get("Subject") or "", v.get("Subject") or ""),
            "oui": v.get("MeaningYes") or "", "non": v.get("MeaningNo") or "", "v": code,
        }
    # Commissions qui ont examiné chaque objet (abréviations allemandes, comme Lobbywatch)
    com = defaultdict(set)
    for r in odata("Preconsultation", "Language eq 'DE' and BusinessNumber ge 20000000", "BusinessShortNumber,Abbreviation1"):
        if r.get("Abbreviation1"):
            com[r["BusinessShortNumber"]].add(r["Abbreviation1"].split("-")[0])
    if com:
        cache["commissions"] = {k: sorted(v) for k, v in com.items()}
    # Une ligne par scrutin : les diffs git restent petits d'une semaine à l'autre
    PARL_CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=0, sort_keys=True), encoding="utf-8")
    return cache


def build_parlement(cache: dict, elus: list[dict], liens: list[dict], commissions: dict) -> dict:
    by_pn = {str(e["pn"]): e for e in elus if e.get("pn")}
    pns = cache["ordre"]
    membres = [[int(pn), m["nom"], m["groupe"], m["canton"], by_pn[pn]["id"] if pn in by_pn else None]
               for pn, m in ((pn, cache["membres"][pn]) for pn in pns)]
    groupe = {pn: cache["membres"][pn]["groupe"] for pn in pns}
    parti = {pn: by_pn[pn]["parti"] for pn in pns if pn in by_pn}  # parti actuel (Lobbywatch), élus en fonction seulement
    # Groupes d'intérêts Lobbywatch (plus fins que les secteurs) : élus ayant au moins un mandat en cours dedans
    elu_pn = {e["id"]: str(e["pn"]) for e in elus if e.get("pn")}
    interets, secteur_de = defaultdict(set), {}
    for l in liens:
        if l["p"] in elu_pn and l["groupe"] not in ("Non classé", "Partis"):
            interets[l["groupe"]].add(elu_pn[l["p"]])
            secteur_de[l["groupe"]] = l["secteur"]
    interets = {g: m for g, m in interets.items() if MIN_ELUS_GROUPE <= len(m) <= MAX_ELUS_GROUPE and commissions.get(g)}
    com_objet = cache.get("commissions", {})

    ids = sorted(cache["scrutins"], key=int, reverse=True)
    scrutins, ecarts = [], defaultdict(list)
    stats = defaultdict(lambda: {"vote": 0, "total": 0, "absent": 0, "excuse": 0, "contre": 0, "recents": [],
                                 "contre_parti": 0, "compare_parti": 0, "recents_parti": []})
    testes = defaultdict(int)
    for vid in ids:
        s = cache["scrutins"][vid]
        code = s["v"]
        votes = {pn: c for pn, c in zip(pns, code) if c != " "}
        scrutins.append([int(vid), s["date"], s["objet"], s["titre"], s["affaire"] if s["affaire"] != s["titre"] else "",
                         s["sujet"], s["oui"], s["non"], code])
        gy, gn, py, pno = defaultdict(int), defaultdict(int), defaultdict(int), defaultdict(int)
        for pn, d in votes.items():
            if d == "o":
                gy[groupe[pn]] += 1
                py[parti.get(pn)] += 1
            elif d == "n":
                gn[groupe[pn]] += 1
                pno[parti.get(pn)] += 1
        for pn, d in votes.items():
            if d in (" ", "p"):
                continue
            st = stats[pn]
            st["total"] += 1
            if d in "ona":
                st["vote"] += 1
            elif d == "-":
                st["absent"] += 1
            elif d == "e":
                st["excuse"] += 1
            g = groupe[pn]
            if d in "on" and gy[g] + gn[g] >= 3 and gy[g] != gn[g]:
                majorite = "o" if gy[g] > gn[g] else "n"
                if d != majorite:
                    st["contre"] += 1
                    if len(st["recents"]) < 10:
                        st["recents"].append(int(vid))
            # Contre son propre parti : majorité des AUTRES élus du même parti (au moins 2 votants oui/non)
            pt = parti.get(pn)
            if pt and d in "on":
                oy, on = py[pt] - (d == "o"), pno[pt] - (d == "n")
                if oy + on >= 2 and oy != on:
                    st["compare_parti"] += 1
                    if d != ("o" if oy > on else "n"):
                        st["contre_parti"] += 1
                        if len(st["recents_parti"]) < 10:
                            st["recents_parti"].append(int(vid))
        # Écart des élus d'un groupe d'intérêts par rapport à ce qu'ont voté leurs groupes parlementaires,
        # seulement sur les objets examinés par la commission de leur branche (sinon on mesure du bruit)
        coms = set(com_objet.get(s["objet"], []))
        for sect, members in interets.items():
            if not coms & set(commissions[sect]):
                continue
            obs, att, qui = [], [], []
            for pn in members:
                d = votes.get(pn)
                if d not in ("o", "n"):
                    continue
                g = groupe[pn]
                reste = gy[g] + gn[g] - 1
                if reste < 1:
                    continue
                obs.append(d == "o")
                att.append((gy[g] - (d == "o")) / reste)
                qui.append(int(pn))
            if len(obs) >= MIN_ELUS_GROUPE:
                testes[sect] += 1
                var = sum(p * (1 - p) for p in att)
                if var < 0.5:  # groupes quasi unanimes : pas d'écart mesurable
                    continue
                z = (sum(obs) - sum(att)) / var ** 0.5
                if abs(z) >= MIN_Z:
                    o, a = sum(obs) / len(obs), sum(att) / len(att)
                    ecarts[sect].append([int(vid), len(obs), round(100 * o, 1), round(100 * a, 1), round(100 * (o - a), 1), round(z, 1)])
    top = {g: {"secteur": secteur_de[g], "elus": len(interets[g]), "commissions": commissions[g], "testes": testes[g],
               "scrutins": sorted(ecarts[g], key=lambda x: -abs(x[5]))[:25]} for g in interets if testes[g]}
    elus_stats = {by_pn[pn]["id"]: {"participation": round(100 * st["vote"] / st["total"], 1) if st["total"] else None,
                                    "scrutins": st["total"], "absences": st["absent"], "excuses": st["excuse"],
                                    "contre_groupe": st["contre"], "recents": st["recents"],
                                    "contre_parti": st["contre_parti"], "compare_parti": st["compare_parti"],
                                    "recents_parti": st["recents_parti"]}
                  for pn, st in stats.items() if pn in by_pn}
    return {"legislature": LEGISLATURE, "membres": membres, "scrutins": scrutins, "elus": elus_stats, "interets": top,
            "interets_membres": {g: sorted(int(pn) for pn in m) for g, m in interets.items()}}


def link_final_votes(votes: list[dict], parl: dict) -> None:
    """Rattache chaque votation populaire au vote final du Conseil national sur le même objet."""
    finals = {}
    for s in parl["scrutins"]:  # [id, date, objet, titre, affaire, sujet, ...], du plus récent au plus ancien
        if s[5] == "Vote final" and s[2] not in finals:
            finals[s[2]] = s[0]
    for v in votes:
        v["vote_final"] = finals.get(v.get("objet"))


# --------------------------------------------------------------------------
# Votations cantonales (OFS)
# --------------------------------------------------------------------------


def build_cantonal() -> list[dict]:
    pkg = json.loads(http_get(KANT_PKG, timeout=60))["result"]
    urls = sorted({r.get("download_url") or r.get("url") for r in pkg["resources"]})
    out = []
    for url in urls:
        m = re.search(r"-(\d{4})(\d\d)(\d\d)-kantAbstimmung\.json$", url or "")
        if not m or int(m[1]) < VOTES_SINCE:
            continue
        day = f"{m[1]}-{m[2]}-{m[3]}"
        data = json.loads(http_get(url, timeout=120))
        for k in data.get("kantone") or []:
            for v in k.get("vorlagen") or []:
                titres = {t["langKey"]: t["text"] for t in v.get("vorlagenTitel") or []}
                r = v.get("resultat") or {}
                communes = [[g.get("geoLevelname"), round(g["resultat"]["jaStimmenInProzent"], 1) if (g.get("resultat") or {}).get("jaStimmenInProzent") is not None else None,
                             round((g.get("resultat") or {}).get("stimmbeteiligungInProzent") or 0, 1) or None]
                            for g in v.get("gemeinden") or []]
                oui = r.get("jaStimmenInProzent")
                out.append({
                    "id": str(v["vorlagenId"]), "canton": k.get("geoLevelname"), "date": day,
                    "titre": (titres.get("fr") or titres.get("de") or titres.get("it") or next(iter(titres.values()), "")).strip(),
                    "oui": round(oui, 2) if oui is not None else None,
                    "participation": round(r["stimmbeteiligungInProzent"], 2) if r.get("stimmbeteiligungInProzent") is not None else None,
                    "accepte": v.get("vorlageAngenommen"), "communes": communes,
                })
    if len(out) < 50:
        raise RuntimeError("export cantonal incomplet")
    out.sort(key=lambda x: (x["date"], x["canton"]), reverse=True)
    return out


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

    lobby, orgs, commissions = old_lobby, {}, {}
    try:
        lw = build_lobbywatch()
        orgs = lw.pop("orgs")
        commissions = lw.pop("commissions")
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

    parl = load_json(OUT / "parlement.json", None)
    try:
        parl = build_parlement(fetch_parlement(), lobby["elus"] if lobby else [], lobby["liens"] if lobby else [], commissions)
        meta["sources"]["parlement"] = {"statut": "ok", "maj": NOW.isoformat()}
    except Exception as e:  # noqa: BLE001
        errors.append(f"Parlement : {e}")
        meta["sources"].setdefault("parlement", {})["statut"] = f"échec : {e}"[:200]
    if votes and parl:
        link_final_votes(votes, parl)

    cantonal = load_json(OUT / "cantonal.json", None)
    try:
        cantonal = build_cantonal()
        meta["sources"]["ofs_cantonal"] = {"statut": "ok", "maj": NOW.isoformat()}
    except Exception as e:  # noqa: BLE001
        errors.append(f"OFS cantonal : {e}")
        meta["sources"].setdefault("ofs_cantonal", {})["statut"] = f"échec : {e}"[:200]

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
    if parl is not None:
        dump(OUT / "parlement.json", parl)
    if cantonal is not None:
        dump(OUT / "cantonal.json", cantonal)
    meta["genere"] = NOW.isoformat()
    meta["compteurs"] = {k: len(v) for src in (money or {}, lobby or {}) for k, v in src.items()}
    meta["compteurs"]["votations"] = len(votes or [])
    meta["compteurs"]["scrutins"] = len((parl or {}).get("scrutins", []))
    meta["compteurs"]["cantonal"] = len(cantonal or [])
    dump(OUT / "meta.json", meta)

    print(json.dumps(meta, ensure_ascii=False, indent=1))
    for e in errors:
        print("ATTENTION", e, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
