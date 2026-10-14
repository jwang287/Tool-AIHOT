import assert from "node:assert/strict";
import { test } from "node:test";
import { computeBoardsInWorker } from "@aihot/leaderboard/backend/method/compute";
import type { BoardInput } from "@aihot/leaderboard/backend/method/consensus";

test("worker computation errors reject the round", async () => {
  await assert.rejects(computeBoardsInWorker([{} as BoardInput]));
});

test("a round exceeding its explicit worker deadline terminates instead of occupying the queue indefinitely", async () => {
  await assert.rejects(computeBoardsInWorker([{} as BoardInput], { timeoutMs: 1 }), /timed out|deadline/i);
});
