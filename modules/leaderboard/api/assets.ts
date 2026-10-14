// The leaderboard's own static files: the model and evaluator marks in assets/, served at
// /model-providers/ and /leaderboard-sources/ as the stored brand paths name them.
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { REPO_ROOT } from "@aihot/backend/config";
import { sendFile } from "@aihot/api/routes/static";

const ASSETS = path.join(REPO_ROOT, "modules/leaderboard/assets");
const FILE = /^[a-z0-9-]+\.(svg|png)$/;

export function registerLeaderboardAssets(app: FastifyInstance) {
  for (const [url, dir] of [["model-providers", "providers"], ["leaderboard-sources", "sources"]] as const) {
    app.get(`/${url}/:file`, (req, reply) => {
      const file = (req.params as { file: string }).file;
      if (!FILE.test(file)) return reply.code(404).send();
      return sendFile(req, reply, path.join(ASSETS, dir, file), { cacheControl: "public, max-age=604800" });
    });
  }
}
