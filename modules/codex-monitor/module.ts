// The Codex reset monitor's addresses: its page, its calendar by day, its admin page and the paths the
// api process answers. Its backend is server.ts, its pages web.tsx and web/.
import { defineModule } from "@aihot/contracts/modules";

export default defineModule({
  name: "codex-monitor",
  pages: [
    { path: "codex-reset", file: "web/codex-reset.tsx" },
    { path: "codex-reset/history/:date", file: "web/codex-reset.tsx", id: "codex-reset-day" },
  ],
  adminPages: [{ path: "admin/monitor", file: "web/admin-monitor.tsx" }],
  // A trailing slash on the page's own address, as the engine's pages have.
  redirects: [{ match: "regex", path: "^/codex-reset/+$", status: 301, location: "/codex-reset", keepQuery: true }],
  apiPaths: [/^\/api\/site\/codex-reset/, /^\/api\/v1\/codex-resets/, /^\/api\/admin\/monitor\//],
});
