-- Official API prices, and the subscription and relay prices that only annotate them.
CREATE TABLE lb_prices (
    model_id text NOT NULL,
    kind text NOT NULL,
    currency text NOT NULL,
    input numeric(14,6),
    output numeric(14,6),
    cached_input numeric(14,6),
    source_url text,
    note text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (model_id, kind),
    FOREIGN KEY (model_id) REFERENCES lb_models(id),
    CHECK (currency IN ('CNY', 'USD')),
    CHECK (kind IN ('official', 'subscription', 'relay'))
);
