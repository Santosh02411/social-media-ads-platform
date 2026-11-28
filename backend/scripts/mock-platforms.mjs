// Local stand-in for Meta, Google Ads, TikTok (+ their OAuth screens) and the Claude API.
//
//   npm run mock:platforms        (listens on http://localhost:9100)
//
// It is NOT the real thing: it checks the required fields I found in each platform's docs,
// records every request (GET /__state), and can inject failures to test retries:
//   - a campaign title containing "FLAKY"      -> first create call at the ad-set step fails with HTTP 500
//   - a campaign title containing "FAIL_TIKTOK" -> TikTok rejects the campaign (non-retryable)
// Any access token is valid except "bad-token" (and "bad-refresh" for Google).
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 9100);
const BASE = `http://localhost:${PORT}`;

const state = {
  requests: [], // { method, path, query, auth }
  meta: { campaigns: [], adsets: [], images: [], creatives: [], ads: [], statuses: {} },
  google: { mutates: [], statusUpdates: [] },
  tiktok: { campaigns: [], adgroups: [], ads: [], videoDownloads: [], statusUpdates: [] },
  anthropic: { calls: [] },
  flaky: new Set(),
};
let counter = 1000;
const nextId = (prefix = '') => `${prefix}${++counter}`;

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const type = req.headers['content-type'] || '';
      try {
        if (type.includes('application/json')) return resolve(raw ? JSON.parse(raw) : {});
        if (type.includes('application/x-www-form-urlencoded'))
          return resolve(Object.fromEntries(new URLSearchParams(raw)));
      } catch {
        /* fall through */
      }
      resolve({});
    });
  });

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};
const redirect = (res, location) => {
  res.writeHead(302, { Location: location });
  res.end();
};

// ---------------------------------------------------------------- Meta
const metaError = (res, status, code, message) =>
  send(res, status, { error: { message, type: 'OAuthException', code } });
const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer /, '');

async function meta(req, res, path, query, body) {
  const route = path.replace(/^\/v\d+\.\d+/, '');

  // OAuth
  if (route === '/dialog/oauth')
    return redirect(res, `${query.redirect_uri}?code=meta-code&state=${query.state}`);
  if (route === '/oauth/access_token') {
    if (body.grant_type === 'fb_exchange_token')
      return send(res, 200, { access_token: 'meta-long-lived-token', expires_in: 5184000 });
    if (body.code === 'meta-code')
      return send(res, 200, { access_token: 'meta-short-token', expires_in: 3600 });
    return metaError(res, 400, 100, 'Invalid verification code');
  }

  if (bearer(req) === 'bad-token' || !bearer(req))
    return metaError(res, 400, 190, 'Invalid OAuth access token');

  if (route === '/me' && req.method === 'GET') return send(res, 200, { id: '10001', name: 'Mock User' });
  if (route === '/me/adaccounts')
    return send(res, 200, {
      data: [{ account_id: '555111', name: 'Mock Ad Account', account_status: 1, currency: 'USD' }],
    });
  if (route === '/me/accounts') {
    return send(res, 200, {
      data: [
        { id: '777', name: 'Mock Page', instagram_business_account: { id: '888', username: 'mock_ig' } },
      ],
    });
  }

  let m;
  if ((m = route.match(/^\/act_([^/]+)$/)) && req.method === 'GET') {
    return send(res, 200, { id: `act_${m[1]}`, name: 'Mock Ad Account', account_status: 1, currency: 'USD' });
  }
  if (route.match(/^\/\d+$/) && req.method === 'GET' && ['777'].includes(route.slice(1)))
    return send(res, 200, { id: '777', name: 'Mock Page' });

  if (
    (m = route.match(/^\/act_[^/]+\/(campaigns|adsets|adimages|adcreatives|ads)$/)) &&
    req.method === 'POST'
  ) {
    const kind = m[1];
    const need = (cond, message) => (cond ? null : message);
    let problem = null;

    if (kind === 'campaigns') {
      problem =
        need(
          body.name && body.objective?.startsWith('OUTCOME_'),
          'campaign needs name and an OUTCOME_* objective',
        ) || need(Array.isArray(body.special_ad_categories), 'special_ad_categories is required');
    } else if (kind === 'adsets') {
      const budget = body.daily_budget ?? body.lifetime_budget;
      problem =
        need(body.campaign_id, 'adset needs campaign_id') ||
        need(Number.isInteger(budget) && budget > 0, 'budget must be an integer in minor units') ||
        need(body.lifetime_budget === undefined || body.end_time, 'lifetime_budget needs end_time') ||
        need(body.targeting?.geo_locations?.countries?.length, 'targeting.geo_locations is required') ||
        need(
          body.optimization_goal && body.billing_event,
          'optimization_goal and billing_event are required',
        );
      if (
        !problem &&
        state.meta.campaigns.find((c) => c.id === body.campaign_id)?.name.includes('FLAKY') &&
        !state.flaky.has(body.campaign_id)
      ) {
        state.flaky.add(body.campaign_id);
        return send(res, 500, {
          error: { message: 'An unexpected error has occurred. Please retry your request later.', code: 2 },
        });
      }
    } else if (kind === 'adimages') {
      problem = need(typeof body.bytes === 'string' && body.bytes.length > 0, 'adimages needs base64 bytes');
    } else if (kind === 'adcreatives') {
      const spec = body.object_story_spec;
      problem =
        need(spec?.page_id, 'object_story_spec.page_id is required') ||
        need(spec?.link_data?.link && spec.link_data.message, 'link_data needs link and message');
    } else if (kind === 'ads') {
      problem = need(
        body.adset_id && body.creative?.creative_id,
        'ad needs adset_id and creative.creative_id',
      );
    }
    if (problem) return metaError(res, 400, 100, `(#100) ${problem}`);

    const id = nextId();
    if (kind === 'campaigns') state.meta.campaigns.push({ id, ...body });
    if (kind === 'adsets') state.meta.adsets.push({ id, ...body });
    if (kind === 'adcreatives') state.meta.creatives.push({ id, ...body });
    if (kind === 'ads') state.meta.ads.push({ id, ...body });
    if (kind === 'adimages') {
      state.meta.images.push({ id, bytes: body.bytes });
      return send(res, 200, { images: { bytes: { hash: `hash_${id}`, url: `${BASE}/img/${id}` } } });
    }
    state.meta.statuses[id] = body.status || 'PAUSED';
    return send(res, 200, { id });
  }

  if (/^\/(\d+)\/insights$/.test(route)) {
    const rows = Array.from({ length: 3 }, (_, i) => {
      const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      return {
        date_start: day,
        impressions: String(1000 + i * 100),
        clicks: String(50 + i * 5),
        spend: (25 + i).toFixed(2),
        actions: [{ action_type: 'purchase', value: '2' }],
      };
    });
    return send(res, 200, { data: rows });
  }

  if ((m = route.match(/^\/(\d+)$/)) && req.method === 'POST') {
    state.meta.statuses[m[1]] = body.status;
    return send(res, 200, { success: true });
  }

  return metaError(res, 404, 803, `Unknown path ${route}`);
}

