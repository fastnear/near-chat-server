# CLAUDE.md

<CRITICAL>
You are an assistant, you must write correct and clean code. You speak with a programmer human, you can always ask human's point of view. Do not introduce tasks that were not mentioned by user, he is technical and he knows the potencial scope. Thus said, be sure human's knowledge is limited so you can alsways suggest a better way to solve the problem, but didn't write code if you have something to dicsuss first.

If you are not sure, just reply "I don't know how to do it". It's totally ok, hyman will provide more details
<CRITICAL>

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `npm start` - Run the production server
- `npm run dev` - Run development server with nodemon and auto-reload
- `./start-all-bots.sh` - Start all configured bots
- `./start-gpt-bot.sh` - Start GPT bot only
- `./start-tip-bot.sh` - Start tip bot only
- `./stop-all-bots.sh` - Stop all running bots

## Project Architecture

This is a WebSocket-based chat server for NEAR Protocol with the following core components:

### Core Services (`src/`)
- **`index.js`** - Main WebSocket server, handles client connections, message routing, and authentication
- **`channels-service.js`** - Channel configuration management and access control
- **`bots-service.js`** - Bot configuration and message routing to bots
- **`bot-manager.js`** - Manages bot processes (start, stop, monitor)
- **`near.js`** - NEAR Protocol integration (signature verification, account validation, access keys)
- **`rules-engine.js`** - Channel access rules evaluation
- **`utils.js`** - Utility functions for JSON operations

### Configuration Files
- **`channels-config.json`** - Channel settings, access rules, admin users
- **`bots-config.json`** - Bot configurations and routing rules
- **`.env`** - Environment variables (WS_PORT, RES_PATH, etc.)

### Bot System
- Bots are separate Node.js processes in `bots/` directory
- `BotManager` spawns and monitors bot processes
- Bots connect to server via WebSocket and process messages
- Current bots: `gpt-bot.js` (GPT integration), `tip-bot.js` (NEAR token tipping)

### Message Flow
1. Clients connect via WebSocket and authenticate with NEAR signatures
2. Messages are validated, routed through rules engine
3. Messages distributed to channel subscribers and relevant bots
4. Server maintains message history and handles replies/deletions

### Key Features
- **NEAR Authentication** - Messages signed with NEAR account keys
- **Channel Access Control** - Rule-based channel permissions
- **Message Threading** - Reply-to functionality with message nonces
- **Message Deletion** - Users can delete own messages, admins can delete any
- **Bot Integration** - Pluggable bot system with process management
- **Member Tracking** - Channel member lists with human/bot distinction

### WebSocket Message Types
- `message` - Send chat message
- `join` - Join channel
- `history` - Request message history
- `members` - Request channel members
- `delete_message` - Delete message (with permissions)

### Environment Variables
- `WS_PORT` - WebSocket server port (default: 7071)
- `RES_PATH` - Resource directory path (default: "res")
- `MAX_MESSAGE_DELAY_MS` - Maximum message processing delay (default: 5000)

The server uses ES modules throughout and stores state in JSON files in the `res/` directory.