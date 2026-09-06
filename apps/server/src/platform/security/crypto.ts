import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { isTest } from "../config/env.js";

// Cost 12 in real use; a low cost under test keeps the suite fast.
const BCRYPT_COST = isTest ? 6 : 12;

/** Hash a password with bcrypt. */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Generate a high-entropy opaque token (URL-safe). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Hash a token for at-rest storage. Tokens are already high-entropy random
 * values, so a fast SHA-256 is appropriate (unlike low-entropy passwords).
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Deterministic key used to de-duplicate inbound WhatsApp events. */
export function eventKey(parts: Array<string | number | undefined | null>): string {
  return createHash("sha256").update(parts.map((p) => String(p ?? "")).join("|")).digest("hex");
}