// ---------------------------------------------------------------- Google
const googleError = (res, status, code, message) =>
  send(res, status, { error: { code, message, status: 'INVALID_ARGUMENT' } });

async function googleOAuth(req, res, path, query, body) {
  if (path === '/auth') return redirect(res, `${query.redirect_uri}?code=google-code&state=${query.state}`);
  if (path === '/token') {
    if (body.grant_type === 'authorization_code') {
      return body.code === 'google-code'
        ? send(res, 200, {
            access_token: 'google-access',
            refresh_token: 'google-refresh-token',
            expires_in: 3600,
          })
        : send(res, 400, { error: 'invalid_grant' });
    }
    if (body.grant_type === 'refresh_token') {
      return body.refresh_token === 'bad-refresh'
        ? send(res, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
        : send(res, 200, { access_token: 'google-access', expires_in: 3600 });
    }
  }
  return googleError(res, 404, 404, 'unknown oauth path');
}

async function googleAds(req, res, path, query, body) {
  const route = path.replace(/^\/v\d+/, '');
  if (!req.headers.authorization?.startsWith('Bearer google-access'))
    return googleError(res, 401, 401, 'Request had invalid authentication credentials.');
  if (!req.headers['developer-token']) return googleError(res, 401, 401, 'Developer token is required.');

  if (route === '/customers:listAccessibleCustomers')
    return send(res, 200, { resourceNames: ['customers/1234567890'] });

  let m;
  if ((m = route.match(/^\/customers\/(\d+)\/googleAds:search$/))) {
    if (/FROM customer/.test(body.query))
      return send(res, 200, {
        results: [{ customer: { id: m[1], descriptiveName: 'Mock Google Account', currencyCode: 'USD' } }],
      });
    if (/FROM campaign/.test(body.query)) {
      const rows = Array.from({ length: 3 }, (_, i) => ({
        segments: { date: new Date(Date.now() - i * 86400000).toISOString().slice(0, 10) },
        metrics: {
          impressions: String(2000 + i * 100),
          clicks: String(80 + i),
          costMicros: String((40 + i) * 1e6),
          conversions: 3,
        },
      }));
      return send(res, 200, { results: rows });
    }
  }

  if ((m = route.match(/^\/customers\/(\d+)\/googleAds:mutate$/))) {
    const ops = body.mutateOperations || [];
    const op = (key) => ops.find((o) => o[key])?.[key].create;
    const budget = op('campaignBudgetOperation');
    const campaign = op('campaignOperation');
    const ad = op('adGroupAdOperation')?.ad;
    const problem =
      (!budget?.amountMicros && 'campaign budget needs amountMicros') ||
      (!campaign?.containsEuPoliticalAdvertising &&
        'campaign.contains_eu_political_advertising is required') ||
      (!campaign?.campaignBudget?.includes('/-1') && 'campaign must reference the budget') ||
      (!ad?.responsiveSearchAd ||
      ad.responsiveSearchAd.headlines.length < 3 ||
      ad.responsiveSearchAd.descriptions.length < 2
        ? 'RSA needs >=3 headlines and >=2 descriptions'
        : null) ||
      (ad?.responsiveSearchAd?.headlines.some((h) => h.text.length > 30) && 'headline too long');
    if (problem) return googleError(res, 400, 400, problem);

    state.google.mutates.push({ customerId: m[1], operations: ops });
    const id = nextId();
    return send(res, 200, {
      mutateOperationResponses: ops.map((o) => {
        const key = Object.keys(o)[0].replace('Operation', 'Result');
        return { [key]: { resourceName: `customers/${m[1]}/${key.replace('Result', 's')}/${id}` } };
      }),
    });
  }

  if ((m = route.match(/^\/customers\/(\d+)\/campaigns:mutate$/))) {
    state.google.statusUpdates.push(body.operations[0]);
    return send(res, 200, { results: [{ resourceName: body.operations[0].update.resourceName }] });
  }

  return googleError(res, 404, 404, `Unknown path ${route}`);
}

// ---------------------------------------------------------------- TikTok
const tt = (res, data = {}) => send(res, 200, { code: 0, message: 'OK', data, request_id: nextId('req') });
const ttFail = (res, code, message) => send(res, 200, { code, message, request_id: nextId('req') });

async function tiktok(req, res, path, query, body) {
  const route = path.replace(/^\/open_api\/v1\.3/, '');

  if (route === '/portal-auth')
    return redirect(res, `${query.redirect_uri}?auth_code=tiktok-code&state=${query.state}`);
  if (route === '/oauth2/access_token/') {
    return body.auth_code === 'tiktok-code'
      ? tt(res, { access_token: 'tiktok-token', advertiser_ids: ['6600001'], scope: [1, 2] })
      : ttFail(res, 40002, 'Invalid auth_code');
  }

  if (!req.headers['access-token'] || req.headers['access-token'] === 'bad-token')
    return ttFail(res, 40105, 'Access token is incorrect or has been revoked');

  if (route === '/oauth2/advertiser/get/')
    return tt(res, { list: [{ advertiser_id: '6600001', advertiser_name: 'Mock TikTok Advertiser' }] });
  if (route === '/advertiser/info/')
    return tt(res, {
      list: [
        {
          advertiser_id: '6600001',
          name: 'Mock TikTok Advertiser',
          status: 'STATUS_ENABLE',
          currency: 'USD',
        },
      ],
    });

  if (route === '/campaign/create/') {
    if (!body.advertiser_id || !body.objective_type || !body.budget_mode)
      return ttFail(res, 40002, 'campaign: missing required field');
    if (body.campaign_name.includes('FAIL_TIKTOK'))
      return ttFail(res, 40002, 'Campaign name violates ad policy');
    const id = nextId();
    state.tiktok.campaigns.push({ campaign_id: id, ...body });
    return tt(res, { campaign_id: id });
  }
  if (route === '/file/video/ad/upload/') {
    const download = await fetch(body.video_url).catch(() => null); // proves our signed media URL is reachable without a cookie
    state.tiktok.videoDownloads.push({
      url: body.video_url,
      status: download?.status,
      type: download?.headers.get('content-type'),
      bytes: download ? (await download.arrayBuffer()).byteLength : 0,
    });
    if (!download?.ok) return ttFail(res, 40002, 'Could not download video_url');
    return tt(res, [{ video_id: nextId('vid'), file_name: body.file_name }]);
  }
  if (route === '/file/video/suggestcover/get/')
    return tt(res, { list: [{ url: `${BASE}/cover.jpg`, id: 'cover1' }] });
  if (route === '/file/image/ad/upload/') return tt(res, { image_id: nextId('img') });
  if (route === '/adgroup/create/') {
    const campaign = state.tiktok.campaigns.find((c) => c.campaign_id === body.campaign_id);
    if (!campaign) return ttFail(res, 40002, 'Unknown campaign_id');
    if (!body.location_ids?.length || !body.budget || !body.schedule_start_time || !body.optimization_goal)
      return ttFail(res, 40002, 'adgroup: missing required field');
    const id = nextId();
    state.tiktok.adgroups.push({ adgroup_id: id, ...body });
    return tt(res, { adgroup_id: id });
  }
  if (route === '/identity/create/') return tt(res, { identity_id: nextId('idn') });
  if (route === '/ad/create/') {
    const creative = body.creatives?.[0];
    if (!creative?.video_id || !creative.image_ids?.length || !creative.landing_page_url || !creative.ad_text)
      return ttFail(res, 40002, 'ad: missing required creative field');
    const id = nextId();
    state.tiktok.ads.push({ ad_id: id, ...body });
    return tt(res, { ad_ids: [id] });
  }
  if (/\/(campaign|adgroup|ad)\/status\/update\/$/.test(route)) {
    state.tiktok.statusUpdates.push({ route, ...body });
    return tt(res, {});
  }
  if (route === '/report/integrated/get/') {
    return tt(res, {
      list: Array.from({ length: 3 }, (_, i) => ({
        dimensions: {
          campaign_id: query.advertiser_id,
          stat_time_day: `${new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)} 00:00:00`,
        },
        metrics: {
          spend: String(10 + i),
          impressions: String(500 + i * 10),
          clicks: String(20 + i),
          conversion: '1',
        },
      })),
    });
  }
  return ttFail(res, 40002, `Unknown path ${route}`);
}

// ---------------------------------------------------------------- Claude API
async function anthropic(req, res, path, query, body) {
  if (path !== '/v1/messages')
    return send(res, 404, { error: { type: 'not_found_error', message: 'unknown path' } });
  if (req.headers['x-api-key'] !== 'test-anthropic-key')
    return send(res, 401, {
      type: 'error',
      error: { type: 'authentication_error', message: 'invalid x-api-key' },
    });
  if (req.headers['anthropic-version'] !== '2023-06-01')
    return send(res, 400, {
      type: 'error',
      error: { type: 'invalid_request_error', message: 'missing anthropic-version' },
    });
  if (body.tool_choice?.name !== 'submit_ad_copy' || !body.model)
    return send(res, 400, {
      type: 'error',
      error: { type: 'invalid_request_error', message: 'bad request shape' },
    });

  state.anthropic.calls.push({ model: body.model, system: body.system, user: body.messages?.[0]?.content });
  return send(res, 200, {
    id: 'msg_mock',
    type: 'message',
    role: 'assistant',
    model: body.model,
    stop_reason: 'tool_use',
    content: [
      {
        type: 'tool_use',
        id: 'toolu_mock',
        name: 'submit_ad_copy',
        input: {
          headlines: [
            'Fresh Roasted Coffee',
            'Delivered To Your Door',
            'Small Batch, Big Flavor',
            'Order Today, Sip Tomorrow',
            'This headline is far too long to fit the limit',
          ],
          descriptions: [
            'Beans roasted to order and shipped within 24 hours of roasting.',
            'Choose your roast and grind. Skip or cancel anytime.',
            'Taste the difference fresh coffee makes.',
          ],
          primaryTexts: [
            'Fresh beans, roasted to order. Start your first bag today.',
            'Better coffee at home. Shipped fresh.',
            'Small-batch roasts delivered when you need them.',
          ],
          callToAction: 'SHOP_NOW',
        },
      },
    ],
    usage: { input_tokens: 10, output_tokens: 10 },
  });
}

// ---------------------------------------------------------------- server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  const query = Object.fromEntries(url.searchParams);
  const body = await readBody(req);
  const auth = req.headers.authorization || req.headers['access-token'] || req.headers['x-api-key'] || '';

  if (url.pathname === '/__state') return send(res, 200, state);
  if (url.pathname === '/__reset') {
    state.flaky.clear();
    state.requests.length = 0;
    for (const k of ['meta', 'google', 'tiktok', 'anthropic'])
      for (const list of Object.values(state[k])) {
        if (Array.isArray(list)) list.length = 0;
      }
    return send(res, 200, { ok: true });
  }

  state.requests.push({ method: req.method, path: url.pathname, query, hasAuthHeader: Boolean(auth) });

  const mounts = [
    ['/meta', meta],
    ['/google-ads', googleAds],
    ['/google-oauth', googleOAuth],
    ['/tiktok', tiktok],
    ['/anthropic', anthropic],
  ];
  for (const [prefix, handler] of mounts) {
    if (url.pathname.startsWith(`${prefix}/`)) {
      return handler(req, res, url.pathname.slice(prefix.length), query, body);
    }
  }
  if (url.pathname === '/cover.jpg') return send(res, 200, {});
  return send(res, 404, { error: 'mock: unknown path' });
});

server.listen(PORT, () => console.log(`Mock platforms listening on ${BASE} (state: ${BASE}/__state)`));
