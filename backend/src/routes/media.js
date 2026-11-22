import { Hono } from 'hono';
import { Media } from '../models/Media.js';
import { Log } from '../models/Log.js';
import { validateJson } from '../middleware/validate.js';
import { getPagination, getBoundedInt } from '../utils/http.js';
import { mediaLinkSchema } from '../validation/schemas.js';
import { signMediaUrl, verifyMediaSignature } from '../utils/mediaUrls.js';

const media = new Hono();

// Get all media for user
media.get('/', async (c) => {
  try {
    const userId = c.get('userId');
    const { limit, offset } = getPagination(c);
    const search = c.req.query('search');

    const mediaModel = new Media(c.env.DB, c.env.MEDIA_BUCKET);
    
    let mediaFiles;
    if (search) {
      mediaFiles = await mediaModel.searchMedia(userId, search, limit);
    } else {
      mediaFiles = await mediaModel.findByUserId(userId, limit, offset);
    }

    return c.json({ media: mediaFiles });
  } catch (error) {
    console.error('Get media error:', error);
    return c.json({ error: 'Failed to get media' }, 500);
  }
});

// Stream the file to its owner (used by <img>/<video> in the dashboard)
media.get('/:id/file', async (c) => {
  const mediaModel = new Media(c.env.DB, c.env.MEDIA_BUCKET);
  const mediaFile = await mediaModel.findById(c.req.param('id'));
  if (!mediaFile || mediaFile.user_id !== c.get('userId')) return c.json({ error: 'Media not found' }, 404);
  return streamMedia(c, mediaFile);
});

// Get single media file
media.get('/:id', async (c) => {
  try {
    const userId = c.get('userId');
    const mediaId = c.req.param('id');

    const mediaModel = new Media(c.env.DB, c.env.MEDIA_BUCKET);
    const mediaFile = await mediaModel.findById(mediaId);

    if (!mediaFile) {
      return c.json({ error: 'Media not found' }, 404);
    }

    if (mediaFile.user_id !== userId) {
      return c.json({ error: 'Media not found' }, 404);
    }

    return c.json({ media: mediaFile });
  } catch (error) {
    console.error('Get media error:', error);
    return c.json({ error: 'Failed to get media' }, 500);
  }
});

// Upload media file
media.post('/', async (c) => {
  try {
    const userId = c.get('userId');
    
    // Get form data
    const formData = await c.req.formData();
    const file = formData.get('file');
    
    if (!file) {
      return c.json({ error: 'No file provided' }, 400);
    }

    // Validate file
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'video/quicktime', 'text/plain'];
    if (!validTypes.includes(file.type)) {
      return c.json({ error: 'Invalid file type. Supported types: JPEG, PNG, GIF, MP4, MOV, TXT' }, 400);
    }

    // Check file size (50MB limit)
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      return c.json({ error: 'File too large. Maximum size is 50MB' }, 400);
    }

    const mediaModel = new Media(c.env.DB, c.env.MEDIA_BUCKET);
    const log = new Log(c.env.DB);

    const mediaData = {
      filename: file.name,
      originalName: file.name,
      mimeType: file.type,
      size: file.size
    };

    const newMedia = await mediaModel.create(mediaData, userId, file);

    await log.info('Media uploaded', { 
      mediaId: newMedia.id,
      filename: newMedia.filename,
      size: newMedia.size,
      mimeType: newMedia.mime_type
    }, userId);

    return c.json({ media: newMedia }, 201);
  } catch (error) {
    console.error('Upload media error:', error);
    return c.json({ error: 'Failed to upload media' }, 500);
  }
});

// Delete media file
media.delete('/:id', async (c) => {
  try {
    const userId = c.get('userId');
    const mediaId = c.req.param('id');

    const mediaModel = new Media(c.env.DB, c.env.MEDIA_BUCKET);
    const log = new Log(c.env.DB);

    // Check if media exists and user owns it
    const mediaFile = await mediaModel.findById(mediaId);
    if (!mediaFile) {
      return c.json({ error: 'Media not found' }, 404);
    }

    if (mediaFile.user_id !== userId) {
      return c.json({ error: 'Media not found' }, 404);
    }

    await mediaModel.delete(mediaId, userId);

    await log.info('Media deleted', { 
      mediaId: mediaId,
      filename: mediaFile.filename
    }, userId);

    return c.json({ message: 'Media deleted successfully' });
  } catch (error) {
    console.error('Delete media error:', error);
    return c.json({ error: 'Failed to delete media' }, 500);
  }
});

