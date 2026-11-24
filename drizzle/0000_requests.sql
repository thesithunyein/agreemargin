CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  owner_hash TEXT NOT NULL,
  client_hash TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'decided', 'withdrawn')),
  choice TEXT,
  respondent TEXT,
  decided_at INTEGER
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS creation_limits (
  visitor TEXT PRIMARY KEY,
  window_end INTEGER NOT NULL,
  count INTEGER NOT NULL
);
