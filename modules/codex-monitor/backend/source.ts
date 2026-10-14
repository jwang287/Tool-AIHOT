// Which source the monitor polls. SocialData when its key is set: paid, and the only source that carries
// a post's reply and quote context. Otherwise the free Nitter RSS instances with @thsottiaux's own feed
// (the newest ~20 posts; a reply arrives without the post it answers). Either way collection needs
// COLLECT_ENABLED=true; the paid key is only an upgrade path.
import { credential } from "@aihot/backend/config";

export type MonitorSource = "socialdata" | "rss";

/** Null when collection is off, whatever keys are set. */
export function monitorSource(): MonitorSource | null {
  if (process.env.COLLECT_ENABLED !== "true") return null;
  return credential("collectors", "SOCIALDATA_API_KEY") ? "socialdata" : "rss";
}

/** The schedules' gate: with the valve open the monitor always has a source (the free one at worst). */
export const monitorCollecting = () => monitorSource() !== null;
