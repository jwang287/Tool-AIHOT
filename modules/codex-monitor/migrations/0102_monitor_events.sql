-- One announced or confirmed reset (or reset credit): the stated scope, the schedule or estimate, and
-- how it was confirmed.
CREATE TABLE monitor_events (
    id text NOT NULL,
    type text NOT NULL,
    status text NOT NULL,
    title text NOT NULL,
    scope text NOT NULL DEFAULT '',
    schedule jsonb,
    estimate jsonb,
    presentation jsonb,
    confirmed_at timestamptz,
    occurred_on date,
    confirmation_basis text,
    withdrawn boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    label text NOT NULL DEFAULT '',
    display_label text NOT NULL DEFAULT '',
    PRIMARY KEY (id),
    CHECK (type IN ('direct_reset', 'reset_credit')),
    CHECK (status IN ('announced', 'confirmed')),
    CHECK (confirmation_basis IN ('source_post', 'receipt_review'))
);
