#!/usr/bin/env bash
# ==============================================================================
# Auto-Sync Daemon for Polymarket BTC UpDown Sniper Engine
# Automatically checks GitHub for new commits every 60s, pulls, builds,
# restarts the engine, and notifies Discord.
# ==============================================================================

BRANCH="arena/01a0cdb5-btc-updown"
POLL_INTERVAL=60
DISCORD_WEBHOOK="https://discord.com/api/webhooks/1552315113535578144/AuLKFz6d6-pRMPk78UYkKL5BmTJuU6zdZDqdwI8GtBgtwJOX2vWfZ9WQtqhBRSNnhk_7"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

cd "$REPO_DIR"

echo "🔄 [Auto-Sync] Started monitoring branch '$BRANCH' every ${POLL_INTERVAL}s in $REPO_DIR..."

send_discord_notice() {
  local title="$1"
  local desc="$2"
  local color="$3"

  curl -s -X POST "$DISCORD_WEBHOOK" \
    -H "Content-Type: application/json" \
    -d "{
      \"username\": \"Spidey Bot\",
      \"embeds\": [{
        \"title\": \"$title\",
        \"description\": \"$desc\",
        \"color\": $color,
        \"footer\": { \"text\": \"AWS Jakarta EC2 • Continuous Deployment\" },
        \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
      }]
    }" > /dev/null 2>&1 || true
}

while true; do
  git fetch origin "$BRANCH" > /dev/null 2>&1 || true

  LOCAL=$(git rev-parse HEAD 2>/dev/null || echo "")
  REMOTE=$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo "")

  if [ -n "$REMOTE" ] && [ "$LOCAL" != "$REMOTE" ]; then
    COMMIT_MSG=$(git log -1 --pretty=format:"%s" "origin/$BRANCH")
    COMMIT_HASH=$(echo "$REMOTE" | cut -c1-7)

    echo ""
    echo "===================================================================="
    echo "🔔 [Auto-Sync] New commit detected: $COMMIT_HASH - $COMMIT_MSG"
    echo "🚀 Pulling updates and compiling..."
    echo "===================================================================="

    git pull origin "$BRANCH"
    npm install
    npm run build

    if command -v pm2 &> /dev/null; then
      echo "🔄 Restarting btc-sniper process under PM2..."
      pm2 restart btc-sniper || pm2 start dist/index.js --name btc-sniper --time
    fi

    echo "✅ [Auto-Sync] Successfully updated and restarted to commit $COMMIT_HASH!"

    send_discord_notice \
      "🚀 [SYSTEM AUTO-UPDATED] Engine Rebuilt & Hot-Reloaded" \
      "**Commit:** \`$COMMIT_HASH\`\n**Change:** $COMMIT_MSG\n**Server:** AWS Jakarta (ap-southeast-3)\n**Status:** Online & Active" \
      3066993

  fi

  sleep "$POLL_INTERVAL"
done
