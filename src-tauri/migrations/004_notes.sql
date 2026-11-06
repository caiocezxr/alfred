
CREATE TABLE notes (
  rid         INTEGER PRIMARY KEY,
  id          TEXT NOT NULL UNIQUE CHECK (length(id) BETWEEN 1 AND 64),
  parent_id   TEXT REFERENCES notes (id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 500),
  doc         TEXT NOT NULL DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}' CHECK (json_valid(doc)),
  plain_text  TEXT NOT NULL DEFAULT '',
  sort        REAL NOT NULL DEFAULT 0,
  archived_at TEXT,
  trashed_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX notes_children ON notes (parent_id, sort);
CREATE INDEX notes_recent ON notes (updated_at DESC);
CREATE INDEX notes_in_trash ON notes (trashed_at) WHERE trashed_at IS NOT NULL;

CREATE TABLE note_assets (
  id         TEXT PRIMARY KEY,
  note_id    TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
  rel_path   TEXT NOT NULL UNIQUE CHECK (rel_path GLOB 'note-assets/?*' AND rel_path NOT GLOB '*..*'),
  mime       TEXT NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  size       INTEGER NOT NULL CHECK (size > 0 AND size <= 10485760),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX note_assets_by_note ON note_assets (note_id);

CREATE VIRTUAL TABLE notes_fts USING fts5 (
  title,
  plain_text,
  content = 'notes',
  content_rowid = 'rid',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER notes_fts_insert AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts (rowid, title, plain_text) VALUES (new.rid, new.title, new.plain_text);
END;

CREATE TRIGGER notes_fts_delete AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts (notes_fts, rowid, title, plain_text) VALUES ('delete', old.rid, old.title, old.plain_text);
END;

CREATE TRIGGER notes_fts_update AFTER UPDATE OF title, plain_text ON notes BEGIN
  INSERT INTO notes_fts (notes_fts, rowid, title, plain_text) VALUES ('delete', old.rid, old.title, old.plain_text);
  INSERT INTO notes_fts (rowid, title, plain_text) VALUES (new.rid, new.title, new.plain_text);
END;
