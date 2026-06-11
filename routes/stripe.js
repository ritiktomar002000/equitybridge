// routes/stripe.js — custom payment endpoints (Stripe replaced)
const express = require('express');
const paymentProcessor = require('../lib/payment-processor');
const { requireAuth, requireRole } = require('../middleware/auth');
const router = express.Router();

router.post('/create-payment-intent', requireAuth, async (req, res) => {
  const { amount, currency = 'usd', description, metadata } = req.body;
  if (!amount) return res.status(400).json({ error: 'amount is required.' });
  const { data, error } = await paymentProcessor.createPaymentIntent({ userId: req.user.id, amount, currency, description, metadata });
  if (error) return res.status(500).json({ error });
  res.json({ payment_intent: data });
});

router.post('/confirm-payment', requireAuth, async (req, res) => {
  const { intent_id, payment_method, payer_details } = req.body;
  if (!intent_id) return res.status(400).json({ error: 'intent_id is required.' });
  const { data, error } = await paymentProcessor.confirmPayment(intent_id, { paymentMethod: payment_method, payerDetails: payer_details });
  if (error) return res.status(400).json({ error });
  res.json({ payment: data });
});

router.get('/payment/:id', requireAuth, async (req, res) => {
  const { data, error } = await paymentProcessor.getPayment(req.params.id);
  if (error || !data) return res.status(404).json({ error: 'Payment not found.' });
  if (data.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied.' });
  res.json({ payment: data });
});

router.get('/payments', requireAuth, async (req, res) => {
  const { data, error } = await paymentProcessor.getUserPayments(req.user.id);
  if (error) return res.status(500).json({ error });
  res.json({ payments: data });
});

router.post('/refund-payment', requireAuth, requireRole('admin'), async (req, res) => {
  const { payment_id, reason, amount } = req.body;
  if (!payment_id) return res.status(400).json({ error: 'payment_id is required.' });
  const { data, error } = await paymentProcessor.refundPayment(payment_id, { reason, amount });
  if (error) return res.status(400).json({ error });
  res.json({ refund: data });
});

// Webhook stub (real webhook would validate HMAC signature)
router.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  res.json({ received: true });
});

module.exports = router;
