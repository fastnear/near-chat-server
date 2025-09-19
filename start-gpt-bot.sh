#!/bin/bash

# Start GPT Bot for NEAR Chat Server
echo "Starting GPT Bot..."

# Check if bot .env file exists
if [ ! -f bots/gpt-bot/.env ]; then
    echo "⚠️  GPT bot .env file not found."
    exit 1
fi

# Check if OpenAI API key is configured
if ! grep -q "OPENAI_API_KEY=.*[^=]$" bots/gpt-bot/.env; then
    echo "❌ OPENAI_API_KEY not configured in bots/gpt-bot/.env file"
    echo "💡 Get your API key from: https://platform.openai.com/api-keys"
    echo "💡 Then edit bots/gpt-bot/.env and set: OPENAI_API_KEY=your_key_here"
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

# Start the GPT bot
echo "🚀 Starting GPT Bot..."
echo "💬 Try: /ask What is NEAR Protocol?"
echo "💬 Or mention: @gpt tell me about blockchain"
cd bots/gpt-bot && node index.js