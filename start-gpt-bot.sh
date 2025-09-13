#!/bin/bash

# Start GPT Bot for NEAR Chat Server
echo "Starting GPT Bot..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Please run start-tip-bot.sh first to create template."
    exit 1
fi

# Check if OpenAI API key is configured
if ! grep -q "OPENAI_API_KEY=.*[^=]$" .env; then
    echo "❌ OPENAI_API_KEY not configured in .env file"
    echo "💡 Get your API key from: https://platform.openai.com/api-keys"
    echo "💡 Then edit .env and set: OPENAI_API_KEY=your_key_here"
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
node bots/gpt-bot.js