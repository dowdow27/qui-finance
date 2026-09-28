# Qui finance la politique suisse ?

Un site qui réunit, cherche et compare deux registres publics, mis à jour automatiquement chaque lundi :

| Registre | Contenu | Source |
| --- | --- | --- |
| Transparence du financement de la vie politique | Dons aux partis (> 15 000 CHF) et aux campagnes d'élection et de votation (> 50 000 CHF) | [Contrôle fédéral des finances (CDF)](https://politikfinanzierung.efk.admin.ch), via le miroir CSV [swiss-political-financing](https://github.com/lgnbhl/swiss-political-financing) |
| Liens d'intérêts des parlementaires | Mandats, rémunérations communiquées, badges d'accès au Palais fédéral | [Lobbywatch.ch](https://lobbywatch.ch/datenexport/) |
| Votations fédérales (depuis 2023) | Résultats, résultats par canton, mots d'ordre | [Swissvotes](https://swissvotes.ch/page/dataset), complété par l'[OFS](https://opendata.swiss/fr/dataset/echtzeitdaten-am-abstimmungstag-zu-eidgenoessischen-abstimmungsvorlagen) pour les cantons |

## Ce que fait le site

- **Chercher** : une seule barre pour les donateurs, bénéficiaires, élus, organisations et titulaires de badges. Chaque résultat ouvre une fiche, avec les liens croisés (une entreprise qui donne de l'argent ET qui a des élus dans ses conseils).
- **Dons** : tableau filtrable par type (élection, votation, parti), parti, secteur, année, camp (pour ou contre), montant. Export CSV.
- **Votations** : chaque objet fédéral depuis 2023, avec son résultat, la carte des cantons, les mots d'ordre, et l'argent du oui et du non (donateurs compris) quand les comités l'ont déclaré au CDF.
- **Parlement** : composition du Conseil national et du Conseil des États (hémicycles cliquables), puis vue par élu ou par mandat, filtres par parti, conseil, secteur, rémunération. Export CSV.
- **Tendances** : plus gros donateurs, argent par secteur, argent reçu par parti, budget du oui contre budget du non pour chaque votation, secteurs les plus présents au Parlement, mandats rémunérés par parti, évolution semaine après semaine.
- **Nouveautés** : ce qui a changé depuis la dernière mise à jour (nouveaux dons, nouveaux mandats, mandats terminés).

## Mise en ligne (5 minutes, gratuit)

1. Crée un dépôt **public** sur GitHub (par exemple `qui-finance`) et pousse ce dossier dessus.
2. Dans le dépôt : **Settings → Pages → Source : GitHub Actions**.
3. **Actions → Mise à jour hebdomadaire → Run workflow**. La première exécution télécharge les données et publie le site.

Le site est alors en ligne à l'adresse `https://<ton-compte>.github.io/<nom-du-depot>/` et se met à jour tout seul chaque lundi.

## Débats (hypothèses fondées sur les données)

Onglet « Débats » : chacun propose une hypothèse qui cite au moins une fiche du site, vote pour ou contre, commente. Rien n'est publié sans validation sur `site/admin.html`.

- API : Cloudflare Worker + D1 dans `worker/` (JavaScript sans dépendance). Anti-robot : Cloudflare Turnstile.
- Aucune donnée personnelle en clair : pas de compte ni d'email, l'adresse IP n'est conservée que sous forme d'empreinte salée (limite de 5 contributions par jour, votes plafonnés par connexion).
- Configuration publique (adresse de l'API, sitekey Turnstile) : `site/config.js`. L'onglet reste masqué tant qu'elle est vide.
- Secrets du Worker (`npx wrangler secret put`) : `TURNSTILE_SECRET`, `ADMIN_TOKEN`, `HASH_SALT`.
- En local : `npx wrangler d1 execute qui-finance-debats --local --file worker/schema.sql`, puis `npx wrangler dev --config worker/wrangler.toml` et `cd site && python3 -m http.server 8000` (clés de test Turnstile dans `worker/.dev.vars`, non versionné).

## Adapter les catégories

- `config/secteurs.csv` : classe les donateurs par secteur (« motif;secteur », le motif est une expression régulière sur le nom en minuscules, sans accents). Les donateurs non couverts sont classés via Lobbywatch quand leur nom y figure.
- `config/alias_donateurs.csv` : regroupe les variantes d'un même donateur (« HEV Schweiz » et « Hauseigentümerverband (HEV) Schweiz »).

Un push sur ces fichiers relance la construction du site.

## Précautions de lecture

- **Pas de double comptage** : pour chaque campagne, seul le décompte final est retenu, ou le budget tant que le décompte n'est pas publié.
- **Couverture partielle** : seules les instances nationales des partis sont soumises à la loi, pas les sections cantonales. Les petits dons (< 15 000 CHF aux partis) restent anonymes.
- **Rémunérations** : un mandat « non communiqué » n'est pas forcément bénévole.
- **Classement automatique** : les secteurs des donateurs sont déduits des noms et peuvent se tromper.
- **Si une source tombe**, le site garde les données de la semaine précédente et l'indique en bas de page.

## Licences

- Données CDF : « Open use », citer la source.
- Données Lobbywatch : CC BY-SA 4.0, citer Lobbywatch et partager aux mêmes conditions.
- Données Swissvotes : CC BY 4.0, citer « Swissvotes, Année politique suisse, Université de Berne ». Résultats cantonaux de l'OFS : « Open use ».
- Photos des parlementaires : © ParlCH (Services du Parlement), usage gratuit à des fins d'information avec mention de la source. Elles sont affichées depuis parlament.ch, pas copiées dans le dépôt.
- Code : GNU AGPL v3 (voir `LICENSE`). Toute version modifiée mise en ligne doit publier son code source sous la même licence. Les données restent sous la licence de leur source (CC BY-SA 4.0 pour tout ce qui dérive de Lobbywatch).

## Tester en local

```bash
python3 scripts/build.py          # télécharge les deux registres
cd site && python3 -m http.server # puis ouvrir http://localhost:8000
```
