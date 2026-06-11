-- EquityBridge v2 — New Features Migration
-- Adds: secondary market, auto-invest, updates, reviews, impact, referrals, watchlist, notifications

BEGIN;

-- ── SECONDARY MARKETPLACE ─────────────────────────────────────────
-- Investors can list their stake for resale to other investors
CREATE TABLE IF NOT EXISTS secondary_listings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  investment_id   UUID NOT NULL REFERENCES investments(id),
  seller_id       UUID NOT NULL REFERENCES users(id),
  business_id     UUID NOT NULL REFERENCES businesses(id),
  offering_id     UUID NOT NULL REFERENCES offerings(id),
  equity_share    NUMERIC NOT NULL,      -- % being sold
  asking_price    NUMERIC NOT NULL,      -- $ asking price
  original_cost   NUMERIC NOT NULL,      -- what seller paid
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','sold','cancelled','expired')),
  buyer_id        UUID REFERENCES users(id),
  sold_price      NUMERIC,
  sold_at         TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '90 days'),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── AUTO-INVEST (recurring investment rules) ──────────────────────
CREATE TABLE IF NOT EXISTS auto_invest_rules (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  investor_id     UUID NOT NULL REFERENCES users(id),
  amount          NUMERIC NOT NULL,           -- $ per trigger
  frequency       TEXT NOT NULL DEFAULT 'monthly'
                    CHECK (frequency IN ('weekly','monthly','quarterly')),
  categories      TEXT[],                     -- e.g. ['restaurant','cafe']
  max_per_business NUMERIC DEFAULT 1000,
  min_funding_pct  NUMERIC DEFAULT 20,        -- only invest if > 20% funded
  max_equity_pct   NUMERIC DEFAULT 30,        -- skip if > 30% equity taken
  is_active       BOOLEAN DEFAULT TRUE,
  total_invested  NUMERIC DEFAULT 0,
  last_triggered  TIMESTAMPTZ,
  next_trigger    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── BUSINESS UPDATES (owner posts to investors) ───────────────────
CREATE TABLE IF NOT EXISTS business_updates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id),
  offering_id     UUID REFERENCES offerings(id),
  author_id       UUID NOT NULL REFERENCES users(id),
  title           TEXT NOT NULL,
  content         TEXT NOT NULL,
  update_type     TEXT NOT NULL DEFAULT 'general'
                    CHECK (update_type IN ('general','milestone','financial','urgent','media')),
  media_urls      TEXT[],
  is_public       BOOLEAN DEFAULT FALSE,   -- false = investors only
  views           INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── BUSINESS REVIEWS (from customers/investors) ───────────────────
CREATE TABLE IF NOT EXISTS business_reviews (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id),
  reviewer_id     UUID NOT NULL REFERENCES users(id),
  reviewer_type   TEXT DEFAULT 'customer' CHECK (reviewer_type IN ('investor','customer')),
  rating          INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title           TEXT,
  content         TEXT,
  visit_date      DATE,
  is_verified     BOOLEAN DEFAULT FALSE,
  helpful_count   INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (business_id, reviewer_id)
);

-- ── IMPACT METRICS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS impact_metrics (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id       UUID NOT NULL REFERENCES businesses(id),
  period_label      TEXT NOT NULL,            -- e.g. "Q1 2025"
  jobs_created      INT DEFAULT 0,
  jobs_retained     INT DEFAULT 0,
  local_spend_pct   NUMERIC,                  -- % of revenue spent locally
  revenue_growth    NUMERIC,                  -- % growth vs prior period
  new_products      INT DEFAULT 0,
  community_events  INT DEFAULT 0,
  tons_co2_saved    NUMERIC DEFAULT 0,        -- for green businesses
  reported_at       TIMESTAMPTZ DEFAULT NOW(),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── WATCHLIST ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS watchlist (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id),
  business_id UUID REFERENCES businesses(id),
  offering_id UUID REFERENCES offerings(id),
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, business_id)
);

-- ── NOTIFICATIONS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id),
  type        TEXT NOT NULL CHECK (type IN (
                'investment_confirmed','offering_funded','distribution_paid',
                'kyc_approved','kyc_rejected','business_update','new_offering',
                'secondary_sold','auto_invest_triggered','referral_reward',
                'offering_closing_soon','milestone_reached'
              )),
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  data        JSONB,
  is_read     BOOLEAN DEFAULT FALSE,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── REFERRALS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referrals (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referrer_id     UUID NOT NULL REFERENCES users(id),
  referred_id     UUID REFERENCES users(id),
  referral_code   TEXT NOT NULL UNIQUE,
  status          TEXT DEFAULT 'pending'
                    CHECK (status IN ('pending','signed_up','invested','rewarded')),
  reward_amount   NUMERIC DEFAULT 25,         -- $25 when referred user invests
  reward_paid     BOOLEAN DEFAULT FALSE,
  reward_paid_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── INVESTMENT CALCULATOR SAVES ───────────────────────────────────
CREATE TABLE IF NOT EXISTS calc_scenarios (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id),
  business_id     UUID REFERENCES businesses(id),
  name            TEXT,
  investment_amt  NUMERIC,
  expected_growth NUMERIC,      -- % annual revenue growth
  years           INT,
  projected_return NUMERIC,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Q&A / INVESTOR QUESTIONS ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS offering_qa (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  offering_id UUID NOT NULL REFERENCES offerings(id),
  user_id     UUID NOT NULL REFERENCES users(id),
  question    TEXT NOT NULL,
  answer      TEXT,
  answered_by UUID REFERENCES users(id),
  answered_at TIMESTAMPTZ,
  is_public   BOOLEAN DEFAULT TRUE,
  upvotes     INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── NEIGHBORHOOD ZONES ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS neighborhoods (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  city        TEXT NOT NULL,
  state       TEXT NOT NULL,
  latitude    NUMERIC,
  longitude   NUMERIC,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS neighborhood_id UUID REFERENCES neighborhoods(id),
  ADD COLUMN IF NOT EXISTS latitude        NUMERIC,
  ADD COLUMN IF NOT EXISTS longitude       NUMERIC,
  ADD COLUMN IF NOT EXISTS google_place_id TEXT,
  ADD COLUMN IF NOT EXISTS referral_code   TEXT,
  ADD COLUMN IF NOT EXISTS impact_score    NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_jobs      INT DEFAULT 0;

ALTER TABLE offerings
  ADD COLUMN IF NOT EXISTS video_url         TEXT,
  ADD COLUMN IF NOT EXISTS investor_perks    TEXT,
  ADD COLUMN IF NOT EXISTS milestone_targets JSONB,
  ADD COLUMN IF NOT EXISTS featured          BOOLEAN DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS referral_code      TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by        UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS referral_balance   NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notification_prefs JSONB DEFAULT '{"email":true,"sms":false}',
  ADD COLUMN IF NOT EXISTS bio                TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url         TEXT,
  ADD COLUMN IF NOT EXISTS city               TEXT,
  ADD COLUMN IF NOT EXISTS state              TEXT,
  ADD COLUMN IF NOT EXISTS investment_style   TEXT;

-- ── INDEXES ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_secondary_status    ON secondary_listings(status);
CREATE INDEX IF NOT EXISTS idx_secondary_business  ON secondary_listings(business_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user  ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_updates_business    ON business_updates(business_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_user      ON watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_business    ON business_reviews(business_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code      ON referrals(referral_code);

COMMIT;
