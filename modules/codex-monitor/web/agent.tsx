// The reset monitor's part of the agent page: its MCP tool, its two public addresses and how to poll them.
import { mcpToolName } from "@aihot/contracts/mcp";
import type { AgentPart } from "@aihot/web/modules";
import { CodeBlock } from "@aihot/web/features/agent/CodeBlock";
import { Mono } from "@aihot/web/features/agent/parts";
import { CODEX_RESET_SCAN_MINUTES } from "../contracts.ts";

function ResetRecipe({ base, curl }: { base: string; curl: string }) {
  return (
    <>
      <CodeBlock className="mb-3 mt-3" lang="bash" code={`# 每 ${CODEX_RESET_SCAN_MINUTES} 分钟一次；保存 ETag，下次带上\n${curl} -i '${base}/api/v1/codex-resets/recent'\n${curl} -i -H 'If-None-Match: <上次的 ETag>' '${base}/api/v1/codex-resets/recent'`} />
      <p>结构和完整快照一样，只包含最近 7 天的事件和原帖，以及所有还没落地的预告。完整历史只在要看历史时读 <Mono>/api/v1/codex-resets</Mono>。</p>
    </>
  );
}

export default {
  tools: [{
    name: mcpToolName("get_codex_resets"),
    does: "Tibo 的 Codex 额度重置与发卡，分清预告和已确认",
    ask: "Codex 额度最近重置了吗？",
  }],
  api: {
    group: "Tibo 重置监控",
    rows: [
      ["/api/v1/codex-resets/recent", "最近 7 天和尚未落地的预告，几 KB", `${CODEX_RESET_SCAN_MINUTES} 分钟一次`],
      ["/api/v1/codex-resets", "完整历史，逐月变大", "只在要看历史时"],
    ],
  },
  recipes: [{ key: "resets", label: "盯 Tibo 重置", Body: ResetRecipe }],
} satisfies AgentPart;
