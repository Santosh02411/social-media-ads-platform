/**
 * OAuth 2.0 authorization-code flows for Meta (Facebook + Instagram), Google Ads and TikTok.
 * App-level secrets come from the environment; users only ever see the provider's consent screen.
 */
import { getEndpoints } from '../adapters/endpoints.js';
import { httpRequest, PlatformError } from '../adapters/http.js';
import { getAllowedOrigins, isProduction } from '../utils/config.js';

const FAMILY = { facebook: 'meta', instagram: 'meta', google: 'google', tiktok: 'tiktok' };

export const OAUTH_STATE_TTL_SECONDS = 600;

export function oauthConfigured(env, type) {
  switch (FAMILY[type]) {
    case 'meta': return Boolean(env.META_APP_ID && env.META_APP_SECRET);
    case 'google': return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_ADS_DEVELOPER_TOKEN);
    case 'tiktok': return Boolean(env.TIKTOK_APP_ID && env.TIKTOK_APP_SECRET);
    default: return false;
  }
}

/** Public base URL of this API (what providers redirect back to). */
export function publicApiUrl(env) {
  const url = (env.PUBLIC_API_URL || (isProduction(env) ? '' : 'http://localhost:8787')).replace(/\/+$/, '');
  return url;
}

export const redirectUri = (env, type) => `${publicApiUrl(env)}/api/oauth/callback/${type}`;

/** Where the browser lands after the flow: must be one of ALLOWED_ORIGINS. */
export function frontendUrl(env) {
  const allowed = getAllowedOrigins(env);
  const configured = (env.FRONTEND_URL || '').replace(/\/+$/, '');
  return allowed.includes(configured) ? configured : allowed[0];
}

export function buildAuthUrl(env, type, state) {
  const ep = getEndpoints(env);
  const redirect_uri = redirectUri(env, type);

  switch (FAMILY[type]) {
    case 'meta': {
      const scopes = ['ads_management', 'ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement'];
      if (type === 'instagram') scopes.push('instagram_basic');
      const url = new URL(`${ep.metaOAuthDialog}/${ep.metaVersion}/dialog/oauth`);
      url.search = new URLSearchParams({ client_id: env.META_APP_ID, redirect_uri, state, scope: scopes.join(','), response_type: 'code' });
      return url.toString();
    }
    case 'google': {
      const url = new URL(ep.googleOAuthAuth);
      url.search = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/adwords',
        access_type: 'offline',
        prompt: 'consent', // forces a refresh token even if the user authorised before
        state,
      });
      return url.toString();
    }
    case 'tiktok': {
      const url = new URL(ep.tiktokPortal);
      url.search = new URLSearchParams({ app_id: env.TIKTOK_APP_ID, redirect_uri, state });
      return url.toString();
    }
    default:
      throw new Error(`OAuth is not supported for ${type}`);
  }
}

/** Exchanges the authorization code for tokens. Returns credential fields to store. */
export async function exchangeCode(env, type, code) {
  const ep = getEndpoints(env);
  const redirect_uri = redirectUri(env, type);

  switch (FAMILY[type]) {
    case 'meta': {
      const graph = `${ep.metaGraph}/${ep.metaVersion}/oauth/access_token`;
      const short = await httpRequest(graph, {
        method: 'POST',
        form: { client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, redirect_uri, code },
        platform: type,
      });
      // Short-lived (~1h) -> long-lived (~60 days) token
      const long = await httpRequest(graph, {
        method: 'POST',
        form: { grant_type: 'fb_exchange_token', client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, fb_exchange_token: short.access_token },
        platform: type,
      });
      return {
        accessToken: long.access_token,
        tokenExpiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null,
      };
    }
    case 'google': {
      const res = await httpRequest(ep.googleOAuthToken, {
        method: 'POST',
        form: { code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri, grant_type: 'authorization_code' },
        platform: type,
      });
      if (!res.refresh_token) {
        throw new PlatformError('Google did not return a refresh token. Remove this app from your Google account permissions and try again.', { platform: type });
      }
      return { refreshToken: res.refresh_token };
    }
    case 'tiktok': {
      const res = await httpRequest(`${ep.tiktok}/oauth2/access_token/`, {
        method: 'POST',
        json: { app_id: env.TIKTOK_APP_ID, secret: env.TIKTOK_APP_SECRET, auth_code: code },
        platform: type,
      });
      if (res.code !== 0 || !res.data?.access_token) {
        throw new PlatformError(res.message || 'TikTok did not return an access token', { platform: type });
      }
      return { accessToken: res.data.access_token, advertiserIds: (res.data.advertiser_ids || []).map(String) };
    }
    default:
      throw new Error(`OAuth is not supported for ${type}`);
  }
}
