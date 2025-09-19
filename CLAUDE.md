# CLAUDE.md

<CRITICAL>
You are an assistant, you must write correct and clean code. You speak with a programmer human, you can always ask human's point of view. Do not introduce tasks that were not mentioned by user, he is technical and he knows the potencial scope. Thus said, be sure human's knowledge is limited so you can alsways suggest a better way to solve the problem, but didn't write code if you have something to dicsuss first.

If you are not sure, just reply "I don't know how to do it". It's totally ok, hyman will provide more details
</CRITICAL>

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `npm start` - Run the production server
- `npm run dev` - Run development server with nodemon and auto-reload

## Bot Management Commands

- `./start-all-bots.sh` - Start all configured bots (runs in background)
- `./start-gpt-bot.sh` - Start GPT bot only (creates bots/gpt-bot/.env if missing)
- `./start-tip-bot.sh` - Start tip bot only (creates bots/tip-bot/.env if missing)
- `./stop-all-bots.sh` - Stop all running bots

**Bot Architecture**: Bots run as independent processes in separate directories (`bots/tip-bot/`, `bots/gpt-bot/`) with isolated .env files. Each bot connects to the server via WebSocket like regular users.

## Project Architecture

This is a WebSocket-based chat server for NEAR Protocol with the following core components:

### Core Services (`src/`)
- **`index.js`** - Main WebSocket server, handles client connections, message routing, and authentication
- **`channels-service.js`** - Channel configuration management and access control
- **`bots-service.js`** - Bot configuration and message routing to bots
- **`server-events.js`** - Server event system for bot communication with NEAR signature verification
- **`rules-engine.js`** - Channel access rules evaluation
- **`utils.js`** - Utility functions for JSON operations

### Shared Components (`shared/`)
- **`config-manager.js`** - Centralized configuration management (ready for smart contract integration)
- **`near.js`** - NEAR Protocol integration (signature verification, account validation, access keys)
- **`channels-config.json`** - Channel settings, access rules, admin users
- **`bots-config.json`** - Bot configurations with permissions (allowedRequestSignedIntent, allowedServerEvents)

### Bot System (Independent Architecture)
- Bots run as fully independent processes in separate directories: `bots/tip-bot/`, `bots/gpt-bot/`
- Each bot has its own `.env` file with isolated configuration
- Server sends signed events to notify bots about server startup and tip events
- Bots verify server identity through NEAR signature validation
- Permission-based access control for signed intents and server events
- Current bots: `gpt-bot/index.js` (GPT integration), `tip-bot/index.js` (NEAR token tipping)

### Message Flow
1. Clients connect via WebSocket and authenticate with NEAR signatures
2. Messages are validated, routed through rules engine
3. Messages distributed to channel subscribers and relevant bots
4. Server maintains message history and handles replies/deletions

### Key Features
- **NEAR Authentication** - Messages signed with NEAR account keys
- **Channel Access Control** - Rule-based channel permissions, user-created private channels
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
- `available_channels` - Get list of available channels (includes both configured channels user can access and user-created channels they've joined)
- Note: Bot activity messages (join/leave/disconnect) include `isBot: true` field for client filtering

### Environment Variables
- `WS_PORT` - WebSocket server port (default: 7071)
- `RES_PATH` - Resource directory path (default: "res")
- `MAX_MESSAGE_DELAY_MS` - Maximum message processing delay (default: 5000)

The server uses ES modules throughout and stores state in JSON files in the `res/` directory.

## Development Rules

- **Bot Independence** - Bots must work as independent entities and can run on separate servers. They communicate via WebSocket like regular users, not through direct process management
- **Channel Token Access** - Channels don't require tokens for tipping functionality by default. Token access is an exception, not the rule
- **No Default Parameters** - Avoid setting default parameters in configuration files
- **Channel ID Requirement** - Every data message sent to the webapp for display must include `channelId` field
- **No New Entities** - Do not introduce new configuration entities, fields, or concepts without explicit user request. Stick to existing architecture patterns
- **Use Existing Systems** - Do not create duplicate functionality. Use existing signature verification, message handling, and authentication systems that are already implemented