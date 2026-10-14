// The leaderboard's backend: its endpoints, its marks and share card, its four daily upstream checks,
// its alerts, its lines in the discovery files and its part of the admin's runs page.
import { sql } from "@aihot/backend/db";
import { getBoss } from "@aihot/backend/jobs/queue";
import { defineServerModule } from "@aihot/backend/modules";
import { siteUrl } from "@aihot/backend/publication/links";
import { SITE } from "@aihot/site";
import { refreshLeaderboard } from "./backend/fetch/refresh.ts";
import { runLeaderboardRound } from "./backend/method/run.ts";
import { leaderboardDetailUrls } from "./backend/read.ts";
import { leaderboardFetchState, leaderboardFindings } from "./backend/ops.ts";
import { registerLeaderboard } from "./api/leaderboard.ts";
import { registerLeaderboardAssets } from "./api/assets.ts";
import { registerLeaderboardOg } from "./api/og.ts";

const collecting = () => process.env.COLLECT_ENABLED === "true";

/** A board is worth listing once one run has been published. */
async function hasPublishedRun(): Promise<boolean> {
  const [row] = await sql<{ has: boolean }[]>`SELECT EXISTS (SELECT 1 FROM lb_runs WHERE status = 'published') AS has`;
  return row?.has ?? false;
}

export default defineServerModule({
  name: "leaderboard",
  http(app) {
    registerLeaderboard(app);
    registerLeaderboardAssets(app);
    registerLeaderboardOg(app);
  },
  // Four upstream checks a day; a new run is published only when the evidence changed. With collection
  // off only the computation runs, over the snapshots already stored.
  schedules: [
    { name: "leaderboard.round", cron: "5 2,8,14,20 * * *", missed: "once", run: () => (collecting() ? refreshLeaderboard() : runLeaderboardRound()) },
  ],
  // A new site has no leaderboard until the first scheduled round: compute one now.
  async started() {
    if (!(await hasPublishedRun())) await (await getBoss()).send("cron.leaderboard.round", {}, { singletonKey: "first-round" });
  },
  alerts: leaderboardFindings,
  agent: {
    unavailable: [`模型榜目前只有网页：${siteUrl("/leaderboard")}。`],
  },
  admin: {
    runs: leaderboardFetchState,
  },
  sitemap: {
    pages: [
      { loc: "/leaderboard", changefreq: "daily", priority: 0.8 },
      { loc: "/leaderboard/sources", changefreq: "weekly", priority: 0.5 },
      { loc: "/leaderboard/rules", changefreq: "monthly", priority: 0.4 },
      { loc: "/leaderboard/category/coding", changefreq: "daily", priority: 0.6 },
      { loc: "/leaderboard/category/reasoning", changefreq: "daily", priority: 0.6 },
      { loc: "/leaderboard/category/knowledge", changefreq: "daily", priority: 0.6 },
      { loc: "/leaderboard/category/professional", changefreq: "daily", priority: 0.6 },
    ],
    entries: () => leaderboardDetailUrls().then((locs) => locs.map((loc) => ({ loc, changefreq: "weekly", priority: 0.4 }))),
  },
  llms: async () => {
    if (!(await hasPublishedRun())) return {};
    const u = siteUrl;
    return {
      pages: [
        `- [模型榜](${u("/leaderboard")}): 汇总多家公开模型评测榜单，展示前 30 个模型的 ${SITE.name} 评分、参考位次、辅助证据、上线日期和 API 参考价格`,
        `- [所有模型评测榜单](${u("/leaderboard/sources")}): 核对各家官方榜单的模型名次与原始分数`,
        `- [模型榜算法规则](${u("/leaderboard/rules")}): 了解模型身份统一、共同参评比较、缺测处理、题族去重、固定尺度连续分差和 0–100 评分`,
      ],
    };
  },
});
