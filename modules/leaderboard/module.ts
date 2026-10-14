// The model leaderboard's addresses: its pages, its redirects and the paths the api process answers
// (logos). Its backend is server.ts, its pages web.tsx and web/.
import { defineModule } from "@aihot/contracts/modules";

export default defineModule({
  name: "leaderboard",
  pages: [
    {
      layout: "web/boards.tsx",
      id: "leaderboard-boards",
      pages: [
        { path: "leaderboard", file: "web/leaderboard.tsx", id: "leaderboard" },
        { path: "leaderboard/category/:key", file: "web/leaderboard.tsx", id: "leaderboard-category" },
      ],
    },
    { path: "leaderboard/sources", file: "web/sources.tsx" },
    { path: "leaderboard/sources/:key", file: "web/source.tsx" },
    { path: "leaderboard/rules", file: "web/rules.tsx" },
    { path: "leaderboard/:slug", file: "web/model.tsx" },
  ],
  // Retired addresses: the old name of the sources page, and the boards that were dropped.
  redirects: [
    { match: "exact", path: "/leaderboard/methodology", status: 308, location: "/leaderboard/sources" },
    { match: "regex", path: "^/leaderboard/category/(aesthetics|writing)$", status: 307, location: "/leaderboard", why: "categories without a board" },
    { match: "exact", path: "/leaderboard/category/overall", status: 404, why: "the overall board lives at /leaderboard" },
  ],
  // Model and evaluator marks, served from this module's assets/.
  apiPaths: [/^\/api\/site\/leaderboard\//, /^\/(?:model-providers|leaderboard-sources)\//],
});
