# Security notes

## What is implemented

| Area | Behaviour |
| --- | --- |
| Authentication | Signed HS256 JWT in an `httpOnly`, `SameSite` cookie (`__Host-` prefixed and `Secure` in production). The token is never in a response body or `localStorage`. |
| Session revocation | Every JWT points at a session in the `SESSIONS` KV namespace. Logout, refresh and a deleted user remove it, so a copied cookie stops working. Tokens must carry `exp`, `sub` and `sid`. |
| CSRF | Every POST/PUT/DELETE must send an `Origin` header listed in `ALLOWED_ORIGINS`. |
| CORS | Only `ALLOWED_ORIGINS` (credentials allowed). In production an empty list blocks all browsers. |
| Secrets | `JWT_SECRET` and `ENCRYPTION_KEY` come from `.dev.vars` (local) or `wrangler secret put` (production). The API returns 500 and logs the reason if they are missing or malformed. |
| Platform credentials | Stored AES-256-GCM encrypted (`enc:v1:` envelope, row id bound as AAD). API responses only contain a masked account hint. Disconnecting wipes them. Plain-text rows from older versions are re-encrypted the first time they are read. |
| Passwords | bcrypt cost 12 (older hashes upgrade on next login), 8-72 characters, at least one letter and one number. Unknown email and wrong password are indistinguishable. |
| Brute force | 5 failed logins per account per 15 minutes, 20 login requests per IP per 15 minutes, 5 registrations per IP per hour. |
| Input validation | Zod schemas for auth, campaigns, platforms (+ per-type credentials) and media linking. Unknown fields are stripped; users can only set a campaign to `draft`/`paused` (`active` only through `/publish`). |
| OAuth | `state` is random, single-use, expires in 10 minutes and is bound to the user and platform. The callback also requires the signed-in session of that same user. Tokens are exchanged server-side and stored encrypted; the browser never sees them. |
| Platform API calls | Credentials travel in headers only (never in URLs or logs). Base-URL overrides used for the sandbox are ignored when `ENVIRONMENT=production`. |
| Media links | Ad platforms download media through HMAC-signed, expiring URLs (key derived from `JWT_SECRET`); files are served with `nosniff` and a sandboxing CSP. |
| AI | The Claude API key stays on the server; each user is limited to 20 generations per hour; product text is passed as untrusted data and output is length-checked server-side. |
| Ownership | Other users' campaigns, platforms and media return 404. Campaigns can only reference the caller's own platforms. |

## Configuration reference

| Name | Where | Purpose |
| --- | --- | --- |
| `JWT_SECRET` | secret | 32+ random characters, signs session tokens |
| `ENCRYPTION_KEY` | secret | base64 of 32 random bytes, encrypts platform credentials |
| `ALLOWED_ORIGINS` | var | comma-separated frontend origins |
| `ENVIRONMENT` | var | `production` turns on `Secure`/`__Host-` cookies and hides error details |
| `COOKIE_SAMESITE` | var | `Lax` (default), `Strict`, or `None` for a frontend on a different site |
| `FRONTEND_URL` | var | where the browser returns after OAuth (must be one of `ALLOWED_ORIGINS`) |
| `PUBLIC_API_URL` | var | public URL of this API: OAuth redirect target and base of signed media links |
| `ANTHROPIC_API_KEY` | secret | enables AI ad copy (`ANTHROPIC_MODEL` var picks the model) |
| `META_APP_ID`, `META_APP_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET` | secret | enable one-click connect per platform |

## Known limits (be honest in interviews)

- KV rate limiting is eventually consistent and not atomic. Add a Cloudflare WAF rate-limit rule on `/api/auth/*` for hard guarantees.
- Registration reveals whether an email exists (409). That is a UX trade-off, mitigated by the rate limit.
- There is no email verification, password reset or MFA yet.
- Uploaded file types are checked by the browser-supplied MIME type, not by sniffing the bytes.
- No Content-Security-Policy header on the frontend yet.
- Rotating `ENCRYPTION_KEY` makes stored credentials unreadable (users must reconnect platforms). Rotating `JWT_SECRET` only signs everyone out.
