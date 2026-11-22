import { adapterFactory } from '../adapters/AdapterFactory.js';
import { PlatformError } from '../adapters/http.js';
import { Campaign } from '../models/Campaign.js';
import { Log } from '../models/Log.js';
import { Platform } from '../models/Platform.js';
import { syncCampaignPlatform } from '../services/metrics.js';
import { signMediaUrl } from '../utils/mediaUrls.js';

const MAX_ATTEMPTS = 5;

const parseJson = (value, fallback) => {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};

const normalizeBody = (body) => (typeof body === 'string' ? parseJson(body, {}) : body || {});

/** Seconds to wait before the next attempt: honours Retry-After, else exponential backoff. */
export function backoffSeconds(attempt, retryAfter, base = 30) {
  if (retryAfter) return Math.min(retryAfter, 900);
  return Math.min(base * 2 ** (attempt - 1), 600);
}

/**
 * Consumes campaign-jobs queue messages:
 *   { jobId }                          -> publish / set_status for one campaign on one platform
 *   { sync: { campaignId, platformId }} -> pull performance numbers
 * Job rows live in D1 (created by the API), so a message never carries stale data.
 */
export class CampaignWorker {
  constructor(env) {
    this.env = env;
    this.log = new Log(env.DB);
    this.platforms = new Platform(env.DB, env.ENCRYPTION_KEY);
    this.campaigns = new Campaign(env.DB);
    this.retryBase = Number(env.QUEUE_RETRY_BASE_SECONDS) || 30; // seconds; first retry waits this long
  }

  async processBatch(batch) {
    for (const message of batch.messages) {
      try {
        const outcome = await this.handle(normalizeBody(message.body));
        if (outcome?.retryDelay) message.retry({ delaySeconds: outcome.retryDelay });
        else message.ack();
      } catch (error) {
        // Unexpected bug or DB hiccup: let the queue redeliver
        console.error('Queue message failed unexpectedly:', error);
        message.retry({ delaySeconds: 60 });
      }
    }
  }

  async handle(body) {
    if (body.sync) return this.handleSync(body.sync);
    if (body.jobId) return this.runJob(body.jobId);
    console.warn('Ignoring unknown queue message');
    return {};
  }

  async handleSync({ campaignId, platformId }) {
    try {
      await syncCampaignPlatform(this.env, campaignId, platformId);
      return {};
    } catch (error) {
      if (error instanceof PlatformError && error.retryable) return { retryDelay: backoffSeconds(1, error.retryAfter, this.retryBase) };
      console.error('Metrics sync failed:', error?.message);
      return {};
    }
  }

