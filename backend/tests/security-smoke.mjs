// Security smoke test. Run against a LOCAL dev server with a fresh local DB:
//   terminal 0:  npm run mock:platforms   (credentials are verified against the platform API)
//   terminal 1:  npm run db:local && npm run dev
//   terminal 2:  npm run test:security
// It creates throwaway users/rows in the local D1 database only.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { sign } from 'hono/jwt';
import bcrypt from 'bcryptjs';

const BASE = process.env.API_URL || 'http://localhost:8787';
const ORIGIN = 'http://localhost:3000';
const EVIL = 'https://evil.example';
const secrets = Object.fromEntries(
  readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
    .split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);

let passed = 0, failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name} ${extra}`); }
};

class Client {
  constructor() { this.cookie = ''; }
  async req(method, path, { body, origin = ORIGIN, cookie = this.cookie, headers = {} } = {}) {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(origin ? { Origin: origin } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie') || '';
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, json, setCookie, headers: res.headers };
  }
  async login(email, password) {
    const r = await this.req('POST', '/api/auth/login', { body: { email, password } });
    const m = r.setCookie.match(/(ads_session=[^;]+)/);
    if (m) this.cookie = m[1];
    return r;
  }
}

// execFileSync (no shell) so `$` in bcrypt hashes and quotes in JSON are passed through untouched
const d1 = (sql) => JSON.parse(
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'ads-saas-db', '--local', '--json', '--command', sql],
    { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
)[0].results;

const run = Date.now();
const emailA = `alice+${run}@example.com`;
const emailB = `bob+${run}@example.com`;
const pw = 'Str0ngPassw0rd';

console.log('\n[1] Unauthenticated access is blocked');
const anon = new Client();
for (const p of ['/api/campaigns', '/api/platforms', '/api/platforms/connected', '/api/media', '/api/status/overview', '/api/auth/me']) {
  const r = await anon.req('GET', p);
  check(`GET ${p} -> 401`, r.status === 401, `(got ${r.status})`);
}

console.log('\n[2] Forged / malformed tokens are rejected');
const now = Math.floor(Date.now() / 1000);
const forgedOldSecret = await sign({ sub: 'someone', sid: 'x', exp: now + 3600 }, 'ads-saas-secret-key');
const forgedLegacyShape = await sign({ userId: 'someone', email: 'a@b.c', exp: now + 3600 }, 'ads-saas-secret-key');
const noExp = await sign({ sub: 'someone', sid: 'x' }, secrets.JWT_SECRET);
const goodSigNoSession = await sign({ sub: 'someone', sid: 'nonexistent', exp: now + 3600 }, secrets.JWT_SECRET);
const expired = await sign({ sub: 'someone', sid: 'x', exp: now - 10 }, secrets.JWT_SECRET);
const algNone = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.' + Buffer.from(JSON.stringify({ sub: 'x', sid: 'x', exp: now + 3600 })).toString('base64url') + '.';
for (const [label, tok] of [
  ['signed with the OLD hardcoded secret', forgedOldSecret],
  ['legacy payload shape, wrong secret (old decode() fallback)', forgedLegacyShape],
  ['valid signature but no exp', noExp],
  ['valid signature but session not in KV', goodSigNoSession],
  ['expired', expired],
  ['alg=none', algNone],
]) {
  const r = await anon.req('GET', '/api/campaigns', { cookie: `ads_session=${tok}` });
  check(`${label} -> 401`, r.status === 401, `(got ${r.status})`);
}
const bearer = await anon.req('GET', '/api/campaigns', { headers: { Authorization: `Bearer ${forgedOldSecret}` } });
check('Authorization: Bearer header is no longer accepted', bearer.status === 401);

console.log('\n[3] Registration validation');
let r = await anon.req('POST', '/api/auth/register', { body: { email: 'not-an-email', password: pw } });
check('invalid email -> 400', r.status === 400);
r = await anon.req('POST', '/api/auth/register', { body: { email: emailA, password: 'short1' } });
check('short password -> 400', r.status === 400);
r = await anon.req('POST', '/api/auth/register', { body: { email: emailA, password: pw, name: 'Alice' } });
check('valid registration -> 201', r.status === 201, JSON.stringify(r.json));
check('register does not log the user in (no cookie, no token)', !r.setCookie && !r.json?.token);
r = await anon.req('POST', '/api/auth/register', { body: { email: emailA.toUpperCase(), password: pw } });
check('duplicate email (different case) -> 409', r.status === 409, `(got ${r.status})`);
r = await anon.req('POST', '/api/auth/register', { body: { email: emailB, password: pw, name: 'Bob' } });
check('second user -> 201', r.status === 201);

console.log('\n[4] Login & session cookie');
const bad = await anon.req('POST', '/api/auth/login', { body: { email: emailA, password: 'WrongPass123' } });
const unknown = await anon.req('POST', '/api/auth/login', { body: { email: `nobody${run}@example.com`, password: 'WrongPass123' } });
check('wrong password -> 401', bad.status === 401);
check('unknown email gives identical response (no user enumeration)', unknown.status === 401 && unknown.json?.error === bad.json?.error);

const alice = new Client();
r = await alice.login(emailA, pw);
check('login -> 200', r.status === 200, JSON.stringify(r.json));
check('cookie is HttpOnly', /httponly/i.test(r.setCookie));
check('cookie is SameSite=Lax', /samesite=lax/i.test(r.setCookie));
check('token is NOT in the response body', !JSON.stringify(r.json).includes('eyJ'));
r = await alice.req('GET', '/api/auth/me');
check('/me works with the cookie and returns the name', r.status === 200 && r.json?.user?.name === 'Alice', JSON.stringify(r.json));

console.log('\n[5] CSRF origin guard + CORS');
r = await alice.req('POST', '/api/platforms', { body: { name: 'x', type: 'facebook' }, origin: EVIL });
check('cookie + POST from evil origin -> 403', r.status === 403);
r = await alice.req('POST', '/api/platforms', { body: { name: 'x', type: 'facebook' }, origin: null });
check('cookie + POST with no Origin -> 403', r.status === 403);
r = await anon.req('POST', '/api/auth/login', { body: { email: emailA, password: pw }, origin: EVIL });
check('login CSRF from evil origin -> 403', r.status === 403);
const pre = await fetch(BASE + '/api/platforms', { method: 'OPTIONS', headers: { Origin: EVIL, 'Access-Control-Request-Method': 'POST' } });
check('preflight from evil origin gets no Allow-Origin', !pre.headers.get('access-control-allow-origin'));
const pre2 = await fetch(BASE + '/api/platforms', { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' } });
check('preflight from allowed origin is accepted with credentials', pre2.headers.get('access-control-allow-origin') === ORIGIN && pre2.headers.get('access-control-allow-credentials') === 'true');

console.log('\n[6] Platform credentials: encrypted at rest, never returned');
r = await alice.req('POST', '/api/platforms', { body: { name: 'My FB', type: 'facebook', config: { accessToken: 'LEAK-ME-123' } } });
check('create platform -> 201', r.status === 201, JSON.stringify(r.json));
const platformId = r.json?.platform?.id;
check('config passed on create is ignored', !JSON.stringify(r.json).includes('LEAK-ME-123'));
r = await alice.req('POST', `/api/platforms/${platformId}/connect`, { body: { access_token: 'EAAB-super-secret-token', account_id: 'act-123456', page_id: '777' } });
check('connect (snake_case keys from UI) -> 200', r.status === 200, JSON.stringify(r.json));
check('connect response has no secrets', !JSON.stringify(r.json).includes('EAAB-super-secret-token'));
check('is_connected true + masked account hint', r.json?.platform?.is_connected === true && r.json?.platform?.config?.accountHint === '••••3456', JSON.stringify(r.json?.platform?.config));
for (const path of ['/api/platforms', '/api/platforms/connected', `/api/platforms/${platformId}`]) {
  const g = await alice.req('GET', path);
  check(`GET ${path} leaks no token`, g.status === 200 && !JSON.stringify(g.json).includes('EAAB-super-secret-token'));
}
const row = d1(`SELECT config FROM platforms WHERE id='${platformId}'`)[0].config;
check('DB row is AES-GCM encrypted (enc:v1:…)', row.startsWith('enc:v1:') && !row.includes('EAAB-super-secret-token'));
r = await alice.req('PUT', `/api/platforms/${platformId}`, { body: { name: 'Renamed FB', isConnected: false, config: {} } });
check('rename works', r.status === 200 && r.json?.platform?.name === 'Renamed FB');
check('rename does NOT wipe credentials or flip connection state', r.json?.platform?.is_connected === true && r.json?.platform?.config?.accountHint === '••••3456');
r = await alice.req('POST', `/api/platforms/${platformId}/connect`, { body: { access_token: 'only-token' } });
check('connect with missing fields -> 400', r.status === 400);

console.log('\n[7] Legacy data is upgraded transparently');
const legacyId = crypto.randomUUID();
const aliceId = (await alice.req('GET', '/api/auth/me')).json.user.id;
d1(`INSERT INTO platforms (id,name,type,config,user_id,is_connected) VALUES ('${legacyId}','Legacy','tiktok','{"accessToken":"PLAINTEXT-LEGACY","accountId":"9999"}','${aliceId}',1)`);
r = await alice.req('GET', `/api/platforms/${legacyId}`);
check('plaintext legacy row still readable', r.status === 200 && r.json.platform.config.accountHint === '••••9999', JSON.stringify(r.json));
const after = d1(`SELECT config FROM platforms WHERE id='${legacyId}'`)[0].config;
check('legacy row was re-saved encrypted', after.startsWith('enc:v1:') && !after.includes('PLAINTEXT-LEGACY'));

const legacyEmail = `legacy+${run}@example.com`;
const oldHash = bcrypt.hashSync('Legacy1234', 10);
d1(`INSERT INTO users (id,email,password_hash,name) VALUES ('${crypto.randomUUID()}','${legacyEmail}','${oldHash}','Legacy')`);
const legacyUser = new Client();
r = await legacyUser.login(legacyEmail, 'Legacy1234');
check('legacy bcrypt cost-10 user can still log in', r.status === 200);
const newHash = d1(`SELECT password_hash FROM users WHERE email='${legacyEmail}'`)[0].password_hash;
check('password hash upgraded to cost 12', bcrypt.getRounds(newHash) === 12, newHash.slice(0, 7));

console.log('\n[8] Campaign validation & ownership');
const bob = new Client();
await bob.login(emailB, pw);
r = await alice.req('POST', '/api/campaigns', { body: { title: 'Bad', budget: -5, platforms: [platformId] } });
check('negative budget -> 400', r.status === 400);
r = await alice.req('POST', '/api/campaigns', { body: { title: 'Bad', budget: 50, platforms: [] } });
check('no platforms -> 400', r.status === 400);
r = await alice.req('POST', '/api/campaigns', { body: { title: 'Bad', budget: 50, platforms: ['1'] } });
check('unknown platform id -> 400', r.status === 400);
r = await bob.req('POST', '/api/campaigns', { body: { title: 'Steal', budget: 50, platforms: [platformId] } });
check("cannot attach ANOTHER user's platform -> 400", r.status === 400, JSON.stringify(r.json));
r = await alice.req('POST', '/api/campaigns', { body: { title: 'Launch', description: '', budget: 100, scheduleStart: '', scheduleEnd: '', objective: 'TRAFFIC', platforms: [platformId] } });
check('valid campaign (UI payload shape) -> 201', r.status === 201, JSON.stringify(r.json));
const campaignId = r.json?.campaign?.id;
r = await alice.req('PUT', `/api/campaigns/${campaignId}`, { body: { status: 'active' } });
check("cannot set status='active' via PUT (must use /publish)", r.status === 400);
r = await alice.req('PUT', `/api/campaigns/${campaignId}`, { body: { user_id: 'x', title: 'Launch v2' } });
check('partial update keeps other fields', r.status === 200 && r.json?.campaign?.title === 'Launch v2' && Number(r.json?.campaign?.budget) === 100, JSON.stringify(r.json));
r = await bob.req('GET', `/api/campaigns/${campaignId}`);
check("other user's campaign -> 404", r.status === 404);
r = await bob.req('GET', `/api/platforms/${platformId}`);
check("other user's platform -> 404", r.status === 404);
r = await bob.req('DELETE', `/api/campaigns/${campaignId}`);
check("other user cannot delete campaign", r.status === 404);
r = await alice.req('GET', '/api/campaigns?limit=-5&offset=abc');
check('garbage pagination params are tolerated', r.status === 200);

console.log('\n[9] Logout really revokes the token');
const stolen = alice.cookie;
r = await alice.req('POST', '/api/auth/logout');
check('logout -> 200 and clears cookie', r.status === 200 && /ads_session=;|max-age=0/i.test(r.setCookie), r.setCookie);
r = await anon.req('GET', '/api/auth/me', { cookie: stolen });
check('old (copied) cookie no longer works after logout', r.status === 401, `(got ${r.status})`);

console.log('\n[10] Rate limiting');
const victim = `victim+${run}@example.com`;
await anon.req('POST', '/api/auth/register', { body: { email: victim, password: pw } }).catch(() => {});
const statuses = [];
for (let i = 0; i < 6; i++) {
  statuses.push((await anon.req('POST', '/api/auth/login', { body: { email: emailB, password: `Wrong${i}pass1` } })).status);
}
check('5 wrong passwords then lockout (401 x5, 429)', statuses.slice(0, 5).every((s) => s === 401) && statuses[5] === 429, JSON.stringify(statuses));
r = await anon.req('POST', '/api/auth/login', { body: { email: emailB, password: pw } });
check('even the CORRECT password is refused while locked', r.status === 429);
check('Retry-After header present', Boolean(r.headers.get('retry-after')));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
