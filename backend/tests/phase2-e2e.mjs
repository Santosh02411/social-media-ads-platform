// End-to-end test of the real pipeline against the LOCAL mock platform server.
//   terminal 1: npm run mock:platforms
//   terminal 2: rm -rf .wrangler && npm run db:local && npm run dev      (with .dev.vars from `npm run setup:secrets -- --sandbox`)
//   terminal 3: npm run test:e2e
// Verifies our HTTP calls, retries, idempotency and security. It cannot prove the real
// platforms accept the same payloads: see docs/INTEGRATIONS.md for the go-live checklist.
import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';

const BASE = process.env.API_URL || 'http://localhost:8787';
const MOCK = process.env.MOCK_URL || 'http://localhost:9100';
const ORIGIN = 'http://localhost:3000';
const secrets = Object.fromEntries(
  readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);

let passed = 0, failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  PASS  ${name}`); } else { failed++; console.log(`  FAIL  ${name} ${extra}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { timeout = 45000, every = 700 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(every); }
  return null;
}
const mockState = async () => (await fetch(`${MOCK}/__state`)).json();

class Client {
  constructor() { this.cookie = ''; }
  async req(method, path, { body, form, origin = ORIGIN, cookie = this.cookie } = {}) {
    const res = await fetch(BASE + path, {
      method,
      redirect: 'manual',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: form || (body !== undefined ? JSON.stringify(body) : undefined),
    });
    let json = null;
    try { json = await res.clone().json(); } catch {}
    return { status: res.status, json, headers: res.headers, res };
  }
  async login(email, password) {
    const r = await this.req('POST', '/api/auth/login', { body: { email, password } });
    const m = (r.headers.get('set-cookie') || '').match(/(ads_session=[^;]+)/);
    if (m) this.cookie = m[1];
    return r;
  }
}

