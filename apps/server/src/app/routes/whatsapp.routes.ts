import type { FastifyInstance } from "fastify";
import * as whatsapp from "../../features/whatsapp/manager.js";
import { requireCouple } from "../http.js";

export async function whatsappRoutes(app: FastifyInstance) {
  // Status for the logged-in user's own WhatsApp link (+ partner link state).
  app.get("/api/whatsapp/status", async (req, reply) => {
    const { user, coupleId } = await requireCouple(req);
    return reply.send(await whatsapp.getStatus(coupleId, user.id));
  });

  // Link / connect THIS user's WhatsApp (starts pairing; QR follows).
  app.post("/api/whatsapp/connect", async (req, reply) => {
    const { user, coupleId } = await requireCouple(req);
    await whatsapp.connect(coupleId, user.id);
    return reply.send(await whatsapp.getStatus(coupleId, user.id));
  });

  // Disconnect THIS user's WhatsApp (keeps creds; can re-connect without a re-scan).
  app.post("/api/whatsapp/disconnect", async (req, reply) => {
    const { user, coupleId } = await requireCouple(req);
    await whatsapp.disconnect(coupleId, user.id);
    return reply.send(await whatsapp.getStatus(coupleId, user.id));
  });

  // User-triggered test message: sends from your WhatsApp to your partner (self if unlinked).
  app.post("/api/whatsapp/test", async (req, reply) => {
    const { user, coupleId } = await requireCouple(req);
    const res = await whatsapp.sendTest(coupleId, user.id);
    return reply.send({ ...res, status: await whatsapp.getStatus(coupleId, user.id) });
  });
}
