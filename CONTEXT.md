# CONTEXT — « Qui finance ? » (état au 28.09.2026)

À lire en début de session. Le README décrit le site pour le public ; ce fichier décrit **comment il est construit, ce qui a été décidé et où on en est**.

## En une phrase
Site statique de transparence politique suisse (« Transparence démocratique ») : il croise **l'argent** (dons CDF), **l'influence** (mandats et badges Lobbywatch) et **les votes** (votations fédérales et cantonales, votes nominaux du Conseil national). Sa valeur n'est pas de refaire Lobbywatch mais de **croiser** ces sources, en français, avec des formats partageables.

- En ligne : https://dowdow27.github.io/qui-finance/ (GitHub Pages)
- Repo public : `dowdow27/qui-finance`. Code sous **AGPL v3** ; données sous la licence de leur source (CC BY-SA pour tout ce qui dérive de Lobbywatch, qu'on ne peut donc pas « fermer »).
- Mise à jour automatique chaque **lundi 07:00 UTC** (GitHub Actions), et à chaque push touchant `site/`, `scripts/` ou `config/`.

## Architecture
| Élément | Rôle |
|---|---|
| `scripts/build.py` | Python standard uniquement. Télécharge les sources, écrit `site/data/*.json` et `history/`. Chaque source a son `try/except` : si elle tombe, on garde les données précédentes et le pied de page le signale. |
| `site/` | HTML / CSS / JS sans framework ni bundler (`app.js` ≈ 1 400 lignes). Seuls scripts externes : Google Fonts et Cloudflare Turnstile (débats). |
| `worker/` | API des Débats : Cloudflare Worker + D1, JavaScript sans dépendance. |
| `history/parlement_cache.json` | Cache versionné des votes nominaux (une ligne par scrutin). `CACHE_VERSION` dans `build.py` : l'incrémenter quand le codage change, le cache se reconstruit (~2 min 45). |
| `config/` | Fichiers édités à la main : `secteurs.csv`, `alias_donateurs.csv`, `contexte_elus.csv` (note sourcée affichée à côté des chiffres sensibles, ex. absences). |
| `.github/workflows/update.yml` | Build → commit des données par le bot (`git pull --rebase` avant `push`) → déploiement Pages. |

Fichiers de données : `argent.json` (dons, campagnes), `lobby.json` (élus, liens, badges), `votations.json`, `parlement.json` (votes nominaux + stats, chargé à la demande), `cantonal.json` (chargé à la demande), `changes.json`, `timeline.json`, `meta.json` (statut des sources, compteurs).

## Sources et pièges connus
- **CDF** (dons) : miroir CSV `lgnbhl/swiss-political-financing`. Un seul décompte par campagne (final, sinon budget). Obligation de déclarer depuis le 23.10.2023, campagnes > 50 000 CHF. Deux objets le même jour peuvent partager une campagne (bail, 24.11.2024).
- **Lobbywatch** : export JSON agrégé. `verguetung` : -1 = membre cotisant (pas rémunéré), 0 = bénévole, 1 = rémunéré sans montant, 2 / 2502 / 5002 / 10002 / 25002 / 50002 / 100002 = fourchettes, pas des montants. Le portail `daten.lobbywatch.ch` peut renvoyer une erreur 500 : lien de secours vers parlament.ch.
- **Identifiants parlament.ch** : `parlament_number` de Lobbywatch = `PersonIdCode` (sert **seulement aux photos**) ; `parlament_biografie_id` = `PersonNumber` (biographie **et** votes nominaux). Ne pas les confondre.
- **Photos** : `parlament.ch/SiteCollectionImages/profil/portrait-260/{parlament_number}.jpg`, mention « © ParlCH » obligatoire.
- **Votations fédérales** : swissvotes.ch (CC BY 4.0). Les résultats par canton et les voix y arrivent avec retard : on les complète avec l'OFS (`ogd-static.voteinfo-app.ch/…-eidgAbstimmung.json`, `vorlagenId` = numéro swissvotes × 10). `gesch_nr` relie une votation au vote final du Conseil national.
- **Votations cantonales** : OFS `…-kantAbstimmung.json` (liste via l'API CKAN d'opendata.swiss), 26 cantons, résultats par commune ; Vaud et Genève affichés par défaut. Pas de financement cantonal (le CDF est fédéral seulement).
- **Votes nominaux** : OData `ws.parlament.ch/odata.svc`, **Conseil national seulement** (le Conseil des États ne publie pas ses votes nominaux sous cette forme). Filtrer par plage d'`IdVote` (≈ 0,6 s par requête) plutôt que par session (≈ 15 s). Codes : 1 oui, 2 non, 3 abstention, 5 n'a pas participé, 6 excusé (art. 57 al. 4 LParl), 7 président. Certains libellés restent en allemand (traduits côté site : `trVote`).

## Méthodes (à garder honnêtes)
- **Élus liés à un groupe d'intérêts contre leur parti** : groupes Lobbywatch de 5 à 60 élus, comparés **seulement sur les objets de la commission de leur branche** (entité `Preconsultation`) ; part de oui observée contre part attendue d'après le groupe de chaque élu sans lui ; « net » si |z| ≥ 3 ; le site affiche le nombre d'écarts **attendus par hasard** (≈ 1 sur 370). Sans le filtre par commission, les résultats étaient du bruit.
- **Frondeurs** : comparés à la majorité des **autres élus de leur parti** ; les partis à 1-2 sièges (PEV, UDF, MCG, Lega…) sont présentés à part.
- **Absences** : non excusées, excusées et total côte à côte ; tri par défaut sur les non excusées. Les données ne disent pas pourquoi un élu était absent : `contexte_elus.csv` pour les cas publics (Philipp Kutter, accident de 2023).
- **Ligne éditoriale** : clivant mais factuel, même règle pour tous les partis, chiffres sourcés, titres en questions, jamais d'insinuation ni d'appel à la démission. Un lien n'est pas une faute.

## Fonctionnalités en ligne (onglets)
Chercher (avec « À la une ») · Jouer (Vote comme un élu, quiz de la semaine, Plus ou moins, Mes élus) · Absences · Lobbyistes (353 badges, 205 lobbyistes) · Réseaux (carte à bulles façon Obsidian/Bubblemaps) · Dons · Votations (fédéral / cantonal) · Parlement (hémicycles, votes au Conseil national, intérêts × votes) · Classements (argent gagne-t-il, coût par voix, multi-partis, cumul, nouveaux mandats, frondeurs, absents) · Débats · Nouveautés.
Images à partager 1080 × 1350 générées dans le navigateur (`shareCard`, `shareNet`).

## Débats (forum d'hypothèses)
- Pseudo sans compte, **tout modéré avant publication** sur `site/admin.html` (mot de passe dans le gestionnaire du propriétaire).
- Chaque hypothèse cite au moins une fiche (`donor`, `recip`, `elu`, `org`, `vote`, `scrutin`, `cantonal`). Une contribution éditoriale peut être insérée directement en D1 (`wrangler d1 execute --remote`), signée « Qui finance ? (rédaction) ».
- Aucune IP en clair (empreinte salée), 5 contributions par jour, Turnstile sur chaque envoi et vote.
- Configuration publique : `site/config.js` (adresse de l'API, sitekey). Secrets du Worker : `TURNSTILE_SECRET`, `ADMIN_TOKEN`, `HASH_SALT`, **jamais** dans le repo ni dans le chat.

## Commandes
```bash
python3 scripts/build.py                       # tout reconstruire en local (≈ 20 s, 3 min si le cache des votes est vide)
cd site && python3 -m http.server 8000         # voir le site en local
```
- Avant de commiter : `git checkout -- site/data history/timeline.csv` (c'est le bot qui commite les données) ; **commiter** `history/parlement_cache.json` s'il a été reconstruit.
- Tester dans le navigateur : le cache garde l'ancien `app.js` → `fetch('app.js', {cache: 'reload'})` puis recharger.
- Worker : depuis `worker/`, `npx wrangler deploy` ; en local `npx wrangler dev` (clés de test Turnstile dans `worker/.dev.vars`, non versionné).

## À faire / pistes
- Genève : absences **excusées** des députés (listes « Ont fait excuser leur absence » du Mémorial, depuis 2023). Vaud : vote secret par défaut (motion refusée 64-59), à montrer comme information.
- Réseaux : option pour masquer les intergroupes parlementaires (Sport, Abeilles…) qui dominent les carrefours.
- Actions GitHub encore sur Node 20 (dépréciation) : passer aux versions récentes.
- Plus tard : nom de domaine, connexion par email aux débats, financement des campagnes cantonales (registres GE, NE, FR…).
