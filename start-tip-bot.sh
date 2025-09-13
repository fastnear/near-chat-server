#!/bin/bash

# Start Tip Bot for NEAR Chat Server
echo "Starting Tip Bot..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Creating template..."
    cat > .env << EOF
# NEAR Chat Server Configuration
WS_URL=ws://localhost:7071

# Bot Private Keys (generate your own!)
TIP_BOT_PRIVATE_KEY=ed25519:3KyUuch8pYP47krBq4DosFEVBMR5wDTMQ8AThzM8kAEcBQHqjEtzBx4JhPQqpX2vGvPEAF7V2vPPm9h3PVfDaYeP
GPT_BOT_PRIVATE_KEY=ed25519:3KyUuch8pYP47krBq4DosFEVBMR5wDTMQ8AThzM8kAEcBQHqjEtzBx4JhPQqpX2vGvPEAF7V2vPPm9h3PVfDaYeP

# OpenAI Configuration (for GPT bot)
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_ENDPOINT=https://api.openai.com/v1/chat/completions
OPENAI_MODEL_NAME=gpt-3.5-turbo
OPENAI_MAX_TOKENS=150
EOF
    echo "✅ Created .env template. Please edit it with your credentials."
    exit 1
fi

# Check if server is running
echo "🔍 Checking if NEAR Chat Server is running..."
if ! curl -s --connect-timeout 3 http://localhost:7071 > /dev/null 2>&1; then
    echo "❌ NEAR Chat Server is not running on port 7071"
    echo "💡 Start it first with: npm start"
    exit 1
fi

echo "✅ Server is running"

# Start the tip bot
echo "🚀 Starting Tip Bot..."
node bots/tip-bot.js