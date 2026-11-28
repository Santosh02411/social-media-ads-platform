// Generates backend/.dev.vars with fresh random secrets (never overwrites an existing file).
// Usage: npm run setup:secrets
import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const target = join(dirname(fileURLToPath(import.meta.url)), '..', '.dev.vars');

if (existsSync(target)) {
  console.log('.dev.vars already exists - leaving it untouched.');
  process.exit(0);
}

writeFileSync(
  target,
  `JWT_SECRET=${randomBytes(48).toString('base64url')}\nENCRYPTION_KEY=${randomBytes(32).toString('base64')}\n`,
  { mode: 0o600 }
);
console.log('Created backend/.dev.vars with new random JWT_SECRET and ENCRYPTION_KEY.');
console.log('Keep it private: it is git-ignored. Use `wrangler secret put` for production.');
