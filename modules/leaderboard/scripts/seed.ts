// Imports this module's model directory (seeds/lb-models-YYYY-MM-DD.json): display names, providers,
// release dates, the name each evaluation source uses for a model, and the frozen scales. Only what is
// missing is added, so it is re-runnable: node --env-file=.env modules/leaderboard/scripts/seed.ts
import { closeDb } from "@aihot/backend/db";
import { importModelDirectory } from "@aihot/leaderboard/backend/directory";

const { models, aliases, calibrations } = await importModelDirectory();
console.log(`leaderboard directory: ${models} models, ${aliases} names, ${calibrations} calibrations added`);
await closeDb();
