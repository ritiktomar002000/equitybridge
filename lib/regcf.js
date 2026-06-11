// lib/regcf.js — Regulation Crowdfunding Compliance Logic
const db = require('./db');

const REGCF_MAX_OFFERING    = 5_000_000;
const NON_ACCRED_BASE_LIMIT = 2_500;
const ACCRED_INCOME_MIN     = 200_000;
const ACCRED_NET_WORTH_MIN  = 1_000_000;
const THRESHOLD             = 124_000;

// ── INVESTOR LIMIT CALCULATOR ─────────────────────────────────────
function calcInvestmentLimit({ annual_income = 0, net_worth = 0, is_accredited = false }) {
  if (is_accredited) return { limit: null, basis: 'accredited_no_limit' };

  const lesser = Math.min(annual_income, net_worth);

  let limit, basis;
  if (annual_income < THRESHOLD || net_worth < THRESHOLD) {
    limit = Math.max(NON_ACCRED_BASE_LIMIT, lesser * 0.05);
    basis = '5pct_of_lesser_income_or_networth';
  } else {
    limit = Math.min(lesser * 0.10, THRESHOLD);
    basis = '10pct_of_lesser_capped_at_124k';
  }

  return { limit: Math.round(limit * 100) / 100, basis };
}

// ── CHECK INVESTOR LIMIT ──────────────────────────────────────────
async function checkInvestorLimit(userId, proposedAmount) {
  // Get investor profile
  const { data: user } = await db.select('users', {
    columns: 'is_accredited, annual_income, net_worth',
    where:   { id: userId },
    single:  true,
  });
  if (!user) return { allowed: false, error: 'User not found.' };

  const { limit, basis } = calcInvestmentLimit(user);
  if (limit === null) return { allowed: true, limit: null, basis }; // accredited

  // Total invested last 12 months
  const twelveAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const { data: rows } = await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM investments
     WHERE investor_id = $1 AND created_at > $2 AND status IN ('deposited','completed','escrowed')`,
    [userId, twelveAgo]
  );

  const alreadyInvested = parseFloat(rows?.[0]?.total || 0);
  const remaining       = Math.max(0, limit - alreadyInvested);

  if (proposedAmount > remaining) {
    return {
      allowed:   false,
      limit,
      remaining,
      basis,
      error:     `Investment of $${proposedAmount} exceeds your remaining Reg CF limit of $${remaining.toFixed(2)}.`
    };
  }

  return { allowed: true, limit, remaining: remaining - proposedAmount, basis };
}

// ── CHECK OFFERING LIMIT ──────────────────────────────────────────
async function checkOfferingLimit(businessId, proposedAmount) {
  const twelveAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const { data: rows } = await db.query(
    `SELECT COALESCE(SUM(target_amount), 0) AS raised
     FROM offerings
     WHERE business_id = $1 AND created_at > $2 AND status IN ('active','funded','closed')`,
    [businessId, twelveAgo]
  );

  const raised    = parseFloat(rows?.[0]?.raised || 0);
  const remaining = REGCF_MAX_OFFERING - raised;

  if (proposedAmount > remaining) {
    return {
      allowed: false,
      error:   `Offering would exceed the $5M Reg CF annual limit. Max additional: $${remaining.toLocaleString()}`
    };
  }
  return { allowed: true };
}

// ── CHECK ACCREDITATION ───────────────────────────────────────────
function checkAccreditation({ annual_income, net_worth }) {
  const qualifies = annual_income >= ACCRED_INCOME_MIN || net_worth >= ACCRED_NET_WORTH_MIN;
  return { is_accredited: qualifies, income_qualifies: annual_income >= ACCRED_INCOME_MIN, worth_qualifies: net_worth >= ACCRED_NET_WORTH_MIN };
}

// ── CANCELLATION WINDOW ───────────────────────────────────────────
function canCancelInvestment(closesAt) {
  const hoursToClose = (new Date(closesAt) - Date.now()) / 3_600_000;
  if (hoursToClose > 48) return { canCancel: true };
  return { canCancel: false, reason: 'Within 48 hours of offering close — cancellation window has passed.' };
}

// ── GENERATE RISK FACTORS ─────────────────────────────────────────
function generateRiskFactors(businessName) {
  return [
    'Investing in small businesses involves a high degree of risk including total loss of investment.',
    `${businessName} is an early-stage company and may not achieve its business objectives.`,
    'Securities offered through Reg CF are illiquid and subject to a 1-year resale restriction.',
    'This offering has not been reviewed by the SEC. Investors should review all disclosures.',
    'The financial projections provided are estimates only and are not guaranteed.',
    'Equity crowdfunding investments are not FDIC insured and are not bank deposits.',
  ];
}

module.exports = {
  calcInvestmentLimit,
  checkInvestorLimit,
  checkOfferingLimit,
  checkAccreditation,
  canCancelInvestment,
  generateRiskFactors,
  REGCF_MAX_OFFERING,
};
