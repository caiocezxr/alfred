
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL CHECK (length(trim(title)) > 0),
  note        TEXT NOT NULL DEFAULT '',
  due_date    TEXT CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  priority    INTEGER NOT NULL DEFAULT 0 CHECK (priority IN (0, 1)),
  sort        REAL NOT NULL,
  done_at     TEXT,
  archived_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX tasks_open ON tasks (due_date, sort) WHERE done_at IS NULL AND archived_at IS NULL;

CREATE TABLE habits (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL CHECK (length(trim(name)) > 0),
  time_of_day   TEXT,
  cue           TEXT NOT NULL DEFAULT '',
  minimum       TEXT NOT NULL DEFAULT '',
  why           TEXT NOT NULL DEFAULT '',
  obstacle_plan TEXT NOT NULL DEFAULT '',
  start_date    TEXT NOT NULL,
  sort          REAL NOT NULL,
  archived_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE habit_schedules (
  habit_id  TEXT NOT NULL REFERENCES habits (id) ON DELETE CASCADE,
  from_date TEXT NOT NULL,
  days      INTEGER NOT NULL CHECK (days BETWEEN 1 AND 127),
  PRIMARY KEY (habit_id, from_date)
);

CREATE TABLE habit_pauses (
  habit_id  TEXT NOT NULL REFERENCES habits (id) ON DELETE CASCADE,
  from_date TEXT NOT NULL,
  to_date   TEXT,
  PRIMARY KEY (habit_id, from_date)
);

CREATE TABLE habit_checkins (
  habit_id   TEXT NOT NULL REFERENCES habits (id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('done', 'minimum')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (habit_id, date)
);
