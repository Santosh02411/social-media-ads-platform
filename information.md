# AdSync — Platform Setup & Usage Guide

---

## 💡 Dummy Example — Full Walkthrough

### Scenario: Posting a product launch ad to 4 platforms at once

**Step 1 — Fill the Compose tab**

| Field | What to enter |
|-------|---------------|
| Ad Title | 🚀 CloudDesk Pro — Smarter Work, Faster Results |
| Ad Copy | AI-powered task management that learns your workflow and cuts meeting time by 40%. Trusted by 50,000+ professionals. |
| Hashtags | productivity, SaaS, AI, worksmarter, CloudDesk |
| Link | https://clouddesk.io/pro |
| Call to Action | Start your free 14-day trial — no credit card needed |
| Media | Upload a 1080×1080 product screenshot PNG |

**Step 2 — Connect your platforms** (sidebar, left panel)

Click each platform card → enter credentials → click **Connect**.
The card turns green with a ✅ when connected.

**Step 3 — Select target platforms**

In the "Post To" row of the Compose tab, check: Facebook, Instagram, LinkedIn, Twitter.

**Step 4 — Click "Publish to All Connected Platforms"**

The results overlay appears. Each platform goes:
`⏳ Posting…` → `✅ Live` (or `❌ Error: reason`)

**What gets posted per platform:**

```
Facebook:
  📢 CloudDesk Pro — Smarter Work, Faster Results

  AI-powered task management that learns your workflow...
  👉 Start your free 14-day trial — no credit card needed
  🔗 https://clouddesk.io/pro
  #productivity #SaaS #AI #worksmarter #CloudDesk
  [+ image attached]

Instagram:
  ✨ CloudDesk Pro — Smarter Work, Faster Results

  AI-powered task management...
  👉 Start your free 14-day trial
  #productivity #SaaS #AI
  [image required — uploaded PNG used]

Twitter/X:
  📢 CloudDesk Pro — Smarter Work, Faster Results
  AI-powered task management...
  👉 Start your free 14-day trial
  https://clouddesk.io/pro
  [auto-trimmed to 280 chars]

LinkedIn:
  📢 CloudDesk Pro — Smarter Work, Faster Results

  AI-powered task management...
  👉 Start your free 14-day trial
  🔗 https://clouddesk.io/pro
  #productivity #SaaS #AI
  [+ image attached]

TikTok:
  CloudDesk Pro — Smarter Work, Faster Results
  AI-powered task management...
  Start your free 14-day trial
  [video/image required]

Pinterest:
  Pin title: CloudDesk Pro — Smarter Work, Faster Results
  Description: AI-powered task management...
  Link: https://clouddesk.io/pro
  [image required]
```

---

## 🔌 Platform Connection Guide

### 📘 Facebook

**Requires:** Facebook Developer account + a Facebook **Page** (not personal profile)

