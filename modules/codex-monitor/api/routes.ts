// The reset monitor's endpoints: its page data (/api/site/codex-reset*) and the public v1 snapshot
// (/api/v1/codex-resets*). Read-only views of what has been collected and confirmed.
import type { FastifyInstance } from "fastify";
import { config } from "@aihot/backend/config";
import { cached } from "@aihot/backend/lib/cache";
import { sendJsonWithEtag, sendProblem, strictQuery } from "@aihot/api/http/respond";
import { siteHandler } from "@aihot/api/routes/site";
import { publicHandler, sendV1 } from "@aihot/api/routes/v1";
import { loadSiteCodexResetDay, loadSiteCodexResetPage } from "../backend/publication.ts";
import { codexResetVersion, codexResetsRecent, codexResetsSnapshot } from "../backend/read.ts";

const PAGE_CACHE = "public, max-age=30, s-maxage=30";
const V1_CACHE = "public, max-age=60, s-maxage=60, stale-while-revalidate=60";

/** The page polls for changes; kept a few seconds, as the foreground tabs ask once a minute. */
const codexVersion = cached(() => codexResetVersion(), { freshMs: 5_000, maxStaleMs: 5_000 });

export function registerCodexMonitorApi(app: FastifyInstance) {
  app.get("/api/site/codex-reset", siteHandler(async (req, reply) => {
    return sendJsonWithEtag(req, reply, await loadSiteCodexResetPage(), { etagPrefix: "codex-page", cacheControl: PAGE_CACHE });
  }));

  app.get("/api/site/codex-reset/days/:date", siteHandler(async (req, reply) => {
    const date = (req.params as { date: string }).date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "date not found" });
    return sendJsonWithEtag(req, reply, await loadSiteCodexResetDay(date), { etagPrefix: "codex-day", cacheControl: "no-store" });
  }));

  // Foreground polling from /codex-reset (every open tab, once a minute): a cache in front answers the
  // tabs of the same 15 s, and the process reads the database at most every 5 s.
  app.get("/api/site/codex-reset/version", siteHandler(async (req, reply) => {
    return sendJsonWithEtag(req, reply, await codexVersion.get(), { etagPrefix: "codex-version", cacheControl: "public, max-age=0, s-maxage=15" });
  }));

  app.get("/api/v1/codex-resets", publicHandler(async (req, reply) => {
    strictQuery(req, []);
    reply.header("Link", `<${config.siteUrl}/api/v1/codex-resets/recent>; rel="alternate"; type="application/json"`);
    return sendV1(req, reply, await codexResetsSnapshot(), { etagPrefix: "v1-codex-resets", cacheControl: V1_CACHE });
  }));

  app.get("/api/v1/codex-resets/recent", publicHandler(async (req, reply) => {
    strictQuery(req, []);
    return sendV1(req, reply, await codexResetsRecent(), { etagPrefix: "v1-codex-resets-recent", cacheControl: V1_CACHE });
  }));
}
