-- EquityBridge — Complete PostgreSQL Schema
-- Run: psql -U postgres -d equitybridge -f migrations/001_init_schema.sql

BEGIN;

-- ── EXTENSIONS ────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── USERS ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email              TEXT NOT NULL UNIQUE,
  password_hash      TEXT NOT NULL,
  first_name         TEXT NOT NULL DEFAULT '',
  last_name          TEXT NOT NULL DEFAULT '',
  role               TEXT NOT NULL DEFAULT 'investor' CHECK (role IN ('investor','owner','admin')),
  phone              TEXT,
  date_of_birth      DATE,
  address_line1      TEXT,
  address_city       TEXT,
  address_state      TEXT,
  address_zip        TEXT,
  address_country    TEXT DEFAULT 'US',

  -- KYC
  kyc_status         TEXT NOT NULL DEFAULT 'pending'
                       CHECK (kyc_status IN ('pending','submitted','approved','rejected')),
  kyc_submitted_at   TIMESTAMPTZ,
  kyc_approved_at    TIMESTAMPTZ,

  -- Financial / Accreditation
  is_accredited      BOOLEAN DEFAULT FALSE,
  annual_income      NUMERIC,
  net_worth          NUMERIC,

  -- Account state
  is_suspended       BOOLEAN DEFAULT FALSE,
  suspension_reason  TEXT,
  last_login         TIMESTAMPTZ,

  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ── PASSWORD RESET TOKENS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── KYC DOCUMENTS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kyc_documents (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type       TEXT NOT NULL CHECK (doc_type IN ('passport','drivers_license','national_id','proof_of_address','tax_return','bank_statement')),
  file_url       TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewer_notes TEXT,
  reviewed_by    UUID REFERENCES users(id),
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── COMPLIANCE CHECKS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance_checks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  check_type  TEXT NOT NULL CHECK (check_type IN ('investment_limit','kyc','aml','accreditation')),
  passed      BOOLEAN NOT NULL,
  details     JSONB,
  checked_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── APPLICATIONS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS applications (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            UUID NOT NULL REFERENCES users(id),
  business_name      TEXT NOT NULL,
  category           TEXT NOT NULL,
  description        TEXT,
  location           JSONB,
  entity_documents   JSONB,
  ownership_details  JSONB,
  financials         JSONB,
  business_licenses  JSONB,
  lease_information  JSONB,
  business_plan      JSONB,
  debt_information   JSONB,
  litigation_history JSONB,
  status             TEXT NOT NULL DEFAULT 'submitted'
                       CHECK (status IN ('submitted','under_review','approved','rejected','needs_info')),
  submitted_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ── COMPLIANCE REVIEWS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance_reviews (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id         UUID NOT NULL REFERENCES applications(id),
  entity_verification    BOOLEAN DEFAULT FALSE,
  ownership_verification BOOLEAN DEFAULT FALSE,
  financial_review       BOOLEAN DEFAULT FALSE,
  license_verification   BOOLEAN DEFAULT FALSE,
  lease_verification     BOOLEAN DEFAULT FALSE,
  fraud_risk_assessment  TEXT DEFAULT 'medium' CHECK (fraud_risk_assessment IN ('low','medium','high')),
  findings               TEXT,
  recommendations        TEXT,
  reviewed_by            UUID REFERENCES users(id),
  reviewed_at            TIMESTAMPTZ,
  status                 TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','approved','rejected','needs_info')),
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

-- ── BUSINESSES ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS businesses (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id         UUID NOT NULL REFERENCES users(id),
  application_id   UUID REFERENCES applications(id),
  name             TEXT NOT NULL,
  slug             TEXT UNIQUE,
  category         TEXT NOT NULL CHECK (category IN ('restaurant','cafe','retail','bakery','bar','service','other')),
  description      TEXT,
  location_address TEXT,
  location_city    TEXT NOT NULL,
  location_state   TEXT NOT NULL,
  location_zip     TEXT,
  website          TEXT,
  founded_year     INT,
  annual_revenue   NUMERIC,
  monthly_revenue  NUMERIC,
  employee_count   INT,
  logo_url         TEXT,
  pitch_deck_url   TEXT,
  financials_url   TEXT,
  verified         BOOLEAN DEFAULT FALSE,
  approved_at      TIMESTAMPTZ,
  rejection_reason TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','under_review','approved','rejected','suspended')),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── OFFERINGS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS offerings (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id      UUID NOT NULL REFERENCES businesses(id),
  equity_percent   NUMERIC NOT NULL CHECK (equity_percent > 0 AND equity_percent <= 100),
  target_amount    NUMERIC NOT NULL CHECK (target_amount > 0),
  min_investment   NUMERIC NOT NULL DEFAULT 250,
  max_investment   NUMERIC,
  valuation        NUMERIC,
  amount_raised    NUMERIC NOT NULL DEFAULT 0,
  use_of_proceeds  TEXT NOT NULL,
  risk_factors     JSONB,
  offering_type    TEXT DEFAULT 'reg_cf',
  opens_at         TIMESTAMPTZ DEFAULT NOW(),
  closes_at        TIMESTAMPTZ NOT NULL,
  published_at     TIMESTAMPTZ,
  funded_at        TIMESTAMPTZ,
  closed_at        TIMESTAMPTZ,
  notice_sent_at   TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','active','paused','funded','closed','cancelled')),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── PAYMENT INTENTS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_intents (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  intent_id   TEXT NOT NULL UNIQUE,
  user_id     UUID NOT NULL REFERENCES users(id),
  amount      BIGINT NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'usd',
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','completed','cancelled','failed')),
  payment_id  TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── PAYMENTS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id     TEXT NOT NULL UNIQUE,
  intent_id      TEXT REFERENCES payment_intents(intent_id),
  user_id        UUID NOT NULL REFERENCES users(id),
  amount         BIGINT NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'usd',
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','completed','refunded','failed')),
  payment_method TEXT,
  payer_details  JSONB,
  description    TEXT,
  metadata       JSONB,
  refund_id      TEXT,
  paid_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── REFUNDS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refunds (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  refund_id   TEXT NOT NULL UNIQUE,
  payment_id  TEXT NOT NULL,
  user_id     UUID NOT NULL REFERENCES users(id),
  amount      BIGINT NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'usd',
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed')),
  refunded_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── INVESTMENTS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS investments (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  offering_id       UUID NOT NULL REFERENCES offerings(id),
  investor_id       UUID NOT NULL REFERENCES users(id),
  business_id       UUID NOT NULL REFERENCES businesses(id),
  amount            NUMERIC NOT NULL,
  equity_share      NUMERIC,
  platform_fee      NUMERIC,
  payment_intent_id TEXT,
  payment_id        TEXT,
  escrow_id         TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','escrowed','completed','cancelled','refunded')),
  cancellable_until TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,
  cancel_reason     TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (offering_id, investor_id)
);

-- ── ESCROW TRANSACTIONS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS escrow_transactions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  escrow_id      TEXT NOT NULL UNIQUE,
  investment_id  UUID REFERENCES investments(id),
  user_id        UUID NOT NULL REFERENCES users(id),
  business_id    UUID REFERENCES businesses(id),
  offering_id    UUID REFERENCES offerings(id),
  payment_id     TEXT,
  amount         NUMERIC NOT NULL,
  currency       TEXT DEFAULT 'usd',
  status         TEXT NOT NULL DEFAULT 'created'
                   CHECK (status IN ('created','pending','deposited','released','returned','disputed')),
  release_reason TEXT,
  released_by    UUID REFERENCES users(id),
  released_at    TIMESTAMPTZ,
  deposited_at   TIMESTAMPTZ,
  return_reason  TEXT,
  returned_at    TIMESTAMPTZ,
  dispute_reason TEXT,
  disputed_by    UUID REFERENCES users(id),
  disputed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── PAYOUTS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payouts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  escrow_id   TEXT,
  business_id UUID REFERENCES businesses(id),
  amount      NUMERIC NOT NULL,
  currency    TEXT DEFAULT 'usd',
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  released_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── DISTRIBUTIONS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS distributions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  investment_id UUID REFERENCES investments(id),
  investor_id   UUID NOT NULL REFERENCES users(id),
  business_id   UUID REFERENCES businesses(id),
  offering_id   UUID REFERENCES offerings(id),
  amount        NUMERIC NOT NULL,
  period_label  TEXT,
  status        TEXT DEFAULT 'paid',
  paid_at       TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── SUBSCRIPTIONS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  investor_id   UUID NOT NULL REFERENCES users(id),
  offering_id   UUID REFERENCES offerings(id),
  investment_id UUID REFERENCES investments(id),
  amount        NUMERIC,
  equity_share  NUMERIC,
  status        TEXT DEFAULT 'active',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── SECURITIES ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS securities (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  investment_id      UUID REFERENCES investments(id),
  investor_id        UUID NOT NULL REFERENCES users(id),
  business_id        UUID REFERENCES businesses(id),
  offering_id        UUID REFERENCES offerings(id),
  equity_share       NUMERIC,
  certificate_number TEXT UNIQUE,
  status             TEXT DEFAULT 'active',
  issued_at          TIMESTAMPTZ DEFAULT NOW(),
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ── RISK DISCLOSURE ACKNOWLEDGMENTS ──────────────────────────────
CREATE TABLE IF NOT EXISTS risk_disclosure_acknowledgments (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES users(id),
  offering_id      UUID REFERENCES offerings(id),
  acknowledged     BOOLEAN DEFAULT TRUE,
  acknowledged_at  TIMESTAMPTZ DEFAULT NOW(),
  ip_address       TEXT
);

-- ── INDEXES ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_email         ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role          ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_kyc           ON users(kyc_status);
CREATE INDEX IF NOT EXISTS idx_businesses_owner    ON businesses(owner_id);
CREATE INDEX IF NOT EXISTS idx_businesses_status   ON businesses(status);
CREATE INDEX IF NOT EXISTS idx_businesses_category ON businesses(category);
CREATE INDEX IF NOT EXISTS idx_offerings_business  ON offerings(business_id);
CREATE INDEX IF NOT EXISTS idx_offerings_status    ON offerings(status);
CREATE INDEX IF NOT EXISTS idx_investments_investor ON investments(investor_id);
CREATE INDEX IF NOT EXISTS idx_investments_offering ON investments(offering_id);
CREATE INDEX IF NOT EXISTS idx_investments_status   ON investments(status);
CREATE INDEX IF NOT EXISTS idx_escrow_offering      ON escrow_transactions(offering_id);
CREATE INDEX IF NOT EXISTS idx_escrow_investment    ON escrow_transactions(investment_id);
CREATE INDEX IF NOT EXISTS idx_payments_user        ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_user             ON kyc_documents(user_id);

-- ── AUTO-UPDATE updated_at ────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ DECLARE t TEXT;
BEGIN FOR t IN SELECT unnest(ARRAY['users','businesses','offerings','investments','applications','compliance_reviews','escrow_transactions','payment_intents','payments','subscriptions'])
  LOOP EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated ON %I; CREATE TRIGGER trg_%I_updated BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at()', t,t,t,t);
  END LOOP;
END $$;

-- ── SEED ADMIN USER ───────────────────────────────────────────────
-- Password: Admin@12345  (bcrypt hash — change in production!)
-- INSERT INTO users (id, email, password_hash, first_name, last_name, role, kyc_status)
-- VALUES (uuid_generate_v4(), 'admin@equitybridge.com',
--   '$2a$10$wKoMBVXDK3K1sL0/a8Cd0.zFbC0zQW1lN5WjEiNs4J8p2Y9BzMOai',
--   'Admin', 'User', 'admin', 'approved');

COMMIT;
