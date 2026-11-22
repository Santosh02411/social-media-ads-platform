import { Hono } from 'hono';
import { Platform } from '../models/Platform.js';
import { Log } from '../models/Log.js';
import { validateJson, parseWith } from '../middleware/validate.js';
import {
  accountSelectSchema,
  credentialSchemaFor,
  platformCreateSchema,
  platformUpdateSchema,
} from '../validation/schemas.js';
import { adapterFactory, SUPPORTED_PLATFORMS } from '../adapters/AdapterFactory.js';
import { PlatformError } from '../adapters/http.js';
import { getEndpoints, isSandbox } from '../adapters/endpoints.js';
import { buildAuthUrl, oauthConfigured, OAUTH_STATE_TTL_SECONDS } from '../services/oauth.js';
import { randomHex } from '../utils/crypto.js';

const platforms = new Hono();

const model = (c) => new Platform(c.env.DB, c.env.ENCRYPTION_KEY);

/** Loads a platform and checks it belongs to the signed-in user. */
async function loadOwned(c) {
  const platform = await model(c).findById(c.req.param('id'));
  // Same answer for "missing" and "someone else's" so ids can't be probed
  if (!platform || platform.user_id !== c.get('userId')) {
    return { response: c.json({ error: 'Platform not found' }, 404) };
  }
  return { platform };
}

/** Turns a platform failure into an HTTP response the UI can show. */
function platformFailure(c, error) {
  if (error instanceof PlatformError) {
    const status = error.retryable ? 502 : 400;
    return c.json({ error: error.message, code: error.code }, status);
  }
  throw error;
}

/** Checks credentials against the real platform API. */
async function validateAgainstPlatform(c, platform, config) {
  const adapter = adapterFactory.create({ ...platform, config }, c.env);
  return adapter.validateCredentials();
}

// Which providers can use "Connect with ..." and whether we are talking to a sandbox
platforms.get('/providers', (c) => {
  const ep = getEndpoints(c.env);
  const providers = {};
  for (const type of SUPPORTED_PLATFORMS) providers[type] = { oauth: oauthConfigured(c.env, type) };
  const sandbox = isSandbox(c.env);
  return c.json({ providers, sandbox, apiVersions: { meta: ep.metaVersion, googleAds: ep.googleAdsVersion } });
});

// List the user's platforms (credentials are never returned)
platforms.get('/', async (c) => {
  const list = await model(c).findByUserId(c.get('userId'));
  return c.json({ platforms: list.map(Platform.toPublic) });
});

platforms.get('/connected', async (c) => {
  const list = await model(c).getConnectedPlatforms(c.get('userId'));
  return c.json({ platforms: list.map(Platform.toPublic) });
});

platforms.get('/:id', async (c) => {
  const { platform, response } = await loadOwned(c);
  if (response) return response;
  return c.json({ platform: Platform.toPublic(platform) });
});

platforms.post('/', validateJson(platformCreateSchema), async (c) => {
  const userId = c.get('userId');
  const created = await model(c).create(c.get('body'), userId);

  await new Log(c.env.DB).info(
    'Platform created',
    { platformId: created.id, name: created.name, type: created.type },
    userId,
    null,
    created.id
  );

  return c.json({ platform: Platform.toPublic(created) }, 201);
});

platforms.put('/:id', validateJson(platformUpdateSchema), async (c) => {
  const { platform, response } = await loadOwned(c);
  if (response) return response;

  const updated = await model(c).rename(platform.id, c.get('body').name);

  await new Log(c.env.DB).info(
    'Platform updated',
    { platformId: platform.id, updates: ['name'] },
    c.get('userId'),
    null,
    platform.id
  );

  return c.json({ platform: Platform.toPublic(updated) });
});

platforms.delete('/:id', async (c) => {
  const { platform, response } = await loadOwned(c);
  if (response) return response;

  await model(c).delete(platform.id);

  await new Log(c.env.DB).info(
    'Platform deleted',
    { platformId: platform.id, name: platform.name },
    c.get('userId')
  );

  return c.json({ message: 'Platform deleted successfully' });
});

// Manual connect: the credentials are verified against the real platform before they are saved
platforms.post('/:id/connect', async (c) => {
  const { platform, response } = await loadOwned(c);
  if (response) return response;

  let raw;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'Request body must be valid JSON' }, 400);
  }

  const schema = credentialSchemaFor(platform.type);
  if (!schema) return c.json({ error: 'Unknown platform type' }, 400);

  const { data: credentials, response: invalid } = parseWith(c, schema, raw);
  if (invalid) return invalid;

  let info;
  try {
    info = await validateAgainstPlatform(c, platform, { ...platform.config, ...credentials });
  } catch (error) {
    return platformFailure(c, error);
  }

  const connected = await model(c).connect(platform.id, { ...credentials, authMethod: 'manual' }, info);

  // Log which platform, never the credential values
  await new Log(c.env.DB).info(
    'Platform connected',
    { platformId: platform.id, platformType: platform.type, method: 'manual' },
    c.get('userId'),
    null,
    platform.id
  );

  return c.json({ platform: Platform.toPublic(connected) });
});

