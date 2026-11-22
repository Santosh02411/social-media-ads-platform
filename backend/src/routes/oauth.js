import { Hono } from 'hono';
import { Platform } from '../models/Platform.js';
import { Log } from '../models/Log.js';
import { adapterFactory, SUPPORTED_PLATFORMS } from '../adapters/AdapterFactory.js';
import { exchangeCode, frontendUrl, oauthConfigured } from '../services/oauth.js';
import { readSession } from '../utils/session.js';

/**
 * Public OAuth callback. The provider sends the browser here with ?code&state.
 * Trust comes from the single-use `state` we issued AND the signed-in session
 * matching the user that started the flow.
 */
const oauth = new Hono();

oauth.get('/callback/:type', async (c) => {
  const type = c.req.param('type');
  const back = (query) => c.redirect(`${frontendUrl(c.env)}/integrations?${new URLSearchParams(query)}`);

  if (!SUPPORTED_PLATFORMS.includes(type) || !oauthConfigured(c.env, type)) return back({ oauth: 'error', reason: 'not_configured' });

  const { state, error } = c.req.query();
  const code = c.req.query('code') || c.req.query('auth_code'); // TikTok sends auth_code
  if (error) return back({ oauth: 'error', reason: 'denied' });
  if (!state || !code) return back({ oauth: 'error', reason: 'invalid_request' });

  const stored = await c.env.SESSIONS.get(`oauth:${state}`, 'json');
  if (!stored || stored.type !== type) return back({ oauth: 'error', reason: 'invalid_state' });
  await c.env.SESSIONS.delete(`oauth:${state}`); // single use

  const session = await readSession(c);
  if (!session || session.userId !== stored.userId) return back({ oauth: 'error', reason: 'session_mismatch' });

  const platforms = new Platform(c.env.DB, c.env.ENCRYPTION_KEY);
  const platform = await platforms.findById(stored.platformId);
  if (!platform || platform.user_id !== session.userId) return back({ oauth: 'error', reason: 'platform_not_found' });

  try {
    const tokens = await exchangeCode(c.env, type, code);
    const { advertiserIds, ...credentials } = tokens;
    const draft = { ...platform, config: { ...platform.config, ...credentials } };

    // Pick a sensible default account; the user can change it afterwards
    const options = await adapterFactory.create(draft, c.env).listAccounts();
    const accounts = options.accounts?.length ? options.accounts : (advertiserIds || []).map((id) => ({ id, name: id }));
    const account = accounts[0];
    if (!account) return back({ oauth: 'error', reason: 'no_ad_accounts' });

    const patch = { ...credentials, accountId: account.id, accountName: account.name, currency: account.currency || null, authMethod: 'oauth' };

    if (type === 'facebook' || type === 'instagram') {
      const pages = options.pages || [];
      const page = type === 'instagram' ? pages.find((p) => p.instagramUserId) : pages[0];
      if (!page) return back({ oauth: 'error', reason: type === 'instagram' ? 'no_instagram_account' : 'no_pages' });
      patch.pageId = page.id;
      if (type === 'instagram') patch.instagramUserId = page.instagramUserId;
    }

    // Final check against the real API before we call it connected
    const info = await adapterFactory.create({ ...platform, config: { ...platform.config, ...patch } }, c.env).validateCredentials();
    await platforms.connect(platform.id, patch, { accountName: info.accountName || account.name, currency: info.currency || account.currency });

    await new Log(c.env.DB).info('Platform connected', { platformId: platform.id, platformType: type, method: 'oauth' }, session.userId, null, platform.id);
    return back({ oauth: 'success', platform: platform.id });
  } catch (err) {
    console.error('OAuth callback failed:', err?.name, err?.message);
    return back({ oauth: 'error', reason: 'exchange_failed' });
  }
});

export { oauth as oauthRoutes };
