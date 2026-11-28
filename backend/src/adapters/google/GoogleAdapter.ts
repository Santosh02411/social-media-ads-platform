import { BaseAdapter, requireFields, daysBetweenInclusive, toIsoDate } from '../BaseAdapter';
import { httpRequest, PlatformError, type ApiJson } from '../http';
import { googleGeoTarget } from '../../utils/countries';
import type {
  Ad,
  AccountInfo,
  AccountOptions,
  ExternalState,
  InsightRow,
  PublishContext,
  PublishResult,
} from '../types';

interface ApiOptions {
  method?: string;
  json?: unknown;
  query?: Record<string, string | number | undefined>;
}

/**
 * Google Ads (Search + responsive search ad) through the Google Ads REST API.
 *
 * Needs, besides the user's OAuth refresh token:
 *  - a developer token (the app owner's; GOOGLE_ADS_DEVELOPER_TOKEN, or per platform)
 *  - the OAuth client id/secret that issued the refresh token
 * Publishing is ONE atomic GoogleAdsService.Mutate call, so a failure leaves
 * nothing half-created.
 */
export class GoogleAdapter extends BaseAdapter {
  private token?: string;

  private get customerId() {
    return String(this.cfg.accountId || '').replace(/-/g, '');
  }

  private get base() {
    return `${this.endpoints.googleAds}/${this.endpoints.googleAdsVersion}`;
  }

  private get developerToken() {
    return this.cfg.developerToken || this.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  }

  private async accessToken(): Promise<string> {
    if (this.token) return this.token;
    const clientId = this.cfg.clientId || this.env.GOOGLE_CLIENT_ID;
    const clientSecret = this.cfg.clientSecret || this.env.GOOGLE_CLIENT_SECRET;
    if (!this.cfg.refreshToken || !clientId || !clientSecret) {
      throw new PlatformError('Google credentials are incomplete. Reconnect the platform.', {
        platform: 'google',
        code: 'AUTH_FAILED',
      });
    }
    try {
      const res = await httpRequest<{ access_token: string }>(this.endpoints.googleOAuthToken, {
        method: 'POST',
        form: {
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: this.cfg.refreshToken,
          grant_type: 'refresh_token',
        },
        platform: 'google',
      });
      this.token = res.access_token;
      return this.token;
    } catch (error) {
      if (error instanceof PlatformError && (error.status === 400 || error.status === 401)) {
        error.code = 'AUTH_FAILED';
        error.retryable = false;
        error.message = 'Google rejected the refresh token. Reconnect the platform.';
      }
      throw error;
    }
  }