// Disconnect: also wipes the stored credentials
platforms.post('/:id/disconnect', async (c) => {
  const { platform, response } = await loadOwned(c);
  if (response) return response;

  const disconnected = await model(c).disconnect(platform.id);

  await new Log(c.env.DB).info(
    'Platform disconnected',
    { platformId: platform.id, platformType: platform.type },
    c.get('userId'),
    null,
    platform.id
  );

  return c.json({ platform: Platform.toPublic(disconnected) });
});

// Test connection: a real call to the platform with the stored credentials
platforms.post('/:id/test', async (c) => {
  const { platform, response } = await loadOwned(c);
  if (response) return response;

  if (!platform.is_connected) {
    return c.json({ error: 'Platform is not connected' }, 400);
  }

  let result;
  try {
    const info = await validateAgainstPlatform(c, platform, platform.config);
    result = { success: true, message: `Connected to ${info.accountName || 'your account'}` };
  } catch (error) {
    if (!(error instanceof PlatformError)) throw error;
    result = { success: false, message: error.message, code: error.code };
  }

  await new Log(c.env.DB).info(
    'Platform connection tested',
    { platformId: platform.id, success: result.success },
    c.get('userId'),
    null,
    platform.id
  );

  return c.json(result);
});

// Start "Connect with <platform>": returns the provider's consent-screen URL
platforms.post('/:id/oauth/start', async (c) => {
  const { platform, response } = await loadOwned(c);
  if (response) return response;

  if (!oauthConfigured(c.env, platform.type)) {
    return c.json({ error: `One-click connect is not configured for ${platform.type}. Enter credentials manually.`, code: 'OAUTH_NOT_CONFIGURED' }, 501);
  }

  // Single-use, short-lived, bound to this user and platform (CSRF protection for the flow)
  const state = randomHex(24);
  await c.env.SESSIONS.put(
    `oauth:${state}`,
    JSON.stringify({ userId: c.get('userId'), platformId: platform.id, type: platform.type }),
    { expirationTtl: OAUTH_STATE_TTL_SECONDS }
  );

  return c.json({ url: buildAuthUrl(c.env, platform.type, state) });
});

// Ad accounts / pages the connected token can use
platforms.get('/:id/accounts', async (c) => {
  const { platform, response } = await loadOwned(c);
  if (response) return response;
  if (!platform.is_connected) return c.json({ error: 'Platform is not connected' }, 400);

  try {
    const adapter = adapterFactory.create(platform, c.env);
    const options = await adapter.listAccounts();
    return c.json({
      ...options,
      selected: {
        accountId: platform.config.accountId || null,
        pageId: platform.config.pageId || null,
        instagramUserId: platform.config.instagramUserId || null,
      },
    });
  } catch (error) {
    return platformFailure(c, error);
  }
});

// Switch the ad account / page used for publishing (must be one the token can access)
platforms.post('/:id/select-account', validateJson(accountSelectSchema), async (c) => {
  const { platform, response } = await loadOwned(c);
  if (response) return response;
  if (!platform.is_connected) return c.json({ error: 'Platform is not connected' }, 400);

  const choice = c.get('body');
  try {
    const adapter = adapterFactory.create(platform, c.env);
    const options = await adapter.listAccounts();

    const account = options.accounts.find((a) => a.id === choice.accountId);
    if (!account) return c.json({ error: 'That account is not available for this connection' }, 400);

    const patch = { accountId: account.id, accountName: account.name, currency: account.currency || platform.config.currency || null };

    if (platform.type === 'facebook' || platform.type === 'instagram') {
      const page = (options.pages || []).find((p) => p.id === choice.pageId);
      if (!page) return c.json({ error: 'Choose one of your Facebook Pages' }, 400);
      patch.pageId = page.id;
      if (platform.type === 'instagram') {
        if (!page.instagramUserId) return c.json({ error: 'That Page has no linked Instagram business account' }, 400);
        patch.instagramUserId = page.instagramUserId;
      }
    }

    const updated = await model(c).connect(platform.id, { ...patch }, { accountName: patch.accountName, currency: patch.currency });
    return c.json({ platform: Platform.toPublic(updated) });
  } catch (error) {
    return platformFailure(c, error);
  }
});

export { platforms as platformRoutes };
