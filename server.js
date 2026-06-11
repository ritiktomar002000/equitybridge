require('dotenv').config({ override: true });
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const path      = require('path');
const db        = require('./lib/db');

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api/', rateLimit({ windowMs: 15*60*1000, max: 300, message: { error: 'Too many requests.' } }));
app.use('/api/auth/', rateLimit({ windowMs: 15*60*1000, max: 30, message: { error: 'Too many auth attempts.' } }));

app.use(express.static(path.join(__dirname, 'public')));
app.get('/',          (_,r) => r.sendFile(path.join(__dirname, 'equitybridge.html')));
app.get('/dashboard', (_,r) => r.sendFile(path.join(__dirname, 'dashboard.html')));

// Core
app.use('/api/auth',               require('./routes/auth'));
app.use('/api/businesses',         require('./routes/businesses'));
app.use('/api/offerings',          require('./routes/offerings'));
app.use('/api/investments',        require('./routes/investments'));
app.use('/api/users',              require('./routes/users'));
app.use('/api/payments',           require('./routes/stripe'));
app.use('/api/compliance',         require('./routes/compliance'));
app.use('/api/applications',       require('./routes/applications'));
app.use('/api/compliance-reviews', require('./routes/compliance_reviews'));
app.use('/api/escrow',             require('./routes/escrow'));
app.use('/api/subscriptions',      require('./routes/subscriptions'));
app.use('/api/securities',         require('./routes/securities'));
app.use('/api/reports',            require('./routes/reports'));

// New features
app.use('/api/secondary',          require('./routes/secondary'));
app.use('/api/features',           require('./routes/features'));

// Health & debug
app.get('/api/health', async (_, res) => {
  let ok = false;
  try { const r = await db.query('SELECT 1'); ok = !r.error; } catch(_){}
  res.status(ok?200:503).json({ status: ok?'ok':'degraded', timestamp: new Date(), pool: db.getPoolStats() });
});
app.use('/api/debug', require('./routes/debug'));

app.use((req,res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});
app.use((err,_,res,__) => {
  console.error(err);
  res.status(err.status||500).json({ error: process.env.NODE_ENV==='production'?'Server error':err.message });
});

const PORT = process.env.PORT || 3000;
const srv = app.listen(PORT, () => {
  console.log(`\n🚀  EquityBridge v2  →  http://localhost:${PORT}`);
  console.log(`    DB: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}\n`);
});
process.on('SIGTERM', ()=>srv.close(async()=>{ await db.close(); process.exit(0); }));
process.on('SIGINT',  ()=>srv.close(async()=>{ await db.close(); process.exit(0); }));
module.exports = app;
