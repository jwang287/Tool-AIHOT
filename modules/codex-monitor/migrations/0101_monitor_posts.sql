-- Tibo's posts, as collected: the text, its reply and quote context, the recognition result and the
-- person's review.
CREATE TABLE monitor_posts (
    id text NOT NULL,
    author text NOT NULL,
    published_at timestamptz NOT NULL,
    text text NOT NULL,
    url text NOT NULL,
    context jsonb NOT NULL DEFAULT '[]'::jsonb,
    raw jsonb,
    translation text,
    recognition jsonb,
    receipt_id bigint,
    origin text NOT NULL DEFAULT 'live',
    collected_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    activity jsonb,
    outage jsonb,
    PRIMARY KEY (id),
    CHECK (origin IN ('live', 'imported'))
);
