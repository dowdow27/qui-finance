# Qui finance la politique suisse ?

On ne choisit ni son canton ni les objets soumis au vote, mais on peut voir qui les paie. Le site montre l'argent derrière vos élus (mandats, donateurs, présence, votes) et derrière chaque votation fédérale (budgets du oui et du non), à partir de registres publics mis à jour automatiquement chaque lundi :

| Registre | Contenu | Source |
| --- | --- | --- |
| Transparence du financement de la vie politique | Dons aux partis (> 15 000 CHF) et aux campagnes d'élection et de votation (> 50 000 CHF) | [Contrôle fédéral des finances (CDF)](https://politikfinanzierung.efk.admin.ch), via le miroir CSV [swiss-political-financing](https://github.com/lgnbhl/swiss-political-financing) |
| Liens d'intérêts des parlementaires | Mandats, rémunérations communiquées, badges d'accès au Palais fédéral | [Lobbywatch.ch](https://lobbywatch.ch/datenexport/) |
| Votes nominaux du Conseil national (législature en cours) | Vote de chaque élu sur chaque scrutin, commissions qui ont examiné chaque objet | [Services du Parlement](https://ws.parlament.ch/odata.svc) (cache incrémental dans `history/parlement_cache.json`) |
| Votations cantonales (depuis 2023) | Résultats par canton et par commune | [OFS](https://opendata.swiss/fr/dataset/echtzeitdaten-am-abstimmungstag-zu-kantonalen-abstimmungsvorlagen) |
| Presse | Articles des 14 derniers jours qui citent un parlementaire par son prénom et son nom | Flux RSS publics : Google Actualités (fr, de), Le Temps, Blick, SRF, NZZ, Tages-Anzeiger, Watson |
| Votations fédérales (depuis 2023) | Résultats, résultats par canton, mots d'ordre | [Swissvotes](https://swissvotes.ch/page/dataset), complété par l'[OFS](https://opendata.swiss/fr/dataset/echtzeitdaten-am-abstimmungstag-zu-eidgenoessischen-abstimmungsvorlagen) pour les cantons |

## Ce que fait le site

Six entrées : **Chercher** (accueil), **Classements** (avec Absences et Lobbyistes), **Jouer**, **Explorer** (Dons, Votations, Parlement, Réseaux, Nouveautés), **S'engager** et **Débats**.

- **Accueil** : votre canton et vos élus (mandats rémunérés, présence aux votes, votes contre le parti, liens d'intérêts potentiels, votre confiance), la prochaine et la dernière votation avec l'argent de chaque camp, puis « Dans l'actualité » (un élu cité par la presse des 14 derniers jours, flux RSS, avec sa fiche à côté ; sinon l'élu du jour tiré au sort), la question de la semaine (un chiffre du site, une question de fond, un sondage oui/non ; le site donne les chiffres, les lecteurs tranchent, puis défendent leur position dans les Débats), la prochaine votation et l'argent déclaré par chaque camp, le jeu « Vous votez comme quel élu ? », puis la recherche.
- **Cote de confiance** : « Faites-vous confiance à cet élu ? » Un vote par personne et par élu, modifiable, résultats publics sur l'accueil (par canton), sur chaque fiche et en classement par parti. Un élu entre dans les classements à partir de 10 votes. Ce n'est pas un sondage représentatif : ce sont les lecteurs du site.
- **S'engager** : voter (ch.ch, easyvote, smartvote), interpeller, adhérer ou donner. Liens officiels de chaque parti représenté aux Chambres (`site/partis.json`, à compléter), même format pour tous, ordre par sièges. Les clics sont comptés sans donnée personnelle et le compteur est public.
- **Chercher** : une seule barre pour les donateurs, bénéficiaires, élus, organisations et titulaires de badges. Chaque résultat ouvre une fiche, avec les liens croisés (une entreprise qui donne de l'argent ET qui a des élus dans ses conseils).
- **Dons** : tableau filtrable par type (élection, votation, parti), parti, secteur, année, camp (pour ou contre), montant. Export CSV.
- **Votations** : chaque objet fédéral depuis 2023, avec son résultat, la carte des cantons, les mots d'ordre, et l'argent du oui et du non (donateurs compris) quand les comités l'ont déclaré au CDF.
- **Parlement** : composition du Conseil national et du Conseil des États (hémicycles cliquables) ; votes nominaux du Conseil national (qui a voté quoi, par groupe) ; « les élus liés à un groupe d'intérêts votent-ils comme leur parti ? » ; puis vue par élu ou par mandat, filtres par parti, conseil, secteur, rémunération. Export CSV.
- **Tendances** : plus gros donateurs, argent par secteur, argent reçu par parti, budget du oui contre budget du non pour chaque votation, secteurs les plus présents au Parlement, mandats rémunérés par parti, évolution semaine après semaine.
- **Jouer** : « Vote comme un élu » (10 vrais votes du Conseil national, puis les élus et partis les plus proches), quiz de la semaine (renouvelé à chaque mise à jour), « Plus ou moins ? », « Mes élus » par canton. Chaque résultat se partage en image 1080 × 1350 (réseaux sociaux).
- **Liens d'intérêts potentiels** : les élus qui siègent dans une commission et sont rémunérés par une organisation du secteur qu'elle examine, ou y font entrer un lobbyiste (correspondance secteur → commission de Lobbywatch). Sur l'accueil, dans Lobbyistes, dans chaque fiche d'élu et en classement par parti. Un lien n'est pas une faute : c'est une information.
- **Classements** : quel parti reçoit le plus (par siège), l'argent gagne-t-il les votations, combien coûte une voix, donateurs de plusieurs partis, cumul de mandats rémunérés, nouveaux mandats depuis l'élection, qui fait entrer quels lobbyistes, frondeurs et absents au Conseil national. Chaque classement commence par la comparaison **par parti** (moyenne par élu), puis par élu, et a sa propre adresse (`#tendances:cumul`), reprise dans le texte partagé avec l'image.
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
- Le sondage de la question de la semaine passe par la même API (`/sondages/<id>`), un vote par appareil, modifiable. Les questions sont calculées dans `site/app.js` (`questions()`) et tournent chaque semaine ; une votation de moins de 14 jours passe devant. Pour forcer une question : `window.QF.QUESTION = "plafonner-dons"` dans `site/config.js`.
- Configuration publique (adresse de l'API, sitekey Turnstile) : `site/config.js`. L'onglet reste masqué tant qu'elle est vide.
- Secrets du Worker (`npx wrangler secret put`) : `TURNSTILE_SECRET`, `ADMIN_TOKEN`, `HASH_SALT`.
- En local : `npx wrangler d1 execute qui-finance-debats --local --file worker/schema.sql`, puis `npx wrangler dev --config worker/wrangler.toml` et `cd site && python3 -m http.server 8000` (clés de test Turnstile dans `worker/.dev.vars`, non versionné).

## Adapter les catégories

- `site/partis.json` : liens officiels des partis pour la page S'engager (`parti` doit correspondre au nom utilisé par Lobbywatch : UDC, PS, Le Centre, PLR, Verts, Vert'libéraux, PEV, UDF, MCG, Lega…).

- `config/secteurs.csv` : classe les donateurs par secteur (« motif;secteur », le motif est une expression régulière sur le nom en minuscules, sans accents). Les donateurs non couverts sont classés via Lobbywatch quand leur nom y figure.
- `config/alias_donateurs.csv` : regroupe les variantes d'un même donateur (« HEV Schweiz » et « Hauseigentümerverband (HEV) Schweiz »).

Un push sur ces fichiers relance la construction du site.

## Précautions de lecture

- **Votes et intérêts** : pour chaque groupe d'intérêts Lobbywatch (5 à 60 élus), on ne compare que les objets examinés par la commission de sa branche. Part de oui chez ces élus contre part attendue d'après le vote de leur propre groupe parlementaire ; écart « net » si |z| ≥ 3. Avec des centaines de scrutins par groupe, environ un écart net sur 370 est attendu par hasard : le site l'indique. Mandats actuels, pas forcément ceux du moment du vote ; un écart n'est pas une preuve d'influence. Conseil national seulement (le Conseil des États ne publie pas ses votes nominaux dans l'API).

- **Pas de double comptage** : pour chaque campagne, seul le décompte final est retenu, ou le budget tant que le décompte n'est pas publié.
- **Couverture partielle** : seules les instances nationales des partis sont soumises à la loi, pas les sections cantonales. Les petits dons (< 15 000 CHF aux partis) restent anonymes.
- **Rémunérations** : un mandat « non communiqué » n'est pas forcément bénévole.
- **Classement automatique** : les secteurs des donateurs sont déduits des noms et peuvent se tromper.
- **Si une source tombe**, le site garde les données de la semaine précédente et l'indique en bas de page.

## Licences

- Données CDF : « Open use », citer la source.
- Données Lobbywatch : CC BY-SA 4.0, citer Lobbywatch et partager aux mêmes conditions.
- Données Swissvotes : CC BY 4.0, citer « Swissvotes, Année politique suisse, Université de Berne ». Résultats cantonaux de l'OFS : « Open use ».
- Armoiries des cantons (`site/img/cantons/`) : fichiers de Wikimedia Commons, domaine public. Affichées à titre d'information, jamais comme emblème du site.
- Photos des parlementaires : © ParlCH (Services du Parlement), usage gratuit à des fins d'information avec mention de la source. Elles sont affichées depuis parlament.ch, pas copiées dans le dépôt.
- Code : GNU AGPL v3 (voir `LICENSE`). Toute version modifiée mise en ligne doit publier son code source sous la même licence. Les données restent sous la licence de leur source (CC BY-SA 4.0 pour tout ce qui dérive de Lobbywatch).

## Tester en local

```bash
python3 scripts/build.py          # télécharge les deux registres
cd site && python3 -m http.server # puis ouvrir http://localhost:8000
```
