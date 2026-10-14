// The reset monitor's share card (/og/pages/codex-reset.png), rendered by the engine's image code.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ogEtag, renderOg, type OgCard } from "@aihot/backend/media/og";

const CARD: OgCard = { kicker: "Tibo 重置监控", title: "Codex 额度重置什么时候生效", subtitle: "推算的北京时间窗口、适用范围与 Tibo 原话。", accent: "amber" };

/** A card kept a day, as the engine's own page cards are. */
async function send(req: FastifyRequest, reply: FastifyReply, card: OgCard, maxAge: number) {
  const tag = `"og-${ogEtag(card)}"`;
  reply.header("ETag", tag).header("Cache-Control", `public, max-age=${maxAge}, s-maxage=${maxAge * 7}, stale-while-revalidate=86400`);
  if (String(req.headers["if-none-match"] ?? "").split(",").some((t) => t.trim().replace(/^W\//, "") === tag)) return reply.code(304).send();
  return reply.type("image/png").send((await renderOg(card)).png);
}

export function registerCodexMonitorOg(app: FastifyInstance) {
  app.get("/og/pages/codex-reset.png", (req, reply) => send(req, reply, CARD, 86400));
}
