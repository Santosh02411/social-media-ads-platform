-- Emails are compared case-insensitively (the API now lowercases them on signup/login).
-- This also stops two accounts differing only by letter case.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users(lower(email));
