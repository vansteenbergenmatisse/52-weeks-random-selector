import type { FastifyInstance } from "fastify";
import { subscribe } from "../../platform/realtime/bus.js";
import { requireCouple } from "../http.js";

/**
 * Server-Sent Events stream, couple-scoped, so both partners' UIs refresh live
 * after any change (entry added, spin, reroll, completion, WhatsApp update).
 */
export async function eventRoutes(app: FastifyInstance) {
  app.get("/api/events", async (req, reply) => {
    const { coupleId } = await requireCouple(req);

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(`event: ready\ndata: {}\n\n`);

    const unsubscribe = subscribe(coupleId, (event) => {
      reply.raw.write(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
    });

    // Heartbeat keeps proxies from closing the idle connection.
    const heartbeat = setInterval(() => {
      reply.raw.write(`: ping\n\n`);
    }, 25000);

    req.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });

    return reply.hijack();
  });
}
