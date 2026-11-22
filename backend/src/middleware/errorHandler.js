import { getConfigProblems, isProduction } from '../utils/config.js';

/**
 * Registered with app.onError(). (Hono catches handler errors itself, so a
 * try/catch middleware never sees them; onError is the supported hook.)
 * Internal messages are only exposed outside production.
 */
export const errorHandler = (error, c) => {
  console.error('Unhandled error:', error);

  if (error?.status && error.status < 500 && typeof error.getResponse === 'function') {
    return error.getResponse();
  }

  return c.json(
    {
      error: 'Internal Server Error',
      ...(isProduction(c.env) ? {} : { message: error?.message }),
    },
    500
  );
};

/** Refuses to serve requests when required secrets are missing or malformed. */
export const configGuard = async (c, next) => {
  const problems = getConfigProblems(c.env);
  if (problems.length > 0) {
    console.error('Server misconfigured:', problems.join('; '));
    return c.json({ error: 'Server is not configured correctly' }, 500);
  }
  return next();
};
