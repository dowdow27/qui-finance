-- Débats : hypothèses fondées sur les données du site. Aucune IP ni email en clair.
CREATE TABLE IF NOT EXISTS hypotheses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pseudo TEXT NOT NULL,
  titre TEXT NOT NULL,
  texte TEXT NOT NULL,
  refs TEXT NOT NULL,                 -- JSON : [{type, key, label}], clés de openSheet() dans site/app.js
  statut TEXT NOT NULL DEFAULT 'attente' CHECK (statut IN ('attente', 'publie', 'refuse')),
  motif_refus TEXT,
  auteur_hash TEXT NOT NULL,          -- sha256(sel + IP), pour limiter le débit
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  publie_le TEXT
);
CREATE INDEX IF NOT EXISTS hyp_statut ON hypotheses (statut, publie_le);
CREATE INDEX IF NOT EXISTS hyp_auteur ON hypotheses (auteur_hash, cree_le);

CREATE TABLE IF NOT EXISTS commentaires (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hypothese_id INTEGER NOT NULL REFERENCES hypotheses (id) ON DELETE CASCADE,
  pseudo TEXT NOT NULL,
  texte TEXT NOT NULL,
  statut TEXT NOT NULL DEFAULT 'attente' CHECK (statut IN ('attente', 'publie', 'refuse')),
  motif_refus TEXT,
  auteur_hash TEXT NOT NULL,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  publie_le TEXT
);
CREATE INDEX IF NOT EXISTS com_hyp ON commentaires (hypothese_id, statut);
CREATE INDEX IF NOT EXISTS com_auteur ON commentaires (auteur_hash, cree_le);

CREATE TABLE IF NOT EXISTS votes (
  hypothese_id INTEGER NOT NULL REFERENCES hypotheses (id) ON DELETE CASCADE,
  votant_hash TEXT NOT NULL,          -- sha256(sel + identifiant d'appareil)
  ip_hash TEXT NOT NULL,
  valeur INTEGER NOT NULL CHECK (valeur IN (-1, 1)),
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (hypothese_id, votant_hash)
);
CREATE INDEX IF NOT EXISTS vote_ip ON votes (hypothese_id, ip_hash);

-- Sondages : la question de la semaine (site/app.js, questions()). Un vote par appareil, plafonné par connexion.
CREATE TABLE IF NOT EXISTS sondages (
  question TEXT NOT NULL,             -- identifiant de la question, ex. « plafonner-dons »
  votant_hash TEXT NOT NULL,          -- sha256(sel + identifiant d'appareil)
  ip_hash TEXT NOT NULL,
  valeur INTEGER NOT NULL CHECK (valeur IN (-1, 1)),
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (question, votant_hash)
);
CREATE INDEX IF NOT EXISTS sond_ip ON sondages (question, ip_hash);

-- Cote de confiance : « Faites-vous confiance à cet élu ? » Un vote par appareil et par élu, modifiable, plafonné par connexion.
CREATE TABLE IF NOT EXISTS confiance (
  elu INTEGER NOT NULL,               -- identifiant Lobbywatch de l'élu (lobby.json)
  votant_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  valeur INTEGER NOT NULL CHECK (valeur IN (-1, 1)),
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  maj_le TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (elu, votant_hash)
);
CREATE INDEX IF NOT EXISTS conf_ip ON confiance (elu, ip_hash);

-- Clics sortants de la page S'engager (« udc:adherer »), un par connexion et par jour, aucune donnée personnelle
CREATE TABLE IF NOT EXISTS clics (
  cible TEXT NOT NULL,
  jour TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  PRIMARY KEY (cible, jour, ip_hash)
);
