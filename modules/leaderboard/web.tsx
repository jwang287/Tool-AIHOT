// What the leaderboard adds to the engine's pages: its entry in the 模型 section of the sidebar, its tab
// on the phone tab bar, and its part of the admin's runs page.
import { defineWebModule } from "@aihot/web/modules";
import { IconChart } from "@aihot/web/components/icons";

export default defineWebModule({
  name: "leaderboard",
  sidebar: { section: "模型", items: [{ to: "/leaderboard", label: "模型榜", icon: IconChart }] },
  tabs: [{ key: "leaderboard", to: "/leaderboard", label: "模型榜", icon: IconChart }],
  admin: { runs: () => import("./web/admin-runs.tsx") },
  // Kimi's mark is drawn in white: it sits on its own dark plate.
  darkMarks: ["/model-providers/moonshot.svg"],
});