  private async api<T = ApiJson>(
    path: string,
    { method = 'POST', json, query }: ApiOptions = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.accessToken()}`,
      'developer-token': this.developerToken || '',
    };
    if (this.cfg.loginCustomerId)
      headers['login-customer-id'] = String(this.cfg.loginCustomerId).replace(/-/g, '');
    try {
      return await httpRequest<T>(`${this.base}${path}`, {
        method,
        headers,
        json,
        query,
        platform: 'google',
      });
    } catch (error) {
      if (error instanceof PlatformError && error.body?.error?.status === 'RESOURCE_EXHAUSTED') {
        error.code = 'RATE_LIMITED';
        error.retryable = true;
      }
      throw error;
    }
  }

  private async search(query: string): Promise<ApiJson[]> {
    const rows: ApiJson[] = [];
    let pageToken: string | undefined;
    do {
      const res: ApiJson = await this.api(`/customers/${this.customerId}/googleAds:search`, {
        json: { query, pageToken },
      });
      rows.push(...(res.results || []));
      pageToken = res.nextPageToken;
    } while (pageToken && rows.length < 20000);
    return rows;
  }

  async validateCredentials(): Promise<AccountInfo> {
    requireFields('Google Ads', [['customer id', this.customerId]]);
    const [row] = await this.search(
      'SELECT customer.id, customer.descriptive_name, customer.currency_code FROM customer LIMIT 1',
    );
    return {
      accountName: row?.customer?.descriptiveName || this.customerId,
      currency: row?.customer?.currencyCode || null,
    };
  }

  async listAccounts(): Promise<AccountOptions> {
    const res = await this.api<{ resourceNames?: string[] }>('/customers:listAccessibleCustomers', {
      method: 'GET',
    });
    return {
      accounts: (res.resourceNames || []).map((name) => {
        const id = name.split('/')[1];
        return { id, name: id };
      }),
    };
  }

  async publishAd(
    ad: Ad,
    { state = {}, saveState = async () => {} }: PublishContext = {},
  ): Promise<PublishResult> {
    // The shared headline / primary text may be longer than Google allows: leave those out
    // instead of failing, as long as enough valid variants remain.
    const fits =
      (max: number) =>
      (text: string | null | undefined): text is string =>
        !!text && text.length <= max;
    const uniqueHeadlines = [
      ...new Set([ad.creative.headline, ...ad.creative.headlines].filter(fits(30))),
    ].slice(0, 15);
    const uniqueDescriptions = [
      ...new Set([ad.creative.body, ...ad.creative.descriptions].filter(fits(90))),
    ].slice(0, 4);

    requireFields('Google Ads', [
      ['customer id (reconnect and pick an account)', this.customerId],
      ['destination URL', ad.creative.url],
      ['at least one keyword (Google Search ads are keyword-based)', ad.targeting.keywords.length],
    ]);
    if (uniqueHeadlines.length < 3 || uniqueDescriptions.length < 2) {
      throw new PlatformError(
        'Google responsive search ads need at least 3 distinct headlines (max 30 characters) and 2 descriptions (max 90). Use AI Generate or add more variants.',
        { platform: 'google', code: 'INVALID_CREATIVE' },
      );
    }

    // Already created by an earlier attempt? Nothing more to do.
    if (state.campaign) return { externalId: state.campaign, externalRef: { ...state } };

    // Google budgets are always per day: spread a lifetime budget over the run
    let dailyBudget = ad.budget.amount;
    if (ad.budget.type === 'lifetime') {
      if (!ad.schedule.start || !ad.schedule.end) {
        throw new PlatformError('A lifetime budget needs a start and end date.', {
          platform: 'google',
          code: 'INVALID_CREATIVE',
        });
      }
      dailyBudget = ad.budget.amount / daysBetweenInclusive(ad.schedule.start, ad.schedule.end);
    }

    const c = this.customerId;
    const budgetName = `customers/${c}/campaignBudgets/-1`;
    const campaignName = `customers/${c}/campaigns/-2`;
    const adGroupName = `customers/${c}/adGroups/-3`;
    const status = ad.startPaused ? 'PAUSED' : 'ENABLED';

    const operations = [
      {
        campaignBudgetOperation: {
          create: {
            resourceName: budgetName,
            name: `${ad.name} budget ${Date.now()}`,
            amountMicros: String(Math.round(dailyBudget * 1e6)),
            deliveryMethod: 'STANDARD',
            explicitlyShared: false,
          },
        },
      },
      {
        campaignOperation: {
          create: {
            resourceName: campaignName,
            name: ad.name,
            advertisingChannelType: 'SEARCH',
            status,
            manualCpc: {},
            campaignBudget: budgetName,
            networkSettings: {
              targetGoogleSearch: true,
              targetSearchNetwork: true,
              targetContentNetwork: false,
            },
            containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
            ...(ad.schedule.start ? { startDate: toIsoDate(ad.schedule.start) } : {}),
            ...(ad.schedule.end ? { endDate: toIsoDate(ad.schedule.end) } : {}),
          },
        },
      },
      ...ad.targeting.countries.map((code) => ({
        campaignCriterionOperation: {
          create: { campaign: campaignName, location: { geoTargetConstant: googleGeoTarget(code) } },
        },
      })),
      {
        adGroupOperation: {
          create: {
            resourceName: adGroupName,
            name: `${ad.name} - ad group`,
            campaign: campaignName,
            type: 'SEARCH_STANDARD',
            status: 'ENABLED',
            cpcBidMicros: '1000000',
          },
        },
      },
      ...ad.targeting.keywords.map((text) => ({
        adGroupCriterionOperation: {
          create: { adGroup: adGroupName, status: 'ENABLED', keyword: { text, matchType: 'PHRASE' } },
        },
      })),
      {
        adGroupAdOperation: {
          create: {
            adGroup: adGroupName,
            status: 'ENABLED',
            ad: {
              finalUrls: [ad.creative.url],
              responsiveSearchAd: {
                headlines: uniqueHeadlines.map((text) => ({ text })),
                descriptions: uniqueDescriptions.map((text) => ({ text })),
              },
            },
          },
        },
      },
    ];

    const result = await this.api<{ mutateOperationResponses?: ApiJson[] }>(
      `/customers/${c}/googleAds:mutate`,
      {
        json: { mutateOperations: operations, partialFailure: false },
      },
    );
    const responses = result.mutateOperationResponses || [];
    const find = (key: string): string | undefined => responses.find((r) => r[key])?.[key]?.resourceName;

    state.campaign = find('campaignResult');
    state.budget = find('campaignBudgetResult');
    state.adGroup = find('adGroupResult');
    state.ad = find('adGroupAdResult');
    if (!state.campaign)
      throw new PlatformError('Google did not return a campaign resource name', { platform: 'google' });
    await saveState(state);

    this.log('info', 'Published campaign', { campaign: state.campaign });
    return { externalId: state.campaign, externalRef: { ...state } };
  }

  async setStatus(ref: ExternalState, status: 'active' | 'paused'): Promise<void> {
    if (!ref.campaign) return;
    await this.api(`/customers/${this.customerId}/campaigns:mutate`, {
      json: {
        operations: [
          {
            updateMask: 'status',
            update: { resourceName: ref.campaign, status: status === 'active' ? 'ENABLED' : 'PAUSED' },
          },
        ],
      },
    });
  }

  async getInsights(
    ref: ExternalState,
    { since, until }: { since: string; until: string },
  ): Promise<InsightRow[]> {
    if (!ref.campaign) return [];
    const rows = await this.search(
      `SELECT segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ` +
        `FROM campaign WHERE campaign.resource_name = '${ref.campaign.replace(/'/g, '')}' ` +
        `AND segments.date BETWEEN '${since}' AND '${until}'`,
    );
    return rows.map((r) => ({
      date: r.segments.date as string,
      impressions: Number(r.metrics.impressions || 0),
      clicks: Number(r.metrics.clicks || 0),
      spend: Number(r.metrics.costMicros || 0) / 1e6,
      conversions: Number(r.metrics.conversions || 0),
    }));
  }
}
