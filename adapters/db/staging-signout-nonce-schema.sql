CREATE TABLE fretwise_staging_signout_nonces (
  nonce_hash text PRIMARY KEY CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
  expires_at_ms bigint NOT NULL
);
CREATE INDEX fretwise_staging_signout_nonces_expiry_idx ON fretwise_staging_signout_nonces (expires_at_ms);
