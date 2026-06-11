// routes/investments.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const { requireAuth, requireRole, requireKYC } = require('../middleware/auth');
const { checkInvestorLimit, canCancelInvestment } = require('../lib/regcf');
const paymentProcessor = require('../lib/payment-processor');
const escrowManager    = require('../lib/escrow-manager');

const PLATFORM_FEE_PCT = parseFloat(process.env.PLATFORM_FEE_PERCENT || '2.5');

const router = express.Router();

// POST /api/investments — create investment
router.post('/', requireAuth, requireRole('investor','admin'), requireKYC, async (req, res) => {
  const { offering_id, amount } = req.body;
  if (!offering_id || !amount) return res.status(400).json({ error: 'offering_id and amount are required.' });
  if (amount < (process.env.MIN_INVESTMENT_AMOUNT || 250)) {
    return res.status(400).json({ error: `Minimum investment is $${process.env.MIN_INVESTMENT_AMOUNT || 250}.` });
  }

  // Load offering
  const { data: rows } = await db.query(
    `SELECT o.*, b.name as business_name, b.id as business_id FROM offerings o
     JOIN businesses b ON o.business_id = b.id WHERE o.id = $1`, [offering_id]
  );
  const offering = rows?.[0];
  if (!offering) return res.status(404).json({ error: 'Offering not found.' });
  if (offering.status !== 'active') return res.status(400).json({ error: 'This offering is not currently active.' });

  // Min/max investment checks
  if (amount < offering.min_investment) {
    return res.status(400).json({ error: `Minimum investment is $${offering.min_investment}.` });
  }
  if (offering.max_investment && amount > offering.max_investment) {
    return res.status(400).json({ error: `Maximum investment is $${offering.max_investment}.` });
  }

  // Reg CF limit check
  const limitCheck = await checkInvestorLimit(req.user.id, amount);
  if (!limitCheck.allowed) return res.status(400).json({ error: limitCheck.error, limit: limitCheck.limit, remaining: limitCheck.remaining });

  // Capacity check
  const remaining = offering.target_amount - offering.amount_raised;
  if (amount > remaining) {
    return res.status(400).json({ error: `Only $${remaining.toLocaleString()} capacity remains in this offering.` });
  }

  const equityShare  = (amount / offering.target_amount) * offering.equity_percent;
  const platformFee  = (amount * PLATFORM_FEE_PCT) / 100;
  const totalCharge  = amount + platformFee;
  const investmentId = uuidv4();

  // Create payment intent
  const { data: intent, error: piErr } = await paymentProcessor.createPaymentIntent({
    userId:      req.user.id,
    amount:      Math.round(totalCharge * 100),
    description: `Investment in ${offering.business_name}`,
    metadata:    { offering_id, investment_id: investmentId, equity_share: equityShare.toFixed(4) }
  });
  if (piErr) return res.status(500).json({ error: piErr });

  // Create investment record
  const { data: investment, error: invErr } = await db.insert('investments', {
    id:           investmentId,
    offering_id,
    investor_id:  req.user.id,
    business_id:  offering.business_id,
    amount,
    equity_share: equityShare,
    platform_fee: platformFee,
    payment_intent_id: intent.intent_id,
    status:       'pending',
    cancellable_until: new Date(Math.min(
      new Date(offering.closes_at).getTime() - 48 * 3_600_000,
      Date.now() + 30 * 24 * 3_600_000
    )),
    created_at:   new Date(),
    updated_at:   new Date(),
  }, { returning: '*' });

  if (invErr) return res.status(500).json({ error: invErr });

  res.status(201).json({
    investment: {
      id:           investmentId,
      amount,
      equity_share: equityShare,
      platform_fee: platformFee,
      total_charge: totalCharge,
      cancellable_until: investment.cancellable_until,
    },
    payment: {
      intent_id:     intent.intent_id,
      client_secret: intent.client_secret,
      amount:        totalCharge,
    },
  });
});

// POST /api/investments/:id/confirm-payment — confirm payment & move to escrow
router.post('/:id/confirm-payment', requireAuth, async (req, res) => {
  const { payment_method = 'bank_transfer', payer_details } = req.body;

  const { data: inv } = await db.select('investments', { where: { id: req.params.id }, single: true });
  if (!inv || inv.investor_id !== req.user.id) return res.status(404).json({ error: 'Investment not found.' });
  if (inv.status !== 'pending') return res.status(400).json({ error: 'Investment is not in pending state.' });

  // Confirm payment
  const { data: payment, error: payErr } = await paymentProcessor.confirmPayment(
    inv.payment_intent_id, { paymentMethod: payment_method, payerDetails: payer_details }
  );
  if (payErr) return res.status(400).json({ error: payErr });

  // Create & deposit escrow
  const { data: offeringRows } = await db.query(
    `SELECT business_id FROM offerings WHERE id = $1`, [inv.offering_id]
  );
  const escrow = await escrowManager.createEscrowTransaction({
    investmentId: inv.id,
    userId:       req.user.id,
    businessId:   offeringRows?.[0]?.business_id,
    offeringId:   inv.offering_id,
    amount:       inv.amount,
  });
  if (!escrow.error) {
    await escrowManager.depositToEscrow(escrow.data.escrow_id, payment.payment_id);
  }

  // Update investment to escrowed
  await db.update('investments',
    { status: 'escrowed', escrow_id: escrow.data?.escrow_id, payment_id: payment.payment_id, updated_at: new Date() },
    { id: inv.id }
  );

  // Update offering amount_raised
  await db.query(
    `UPDATE offerings SET amount_raised = amount_raised + $1, updated_at = NOW() WHERE id = $2`,
    [inv.amount, inv.offering_id]
  );

  // Check if fully funded
  await checkAndCloseOffering(inv.offering_id);

  res.json({ message: 'Payment confirmed. Funds are in escrow.', investment_id: inv.id });
});

