// routes/compliance.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { calcInvestmentLimit, checkInvestorLimit, checkAccreditation } = require('../lib/regcf');

const router = express.Router();

// GET /api/compliance/status
router.get('/status', requireAuth, async (req, res) => {
  const u = req.user;
  const { limit, basis } = calcInvestmentLimit(u);
  const limitCheck = await checkInvestorLimit(u.id, 0);

  const { data: docs } = await db.query(
    `SELECT doc_type, status, created_at, reviewed_at FROM kyc_documents WHERE user_id = $1 ORDER BY created_at DESC`,
    [u.id]
  );

  res.json({
    kyc_status:             u.kyc_status,
    is_accredited:          u.is_accredited,
    investment_limit:       limit,
    investment_limit_basis: basis,
    invested_last_12m:      limitCheck.limit !== null ? (limit - (limitCheck.remaining || 0)) : 0,
    remaining_limit:        limitCheck.remaining ?? null,
    kyc_documents:          docs || [],
    required_actions:       buildActions(u),
  });
});

// GET /api/compliance/limits?amount=5000
router.get('/limits', requireAuth, async (req, res) => {
  const amount = req.query.amount ? parseFloat(req.query.amount) : 0;
  const result = await checkInvestorLimit(req.user.id, amount);
  res.json(result);
});

// POST /api/compliance/kyc — submit KYC documents
router.post('/kyc', requireAuth, async (req, res) => {
  const { doc_type, file_url } = req.body;
  const validTypes = ['passport','drivers_license','national_id','proof_of_address'];
  if (!validTypes.includes(doc_type)) return res.status(400).json({ error: 'Invalid document type.' });
  if (!file_url) return res.status(400).json({ error: 'file_url is required.' });

  if (req.user.kyc_status === 'approved') {
    return res.status(400).json({ error: 'Your KYC is already approved.' });
  }

  await db.insert('kyc_documents', {
    id:         uuidv4(),
    user_id:    req.user.id,
    doc_type,
    file_url,
    status:     'pending',
    created_at: new Date(),
  }, { returning: 'id' });

  await db.update('users',
    { kyc_status: 'submitted', kyc_submitted_at: new Date(), updated_at: new Date() },
    { id: req.user.id }
  );

  res.json({ message: 'KYC submitted. Review takes 1–2 business days.' });
});

// GET /api/compliance/kyc/status
router.get('/kyc/status', requireAuth, async (req, res) => {
  const { data: docs } = await db.query(
    `SELECT id, doc_type, status, reviewer_notes, created_at, reviewed_at
     FROM kyc_documents WHERE user_id = $1 ORDER BY created_at DESC`,
    [req.user.id]
  );
  res.json({ kyc_status: req.user.kyc_status, documents: docs || [] });
});

// PATCH /api/compliance/kyc/:userId/approve — admin
router.patch('/kyc/:userId/approve', requireAuth, requireRole('admin'), async (req, res) => {
  const { decision, notes } = req.body;
  if (!['approved','rejected'].includes(decision)) {
    return res.status(400).json({ error: "decision must be 'approved' or 'rejected'." });
  }

  await db.query(
    `UPDATE kyc_documents SET status = $1, reviewer_notes = $2, reviewed_by = $3, reviewed_at = NOW()
     WHERE user_id = $4 AND status = 'pending'`,
    [decision, notes || null, req.user.id, req.params.userId]
  );

  await db.update('users',
    {
      kyc_status:     decision,
      kyc_approved_at: decision === 'approved' ? new Date() : null,
      updated_at:     new Date(),
    },
    { id: req.params.userId }
  );

  res.json({ message: `KYC ${decision} for user ${req.params.userId}.` });
});

