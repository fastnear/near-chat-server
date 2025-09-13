#!/bin/bash

# Stop All Bots for NEAR Chat Server
echo "🛑 Stopping All Bots..."

# Function to stop a bot
stop_bot() {
    local bot_name=$1
    local pid_file="logs/${bot_name}.pid"
    
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if ps -p $pid > /dev/null 2>&1; then
            echo "🛑 Stopping $bot_name (PID: $pid)..."
            kill $pid
            rm "$pid_file"
            echo "✅ $bot_name stopped"
        else
            echo "⚠️  $bot_name was not running"
            rm "$pid_file"
        fi
    else
        echo "⚠️  No PID file for $bot_name"
    fi
}

# Stop all bots
stop_bot "tip-bot"
stop_bot "gpt-bot"

echo ""
echo "✅ All bots stopped!"

# Clean up any remaining node processes (optional)
echo "🧹 Cleaning up any remaining bot processes..."
pkill -f "bots/.*-bot.js" 2>/dev/null || true

echo "✨ All done!"