#!/bin/bash

# Quiz Bot Startup Script
cd "$(dirname "$0")"

echo "🧠 Starting DnD Bot..."

# Check for required environment variables
source bots/dnd-bot/.env

if [ -z "$DND_BOT_PRIVATE_KEY" ]; then
    echo "❌ DND_BOT_PRIVATE_KEY not set in bots/dnd-bot/.env"
    exit 1
fi

echo "✅ Starting Quiz Bot with account: $DND_BOT_ACCOUNT_ID"

# Start the bot
cd bots/dnd-bot
node index.js