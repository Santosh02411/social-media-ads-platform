/**
 * Pulls real performance numbers from the ad platforms into metrics_daily.
 * Runs from the queue (message { sync: { campaignId, platformId } }), which the
 * cron trigger and the "Sync now" button both feed.
 */
import { adapterFactory } from '../adapters/AdapterFactory.js';
import { Platform } from '../models/Platform.js';

const SYNC_WINDOW_DAYS = 14;

const isoDay = (date) => date.toISOString().slice(0, 10);

export async function syncCampaignPlatform(env, campaignId, platformId) {
  const cp = await env.DB.prepare(`
    SELECT external_ref FROM campaign_platforms
    WHERE campaign_id = ? AND platform_id = ? AND status = 'success' AND external_ref IS NOT NULL
  `).bind(campaignId, platformId).first();
  if (!cp) return { skipped: true };

  const platform = await new Platform(env.DB, env.ENCRYPTION_KEY).findById(platformId);
  if (!platform?.is_connected) return { skipped: true };

  const until = new Date();
  const since = new Date(Date.now() - (SYNC_WINDOW_DAYS - 1) * 86400000);
  const adapter = adapterFactory.create(platform, env);
  const rows = await adapter.getInsights(JSON.parse(cp.external_ref), { since: isoDay(since), until: isoDay(until) });

  const statements = rows.filter((r) => r.date).map((r) =>
    env.DB.prepare(`
      INSERT INTO metrics_daily (campaign_id, platform_id, date, impressions, clicks, spend, conversions, currency, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(campaign_id, platform_id, date) DO UPDATE SET
        impressions = excluded.impressions, clicks = excluded.clicks, spend = excluded.spend,
        conversions = excluded.conversions, currency = excluded.currency, synced_at = CURRENT_TIMESTAMP
    `).bind(campaignId, platformId, r.date, r.impressions, r.clicks, r.spend, r.conversions, platform.config.currency || null)
  );
  if (statements.length > 0) await env.DB.batch(statements);
  return { rows: statements.length };
}

/** Queues a sync for every published campaign/platform (optionally for one user or campaign). */
export async function enqueueMetricsSync(env, { userId, campaignId } = {}) {
  const where = ["cp.status = 'success'", "cp.external_ref IS NOT NULL", "c.status IN ('active', 'paused')"];
  const params = [];
  if (userId) { where.push('c.user_id = ?'); params.push(userId); }
  if (campaignId) { where.push('c.id = ?'); params.push(campaignId); }

  const { results } = await env.DB.prepare(`
    SELECT cp.campaign_id, cp.platform_id
    FROM campaign_platforms cp JOIN campaigns c ON c.id = cp.campaign_id
    WHERE ${where.join(' AND ')}
    LIMIT 500
  `).bind(...params).all();

  for (let i = 0; i < results.length; i += 100) {
    await env.CAMPAIGN_QUEUE.sendBatch(
      results.slice(i, i + 100).map((r) => ({ body: { sync: { campaignId: r.campaign_id, platformId: r.platform_id } } }))
    );
  }
  return results.length;
}
