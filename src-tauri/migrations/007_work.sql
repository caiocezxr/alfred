CREATE TABLE work_companies (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 40 AND id GLOB '[a-z0-9]*' AND id NOT GLOB '*[^a-z0-9-]*'),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  color TEXT NOT NULL CHECK (length(color) = 7 AND color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
  logo TEXT CHECK (logo IS NULL OR (logo LIKE 'data:image/%' AND length(logo) <= 600000)),
  sort REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO work_companies (id, name, color, sort) VALUES
  ('statix', 'Statix', '#2D62DB', 1),
  ('livelo', 'Livelo', '#E5008C', 2),
  ('pessoal', 'Pessoal', '#8C8F96', 3);

CREATE TABLE work_items (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES work_companies (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 300),
  ticket TEXT CHECK (ticket IS NULL OR length(trim(ticket)) BETWEEN 1 AND 40),
  url TEXT CHECK (url IS NULL OR ((url LIKE 'http://_%' OR url LIKE 'https://_%') AND length(url) <= 2048)),
  kind TEXT NOT NULL DEFAULT 'chamado' CHECK (kind IN ('chamado', 'feature', 'bug', 'melhoria', 'pendencia')),
  system TEXT CHECK (system IS NULL OR length(trim(system)) BETWEEN 1 AND 80),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'alta', 'urgente')),
  due_date TEXT CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  requester TEXT CHECK (requester IS NULL OR length(trim(requester)) BETWEEN 1 AND 80),
  stage TEXT NOT NULL DEFAULT 'todo' CHECK (stage IN ('todo', 'doing', 'delivered', 'tested', 'validated', 'done')),
  stage_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  delivered_at TEXT,
  tested_at TEXT,
  validated_at TEXT,
  done_at TEXT,
  waiting_on TEXT CHECK (waiting_on IS NULL OR length(trim(waiting_on)) BETWEEN 1 AND 120),
  waiting_since TEXT,
  returns INTEGER NOT NULL DEFAULT 0 CHECK (returns >= 0),
  returned_at TEXT,
  return_open INTEGER NOT NULL DEFAULT 0 CHECK (return_open IN (0, 1)),
  followup_at TEXT,
  snoozed_until TEXT CHECK (snoozed_until IS NULL OR snoozed_until GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  focused_at TEXT,
  sort REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((waiting_on IS NULL) = (waiting_since IS NULL)),
  CHECK (stage <> 'done' OR (done_at IS NOT NULL AND waiting_on IS NULL AND focused_at IS NULL)),
  CHECK (stage IN ('delivered', 'tested', 'validated', 'done') OR (delivered_at IS NULL AND tested_at IS NULL AND validated_at IS NULL AND done_at IS NULL)),
  CHECK (return_open = 0 OR returned_at IS NOT NULL)
);

CREATE INDEX work_items_company_stage ON work_items (company_id, stage, sort);
CREATE INDEX work_items_stage ON work_items (stage, stage_at);
CREATE INDEX work_items_focus ON work_items (focused_at) WHERE focused_at IS NOT NULL;
CREATE INDEX work_items_ticket ON work_items (company_id, ticket) WHERE ticket IS NOT NULL;

CREATE TABLE work_events (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES work_items (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('created', 'stage', 'returned', 'resumed', 'waiting', 'unblocked', 'followup', 'note', 'due')),
  from_stage TEXT CHECK (from_stage IS NULL OR from_stage IN ('todo', 'doing', 'delivered', 'tested', 'validated', 'done')),
  to_stage TEXT CHECK (to_stage IS NULL OR to_stage IN ('todo', 'doing', 'delivered', 'tested', 'validated', 'done')),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  pending INTEGER CHECK (pending IS NULL OR pending >= 0),
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (kind <> 'stage' OR (from_stage IS NOT NULL AND to_stage IS NOT NULL AND from_stage <> to_stage)),
  CHECK (kind <> 'returned' OR length(trim(note)) > 0)
);

CREATE INDEX work_events_item ON work_events (item_id, at);
CREATE INDEX work_events_at ON work_events (at);

CREATE TABLE work_checklist (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES work_companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 120),
  sort REAL NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX work_checklist_company ON work_checklist (company_id, sort) WHERE archived_at IS NULL;

INSERT INTO work_checklist (id, company_id, label, sort) VALUES
  ('statix-local', 'statix', 'Testei localmente', 1),
  ('statix-testes', 'statix', 'Rodei os testes', 2),
  ('statix-sql', 'statix', 'Revisei o SQL e os índices', 3),
  ('statix-chamado', 'statix', 'Atualizei o chamado', 4),
  ('statix-avisei', 'statix', 'Avisei quem pediu', 5),
  ('livelo-hml', 'livelo', 'Testei em homologação', 1),
  ('livelo-pr', 'livelo', 'PR revisado', 2),
  ('livelo-evidencias', 'livelo', 'Evidências anexadas no ticket', 3),
  ('livelo-time', 'livelo', 'Avisei o time', 4);

