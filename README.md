# Unified Social Media Ads SaaS Platform

A production-ready MVP for managing social media advertising campaigns across multiple platforms.

## Architecture

- **Frontend**: Next.js 14 (App Router) + Tailwind CSS + TypeScript
- **Backend**: Cloudflare Workers + Hono framework
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2 (media files)
- **Cache**: Cloudflare KV (sessions + tokens)
- **Queues**: Cloudflare Queues (async job processing)
- **Jobs**: Cloudflare Queues (publishing, retries) + Cron Triggers (metrics sync)

## Security at a glance

- Sessions: signed JWT in an **httpOnly** cookie + server-side session in KV (logout revokes immediately)
- CSRF: state-changing requests must come from an allowed `Origin`
- Platform API credentials: **AES-256-GCM encrypted** in D1, never returned to the browser
- Passwords: bcrypt (cost 12), 8-72 chars with a letter and a number, per-account lockout and per-IP rate limits
- All request bodies validated with Zod; CORS restricted via `ALLOWED_ORIGINS`

## Features

- **Publish to Facebook, Instagram, Google Ads and TikTok** through their real APIs (Meta Marketing API v25, Google Ads API v25, TikTok Business API v1.3). Ads are created **paused** by default; activate and pause from the app
- **Connect accounts** with one-click OAuth (Meta, Google, TikTok) or manual credentials that are verified against the platform before saving
- **Queue-based publishing** with retries and exponential backoff. A retry resumes where it stopped, so it never creates duplicate campaigns on the platform
- **AI ad copy** with the Claude API: headlines, descriptions and ad text that respect each platform's length limits
- **Real performance dashboard**: impressions, clicks, spend, CTR and period-over-period change, synced from the platforms every 6 hours (or on demand). With no data it says so; nothing is invented
- Media upload (private R2 storage, signed download links for the ad platforms), campaign duplication, job status and manual retry

> Everything is tested end to end against a local mock of the platforms. It has **not** been run against live Meta/Google/TikTok accounts. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) for exactly what that means and the go-live checklist.

## Project Structure

```
ads-saas-platform/
├── backend/                 # Cloudflare Workers + Hono
│   └── src/
│       ├── adapters/        # Facebook, Instagram, Google, TikTok API clients
│       ├── middleware/      # Auth and validation
│       ├── models/          # Data models
│       ├── routes/          # API endpoints
│       ├── services/        # OAuth, AI copy, metrics sync
│       ├── utils/           # Helper functions
│       └── workers/         # Queue processors
├── frontend/                # Next.js application
│   └── src/
│       ├── app/            # App Router pages
│       ├── components/     # Reusable UI components
│       ├── hooks/          # Custom React hooks
│       ├── lib/            # Utility libraries
│       ├── types/          # TypeScript definitions
│       └── utils/          # Helper functions
├── database/
│   └── migrations/         # D1 database migrations
├── docs/                   # Documentation
└── scripts/               # Deployment and utility scripts
```

## Getting Started

### Prerequisites

- **Node.js**: Version 18 or higher
- **Cloudflare CLI (Wrangler)**: Installed globally (`npm install -g wrangler`)
- **Git**: For version control

### Installation

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd ads-saas-platform
   ```

2. **Set up the Backend**:
   ```bash
   cd backend
   npm install
   ```

3. **Set up the Frontend**:
   ```bash
   cd ../frontend
   npm install
   ```

### Configuration

#### 1. Backend (Cloudflare)
Update `backend/wrangler.toml` with your Cloudflare resource IDs. You'll need to create:
- A D1 database: `wrangler d1 create ads-saas-db`
- KV namespaces: `wrangler kv:namespace create "SESSIONS"` and `wrangler kv:namespace create "TOKENS"`
- An R2 bucket: `wrangler r2 bucket create ads-saas-media`

Generate the local secrets (writes the git-ignored `backend/.dev.vars`):
```bash
cd backend
npm run setup:secrets
```
Secrets (`JWT_SECRET`, `ENCRYPTION_KEY`) never go in `wrangler.toml`. In production use `wrangler secret put`. See [docs/SECURITY.md](docs/SECURITY.md).

#### 2. Frontend
Copy `frontend/.env.example` to `frontend/.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:8787
```
Open the app at `http://localhost:3000` (the API only accepts the origins listed in `ALLOWED_ORIGINS`).

## Running Locally

To run the full stack locally:

1. **Start the Backend**:
   ```bash
   cd backend
   wrangler dev
   ```
   The API will be available at `http://localhost:8787`.

   No ad accounts yet? Use the sandbox (a local mock of the platforms and the Claude API):
   ```bash
   cd backend
   npm run setup:secrets -- --sandbox   # once
   npm run mock:platforms               # in a separate terminal
   ```
   The Integrations page shows a "Sandbox mode" banner while it is active.

2. **Start the Frontend**:
   ```bash
   cd frontend
   npm run dev
   ```
   The application will be available at `http://localhost:3000`.

## Testing the API

You can perform a quick health check on the backend:
```bash
curl http://localhost:8787/health
```

Two test suites run against the local backend plus the mock platform server. Use a fresh local database for each run, since they exercise the rate limiters:
```bash
cd backend
npm run setup:secrets -- --sandbox
rm -rf .wrangler && npm run db:local   # fresh local D1 + KV
npm run mock:platforms                 # terminal 1
npm run dev                            # terminal 2
npm run test:security                  # terminal 3: 63 checks (auth, CSRF, encryption, rate limits)
npm run test:e2e                       # terminal 3 (fresh DB again): 86 checks (OAuth, AI, publishing, retries, metrics)
```

## Deployment

The platform is designed for Cloudflare's edge computing platform.

1. **Deploy Backend**:
   ```bash
   cd backend
   wrangler deploy
   ```

2. **Deploy Frontend**:
   Deploy to Cloudflare Pages or Vercel. For Cloudflare Pages, use `npm run build` as the build command and `.next` as the output directory.

## License

MIT License
