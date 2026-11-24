-- Creative + targeting data that real ad platforms need to publish a campaign
ALTER TABLE campaigns ADD COLUMN objective TEXT NOT NULL DEFAULT 'TRAFFIC';          -- TRAFFIC | AWARENESS
ALTER TABLE campaigns ADD COLUMN budget_type TEXT NOT NULL DEFAULT 'daily';          -- daily | lifetime
ALTER TABLE campaigns ADD COLUMN destination_url TEXT;
ALTER TABLE campaigns ADD COLUMN headline TEXT;
ALTER TABLE campaigns ADD COLUMN ad_copy TEXT;                                       -- primary text / description
ALTER TABLE campaigns ADD COLUMN call_to_action TEXT NOT NULL DEFAULT 'LEARN_MORE';
ALTER TABLE campaigns ADD COLUMN targeting TEXT;                                     -- JSON {countries, ageMin, ageMax, keywords}
ALTER TABLE campaigns ADD COLUMN variants TEXT;                                      -- JSON {headlines:[], descriptions:[]} (Google RSA)
ALTER TABLE campaigns ADD COLUMN publish_paused INTEGER NOT NULL DEFAULT 1;          -- create ads paused on the platform

-- What was created on each platform (ids needed to resume, pause, delete, report)
ALTER TABLE campaign_platforms ADD COLUMN external_ref TEXT;                         -- JSON of platform object ids
ALTER TABLE campaign_platforms ADD COLUMN published_at DATETIME;

-- Real performance numbers pulled from the platforms
CREATE TABLE IF NOT EXISTS metrics_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id TEXT NOT NULL,
    platform_id TEXT NOT NULL,
    date TEXT NOT NULL,                      -- YYYY-MM-DD (platform account time zone)
    impressions INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    spend REAL NOT NULL DEFAULT 0,
    conversions REAL NOT NULL DEFAULT 0,
    currency TEXT,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (platform_id) REFERENCES platforms(id) ON DELETE CASCADE,
    UNIQUE(campaign_id, platform_id, date)
);
CREATE INDEX IF NOT EXISTS idx_metrics_campaign_date ON metrics_daily(campaign_id, date);
CREATE INDEX IF NOT EXISTS idx_metrics_date ON metrics_daily(date);
