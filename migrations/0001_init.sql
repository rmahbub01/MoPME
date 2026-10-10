CREATE TABLE notices (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  published_on TEXT,
  first_seen_at INTEGER NOT NULL
);
CREATE TABLE deliveries (
  notice_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  delivered_at INTEGER NOT NULL,
  PRIMARY KEY (notice_id, chat_id)
);
CREATE TABLE source_state (
  source_id TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  alerted INTEGER NOT NULL DEFAULT 0,
  last_ok_at INTEGER,
  last_error TEXT
);
CREATE TABLE worker_locks (
  name TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
