// What the reset monitor adds to the engine's pages: its entry in the 模型 section of the sidebar (shared
// with the leaderboard), its row on the 我的 page, its entry in the admin's 内容 group and its part of
// the agent page.
import { defineWebModule } from "@aihot/web/modules";
import { IconHistory } from "@aihot/web/components/icons";

export default defineWebModule({
  name: "codex-monitor",
  sidebar: { section: "模型", items: [{ to: "/codex-reset", label: "Tibo重置监控", icon: IconHistory }] },
  tools: [{ to: "/codex-reset", label: "Tibo 重置监控", icon: <IconHistory size={20} /> }],
  admin: { content: [{ to: "/admin/monitor", label: "Codex 重置", count: "monitor", tone: "accent" }] },
  agent: () => import("./web/agent.tsx"),
});
