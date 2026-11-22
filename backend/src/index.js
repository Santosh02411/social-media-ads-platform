import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { authRoutes } from './routes/auth.js';
import { campaignRoutes } from './routes/campaigns.js';
import { platformRoutes } from './routes/platforms.js';
import { mediaRoutes } from './routes/media.js';
import { statusRoutes } from './routes/status.js';
import { aiRoutes } from './routes/ai.js';
import { analyticsRoutes } from './routes/analytics.js';
import { oauthRoutes } from './routes/oauth.js';
import { publicMediaRoutes } from './routes/media.js';
import { CampaignWorker } from './workers/CampaignWorker.js';
import { enqueueMetricsSync } from './services/metrics.js';
import { errorHandler, configGuard } from './middleware/errorHandler.js';
import { authMiddleware } from './middleware/auth.js';
import { originGuard } from './middleware/originGuard.js';
import { getAllowedOrigins } from './utils/config.js';

const app = new Hono();

app.onError(errorHandler);

// --- Global middleware (order matters) ---
app.use('*', secureHeaders());

// CORS: only origins listed in ALLOWED_ORIGINS (see wrangler.toml) may call the API with cookies
app.use('*', (c, next) =>
  cors({
    origin: (origin) => (getAllowedOrigins(c.env).includes(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    credentials: true,
    maxAge: 600,
  })(c, next)
);

app.use('*', logger());
app.use('*', configGuard); // 500 if JWT_SECRET / ENCRYPTION_KEY are missing
app.use('*', originGuard); // CSRF: state-changing requests must come from an allowed origin

// --- Public routes ---
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// JSON APIs get a small body limit (media uploads have their own 50MB check)
const jsonLimit = bodyLimit({
  maxSize: 100 * 1024,
  onError: (c) => c.json({ error: 'Request body too large' }, 413),
});
app.use('/api/auth/*', jsonLimit);
app.use('/api/campaigns/*', jsonLimit);
app.use('/api/platforms/*', jsonLimit);
app.use('/api/ai/*', jsonLimit);

// /api/auth has its own per-route protection (register/login are public)
app.route('/api/auth', authRoutes);

// Public by design, each protects itself: the OAuth callback (single-use state + session match)
// and signed media downloads (HMAC + expiry) used by the ad platforms
app.route('/api/oauth', oauthRoutes);
app.route('/media-file', publicMediaRoutes);

// --- Protected routes: a valid, non-revoked session is required ---
for (const base of ['/api/platforms', '/api/campaigns', '/api/media', '/api/status', '/api/ai', '/api/analytics']) {
  app.use(base, authMiddleware);
  app.use(`${base}/*`, authMiddleware);
}

app.route('/api/platforms', platformRoutes);
app.route('/api/campaigns', campaignRoutes);
app.route('/api/media', mediaRoutes);
app.route('/api/status', statusRoutes);
app.route('/api/ai', aiRoutes);
app.route('/api/analytics', analyticsRoutes);

app.notFound((c) => c.json({ error: 'Not Found' }, 404));

export default {
  fetch: app.fetch,

  // Queue consumer: publishes campaigns, toggles them on/off, syncs metrics
  queue: (batch, env) => new CampaignWorker(env).processBatch(batch),

  // Cron trigger (see wrangler.toml): refresh performance numbers for published campaigns
  scheduled: (event, env, ctx) => {
    ctx.waitUntil(enqueueMetricsSync(env));
  },
};
