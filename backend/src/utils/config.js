/**
 * Environment helpers: production flag, CORS origins, and a startup-style
 * check that refuses to serve requests when required secrets are missing.
 */

export const isProduction = (env) => env.ENVIRONMENT === 'production';

const DEV_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

/**
 * Allowed browser origins (CORS + CSRF origin check).
 * Set ALLOWED_ORIGINS="https://app.example.com,https://www.example.com".
 * In development it falls back to localhost; in production there is NO
 * fallback, so a missing value blocks all browser access instead of
 * silently allowing everything.
 */
export function getAllowedOrigins(env) {
  const configured = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  if (configured.length > 0) return configured;
  return isProduction(env) ? [] : DEV_ORIGINS;
}

function decodedLength(base64) {
  try {
    return atob(base64).length;
  } catch {
    return -1;
  }
}

/** Returns a list of configuration problems (empty list = OK). */
export function getConfigProblems(env) {
  const problems = [];

  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    problems.push('JWT_SECRET is missing or shorter than 32 characters');
  }

  if (!env.ENCRYPTION_KEY || decodedLength(env.ENCRYPTION_KEY) !== 32) {
    problems.push('ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }

  if (isProduction(env) && getAllowedOrigins(env).length === 0) {
    problems.push('ALLOWED_ORIGINS must be set in production');
  }

  return problems;
}
