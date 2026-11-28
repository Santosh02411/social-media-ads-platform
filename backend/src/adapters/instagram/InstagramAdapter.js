import { FacebookAdapter } from '../facebook/FacebookAdapter.js';
import { requireFields } from '../BaseAdapter.js';

/**
 * Instagram ads are bought through the same Meta Marketing API as Facebook ads;
 * the differences are the placement (Instagram only) and the Instagram account
 * that the ad is published as.
 */
export class InstagramAdapter extends FacebookAdapter {
  get publisherPlatforms() { return ['instagram']; }

  creativeIdentity() {
    return { instagram_user_id: this.cfg.instagramUserId };
  }

  async publishAd(ad, ctx) {
    requireFields('Instagram', [['an Instagram business account linked to the Page (reconnect and pick one)', this.cfg.instagramUserId]]);
    return super.publishAd(ad, ctx);
  }
}
