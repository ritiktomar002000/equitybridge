# Self-Hosting Guide — No Third Parties

## What You Need

1. A VPS server ($4-5/month) — this is just a computer you rent, not a platform
2. A domain name (~$10/year) — optional, you can use the server's IP address to start
3. About 20 minutes

---

## Step 1 — Get a VPS Server

Go to one of these and buy the cheapest plan:

- **Contabo** → contabo.com → "VPS S" → $5.50/month → Ubuntu 22.04
- **Hetzner** → hetzner.com → "CX22" → €3.79/month → Ubuntu 22.04
- **Hostinger** → hostinger.com → "KVM 1" → $4.99/month → Ubuntu 22.04

When creating the server:
- Choose **Ubuntu 22.04** as the operating system
- Choose the datacenter closest to your users (US East, EU, etc.)
- Set a root password (save it!)
- They give you an **IP address** like `123.45.67.89` — save this

---

## Step 2 — Connect to Your Server

On Windows, download **PuTTY** (putty.org) or use Windows Terminal:

```bash
ssh root@YOUR_SERVER_IP
# Example: ssh root@123.45.67.89
# Enter the password you set
```

You're now inside your server.

---

## Step 3 — Upload Your Code

**Option A — From GitHub (recommended):**
```bash
# On your server:
git clone https://github.com/YOUR_USERNAME/equitybridge.git /var/www/equitybridge
cd /var/www/equitybridge
```

**Option B — Upload directly with FileZilla:**
1. Download FileZilla (filezilla-project.org)
2. Connect: Host = your IP, Username = root, Password = your password, Port = 22
3. Drag your project folder to `/var/www/equitybridge` on the server

---

## Step 4 — Run the Setup Script

```bash
cd /var/www/equitybridge

# If you have a domain name:
bash setup-vps.sh yourdomain.com

# If using IP address only:
bash setup-vps.sh 123.45.67.89
```

This one script does everything:
- Installs Node.js, PostgreSQL, Nginx
- Creates the database and a secure user
- Generates random secret keys
- Writes your .env file
- Runs database migrations
- Starts your app with PM2 (keeps it running 24/7)
- Configures Nginx as a reverse proxy
- Gets a free SSL certificate (if you have a domain)

---

## Step 5 — Visit Your Site

Open your browser and go to:
```
http://YOUR_SERVER_IP
```
or
```
https://yourdomain.com
```

Your site is live. ✅

---

## Step 6 — Connect a Domain Name (Optional)

1. Buy a domain at **namecheap.com** (~$10/year)
2. In Namecheap → Manage → Advanced DNS → add:
   - **Type:** A Record
   - **Host:** @
   - **Value:** YOUR_SERVER_IP
   - **TTL:** Automatic
3. Wait 5-30 minutes for DNS to update
4. Run on your server:
   ```bash
   certbot --nginx -d yourdomain.com
   ```
   This gives you free HTTPS (the padlock in the browser)

---

## Daily Management

```bash
# Check if app is running
pm2 status

# View live logs (see errors in real time)
pm2 logs equitybridge

# Restart the app
pm2 restart equitybridge

# Stop the app
pm2 stop equitybridge

# Update code after making changes
bash /var/www/equitybridge/update.sh
```

---

## Keeping the Database Safe

Run this on your server to set up automatic daily backups:

```bash
# Create backup script
cat > /root/backup-db.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M)
PGPASSWORD=$DB_PASSWORD pg_dump -U eb_app equitybridge > /root/backups/db_$DATE.sql
# Keep only last 7 days
find /root/backups -name "*.sql" -mtime +7 -delete
EOF

mkdir -p /root/backups
chmod +x /root/backup-db.sh

# Run daily at 2am
(crontab -l 2>/dev/null; echo "0 2 * * * /root/backup-db.sh") | crontab -
```

---

## Cost Summary

| Item | Cost |
|---|---|
| VPS server (Contabo) | $5.50/month |
| Domain name | ~$10/year |
| SSL certificate | FREE (Let's Encrypt) |
| **Total** | **~$76/year** |

You own everything. No platform can shut you down.

---

## Troubleshooting

**Can't connect with SSH:**
→ Make sure port 22 is open in your VPS provider's firewall panel

**Site not loading after setup:**
```bash
pm2 status          # is app running?
pm2 logs equitybridge  # any errors?
systemctl status nginx  # is nginx running?
```

**Database errors:**
```bash
systemctl status postgresql
# If not running:
systemctl start postgresql
```

**Need to change .env settings:**
```bash
nano /var/www/equitybridge/.env
# Edit values, save with Ctrl+X, then:
pm2 restart equitybridge
```
