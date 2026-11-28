/**
 * Where each platform API lives. Defaults point at the real services.
 * For local development, the *_BASE variables can redirect them to the mock
 * platform server (npm run mock:platforms). Overrides are IGNORED in
 * production so a stray variable can never send real tokens elsewhere.
 */
import type { Env } from '../types';
import { isProduction } from '../utils/config';

type OverrideKey =
  | 'META_GRAPH_BASE'
  | 'META_OAUTH_DIALOG_BASE'
  | 'GOOGLE_ADS_BASE'
  | 'GOOGLE_OAUTH_TOKEN_URL'
  | 'GOOGLE_OAUTH_AUTH_URL'
  | 'TIKTOK_API_BASE'
  | 'TIKTOK_PORTAL_BASE'
  | 'ANTHROPIC_API_BASE';

export interface Endpoints {
  metaGraph: string;
  metaVersion: string;
  metaOAuthDialog: string;
  googleAds: string;
  googleAdsVersion: string;
  googleOAuthToken: string;
  googleOAuthAuth: string;
  tiktok: string;
  tiktokPortal: string;
  anthropic: string;
}

export function getEndpoints(env: Env): Endpoints {
  const allowOverride = !isProduction(env);
  const pick = (name: OverrideKey, fallback: string) => {
    const override = env[name];
    return allowOverride && override ? override.replace(/\/+$/, '') : fallback;
  };

  return {
    metaGraph: pick('META_GRAPH_BASE', 'https://graph.facebook.com'),
    metaVersion: env.META_API_VERSION || 'v25.0',
    metaOAuthDialog: pick('META_OAUTH_DIALOG_BASE', 'https://www.facebook.com'),
    googleAds: pick('GOOGLE_ADS_BASE', 'https://googleads.googleapis.com'),
    googleAdsVersion: env.GOOGLE_ADS_API_VERSION || 'v25',
    googleOAuthToken: pick('GOOGLE_OAUTH_TOKEN_URL', 'https://oauth2.googleapis.com/token'),
    googleOAuthAuth: pick('GOOGLE_OAUTH_AUTH_URL', 'https://accounts.google.com/o/oauth2/v2/auth'),
    tiktok: pick('TIKTOK_API_BASE', 'https://business-api.tiktok.com/open_api/v1.3'),
    tiktokPortal: pick('TIKTOK_PORTAL_BASE', 'https://business-api.tiktok.com/portal/auth'),
    anthropic: pick('ANTHROPIC_API_BASE', 'https://api.anthropic.com'),
  };
}

const REAL_HOSTS = ['graph.facebook.com', 'googleads.googleapis.com', 'business-api.tiktok.com'];

/** True when any ad-platform URL points somewhere other than the real service (local mock server). */
export function isSandbox(env: Env): boolean {
  const ep = getEndpoints(env);
  return [ep.metaGraph, ep.googleAds, ep.tiktok].some(
    (url) => !REAL_HOSTS.some((host) => url.includes(host)),
  );
}
