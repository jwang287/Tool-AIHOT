// The reset monitor's backend: its page and public endpoints, its admin corrections, its three schedules,
// the model step its recognition uses, its alerts, its reminder in the discovery files and its ability
// for agents.
import { z } from "zod";
import { defineServerModule } from "@aihot/backend/modules";
import { siteUrl } from "@aihot/backend/publication/links";
import { SITE } from "@aihot/site";
import { CODEX_RESET_SCAN_MINUTES } from "./contracts.ts";
import { codexResetPage, codexResetsRecent } from "./backend/read.ts";
import { monitorTick } from "./backend/scan.ts";
import { monitorFallback } from "./backend/scan-fallback.ts";
import { monitorCollecting, monitorSource } from "./backend/source.ts";
import { codexAnswer, CODEX_ASK } from "./backend/answer.ts";
import { monitorFindings, monitorPendingCount } from "./backend/ops.ts";
import { registerCodexMonitorApi } from "./api/routes.ts";
import { registerCodexMonitorAdmin } from "./api/admin.ts";
import { registerCodexMonitorOg } from "./api/og.ts";

export default defineServerModule({
  name: "codex-monitor",
  http(app) {
    registerCodexMonitorApi(app);
    registerCodexMonitorAdmin(app);
    registerCodexMonitorOg(app);
  },
  // Every ten minutes as the pages state, whichever source is configured: SocialData when its key is set,
  // the free Nitter instances otherwise. The daily lookback re-reads SocialData's index for replies it
  // indexed late; the free feed always carries the newest posts, so it has nothing to look back for.
  // The fallback sweeps every instance (and Jina, with its key) twice a day while the feed is failing.
  schedules: [
    { name: "monitor.tick", cron: `*/${CODEX_RESET_SCAN_MINUTES} * * * *`, run: () => monitorTick(), when: monitorCollecting },
    { name: "monitor.lookback", cron: "40 4 * * *", run: () => monitorTick({ lookbackHours: 48 }), when: () => monitorSource() === "socialdata" },
    { name: "monitor.fallback", cron: "17 */12 * * *", missed: "once", run: () => monitorFallback(), when: () => monitorSource() === "rss" },
  ],
  models: {
    monitor: { label: "Codex 重置公告识别", env: "MONITOR_MODEL", purposes: ["monitor.recognize", "monitor.context"] },
  },
  alerts: monitorFindings,
  agent: {
    abilities: [{
      path: "/codex-resets",
      title: "Codex 额度重置",
      ask: CODEX_ASK,
      answer: async () => codexAnswer(await codexResetPage()),
      etagPrefix: "agent-codex",
      cacheControl: "public, max-age=60, s-maxage=60, stale-while-revalidate=60",
      mcp: {
        tool: "get_codex_resets",
        use: "for Tibo's Codex usage-limit resets",
        description: `Get Tibo's Codex usage-limit resets and reset credits as ${SITE.name} tracks them: announcements still waiting to take effect, the last 7 days and the last landed one, each with its evidence. Keep the evidence distinctions in the answer: a confirmation post, a verified receipt and an estimate are different things.`,
        input: z.strictObject({}),
        run: async () => {
          const [page, snapshot] = await Promise.all([codexResetPage(), codexResetsRecent()]);
          return { text: codexAnswer(page), structured: { ...snapshot } };
        },
      },
    }],
  },
  admin: {
    counts: { monitor: monitorPendingCount },
  },
  sitemap: {
    pages: [{ loc: "/codex-reset", changefreq: "hourly", priority: 0.6 }],
  },
  llms: () => {
    const u = siteUrl;
    return {
      api: [
        `- [公开 API · Codex 重置监控（轮询用）](${u("/api/v1/codex-resets/recent")}): 最近 7 天与尚未落地的预告，结构与完整快照相同、只有几 KB；每 ${CODEX_RESET_SCAN_MINUTES} 分钟采集，建议每 ${CODEX_RESET_SCAN_MINUTES} 分钟带 If-None-Match 轮询`,
        `- [公开 API · Codex 重置监控（完整历史）](${u("/api/v1/codex-resets")}): 全员重置和发重置卡的完整日历快照，中文帖子、北京时间及原帖链接；会逐月增长，只在需要全部历史时读取，不要用来轮询`,
      ],
      pace: [`Codex 重置每 ${CODEX_RESET_SCAN_MINUTES} 分钟读一次 /api/v1/codex-resets/recent；`],
      pages: [`- [Tibo 重置监控](${u("/codex-reset")}): 盯 OpenAI Codex 负责人在 X 上的额度重置公告，展示推断出的北京时间窗口、适用范围与 Tibo 原话`],
    };
  },
});
