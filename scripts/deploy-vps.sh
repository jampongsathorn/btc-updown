#!/usr/bin/env bash
set -e

# ==============================================================================
# Polymarket BTC UpDown 5m Engine - Automated VPS Deployment Script
# Tested on: Ubuntu 22.04 / 24.04 LTS, Debian 11 / 12
# ==============================================================================

echo "===================================================================="
echo "🚀 Starting Automated Setup for Polymarket BTC UpDown 5m Sniper Engine"
echo "===================================================================="

# 1. Update system packages
echo "📦 [1/5] Updating system packages..."
sudo apt-get update -y
sudo apt-get install -y curl git build-essential

# 2. Install Node.js 20 LTS (if not installed or version < 20)
echo "🟢 [2/5] Checking Node.js runtime..."
if ! command -v node &> /dev/null || [ "$(node -v | cut -d'.' -f1 | tr -d 'v')" -lt 20 ]; then
  echo "Installing Node.js 20 LTS via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "Node.js version: $(node -v)"
echo "NPM version:     $(npm -v)"

# 3. Install PM2 process manager
echo "⚙️  [3/5] Installing PM2 process supervisor..."
sudo npm install -g pm2

# 4. Clone or pull latest code
TARGET_DIR="$HOME/btc-updown"
echo "📂 [4/5] Preparing workspace at $TARGET_DIR..."

if [ -d "$TARGET_DIR/.git" ]; then
  echo "Updating existing repository..."
  cd "$TARGET_DIR"
  git pull origin arena/01a0cdb5-btc-updown || git pull
else
  echo "Cloning repository..."
  git clone -b arena/01a0cdb5-btc-updown https://github.com/jampongsathorn/btc-updown.git "$TARGET_DIR"
  cd "$TARGET_DIR"
fi

# 5. Build and launch
echo "🔨 [5/5] Installing dependencies and building production engine..."
npm install
npm run build

echo "🚦 Starting engine under PM2 supervisor..."
pm2 delete btc-sniper 2>/dev/null || true
pm2 start dist/index.js --name "btc-sniper" --time

echo "💾 Setting PM2 to start on system boot..."
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u "$USER" --hp "$HOME" || true

echo ""
echo "===================================================================="
echo "✅ DEPLOYMENT COMPLETE! The bot is now running 24/7 in the background."
echo "===================================================================="
echo "Useful Commands:"
echo "  • View Live Logs:      pm2 logs btc-sniper"
echo "  • View Process Status: pm2 status"
echo "  • Restart Bot:         pm2 restart btc-sniper"
echo "  • Stop Bot:            pm2 stop btc-sniper"
echo "===================================================================="
