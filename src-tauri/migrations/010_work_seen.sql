CREATE TABLE work_seen (
  company_id TEXT PRIMARY KEY REFERENCES work_companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

ALTER TABLE work_settings ADD COLUMN notify_neglect INTEGER NOT NULL DEFAULT 1 CHECK (notify_neglect IN (0, 1));
ALTER TABLE work_settings ADD COLUMN neglect_hour INTEGER NOT NULL DEFAULT 11 CHECK (neglect_hour BETWEEN 0 AND 23);
ALTER TABLE work_settings ADD COLUMN neglect_days INTEGER NOT NULL DEFAULT 3 CHECK (neglect_days BETWEEN 1 AND 60);
ALTER TABLE work_settings ADD COLUMN quiet_start INTEGER NOT NULL DEFAULT 20 CHECK (quiet_start BETWEEN 0 AND 23);
ALTER TABLE work_settings ADD COLUMN quiet_end INTEGER NOT NULL DEFAULT 8 CHECK (quiet_end BETWEEN 0 AND 23);
