import { FacebookAdapter } from './facebook/FacebookAdapter.js';
import { GoogleAdapter } from './google/GoogleAdapter.js';
import { TikTokAdapter } from './tiktok/TikTokAdapter.js';
import { InstagramAdapter } from './instagram/InstagramAdapter.js';

const ADAPTERS = {
  facebook: FacebookAdapter,
  instagram: InstagramAdapter,
  google: GoogleAdapter,
  tiktok: TikTokAdapter,
};

export const SUPPORTED_PLATFORMS = Object.keys(ADAPTERS);

/**
 * Creates the adapter for a platform row.
 * `platform.config` must already be decrypted (see Platform model / decryptJson).
 */
export const adapterFactory = {
  create(platform, env) {
    const AdapterClass = ADAPTERS[String(platform.type).toLowerCase()];
    if (!AdapterClass) throw new Error(`Unsupported platform type: ${platform.type}`);
    return new AdapterClass(platform, env);
  },
};
