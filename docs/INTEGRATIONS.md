# Integrations: how publishing works, what is verified, how to go live

## What happens when you press Publish

1. The API validates the campaign (creative present, platforms connected) and creates one **job** per platform in D1.
2. It puts `{ jobId }` on the `campaign-jobs` queue and answers `202`. The campaign shows **publishing**.
3. The queue worker loads the job, campaign, media and **decrypted** credentials from the database (a message never carries stale data) and calls the platform adapter.
4. Each adapter creates the objects the platform needs, **saving progress after every object** (`campaign_platforms.external_ref`):
   - Meta: campaign → ad set → image upload → creative (`object_story_spec` + Page) → ad
   - Google: one atomic `GoogleAdsService.Mutate` (budget, campaign, geo targets, ad group, keywords, responsive search ad)
   - TikTok: campaign → video upload (by signed URL) → cover image → ad group → identity → ad
5. Transient failures (network, timeout, HTTP 429/5xx, platform "try again" codes) are retried with exponential backoff, up to 5 attempts. A retry **resumes** from the saved ids, so a failure halfway never creates a second campaign. Permanent failures (bad token, policy rejection, missing creative) fail once, with the platform's own message shown in the UI.
6. Everything is created **paused** unless "Create ads paused" is unticked. **Activate** and **Pause** switch the real campaign, ad set and ad.

## Verified vs not verified

| | Status |
| --- | --- |
| Our request shapes, headers, retries, idempotency, OAuth state handling, token storage, signed media URLs, metrics mapping | Tested end to end (`npm run test:e2e`) against `scripts/mock-platforms.mjs` |
| Mock server rules | Written from the official docs (Meta Marketing API, Google Ads API REST, TikTok Business API v1.3), checking the required fields I found there |
| **Real Meta / Google / TikTok accounts** | **Not tested.** The platforms may reject a payload the mock accepts (policy, required-field changes, account type). Expect some adjustments on first real runs. TikTok is the least certain (many required ad-group fields; location ids; identity) |
| Claude API | Request shape follows the Messages API; tested against the mock only |

## Go-live checklist

**Meta (Facebook + Instagram)**
- Create a *Business* app, add the Marketing API and Facebook Login for Business, set the redirect URI to `{PUBLIC_API_URL}/api/oauth/callback/facebook` and `/instagram`.
- Request `ads_management`, `ads_read`, `business_management`, `pages_show_list`, `pages_read_engagement` (+ `instagram_basic`). Standard access works for your own accounts; serving other businesses needs Advanced access (App Review + Business Verification).
- User tokens last about 60 days; the app warns before expiry and asks the user to reconnect. Marketing API versions retire roughly every quarter: bump `META_API_VERSION`.

**Google Ads**
- Apply for a **developer token** (Basic access is enough to start) and put it in `GOOGLE_ADS_DEVELOPER_TOKEN`.
- Create an OAuth client; the `adwords` scope is *sensitive*, so a public app needs Google's OAuth verification. Redirect URI: `{PUBLIC_API_URL}/api/oauth/callback/google`.
- Test accounts: use a Google Ads test account (developer-token test mode only works with test accounts).

**TikTok**
- Create a Marketing API app, get it approved, set the redirect URI to `{PUBLIC_API_URL}/api/oauth/callback/tiktok`.
- Video ads need a video in the media library; TikTok downloads it from a signed URL, so `PUBLIC_API_URL` must be reachable from the internet.

**Server**
- `wrangler secret put` for `JWT_SECRET`, `ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, `META_APP_ID`, `META_APP_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`. Only the ones you use are needed; a feature switches on when its secrets exist.
- Set `ENVIRONMENT=production`, `ALLOWED_ORIGINS`, `FRONTEND_URL`, `PUBLIC_API_URL` (see `wrangler.toml`).
- Create the queue (`wrangler queues create campaign-jobs`); the 6-hourly metrics sync uses the cron trigger.
- **Start with a small daily budget and paused ads on a test account.**

## Current limits

- Objectives: traffic and awareness. Conversion/lead campaigns need pixels or lead forms that this app does not manage yet.
- Meta ads use one image (no video, carousel or catalog). Google is Search with a responsive search ad (keywords required). TikTok is a single in-feed video.
- Budgets are in each ad account's currency; the dashboard warns when currencies are mixed rather than converting.
- Edits to a campaign after publishing change the local record only; the live ads on the platforms are not modified.
- Targeting is country, age range and (Google) keywords. 25 countries are supported.
- Metrics sync every 6 hours and on demand; platforms may revise recent days' numbers.
