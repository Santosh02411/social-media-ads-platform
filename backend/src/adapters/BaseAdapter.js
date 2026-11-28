import { getEndpoints } from './endpoints.js';
import { PlatformError } from './http.js';

/**
 * Every platform adapter implements this interface.
 *
 * `ad` (input to publishAd) is platform-neutral:
 *   {
 *     name, objective: 'TRAFFIC' | 'AWARENESS',
 *     budget:   { amount, type: 'daily' | 'lifetime' },   // major currency units
 *     schedule: { start: ISO | null, end: ISO | null },
 *     targeting:{ countries: ['US'], ageMin, ageMax, keywords: [] },
 *     creative: { headline, body, url, cta, headlines: [], descriptions: [] },
 *     media:    [{ id, kind: 'image' | 'video', mimeType, name, getBytes(), publicUrl() }],
 *     startPaused: boolean
 *   }
 *
 * publishAd is resumable: it receives the `state` saved by a previous failed
 * attempt and calls `saveState(state)` after creating each remote object, so a
 * retry continues instead of creating duplicates.
 */
export class BaseAdapter {
  constructor(platform, env) {
    this.platform = platform;
    this.cfg = platform.config || {};
    this.env = env;
    this.endpoints = getEndpoints(env);
  }

  /** Checks the stored credentials against the real platform. Returns { accountName, currency } or throws PlatformError. */
  async validateCredentials() { throw new Error('validateCredentials not implemented'); }

  /** Lists ad accounts (and pages, etc.) the token can use: { accounts: [{id, name}], pages?: [...] }. */
  async listAccounts() { throw new Error('listAccounts not implemented'); }

  /** Creates the campaign/ad on the platform. Returns { externalId, externalRef }. */
  async publishAd(ad, ctx) { throw new Error('publishAd not implemented'); }

  /** Activates or pauses what publishAd created. status: 'active' | 'paused'. */
  async setStatus(ref, status) { throw new Error('setStatus not implemented'); }

  /** Daily performance rows: [{ date, impressions, clicks, spend, conversions }]. */
  async getInsights(ref, range) { throw new Error('getInsights not implemented'); }

  log(level, message, context = {}) {
    // Context must never contain credentials
    console.log(`[${this.platform.type}] ${level.toUpperCase()}: ${message}`, context);
  }
}

/** Throws a clear error when a creative is missing something the platform requires. */
export function requireFields(platformLabel, checks) {
  const missing = checks.filter(([, value]) => !value).map(([label]) => label);
  if (missing.length > 0) {
    throw new PlatformError(`${platformLabel}: missing ${missing.join(', ')}`, { code: 'INVALID_CREATIVE', retryable: false });
  }
}

export const toIsoDate = (iso) => new Date(iso).toISOString().slice(0, 10);

export function daysBetweenInclusive(startIso, endIso) {
  const ms = new Date(endIso).setUTCHours(0, 0, 0, 0) - new Date(startIso).setUTCHours(0, 0, 0, 0);
  return Math.max(1, Math.round(ms / 86400000) + 1);
}