  async runJob(jobId) {
    const job = await this.env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(jobId).first();
    if (!job || job.status === 'success' || job.status === 'failed') return {};

    const attempt = (job.retry_count || 0) + 1;
    await this.env.DB.prepare(`UPDATE jobs SET status = 'processing', retry_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(attempt, jobId).run();

    const campaign = await this.campaigns.findById(job.campaign_id);
    const platform = await this.platforms.findById(job.platform_id);

    try {
      if (!campaign || !platform) throw new PlatformError('The campaign or platform no longer exists', { code: 'NOT_FOUND' });
      if (!platform.is_connected) throw new PlatformError('This platform is disconnected. Reconnect it and retry.', { code: 'AUTH_FAILED' });
      const expires = platform.config.tokenExpiresAt && Date.parse(platform.config.tokenExpiresAt);
      if (expires && expires < Date.now()) throw new PlatformError('The access token has expired. Reconnect the platform.', { code: 'AUTH_FAILED' });

      const adapter = adapterFactory.create(platform, this.env);
      if (job.action === 'publish') await this.publish(job, campaign, platform, adapter);
      else if (job.action === 'set_status') await this.setStatus(job, campaign, platform, adapter);
      else throw new PlatformError(`Unknown action: ${job.action}`, { code: 'INVALID_JOB' });

      await this.finishJob(job, 'success');
      await this.log.info(`Campaign ${job.action} succeeded`, { jobId, action: job.action, platform: platform.type }, campaign.user_id, job.campaign_id, job.platform_id);
      return {};
    } catch (error) {
      const message = error instanceof PlatformError || error?.name === 'PlatformError' ? error.message : 'Unexpected error while processing the job';
      if (!(error instanceof PlatformError)) console.error('Job error:', error);

      const retryable = error instanceof PlatformError && error.retryable && attempt < MAX_ATTEMPTS;
      if (retryable) {
        await this.env.DB.prepare(`UPDATE jobs SET status = 'pending', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(message, jobId).run();
        if (job.action === 'publish') await this.setPlatformStatus(job, 'retrying', message);
        await this.log.warn(`Campaign ${job.action} will be retried`, { jobId, attempt, error: message }, campaign?.user_id, job.campaign_id, job.platform_id);
        return { retryDelay: backoffSeconds(attempt, error.retryAfter, this.retryBase) };
      }

      await this.finishJob(job, 'failed', message);
      if (job.action === 'publish') {
        await this.setPlatformStatus(job, 'failed', message);
        await this.refreshCampaignStatus(job.campaign_id);
      }
      await this.log.error(`Campaign ${job.action} failed`, { jobId, attempt, error: message }, campaign?.user_id, job.campaign_id, job.platform_id);
      return {};
    }
  }

  async publish(job, campaign, platform, adapter) {
    const cp = await this.env.DB.prepare('SELECT * FROM campaign_platforms WHERE campaign_id = ? AND platform_id = ?')
      .bind(job.campaign_id, job.platform_id).first();
    if (cp?.status === 'success' && cp.external_id) return; // already published; never create duplicates

    await this.setPlatformStatus(job, 'processing');
    const ad = await this.buildAd(campaign);
    const state = parseJson(cp?.external_ref, {});

    const result = await adapter.publishAd(ad, {
      state,
      // Persist progress after every remote object, so a retry resumes instead of duplicating
      saveState: async (current) => {
        await this.env.DB.prepare('UPDATE campaign_platforms SET external_ref = ?, updated_at = CURRENT_TIMESTAMP WHERE campaign_id = ? AND platform_id = ?')
          .bind(JSON.stringify(current), job.campaign_id, job.platform_id).run();
      },
    });

    await this.env.DB.prepare(`
      UPDATE campaign_platforms
      SET status = 'success', external_id = ?, external_ref = ?, error_message = NULL,
          published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE campaign_id = ? AND platform_id = ?
    `).bind(String(result.externalId), JSON.stringify(result.externalRef), job.campaign_id, job.platform_id).run();

    await this.refreshCampaignStatus(job.campaign_id);
  }

  async setStatus(job, campaign, platform, adapter) {
    const { status } = parseJson(job.payload, {});
    const cp = await this.env.DB.prepare('SELECT external_ref, status FROM campaign_platforms WHERE campaign_id = ? AND platform_id = ?')
      .bind(job.campaign_id, job.platform_id).first();
    if (!cp || cp.status !== 'success' || !cp.external_ref) {
      throw new PlatformError('Nothing has been published to this platform yet', { code: 'NOT_PUBLISHED' });
    }

    await adapter.setStatus(JSON.parse(cp.external_ref), status);
    await this.campaigns.setStatus(job.campaign_id, status);
  }

  /** Builds the platform-neutral ad from the campaign + attached media. */
  async buildAd(campaign) {
    const media = await this.campaigns.getMedia(campaign.id);
    const startMs = campaign.schedule_start ? Date.parse(campaign.schedule_start) : NaN;
    const endMs = campaign.schedule_end ? Date.parse(campaign.schedule_end) : NaN;

    return {
      name: campaign.title,
      objective: campaign.objective,
      budget: { amount: Number(campaign.budget), type: campaign.budget_type },
      // A start time in the past would be rejected; "now" is implied by leaving it out
      schedule: {
        start: !Number.isNaN(startMs) && startMs > Date.now() ? new Date(startMs).toISOString() : null,
        end: !Number.isNaN(endMs) ? new Date(endMs).toISOString() : null,
      },
      targeting: campaign.targeting,
      creative: {
        headline: campaign.headline,
        body: campaign.ad_copy,
        url: campaign.destination_url,
        cta: campaign.call_to_action,
        headlines: campaign.variants.headlines,
        descriptions: campaign.variants.descriptions,
      },
      media: media
        .filter((m) => m.media_type !== 'text')
        .map((m) => ({
          id: m.id,
          kind: m.media_type,
          mimeType: m.mime_type,
          name: m.original_name,
          getBytes: async () => (await this.env.MEDIA_BUCKET.get(m.r2_key)).arrayBuffer(),
          publicUrl: () => signMediaUrl(this.env, m.id, 3600),
        })),
      startPaused: campaign.publish_paused,
    };
  }

  async finishJob(job, status, error = null) {
    await this.env.DB.prepare(`UPDATE jobs SET status = ?, error_message = ?, processed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(status, error, job.id).run();
  }

  async setPlatformStatus(job, status, error = null) {
    await this.env.DB.prepare(`UPDATE campaign_platforms SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE campaign_id = ? AND platform_id = ?`)
      .bind(status, error, job.campaign_id, job.platform_id).run();
  }

  /** draft -> publishing -> paused/active (or back to draft if every platform failed). */
  async refreshCampaignStatus(campaignId) {
    const campaign = await this.campaigns.findById(campaignId);
    if (!campaign || !['draft', 'publishing'].includes(campaign.status)) return;

    const statuses = campaign.platforms.map((p) => p.status);
    let next;
    if (statuses.some((s) => ['pending', 'processing', 'retrying'].includes(s))) next = 'publishing';
    else if (statuses.includes('success')) next = campaign.publish_paused ? 'paused' : 'active';
    else next = 'draft';
    if (next !== campaign.status) await this.campaigns.setStatus(campaignId, next);
  }
}
