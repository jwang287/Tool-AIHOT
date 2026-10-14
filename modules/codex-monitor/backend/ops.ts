// What the reset monitor tells the owner and the admin: posts stuck in recognition, claims waiting for a
// person, the free source's instances when they all stop answering, and the count on the admin navigation.
import { sql } from "@aihot/backend/db";
import { beijingStamp, duration, type Finding } from "@aihot/backend/notify/feishu";
import { awaitingReviewCondition } from "./read.ts";
import { getState } from "./state.ts";
import { monitorSource } from "./source.ts";
import type { RssState } from "./scan-rss.ts";

/** Ten-minute ticks: three failures in a row is half an hour without a single post. */
const RSS_ALERT_AFTER = 3;

/** Posts are recognized in order, so one that keeps failing holds up every later one. */
export async function monitorFindings(now: number): Promise<Finding[]> {
  const out: Finding[] = [];
  const [stuck] = await sql<{ url: string; collected_at: Date; failures: { count: number; error?: string } | null }[]>`
    SELECT p.url, p.collected_at, s.value AS failures FROM monitor_posts p LEFT JOIN monitor_state s ON s.key = 'failures:' || p.id
    WHERE p.processed_at IS NULL ORDER BY p.published_at, p.id LIMIT 1`;
  if (stuck && now - stuck.collected_at.getTime() > 60 * 60_000) {
    out.push({
      key: "monitor.stuck",
      level: "today",
      title: "Codex 重置监控卡住了",
      impact: "新的重置消息确认不了，内容群收不到重置通知",
      heals: "暂时没有",
      action: "转给 AI 处理",
      detail: `${stuck.url} 等待 ${duration(now - stuck.collected_at.getTime())}${stuck.failures ? `，识别失败 ${stuck.failures.count} 次：${stuck.failures.error ?? ""}` : ""}；后台“Codex 重置 → 帖子与识别 → 待识别”可跳过`,
      since: stuck.collected_at,
    });
  }
  // The free source's instances are shared and go down or start refusing. The paid path reports through
  // its receipts (and a failed tick is a failed run in job_runs), so this speaks only while it is in use.
  if (monitorSource() === "rss") {
    const rss = await getState<RssState>("rss");
    if (rss && rss.consecutiveFailures >= RSS_ALERT_AFTER) {
      const failed = Object.entries(rss.hosts).filter(([, host]) => !host.ok);
      // While the twelve-hour fallback is covering, the newest posts still arrive (twice a day) and the
      // owner should know the page is not blind, only slower.
      const covered = rss.fallback?.lastOkAt ? `；12 小时兜底任务最近一次成功 ${beijingStamp(rss.fallback.lastOkAt)}` : "";
      out.push({
        key: "monitor.rss",
        level: "today",
        title: "Codex 重置监控的免费 Nitter 源连续抓不到帖子",
        impact: "新的重置公告收不到，内容群也不会推送",
        heals: "换到还能用的实例后自动继续",
        action: "转给 AI 处理：在 .env 里用 MONITOR_RSS_URLS 指定可用实例，或核对内置清单",
        detail: `${rss.consecutiveFailures} 次连续失败（十分钟一次）${rss.lastOkAt ? `，最近一次成功 ${beijingStamp(rss.lastOkAt)}` : "，还没有成功过"}${covered}；${failed.slice(0, 5).map(([host, state]) => `${host}：${state.error ?? "失败"}`).join("；")}`,
        since: rss.failedSince ? new Date(rss.failedSince) : undefined,
      });
    }
  }
  // Posts whose claims wait for a person (an unsure reading, a quote not in the post).
  const review = await sql<{ url: string }[]>`SELECT url FROM monitor_posts WHERE ${awaitingReviewCondition()} ORDER BY published_at DESC LIMIT 5`;
  if (review.length) {
    out.push({
      key: "monitor.review",
      level: "today",
      title: "有 Codex 重置消息需要你确认",
      impact: "系统对这几条帖子的判断没把握，结论暂时没有生效，也没有推送",
      heals: "不会",
      action: "到后台“Codex 重置 → 帖子与识别 → 需复核”看一下；确认后需要的话在群里说明",
      detail: review.map((h) => h.url).join(" "),
    });
  }
  return out;
}

/** The badge on the admin navigation: what still needs a person. */
export async function monitorPendingCount(): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM monitor_posts
    WHERE ${awaitingReviewCondition()} OR (processed_at IS NULL AND collected_at < now() - interval '20 minutes')`;
  return row?.n ?? 0;
}
