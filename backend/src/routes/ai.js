import { Hono } from 'hono';
import { validateJson } from '../middleware/validate.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { adCopySchema } from '../validation/schemas.js';
import { AiError, aiEnabled, DEFAULT_MODEL, generateAdCopy } from '../services/ai.js';
import { Log } from '../models/Log.js';

const ai = new Hono();

ai.get('/status', (c) => c.json({ enabled: aiEnabled(c.env), model: c.env.ANTHROPIC_MODEL || DEFAULT_MODEL }));

// Each call costs money: limit per user, not per IP
ai.post(
  '/ad-copy',
  rateLimit({ name: 'ai-copy', limit: 20, windowSeconds: 60 * 60, by: (c) => c.get('userId') }),
  validateJson(adCopySchema),
  async (c) => {
    try {
      const copy = await generateAdCopy(c.env, c.get('body'));
      await new Log(c.env.DB).info('AI ad copy generated', { headlines: copy.headlines.length }, c.get('userId'));
      return c.json(copy);
    } catch (error) {
      if (error instanceof AiError) return c.json({ error: error.message, code: error.code }, error.status);
      throw error;
    }
  }
);

export { ai as aiRoutes };