**Steps:**
1. Go to [developers.facebook.com](https://developers.facebook.com)
2. Click **My Apps → Create App → Business**
3. Add product: **Pages API**
4. Go to **Tools → Graph API Explorer**
5. Select your app → click **Generate Access Token**
6. Add permission: `pages_manage_posts` → generate token
7. Exchange for a **Page Access Token** (long-lived = 60 days):
   ```
   GET /oauth/access_token
     ?grant_type=fb_exchange_token
     &client_id={app-id}
     &client_secret={app-secret}
     &fb_exchange_token={short-lived-token}
   ```
8. Find your **Page ID**: go to your Facebook Page → About → scroll to "Page Transparency" section

**Enter in AdSync:**
- `Page Access Token` → the token from step 6–7
- `Page ID` → numeric ID from step 8

---

### 📸 Instagram

**Requires:** Instagram **Business** or **Creator** account connected to a Facebook Page

**Steps:**
1. Go to [developers.facebook.com](https://developers.facebook.com) → your app
2. Add product: **Instagram Graph API**
3. Graph API Explorer → generate token with scopes:
   - `instagram_basic`
   - `instagram_content_publish`
   - `pages_show_list`
4. Run: `GET /me/accounts` → find your page and copy its `access_token`
5. Run: `GET /{page-id}?fields=instagram_business_account` → copy `id` from the result

**Enter in AdSync:**
- `Access Token` → token from step 4
- `Instagram Account ID` → id from step 5

> ⚠️ Instagram **requires an image or video** for every post. Text-only is not supported by the API.

---

### 🐦 Twitter / X

**Steps:**
1. Go to [developer.twitter.com](https://developer.twitter.com)
2. Apply for a developer account (free **Basic** tier: 1,500 posts/month)
3. Create a **Project** and an **App** inside it
4. Go to **App Settings → User Authentication Settings**:
   - Enable **OAuth 1.0a**
   - App permissions: **Read and Write**
   - Add any callback URL (e.g. `http://localhost`)
5. Go to **Keys and Tokens** tab:
   - Copy **API Key** (Consumer Key) and **API Key Secret**
   - Click **Generate** under Access Token — copy **Access Token** and **Access Token Secret**
   - ⚠️ Must be generated **after** setting Read+Write permissions

**Enter in AdSync:**
- `API Key` → API Key from step 5
- `API Secret` → API Key Secret from step 5
- `Access Token` → Access Token from step 5
- `Access Token Secret` → Access Token Secret from step 5

> ⚠️ Tweets are hard-limited to **280 characters**. AdSync auto-truncates.

---

### 💼 LinkedIn

**Steps:**
1. Go to [linkedin.com/developers](https://www.linkedin.com/developers)
2. Click **Create App** → associate with your LinkedIn Page
3. Go to **Products** tab → request **Share on LinkedIn**
4. Go to **Auth** tab → note the required scopes: `w_member_social`, `r_liteprofile`
5. Use the **OAuth 2.0 Token Generator** in the Auth tab to generate an access token
6. To get your Person URN, call:
   ```
   GET https://api.linkedin.com/v2/userinfo
   Authorization: Bearer {your-token}
   ```
   Copy the `sub` field value and format it as: `urn:li:person:{sub}`

**Enter in AdSync:**
- `Access Token` → token from step 5
- `Person/Organization URN` → `urn:li:person:XXXXXXX` from step 6

> For company pages use `urn:li:organization:{id}` instead.

---

### 🎵 TikTok

**Steps:**
1. Go to [developers.tiktok.com](https://developers.tiktok.com)
2. Create an app → add product: **Content Posting API**
3. Configure OAuth 2.0:
   - Required scopes: `video.upload`, `video.publish`
4. Complete the OAuth 2.0 Authorization Code flow for your TikTok account:
   - Authorization URL: `https://www.tiktok.com/v2/auth/authorize/`
   - After approval the callback returns `access_token` and `open_id`
5. Alternatively use the developer sandbox for testing

**Enter in AdSync:**
- `Access Token` → from OAuth callback
- `Open ID` → from OAuth callback

> ⚠️ TikTok requires a **video or image** — no text-only posts.

---

### 📌 Pinterest

**Steps:**
1. Go to [developers.pinterest.com](https://developers.pinterest.com)
2. Create an App
3. Go to **App Settings → Configure** → request scopes: `boards:read`, `pins:write`
4. Generate an access token via the OAuth 2.0 flow
5. Find your Board ID:
   - Open a board → look at the URL: `pinterest.com/{user}/{board-name}/`
   - Or call `GET https://api.pinterest.com/v5/boards` with your token
   - Copy the numeric `id` field

**Enter in AdSync:**
- `Access Token` → from step 4
- `Board ID` → numeric ID from step 5

> ⚠️ Pinterest requires an **image or video** to create a Pin.

---

## 🕐 Scheduling Posts

1. Fill in the **Compose** tab with your ad content (title, copy, hashtags, media, etc.)
2. Switch to the **Schedule** tab
3. Enter a future date and time
4. Click **Schedule Post**
5. Pending posts appear in the **Pending Scheduled Posts** panel
6. Click **Cancel** to remove a scheduled post before it fires

The scheduler checks every 10 seconds and posts automatically when due.

> In production, replace the in-memory scheduler with **Celery + Redis** for persistence across server restarts.

---

## 📊 Analytics Tab

Shows:
- Total posts, succeeded, failed
- Pending scheduled posts count
- Per-platform breakdown with success rate bar
- Refresh button for latest stats

---

## 🔒 Security Notes

- **Never commit `.env`** — it contains API secrets
- Set `SECRET_KEY` to a long random string in production: `python -c "import secrets; print(secrets.token_hex(32))"`
- Use long-lived tokens where available (Facebook, LinkedIn offer 60-day tokens)
- Twitter tokens must be regenerated after changing app permissions
- In production: add HTTPS (nginx/Caddy) before exposing publicly
- For production scheduler reliability: use Celery + Redis instead of in-memory threading

---

## 🐛 Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| "Not connected" on post | Platform was disconnected | Reconnect via sidebar |
| Instagram "requires image" | API limitation | Upload an image or video |
| Twitter 401 | Wrong permissions or stale token | Regenerate token after setting Read+Write |
| Twitter 403 Forbidden | App doesn't have Write access | User Auth Settings → Read and Write |
| Facebook "Invalid OAuth" | Expired or wrong token | Generate fresh Page Access Token |
| LinkedIn 403 | Missing `w_member_social` scope | Re-approve product + re-generate token |
| TikTok "No upload URL" | Missing `video.upload` scope | Re-authorize with correct scopes |
| Pinterest 404 on board | Wrong board_id | Verify via `GET /v5/boards` |
| Upload fails >100MB | Size limit | Compress video; limit is 100MB |

---

## 🛠️ Adding a New Platform

1. Create `api/yourplatform_connector.py`
2. Inherit from `BaseConnector`:
   ```python
   from api import BaseConnector

   class YourPlatformConnector(BaseConnector):
       PLATFORM_NAME = "Your Platform"
       ICON = "yourplatform"        # used for CSS icon
       COLOR = "#FF5500"
       SUPPORTED_CONTENT_TYPES = ["text", "image", "video"]
       REQUIRED_CREDENTIALS = [
           {"key": "access_token", "label": "Access Token", "type": "password",
            "help": "Get from your developer portal"},
       ]

       def connect(self): ...
       def disconnect(self): ...
       def post_ad(self, content): ...
       def validate_credentials(self): ...
   ```
3. Register in `app.py`:
   ```python
   from api.yourplatform_connector import YourPlatformConnector
   platform_connectors["yourplatform"] = YourPlatformConnector
   ```
4. Add SVG icon + credential guide in `static/js/app.js` in the `SVGS` and `GUIDES` objects

---

## 📡 API Endpoints Reference

```
GET  /api/platforms              — list all platforms + connection status
POST /api/connect                — connect with credentials
     body: {"platform": "facebook", "credentials": {...}}
POST /api/disconnect             — disconnect
     body: {"platform": "facebook"}
POST /api/test-connection        — validate credentials without connecting
     body: {"platform": "facebook", "credentials": {...}}
POST /api/upload                 — upload media file (multipart/form-data, field: "file")
POST /api/post                   — post ad to platforms
     body: {
       "content": {
         "text": "Ad copy",
         "ad_title": "Headline",
         "call_to_action": "Shop Now",
         "link": "https://example.com",
         "hashtags": ["tag1", "tag2"],
         "media_url": "/static/uploads/file.jpg",
         "media_type": "image"   // "text", "image", "video", "audio"
       },
       "platforms": ["facebook", "instagram"]  // omit = all connected
     }
GET  /api/history                — last 30 posts
GET  /api/stats                  — aggregate statistics
POST /api/schedule               — schedule a future post
     body: {"content": {...}, "platforms": [...], "scheduled_at": "2025-12-01T10:00:00"}
GET  /api/schedule               — list all scheduled posts
DELETE /api/schedule/<id>        — cancel a scheduled post
GET  /api/events?since=<event-id> — real-time polling for live status updates
```
