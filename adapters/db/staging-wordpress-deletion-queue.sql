CREATE TABLE IF NOT EXISTS staging_wordpress_deletion_jobs (
  issuer text NOT NULL,
  event_id text NOT NULL,
  subject text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'running', 'done')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_id text,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (issuer, event_id)
);
