// The leaderboard's share card (/og/pages/leaderboard.png), rendered by the engine's image code.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ogEtag, renderOg, type OgCard } from "@aihot/backend/media/og";

const CARD: OgCard = { kicker: "AI 模型排行榜", title: "多家公开评测的共识排名", subtitle: "综合、编程、推理、知识、专业办公；缺测不补零，价格不影响排名。" };

/** A card kept a day, as the engine's own page cards are. */
async function send(req: FastifyRequest, reply: FastifyReply, card: OgCard, maxAge: number) {
  const tag = `"og-${ogEtag(card)}"`;
  reply.header("ETag", tag).header("Cache-Control", `public, max-age=${maxAge}, s-maxage=${maxAge * 7}, stale-while-revalidate=86400`);
  if (String(req.headers["if-none-match"] ?? "").split(",").some((t) => t.trim().replace(/^W\//, "") === tag)) return reply.code(304).send();
  return reply.type("image/png").send((await renderOg(card)).png);
}

export function registerLeaderboardOg(app: FastifyInstance) {
  app.get("/og/pages/leaderboard.png", (req, reply) => send(req, reply, CARD, 86400));
}