// POST /api/compliance/accreditation
router.post('/accreditation', requireAuth, async (req, res) => {
  const { annual_income, net_worth, self_certify } = req.body;
  if (annual_income == null || net_worth == null) {
    return res.status(400).json({ error: 'annual_income and net_worth are required.' });
  }

  const { is_accredited, income_qualifies, worth_qualifies } = checkAccreditation({ annual_income, net_worth });
  const finalAccredited = self_certify && is_accredited;

  await db.update('users',
    { annual_income, net_worth, is_accredited: finalAccredited, updated_at: new Date() },
    { id: req.user.id }
  );

  // Log compliance check
  await db.insert('compliance_checks', {
    id:         uuidv4(),
    user_id:    req.user.id,
    check_type: 'accreditation',
    passed:     finalAccredited,
    details:    JSON.stringify({ annual_income, net_worth, income_qualifies, worth_qualifies }),
    checked_at: new Date(),
  }, { returning: 'id' });

  const { limit, basis } = calcInvestmentLimit({ annual_income, net_worth, is_accredited: finalAccredited });

  res.json({
    is_accredited:    finalAccredited,
    investment_limit: limit,
    basis,
    message: finalAccredited
      ? 'Accreditation verified. No investment limits apply.'
      : `Annual investment limit: $${limit?.toLocaleString()}.`,
  });
});

// POST /api/compliance/risk-disclosure
router.post('/risk-disclosure', requireAuth, async (req, res) => {
  const { offering_id, acknowledged } = req.body;
  if (!acknowledged) return res.status(400).json({ error: 'You must acknowledge the risk disclosures.' });

  await db.insert('risk_disclosure_acknowledgments', {
    id:          uuidv4(),
    user_id:     req.user.id,
    offering_id: offering_id || null,
    acknowledged: true,
    acknowledged_at: new Date(),
    ip_address:  req.ip,
  }, { returning: 'id' }).catch(() => {}); // table may not exist yet

  res.json({ message: 'Risk disclosure acknowledged.' });
});

// POST /api/compliance/validate-investment
router.post('/validate-investment', requireAuth, async (req, res) => {
  const { offering_id, amount } = req.body;
  if (!offering_id || !amount) return res.status(400).json({ error: 'offering_id and amount required.' });

  const limitCheck = await checkInvestorLimit(req.user.id, amount);
  if (!limitCheck.allowed) return res.status(400).json({ valid: false, error: limitCheck.error });

  const { data: offering } = await db.select('offerings', { where: { id: offering_id }, single: true });
  if (!offering) return res.status(404).json({ error: 'Offering not found.' });

  const remaining = offering.target_amount - offering.amount_raised;
  if (amount > remaining) {
    return res.status(400).json({ valid: false, error: `Only $${remaining.toLocaleString()} capacity remains.` });
  }

  res.json({ valid: true, equity_share: (amount / offering.target_amount * offering.equity_percent).toFixed(4), ...limitCheck });
});

// GET /api/compliance/offering/:id — public offering compliance info
router.get('/offering/:id', async (req, res) => {
  const { data: offering } = await db.select('offerings', { where: { id: req.params.id }, single: true });
  if (!offering) return res.status(404).json({ error: 'Offering not found.' });

  res.json({
    offering_id:      offering.id,
    offering_type:    'reg_cf',
    max_offering:     5_000_000,
    target_amount:    offering.target_amount,
    amount_raised:    offering.amount_raised,
    funding_percent:  Math.round((offering.amount_raised / offering.target_amount) * 100),
    closes_at:        offering.closes_at,
    risk_factors:     JSON.parse(offering.risk_factors || '[]'),
    use_of_proceeds:  offering.use_of_proceeds,
    disclosures: [
      'This offering is made under Regulation Crowdfunding (17 CFR Part 227).',
      'If the target is not reached, all investor funds will be returned in full.',
      'Securities sold are subject to a 1-year resale restriction.',
      'EquityBridge is a funding portal and does not provide investment advice.',
    ],
  });
});

function buildActions(user) {
  const actions = [];
  if (user.kyc_status === 'pending')   actions.push({ code:'submit_kyc',    msg:'Submit identity documents to unlock investing.' });
  if (user.kyc_status === 'rejected')  actions.push({ code:'resubmit_kyc',  msg:'KYC rejected. Please resubmit valid documents.' });
  if (!user.annual_income)             actions.push({ code:'financial_info', msg:'Enter income/net worth to set your investment limit.' });
  return actions;
}

module.exports = router;
