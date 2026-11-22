import { Hono } from 'hono';
import { Campaign } from '../models/Campaign.js';
import { Log } from '../models/Log.js';
import { validateJson } from '../middleware/validate.js';
import { getPagination } from '../utils/http.js';
import { enqueueMetricsSync } from '../services/metrics.js';
import {
  campaignCreateSchema,
  campaignUpdateSchema,
  campaignDuplicateSchema,
} from '../validation/schemas.js';

const campaigns = new Hono();

/** Loads a campaign and checks it belongs to the signed-in user (404 otherwise). */
async function loadOwned(c) {
  const found = await new Campaign(c.env.DB).findById(c.req.param('id'));
  if (!found || found.user_id !== c.get('userId')) {
    return { response: c.json({ error: 'Campaign not found' }, 404) };
  }
  return { campaign: found };
}

const placeholders = (items) => items.map(() => '?').join(',');

/** Every id must belong to the user (prevents linking someone else's platforms/media). */
async function ownsAll(c, table, ids) {
  if (!ids || ids.length === 0) return true;
  const { results } = await c.env.DB.prepare(
    `SELECT id FROM ${table} WHERE user_id = ? AND id IN (${placeholders(ids)})`
  ).bind(c.get('userId'), ...ids).all();
  return results.length === new Set(ids).size;
}

/** Creates one pending job per platform and puts them on the queue. */
async function queueJobs(c, campaignId, platformIds, action, payload = {}) {
  const jobs = platformIds.map((platformId) => ({ id: crypto.randomUUID(), platformId }));

  await c.env.DB.batch(jobs.map((job) =>
    c.env.DB.prepare(`INSERT INTO jobs (id, campaign_id, platform_id, action, status, payload) VALUES (?, ?, ?, ?, 'pending', ?)`)
      .bind(job.id, campaignId, job.platformId, action, JSON.stringify(payload))
  ));

  try {
    await c.env.CAMPAIGN_QUEUE.sendBatch(jobs.map((job) => ({ body: { jobId: job.id } })));
  } catch (error) {
    await c.env.DB.batch(jobs.map((job) =>
      c.env.DB.prepare(`UPDATE jobs SET status = 'failed', error_message = 'Could not queue the job' WHERE id = ?`).bind(job.id)
    ));
    throw error;
  }
  return jobs;
}

// List campaigns
campaigns.get('/', async (c) => {
  const { limit, offset } = getPagination(c);
  const list = await new Campaign(c.env.DB).findByUserId(c.get('userId'), limit, offset);
  return c.json({ campaigns: list });
});

// One campaign, with its media and recent jobs (the UI polls this while publishing)
campaigns.get('/:id', async (c) => {
  const { campaign, response } = await loadOwned(c);
  if (response) return response;

  const model = new Campaign(c.env.DB);
  const media = (await model.getMedia(campaign.id)).map(({ r2_key, ...rest }) => rest);
  const { results: jobs } = await c.env.DB.prepare(`
    SELECT id, platform_id, action, status, error_message, retry_count, updated_at
    FROM jobs WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 20
  `).bind(campaign.id).all();

  return c.json({ campaign, media, jobs });
});

// Create
campaigns.post('/', validateJson(campaignCreateSchema), async (c) => {
  const userId = c.get('userId');
  const data = c.get('body');

  if (!(await ownsAll(c, 'platforms', data.platforms))) {
    return c.json({ error: 'One or more selected platforms were not found' }, 400);
  }
  if (!(await ownsAll(c, 'media', data.mediaIds))) {
    return c.json({ error: 'One or more selected media files were not found' }, 400);
  }

  const created = await new Campaign(c.env.DB).create(data, userId);
  await new Log(c.env.DB).info('Campaign created', { campaignId: created.id, title: created.title, platforms: data.platforms.length }, userId, created.id);
  return c.json({ campaign: created }, 201);
});

// Update the local campaign (what will be sent at the next publish)
campaigns.put('/:id', validateJson(campaignUpdateSchema), async (c) => {
  const { campaign, response } = await loadOwned(c);
  if (response) return response;

  if (campaign.status === 'publishing') {
    return c.json({ error: 'The campaign is being published. Try again in a moment.' }, 409);
  }
  const patch = c.get('body');
  if (patch.mediaIds && !(await ownsAll(c, 'media', patch.mediaIds))) {
    return c.json({ error: 'One or more selected media files were not found' }, 400);
  }

  // The stored lifetime/end-date rule must still hold after a partial update
  const budgetType = patch.budgetType ?? campaign.budget_type;
  const scheduleEnd = 'scheduleEnd' in patch ? patch.scheduleEnd : campaign.schedule_end;
  if (budgetType === 'lifetime' && !scheduleEnd) {
    return c.json({ error: 'Validation failed', details: [{ field: 'scheduleEnd', message: 'A lifetime budget needs an end date' }] }, 400);
  }

  const updated = await new Campaign(c.env.DB).update(campaign.id, patch);
  await new Log(c.env.DB).info('Campaign updated', { campaignId: campaign.id, updates: Object.keys(patch) }, c.get('userId'), campaign.id);

  const published = campaign.platforms.some((p) => p.status === 'success');
  return c.json({
    campaign: updated,
    ...(published ? { warning: 'Changes are saved here only. Ads that are already live on the platforms are not modified.' } : {}),
  });
});

