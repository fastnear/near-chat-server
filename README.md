# NEAR Chat Server

A WebSocket-based chat server integrated with NEAR Protocol for authenticated messaging and token tipping functionality.

## Architecture Overview

### Core Components

**WebSocket Server** (`src/index.js`)
- Handles client connections and message routing
- NEAR signature validation for all messages
- Channel-based messaging with access control
- State persistence for message history

**Channel System** (`src/channels-service.js`)
- Rule-based channel access control
- Admin permissions and user management
- Dynamic channel creation by users

**Bot Framework** (`src/bot-manager.js`, `src/bots-service.js`)
- Pluggable bot system with process management
- Automatic bot startup/shutdown
- Message routing to relevant bots

**NEAR Integration** (`src/near.js`)
- Message signature verification
- Account validation and access key management
- Integration with NEAR Intents protocol

### Key Features

**Authentication**
- All messages must be signed with NEAR account keys
- Public key validation against NEAR network
- Account ID verification for implicit accounts

**Messaging**
- Real-time WebSocket communication
- Message threading with reply functionality
- Message deletion with permission checks
- Persistent message history across restarts

**Tipping System**
- NEAR token tipping via Intents protocol
- Balance checking and insufficient funds handling
- Automatic deposit UI for users with low balance
- Transaction confirmation and status updates

**State Management**
- Automatic state saving on server shutdown (Ctrl+C)
- Message history persistence in `res/server-state.json`
- Graceful restart preserving chat history
- Safe restart validation (prevents data loss during active tips)

## Message Types

### Client → Server
- `join` - Join a channel
- `message` - Send chat message (with optional `replyTo`)
- `delete_message` - Delete own message (admins can delete any)
- `history` - Request channel message history
- `members` - Request channel member list
- `signed_intent` - Confirm tip transaction

### Server → Client
- `channel` - Channel message broadcast
- `history` - Message history response
- `members` - Member list response
- `sign_intent` - Tip signing request
- `deposit_ui` - Show deposit interface for insufficient balance
- `tip_status` - Tip transaction status updates

## Configuration

**Channel Config** (`channels-config.json`)
```json
{
  "channelName": {
    "defaultToken": "wrap.near",
    "tokenDecimals": 24,
    "tokenSymbol": "wNEAR",
    "adminUsers": ["admin.near"]
  }
}
```

**Bot Config** (`bots-config.json`)
```json
{
  "bot-name": {
    "enabled": true,
    "channels": ["general"]
  }
}
```

## Bots

**Tip Bot** (`bots/tip-bot.js`)
- Handles `/tip` commands for token transfers
- Integrates with NEAR Intents SDK
- Balance validation and deposit flow
- Reply-based and direct tipping

**GPT Bot** (`bots/gpt-bot.js`)
- AI-powered chat responses
- Configurable per channel

## Development

```bash
npm run dev          # Start with auto-reload
npm run restart      # Safe restart (checks for pending tips)
```

**State Management**
- `Ctrl+C` automatically saves state
- Server loads previous state on startup
- Restart blocked if active tip transactions exist

## Security

- All messages require NEAR signature validation
- Channel access controlled by rules engine
- Admin permissions for message deletion
- No sensitive data stored in state files
- Bot processes isolated and managed

## File Structure

```
src/
├── index.js           # Main WebSocket server
├── channels-service.js # Channel management
├── bots-service.js    # Bot configuration
├── bot-manager.js     # Bot process management
├── near.js           # NEAR Protocol integration
├── rules-engine.js   # Access control rules
└── utils.js          # Utility functions

bots/
├── tip-bot.js        # Token tipping functionality
└── gpt-bot.js        # AI chat responses

res/
├── server-state.json # Persistent message history
└── ws_subs.json      # WebSocket subscriptions
```

## Environment Variables

- `WS_PORT` - WebSocket server port (default: 7071)
- `RES_PATH` - Resource directory path (default: "res")
- `MAX_MESSAGE_DELAY_MS` - Message processing timeout (default: 5000)
- `TIP_BOT_PRIVATE_KEY` - Private key for tip bot NEAR account