import { BaseAdapter, requireFields } from '../BaseAdapter';
import { httpRequest, PlatformError, type ApiJson } from '../http';
import { tiktokLocationId } from '../../utils/countries';
import type {
  Ad,
  AccountInfo,
  AccountOptions,
  ExternalState,
  InsightRow,
  PublishContext,
  PublishResult,
} from '../types';

const OBJECTIVES = {
  TRAFFIC: { objective: 'TRAFFIC', optimizationGoal: 'CLICK', billingEvent: 'CPC' },
  AWARENESS: { objective: 'REACH', optimizationGoal: 'REACH', billingEvent: 'CPM' },
} as const;
// TikTok spells a couple of call-to-action values differently
const CTA: Record<string, string> = { DOWNLOAD: 'DOWNLOAD_NOW' };

// TikTok error codes that are worth retrying / mean the token is bad
const RATE_LIMIT_CODES = new Set([40100]);
const AUTH_CODES = new Set([40101, 40102, 40104, 40105, 40106]);

const tiktokTime = (iso: string) => new Date(iso).toISOString().replace('T', ' ').slice(0, 19); // UTC "YYYY-MM-DD HH:MM:SS"

interface ApiOptions {
  method?: string;
  json?: unknown;
  query?: Record<string, string | number | undefined>;
}

/**
 * TikTok ads through the TikTok Business (Marketing) API v1.3.
 * TikTok answers HTTP 200 even for failures, so success is `code === 0` in the body.
 * Video ads need a video + cover image; media is handed over by (signed) URL.
 */
export class TikTokAdapter extends BaseAdapter {
  private get advertiserId() {
    return String(this.cfg.accountId || '');
  }

  private async api<T = ApiJson>(
    path: string,
    { method = 'POST', json, query }: ApiOptions = {},
  ): Promise<T> {
    const body = await httpRequest<ApiJson>(`${this.endpoints.tiktok}${path}`, {
      method,
      headers: { 'Access-Token': this.cfg.accessToken || '' },
      json,
      query,
      platform: 'tiktok',
    });
    if (body.code !== 0) {
      const retryable = RATE_LIMIT_CODES.has(body.code) || (body.code >= 50000 && body.code < 60000);
      const auth = AUTH_CODES.has(body.code);
      throw new PlatformError(
        auth
          ? 'The TikTok access token is invalid or expired. Reconnect the platform.'
          : body.message || 'TikTok API error',
        {
          platform: 'tiktok',
          code: auth
            ? 'AUTH_FAILED'
            : RATE_LIMIT_CODES.has(body.code)
              ? 'RATE_LIMITED'
              : retryable
                ? 'TEMPORARY_FAILURE'
                : 'PLATFORM_ERROR',
          retryable,
          body,
        },
      );
    }
    return (body.data || {}) as T;
  }

  async validateCredentials(): Promise<AccountInfo> {
    requireFields('TikTok', [['advertiser id', this.advertiserId]]);
    const data = await this.api<{ list?: { name: string; currency?: string }[] }>('/advertiser/info/', {
      method: 'GET',
      query: {
        advertiser_ids: JSON.stringify([this.advertiserId]),
        fields: JSON.stringify(['name', 'status', 'currency']),
      },
    });
    const info = (data.list || [])[0];
    if (!info)
      throw new PlatformError('TikTok advertiser not found for this token', {
        platform: 'tiktok',
        code: 'AUTH_FAILED',
      });
    return { accountName: info.name, currency: info.currency || null };
  }

  async listAccounts(): Promise<AccountOptions> {
    // TikTok documents app_id/secret as query parameters for this one endpoint
    const data = await this.api<{ list?: { advertiser_id: string | number; advertiser_name?: string }[] }>(
      '/oauth2/advertiser/get/',
      {
        method: 'GET',
        query: { app_id: this.env.TIKTOK_APP_ID, secret: this.env.TIKTOK_APP_SECRET },
      },
    );
    return {
      accounts: (data.list || []).map((a) => ({
        id: String(a.advertiser_id),
        name: a.advertiser_name || String(a.advertiser_id),
      })),
    };
  }

