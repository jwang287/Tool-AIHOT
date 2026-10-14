// This module's tests: the engine's shared setup, plus the module installed as the api and worker
// install it (its endpoints and its model step only exist once it is).
import { installModules } from "@aihot/backend/modules";
import codexMonitor from "@aihot/codex-monitor/server";

export * from "../../../tests/setup.ts";

// The step the tests were written against; the module's own env variable.
process.env.MONITOR_MODEL ??= "deepseek-flash";
installModules([codexMonitor]);
