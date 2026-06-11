#!/bin/bash
# update.sh — Run this every time you want to push new code to your VPS
# Usage: bash update.sh

APP_DIR="/var/www/equitybridge"

echo "▶  Pulling latest code..."
cd $APP_DIR
git pull origin main

echo "▶  Installing new packages..."
npm install --omit=dev

echo "▶  Running migrations..."
node migrations/run.js

echo "▶  Restarting app..."
pm2 restart equitybridge

echo "✅ Update complete — $(pm2 jlist | grep -o '"status":"[^"]*"' | head -1)"
