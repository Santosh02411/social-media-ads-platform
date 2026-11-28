import { BaseAdapter, requireFields } from '../BaseAdapter';
import { httpRequest, PlatformError, type ApiJson } from '../http';
import { bytesToBase64 } from '../../utils/crypto';
import type {
  Ad,
  AccountInfo,
  AccountOptions,
  ExternalState,
  InsightRow,
  PublishContext,
  PublishResult,
} from '../types';

// Currencies whose smallest unit is the whole unit (Meta budgets are in minor units)
const ZERO_DECIMAL = new Set([
  'JPY',
  'KRW',
  'VND',
  'CLP',
  'ISK',
  'PYG',
  'UGX',
  'XAF',
  'XOF',
  'XPF',
  'KMF',
  'GNF',
  'RWF',
  'DJF',
  'BIF',
  'VUV',
]);

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);
const AUTH_CODES = new Set([102, 190, 463, 467]);
const TEMPORARY_CODES = new Set([1, 2]);

const OBJECTIVES = {
  TRAFFIC: {
    objective: 'OUTCOME_TRAFFIC',
    optimizationGoal: 'LINK_CLICKS',
    destinationType: 'WEBSITE' as string | undefined,
  },
  AWARENESS: {
    objective: 'OUTCOME_AWARENESS',
    optimizationGoal: 'REACH',
    destinationType: undefined as string | undefined,
  },
} as const;

interface ApiOptions {
  method?: string;
  query?: Record<string, string | number | undefined>;
  json?: unknown;
}

interface IdResponse {
  id: string;
}

/**
 * Facebook ads through the Meta Marketing API.
 * Everything is created PAUSED unless the campaign asks otherwise.
 */
export class FacebookAdapter extends BaseAdapter {
  protected get publisherPlatforms(): string[] {
    return ['facebook'];
  }

  private get base() {
    return `${this.endpoints.metaGraph}/${this.endpoints.metaVersion}`;
  }

  private get accountPath() {
    return `/act_${String(this.cfg.accountId || '').replace(/^act_/, '')}`;
  }

