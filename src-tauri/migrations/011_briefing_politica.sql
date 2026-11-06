CREATE TABLE briefing_sources_v2 (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  url TEXT NOT NULL UNIQUE CHECK (url LIKE 'https://%' AND length(url) <= 2048),
  area TEXT NOT NULL CHECK (area IN ('dinheiro', 'codigo', 'ia', 'potencializa', 'seguranca', 'politica', 'mundo')),
  lang TEXT NOT NULL DEFAULT 'pt' CHECK (lang IN ('pt', 'en')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  weight REAL NOT NULL DEFAULT 1 CHECK (weight BETWEEN 0.2 AND 2),
  builtin INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0, 1)),
  last_status TEXT CHECK (last_status IS NULL OR last_status IN ('ok', 'error')),
  last_error TEXT CHECK (last_error IS NULL OR length(last_error) <= 400),
  last_fetched_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO briefing_sources_v2 (id, name, url, area, lang, enabled, weight, builtin, last_status, last_error, last_fetched_at, created_at, updated_at)
  SELECT id, name, url, area, lang, enabled, weight, builtin, last_status, last_error, last_fetched_at, created_at, updated_at FROM briefing_sources;
DROP TABLE briefing_sources;
ALTER TABLE briefing_sources_v2 RENAME TO briefing_sources;
CREATE INDEX briefing_sources_area ON briefing_sources (area, enabled);

CREATE TABLE briefing_feedback_v2 (
  id TEXT PRIMARY KEY,
  edition_date TEXT NOT NULL CHECK (edition_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  item_key TEXT NOT NULL CHECK (length(item_key) BETWEEN 1 AND 2048),
  signal TEXT NOT NULL CHECK (signal IN ('up', 'down', 'interest')),
  reason TEXT CHECK (reason IS NULL OR reason IN ('more', 'knew', 'shallow', 'not_mine')),
  origin TEXT NOT NULL CHECK (origin IN ('slide', 'triage', 'left_out')),
  area TEXT CHECK (area IS NULL OR area IN ('dinheiro', 'codigo', 'ia', 'potencializa', 'seguranca', 'politica', 'mundo')),
  source_id TEXT,
  source_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 400),
  original_title TEXT NOT NULL DEFAULT '',
  kept INTEGER NOT NULL DEFAULT 0 CHECK (kept IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (edition_date, item_key),
  CHECK (reason IS NULL OR (signal = 'up' AND reason = 'more') OR (signal = 'down' AND reason IN ('knew', 'shallow', 'not_mine')))
);
INSERT INTO briefing_feedback_v2 (id, edition_date, item_key, signal, reason, origin, area, source_id, source_name, title, original_title, kept, created_at, updated_at)
  SELECT id, edition_date, item_key, signal, reason, origin, area, source_id, source_name, title, original_title, kept, created_at, updated_at FROM briefing_feedback;
DROP TABLE briefing_feedback;
ALTER TABLE briefing_feedback_v2 RENAME TO briefing_feedback;
CREATE INDEX briefing_feedback_recent ON briefing_feedback (updated_at DESC);
CREATE INDEX briefing_feedback_source ON briefing_feedback (source_id);
