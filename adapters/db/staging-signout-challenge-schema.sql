-- Staging experiment only. Do not apply to production.
CREATE TABLE fretwise_staging_signout_challenges (
  challenge_hash text PRIMARY KEY CHECK (challenge_hash ~ '^[0-9a-f]{64}$'),
  binding_hash text NOT NULL CHECK (binding_hash ~ '^[0-9a-f]{64}$'),
  subject text NOT NULL CHECK (subject IN ('23003226', '23003227')),
  direction text NOT NULL CHECK (direction IN ('wordpress-to-lms', 'lms-to-wordpress')),
  expires_at_ms bigint NOT NULL
);
CREATE INDEX fretwise_staging_signout_challenges_expiry_idx ON fretwise_staging_signout_challenges (expires_at_ms);
