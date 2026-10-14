-- A model's place on one board of one run, with the evidence that produced it (detail).
CREATE TABLE lb_rankings (
    id bigserial NOT NULL,
    run_id text NOT NULL,
    board text NOT NULL,
    model_id text NOT NULL,
    rank integer NOT NULL,
    score double precision,
    coverage double precision,
    detail jsonb,
    PRIMARY KEY (id),
    UNIQUE (run_id, board, model_id),
    FOREIGN KEY (run_id) REFERENCES lb_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (model_id) REFERENCES lb_models(id)
);
