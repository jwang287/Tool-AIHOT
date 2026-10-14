// The monitor's own bookkeeping in monitor_state: the collection cursors, the watermarks the page and the
// health read, and what each collecting source recorded about itself. Shared by the paid scan and the
// free RSS scan, which must agree on when a run counts as attempted and collected.
import { sql } from "@aihot/backend/db";

export async function getState<T>(key: string): Promise<T | null> {
  const [row] = await sql<{ value: T }[]>`SELECT value FROM monitor_state WHERE key = ${key}`;
  return row?.value ?? null;
}

export async function setState(key: string, value: unknown) {
  await sql`INSERT INTO monitor_state (key, value) VALUES (${key}, ${sql.json(value as never)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

/** A patch on the watermarks (they live under one key), keeping what is already there. */
export async function touchWatermarks(patch: Record<string, string>) {
  await sql`INSERT INTO monitor_state (key, value) VALUES ('watermarks', ${sql.json(patch)})
    ON CONFLICT (key) DO UPDATE SET value = monitor_state.value || EXCLUDED.value, updated_at = now()`;
}

/** Post ids are snowflake numbers: compare by length first, so a shorter id never wins by string order. */
export const idGreater = (a: string, b: string) => (a.length !== b.length ? a.length > b.length : a > b);
