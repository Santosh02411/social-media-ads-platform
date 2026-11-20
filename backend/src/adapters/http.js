/**
 * Minimal fetch wrapper for ad-platform APIs.
 *  - timeouts, JSON parsing, uniform PlatformError
 *  - classifies errors as retryable (network, timeout, 429, 5xx) or not
 *  - secrets travel in headers only, and are never put in error messages
 */
export class PlatformError extends Error {
  constructor(message, { platform, status, code = 'PLATFORM_ERROR', retryable = false, retryAfter, body } = {}) {
    super(message);
    this.name = 'PlatformError';
    this.platform = platform;
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.retryAfter = retryAfter;
    this.body = body; // raw platform response (never sent to clients)
  }
}

const AUTH_STATUSES = new Set([401, 403]);

export async function httpRequest(url, { method = 'GET', headers = {}, query, json, form, timeoutMs = 20000, platform } = {}) {
  const target = new URL(url);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) target.searchParams.set(key, String(value));
    }
  }

  const init = { method, headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeoutMs) };
  if (json !== undefined) {
    init.body = JSON.stringify(json);
    init.headers['Content-Type'] = 'application/json';
  } else if (form) {
    init.body = new URLSearchParams(form);
  }

  let response;
  try {
    response = await fetch(target, init);
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw new PlatformError(timedOut ? 'Request to the platform timed out' : 'Could not reach the platform', {
      platform,
      code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
      retryable: true,
    });
  }

  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 300) };
    }
  }

  if (!response.ok) {
    const retryAfter = parseInt(response.headers.get('retry-after') || '', 10);
    throw new PlatformError(extractErrorMessage(body) || `Platform returned HTTP ${response.status}`, {
      platform,
      status: response.status,
      code: AUTH_STATUSES.has(response.status) ? 'AUTH_FAILED' : response.status === 429 ? 'RATE_LIMITED' : 'PLATFORM_ERROR',
      retryable: response.status === 429 || response.status >= 500,
      retryAfter: Number.isNaN(retryAfter) ? undefined : retryAfter,
      body,
    });
  }

  return body;
}

/** Pulls a human-readable message out of the different error shapes platforms use. */
export function extractErrorMessage(body) {
  if (!body || typeof body !== 'object') return '';
  const e = body.error;
  if (e && typeof e === 'object') {
    return e.error_user_msg || e.message || (Array.isArray(e.details) && e.details[0]?.errors?.[0]?.message) || '';
  }
  if (typeof e === 'string') return e;
  return body.message || '';
}
