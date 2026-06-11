# EquityBridge — Publishing Guide

## Fastest Option: Railway (10 minutes, free to start)

### Step 1 — Push code to GitHub

1. Go to https://github.com and create a free account if you don't have one
2. Click **New Repository** → name it `equitybridge` → Create
3. On your computer, open Terminal / Command Prompt in your project folder:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/equitybridge.git
git push -u origin main
```

### Step 2 — Deploy on Railway

1. Go to https://railway.app → Sign up with GitHub
2. Click **New Project** → **Deploy from GitHub repo**
3. Select your `equitybridge` repo → click **Deploy Now**
4. Railway detects Node.js automatically

### Step 3 — Add PostgreSQL Database

1. In your Railway project, click **+ New** → **Database** → **PostgreSQL**
2. Railway creates the DB and auto-sets `DATABASE_URL` in your environment
3. That's it — no manual DB setup needed

### Step 4 — Set Environment Variables

In Railway → your service → **Variables** tab, add:

```
NODE_ENV=production
JWT_SECRET=paste-a-long-random-string-here
JWT_REFRESH_SECRET=paste-another-long-random-string-here
MIN_INVESTMENT_AMOUNT=250
PLATFORM_FEE_PERCENT=2.5
```

To generate strong secrets, run this in your terminal:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Step 5 — Get Your Live URL

Railway gives you a URL like: `https://equitybridge-production.up.railway.app`

Your site is live! 🎉

### Step 6 — Custom Domain (equitybridge.com)

1. Buy a domain at https://namecheap.com (~$10/year)
2. In Railway → your service → **Settings** → **Domains** → **Add Custom Domain**
3. Railway shows you DNS records to add
4. In Namecheap → **Manage Domain** → **Advanced DNS** → add the records Railway shows
5. Wait 5-30 minutes → your custom domain is live

---

## Alternative: Render (also free)

1. Go to https://render.com → New → Web Service
2. Connect your GitHub repo
3. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `node migrations/run.js && node server.js`
4. Click **New** → **PostgreSQL** → create a free DB
5. Copy the **Internal Database URL** into your web service as `DATABASE_URL`
6. Add `JWT_SECRET` and `JWT_REFRESH_SECRET` in Environment
7. Click **Create Web Service** → live in ~2 minutes

---

## Environment Variables Reference

| Variable | Value | Required |
|---|---|---|
| `NODE_ENV` | `production` | ✅ |
| `DATABASE_URL` | Auto-set by Railway/Render | ✅ |
| `JWT_SECRET` | Long random string | ✅ |
| `JWT_REFRESH_SECRET` | Long random string | ✅ |
| `PORT` | `3000` (auto-set) | — |
| `MIN_INVESTMENT_AMOUNT` | `250` | — |
| `PLATFORM_FEE_PERCENT` | `2.5` | — |

---

## What Happens on Every Deploy

The start command `node migrations/run.js && node server.js` automatically:
1. Runs database migrations (creates tables if they don't exist — safe to run multiple times)
2. Starts the web server

---

## After Going Live — Checklist

- [ ] Visit `https://your-url.com/api/health` — should return `{"status":"ok"}`
- [ ] Visit `https://your-url.com/api/debug` — shows all tables created ✅
- [ ] Try registering an account at `https://your-url.com`
- [ ] **Disable the debug endpoint in production** (set `NODE_ENV=production` — debug auto-hides)
- [ ] Buy a domain and connect it
- [ ] Add your domain to the `CORS` allowed origins in `server.js`

---

## Troubleshooting

**Build fails on Railway/Render**
→ Check the build logs. Usually a missing dependency. Run `npm install` locally first.

**"Database connection refused"**
→ Make sure `DATABASE_URL` is set. Railway sets it automatically when you add a PostgreSQL service.

**"relation does not exist"**
→ Migrations didn't run. Check that start command is `node migrations/run.js && node server.js`

**Site loads but login fails**
→ Check `JWT_SECRET` is set in environment variables.
