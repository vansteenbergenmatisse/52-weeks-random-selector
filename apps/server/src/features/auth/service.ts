import { timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../platform/db/prisma.js";
import { generateToken, hashPassword, hashToken, verifyPassword } from "../../platform/security/crypto.js";
import { Errors } from "../../shared/errors.js";
import { demoEnabled, env } from "../../platform/config/env.js";
import { createDefaultCollections } from "../collections/service.js";

/** Length-safe, constant-time string comparison (for the space passcode). */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

const SESSION_TTL_DAYS = 30;
const INVITE_TTL_HOURS = 72;
const MAX_MEMBERS = 2;

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

function toPublicUser(u: {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}): PublicUser {
  return { id: u.id, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl };
}

async function createSession(userId: string): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 864e5);
  await prisma.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });
  return token;
}

export async function registerUser(input: {
  username: string;
  password: string;
  displayName?: string;
}): Promise<{ user: PublicUser; token: string }> {
  const username = input.username.trim().toLowerCase();
  if (username.length < 3) throw Errors.badRequest("Username must be at least 3 characters");
  if (input.password.length < 5) throw Errors.badRequest("Password must be at least 5 characters");

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) throw Errors.conflict("That username is taken");

  let user;
  try {
    user = await prisma.user.create({
      data: {
        username,
        displayName: input.displayName?.trim() || input.username.trim(),
        passwordHash: await hashPassword(input.password),
      },
    });
  } catch (e) {
    // Two registrations for the same username can both pass the pre-check and
    // race to create(); the unique constraint turns that into a 409, not a 500.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw Errors.conflict("That username is taken");
    }
    throw e;
  }
  const token = await createSession(user.id);
  return { user: toPublicUser(user), token };
}

export async function login(input: {
  username: string;
  password: string;
}): Promise<{ user: PublicUser; token: string }> {
  const username = input.username.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { username } });
  // Constant-ish work whether or not the user exists.
  const ok = user ? await verifyPassword(input.password, user.passwordHash) : false;
  if (!user || !ok) throw Errors.unauthorized("Invalid username or password");

  // The one-tap Teresa/Matisse accounts never sign in with a password — they
  // enter through the passcode-gated space picker (spaceLogin). Rejecting them
  // here closes the shared/weak-password path entirely, regardless of what the
  // seeded password is.
  if (user.isDemo) {
    throw Errors.forbidden("Use the one-tap space picker to enter");
  }
  const token = await createSession(user.id);
  return { user: toPublicUser(user), token };
}

/**
 * Enter the shared couple space as a seeded (demo) member — Teresa or Matisse.
 * This is the ONLY way those one-tap accounts sign in: it's gated by demo mode
 * and, on a public deploy, by a shared SPACE_PASSCODE, so the client never holds
 * a reusable password and a stranger with the URL can't tap straight in.
 */
export async function spaceLogin(input: {
  username: string;
  passcode: string;
}): Promise<{ user: PublicUser; token: string }> {
  if (!demoEnabled) throw Errors.forbidden("The shared-space picker is turned off");
  if (env.SPACE_PASSCODE && !safeEqual(input.passcode, env.SPACE_PASSCODE)) {
    throw Errors.unauthorized("That space passcode isn't right");
  }
  const username = input.username.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.isDemo) throw Errors.unauthorized("Unknown space member");
  const token = await createSession(user.id);
  return { user: toPublicUser(user), token };
}

export async function logout(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function getUserByToken(token: string): Promise<PublicUser | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt.getTime() < Date.now()) return null;
  // A demo session must stop working the instant demo mode is turned off — not up
  // to 30 days later when the session naturally expires. Re-check on every request.
  if (session.user.isDemo && !demoEnabled) return null;
  return toPublicUser(session.user);
}

/** Create a fresh couple space for a user who has none, seeding default collections. */
export async function createCoupleForUser(userId: string, coupleName: string): Promise<{ coupleId: string }> {
  const name = coupleName.trim() || "Our space";
  const couple = await prisma.$transaction(async (tx) => {
    const c = await tx.couple.create({ data: { name } });
    await tx.membership.create({ data: { coupleId: c.id, userId, role: "owner" } });
    await createDefaultCollections(tx, c.id);
    return c;
  });
  return { coupleId: couple.id };
}