// Link media to campaign
media.post('/:id/link-to-campaign', validateJson(mediaLinkSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const mediaId = c.req.param('id');
    const { campaignId, mediaType, adCopy } = c.get('body');

    const mediaModel = new Media(c.env.DB, c.env.MEDIA_BUCKET);
    const log = new Log(c.env.DB);

    // Check if media exists and user owns it
    const mediaFile = await mediaModel.findById(mediaId);
    if (!mediaFile) {
      return c.json({ error: 'Media not found' }, 404);
    }

    if (mediaFile.user_id !== userId) {
      return c.json({ error: 'Media not found' }, 404);
    }

    // Check if campaign exists and user owns it
    const campaignCheck = await c.env.DB.prepare(`
      SELECT id FROM campaigns WHERE id = ? AND user_id = ?
    `).bind(campaignId, userId).first();

    if (!campaignCheck) {
      return c.json({ error: 'Campaign not found or unauthorized' }, 404);
    }

    const campaignMedia = await mediaModel.linkToCampaign(mediaId, campaignId, mediaType, adCopy);

    await log.info('Media linked to campaign', { 
      mediaId: mediaId,
      campaignId: campaignId,
      mediaType: mediaType
    }, userId, campaignId);

    return c.json({ campaignMedia }, 201);
  } catch (error) {
    console.error('Link media to campaign error:', error);
    return c.json({ error: 'Failed to link media to campaign' }, 500);
  }
});

// Unlink media from campaign
media.delete('/:id/unlink-from-campaign', async (c) => {
  try {
    const userId = c.get('userId');
    const mediaId = c.req.param('id');
    const campaignId = c.req.query('campaignId');

    if (!campaignId) {
      return c.json({ error: 'Campaign ID is required' }, 400);
    }

    const mediaModel = new Media(c.env.DB, c.env.MEDIA_BUCKET);
    const log = new Log(c.env.DB);

    // Check if media exists and user owns it
    const mediaFile = await mediaModel.findById(mediaId);
    if (!mediaFile) {
      return c.json({ error: 'Media not found' }, 404);
    }

    if (mediaFile.user_id !== userId) {
      return c.json({ error: 'Media not found' }, 404);
    }

    // Check if campaign exists and user owns it
    const campaignCheck = await c.env.DB.prepare(`
      SELECT id FROM campaigns WHERE id = ? AND user_id = ?
    `).bind(campaignId, userId).first();

    if (!campaignCheck) {
      return c.json({ error: 'Campaign not found or unauthorized' }, 404);
    }

    await mediaModel.unlinkFromCampaign(mediaId, campaignId);

    await log.info('Media unlinked from campaign', { 
      mediaId: mediaId,
      campaignId: campaignId
    }, userId, campaignId);

    return c.json({ message: 'Media unlinked from campaign successfully' });
  } catch (error) {
    console.error('Unlink media from campaign error:', error);
    return c.json({ error: 'Failed to unlink media from campaign' }, 500);
  }
});

// Get signed URL for media
media.get('/:id/signed-url', async (c) => {
  try {
    const userId = c.get('userId');
    const mediaId = c.req.param('id');
    const expiresIn = getBoundedInt(c, 'expiresIn', { fallback: 3600, min: 60, max: 86400 });

    const mediaModel = new Media(c.env.DB, c.env.MEDIA_BUCKET);

    // Check if media exists and user owns it
    const mediaFile = await mediaModel.findById(mediaId);
    if (!mediaFile || mediaFile.user_id !== userId) {
      return c.json({ error: 'Media not found' }, 404);
    }

    const signedUrl = await signMediaUrl(c.env, mediaId, expiresIn);

    return c.json({ signedUrl });
  } catch (error) {
    console.error('Get signed URL error:', error);
    return c.json({ error: 'Failed to get signed URL' }, 500);
  }
});

// Get media stats
media.get('/stats/summary', async (c) => {
  try {
    const userId = c.get('userId');

    const mediaModel = new Media(c.env.DB, c.env.MEDIA_BUCKET);
    const stats = await mediaModel.getMediaStats(userId);

    return c.json({ stats });
  } catch (error) {
    console.error('Get media stats error:', error);
    return c.json({ error: 'Failed to get media stats' }, 500);
  }
});

export { media as mediaRoutes };

/** Streams an R2 object with safe headers (no sniffing, no inline scripts). */
export async function streamMedia(c, mediaFile) {
  const object = await c.env.MEDIA_BUCKET.get(mediaFile.r2_key);
  if (!object) return c.json({ error: 'File not found' }, 404);
  return new Response(object.body, {
    headers: {
      'Content-Type': mediaFile.mime_type,
      'Content-Length': String(object.size),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=300',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  });
}

// Public, HMAC-signed download used by ad platforms (no cookie needed)
export const publicMediaRoutes = new Hono();
publicMediaRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const { exp, sig } = c.req.query();
  if (!(await verifyMediaSignature(c.env, id, exp, sig))) return c.json({ error: 'Invalid or expired link' }, 403);
  const mediaFile = await new Media(c.env.DB, c.env.MEDIA_BUCKET).findById(id);
  if (!mediaFile) return c.json({ error: 'Media not found' }, 404);
  return streamMedia(c, mediaFile);
});
