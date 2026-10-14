-- The model directory: display names, providers, release dates, the source each date follows. The tables
-- the engine dropped in 0053 come back here, as this module's own.
CREATE TABLE lb_models (
    id text NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    provider text,
    provider_slug text,
    released_at timestamptz,
    release_date_source text,
    context_window_tokens integer,
    metadata_source text,
    metadata_updated_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (slug)
);
