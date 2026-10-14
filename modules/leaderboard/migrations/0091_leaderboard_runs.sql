-- One leaderboard computation: the inputs it read and what it concluded (summary).
CREATE TABLE lb_runs (
    id text NOT NULL,
    methodology_version text NOT NULL,
    generated_at timestamptz NOT NULL,
    source_snapshot_ids text[] NOT NULL DEFAULT '{}'::text[],
    summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'published',
    origin text NOT NULL DEFAULT 'computed',
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    CHECK (status IN ('published', 'failed', 'shadow', 'historical')),
    CHECK (origin IN ('computed', 'imported'))
);