// Delete
campaigns.delete('/:id', async (c) => {
  const { campaign, response } = await loadOwned(c);
  if (response) return response;

  // Deleting the record would orphan ads that keep spending money on the platforms
  if (campaign.status === 'active' || campaign.status === 'publishing') {
    return c.json({ error: 'Pause the campaign before deleting it, so no ads keep running on the platforms.' }, 409);
  }

  await new Campaign(c.env.DB).delete(campaign.id);
  await new Log(c.env.DB).info('Campaign deleted', { campaignId: campaign.id, title: campaign.title }, c.get('userId'));

  const leftovers = campaign.platforms.some((p) => p.status === 'success');
  return c.json({
    message: 'Campaign deleted successfully',
    ...(leftovers ? { warning: 'Paused ads may still exist in your ad accounts. Remove them there if you no longer need them.' } : {}),
  });
});

// Publish: creates the campaign on every selected platform (asynchronously, via the queue)
campaigns.post('/:id/publish', async (c) => {
  const { campaign, response } = await loadOwned(c);
  if (response) return response;

  if (campaign.status === 'publishing') return c.json({ error: 'This campaign is already being published' }, 409);

  const missing = [
    ['headline', campaign.headline],
    ['ad text', campaign.ad_copy],
    ['destination URL', campaign.destination_url],
  ].filter(([, value]) => !value).map(([label]) => label);
  if (missing.length > 0) {
    return c.json({ error: `Complete the creative first: missing ${missing.join(', ')}` }, 400);
  }

  const targets = campaign.platforms.filter((p) => p.status !== 'success');
  if (campaign.platforms.length === 0) return c.json({ error: 'The campaign has no platforms' }, 400);
  if (targets.length === 0) return c.json({ error: 'The campaign is already published on all its platforms' }, 409);

  const { results: connected } = await c.env.DB.prepare(
    `SELECT id, name FROM platforms WHERE user_id = ? AND is_connected = 1 AND id IN (${placeholders(targets)})`
  ).bind(c.get('userId'), ...targets.map((p) => p.platformId)).all();
  const connectedIds = new Set(connected.map((p) => p.id));
  const disconnected = targets.filter((p) => !connectedIds.has(p.platformId)).map((p) => p.platformName);
  if (disconnected.length > 0) {
    return c.json({ error: `Reconnect these platforms first: ${disconnected.join(', ')}` }, 400);
  }

  const platformIds = targets.map((p) => p.platformId);
  await c.env.DB.prepare(
    `UPDATE campaign_platforms SET status = 'pending', error_message = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE campaign_id = ? AND platform_id IN (${placeholders(platformIds)})`
  ).bind(campaign.id, ...platformIds).run();
  await new Campaign(c.env.DB).setStatus(campaign.id, 'publishing');

  let jobs;
  try {
    jobs = await queueJobs(c, campaign.id, platformIds, 'publish');
  } catch (error) {
    await new Campaign(c.env.DB).setStatus(campaign.id, 'draft');
    console.error('Queueing publish jobs failed:', error);
    return c.json({ error: 'Could not start publishing. Please try again.' }, 503);
  }

  await new Log(c.env.DB).info('Campaign publish started', { campaignId: campaign.id, platforms: platformIds.length }, c.get('userId'), campaign.id);

  return c.json({
    message: campaign.publish_paused
      ? 'Publishing started. Ads are created paused on the platforms; activate them when ready.'
      : 'Publishing started.',
    jobs: jobs.map((j) => ({ id: j.id, platformId: j.platformId })),
  }, 202);
});

// Activate / pause what was published (turns the real ads on or off)
for (const [action, status] of [['activate', 'active'], ['pause', 'paused']]) {
  campaigns.post(`/:id/${action}`, async (c) => {
    const { campaign, response } = await loadOwned(c);
    if (response) return response;

    if (campaign.status === 'publishing') return c.json({ error: 'The campaign is still being published' }, 409);
    const published = campaign.platforms.filter((p) => p.status === 'success');
    if (published.length === 0) return c.json({ error: 'Publish the campaign first' }, 400);

    const jobs = await queueJobs(c, campaign.id, published.map((p) => p.platformId), 'set_status', { status });
    await new Log(c.env.DB).info(`Campaign ${action} requested`, { campaignId: campaign.id }, c.get('userId'), campaign.id);
    return c.json({ message: `${action === 'activate' ? 'Activation' : 'Pause'} requested`, jobs: jobs.map((j) => ({ id: j.id, platformId: j.platformId })) }, 202);
  });
}

// Pull fresh performance numbers now
campaigns.post('/:id/sync-metrics', async (c) => {
  const { campaign, response } = await loadOwned(c);
  if (response) return response;
  const queued = await enqueueMetricsSync(c.env, { userId: c.get('userId'), campaignId: campaign.id });
  return c.json({ queued }, 202);
});

// Duplicate
campaigns.post('/:id/duplicate', validateJson(campaignDuplicateSchema), async (c) => {
  const { campaign, response } = await loadOwned(c);
  if (response) return response;

  const copy = await new Campaign(c.env.DB).duplicate(campaign.id, c.get('body').newTitle);
  await new Log(c.env.DB).info('Campaign duplicated', { originalId: campaign.id, newId: copy.id }, c.get('userId'), copy.id);
  return c.json({ campaign: copy }, 201);
});

// Media attached to a campaign
campaigns.get('/:id/media', async (c) => {
  const { campaign, response } = await loadOwned(c);
  if (response) return response;
  const media = (await new Campaign(c.env.DB).getMedia(campaign.id)).map(({ r2_key, ...rest }) => rest);
  return c.json({ media });
});

export { campaigns as campaignRoutes };
