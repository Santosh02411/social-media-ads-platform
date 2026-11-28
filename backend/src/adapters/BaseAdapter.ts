import type { Env, PlatformConfig } from '../types';
import { getEndpoints, type Endpoints } from './endpoints';
import { PlatformError } from './http';
import type {
  Ad,
  AccountInfo,
  AccountOptions,
  AdapterPlatform,
  ExternalState,
  InsightRow,
  PublishContext,
  PublishResult,
} from './types';

/**
 * Every platform adapter implements this interface.
 *
 * publishAd is resumable: it receives the `state` saved by a previous failed
 * attempt and calls `saveState(state)` after creating each remote object, so a
 * retry continues instead of creating duplicates.
 */
export abstract class BaseAdapter {
  protected readonly cfg: PlatformConfig;
  protected readonly endpoints: Endpoints;

  constructor(
    protected readonly platform: AdapterPlatform,
    protected readonly env: Env,
  ) {
    this.cfg = platform.config || {};
    this.endpoints = getEndpoints(env);
  }

  /** Checks the stored credentials against the real platform; throws PlatformError when they are bad. */
  abstract validateCredentials(): Promise<AccountInfo>;

  /** Lists ad accounts (and pages, etc.) the token can use. */
  abstract listAccounts(): Promise<AccountOptions>;

  /** Creates the campaign/ad on the platform. */
  abstract publishAd(ad: Ad, ctx?: PublishContext): Promise<PublishResult>;

  /** Activates or pauses what publishAd created. */
  abstract setStatus(ref: ExternalState, status: 'active' | 'paused'): Promise<void>;

  /** Daily performance rows for [since, until] (YYYY-MM-DD). */
  abstract getInsights(ref: ExternalState, range: { since: string; until: string }): Promise<InsightRow[]>;

  protected log(
    level: 'info' | 'warn' | 'error',
    message: string,
    context: Record<string, unknown> = {},
  ): void {
    // Context must never contain credentials
    console.log(`[${this.platform.type}] ${level.toUpperCase()}: ${message}`, context);
  }
}

/** Throws a clear error when a creative is missing something the platform requires. */
export function requireFields(platformLabel: string, checks: [label: string, value: unknown][]): void {
  const missing = checks.filter(([, value]) => !value).map(([label]) => label);
  if (missing.length > 0) {
    throw new PlatformError(`${platformLabel}: missing ${missing.join(', ')}`, {
      code: 'INVALID_CREATIVE',
      retryable: false,
    });
  }
}

export const toIsoDate = (iso: string) => new Date(iso).toISOString().slice(0, 10);

export function daysBetweenInclusive(startIso: string, endIso: string): number {
  const ms = new Date(endIso).setUTCHours(0, 0, 0, 0) - new Date(startIso).setUTCHours(0, 0, 0, 0);
  return Math.max(1, Math.round(ms / 86400000) + 1);
}
