-- One model's evidence, and the models a board ranks.
CREATE INDEX CONCURRENTLY IF NOT EXISTS lb_scores_model_idx ON lb_scores (model_id);
