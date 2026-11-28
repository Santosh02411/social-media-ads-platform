import type { CallToAction, Objective } from '../validation/schemas';
import type { PlatformRecord, Targeting } from '../types';

export interface AdMedia {
  id: string;
  kind: 'image' | 'video';
  mimeType: string;
  name: string;
  getBytes(): Promise<ArrayBuffer>;
  publicUrl(): Promise<string>;
}

/** Platform-neutral description of an ad; each adapter translates it for its API. */
export interface Ad {
  name: string;
  objective: Objective;
  budget: { amount: number; type: 'daily' | 'lifetime' }; // major currency units
  schedule: { start: string | null; end: string | null }; // ISO timestamps
  targeting: Targeting;
  creative: {
    headline: string | null;
    body: string | null;
    url: string | null;
    cta: CallToAction;
    headlines: string[];
    descriptions: string[];
  };
  media: AdMedia[];
  startPaused: boolean;
}

/** Ids of the objects created on the platform so far (lets a retry resume instead of duplicating). */
export type ExternalState = Record<string, string | undefined>;

export interface PublishContext {
  state?: ExternalState;
  saveState?: (state: ExternalState) => Promise<void>;
}

export interface PublishResult {
  externalId: string;
  externalRef: ExternalState;
}

export interface InsightRow {
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
}

export interface AccountInfo {
  accountName: string | null;
  currency: string | null;
}

export interface AccountOption {
  id: string;
  name: string;
  currency?: string | null;
}

export interface PageOption {
  id: string;
  name: string;
  instagramUserId: string | null;
  instagramUsername: string | null;
}

export interface AccountOptions {
  accounts: AccountOption[];
  pages?: PageOption[];
}

export type AdapterPlatform = Pick<PlatformRecord, 'type' | 'name' | 'config'> & Partial<PlatformRecord>;
