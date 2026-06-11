#!/bin/bash
# setup-vps.sh — Run this ONCE on a fresh Ubuntu 22.04 VPS
# Usage: bash setup-vps.sh yourdomain.com
# If no domain yet, use your server IP address

set -e  # stop on any error

DOMAIN=${1:-"localhost"}
APP_DIR="/var/www/equitybridge"
DB_NAME="equitybridge"
DB_USER="eb_app"
DB_PASS=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-20)
JWT_SECRET=$(openssl rand -hex 64)
JWT_REFRESH=$(openssl rand -hex 64)

echo ""
echo "========================================="
echo "  EquityBridge VPS Setup"
echo "  Domain: $DOMAIN"
echo "========================================="
echo ""

# ── 1. SYSTEM UPDATE ─────────────────────────────────────────────
echo "▶  Updating system..."
apt-get update -y && apt-get upgrade -y
apt-get install -y curl wget git ufw nginx postgresql postgresql-contrib certbot python3-certbot-nginx

# ── 2. NODE.JS 20 ─────────────────────────────────────────────────
echo "▶  Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
echo "   Node: $(node -v)  NPM: $(npm -v)"

# ── 3. PM2 ────────────────────────────────────────────────────────
echo "▶  Installing PM2..."
npm install -g pm2

# ── 4. FIREWALL ───────────────────────────────────────────────────
echo "▶  Configuring firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80
ufw allow 443
ufw --force enable
echo "   Firewall active — ports 22, 80, 443 open"

# ── 5. POSTGRESQL ─────────────────────────────────────────────────
echo "▶  Setting up PostgreSQL..."
systemctl start postgresql
systemctl enable postgresql

sudo -u postgres psql << PSQL
CREATE DATABASE $DB_NAME;
CREATE USER $DB_USER WITH ENCRYPTED PASSWORD '$DB_PASS';
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
PSQL

echo "   Database: $DB_NAME"
echo "   DB User:  $DB_USER"

# ── 6. APP DIRECTORY ─────────────────────────────────────────────
echo "▶  Creating app directory..."
mkdir -p $APP_DIR/logs
chown -R $USER:$USER $APP_DIR

# ── 7. COPY APP FILES ─────────────────────────────────────────────
echo "▶  Copying app files..."
# If running from the zip-extracted folder:
cp -r . $APP_DIR/
cd $APP_DIR

# ── 8. INSTALL DEPENDENCIES ───────────────────────────────────────
echo "▶  Installing npm packages..."
npm install --omit=dev

# ── 9. CREATE .env ────────────────────────────────────────────────
echo "▶  Writing .env file..."
cat > $APP_DIR/.env << ENV
NODE_ENV=production
PORT=3000

DB_HOST=localhost
DB_PORT=5432
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASS
DB_SSL=false

JWT_SECRET=$JWT_SECRET
JWT_REFRESH_SECRET=$JWT_REFRESH
JWT_EXPIRES_IN=7d

MIN_INVESTMENT_AMOUNT=250
PLATFORM_FEE_PERCENT=2.5
ENV

chmod 600 $APP_DIR/.env
echo "   .env written and secured"

# ── 10. RUN MIGRATIONS ────────────────────────────────────────────
echo "▶  Running database migrations..."
cd $APP_DIR && node migrations/run.js

# ── 11. NGINX CONFIG ──────────────────────────────────────────────
echo "▶  Configuring Nginx..."
cat > /etc/nginx/sites-available/equitybridge << NGINX
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/equitybridge /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
echo "   Nginx configured"

# ── 12. START APP WITH PM2 ────────────────────────────────────────
echo "▶  Starting app with PM2..."
cd $APP_DIR
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup | tail -1 | bash   # auto-start on reboot

# ── 13. SSL CERTIFICATE (if real domain, not IP) ─────────────────
if [[ "$DOMAIN" != "localhost" && "$DOMAIN" =~ \. ]]; then
    echo "▶  Getting SSL certificate from Let's Encrypt..."
    certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN \
        --redirect 2>/dev/null && echo "   SSL active ✅" || echo "   SSL skipped (run certbot manually when DNS is ready)"
fi

# ── DONE ──────────────────────────────────────────────────────────
echo ""
echo "========================================="
echo "  ✅ SETUP COMPLETE"
echo "========================================="
echo ""
echo "  Site URL:   http://$DOMAIN"
echo "  App dir:    $APP_DIR"
echo "  DB name:    $DB_NAME"
echo "  DB user:    $DB_USER"
echo "  DB pass:    $DB_PASS"
echo ""
echo "  Useful commands:"
echo "  pm2 status           — check if app is running"
echo "  pm2 logs equitybridge — view live logs"
echo "  pm2 restart equitybridge — restart the app"
echo "  pm2 stop equitybridge    — stop the app"
echo ""
echo "  ⚠  Save the DB password above — you'll need it later"
echo ""
