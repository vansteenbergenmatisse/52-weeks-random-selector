import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as whatsapp from "../../features/whatsapp/manager.js";
import { enqueue } from "../../features/whatsapp/outbox.js";
import { parse, requireCouple } from "../http.js";

export async function whatsappRoutes(app: FastifyInstance) {
  app.get("/api/whatsapp/status", async (req, reply) => {
    const { coupleId } = await requireCouple(req);
    return reply.send(await whatsapp.getStatus(coupleId));
  });

  app.post("/api/whatsapp/connect", async (req, reply) => {
    const { coupleId } = await requireCouple(req);
    await whatsapp.connect(coupleId);
    return reply.send(await whatsapp.getStatus(coupleId));
  });

  app.post("/api/whatsapp/disconnect", async (req, reply) => {
    const { coupleId } = await requireCouple(req);
    await whatsapp.disconnect(coupleId);
    return reply.send(await whatsapp.getStatus(coupleId));
  });

  app.patch("/api/whatsapp/config", async (req, reply) => {
    const { coupleId } = await requireCouple(req);
    // Require a country code: E.164 (+ then 8–15 digits, no leading zero).
    const e164 = z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{7,14}$/, "Include the country code, e.g. +31 6 12345678");
    const body = parse(
      z.object({
        deliveryMode: z.enum(["group", "individuals"]).optional(),
        groupId: z.string().max(80).nullable().optional(),
        recipients: z.array(e164).max(10).optional(),
      }),
      req.body,
    );
    return reply.send(await whatsapp.updateConfig(coupleId, body));
  });

  // User-triggered test message.
  app.post("/api/whatsapp/test", async (req, reply) => {
    const { coupleId } = await requireCouple(req);
    await enqueue({
      coupleId,
      kind: "test",
      body: "✅ Our 52 test message — WhatsApp delivery is working.",
    });
    await whatsapp.flush(coupleId);
    return reply.send({ ok: true, status: await whatsapp.getStatus(coupleId) });
  });
}
