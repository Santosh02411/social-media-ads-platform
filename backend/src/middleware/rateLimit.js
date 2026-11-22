import { sha256Hex } from '../utils/crypto.js';

const clientIp = (c) => c.req.header('CF-Connecting-IP') || 'local';

/**
 * Fixed-window rate limiter backed by Workers KV (the SESSIONS namespace).
 * NOTE: KV is eventually consistent and not atomic, so this is a good
 * brute-force speed bump, not an exact limiter. For hard guarantees in
 * production add a Cloudflare WAF rate-limiting rule on /api/auth/*.
 */
export function rateLimit({ name, limit, windowSeconds, by }) {
  return async (c, next) => {
    const now = Date.now();
    const windowId = Math.floor(now / (windowSeconds * 1000));
    const key = `rl:${name}:${by ? by(c) : clientIp(c)}:${windowId}`;

    const current = parseInt((await c.env.SESSIONS.get(key)) || '0', 10);
    if (current >= limit) {
      const retryAfter = windowSeconds - (Math.floor(now / 1000) % windowSeconds);
      c.header('Retry-After', String(retryAfter));
      return c.json({ error: 'Too many requests. Please try again later.' }, 429);
    }

    await c.env.SESSIONS.put(key, String(current + 1), { expirationTtl: Math.max(60, windowSeconds) });
    return next();
  };
}

/* ---- per-account failed-login lockout (so botnets rotating IPs still get throttled) ---- */

const FAILED_LOGIN_LIMIT = 5;
const FAILED_LOGIN_WINDOW_SECONDS = 15 * 60;

const failedKey = async (email) => `rl:login-fail:${await sha256Hex(email)}`;

export async function isLoginLocked(env, email) {
  const count = parseInt((await env.SESSIONS.get(await failedKey(email))) || '0', 10);
  return count >= FAILED_LOGIN_LIMIT;
}

export async function recordFailedLogin(env, email) {
  const key = await failedKey(email);
  const count = parseInt((await env.SESSIONS.get(key)) || '0', 10);
  await env.SESSIONS.put(key, String(count + 1), { expirationTtl: FAILED_LOGIN_WINDOW_SECONDS });
}

export async function clearFailedLogins(env, email) {
  await env.SESSIONS.delete(await failedKey(email));
}

export const LOGIN_LOCK_SECONDS = FAILED_LOGIN_WINDOW_SECONDS;
