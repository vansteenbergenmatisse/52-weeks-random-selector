import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { getUserByToken, getCoupleForUser, type PublicUser } from "../features/auth/service.js";
import { AppError, Errors } from "../shared/errors.js";
import { isProd } from "../platform/config/env.js";

export const SESSION_COOKIE = "s52_session";

export function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
    maxAge: 30 * 24 * 3600,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export async function currentUser(req: FastifyRequest): Promise<PublicUser | null> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  return getUserByToken(token);
}

export async function requireUser(req: FastifyRequest): Promise<PublicUser> {
  const user = await currentUser(req);
  if (!user) throw Errors.unauthorized();
  return user;
}

/** Require an authenticated user who belongs to a couple; returns both. */
export async function requireCouple(req: FastifyRequest): Promise<{ user: PublicUser; coupleId: string }> {
  const user = await requireUser(req);
  const couple = await getCoupleForUser(user.id);
  if (!couple) throw Errors.forbidden("You are not part of a couple space yet");
  return { user, coupleId: couple.coupleId };
}

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const res = schema.safeParse(data);
  if (!res.success) {
    const first = res.error.issues[0];
    throw Errors.badRequest(first ? `${first.path.join(".")}: ${first.message}` : "Invalid request");
  }
  return res.data;
}

export function handleError(err: unknown, reply: FastifyReply) {
  if (err instanceof AppError) {
    return reply.status(err.status).send({ error: err.code, message: err.message });
  }
  reply.log.error({ err: String(err) }, "Unhandled error");
  return reply.status(500).send({ error: "internal", message: "Something went wrong" });
}
