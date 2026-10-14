// Reset monitor corrections in the admin (/api/admin/monitor/*): reading the posts and events, and the
// person's judgement on the ones the recognition was unsure about.
import type { FastifyInstance } from "fastify";
import { actorOf } from "@aihot/backend/admin/auth";
import { adminHandler } from "@aihot/api/routes/admin-auth";
import { body, orNotFound, page, param, q } from "@aihot/api/routes/admin";
import { listMonitorEvents, listMonitorPosts, relinkPost, resolveMonitorPost, reviewReceipt, setWithdrawn, updateMonitorEvent } from "../backend/admin.ts";

export function registerCodexMonitorAdmin(app: FastifyInstance) {
  app.get("/api/admin/monitor/events", adminHandler(async (req) => listMonitorEvents({ withdrawn: q(req).withdrawn === "1" })));
  app.get("/api/admin/monitor/posts", adminHandler(async (req) => listMonitorPosts({ filter: q(req).filter as never, page: page(req) })));
  app.patch("/api/admin/monitor/events/:id", adminHandler(async (req, reply, admin) => orNotFound(req, reply, await updateMonitorEvent(param(req, "id"), body(req) as never, actorOf(admin)))));
  app.post("/api/admin/monitor/events/:id/receipt-review", adminHandler(async (req, reply, admin) => orNotFound(req, reply, await reviewReceipt(param(req, "id"), body(req) as never, actorOf(admin)))));
  app.post("/api/admin/monitor/events/:id/withdrawn", adminHandler(async (req, reply, admin) => orNotFound(req, reply, await setWithdrawn(param(req, "id"), body(req) as never, actorOf(admin)))));
  app.post("/api/admin/monitor/relink", adminHandler(async (req, _reply, admin) => relinkPost(body(req) as never, actorOf(admin))));
  app.post("/api/admin/monitor/posts/:id/resolve", adminHandler(async (req, reply, admin) => orNotFound(req, reply, await resolveMonitorPost(param(req, "id"), body(req) as never, actorOf(admin)))));
}
