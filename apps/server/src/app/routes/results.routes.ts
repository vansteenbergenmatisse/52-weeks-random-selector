import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as selection from "../../features/selection/service.js";
import * as whatsapp from "../../features/whatsapp/manager.js";
import * as calendar from "../../features/calendar/service.js";
import { enqueueBroadcast } from "../../features/whatsapp/outbox.js";
import { formatResultMessage, formatReroll } from "../../features/whatsapp/format.js";
import { prisma } from "../../platform/db/prisma.js";
import { parse, requireCouple } from "../http.js";

async function collectionMeta(id: string) {
  return prisma.collection.findUniqueOrThrow({
    where: { id },
    select: { id: true, name: true, kind: true, scheduleTimezone: true },
  });
}

export async function resultRoutes(app: FastifyInstance) {
  app.get("/api/collections/:collectionId/result", async (req, reply) => {
    const { coupleId } = await requireCouple(req);
    const { collectionId } = req.params as { collectionId: string };
    return reply.send({ state: await selection.getCurrentState(coupleId, collectionId) });
  });

  // Spin (or reveal) this week's result. Server picks & persists before the
  // client animates. Returns `created` so the UI knows whether to animate.
  app.post("/api/collections/:collectionId/spin", async (req, reply) => {
    const { coupleId, user } = await requireCouple(req);
    const { collectionId } = req.params as { collectionId: string };
    const res = await selection.spin(coupleId, collectionId, { userId: user.id, source: "web" });
    if (res.created && res.state.result) {
      const meta = await collectionMeta(collectionId);
      await enqueueBroadcast({
        coupleId,
        kind: "result",
        collectionId,
        weeklyResultId: res.state.result.weeklyResultId,
        revisionNumber: res.state.result.revision,
        body: formatResultMessage(res.state, meta),
      });
      await calendar.enqueueCalendarPromptIfConfigured(coupleId, meta, res.state);
      whatsapp.flush(coupleId).catch(() => {});
    }
    return reply.send({ created: res.created, state: res.state });
  });

  app.post("/api/collections/:collectionId/reroll", async (req, reply) => {
    const { coupleId, user } = await requireCouple(req);
    const { collectionId } = req.params as { collectionId: string };
    const body = parse(z.object({ expectedRevision: z.number().int().optional() }), req.body ?? {});
    const res = await selection.reroll(coupleId, collectionId, {
      userId: user.id,
      source: "web",
      expectedRevision: body.expectedRevision,
    });
    if (res.replaced && res.state.result) {
      const meta = await collectionMeta(collectionId);
      await enqueueBroadcast({
        coupleId,
        kind: "reroll",
        collectionId,
        weeklyResultId: res.state.result.weeklyResultId,
        revisionNumber: res.state.result.revision,
        body: formatReroll(res.state, meta),
      });
      whatsapp.flush(coupleId).catch(() => {});
    }
    return reply.send({ replaced: res.replaced, reason: res.reason, state: res.state });
  });

  // Skip this week's pick: it returns to the pool and a new one is drawn.
  app.post("/api/collections/:collectionId/skip", async (req, reply) => {
    const { coupleId, user } = await requireCouple(req);
    const { collectionId } = req.params as { collectionId: string };
    const res = await selection.skip(coupleId, collectionId, { userId: user.id, source: "web" });
    if (res.skipped && res.state.result) {
      const meta = await collectionMeta(collectionId);
      await enqueueBroadcast({
        coupleId,
        kind: "result",
        collectionId,
        weeklyResultId: res.state.result.weeklyResultId,
        revisionNumber: res.state.result.revision,
        body: formatResultMessage(res.state, meta),
      });
      await calendar.enqueueCalendarPromptIfConfigured(coupleId, meta, res.state);
      whatsapp.flush(coupleId).catch(() => {});
    }
    return reply.send({ skipped: res.skipped, reason: res.reason, state: res.state });
  });

  app.post("/api/collections/:collectionId/complete", async (req, reply) => {
    const { coupleId } = await requireCouple(req);
    const { collectionId } = req.params as { collectionId: string };
    return reply.send({ state: await selection.markCompleted(coupleId, collectionId) });
  });

  app.get("/api/collections/:collectionId/history", async (req, reply) => {
    const { coupleId } = await requireCouple(req);
    const { collectionId } = req.params as { collectionId: string };
    return reply.send({ history: await selection.getHistory(coupleId, collectionId) });
  });

  app.post("/api/collections/:collectionId/new-cycle", async (req, reply) => {
    const { coupleId } = await requireCouple(req);
    const { collectionId } = req.params as { collectionId: string };
    return reply.send({ collection: await selection.startNewCycle(coupleId, collectionId) });
  });

  // Testing reset: wipe this collection back to zero (ideas, pick, and history).
  app.post("/api/collections/:collectionId/reset", async (req, reply) => {
    const { coupleId } = await requireCouple(req);
    const { collectionId } = req.params as { collectionId: string };
    return reply.send({ state: await selection.resetToZero(coupleId, collectionId) });
  });
}
