CREATE TABLE day_checkins (
  date TEXT PRIMARY KEY CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  mood INTEGER CHECK (mood IS NULL OR mood BETWEEN 1 AND 5),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 280),
  coffee INTEGER CHECK (coffee IS NULL OR coffee IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
