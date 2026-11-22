/**
 * Short-lived public URLs for media. Ad platforms (TikTok video upload, Meta)
 * must be able to download the file without our login cookie, so the URL carries
 * an HMAC signature over `<mediaId>.<expiry>`. R2 itself has no public URL.
 */
import { publicApiUrl } from '../services/oauth.js';
import { base64ToBytes, bytesToBase64 } from './crypto.js';

const encoder = new TextEncoder();

async function hmacKey(env) {
  // Derived key: a leaked media signature can never be used as a session signature
  const material = await crypto.subtle.digest('SHA-256', encoder.encode(`${env.JWT_SECRET}:media-url`));
  return crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

const toUrlSafe = (b64) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromUrlSafe = (s) => s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);

export async function signMediaUrl(env, mediaId, ttlSeconds = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(env), encoder.encode(`${mediaId}.${exp}`));
  const sig = toUrlSafe(bytesToBase64(new Uint8Array(signature)));
  return `${publicApiUrl(env)}/media-file/${mediaId}?exp=${exp}&sig=${sig}`;
}

export async function verifyMediaSignature(env, mediaId, exp, sig) {
  const expiry = Number(exp);
  if (!Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000) || !sig) return false;
  try {
    return await crypto.subtle.verify('HMAC', await hmacKey(env), base64ToBytes(fromUrlSafe(sig)), encoder.encode(`${mediaId}.${expiry}`));
  } catch {
    return false;
  }
}