  async publishAd(
    ad: Ad,
    { state = {}, saveState = async () => {} }: PublishContext = {},
  ): Promise<PublishResult> {
    const video = ad.media.find((m) => m.kind === 'video');
    requireFields('TikTok', [
      ['advertiser id (reconnect and pick one)', this.advertiserId],
      ['a video (TikTok ads need video media)', video],
      ['destination URL', ad.creative.url],
      ['ad text', ad.creative.body],
    ]);
    if (!video) return { externalId: '', externalRef: state }; // unreachable: requireFields throws

    const goal = OBJECTIVES[ad.objective] ?? OBJECTIVES.TRAFFIC;
    const operationStatus = ad.startPaused ? 'DISABLE' : 'ENABLE';
    const advertiser_id = this.advertiserId;

    // 1. Campaign (budget is set on the ad group)
    if (!state.campaignId) {
      const campaign = await this.api<{ campaign_id: string }>('/campaign/create/', {
        json: {
          advertiser_id,
          campaign_name: ad.name,
          objective_type: goal.objective,
          budget_mode: 'BUDGET_MODE_INFINITE',
          operation_status: operationStatus,
        },
      });
      state.campaignId = campaign.campaign_id;
      await saveState(state);
    }

    // 2. Video upload by URL, then a suggested cover image
    if (!state.videoId) {
      const upload = await this.api<{ video_id?: string }[] | { video_id?: string }>(
        '/file/video/ad/upload/',
        {
          json: {
            advertiser_id,
            upload_type: 'UPLOAD_BY_URL',
            video_url: await video.publicUrl(),
            file_name: `${ad.name}-${video.id}`.slice(0, 80),
          },
        },
      );
      state.videoId = Array.isArray(upload) ? upload[0]?.video_id : upload.video_id;
      if (!state.videoId) throw new PlatformError('TikTok did not return a video id', { platform: 'tiktok' });
      await saveState(state);
    }
    if (!state.coverImageId) {
      const suggestions = await this.api<{ list?: { url: string }[] }>('/file/video/suggestcover/get/', {
        method: 'GET',
        query: { advertiser_id, video_id: state.videoId },
      });
      const coverUrl = (suggestions.list || [])[0]?.url;
      if (!coverUrl) {
        throw new PlatformError('TikTok could not generate a cover image for this video yet', {
          platform: 'tiktok',
          code: 'TEMPORARY_FAILURE',
          retryable: true,
        });
      }
      const image = await this.api<{ image_id: string }>('/file/image/ad/upload/', {
        json: {
          advertiser_id,
          upload_type: 'UPLOAD_BY_URL',
          image_url: coverUrl,
          file_name: `${ad.name}-cover`.slice(0, 80),
        },
      });
      state.coverImageId = image.image_id;
      await saveState(state);
    }

    // 3. Ad group: budget, schedule, location
    if (!state.adgroupId) {
      const lifetime = ad.budget.type === 'lifetime';
      const adgroup = await this.api<{ adgroup_id: string }>('/adgroup/create/', {
        json: {
          advertiser_id,
          campaign_id: state.campaignId,
          adgroup_name: `${ad.name} - ad group`,
          promotion_type: 'WEBSITE',
          placement_type: 'PLACEMENT_TYPE_NORMAL',
          placements: ['PLACEMENT_TIKTOK'],
          location_ids: ad.targeting.countries.map(tiktokLocationId),
          budget_mode: lifetime ? 'BUDGET_MODE_TOTAL' : 'BUDGET_MODE_DAY',
          budget: ad.budget.amount,
          schedule_type: ad.schedule.end ? 'SCHEDULE_START_END' : 'SCHEDULE_FROM_NOW',
          schedule_start_time: tiktokTime(ad.schedule.start || new Date().toISOString()),
          ...(ad.schedule.end ? { schedule_end_time: tiktokTime(ad.schedule.end) } : {}),
          optimization_goal: goal.optimizationGoal,
          billing_event: goal.billingEvent,
          bid_type: 'BID_TYPE_NO_BID',
          pacing: 'PACING_MODE_SMOOTH',
          operation_status: operationStatus,
        },
      });
      state.adgroupId = adgroup.adgroup_id;
      await saveState(state);
    }

    // 4. Identity the ad is shown as
    if (!state.identityId) {
      if (this.cfg.identityId) {
        state.identityId = this.cfg.identityId;
      } else {
        const identity = await this.api<{ identity_id: string }>('/identity/create/', {
          json: { advertiser_id, display_name: (this.platform.name || 'Advertiser').slice(0, 40) },
        });
        state.identityId = identity.identity_id;
      }
      await saveState(state);
    }

    // 5. Ad
    if (!state.adId) {
      const created = await this.api<{ ad_ids?: string[] }>('/ad/create/', {
        json: {
          advertiser_id,
          adgroup_id: state.adgroupId,
          creatives: [
            {
              ad_name: ad.name,
              identity_type: 'CUSTOMIZED_USER',
              identity_id: state.identityId,
              ad_format: 'SINGLE_VIDEO',
              video_id: state.videoId,
              image_ids: [state.coverImageId],
              ad_text: ad.creative.body,
              call_to_action: CTA[ad.creative.cta] || ad.creative.cta,
              landing_page_url: ad.creative.url,
            },
          ],
          operation_status: operationStatus,
        },
      });
      state.adId = (created.ad_ids || [])[0];
      if (!state.adId) throw new PlatformError('TikTok did not return an ad id', { platform: 'tiktok' });
      await saveState(state);
    }

    this.log('info', 'Published ad', { adId: state.adId });
    return { externalId: state.campaignId, externalRef: { ...state } };
  }

  async setStatus(ref: ExternalState, status: 'active' | 'paused'): Promise<void> {
    const operation_status = status === 'active' ? 'ENABLE' : 'DISABLE';
    const advertiser_id = this.advertiserId;
    if (ref.campaignId)
      await this.api('/campaign/status/update/', {
        json: { advertiser_id, campaign_ids: [ref.campaignId], operation_status },
      });
    if (ref.adgroupId)
      await this.api('/adgroup/status/update/', {
        json: { advertiser_id, adgroup_ids: [ref.adgroupId], operation_status },
      });
    if (ref.adId)
      await this.api('/ad/status/update/', { json: { advertiser_id, ad_ids: [ref.adId], operation_status } });
  }

  async getInsights(
    ref: ExternalState,
    { since, until }: { since: string; until: string },
  ): Promise<InsightRow[]> {
    if (!ref.campaignId) return [];
    const data = await this.api<{ list?: ApiJson[] }>('/report/integrated/get/', {
      method: 'GET',
      query: {
        advertiser_id: this.advertiserId,
        report_type: 'BASIC',
        data_level: 'AUCTION_CAMPAIGN',
        dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
        metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversion']),
        start_date: since,
        end_date: until,
        filtering: JSON.stringify([
          { field_name: 'campaign_ids', filter_type: 'IN', filter_value: JSON.stringify([ref.campaignId]) },
        ]),
        page_size: 200,
      },
    });
    return (data.list || []).map((row) => ({
      date: String(row.dimensions?.stat_time_day || '').slice(0, 10),
      impressions: Number(row.metrics?.impressions || 0),
      clicks: Number(row.metrics?.clicks || 0),
      spend: Number(row.metrics?.spend || 0),
      conversions: Number(row.metrics?.conversion || 0),
    }));
  }
}
