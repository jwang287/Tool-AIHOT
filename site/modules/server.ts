// The backend of the site's modules, installed by the api and the worker when they start (site/modules/index.ts).
import type { ServerModule } from "@aihot/backend/modules";
import leaderboard from "@aihot/leaderboard/server";
import codexMonitor from "@aihot/codex-monitor/server";

export const SERVER_MODULES: readonly ServerModule[] = [leaderboard, codexMonitor];
