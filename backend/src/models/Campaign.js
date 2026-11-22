const parseJson = (value, fallback) => {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};

const rows = (result) => result.results || [];

export class Campaign {
  constructor(db) {
    this.db = db;
  }

  /** Converts a DB row into the API shape (JSON columns parsed). */
  static hydrate(row) {
    if (!row) return row;
    const out = {
      ...row,
      targeting: parseJson(row.targeting, { countries: ['US'], ageMin: 18, ageMax: 65, keywords: [] }),
      variants: parseJson(row.variants, { headlines: [], descriptions: [] }),
      publish_paused: Boolean(row.publish_paused),
    };
    if (typeof row.platforms === 'string') {
      // json_group_array yields one all-null entry when there are no platforms
      out.platforms = parseJson(row.platforms, []).filter((p) => p.id);
    }
    return out;
  }

  async create(data, userId) {
    const campaignId = crypto.randomUUID();

    await this.db.prepare(`
      INSERT INTO campaigns
        (id, title, description, budget, budget_type, objective, schedule_start, schedule_end,
         destination_url, headline, ad_copy, call_to_action, targeting, variants, publish_paused, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      campaignId,
      data.title,
      data.description ?? null,
      data.budget,
      data.budgetType,
      data.objective,
      data.scheduleStart ?? null,
      data.scheduleEnd ?? null,
      data.destinationUrl ?? null,
      data.headline ?? null,
      data.adCopy ?? null,
      data.callToAction,
      JSON.stringify(data.targeting),
      data.variants ? JSON.stringify(data.variants) : null,
      data.publishPaused ? 1 : 0,
      userId
    ).run();

    for (const platformId of data.platforms || []) {
      await this.db.prepare('INSERT INTO campaign_platforms (id, campaign_id, platform_id) VALUES (?, ?, ?)')
        .bind(crypto.randomUUID(), campaignId, platformId).run();
    }
    for (const mediaId of data.mediaIds || []) {
      await this.linkMedia(campaignId, mediaId);
    }

    return this.findById(campaignId);
  }

  async findById(campaignId) {
    const row = await this.db.prepare(`
      SELECT c.*,
             json_group_array(
               json_object(
                 'id', cp.id,
                 'platformId', cp.platform_id,
                 'platformName', p.name,
                 'platformType', p.type,
                 'status', cp.status,
                 'errorMessage', cp.error_message,
                 'retryCount', cp.retry_count,
                 'externalId', cp.external_id,
                 'publishedAt', cp.published_at
               )
             ) as platforms
      FROM campaigns c
      LEFT JOIN campaign_platforms cp ON c.id = cp.campaign_id
      LEFT JOIN platforms p ON cp.platform_id = p.id
      WHERE c.id = ?
      GROUP BY c.id
    `).bind(campaignId).first();
    return Campaign.hydrate(row);
  }

  async findByUserId(userId, limit = 50, offset = 0) {
    const result = await this.db.prepare(`
      SELECT c.*,
             COUNT(cp.id) as platform_count,
             SUM(CASE WHEN cp.status = 'success' THEN 1 ELSE 0 END) as success_count,
             SUM(CASE WHEN cp.status = 'failed' THEN 1 ELSE 0 END) as failed_count
      FROM campaigns c
      LEFT JOIN campaign_platforms cp ON c.id = cp.campaign_id
      WHERE c.user_id = ?
      GROUP BY c.id
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(userId, limit, offset).all();
    return rows(result).map(Campaign.hydrate);
  }

  /** Applies only the provided fields. */
  async update(campaignId, patch) {
    const columns = {
      title: ['title', (v) => v],
      description: ['description', (v) => v ?? null],
      budget: ['budget', (v) => v],
      budgetType: ['budget_type', (v) => v],
      objective: ['objective', (v) => v],
      scheduleStart: ['schedule_start', (v) => v ?? null],
      scheduleEnd: ['schedule_end', (v) => v ?? null],
      destinationUrl: ['destination_url', (v) => v],
      headline: ['headline', (v) => v],
      adCopy: ['ad_copy', (v) => v],
      callToAction: ['call_to_action', (v) => v],
      targeting: ['targeting', (v) => JSON.stringify(v)],
      variants: ['variants', (v) => JSON.stringify(v)],
      publishPaused: ['publish_paused', (v) => (v ? 1 : 0)],
    };

    const sets = [];
    const values = [];
    for (const [key, [column, convert]] of Object.entries(columns)) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        sets.push(`${column} = ?`);
        values.push(convert(patch[key]));
      }
    }

    if (sets.length > 0) {
      await this.db.prepare(`UPDATE campaigns SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(...values, campaignId).run();
    }
    if (Array.isArray(patch.mediaIds)) {
      await this.db.prepare('DELETE FROM campaign_media WHERE campaign_id = ?').bind(campaignId).run();
      for (const mediaId of patch.mediaIds) await this.linkMedia(campaignId, mediaId);
    }

    return this.findById(campaignId);
  }

  async setStatus(campaignId, status) {
    await this.db.prepare('UPDATE campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(status, campaignId).run();
  }

  async delete(campaignId) {
    // campaign_platforms, campaign_media, jobs and metrics are removed by ON DELETE CASCADE
    await this.db.prepare('DELETE FROM campaigns WHERE id = ?').bind(campaignId).run();
  }

  async linkMedia(campaignId, mediaId) {
    const media = await this.db.prepare('SELECT mime_type FROM media WHERE id = ?').bind(mediaId).first();
    const type = media?.mime_type?.startsWith('video/') ? 'video' : media?.mime_type?.startsWith('image/') ? 'image' : 'text';
    await this.db.prepare('INSERT INTO campaign_media (id, campaign_id, media_id, media_type) VALUES (?, ?, ?, ?)')
      .bind(crypto.randomUUID(), campaignId, mediaId, type).run();
  }

  async getMedia(campaignId) {
    const result = await this.db.prepare(`
      SELECT cm.media_type, m.id, m.filename, m.original_name, m.mime_type, m.size, m.url, m.r2_key
      FROM campaign_media cm
      JOIN media m ON cm.media_id = m.id
      WHERE cm.campaign_id = ?
      ORDER BY cm.created_at ASC
    `).bind(campaignId).all();
    return rows(result);
  }

  async duplicate(campaignId, newTitle) {
    const original = await this.findById(campaignId);
    if (!original) throw new Error('Campaign not found');

    const media = await this.getMedia(campaignId);
    return this.create({
      title: newTitle,
      description: original.description,
      budget: original.budget,
      budgetType: original.budget_type,
      objective: original.objective,
      scheduleStart: original.schedule_start,
      scheduleEnd: original.schedule_end,
      destinationUrl: original.destination_url,
      headline: original.headline,
      adCopy: original.ad_copy,
      callToAction: original.call_to_action,
      targeting: original.targeting,
      variants: original.variants,
      publishPaused: original.publish_paused,
      platforms: original.platforms.map((p) => p.platformId),
      mediaIds: media.map((m) => m.id),
    }, original.user_id);
  }
}
