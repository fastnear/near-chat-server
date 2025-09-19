# Bot Independence Upgrade Plan

## Overview
Transform the current bot system from server-managed processes to fully independent WebSocket clients that can run on separate servers.

## Security Model
- Server uses `server.near` account to sign trusted messages to bots
- Bots verify server identity through NEAR signature validation
- Each bot has `allowedRequestSignedIntent` and `allowedServerEvents` permissions

## Phase 1: Configuration Changes

### 1.1 Bot Configuration Updates
Update `bots-config.json` structure:

```json
{
  "tip-bot": {
    "name": "Tip Bot",
    "displayName": "@tipbot",
    "accountId": "tipbot.near",
    "channels": ["general", "developers"],
    "filters": {
      "commands": ["/tip"],
      "mentions": ["@tipbot"]
    },
    "enabled": true,
    "allowedRequestSignedIntent": true,
    "allowedServerEvents": ["tip_status_update", "storage_required", "intent_created"]
  },
  "gpt-bot": {
    "name": "GPT Assistant",
    "displayName": "@ai",
    "accountId": "ai-is-near.near",
    "channels": ["general", "developers"],
    "filters": {
      "commands": ["/ask", "/gpt"],
      "mentions": ["@gpt", "@ai"]
    },
    "enabled": true,
    "allowedRequestSignedIntent": false,
    "allowedServerEvents": ["channel_activity"]
  }
}
```

### 1.2 Server Configuration
Add server identity to environment:
```env
SERVER_ACCOUNT_ID=server.near
SERVER_PRIVATE_KEY=ed25519:...
```

## Phase 2: Server Changes

### 2.1 Remove Bot Process Management
- **DELETE:** `src/bot-manager.js` (entire file)
- **REMOVE from index.js:**
  - `import BotManager` (line 21)
  - `const botManager = new BotManager()` (line 479)
  - `botManager.startAllBots()` (line 510)
  - `botManager.startBotsForChannel(channelId)` (line 750)
  - `botManager.stopAllBots()` (lines 1785, 1793)

### 2.2 Add Server Event System
Create `src/server-events.js`:

```javascript
export class ServerEventSystem {
  constructor(serverAccountId, serverPrivateKey) {
    this.serverAccountId = serverAccountId;
    this.serverPrivateKey = serverPrivateKey;
    this.wsClients = null; // Will be injected
  }

  setWSClients(wsClients) {
    this.wsClients = wsClients;
  }

  async sendServerEvent(channelId, eventType, payload) {
    const eventData = {
      action: "server_event",
      channelId,
      eventType,
      payload,
      metadata: {
        accountId: this.serverAccountId,
        contractId: null,
        publicKey: getPublicKeyFromKeyPair(getKeyPairFromPrivateKey(this.serverPrivateKey)),
        timestampMs: Date.now()
      }
    };

    const serializedData = JSON.stringify(eventData);
    const signature = signMessage(this.serverPrivateKey, serializedData);

    const signedEvent = {
      signature,
      serializedData
    };

    // Send to all bots in channel that allow this event type
    for (const [ws, client] of this.wsClients.entries()) {
      if (client.isBot && client.channels.has(channelId)) {
        const botConfig = getBotConfig(client.botId);
        if (botConfig?.allowedServerEvents?.includes(eventType)) {
          try {
            ws.send(JSON.stringify(signedEvent));
          } catch (e) {
            console.error(`Failed to send server event to bot ${client.botId}:`, e);
          }
        }
      }
    }
  }
}
```

### 2.3 Update Bot Registration
Modify `handleRegisterBot` in `index.js`:

```javascript
const handleRegisterBot = (ws, data, signedData) => {
  const { accountId } = data.metadata;
  const client = data.client;
  const botId = data.botId;

  // ... existing validation ...

  // Check if bot with this accountId is already connected
  for (const [existingWs, existingClient] of wsClients.entries()) {
    if (existingClient.isBot && existingClient.botAccountId === accountId && existingWs !== ws) {
      throw new Error(`Bot with account ${accountId} is already connected`);
    }
  }

  // ... existing bot registration logic ...

  // Send server identity to bot
  try {
    ws.send(JSON.stringify({
      type: "server_identity",
      data: {
        serverAccountId: process.env.SERVER_ACCOUNT_ID,
        serverPublicKey: getPublicKeyFromKeyPair(getKeyPairFromPrivateKey(process.env.SERVER_PRIVATE_KEY))
      }
    }));
  } catch (e) {
    console.log("Failed to send server identity", e);
  }
};
```

