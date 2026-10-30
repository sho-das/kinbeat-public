CREATE TABLE admins (
  id         text PRIMARY KEY,
  email      text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login timestamptz
);

CREATE TABLE login_tokens (
  token_hash text PRIMARY KEY,
  admin_id   text NOT NULL REFERENCES admins (id) ON DELETE CASCADE,
  bind_hash  text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  ip         text
);
CREATE INDEX login_tokens_exp_idx ON login_tokens (expires_at);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  admin_id   text NOT NULL REFERENCES admins (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ip         text,
  user_agent text
);
CREATE INDEX sessions_admin_idx ON sessions (admin_id);
CREATE INDEX sessions_exp_idx ON sessions (expires_at);
