import { sign, verify } from 'hono/jwt';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { isProduction } from './config.js';
import { randomHex } from './crypto.js';

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const JWT_ALG = 'HS256';

/** `__Host-` prefix (production only) stops sibling subdomains overwriting the cookie. */
export const cookieName = (env) => (isProduction(env) ? '__Host-ads_session' : 'ads_session');

function cookieOptions(env) {
  const configured = (env.COOKIE_SAMESITE || 'Lax').toLowerCase();
  const sameSite = { strict: 'Strict', lax: 'Lax', none: 'None' }[configured] || 'Lax';
  return {
    httpOnly: true, // JavaScript (and therefore XSS) can never read the token
    secure: isProduction(env),
    sameSite,
    path: '/',
  };
}

/**
 * Creates a server-side session (KV) and a signed JWT that points at it,
 * then sets the JWT as an httpOnly cookie. Deleting the KV entry revokes
 * the token immediately, which a bare JWT cannot do.
 */
export async function createSession(c, user) {
  const sessionId = randomHex(32);
  const now = Math.floor(Date.now() / 1000);

  await c.env.SESSIONS.put(
    `session:${sessionId}`,
    JSON.stringify({ userId: user.id, createdAt: new Date().toISOString() }),
    { expirationTtl: SESSION_TTL_SECONDS }
  );

  const token = await sign(
    { sub: user.id, sid: sessionId, iat: now, exp: now + SESSION_TTL_SECONDS },
    c.env.JWT_SECRET,
    JWT_ALG
  );

  setCookie(c, cookieName(c.env), token, { ...cookieOptions(c.env), maxAge: SESSION_TTL_SECONDS });
  return sessionId;
}

export function clearSessionCookie(c) {
  const { httpOnly, secure, sameSite, path } = cookieOptions(c.env);
  deleteCookie(c, cookieName(c.env), { httpOnly, secure, sameSite, path });
}

/**
 * Verifies the session cookie. Returns { userId, sessionId } or null.
 * - signature must be valid HS256 (no decode-only fallback)
 * - exp is REQUIRED (hono's verify() only checks it when present)
 * - the session must still exist in KV (logout / revocation)
 */
export async function readSession(c) {
  const token = getCookie(c, cookieName(c.env));
  if (!token) return null;

  let payload;
  try {
    payload = await verify(token, c.env.JWT_SECRET, JWT_ALG);
  } catch {
    return null;
  }

  if (
    typeof payload.exp !== 'number' ||
    typeof payload.sub !== 'string' ||
    typeof payload.sid !== 'string'
  ) {
    return null;
  }

  const session = await c.env.SESSIONS.get(`session:${payload.sid}`, 'json');
  if (!session || session.userId !== payload.sub) return null;

  return { userId: payload.sub, sessionId: payload.sid };
}

export async function destroySession(env, sessionId) {
  await env.SESSIONS.delete(`session:${sessionId}`);
}
