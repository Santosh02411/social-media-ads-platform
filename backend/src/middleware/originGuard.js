import { getAllowedOrigins } from '../utils/config.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie auth. Browsers always attach an Origin header
 * to cross-site and same-site POST/PUT/DELETE requests, and a malicious page
 * cannot forge it. Any state-changing request must come from an allowed origin.
 */
export const originGuard = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();

  const origin = c.req.header('Origin');
  if (!origin || !getAllowedOrigins(c.env).includes(origin)) {
    return c.json({ error: 'Request origin not allowed' }, 403);
  }

  return next();
};