async function newUser(label) {
  const c = new Client();
  const email = `${label}+${Date.now()}@example.com`;
  const reg = await c.req('POST', '/api/auth/register', { body: { email, password: 'Str0ngPassw0rd', name: label } });
  if (reg.status !== 201) throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.json)}`);
  await c.login(email, 'Str0ngPassw0rd');
  return c;
}

// OAuth round trip against the mock consent screens (what the browser would do)
async function oauthConnect(client, platformId) {
  const start = await client.req('POST', `/api/platforms/${platformId}/oauth/start`, { body: {} });
  if (start.status !== 200) return { start };
  const consent = await fetch(start.json.url, { redirect: 'manual' });
  const callbackUrl = consent.headers.get('location');
  const cb = await fetch(callbackUrl, { redirect: 'manual', headers: { Cookie: client.cookie } });
  return { start, callbackUrl, result: cb.headers.get('location') || '' };
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const VIDEO = Buffer.alloc(4096, 7);

async function upload(client, name, type, data) {
  const form = new FormData();
  form.append('file', new Blob([data], { type }), name);
  return client.req('POST', '/api/media', { form });
}

const mediaSignature = (id, exp) =>
  createHmac('sha256', createHash('sha256').update(`${secrets.JWT_SECRET}:media-url`).digest())
    .update(`${id}.${exp}`).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

await fetch(`${MOCK}/__reset`);
const alice = await newUser('alice');
const mallory = await newUser('mallory');

console.log('\n[1] Providers and real credential validation');
let r = await alice.req('GET', '/api/platforms/providers');
check('providers report one-click connect for all four + sandbox flag', r.status === 200 && Object.values(r.json.providers).every((p) => p.oauth) && r.json.sandbox === true, JSON.stringify(r.json));

const mk = async (client, name, type) => (await client.req('POST', '/api/platforms', { body: { name, type } })).json.platform.id;
const probe = await mk(alice, 'Probe FB', 'facebook');
r = await alice.req('POST', `/api/platforms/${probe}/connect`, { body: { access_token: 'bad-token', account_id: '555111', page_id: '777' } });
check('bad token is rejected by the (mock) platform -> 400, nothing saved', r.status === 400 && /invalid or expired/i.test(r.json.error), JSON.stringify(r.json));
r = await alice.req('GET', `/api/platforms/${probe}`);
check('rejected credentials left the platform disconnected', r.json.platform.is_connected === false);
r = await alice.req('POST', `/api/platforms/${probe}/connect`, { body: { access_token: 'manual-fb-token', account_id: '555111', page_id: '777' } });
check('valid manual credentials connect and return the real account name', r.status === 200 && r.json.platform.config.accountName === 'Mock Ad Account' && r.json.platform.config.authMethod === 'manual', JSON.stringify(r.json));
r = await alice.req('POST', `/api/platforms/${probe}/test`, { body: {} });
check('"Test connection" makes a real call (no more Math.random)', r.json.success === true && /Mock Ad Account/.test(r.json.message), JSON.stringify(r.json));
await alice.req('DELETE', `/api/platforms/${probe}`);

console.log('\n[2] OAuth (Meta, Google, TikTok)');
const fb = await mk(alice, 'Facebook', 'facebook');
const ig = await mk(alice, 'Instagram', 'instagram');
const google = await mk(alice, 'Google Ads', 'google');
const tiktok = await mk(alice, 'TikTok', 'tiktok');

let o = await oauthConnect(alice, fb);
check('Facebook: consent URL points at the provider and carries state', /\/meta\/v[\d.]+\/dialog\/oauth\?/.test(o.start.json.url) && o.start.json.url.includes('state='), o.start.json?.url);
check('Facebook: callback redirects back to the app with success', o.result.includes('oauth=success'), o.result);
r = await alice.req('GET', `/api/platforms/${fb}`);
check('Facebook: connected via OAuth with account, page, expiry (no tokens exposed)', r.json.platform.is_connected && r.json.platform.config.authMethod === 'oauth' && r.json.platform.config.tokenExpiresAt && !JSON.stringify(r.json).includes('meta-long-lived-token'), JSON.stringify(r.json));

// Replay of the same state must fail (single use)
const replay = await fetch(o.callbackUrl, { redirect: 'manual', headers: { Cookie: alice.cookie } });
check('OAuth state is single-use (replay -> invalid_state)', (replay.headers.get('location') || '').includes('reason=invalid_state'));

o = await oauthConnect(alice, google);
check('Google: connected (refresh token exchanged, offline access requested)', o.result.includes('oauth=success') && o.start.json.url.includes('access_type=offline'), o.result);
o = await oauthConnect(alice, tiktok);
check('TikTok: connected (auth_code flow)', o.result.includes('oauth=success'), o.result);

// Instagram via manual credentials
r = await alice.req('POST', `/api/platforms/${ig}/connect`, { body: { access_token: 'manual-ig-token', account_id: '555111', page_id: '777', instagram_user_id: '888' } });
check('Instagram: manual connect with Page + Instagram account', r.status === 200, JSON.stringify(r.json));

// CSRF / hijack protections on the callback
const hijackStart = await alice.req('POST', `/api/platforms/${fb}/oauth/start`, { body: {} });
const hijackConsent = await fetch(hijackStart.json.url, { redirect: 'manual' });
const noCookie = await fetch(hijackConsent.headers.get('location'), { redirect: 'manual' });
check('callback without the user\'s session is refused (session_mismatch)', (noCookie.headers.get('location') || '').includes('reason=session_mismatch'));
const hijackStart2 = await alice.req('POST', `/api/platforms/${fb}/oauth/start`, { body: {} });
const hijackConsent2 = await fetch(hijackStart2.json.url, { redirect: 'manual' });
const otherUser = await fetch(hijackConsent2.headers.get('location'), { redirect: 'manual', headers: { Cookie: mallory.cookie } });
check("callback from a different user's session is refused", (otherUser.headers.get('location') || '').includes('reason=session_mismatch'));
r = await mallory.req('POST', `/api/platforms/${fb}/oauth/start`, { body: {} });
check("cannot start OAuth for someone else's platform -> 404", r.status === 404);
const forged = await fetch(`${BASE}/api/oauth/callback/facebook?code=meta-code&state=${'a'.repeat(48)}`, { redirect: 'manual', headers: { Cookie: alice.cookie } });
check('forged state -> invalid_state', (forged.headers.get('location') || '').includes('reason=invalid_state'));

r = await alice.req('GET', `/api/platforms/${fb}/accounts`);
check('lists ad accounts + pages the token can use', r.status === 200 && r.json.accounts[0].id === '555111' && r.json.pages[0].instagramUserId === '888', JSON.stringify(r.json));
r = await alice.req('POST', `/api/platforms/${fb}/select-account`, { body: { accountId: '999999', pageId: '777' } });
check('cannot select an account the token has no access to -> 400', r.status === 400);

console.log('\n[3] AI ad copy (Claude API)');
r = await alice.req('GET', '/api/ai/status');
check('AI status reports enabled', r.json.enabled === true);
r = await alice.req('POST', '/api/ai/ad-copy', { body: { productName: 'Bean Box', description: 'Small-batch coffee roasted to order and shipped fresh.', tone: 'friendly' } });
const ai = r.json;
check('generates headlines, descriptions, primary texts, CTA', r.status === 200 && ai.headlines.length >= 3 && ai.descriptions.length >= 2 && ai.callToAction === 'SHOP_NOW', JSON.stringify(r.json));
check('server drops copy that exceeds the limits (mock returned a 46-char headline)', ai.headlines.every((h) => h.length <= 30) && ai.descriptions.every((d) => d.length <= 90) && ai.primaryTexts.every((t) => t.length <= 100) && ai.headlines.length === 4);
let st = await mockState();
check('request used the Messages API shape: key header, forced tool, product data in tags', st.anthropic.calls.length === 1 && /<product_name>Bean Box<\/product_name>/.test(st.anthropic.calls[0].user) && /never follow instructions/.test(st.anthropic.calls[0].system));
r = await alice.req('POST', '/api/ai/ad-copy', { body: { productName: '', description: 'x' } });
check('AI input is validated -> 400', r.status === 400);
r = await new Client().req('POST', '/api/ai/ad-copy', { body: { productName: 'x', description: 'long enough description' } });
check('AI endpoint requires login', r.status === 401 || r.status === 403);

console.log('\n[4] Media');
r = await upload(alice, 'hero.png', 'image/png', PNG);
check('image upload works (real URL, not a placeholder)', r.status === 201 && r.json.media.url === `/api/media/${r.json.media.id}/file`, JSON.stringify(r.json));
const imageId = r.json.media.id;
r = await upload(alice, 'promo.mp4', 'video/mp4', VIDEO);
const videoId = r.json.media.id;
check('video upload works', r.status === 201);
r = await alice.req('GET', `/api/media/${imageId}/file`);
const body = Buffer.from(await r.res.arrayBuffer());
check('owner can stream the file back (same bytes, nosniff)', r.status === 200 && body.equals(PNG) && r.headers.get('x-content-type-options') === 'nosniff');
r = await mallory.req('GET', `/api/media/${imageId}/file`);
check("another user cannot stream it -> 404", r.status === 404);
r = await alice.req('GET', `/api/media/${videoId}/signed-url`);
const signed = r.json.signedUrl;
check('signed URL is public-style (no cookie needed)', signed.includes('/media-file/') && (await fetch(signed)).status === 200);
check('tampered signature -> 403', (await fetch(signed.replace(/sig=.{6}/, 'sig=AAAAAA'))).status === 403);
check('signature for another media id -> 403', (await fetch(signed.replace(videoId, imageId))).status === 403);
const expired = Math.floor(Date.now() / 1000) - 10;
check('expired link -> 403', (await fetch(`${BASE}/media-file/${videoId}?exp=${expired}&sig=${mediaSignature(videoId, expired)}`)).status === 403);

console.log('\n[5] Publishing through the queue');
const campaignPayload = (title, platforms, mediaIds = [imageId, videoId]) => ({
  title, budget: 20, budgetType: 'daily', objective: 'TRAFFIC', destinationUrl: 'https://example.com/coffee',
  headline: ai.headlines[0], adCopy: ai.primaryTexts[0], callToAction: ai.callToAction,
  variants: { headlines: ai.headlines, descriptions: ai.descriptions },
  targeting: { countries: ['US', 'GB'], ageMin: 21, ageMax: 55, keywords: ['fresh coffee', 'coffee subscription'] },
  publishPaused: true, platforms, mediaIds,
});

r = await alice.req('POST', '/api/campaigns', { body: { ...campaignPayload('Incomplete', [fb]), headline: undefined, adCopy: undefined, destinationUrl: undefined } });
const incompleteId = r.json.campaign.id;
r = await alice.req('POST', `/api/campaigns/${incompleteId}/publish`, { body: {} });
check('publishing a campaign without creative is refused with a clear message', r.status === 400 && /missing headline/.test(r.json.error), JSON.stringify(r.json));

r = await alice.req('POST', '/api/campaigns', { body: campaignPayload('Coffee Launch', [fb, ig, google, tiktok]) });
check('campaign with creative, targeting, media and 4 platforms is created', r.status === 201 && r.json.campaign.targeting.countries.length === 2 && r.json.campaign.platforms.length === 4, JSON.stringify(r.json));
const launchId = r.json.campaign.id;
r = await alice.req('POST', `/api/campaigns/${launchId}/publish`, { body: {} });
check('publish returns 202 and queues one job per platform (does not claim success)', r.status === 202 && r.json.jobs.length === 4, JSON.stringify(r.json));
r = await alice.req('GET', `/api/campaigns/${launchId}`);
check('campaign is "publishing" until the worker finishes', ['publishing', 'paused'].includes(r.json.campaign.status));

const done = await until(async () => {
  const c = (await alice.req('GET', `/api/campaigns/${launchId}`)).json;
  return c.campaign.status !== 'publishing' ? c : null;
});
check('worker processed the queue: every platform succeeded', done && done.campaign.platforms.every((p) => p.status === 'success' && p.externalId), JSON.stringify(done?.campaign.platforms));
check('campaign ends "paused" because ads are created paused (safe default)', done?.campaign.status === 'paused', done?.campaign.status);
check('jobs table records the work', done?.jobs.length === 4 && done.jobs.every((j) => j.status === 'success'));

st = await mockState();
const metaFb = st.meta.campaigns[0];
const adsetFor = (platform) => st.meta.adsets.find((a) => a.targeting.publisher_platforms[0] === platform);
const creativeFor = (ig) => st.meta.creatives.find((c) => Boolean(c.object_story_spec.instagram_user_id) === ig);
check('Meta: 2 campaigns (FB + IG), OUTCOME_TRAFFIC, created PAUSED', st.meta.campaigns.length === 2 && metaFb.objective === 'OUTCOME_TRAFFIC' && metaFb.status === 'PAUSED');
check('Meta ad sets: daily budget in cents, countries/age, placement per platform', adsetFor('facebook').daily_budget === 2000 && adsetFor('facebook').targeting.geo_locations.countries.join() === 'US,GB' && adsetFor('facebook').targeting.age_min === 21 && Boolean(adsetFor('instagram')));
check('Meta: our R2 image was uploaded as base64 bytes', st.meta.images.length === 2 && Buffer.from(st.meta.images[0].bytes, 'base64').equals(PNG));
check('Meta creatives use object_story_spec + Page; Instagram adds instagram_user_id', creativeFor(false).object_story_spec.page_id === '777' && creativeFor(true).object_story_spec.instagram_user_id === '888' && creativeFor(false).object_story_spec.link_data.call_to_action.type === 'SHOP_NOW');
const g = st.google.mutates[0];
const gOps = (k) => g.operations.filter((o) => o[k]).map((o) => o[k].create);
check('Google: one atomic mutate with daily budget (micros), PAUSED campaign, EU-political flag', st.google.mutates.length === 1 && gOps('campaignBudgetOperation')[0].amountMicros === '20000000' && gOps('campaignOperation')[0].status === 'PAUSED' && gOps('campaignOperation')[0].containsEuPoliticalAdvertising);
check('Google: geo targets (US 2840, GB 2826), 2 keywords, RSA with 4 headlines / 4 descriptions', gOps('campaignCriterionOperation').map((c) => c.location.geoTargetConstant).join() === 'geoTargetConstants/2840,geoTargetConstants/2826' && gOps('adGroupCriterionOperation').length === 2 && gOps('adGroupAdOperation')[0].ad.responsiveSearchAd.headlines.length === 4 && gOps('adGroupAdOperation')[0].ad.responsiveSearchAd.descriptions.length === 4);
check('TikTok: campaign, ad group (location ids, day budget), ad with video + cover', st.tiktok.campaigns.length === 1 && st.tiktok.adgroups[0].location_ids.join() === '6252001,2635167' && st.tiktok.adgroups[0].budget_mode === 'BUDGET_MODE_DAY' && st.tiktok.ads[0].creatives[0].video_id && st.tiktok.ads[0].creatives[0].image_ids.length === 1 && st.tiktok.ads[0].operation_status === 'DISABLE');
check('TikTok downloaded our video through the signed URL (no cookie)', st.tiktok.videoDownloads[0]?.status === 200 && st.tiktok.videoDownloads[0].type === 'video/mp4' && st.tiktok.videoDownloads[0].bytes === VIDEO.length, JSON.stringify(st.tiktok.videoDownloads));

console.log('\n[6] Retries are idempotent');
await fetch(`${MOCK}/__reset`);
r = await alice.req('POST', '/api/campaigns', { body: campaignPayload('FLAKY Spring Sale', [fb], [imageId]) });
const flakyId = r.json.campaign.id;
await alice.req('POST', `/api/campaigns/${flakyId}/publish`, { body: {} });
const flaky = await until(async () => {
  const c = (await alice.req('GET', `/api/campaigns/${flakyId}`)).json;
  return c.campaign.status !== 'publishing' ? c : null;
}, { timeout: 60000 });
st = await mockState();
check('transient platform error (HTTP 500) was retried and then succeeded', flaky?.campaign.platforms[0].status === 'success' && flaky.jobs[0].retry_count >= 2, JSON.stringify(flaky?.jobs));
check('no duplicates: exactly 1 campaign, 1 ad set, 1 ad, 1 image created on the platform', st.meta.campaigns.filter((c) => c.name.includes('FLAKY')).length === 1 && st.meta.adsets.length === 1 && st.meta.ads.length === 1 && st.meta.images.length === 1, JSON.stringify({ c: st.meta.campaigns.length, a: st.meta.adsets.length, ads: st.meta.ads.length }));
r = await alice.req('POST', `/api/campaigns/${flakyId}/publish`, { body: {} });
check('publishing again is refused once everything is live (no accidental duplicates)', r.status === 409);

console.log('\n[7] Failures are reported honestly');
r = await alice.req('POST', '/api/campaigns', { body: campaignPayload('FAIL_TIKTOK Promo', [tiktok]) });
const failId = r.json.campaign.id;
await alice.req('POST', `/api/campaigns/${failId}/publish`, { body: {} });
const failed1 = await until(async () => {
  const c = (await alice.req('GET', `/api/campaigns/${failId}`)).json;
  return c.campaign.status !== 'publishing' ? c : null;
});
check('non-retryable platform rejection -> platform "failed" with the platform\'s reason', failed1?.campaign.platforms[0].status === 'failed' && /ad policy/.test(failed1.campaign.platforms[0].errorMessage), JSON.stringify(failed1?.campaign.platforms));
check('campaign returns to draft (it was NOT marked active)', failed1?.campaign.status === 'draft');
check('job is marked failed after exactly one attempt', failed1?.jobs[0].status === 'failed' && failed1.jobs[0].retry_count === 1);

r = await alice.req('POST', '/api/campaigns', { body: campaignPayload('Image only for TikTok', [tiktok], [imageId]) });
const noVideoId = r.json.campaign.id;
await alice.req('POST', `/api/campaigns/${noVideoId}/publish`, { body: {} });
const noVideo = await until(async () => {
  const c = (await alice.req('GET', `/api/campaigns/${noVideoId}`)).json;
  return c.campaign.status !== 'publishing' ? c : null;
});
check('TikTok without a video fails fast with an actionable message', noVideo?.campaign.platforms[0].status === 'failed' && /video/i.test(noVideo.campaign.platforms[0].errorMessage), JSON.stringify(noVideo?.campaign.platforms));

r = await alice.req('POST', `/api/platforms/${tiktok}/disconnect`, { body: {} });
r = await alice.req('POST', `/api/campaigns/${noVideoId}/publish`, { body: {} });
check('publishing to a disconnected platform is blocked before anything is queued', r.status === 400 && /Reconnect/.test(r.json.error), JSON.stringify(r.json));
r = await alice.req('POST', `/api/platforms/${tiktok}/oauth/start`, { body: {} });
const re = await fetch((await fetch(r.json.url, { redirect: 'manual' })).headers.get('location'), { redirect: 'manual', headers: { Cookie: alice.cookie } });
check('platform can be reconnected through OAuth', (re.headers.get('location') || '').includes('oauth=success'));

console.log('\n[8] Activate / pause the real ads');
await fetch(`${MOCK}/__reset`).catch(() => {});
st = await mockState();
r = await alice.req('POST', `/api/campaigns/${incompleteId}/activate`, { body: {} });
check('cannot activate a campaign that was never published -> 400', r.status === 400);
r = await alice.req('POST', `/api/campaigns/${launchId}/activate`, { body: {} });
check('activate -> 202', r.status === 202 && r.json.jobs.length === 4, JSON.stringify(r.json));
const active = await until(async () => ((await alice.req('GET', `/api/campaigns/${launchId}`)).json.campaign.status === 'active' ? true : null));
check('campaign becomes active once the platforms confirmed', Boolean(active));
st = await mockState();
const tiktokRoutes = st.tiktok.statusUpdates.map((u) => `${u.route.split('/')[1]}:${u.operation_status}`).sort().join();
check('TikTok campaign + ad group + ad all enabled', tiktokRoutes === 'ad:ENABLE,adgroup:ENABLE,campaign:ENABLE', tiktokRoutes);
check('Google campaign set to ENABLED', st.google.statusUpdates.some((u) => u.update.status === 'ENABLED'));
check('Meta campaign/ad set/ad all ACTIVE', Object.values(st.meta.statuses).filter((s) => s === 'ACTIVE').length >= 3);
r = await alice.req('DELETE', `/api/campaigns/${launchId}`);
check('deleting a live campaign is blocked (would orphan spending ads)', r.status === 409);
await alice.req('POST', `/api/campaigns/${launchId}/pause`, { body: {} });
await until(async () => ((await alice.req('GET', `/api/campaigns/${launchId}`)).json.campaign.status === 'paused' ? true : null));
st = await mockState();
check('pause switches the platform ads off again', st.google.statusUpdates.some((u) => u.update.status === 'PAUSED') && st.tiktok.statusUpdates.some((u) => u.operation_status === 'DISABLE'));

console.log('\n[9] Real metrics on the dashboard');
r = await alice.req('GET', '/api/analytics/summary?days=7');
check('before any sync the dashboard says there is no data (no fake numbers)', r.json.hasData === false && r.json.totals.impressions === 0 && r.json.changes.impressions === null);
r = await alice.req('POST', `/api/campaigns/${launchId}/sync-metrics`, { body: {} });
check('sync-metrics queues one sync per published platform', r.status === 202 && r.json.queued === 4, JSON.stringify(r.json));
const summary = await until(async () => {
  const s = (await alice.req('GET', '/api/analytics/summary?days=7')).json;
  return s.byPlatform.length === 4 ? s : null;
});
check('totals equal the sum of what the platforms reported', summary && summary.totals.impressions === 14430 && summary.totals.clicks === 636 && Math.abs(summary.totals.spend - 312) < 0.001, JSON.stringify(summary?.totals));
check('CTR and CPC are derived from real totals', summary && Math.abs(summary.totals.ctr - (636 / 14430) * 100) < 0.001 && Math.abs(summary.totals.cpc - 312 / 636) < 0.001);
check('series covers each day of the period; per-platform and top-campaign breakdowns present', summary?.series.length === 7 && summary.byPlatform.map((p) => p.platform).sort().join() === 'facebook,google,instagram,tiktok' && summary.topCampaigns[0].title === 'Coffee Launch' && summary.hasData);
check('period-over-period change is null when there is no previous data (never invented)', summary?.changes.spend === null && summary.currency === 'USD');
const mallorySummary = (await mallory.req('GET', '/api/analytics/summary?days=7')).json;
check("another user sees none of Alice's numbers", mallorySummary.hasData === false && mallorySummary.totals.spend === 0);

console.log('\n[10] Secrets stay out of URLs');
st = await mockState();
const tokens = ['meta-long-lived-token', 'meta-short-token', 'google-access', 'google-refresh-token', 'tiktok-token', 'manual-fb-token', 'manual-ig-token', 'test-anthropic-key'];
const leaked = st.requests.filter((q) => Object.values(q.query).some((v) => tokens.includes(v)) || tokens.some((t) => q.path.includes(t)));
check('no access token, refresh token or API key ever appeared in a URL or query string', leaked.length === 0, JSON.stringify(leaked.slice(0, 2)));
check('every platform API call carried credentials in a header', st.requests.filter((q) => /\/(act_|campaigns|adsets|ads|customers\/)/.test(q.path)).every((q) => q.hasAuthHeader));

console.log('\n[11] API shapes the UI relies on, and job retry');
r = await alice.req('GET', '/api/campaigns');
check('GET /api/campaigns returns an array (not a raw D1 result)', Array.isArray(r.json.campaigns) && r.json.campaigns.length >= 5);
r = await alice.req('GET', '/api/media');
check('GET /api/media returns an array', Array.isArray(r.json.media) && r.json.media.length === 2);
r = await alice.req('GET', '/api/status/overview');
check('overview: recentActivity is an array and failed jobs are counted', Array.isArray(r.json.recentActivity) && r.json.jobs.failed_jobs >= 2, JSON.stringify(r.json.jobs));
r = await alice.req('GET', '/api/status/jobs?status=failed');
check('failed jobs list is an array with the platform error text', Array.isArray(r.json.jobs) && r.json.jobs.some((j) => /ad policy/.test(j.error_message || '')));
for (const path of ['/api/status/overview', '/api/status/jobs', '/api/status/logs', `/api/status/campaigns/${launchId}`, `/api/status/platforms/${fb}`, '/api/status/health']) {
  const res = await alice.req('GET', path);
  check(`GET ${path.replace(launchId, ':id').replace(fb, ':id')} works (200)`, res.status === 200, `(got ${res.status}: ${JSON.stringify(res.json).slice(0, 120)})`);
}
const failedJobId = failed1.jobs[0].id;
r = await alice.req('POST', `/api/status/jobs/${failedJobId}/retry`, { body: {} });
check('retrying a failed job is accepted', r.status === 200, JSON.stringify(r.json));
const retried = await until(async () => {
  const c = (await alice.req('GET', `/api/campaigns/${failId}`)).json;
  const job = c.jobs.find((j) => j.id === failedJobId);
  return job && job.status === 'failed' && c.campaign.platforms[0].status === 'failed' ? job : null;
});
check('the retry really ran again and failed again for the same (policy) reason', retried && retried.retry_count === 1 && /ad policy/.test(retried.error_message), JSON.stringify(retried));
r = await mallory.req('POST', `/api/status/jobs/${failedJobId}/retry`, { body: {} });
check("another user cannot retry Alice's job -> 404", r.status === 404);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
