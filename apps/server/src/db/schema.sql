PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS slot_template (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  description TEXT    NOT NULL DEFAULT '',
  is_preset   INTEGER NOT NULL DEFAULT 0 CHECK (is_preset IN (0, 1)),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS time_slot (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id  INTEGER NOT NULL REFERENCES slot_template(id) ON DELETE CASCADE,
  label        TEXT    NOT NULL,
  start_time   TEXT,
  end_time     TEXT,
  day_part     TEXT    NOT NULL DEFAULT 'morning' CHECK (day_part IN ('morning', 'afternoon', 'evening')),
  duration_min INTEGER NOT NULL DEFAULT 90 CHECK (duration_min BETWEEN 5 AND 720),
  sort_order   INTEGER NOT NULL,
  UNIQUE (template_id, sort_order),
  UNIQUE (template_id, label)
);
CREATE INDEX IF NOT EXISTS ix_time_slot_template ON time_slot(template_id, sort_order);

CREATE TABLE IF NOT EXISTS semester (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT    NOT NULL,
  start_date         TEXT    NOT NULL,
  total_weeks        INTEGER NOT NULL CHECK (total_weeks BETWEEN 1 AND 60),
  week1_parity       TEXT    NOT NULL DEFAULT 'odd' CHECK (week1_parity IN ('odd', 'even')),
  active_template_id INTEGER REFERENCES slot_template(id) ON DELETE RESTRICT,
  is_active          INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_semester_active ON semester(is_active) WHERE is_active = 1;

CREATE TABLE IF NOT EXISTS app_user (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  color      TEXT    NOT NULL DEFAULT '#6366F1' CHECK (length(color) = 7),
  note       TEXT    NOT NULL DEFAULT '',
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS ix_app_user_active ON app_user(is_active, sort_order);

CREATE TABLE IF NOT EXISTS schedule (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  semester_id INTEGER NOT NULL REFERENCES semester(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  slot_id     INTEGER NOT NULL REFERENCES time_slot(id) ON DELETE RESTRICT,
  start_week  INTEGER NOT NULL CHECK (start_week >= 1),
  end_week    INTEGER NOT NULL CHECK (end_week >= start_week AND end_week <= 60),
  parity      TEXT    NOT NULL DEFAULT 'all' CHECK (parity IN ('all', 'odd', 'even')),
  note        TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS ix_schedule_user_week ON schedule(semester_id, user_id, weekday, start_week, end_week);
CREATE INDEX IF NOT EXISTS ix_schedule_slot ON schedule(slot_id);

CREATE TABLE IF NOT EXISTS schedule_occurrence (
  semester_id INTEGER NOT NULL REFERENCES semester(id) ON DELETE CASCADE,
  week_no     INTEGER NOT NULL CHECK (week_no >= 1),
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  slot_id     INTEGER NOT NULL REFERENCES time_slot(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  schedule_id INTEGER NOT NULL REFERENCES schedule(id) ON DELETE CASCADE,
  PRIMARY KEY (semester_id, week_no, weekday, slot_id, user_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_occ_schedule ON schedule_occurrence(schedule_id);
CREATE INDEX IF NOT EXISTS ix_occ_user_week ON schedule_occurrence(semester_id, user_id, week_no);

CREATE TABLE IF NOT EXISTS algo_config (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  weights_json TEXT NOT NULL,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
