/**
 * Minimal fetch wrapper for ad-platform APIs.
 *  - timeouts, JSON parsing, uniform PlatformError
 *  - classifies errors as retryable (network, timeout, 429, 5xx) or not
 *  - secrets travel in headers only, and are never put in error messages
 */

/**
 * Third-party API payloads are not under our control. Reads from this type are
 * checked where a field matters (see the explicit response interfaces in the adapters).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ApiJson = any;

export interface PlatformErrorOptions {
  platform?: string;
  status?: number;
  code?: string;
  retryable?: boolean;
  retryAfter?: number;
  body?: ApiJson;
}

export class PlatformError extends Error {
  platform?: string;
  status?: number;
  code: string;
  retryable: boolean;
  retryAfter?: number;
  /** Raw platform response (never sent to clients). */
  body?: ApiJson;

  constructor(message: string, options: PlatformErrorOptions = {}) {
    super(message);
    this.name = 'PlatformError';
    this.platform = options.platform;
    this.status = options.status;
    this.code = options.code ?? 'PLATFORM_ERROR';
    this.retryable = options.retryable ?? false;
    this.retryAfter = options.retryAfter;
    this.body = options.body;
  }
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | undefined | null>;
  json?: unknown;
  form?: Record<string, string>;
  timeoutMs?: number;
  platform?: string;
}

const AUTH_STATUSES = new Set([401, 403]);

export async function httpRequest<T = ApiJson>(
  url: string,
  { method = 'GET', headers = {}, query, json, form, timeoutMs = 20000, platform }: RequestOptions = {},
): Promise<T> {
  const target = new URL(url);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) target.searchParams.set(key, String(value));
    }
  }

  const init: RequestInit = {
    method,
    headers: { Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (json !== undefined) {
    init.body = JSON.stringify(json);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  } else if (form) {
    init.body = new URLSearchParams(form);
  }

  let response: Response;
  try {
    response = await fetch(target, init);
  } catch (error) {
    const name = (error as { name?: string })?.name;
    const timedOut = name === 'TimeoutError' || name === 'AbortError';
    throw new PlatformError(timedOut ? 'Request to the platform timed out' : 'Could not reach the platform', {
      platform,
      code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
      retryable: true,
    });
  }

  const text = await response.text();
  let body: ApiJson = {};
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
      code: AUTH_STATUSES.has(response.status)
        ? 'AUTH_FAILED'
        : response.status === 429
          ? 'RATE_LIMITED'
          : 'PLATFORM_ERROR',
      retryable: response.status === 429 || response.status >= 500,
      retryAfter: Number.isNaN(retryAfter) ? undefined : retryAfter,
      body,
    });
  }

  return body as T;
}

/** Pulls a human-readable message out of the different error shapes platforms use. */
export function extractErrorMessage(body: ApiJson): string {
  if (!body || typeof body !== 'object') return '';
  const e = body.error;
  if (e && typeof e === 'object') {
    return (
      e.error_user_msg || e.message || (Array.isArray(e.details) && e.details[0]?.errors?.[0]?.message) || ''
    );
  }
  if (typeof e === 'string') return e;
  return body.message || '';
}
