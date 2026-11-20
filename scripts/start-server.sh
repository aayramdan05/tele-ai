#!/usr/bin/env bash
# Tele-AI Studio Startup Script for Linux VPS (10.69.69.53)
cd "$(dirname "$0")/.."

echo "===================================================="
echo "Starting Tele-AI Studio Server on VPS..."
echo "Access Web Dashboard: http://10.69.69.53:3000"
echo "===================================================="

export NODE_ENV=production
export PORT=3000

# Run with PM2 if installed, else fallback to node
if command -v pm2 &> /dev/null; then
    pm2 start ecosystem.config.js
    pm2 save
    pm2 logs tele-ai-studio
else
    node server/index.js
fi
