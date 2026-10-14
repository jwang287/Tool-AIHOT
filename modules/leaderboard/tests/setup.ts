// This module's tests: the engine's shared setup, plus the module installed as the api and worker
// install it.
import { installModules } from "@aihot/backend/modules";
import leaderboard from "@aihot/leaderboard/server";

export * from "../../../tests/setup.ts";

installModules([leaderboard]);
