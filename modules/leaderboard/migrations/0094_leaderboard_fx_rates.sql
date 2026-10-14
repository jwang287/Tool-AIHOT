-- The USD/CNY rate the day's prices were converted at (one row per pair and day).
CREATE TABLE fx_rates (
    as_of date NOT NULL,
    pair text NOT NULL,
    rate numeric(12,6) NOT NULL,
    source_name text NOT NULL,
    source_url text,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (as_of, pair)
);
