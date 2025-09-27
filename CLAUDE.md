# CLAUDE.md

<CRITICAL>
You are an assistant, you must write correct and clean code. You speak with a programmer human, you can always ask human's point of view. Do not introduce tasks that were not mentioned by user, he is technical and he knows the potencial scope. Thus said, be sure human's knowledge is limited so you can alsways suggest a better way to solve the problem, but didn't write code if you have something to dicsuss first.

If you are not sure, just reply "I don't know how to do it". It's totally ok, hyman will provide more details
</CRITICAL>

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Server (near-chat-server/)
- `npm start` - Run production server
- `npm run dev` - Run development server with nodemon and auto-reload
- `npm run restart` - Safe restart (checks for pending tips)
- `npm test` - Run test suite
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report

### Web App (near-chat-web-app/near-chat-nextjs/)
- `npm run dev` - Start development server on port 3001
- `npm run build` - Build the Next.js application
- `npm start` - Start production server on port 3498
- `npm run lint` - Run ESLint

### Bot Management (from server directory)
- `./start-all-bots.sh` - Start all configured bots (runs in background)
- `./start-gpt-bot.sh` - Start GPT bot only (creates bots/gpt-bot/.env if missing)
- `./start-tip-bot.sh` - Start tip bot only (creates bots/tip-bot/.env if missing)
- `./start-quiz-bot.sh` - Start quiz bot (creates .env if missing)
- `./start-time-bot.sh` - Start time bot (creates .env if missing)
- `./start-dnd-bot.sh` - Start D&D bot (creates .env if missing)
- `./stop-all-bots.sh` - Stop all running bots

**Bot Architecture**: Bots run as independent processes in separate directories with isolated .env files. Each bot connects to the server via WebSocket like regular users.

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
- **`channels-config.json`** - Channel settings, access rules, admin users, miniapp bot configurations
- **`bots-config.json`** - Bot configurations with permissions (allowedRequestSignedIntent, allowedServerEvents)
- **`base-bot.js`** - Base class for NEAR chat bots with common functionality including miniapp support, WebSocket handling, message processing, and webapp compression/caching

### Bot System (Independent Architecture)
- Bots run as fully independent processes in separate directories with isolated .env files
- Each bot connects to the server via WebSocket like regular users, not direct process management
- Server sends signed events to notify bots about startup and relevant events
- Bots verify server identity through NEAR signature validation
- Permission-based access control for signed intents and server events
- **For detailed miniapp bot development, see `MINIAPP_BOT_DEVELOPMENT.md`**

**Current Bots:**
- `bots/tip-bot/` - NEAR token tipping with Intents SDK integration
- `bots/gpt-bot/` - AI-powered chat responses
- `bots/quiz-bot/` - Interactive quiz functionality with miniapps
- `bots/time-bot/` - Time and scheduling utilities with miniapps
- `bots/dnd-bot/` - D&D adventure game with AI Dungeon Master miniapp

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
- **Miniapp System** - Bots can provide compressed webapp bundles that render in channels

### Terminology
- **Webapp** - main chat UI that handles user authentication and sends messages to server via WebSocket
- **Miniapp** - web interface of a specific bot in a channel. To enable bot miniapp display, add `"miniappBot": "bot-name"` to channel settings in `channels-config.json`. For detailed development guide, see `MINIAPP_BOT_DEVELOPMENT.md`

### WebSocket Message Types

**Standard Client Actions:**
- `message` - Send chat message
- `join` - Join channel
- `history` - Request message history
- `members` - Request channel members
- `delete_message` - Delete message (with permissions)
- `available_channels` - Get list of available channels (includes both configured channels user can access and user-created channels they've joined)
- `signed_intent` - Confirm and sign NEAR transaction intent
- `register_bot` - Register bot with server (bots only)

**Bot-Specific Actions (require `allowedRequestTypes` permission):**
- `request_tip_intent` - Request server to create tip intent for user signing
- `request_add_key` - Request user to add access key for intents contract
- `miniapp_response` - Respond to miniapp data request from server
- `webapp_update` - Send real-time updates to all channel participants

**Server Events (signed by server):**
- `server_startup` - Notifies bots when server starts, includes bot channels
- `update_channels` - Updates bot's allowed channels dynamically
- `tip_status_update` - Tip transaction status changes
- `storage_required` - Token storage registration needed
- `intent_created` - New intent created and ready for monitoring
- `channel_activity` - General channel activity notifications

**Server Responses:**
- `bot_registered` - Confirms successful bot registration
- `channel` - All channel-related events (join/leave/message/members)
- `error` - Server error notifications
- `message_created` - Confirms message creation with real server nonce
- `server_identity` - Server's NEAR account identity for signature verification
- `request_miniapp` - Server requests miniapp data from bot
- `sign_intent` - Request user to sign tip transaction
- `deposit_ui` - Show deposit interface for insufficient balance
- `tip_status` - Tip transaction status updates
- `webapp_update` - Real-time data updates filtered by channel

Note: Bot activity messages (join/leave/disconnect) include `isBot: true` field for client filtering

### Environment Variables

**Server:**
- `WS_PORT` - WebSocket server port (default: 7071)
- `RES_PATH` - Resource directory path (default: "res")
- `MAX_MESSAGE_DELAY_MS` - Message processing timeout (default: 5000)
- `TEST_USERS_TO_RESET_ON_RESTART` - Comma-separated test users to reset on restart

**Web App:**
- `NEXT_PUBLIC_WS_URL` - WebSocket server URL (default: ws://localhost:7071)
- `NEXT_PUBLIC_CONTRACT_ID` - NEAR contract for intents (default: social.near)

The server uses ES modules throughout and stores state in JSON files in the `res/` directory.

## Development Rules

- **Bot Independence** - Bots must work as independent entities and can run on separate servers. They communicate via WebSocket like regular users, not through direct process management
- **Channel Token Access** - Channels don't require tokens for tipping functionality by default. Token access is an exception, not the rule
- **No Default Parameters** - Avoid setting default parameters in configuration files
- **Channel ID Requirement** - Every data message sent to the webapp for display must include `channelId` field
- **No New Entities** - Do not introduce new configuration entities, fields, or concepts without explicit user request. Stick to existing architecture patterns
- **Use Existing Systems** - Do not create duplicate functionality. Use existing signature verification, message handling, and authentication systems that are already implemented
- **CRITICAL SECURITY RULE** - ALL WebSocket messages (including bot responses) MUST be signed with NEAR signatures. NEVER skip signature validation or create security bypasses. Bots must sign ALL their messages, including internal responses like `miniapp_response`
- **NO MOCK DATA OR STUBS** - NEVER write mock data, stubs, or placeholder implementations. Always implement functionality completely. If implementation approach is unclear, ask the user for clarification instead of creating fake/temporary solutions. Real functionality must be working from the start
- **Permission Validation** - Server validates all bot actions against `allowedRequestTypes` before execution. Adding new bot capabilities requires updating both bot config and server validation logic

### Miniapp Development
- **Read the Guide** - For developing bots with miniapps, read `MINIAPP_BOT_DEVELOPMENT.md` for comprehensive architecture and patterns
- **Follow Lifecycle** - Properly implement initialization, data loading, and update handling patterns
- **Security First** - Clean sensitive data before sending to miniapps, validate all user inputs