import { FacebookAdapter } from '../facebook/FacebookAdapter';
import { requireFields } from '../BaseAdapter';
import type { Ad, PublishContext, PublishResult } from '../types';

/**
 * Instagram ads are bought through the same Meta Marketing API as Facebook ads;
 * the differences are the placement (Instagram only) and the Instagram account
 * that the ad is published as.
 */
export class InstagramAdapter extends FacebookAdapter {
  protected override get publisherPlatforms(): string[] {
    return ['instagram'];
  }

  protected override creativeIdentity(): Record<string, string | undefined> {
    return { instagram_user_id: this.cfg.instagramUserId };
  }

  override async publishAd(ad: Ad, ctx?: PublishContext): Promise<PublishResult> {
    requireFields('Instagram', [
      ['an Instagram business account linked to the Page (reconnect and pick one)', this.cfg.instagramUserId],
    ]);
    return super.publishAd(ad, ctx);
  }
}
