import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as auth from "../../features/auth/service.js";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  currentUser,
  parse,
  requireCouple,
  requireUser,
  setSessionCookie,
} from "../http.js";
import { env, isProd } from "../../platform/config/env.js";

// Strict limits protect production; generous in dev/test so suites don't trip.
const REG_LIMIT = { max: isProd ? 10 : 1000, timeWindow: "10 minutes" };
const LOGIN_LIMIT = { max: isProd ? 20 : 1000, timeWindow: "5 minutes" };

const credentials = z.object({
  username: z.string().min(3).max(40),
  password: z.string().min(5).max(200),
});

export async function authRoutes(app: FastifyInstance) {
  // Register a new person and open a fresh couple space.
  app.post("/api/auth/register", { config: { rateLimit: REG_LIMIT } }, async (req, reply) => {
    const body = parse(
      credentials.extend({ displayName: z.string().max(60).optional(), coupleName: z.string().max(80).optional() }),
      req.body,
    );
    const { user, token } = await auth.registerUser(body);
    await auth.createCoupleForUser(user.id, body.coupleName ?? `${user.displayName}'s space`);
    setSessionCookie(reply, token);
    return reply.send({ user });
  });

  // Register a person WITHOUT creating a couple (invited partner flow).
  app.post("/api/auth/register-solo", { config: { rateLimit: REG_LIMIT } }, async (req, reply) => {
    const body = parse(credentials.extend({ displayName: z.string().max(60).optional() }), req.body);
    const { user, token } = await auth.registerUser(body);
    setSessionCookie(reply, token);
    return reply.send({ user });
  });

  app.post("/api/auth/login", { config: { rateLimit: LOGIN_LIMIT } }, async (req, reply) => {
    const body = parse(credentials, req.body);
    const { user, token } = await auth.login(body);
    setSessionCookie(reply, token);
    return reply.send({ user });
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await auth.logout(token);
    clearSessionCookie(reply);
    return reply.send({ ok: true });
  });

  app.get("/api/auth/me", async (req, reply) => {
    const demoMode = env.DEMO_MODE && env.NODE_ENV !== "production";
    const user = await currentUser(req);
    if (!user) return reply.send({ user: null, couple: null, demoMode });
    const couple = await auth.getCoupleForUser(user.id);
    const members = couple ? await auth.getMembers(couple.coupleId) : [];
    return reply.send({ user, couple, members, demoMode: env.DEMO_MODE && env.NODE_ENV !== "production" });
  });

  app.patch("/api/auth/profile", async (req, reply) => {
    const user = await requireUser(req);
    const body = parse(
      z.object({ displayName: z.string().max(60).optional(), avatarUrl: z.string().max(500).nullable().optional() }),
      req.body,
    );
    const updated = await auth.updateProfile(user.id, body);
    return reply.send({ user: updated });
  });

  // Create a couple for a solo user who just accepted/registered.
  app.post("/api/couple", async (req, reply) => {
    const user = await requireUser(req);
    const existing = await auth.getCoupleForUser(user.id);
    if (existing) return reply.send({ coupleId: existing.coupleId });
    const body = parse(z.object({ coupleName: z.string().max(80).optional() }), req.body);
    const res = await auth.createCoupleForUser(user.id, body.coupleName ?? `${user.displayName}'s space`);
    return reply.send(res);
  });

  // Invitations
  app.post("/api/invitations", async (req, reply) => {
    const { user, coupleId } = await requireCouple(req);
    const inv = await auth.createInvitation(coupleId, user.id);
    return reply.send(inv);
  });

  app.get("/api/invitations/:token", async (req, reply) => {
    const { token } = req.params as { token: string };
    return reply.send(await auth.inspectInvitation(token));
  });

  app.post("/api/invitations/:token/accept", async (req, reply) => {
    const user = await requireUser(req);
    const { token } = req.params as { token: string };
    const res = await auth.acceptInvitation(token, user.id);
    return reply.send(res);
  });
}
