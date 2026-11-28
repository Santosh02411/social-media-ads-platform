// Creates / extends backend/.dev.vars (git-ignored).
//   npm run setup:secrets                 random JWT_SECRET + ENCRYPTION_KEY (never overwrites existing values)
//   npm run setup:secrets -- --sandbox    also point every ad platform + the Claude API at the local mock
//                                         server (npm run mock:platforms) with fake app credentials
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const target = join(dirname(fileURLToPath(import.meta.url)), '..', '.dev.vars');
const sandbox = process.argv.includes('--sandbox');

const SANDBOX_BLOCK = `
# --- sandbox: ad platforms and Claude API are served by the local mock (npm run mock:platforms) ---
META_GRAPH_BASE=http://localhost:9100/meta
META_OAUTH_DIALOG_BASE=http://localhost:9100/meta
GOOGLE_ADS_BASE=http://localhost:9100/google-ads
GOOGLE_OAUTH_TOKEN_URL=http://localhost:9100/google-oauth/token
GOOGLE_OAUTH_AUTH_URL=http://localhost:9100/google-oauth/auth
TIKTOK_API_BASE=http://localhost:9100/tiktok/open_api/v1.3
TIKTOK_PORTAL_BASE=http://localhost:9100/tiktok/portal-auth
ANTHROPIC_API_BASE=http://localhost:9100/anthropic
ANTHROPIC_API_KEY=test-anthropic-key
META_APP_ID=mock-meta-app
META_APP_SECRET=mock-meta-secret
GOOGLE_CLIENT_ID=mock-google-client
GOOGLE_CLIENT_SECRET=mock-google-secret
GOOGLE_ADS_DEVELOPER_TOKEN=mock-developer-token
TIKTOK_APP_ID=mock-tiktok-app
TIKTOK_APP_SECRET=mock-tiktok-secret
QUEUE_RETRY_BASE_SECONDS=2
`;

if (!existsSync(target)) {
  writeFileSync(
    target,
    `JWT_SECRET=${randomBytes(48).toString('base64url')}\nENCRYPTION_KEY=${randomBytes(32).toString('base64')}\n${sandbox ? SANDBOX_BLOCK : ''}`,
    { mode: 0o600 }
  );
  console.log('Created backend/.dev.vars with new random JWT_SECRET and ENCRYPTION_KEY.');
  if (sandbox) console.log('Sandbox mode enabled: start the mock with `npm run mock:platforms`.');
  console.log('Keep it private: it is git-ignored. Use `wrangler secret put` for production.');
} else if (sandbox && !readFileSync(target, 'utf8').includes('META_GRAPH_BASE')) {
  appendFileSync(target, SANDBOX_BLOCK);
  console.log('Added the sandbox block to the existing .dev.vars (secrets untouched).');
} else {
  console.log('.dev.vars already exists - leaving it untouched.');
}
