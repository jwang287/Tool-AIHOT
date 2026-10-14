// Which source the monitor polls, and what that leaves registered: the paid scan needs its key, the free
// feed does not, and both need the collection valve (which only reads a lowercase true).
import assert from "node:assert/strict";
import { after, test } from "node:test";
import "./setup.ts";
import { closeDb } from "@aihot/backend/db";
import { CODEX_RESET_SCAN_MINUTES } from "@aihot/codex-monitor/contracts";
import { monitorSource } from "@aihot/codex-monitor/backend/source";
import codexMonitor from "@aihot/codex-monitor/server";

after(async () => { await closeDb(); });

/** The schedules the worker would register for this module, by name. */
const registered = () => (codexMonitor.schedules ?? []).filter((schedule) => schedule.when?.() ?? true).map((schedule) => schedule.name);
const schedule = (name: string) => (codexMonitor.schedules ?? []).find((entry) => entry.name === name)!;

test("the collection valve decides whether the monitor runs at all, key or no key", () => {
  process.env.COLLECT_ENABLED = "false";
  delete process.env.SOCIALDATA_API_KEY;
  assert.equal(monitorSource(), null);
  assert.deepEqual(registered(), []);
  process.env.SOCIALDATA_API_KEY = "test-key";
  assert.equal(monitorSource(), null);
  assert.deepEqual(registered(), []);
  // Only a lowercase true opens a valve, as everywhere else.
  process.env.COLLECT_ENABLED = "TRUE";
  assert.equal(monitorSource(), null);
  assert.deepEqual(registered(), []);
});

test("with the valve open the free feed is the source without the key, the paid scan with it", () => {
  process.env.COLLECT_ENABLED = "true";
  delete process.env.SOCIALDATA_API_KEY;
  assert.equal(monitorSource(), "rss");
  // The free path: the ten-minute scan, and the twelve-hour fallback for while its instances are failing.
  assert.deepEqual(registered(), ["monitor.tick", "monitor.fallback"]);
  // The free feed keeps the paid cadence; its daily lookback exists for replies SocialData indexed late.
  assert.equal(schedule("monitor.tick").cron, `*/${CODEX_RESET_SCAN_MINUTES} * * * *`);
  assert.equal(schedule("monitor.lookback").when!(), false);
  // Twice a day, at 17 past the hour, so it never shares a slot with the scan or the lookback.
  assert.equal(schedule("monitor.fallback").cron, "17 */12 * * *");
  assert.equal(schedule("monitor.fallback").when!(), true);

  process.env.SOCIALDATA_API_KEY = "test-key";
  assert.equal(monitorSource(), "socialdata");
  // The paid path has its own backlog for a stop; the fallback belongs to the free one only.
  assert.deepEqual(registered(), ["monitor.tick", "monitor.lookback"]);
  assert.equal(schedule("monitor.fallback").when!(), false);
});
