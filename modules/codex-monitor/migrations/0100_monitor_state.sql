-- The monitor's own bookkeeping: watermarks, the cursor, recognition failures and its history.
CREATE TABLE monitor_state (
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (key)
);
