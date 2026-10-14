-- What one fetched snapshot contributed.
CREATE INDEX CONCURRENTLY IF NOT EXISTS lb_scores_snapshot_idx ON lb_scores (snapshot_id);
