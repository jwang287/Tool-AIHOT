-- One fetched upstream file, as it arrived; the evidence rows refer to it.
CREATE TABLE lb_snapshots (
    id text NOT NULL,
    source_key text NOT NULL,
    source_name text NOT NULL,
    source_url text,
    license text,
    attribution_url text,
    content_hash text,
    published_at timestamptz,
    fetched_at timestamptz NOT NULL,
    record_count integer NOT NULL DEFAULT 0,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (id)
);