  protected async api<T = ApiJson>(
    path: string,
    { method = 'GET', query, json }: ApiOptions = {},
  ): Promise<T> {
    try {
      return await httpRequest<T>(`${this.base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.cfg.accessToken}` },
        query,
        json,
        platform: this.platform.type,
      });
    } catch (error) {
      throw classifyMetaError(error);
    }
  }

  async validateCredentials(): Promise<AccountInfo> {
    const me = await this.api<{ id: string; name: string }>('/me', { query: { fields: 'id,name' } });
    if (!this.cfg.accountId) return { accountName: me.name, currency: null };

    const account = await this.api<{ name: string; account_status: number; currency: string }>(
      this.accountPath,
      {
        query: { fields: 'name,account_status,currency' },
      },
    );
    if (account.account_status !== 1) {
      throw new PlatformError(
        'This ad account is not active (check billing or restrictions in Meta Ads Manager)',
        {
          platform: this.platform.type,
          code: 'ACCOUNT_INACTIVE',
        },
      );
    }
    if (this.cfg.pageId) await this.api(`/${this.cfg.pageId}`, { query: { fields: 'id,name' } });
    return { accountName: account.name, currency: account.currency };
  }

  async listAccounts(): Promise<AccountOptions> {
    const [adAccounts, pages] = await Promise.all([
      this.api('/me/adaccounts', {
        query: { fields: 'account_id,name,account_status,currency', limit: 100 },
      }),
      this.api('/me/accounts', {
        query: { fields: 'id,name,instagram_business_account{id,username}', limit: 100 },
      }),
    ]);
    return {
      accounts: ((adAccounts.data || []) as ApiJson[])
        .filter((a) => a.account_status === 1)
        .map((a) => ({ id: a.account_id as string, name: a.name as string, currency: a.currency as string })),
      pages: ((pages.data || []) as ApiJson[]).map((p) => ({
        id: p.id as string,
        name: p.name as string,
        instagramUserId: (p.instagram_business_account?.id as string) || null,
        instagramUsername: (p.instagram_business_account?.username as string) || null,
      })),
    };
  }

  async publishAd(
    ad: Ad,
    { state = {}, saveState = async () => {} }: PublishContext = {},
  ): Promise<PublishResult> {
    requireFields('Facebook', [
      ['an ad account (reconnect and pick one)', this.cfg.accountId],
      ['a Facebook Page (reconnect and pick one)', this.cfg.pageId],
      ['destination URL', ad.creative.url],
      ['ad text', ad.creative.body],
    ]);

    // Meta ads use the first image; videos are ignored here (TikTok is the video platform)
    const image = ad.media.find((m) => m.kind === 'image');
    if (!image && ad.media.length > 0) {
      throw new PlatformError(
        'Meta ads need an image. Attach an image to this campaign (videos are not supported for Facebook/Instagram yet).',
        { platform: this.platform.type, code: 'INVALID_CREATIVE' },
      );
    }

    const goal = OBJECTIVES[ad.objective] ?? OBJECTIVES.TRAFFIC;
    const status = ad.startPaused ? 'PAUSED' : 'ACTIVE';
    const currency = this.cfg.currency || 'USD';
    const minor = ZERO_DECIMAL.has(currency) ? 1 : 100;

    // 1. Campaign
    if (!state.campaignId) {
      const campaign = await this.api<IdResponse>(`${this.accountPath}/campaigns`, {
        method: 'POST',
        json: {
          name: ad.name,
          objective: goal.objective,
          status,
          special_ad_categories: [],
          is_adset_budget_sharing_enabled: false,
        },
      });
      state.campaignId = campaign.id;
      await saveState(state);
    }

    // 2. Ad set (budget, schedule and targeting live here)
    if (!state.adSetId) {
      const budgetField = ad.budget.type === 'lifetime' ? 'lifetime_budget' : 'daily_budget';
      const adSet = await this.api<IdResponse>(`${this.accountPath}/adsets`, {
        method: 'POST',
        json: {
          name: `${ad.name} - ad set`,
          campaign_id: state.campaignId,
          [budgetField]: Math.round(ad.budget.amount * minor),
          billing_event: 'IMPRESSIONS',
          optimization_goal: goal.optimizationGoal,
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          ...(goal.destinationType ? { destination_type: goal.destinationType } : {}),
          start_time: ad.schedule.start || undefined,
          end_time: ad.schedule.end || undefined,
          targeting: {
            geo_locations: { countries: ad.targeting.countries },
            age_min: ad.targeting.ageMin,
            age_max: ad.targeting.ageMax,
            publisher_platforms: this.publisherPlatforms,
          },
          status,
        },
      });
      state.adSetId = adSet.id;
      await saveState(state);
    }

    // 3. Image upload (bytes come from our R2 bucket)
    if (!state.imageHash && image) {
      const bytes = await image.getBytes();
      const upload = await this.api<{ images?: Record<string, { hash?: string }> }>(
        `${this.accountPath}/adimages`,
        {
          method: 'POST',
          json: { bytes: bytesToBase64(new Uint8Array(bytes)) },
        },
      );
      const first = Object.values(upload.images || {})[0];
      if (!first?.hash)
        throw new PlatformError('Meta did not return an image hash', { platform: this.platform.type });
      state.imageHash = first.hash;
      await saveState(state);
    }

    // 4. Creative: current object_story_spec format (needs a Page)
    if (!state.creativeId) {
      const link = ad.creative.url;
      const creative = await this.api<IdResponse>(`${this.accountPath}/adcreatives`, {
        method: 'POST',
        json: {
          name: `${ad.name} - creative`,
          object_story_spec: {
            page_id: this.cfg.pageId,
            ...this.creativeIdentity(),
            link_data: {
              link,
              message: ad.creative.body,
              name: ad.creative.headline,
              call_to_action: { type: ad.creative.cta, value: { link } },
              ...(state.imageHash ? { image_hash: state.imageHash } : {}),
            },
          },
        },
      });
      state.creativeId = creative.id;
      await saveState(state);
    }

    // 5. Ad
    if (!state.adId) {
      const created = await this.api<IdResponse>(`${this.accountPath}/ads`, {
        method: 'POST',
        json: {
          name: `${ad.name} - ad`,
          adset_id: state.adSetId,
          creative: { creative_id: state.creativeId },
          status,
        },
      });
      state.adId = created.id;
      await saveState(state);
    }

    this.log('info', 'Published ad', { adId: state.adId });
    return { externalId: state.adId, externalRef: { ...state } };
  }

  /** Overridden by Instagram to attach the Instagram account. */
  protected creativeIdentity(): Record<string, string | undefined> {
    return {};
  }

  async setStatus(ref: ExternalState, status: 'active' | 'paused'): Promise<void> {
    const value = status === 'active' ? 'ACTIVE' : 'PAUSED';
    // Campaign, ad set and ad must all agree for the ad to deliver (or stop)
    for (const id of [ref.campaignId, ref.adSetId, ref.adId]) {
      if (id) await this.api(`/${id}`, { method: 'POST', json: { status: value } });
    }
  }

  async getInsights(
    ref: ExternalState,
    { since, until }: { since: string; until: string },
  ): Promise<InsightRow[]> {
    if (!ref.campaignId) return [];
    const result = await this.api(`/${ref.campaignId}/insights`, {
      query: {
        fields: 'impressions,clicks,spend,actions',
        time_increment: 1,
        time_range: JSON.stringify({ since, until }),
        limit: 500,
      },
    });
    const conversionTypes = new Set([
      'purchase',
      'lead',
      'complete_registration',
      'offsite_conversion.fb_pixel_purchase',
    ]);
    return ((result.data || []) as ApiJson[]).map((row) => ({
      date: row.date_start as string,
      impressions: Number(row.impressions || 0),
      clicks: Number(row.clicks || 0),
      spend: Number(row.spend || 0),
      conversions: ((row.actions || []) as ApiJson[])
        .filter((a) => conversionTypes.has(a.action_type))
        .reduce((sum: number, a) => sum + Number(a.value || 0), 0),
    }));
  }
}

function classifyMetaError(error: unknown): unknown {
  if (!(error instanceof PlatformError)) return error;
  const code: number | undefined = error.body?.error?.code;
  if (code !== undefined && (RATE_LIMIT_CODES.has(code) || (code >= 80000 && code <= 80014))) {
    error.code = 'RATE_LIMITED';
    error.retryable = true;
  } else if (code !== undefined && AUTH_CODES.has(code)) {
    error.code = 'AUTH_FAILED';
    error.retryable = false;
    error.message = 'The Meta access token is invalid or expired. Reconnect the platform.';
  } else if (code !== undefined && TEMPORARY_CODES.has(code)) {
    error.code = 'TEMPORARY_FAILURE';
    error.retryable = true;
  }
  return error;
}
