-- Reading the posts newest first (the admin list and the page's context lookups).
CREATE INDEX CONCURRENTLY IF NOT EXISTS monitor_posts_time_idx ON monitor_posts (published_at DESC);
