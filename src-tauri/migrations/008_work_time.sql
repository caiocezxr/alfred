CREATE TABLE work_sessions (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES work_items (id) ON DELETE CASCADE,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ended_at TEXT,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE UNIQUE INDEX work_sessions_running ON work_sessions ((ended_at IS NULL)) WHERE ended_at IS NULL;
CREATE INDEX work_sessions_item ON work_sessions (item_id, started_at);
CREATE INDEX work_sessions_started ON work_sessions (started_at);