CREATE TABLE work_item_checks (
  item_id TEXT NOT NULL REFERENCES work_items (id) ON DELETE CASCADE,
  check_id TEXT NOT NULL REFERENCES work_checklist (id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (item_id, check_id)
);

CREATE INDEX work_item_checks_check ON work_item_checks (check_id);

CREATE TABLE work_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  wip_limit INTEGER NOT NULL DEFAULT 3 CHECK (wip_limit BETWEEN 1 AND 20),
  validation_days INTEGER NOT NULL DEFAULT 2 CHECK (validation_days BETWEEN 0 AND 60),
  waiting_days INTEGER NOT NULL DEFAULT 2 CHECK (waiting_days BETWEEN 0 AND 60),
  stale_days INTEGER NOT NULL DEFAULT 4 CHECK (stale_days BETWEEN 1 AND 60),
  return_days INTEGER NOT NULL DEFAULT 0 CHECK (return_days BETWEEN 0 AND 60),
  close_days INTEGER NOT NULL DEFAULT 2 CHECK (close_days BETWEEN 0 AND 60),
  notify_reminders INTEGER NOT NULL DEFAULT 1 CHECK (notify_reminders IN (0, 1)),
  notify_due INTEGER NOT NULL DEFAULT 1 CHECK (notify_due IN (0, 1)),
  notify_validation INTEGER NOT NULL DEFAULT 1 CHECK (notify_validation IN (0, 1)),
  notify_hour INTEGER NOT NULL DEFAULT 9 CHECK (notify_hour BETWEEN 0 AND 23),
  tasks_imported INTEGER NOT NULL DEFAULT 0 CHECK (tasks_imported IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO work_settings (id) VALUES (1);

CREATE TABLE work_todos (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES work_companies (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 300),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'alta', 'urgente')),
  mode TEXT NOT NULL DEFAULT 'fixed' CHECK (mode IN ('daily', 'fixed', 'dated')),
  weekdays_only INTEGER NOT NULL DEFAULT 0 CHECK (weekdays_only IN (0, 1)),
  due_date TEXT CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  remind_time TEXT CHECK (remind_time IS NULL OR remind_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  must_not_forget INTEGER NOT NULL DEFAULT 0 CHECK (must_not_forget IN (0, 1)),
  done_at TEXT,
  item_id TEXT REFERENCES work_items (id) ON DELETE SET NULL,
  sort REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((mode = 'dated') = (due_date IS NOT NULL)),
  CHECK (mode <> 'daily' OR done_at IS NULL),
  CHECK (mode = 'daily' OR weekdays_only = 0)
);

CREATE INDEX work_todos_open ON work_todos (company_id, mode, sort) WHERE done_at IS NULL;
CREATE INDEX work_todos_done ON work_todos (done_at) WHERE done_at IS NOT NULL;

CREATE TABLE work_todo_checks (
  todo_id TEXT NOT NULL REFERENCES work_todos (id) ON DELETE CASCADE,
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  checked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (todo_id, date)
);

CREATE INDEX work_todo_checks_date ON work_todo_checks (date);

CREATE TABLE work_attachments (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES work_items (id) ON DELETE CASCADE,
  rel_path TEXT NOT NULL UNIQUE CHECK (rel_path GLOB 'work-assets/*' AND rel_path NOT LIKE '%..%'),
  mime TEXT NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  size INTEGER NOT NULL CHECK (size BETWEEN 1 AND 10485760),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX work_attachments_item ON work_attachments (item_id, created_at);

CREATE TABLE work_secrets (
  id TEXT PRIMARY KEY,
  item_id TEXT REFERENCES work_items (id) ON DELETE CASCADE,
  company_id TEXT REFERENCES work_companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((item_id IS NULL) <> (company_id IS NULL))
);

CREATE INDEX work_secrets_item ON work_secrets (item_id) WHERE item_id IS NOT NULL;
CREATE INDEX work_secrets_company ON work_secrets (company_id) WHERE company_id IS NOT NULL;

CREATE TABLE work_days (
  date TEXT PRIMARY KEY CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  green INTEGER NOT NULL CHECK (green IN (0, 1)),
  open_count INTEGER NOT NULL DEFAULT 0 CHECK (open_count >= 0),
  handled_count INTEGER NOT NULL DEFAULT 0 CHECK (handled_count >= 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