### 2.4 Add Permission Checks
Update `handleSignedIntent` in `index.js`:

```javascript
const handleSignedIntent = async (ws, data, signedData) => {
  const { accountId } = data.metadata;
  const client = wsClients.get(ws);

  // Check if this bot is allowed to process signed intents
  if (client.isBot) {
    const botConfig = getBotConfig(client.botId);
    if (!botConfig?.allowedRequestSignedIntent) {
      throw new Error("Bot not authorized to process signed intents");
    }
  }

  // ... rest of existing logic ...
};
```

## Phase 3: Move Logic from Server to Bots

### 3.1 Remove from Server (index.js)
**DELETE these functions entirely:**
- `checkIntentStatus` (lines 263-420)
- `handleRequestTipIntent` (lines 1218-1364)
- `handleDepositRequest` (lines 1366-1404)

**REPLACE broadcastToChannel calls with serverEvents.sendServerEvent:**
- In `handleSignedIntent`: Replace broadcasts with server events
- Remove tip-specific logic, keep only intent processing

### 3.2 Update Tip Bot (bots/tip-bot.js)
**ADD moved functions:**
- Move `checkIntentStatus` from server
- Move `handleRequestTipIntent` logic
- Move `handleDepositRequest` logic
- Add server event listener

**ADD server event handling:**
```javascript
handleServerEvent(eventData) {
  const { eventType, payload } = eventData;

  switch (eventType) {
    case "tip_status_update":
      this.handleTipStatusUpdate(payload);
      break;
    case "storage_required":
      this.handleStorageRequired(payload);
      break;
    case "intent_created":
      this.handleIntentCreated(payload);
      break;
  }
}
```

## Phase 4: Bot Communication Protocol

### 4.1 New Message Types
**From Server to Bots:**
- `server_identity` - Server account info on registration
- `server_event` - Signed events (tip_status_update, etc.)

**From Bots to Server:**
- Existing: `register_bot`, `join`, `message`, etc.
- NEW: `request_server_event` - Bot requests server to send event

### 4.2 Server Event Types
- `tip_status_update` - Intent processing status changes
- `storage_required` - User needs token registration
- `intent_created` - New tip intent created
- `channel_activity` - General channel events for other bots

## Phase 5: Startup Changes

### 5.1 Remove Bot Startup Scripts
- **DELETE:** All `start-*-bot.sh` scripts
- Bots now start independently

### 5.2 Update Deployment
Bots run as separate services:
```bash
# Server
npm start

# Bots (separately)
cd bots && node tip-bot.js
cd bots && node gpt-bot.js
```

## Phase 6: Testing Strategy

### 6.1 Integration Tests
- Mock bot connections
- Test server event delivery
- Verify permission checks
- Test intent flow end-to-end

### 6.2 Security Tests
- Verify bots can't spoof server events
- Test unauthorized bot rejection
- Validate signature verification

## Implementation Order

1. **First:** Write comprehensive tests for existing functionality
2. **Second:** Implement configuration changes (Phase 1)
3. **Third:** Add server event system (Phase 2.2, 2.3)
4. **Fourth:** Move logic to bots (Phase 3)
5. **Fifth:** Remove old bot management (Phase 2.1)
6. **Sixth:** Update deployment (Phase 5)

## Rollback Plan

- Keep old BotManager code in git history
- Feature flags for server event system
- Gradual migration: run both systems in parallel initially

## Success Criteria

- ✅ Bots work independently on separate servers
- ✅ All tip functionality preserved
- ✅ Server simplified (no process management)
- ✅ Secure server-bot communication
- ✅ No breaking changes for regular users
- ✅ Full test coverage maintained

## Risk Mitigation

- **Risk:** Bot disconnection breaks tips
  **Mitigation:** Server keeps pendingIntents, events are queued

- **Risk:** Server event spoofing
  **Mitigation:** NEAR signature validation by bots

- **Risk:** Performance degradation
  **Mitigation:** Benchmark before/after, optimize event delivery

## Notes

- `pendingIntents` remains on server for consistency
- Server becomes pure message router + intent processor
- Bots gain full independence while maintaining security
- Existing WebSocket API unchanged for regular clients