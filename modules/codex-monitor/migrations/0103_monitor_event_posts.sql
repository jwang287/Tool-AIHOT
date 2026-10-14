-- Which posts carry which event, in which stage, and the sentence that said so (quoted for the admin).
CREATE TABLE monitor_event_posts (
    event_id text NOT NULL,
    post_id text NOT NULL,
    stage text NOT NULL,
    action text,
    text text NOT NULL,
    original_text text NOT NULL,
    PRIMARY KEY (event_id, post_id),
    FOREIGN KEY (event_id) REFERENCES monitor_events(id) ON DELETE CASCADE,
    FOREIGN KEY (post_id) REFERENCES monitor_posts(id) ON DELETE CASCADE
);
