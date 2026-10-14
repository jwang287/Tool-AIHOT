-- The name each evaluation source uses for a model, so fetched rows resolve to the same model.
CREATE TABLE lb_aliases (
    id text NOT NULL,
    source_key text NOT NULL,
    alias text NOT NULL,
    normalized_alias text NOT NULL,
    model_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    CONSTRAINT lb_aliases_source_alias_key UNIQUE (source_key, alias),
    FOREIGN KEY (model_id) REFERENCES lb_models(id)
);
