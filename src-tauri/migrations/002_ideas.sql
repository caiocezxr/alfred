
CREATE TABLE ideas (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('product', 'content')),
  title         TEXT NOT NULL CHECK (length(trim(title)) > 0 AND length(title) <= 200),
  description   TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 5000),
  answers       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(answers) AND json_type(answers) = 'object'),
  status        TEXT NOT NULL DEFAULT 'captured'
                CHECK (status IN ('captured', 'evaluating', 'testing', 'paused', 'archived')),
  next_test     TEXT CHECK (next_test IS NULL OR (json_valid(next_test) AND json_type(next_test) = 'object')),
  decision      TEXT CHECK (decision IS NULL OR decision IN ('continue', 'adjust', 'archive')),
  decision_note TEXT NOT NULL DEFAULT '' CHECK (length(decision_note) <= 2000),
  decided_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((decision IS NULL) = (decided_at IS NULL))
);
CREATE INDEX ideas_by_status ON ideas (status, created_at DESC);

CREATE TABLE idea_evidence (
  id         TEXT PRIMARY KEY,
  idea_id    TEXT NOT NULL REFERENCES ideas (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('note', 'result')),
  criterion  TEXT CHECK (criterion IS NULL OR length(criterion) BETWEEN 1 AND 24),
  signal     TEXT NOT NULL DEFAULT 'neutral' CHECK (signal IN ('supports', 'contradicts', 'neutral')),
  text       TEXT NOT NULL DEFAULT '' CHECK (length(text) <= 4000),
  url        TEXT CHECK (url IS NULL OR ((url LIKE 'http://_%' OR url LIKE 'https://_%') AND length(url) <= 2048)),
  metric     TEXT CHECK (metric IS NULL OR length(trim(metric)) BETWEEN 1 AND 120),
  value      REAL,
  cost       REAL CHECK (cost IS NULL OR cost >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (kind <> 'result' OR (metric IS NOT NULL AND value IS NOT NULL)),
  CHECK (kind <> 'note' OR length(trim(text)) > 0 OR url IS NOT NULL)
);
CREATE INDEX idea_evidence_by_idea ON idea_evidence (idea_id, created_at);
