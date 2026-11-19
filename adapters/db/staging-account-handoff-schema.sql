CREATE TABLE fretwise_staging_account_handoffs (
  code_hash text PRIMARY KEY CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  browser_hash text NOT NULL CHECK (browser_hash ~ '^[0-9a-f]{64}$'),
  session_ref text NOT NULL,
  customer_id integer NOT NULL CHECK (customer_id IN (23003226, 23003227)),
  destination jsonb NOT NULL,
  expires_at_ms bigint NOT NULL
);
CREATE INDEX fretwise_staging_account_handoffs_expiry_idx ON fretwise_staging_account_handoffs (expires_at_ms);
