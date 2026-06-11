// routes/escrow.js
const express = require('express');
const db = require('../lib/db');
const escrowManager = require('../lib/escrow-manager');
const { requireAuth, requireRole } = require('../middleware/auth');
const router = express.Router();

router.post('/deposit', requireAuth, async (req, res) => {
  const { escrow_id, payment_id } = req.body;
  const { data, error } = await escrowManager.depositToEscrow(escrow_id, payment_id);
  if (error) return res.status(400).json({ error });
  res.json({ escrow: data });
});

router.post('/release', requireAuth, requireRole('admin'), async (req, res) => {
  const { escrow_id, reason } = req.body;
  const { data, error } = await escrowManager.releaseEscrow(escrow_id, reason, req.user.id);
  if (error) return res.status(400).json({ error });
  res.json({ escrow: data });
});

router.post('/refund', requireAuth, requireRole('admin'), async (req, res) => {
  const { escrow_id, reason } = req.body;
  const { data, error } = await escrowManager.returnEscrow(escrow_id, reason);
  if (error) return res.status(400).json({ error });
  res.json({ escrow: data });
});

router.post('/dispute', requireAuth, async (req, res) => {
  const { escrow_id, reason } = req.body;
  const { data, error } = await escrowManager.disputeEscrow(escrow_id, reason, req.user.id);
  if (error) return res.status(400).json({ error });
  res.json({ escrow: data });
});

router.get('/investment/:investment_id', requireAuth, async (req, res) => {
  const { data, error } = await escrowManager.getEscrowByInvestment(req.params.investment_id);
  if (error || !data) return res.status(404).json({ error: 'Escrow not found.' });
  res.json({ escrow: data });
});

router.get('/summary/:offering_id', requireAuth, requireRole('admin'), async (req, res) => {
  const { data, error } = await escrowManager.getEscrowSummary(req.params.offering_id);
  if (error) return res.status(500).json({ error });
  res.json({ summary: data?.[0] });
});

module.exports = router;
