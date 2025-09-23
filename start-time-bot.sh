#!/bin/bash

BOT_DIR="bots/time-bot"
ENV_FILE="$BOT_DIR/.env"

# Create .env file if it doesn't exist
if [ ! -f "$ENV_FILE" ]; then
    echo "Creating $ENV_FILE from template..."
    cp "$BOT_DIR/.env.example" "$ENV_FILE"
    echo "⚠️  Please edit $ENV_FILE with your TIME_BOT_PRIVATE_KEY before running the bot"
    exit 1
fi

echo "🤖 Starting Time Bot..."
cd "$BOT_DIR"
node index.js