export async function createInvitation(
  coupleId: string,
  createdByUserId: string,
): Promise<{ token: string; url: string; expiresAt: Date }> {
  const count = await prisma.membership.count({ where: { coupleId } });
  if (count >= MAX_MEMBERS) throw Errors.conflict("This space already has two people");

  const token = generateToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3600e3);
  await prisma.invitation.create({
    data: { coupleId, createdByUserId, tokenHash: hashToken(token), expiresAt },
  });
  return { token, url: `${env.APP_BASE_URL}/invite/${token}`, expiresAt };
}

export async function inspectInvitation(
  token: string,
): Promise<{ valid: boolean; coupleName?: string; reason?: string }> {
  const inv = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { couple: true },
  });
  if (!inv) return { valid: false, reason: "This invitation link is not valid" };
  if (inv.usedAt) return { valid: false, reason: "This invitation has already been used" };
  if (inv.expiresAt.getTime() < Date.now()) return { valid: false, reason: "This invitation has expired" };
  return { valid: true, coupleName: inv.couple.name };
}

/**
 * Accept an invitation. Enforces single-use AND the two-person cap atomically,
 * even under simultaneous acceptance, via a serializable transaction with a
 * conditional (usedAt IS NULL) claim and a live membership count re-check.
 */
export async function acceptInvitation(
  token: string,
  userId: string,
): Promise<{ coupleId: string }> {
  const tokenHash = hashToken(token);

  const run = async () =>
    prisma.$transaction(
      async (tx) => {
        const inv = await tx.invitation.findUnique({ where: { tokenHash } });
        if (!inv) throw Errors.notFound("This invitation link is not valid");
        if (inv.expiresAt.getTime() < Date.now()) throw Errors.conflict("This invitation has expired");

        // Claim the single-use token atomically.
        const claimed = await tx.invitation.updateMany({
          where: { id: inv.id, usedAt: null },
          data: { usedAt: new Date(), usedByUserId: userId },
        });
        if (claimed.count !== 1) throw Errors.conflict("This invitation has already been used");

        // Already a member? Idempotent success.
        const already = await tx.membership.findUnique({
          where: { coupleId_userId: { coupleId: inv.coupleId, userId } },
        });
        if (already) return { coupleId: inv.coupleId };

        // A user belongs to exactly one couple space here. If they're already in a
        // DIFFERENT couple, refuse — otherwise they'd burn this couple's only free
        // slot (the intended partner could never join) while the new membership
        // stays invisible to them (getCoupleForUser returns their first couple).
        // The throw rolls back the whole transaction, releasing the token claim.
        const other = await tx.membership.findFirst({
          where: { userId, coupleId: { not: inv.coupleId } },
        });
        if (other) throw Errors.conflict("You're already part of a couple space");

        const members = await tx.membership.count({ where: { coupleId: inv.coupleId } });
        if (members >= MAX_MEMBERS) throw Errors.conflict("This space already has two people");

        await tx.membership.create({ data: { coupleId: inv.coupleId, userId, role: "member" } });
        return { coupleId: inv.coupleId };
      },
      // SQLite serializes writes with a single database-wide lock, so the
      // two-person cap holds without an explicit isolation level (which SQLite
      // doesn't accept). The unique(coupleId,userId) + count check still guard it.
    );

  // Retry once on a serialization conflict (concurrent acceptance).
  try {
    return await run();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2034" || e.code === "P2002")) {
      return run();
    }
    throw e;
  }
}

/** The couple a user belongs to (each user is in at most one couple here). */
export async function getCoupleForUser(userId: string): Promise<{ coupleId: string; name: string } | null> {
  const m = await prisma.membership.findFirst({
    where: { userId },
    include: { couple: true },
    orderBy: { joinedAt: "asc" },
  });
  return m ? { coupleId: m.coupleId, name: m.couple.name } : null;
}

export async function getMembers(coupleId: string): Promise<PublicUser[]> {
  const ms = await prisma.membership.findMany({
    where: { coupleId },
    include: { user: true },
    orderBy: { joinedAt: "asc" },
  });
  return ms.map((m) => toPublicUser(m.user));
}

export async function updateProfile(
  userId: string,
  input: { displayName?: string; avatarUrl?: string | null },
): Promise<PublicUser> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      displayName: input.displayName?.trim() || undefined,
      avatarUrl: input.avatarUrl === undefined ? undefined : input.avatarUrl,
    },
  });
  return toPublicUser(user);
}
