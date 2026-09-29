"""Table NPA → canton pour la recherche de l'accueil (site/npa.json).
Source : répertoire officiel des localités, swisstopo (« Open use », citer la source).
Change rarement : à relancer à la main une fois par an, pas dans le build hebdomadaire.
    python3 scripts/npa.py
"""
import csv, io, json, urllib.request, zipfile

URL = "https://data.geo.admin.ch/ch.swisstopo-vd.ortschaftenverzeichnis_plz/ortschaftenverzeichnis_plz/ortschaftenverzeichnis_plz_2056.csv.zip"
z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(URL, timeout=60).read()))
name = next(n for n in z.namelist() if n.endswith(".csv"))
rows = {}
for r in csv.DictReader(io.TextIOWrapper(z.open(name), encoding="utf-8-sig"), delimiter=";"):
    key = (r["PLZ4"], r["Ortschaftsname"])
    rows.setdefault(key, set()).add(r["Kantonskürzel"])
out = sorted([plz, lieu, "|".join(sorted(c))] for (plz, lieu), c in rows.items())
json.dump(out, open("site/npa.json", "w"), ensure_ascii=False, separators=(",", ":"))
print(len(out), "localités")
