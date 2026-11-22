/**
 * Small Web Crypto helpers (available natively in Cloudflare Workers).
 *  - AES-256-GCM encryption for platform credentials stored in D1
 *  - SHA-256 / random helpers
 */

const ENC_PREFIX = 'enc:v1:';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importKey(secret) {
  if (!secret) throw new Error('ENCRYPTION_KEY is not configured');
  const raw = base64ToBytes(secret);
  if (raw.length !== 32) throw new Error('ENCRYPTION_KEY must decode to 32 bytes');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * Encrypts a JSON-serialisable value. `aad` (e.g. the platform id) is bound
 * to the ciphertext, so a blob copied onto another row will not decrypt.
 * Output format: enc:v1:<iv base64>:<ciphertext base64>
 */
export async function encryptJson(secret, value, aad = '') {
  const key = await importKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(aad) },
    key,
    encoder.encode(JSON.stringify(value))
  );
  return `${ENC_PREFIX}${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertext))}`;
}

export function isEncrypted(stored) {
  return typeof stored === 'string' && stored.startsWith(ENC_PREFIX);
}

/**
 * Decrypts a value produced by encryptJson. Rows written before encryption
 * existed (plain JSON) are still readable; callers can detect them with
 * isEncrypted() and re-save them encrypted.
 */
export async function decryptJson(secret, stored, aad = '') {
  if (!stored) return {};
  if (!isEncrypted(stored)) return JSON.parse(stored);

  const [ivB64, dataB64] = stored.slice(ENC_PREFIX.length).split(':');
  const key = await importKey(secret);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(ivB64), additionalData: encoder.encode(aad) },
    key,
    base64ToBytes(dataB64)
  );
  return JSON.parse(decoder.decode(plaintext));
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomHex(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
