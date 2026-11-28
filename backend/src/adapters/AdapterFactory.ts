import type { Env, PlatformType } from '../types';
import type { BaseAdapter } from './BaseAdapter';
import type { AdapterPlatform } from './types';
import { FacebookAdapter } from './facebook/FacebookAdapter';
import { GoogleAdapter } from './google/GoogleAdapter';
import { TikTokAdapter } from './tiktok/TikTokAdapter';
import { InstagramAdapter } from './instagram/InstagramAdapter';

type AdapterConstructor = new (platform: AdapterPlatform, env: Env) => BaseAdapter;

const ADAPTERS: Record<PlatformType, AdapterConstructor> = {
  facebook: FacebookAdapter,
  instagram: InstagramAdapter,
  google: GoogleAdapter,
  tiktok: TikTokAdapter,
};

export const SUPPORTED_PLATFORMS = Object.keys(ADAPTERS) as PlatformType[];

/**
 * Creates the adapter for a platform row.
 * `platform.config` must already be decrypted (see the Platform model / decryptJson).
 */
export const adapterFactory = {
  create(platform: AdapterPlatform, env: Env): BaseAdapter {
    const AdapterClass = ADAPTERS[platform.type];
    if (!AdapterClass) throw new Error(`Unsupported platform type: ${platform.type}`);
    return new AdapterClass(platform, env);
  },
};
