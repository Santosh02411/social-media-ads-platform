import { Hono } from 'hono';
import { getBoundedInt } from '../utils/http.js';
import { enqueueMetricsSync } from '../services/metrics.js';

const analytics = new Hono();

const isoDay = (date) => date.toISOString().slice(0, 10);
const addDays = (date, days) => new Date(date.getTime() + days * 86400000);
const pct = (current, previous) => (previous > 0 ? ((current - previous) / previous) * 100 : null);

function withDerived(t) {
  const impressions = t.impressions || 0;
  const clicks = t.clicks || 0;
  const spend = t.spend || 0;
  return {
    impressions,
    clicks,
    spend,
    conversions: t.conversions || 0,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
  };
}

// Real numbers from the ad platforms, compared with the previous period of the same length
analytics.get('/summary', async (c) => {
  const userId = c.get('userId');
  const days = getBoundedInt(c, 'days', { fallback: 7, min: 1, max: 90 });

  const today = new Date(`${isoDay(new Date())}T00:00:00Z`);
  const curStart = addDays(today, -(days - 1));
  const prevEnd = addDays(curStart, -1);
  const prevStart = addDays(prevEnd, -(days - 1));

  const totalsQuery = `
    SELECT SUM(m.impressions) AS impressions, SUM(m.clicks) AS clicks, SUM(m.spend) AS spend, SUM(m.conversions) AS conversions
    FROM metrics_daily m JOIN campaigns c ON c.id = m.campaign_id
    WHERE c.user_id = ? AND m.date BETWEEN ? AND ?`;

  const [current, previous, daily, byPlatform, topCampaigns, meta] = await Promise.all([
    c.env.DB.prepare(totalsQuery).bind(userId, isoDay(curStart), isoDay(today)).first(),
    c.env.DB.prepare(totalsQuery).bind(userId, isoDay(prevStart), isoDay(prevEnd)).first(),
    c.env.DB.prepare(`
      SELECT m.date, SUM(m.impressions) AS impressions, SUM(m.clicks) AS clicks, SUM(m.spend) AS spend
      FROM metrics_daily m JOIN campaigns c ON c.id = m.campaign_id
      WHERE c.user_id = ? AND m.date BETWEEN ? AND ? GROUP BY m.date ORDER BY m.date
    `).bind(userId, isoDay(curStart), isoDay(today)).all(),
    c.env.DB.prepare(`
      SELECT p.type AS platform, SUM(m.impressions) AS impressions, SUM(m.clicks) AS clicks, SUM(m.spend) AS spend
      FROM metrics_daily m JOIN campaigns c ON c.id = m.campaign_id JOIN platforms p ON p.id = m.platform_id
      WHERE c.user_id = ? AND m.date BETWEEN ? AND ? GROUP BY p.type ORDER BY spend DESC
    `).bind(userId, isoDay(curStart), isoDay(today)).all(),
    c.env.DB.prepare(`
      SELECT c.id, c.title, SUM(m.impressions) AS impressions, SUM(m.clicks) AS clicks, SUM(m.spend) AS spend
      FROM metrics_daily m JOIN campaigns c ON c.id = m.campaign_id
      WHERE c.user_id = ? AND m.date BETWEEN ? AND ? GROUP BY c.id ORDER BY spend DESC LIMIT 5
    `).bind(userId, isoDay(curStart), isoDay(today)).all(),
    c.env.DB.prepare(`
      SELECT GROUP_CONCAT(DISTINCT m.currency) AS currencies, MAX(m.synced_at) AS last_synced_at
      FROM metrics_daily m JOIN campaigns c ON c.id = m.campaign_id WHERE c.user_id = ?
    `).bind(userId).first(),
  ]);

  const cur = withDerived(current);
  const prev = withDerived(previous);
  const byDate = new Map(daily.results.map((r) => [r.date, r]));
  const series = Array.from({ length: days }, (_, i) => {
    const date = isoDay(addDays(curStart, i));
    const row = byDate.get(date);
    return { date, impressions: row?.impressions || 0, clicks: row?.clicks || 0, spend: row?.spend || 0 };
  });

  const currencies = (meta?.currencies || '').split(',').filter(Boolean);

  return c.json({
    days,
    totals: cur,
    // null when there is nothing to compare against (never a made-up number)
    changes: {
      impressions: pct(cur.impressions, prev.impressions),
      clicks: pct(cur.clicks, prev.clicks),
      spend: pct(cur.spend, prev.spend),
      ctr: pct(cur.ctr, prev.ctr),
    },
    series,
    byPlatform: byPlatform.results,
    topCampaigns: topCampaigns.results,
    currency: currencies[0] || null,
    mixedCurrencies: currencies.length > 1,
    hasData: series.some((s) => s.impressions > 0 || s.spend > 0),
    lastSyncedAt: meta?.last_synced_at || null,
  });
});

// "Refresh" button: queue a sync for all of the user's published campaigns
analytics.post('/sync', async (c) => {
  const queued = await enqueueMetricsSync(c.env, { userId: c.get('userId') });
  return c.json({ queued }, 202);
});

export { analytics as analyticsRoutes };
