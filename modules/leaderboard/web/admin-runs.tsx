// The leaderboard's part of the admin's runs page: how the last upstream fetch of each evaluation
// source went (what its server module's admin.runs returns).
import { Badge, Card, DataTable, Time } from "@aihot/web/features/admin/ui";
import { bj, num } from "@aihot/web/features/admin/format";

interface FetchState {
  at: string;
  sources: Array<{ key: string; ok: boolean; at: string; lastOkAt: string | null; changed?: boolean; rows?: number; error?: string }>;
}

export default function LeaderboardRuns({ data }: { data: unknown }) {
  const r = data as FetchState | null;
  if (!r) return null;
  return (
    <Card
      className="mt-5"
      title="模型榜评测来源"
      right={<span>最近抓取 {bj(r.at)} · 成功 {r.sources.filter((x) => x.ok).length}/{r.sources.length}</span>}
      pad={false}
    >
      <div className="max-h-[360px] overflow-y-auto">
        <DataTable
          dense
          rows={r.sources}
          rowKey={(x) => x.key}
          columns={[
            { key: "k", label: "来源", render: (x) => <span className="font-mono text-[12.5px]">{x.key}</span> },
            { key: "s", label: "上次抓取", render: (x) => <Badge tone={x.ok ? "ok" : "bad"}>{x.ok ? (x.changed ? "有更新" : "无变化") : "失败"}</Badge> },
            { key: "ok", label: "上次成功", render: (x) => <Time at={x.lastOkAt} /> },
            { key: "n", label: "行数", align: "right", render: (x) => (x.rows == null ? "—" : num(x.rows)) },
            { key: "e", label: "错误", render: (x) => <span className="line-clamp-1 text-[12px] text-ink-3" title={x.error ?? ""}>{x.error}</span> },
          ]}
        />
      </div>
    </Card>
  );
}
