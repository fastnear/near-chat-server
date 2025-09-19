#!/bin/bash

# Start Tip Bot for NEAR Chat Server
echo "Starting Tip Bot..."

# Check if bot .env file exists
if [ ! -f bots/tip-bot/.env ]; then
    echo "⚠️  Tip bot .env file not found."
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
cd bots/tip-bot && node index.js