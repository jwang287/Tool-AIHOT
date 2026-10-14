// What the leaderboard tells the owner: evaluation sources that stopped answering, and models whose
// mark is missing. Also the fetch state the admin's runs page shows.
import { sql } from "@aihot/backend/db";
import { beijingStamp, type Finding } from "@aihot/backend/notify/feishu";
import { unmarkedBoardModels } from "./read.ts";

/** One source's last fetch, as the refresh recorded it in settings. */
interface FetchState {
  at: string;
  sources: Record<string, { ok: boolean; at: string; lastOkAt: string | null; changed?: boolean; rows?: number; error?: string }>;
}

export async function leaderboardFetchState(): Promise<{ at: string; sources: Array<{ key: string } & FetchState["sources"][string]> } | null> {
  const [row] = await sql<{ value: FetchState }[]>`SELECT value FROM settings WHERE key = 'leaderboard.fetch'`;
  if (!row) return null;
  return {
    at: row.value.at,
    sources: Object.entries(row.value.sources).map(([key, v]) => ({ key, ...v })).sort((a, b) => Number(a.ok) - Number(b.ok) || a.key.localeCompare(b.key)),
  };
}

/** A source keeps its last snapshot while failing, so a day without a fetch is a slowed leaderboard, not a gap. */
export async function leaderboardFindings(now: number): Promise<Finding[]> {
  const out: Finding[] = [];
  const [row] = await sql<{ value: FetchState }[]>`SELECT value FROM settings WHERE key = 'leaderboard.fetch'`;
  const stale = Object.entries(row?.value.sources ?? {}).filter(([, s]) => !s.ok && s.lastOkAt && now - Date.parse(s.lastOkAt) > 26 * 3600_000);
  if (stale.length) {
    out.push({
      key: "leaderboard.fetch",
      level: "later",
      title: `模型榜有 ${stale.length} 个评测来源超过一天没抓到，榜单暂用上一份数据`,
      detail: stale.slice(0, 6).map(([k, s]) => `${k}：${s.error ?? "失败"}（上次成功 ${beijingStamp(s.lastOkAt!)}）`).join("；"),
    });
  }

  const unmarked = await unmarkedBoardModels().catch(() => [] as string[]);
  if (unmarked.length) {
    out.push({
      key: "leaderboard.marks",
      level: "later",
      title: `模型榜有 ${unmarked.length} 个模型没有厂商标志，暂时显示首字母`,
      detail: `${unmarked.slice(0, 8).join("、")}；标志文件放 modules/leaderboard/assets/providers，映射在 modules/leaderboard/backend/registry.ts`,
    });
  }
  return out;
}