// GET /api/investments/my-investments
router.get('/my-investments', requireAuth, async (req, res) => {
  const { data, error } = await db.query(
    `SELECT i.*,
       o.equity_percent as offering_equity, o.target_amount, o.closes_at, o.status as offering_status,
       b.name as business_name, b.category, b.location_city, b.location_state, b.logo_url,
       COALESCE((SELECT SUM(d.amount) FROM distributions d WHERE d.investment_id = i.id), 0) as total_distributions
     FROM investments i
     JOIN offerings o ON i.offering_id = o.id
     JOIN businesses b ON i.business_id = b.id
     WHERE i.investor_id = $1
     ORDER BY i.created_at DESC`,
    [req.user.id]
  );
  if (error) return res.status(500).json({ error });

  const active   = (data||[]).filter(i => ['escrowed','completed'].includes(i.status));
  const totalInvested = active.reduce((s,i) => s + parseFloat(i.amount), 0);
  const totalEquity   = active.reduce((s,i) => s + parseFloat(i.equity_share||0), 0);
  const totalDist     = active.reduce((s,i) => s + parseFloat(i.total_distributions||0), 0);

  res.json({
    investments: data,
    portfolio: { total_invested: totalInvested, total_equity_pct: totalEquity, total_distributions: totalDist, active_count: active.length }
  });
});

// GET /api/investments/:id
router.get('/:id', requireAuth, async (req, res) => {
  const { data, error } = await db.query(
    `SELECT i.*, o.*, b.name as business_name, b.category, b.logo_url
     FROM investments i
     JOIN offerings o ON i.offering_id = o.id
     JOIN businesses b ON i.business_id = b.id
     WHERE i.id = $1 AND (i.investor_id = $2 OR $3 = 'admin')`,
    [req.params.id, req.user.id, req.user.role]
  );
  if (error || !data?.length) return res.status(404).json({ error: 'Investment not found.' });
  res.json({ investment: data[0] });
});

// POST /api/investments/:id/cancel
router.post('/:id/cancel', requireAuth, async (req, res) => {
  const { data: inv } = await db.select('investments', { where: { id: req.params.id }, single: true });
  if (!inv || inv.investor_id !== req.user.id) return res.status(404).json({ error: 'Investment not found.' });
  if (!['pending','escrowed'].includes(inv.status)) {
    return res.status(400).json({ error: 'This investment cannot be cancelled.' });
  }

  // Check Reg CF cancellation window
  const { data: offering } = await db.select('offerings', { where: { id: inv.offering_id }, single: true });
  const { canCancel, reason } = canCancelInvestment(offering?.closes_at);
  if (!canCancel) return res.status(400).json({ error: reason });

  // Refund
  if (inv.payment_id) {
    await paymentProcessor.refundPayment(inv.payment_id, { reason: 'investor_cancellation' });
  }
  if (inv.escrow_id) {
    await escrowManager.returnEscrow(inv.escrow_id, 'investor_cancellation');
  }

  // Update offering amount_raised
  await db.query(
    `UPDATE offerings SET amount_raised = GREATEST(0, amount_raised - $1), updated_at = NOW() WHERE id = $2`,
    [inv.amount, inv.offering_id]
  );

  await db.update('investments',
    { status: 'cancelled', cancelled_at: new Date(), cancel_reason: req.body.reason || 'Investor requested', updated_at: new Date() },
    { id: inv.id }
  );

  res.json({ message: 'Investment cancelled and refund initiated.' });
});

// GET /api/investments/complete/:offering_id — admin completes all
router.post('/complete-offering/:offering_id', requireAuth, requireRole('admin'), async (req, res) => {
  const { data: investments } = await db.query(
    `SELECT id, escrow_id FROM investments WHERE offering_id = $1 AND status = 'escrowed'`,
    [req.params.offering_id]
  );
  if (!investments?.length) return res.status(400).json({ error: 'No escrowed investments found.' });

  for (const inv of investments) {
    await db.update('investments', { status: 'completed', updated_at: new Date() }, { id: inv.id });
    if (inv.escrow_id) await escrowManager.releaseEscrow(inv.escrow_id, 'offering_complete', req.user.id);
  }

  await db.update('offerings', { status: 'funded', updated_at: new Date() }, { id: req.params.offering_id });
  res.json({ message: `${investments.length} investments completed and escrow released.` });
});

// ── HELPER ────────────────────────────────────────────────────────
async function checkAndCloseOffering(offeringId) {
  const { data } = await db.select('offerings', { where: { id: offeringId }, single: true });
  if (data && data.amount_raised >= data.target_amount) {
    await db.update('offerings', { status: 'funded', funded_at: new Date(), updated_at: new Date() }, { id: offeringId });
  }
}

module.exports = router;
