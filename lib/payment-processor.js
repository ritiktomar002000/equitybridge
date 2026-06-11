// lib/payment-processor.js — Custom Payment Processing (no Stripe)
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

// ── CREATE PAYMENT INTENT ─────────────────────────────────────────
async function createPaymentIntent({ userId, amount, currency = 'usd', description, metadata = {} }) {
  if (!userId || !amount || amount <= 0) {
    return { data: null, error: 'Invalid payment intent parameters.' };
  }

  const intentId = `pi_${uuidv4().replace(/-/g, '').slice(0, 24)}`;

  const result = await db.insert('payment_intents', {
    id:          uuidv4(),
    intent_id:   intentId,
    user_id:     userId,
    amount:      Math.round(amount),         // store in cents
    currency,
    description: description || null,
    status:      'pending',
    metadata:    JSON.stringify(metadata),
    created_at:  new Date(),
    updated_at:  new Date(),
  }, { returning: '*' });

  if (result.error) return result;

  return {
    data: {
      id:          result.data.id,
      intent_id:   intentId,
      amount,
      currency,
      status:      'pending',
      description,
      client_secret: `${intentId}_secret_${uuidv4().replace(/-/g, '').slice(0, 16)}`,
    },
    error: null,
  };
}

// ── CONFIRM PAYMENT ───────────────────────────────────────────────
async function confirmPayment(intentId, { paymentMethod = 'bank_transfer', payerDetails = {} } = {}) {
  const { data: intent } = await db.select('payment_intents', {
    where: { intent_id: intentId }, single: true
  });
  if (!intent) return { data: null, error: 'Payment intent not found.' };
  if (intent.status === 'completed') return { data: intent, error: null };
  if (intent.status === 'cancelled') return { data: null, error: 'Payment has been cancelled.' };

  const paymentId = `pay_${uuidv4().replace(/-/g, '').slice(0, 24)}`;

  // Insert payment record
  const paymentResult = await db.insert('payments', {
    id:             uuidv4(),
    payment_id:     paymentId,
    intent_id:      intentId,
    user_id:        intent.user_id,
    amount:         intent.amount,
    currency:       intent.currency,
    status:         'completed',
    payment_method: paymentMethod,
    payer_details:  JSON.stringify(payerDetails),
    description:    intent.description,
    metadata:       intent.metadata,
    paid_at:        new Date(),
    created_at:     new Date(),
    updated_at:     new Date(),
  }, { returning: '*' });

  // Update intent status
  await db.update('payment_intents',
    { status: 'completed', payment_id: paymentId, updated_at: new Date() },
    { intent_id: intentId }
  );

  if (paymentResult.error) return paymentResult;

  return {
    data: {
      ...paymentResult.data,
      original_intent: intent,
    },
    error: null,
  };
}

// ── GET PAYMENT ───────────────────────────────────────────────────
async function getPayment(paymentId) {
  return db.select('payments', { where: { payment_id: paymentId }, single: true });
}

async function getPaymentIntent(intentId) {
  return db.select('payment_intents', { where: { intent_id: intentId }, single: true });
}

// ── GET USER PAYMENT HISTORY ──────────────────────────────────────
async function getUserPayments(userId, { limit = 20, offset = 0 } = {}) {
  return db.query(
    `SELECT p.*, pi.description as intent_description
     FROM payments p
     LEFT JOIN payment_intents pi ON pi.intent_id = p.intent_id
     WHERE p.user_id = $1
     ORDER BY p.created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
}

// ── REFUND ────────────────────────────────────────────────────────
async function refundPayment(paymentId, { reason = 'requested_by_customer', amount = null } = {}) {
  const { data: payment } = await db.select('payments', {
    where: { payment_id: paymentId }, single: true
  });
  if (!payment) return { data: null, error: 'Payment not found.' };
  if (payment.status === 'refunded') return { data: null, error: 'Payment already refunded.' };
  if (payment.status !== 'completed') return { data: null, error: 'Only completed payments can be refunded.' };

  const refundAmount = amount || payment.amount;
  const refundId     = `re_${uuidv4().replace(/-/g, '').slice(0, 24)}`;

  await db.insert('refunds', {
    id:         uuidv4(),
    refund_id:  refundId,
    payment_id: paymentId,
    user_id:    payment.user_id,
    amount:     refundAmount,
    currency:   payment.currency,
    reason,
    status:     'completed',
    refunded_at: new Date(),
    created_at:  new Date(),
  }, { returning: 'id' });

  await db.update('payments',
    { status: 'refunded', refund_id: refundId, updated_at: new Date() },
    { payment_id: paymentId }
  );

  return { data: { refund_id: refundId, amount: refundAmount, status: 'completed' }, error: null };
}

// ── PAYMENT STATS ─────────────────────────────────────────────────
async function getPaymentStats(userId) {
  const result = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
       COUNT(*) FILTER (WHERE status = 'refunded')  as refunded_count,
       COALESCE(SUM(amount) FILTER (WHERE status = 'completed'), 0) as total_paid,
       COALESCE(SUM(amount) FILTER (WHERE status = 'refunded'),  0) as total_refunded
     FROM payments WHERE user_id = $1`,
    [userId]
  );
  return result;
}

module.exports = {
  createPaymentIntent,
  confirmPayment,
  getPayment,
  getPaymentIntent,
  getUserPayments,
  refundPayment,
  getPaymentStats,
};
