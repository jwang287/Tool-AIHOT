-- A source's latest snapshot, and its fetch history.
CREATE INDEX CONCURRENTLY IF NOT EXISTS lb_snapshots_source_idx ON lb_snapshots (source_key, fetched_at DESC);
