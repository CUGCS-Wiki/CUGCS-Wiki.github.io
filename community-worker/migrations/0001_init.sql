PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id INTEGER NOT NULL UNIQUE,
  login TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT NOT NULL,
  profile_url TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'moderator', 'admin')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  return_to TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_oauth_states_expires ON oauth_states(expires_at);

CREATE TABLE login_tickets (
  ticket_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_login_tickets_expires ON login_tickets(expires_at);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE topics (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('question', 'proposal', 'page')),
  page_key TEXT,
  category TEXT,
  title TEXT NOT NULL,
  author_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL,
  accepted_post_id TEXT,
  reply_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  deleted_at INTEGER,
  UNIQUE(kind, page_key)
);

CREATE INDEX idx_topics_kind_activity ON topics(kind, last_activity_at DESC);
CREATE INDEX idx_topics_status_activity ON topics(status, last_activity_at DESC);

CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('body', 'answer', 'comment')),
  body_markdown TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX idx_posts_topic_created ON posts(topic_id, created_at);
CREATE INDEX idx_posts_author ON posts(author_id);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id),
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by INTEGER REFERENCES users(id),
  UNIQUE(post_id, reporter_id)
);

CREATE INDEX idx_reports_status ON reports(status, created_at);

CREATE TABLE moderation_events (
  id TEXT PRIMARY KEY,
  actor_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE rate_limits (
  bucket_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_started_at INTEGER NOT NULL
);
