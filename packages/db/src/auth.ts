/**
 * Accounts, sessions and claiming a club.
 *
 * Passwords are scrypt-hashed with a per-user salt, and the parameters are stored
 * alongside so they can be raised later without invalidating anyone. The session
 * cookie carries a random token and only its SHA-256 is stored, so a leaked
 * database does not hand over live sessions.
 */

import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { promisify } from 'node:util';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { clubs, sessions, users } from './schema.js';

// promisify loses the overload that takes tuning options, so name the shape.
const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

const SCRYPT = { N: 16_384, r: 8, p: 1, keyLength: 64 };
export const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT.keyLength, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), derived.toString('base64')].join(
    '$',
  );
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;

  const expected = Buffer.from(hash, 'base64');
  const derived = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });

  // Constant-time: a length check first, because timingSafeEqual throws on mismatch.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

function tokenHashOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface AccountResult {
  ok: boolean;
  userId?: string;
  error?: string;
}

export async function registerUser(
  db: Database,
  input: { email: string; displayName: string; password: string },
): Promise<AccountResult> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'that is not an email address' };
  if (input.password.length < 8) return { ok: false, error: 'use at least eight characters' };
  if (input.displayName.trim().length < 2) return { ok: false, error: 'pick a name to be known by' };

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing.length > 0) return { ok: false, error: 'there is already an account with that email' };

  const [created] = await db
    .insert(users)
    .values({
      email,
      displayName: input.displayName.trim(),
      passwordHash: await hashPassword(input.password),
    })
    .returning({ id: users.id });

  return created ? { ok: true, userId: created.id } : { ok: false, error: 'could not create the account' };
}

export async function authenticate(
  db: Database,
  email: string,
  password: string,
): Promise<AccountResult> {
  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()));

  // Same message either way: which half was wrong is not the visitor's business.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { ok: false, error: 'that email and password do not match' };
  }
  return { ok: true, userId: user.id };
}

export interface SessionToken {
  token: string;
  expiresAt: Date;
}

export async function createSession(db: Database, userId: string): Promise<SessionToken> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ userId, tokenHash: tokenHashOf(token), expiresAt });
  await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, userId));
  return { token, expiresAt };
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  clubId: string | null;
}

export async function sessionUser(db: Database, token: string | null): Promise<SessionUser | null> {
  if (!token) return null;

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, tokenHashOf(token)));

  if (!row || row.expiresAt <= new Date()) return null;

  const [club] = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.managerUserId, row.id));
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    clubId: club?.id ?? null,
  };
}

export async function destroySession(db: Database, token: string | null): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHashOf(token)));
}

export async function pruneSessions(db: Database): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

// --- claiming ---------------------------------------------------------------

export async function unclaimedClubs(db: Database) {
  return db
    .select({ id: clubs.id, name: clubs.name, short: clubs.short, capacity: clubs.stadiumCapacity })
    .from(clubs)
    .where(isNull(clubs.managerUserId))
    .orderBy(clubs.name);
}

/**
 * Take over an AI club.
 *
 * One club per manager, and only a club nobody else has. The update is conditional
 * on `managerUserId` still being null, so two people clicking at once cannot both
 * end up owning it -- the second one gets told it is taken.
 */
export async function claimClub(
  db: Database,
  userId: string,
  clubId: string,
): Promise<{ ok: boolean; error?: string }> {
  const already = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.managerUserId, userId));
  if (already.length > 0) return { ok: false, error: 'you already manage a club' };

  const claimed = await db
    .update(clubs)
    .set({ managerUserId: userId })
    .where(and(eq(clubs.id, clubId), isNull(clubs.managerUserId)))
    .returning({ id: clubs.id });

  if (claimed.length === 0) return { ok: false, error: 'someone else got there first' };
  return { ok: true };
}

export async function releaseClub(db: Database, userId: string): Promise<void> {
  await db.update(clubs).set({ managerUserId: null }).where(eq(clubs.managerUserId, userId));
}

export async function managerCount(db: Database): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  return row?.count ?? 0;
}
