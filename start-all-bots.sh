#!/bin/bash

# Start All Bots for NEAR Chat Server
echo "🤖 Starting All Bots..."

# Function to start a bot in background
start_bot() {
    local bot_name=$1
    local script_name=$2
    
    echo "🚀 Starting $bot_name..."
    nohup bash $script_name > logs/${bot_name}.log 2>&1 &
    local pid=$!
    echo $pid > logs/${bot_name}.pid
    echo "✅ $bot_name started (PID: $pid)"
}

# Create logs directory
mkdir -p logs

# Check if server is running
echo "🔍 Checking if NEAR Chat Server is running..."
if ! curl -s --connect-timeout 3 http://localhost:7071 > /dev/null 2>&1; then
    echo "❌ NEAR Chat Server is not running on port 7071"
    echo "💡 Start it first with: npm start"
    exit 1
fi

# Start all bots
start_bot "tip-bot" "start-tip-bot.sh"
start_bot "gpt-bot" "start-gpt-bot.sh"

echo ""
echo "✅ All bots started!"
echo "📝 Logs are in logs/ directory"
echo "📋 To stop all bots: bash stop-all-bots.sh"
echo ""
echo "💬 Bot commands:"
echo "   Tip Bot: /tip 5 thanks!"
echo "   GPT Bot: /ask What is NEAR? or @gpt help me"