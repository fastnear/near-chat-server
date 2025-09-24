#!/bin/bash

# Quiz Bot Startup Script
cd "$(dirname "$0")"

echo "🧠 Starting Quiz Bot..."

# Check if .env file exists, create if missing
if [ ! -f "bots/quiz-bot/.env" ]; then
    echo "📝 Creating quiz-bot .env file..."
    cat > bots/quiz-bot/.env << 'EOF'
# Quiz Bot Configuration
WS_URL=ws://localhost:7071
QUIZ_BOT_ACCOUNT_ID=quiz.near
QUIZ_BOT_PRIVATE_KEY=

# OpenAI Configuration
OPENAI_API_KEY=
OPENAI_ENDPOINT=https://api.openai.com/v1/
OPENAI_MODEL_NAME=gpt-3.5-turbo
OPENAI_MAX_TOKENS=300
EOF
    echo "⚠️  Please configure bots/quiz-bot/.env with your credentials:"
    echo "   - QUIZ_BOT_PRIVATE_KEY: Private key for quiz.near account"
    echo "   - OPENAI_API_KEY: Your OpenAI API key (optional, fallback questions will be used)"
    echo ""
    exit 1
fi

# Check for required environment variables
source bots/quiz-bot/.env

if [ -z "$QUIZ_BOT_PRIVATE_KEY" ]; then
    echo "❌ QUIZ_BOT_PRIVATE_KEY not set in bots/quiz-bot/.env"
    exit 1
fi

echo "✅ Starting Quiz Bot with account: $QUIZ_BOT_ACCOUNT_ID"

# Start the bot
cd bots/quiz-bot
node index.js