// lib/escrow-manager.js — Custom Escrow Management
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

// Escrow status flow:
// created → deposited → released | returned | disputed

// ── CREATE ESCROW ─────────────────────────────────────────────────
async function createEscrowTransaction({ investmentId, userId, businessId, offeringId, amount, currency = 'usd' }) {
  const escrowId = `esc_${uuidv4().replace(/-/g, '').slice(0, 20)}`;

  const result = await db.insert('escrow_transactions', {
    id:            uuidv4(),
    escrow_id:     escrowId,
    investment_id: investmentId,
    user_id:       userId,
    business_id:   businessId,
    offering_id:   offeringId || null,
    amount,
    currency,
    status:        'created',
    created_at:    new Date(),
    updated_at:    new Date(),
  }, { returning: '*' });

  return result;
}

// ── DEPOSIT TO ESCROW ─────────────────────────────────────────────
async function depositToEscrow(escrowId, paymentId = null) {
  const { data: escrow } = await db.select('escrow_transactions', {
    where: { escrow_id: escrowId }, single: true
  });
  if (!escrow) return { data: null, error: 'Escrow not found.' };
  if (!['created', 'pending'].includes(escrow.status)) {
    return { data: null, error: `Cannot deposit to escrow in status: ${escrow.status}` };
  }

  return db.update('escrow_transactions',
    { status: 'deposited', payment_id: paymentId, deposited_at: new Date(), updated_at: new Date() },
    { escrow_id: escrowId },
    { returning: '*' }
  );
}

// ── RELEASE ESCROW (funds go to business) ─────────────────────────
async function releaseEscrow(escrowId, reason, releasedByAdminId) {
  const { data: escrow } = await db.select('escrow_transactions', {
    where: { escrow_id: escrowId }, single: true
  });
  if (!escrow) return { data: null, error: 'Escrow not found.' };
  if (escrow.status !== 'deposited') {
    return { data: null, error: `Can only release escrow in 'deposited' status. Current: ${escrow.status}` };
  }

  const result = await db.update('escrow_transactions',
    {
      status:           'released',
      release_reason:   reason || 'offering_complete',
      released_by:      releasedByAdminId,
      released_at:      new Date(),
      updated_at:       new Date(),
    },
    { escrow_id: escrowId },
    { returning: '*' }
  );

  // Create payout record
  if (!result.error) {
    await db.insert('payouts', {
      id:            uuidv4(),
      escrow_id:     escrowId,
      business_id:   escrow.business_id,
      amount:        escrow.amount,
      currency:      escrow.currency,
      status:        'pending',
      released_at:   new Date(),
      created_at:    new Date(),
    }, { returning: 'id' });
  }

  return result;
}

// ── RETURN ESCROW (refund to investor) ────────────────────────────
async function returnEscrow(escrowId, reason) {
  const { data: escrow } = await db.select('escrow_transactions', {
    where: { escrow_id: escrowId }, single: true
  });
  if (!escrow) return { data: null, error: 'Escrow not found.' };
  if (!['deposited', 'disputed'].includes(escrow.status)) {
    return { data: null, error: `Cannot return escrow in status: ${escrow.status}` };
  }

  return db.update('escrow_transactions',
    {
      status:       'returned',
      return_reason: reason || 'campaign_failed',
      returned_at:  new Date(),
      updated_at:   new Date(),
    },
    { escrow_id: escrowId },
    { returning: '*' }
  );
}

// ── DISPUTE ESCROW ────────────────────────────────────────────────
async function disputeEscrow(escrowId, reason, disputedByUserId) {
  const { data: escrow } = await db.select('escrow_transactions', {
    where: { escrow_id: escrowId }, single: true
  });
  if (!escrow) return { data: null, error: 'Escrow not found.' };

  return db.update('escrow_transactions',
    {
      status:         'disputed',
      dispute_reason: reason,
      disputed_by:    disputedByUserId,
      disputed_at:    new Date(),
      updated_at:     new Date(),
    },
    { escrow_id: escrowId },
    { returning: '*' }
  );
}

// ── GET ESCROW BY INVESTMENT ──────────────────────────────────────
async function getEscrowByInvestment(investmentId) {
  return db.select('escrow_transactions', {
    where: { investment_id: investmentId }, single: true
  });
}

// ── GET ESCROW SUMMARY ────────────────────────────────────────────
async function getEscrowSummary(offeringId) {
  const result = await db.query(
    `SELECT
       COUNT(*) as total_count,
       COUNT(*) FILTER (WHERE status = 'deposited') as deposited_count,
       COUNT(*) FILTER (WHERE status = 'released')  as released_count,
       COUNT(*) FILTER (WHERE status = 'returned')  as returned_count,
       COUNT(*) FILTER (WHERE status = 'disputed')  as disputed_count,
       COALESCE(SUM(amount) FILTER (WHERE status = 'deposited'), 0) as total_in_escrow,
       COALESCE(SUM(amount) FILTER (WHERE status = 'released'),  0) as total_released,
       COALESCE(SUM(amount) FILTER (WHERE status = 'returned'),  0) as total_returned
     FROM escrow_transactions WHERE offering_id = $1`,
    [offeringId]
  );
  return result;
}

module.exports = {
  createEscrowTransaction,
  depositToEscrow,
  releaseEscrow,
  returnEscrow,
  disputeEscrow,
  getEscrowByInvestment,
  getEscrowSummary,
};
