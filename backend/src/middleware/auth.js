import { readSession } from '../utils/session.js';

/**
 * Requires a valid session cookie. There is deliberately no fallback that
 * trusts an unverified token: anything that fails verification is a 401.
 */
export const authMiddleware = async (c, next) => {
  const session = await readSession(c);

  if (!session) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  c.set('userId', session.userId);
  c.set('sessionId', session.sessionId);
  await next();
};
