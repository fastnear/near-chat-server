# Bot Configuration Documentation

This document describes the configuration format for bots in the NEAR Chat Server system.

## Configuration File Location

`shared/bots-config.json`

## Configuration Structure

Each bot is defined as a key-value pair in the JSON configuration file, where the key is the bot ID and the value is the bot configuration object.

```json
{
  "bot-id": {
    "name": "Display Name",
    "displayName": "@handle",
    "accountId": "account.near",
    "channels": ["channel1", "channel2"],
    "filters": {
      "commands": ["/command"],
      "mentions": ["@handle"]
    },
    "enabled": true,
    "allowedRequestSignedIntent": false,
    "allowedServerEvents": ["event_type"],
    "allowedRequestTypes": ["request_type"]
  }
}
```

## Configuration Fields

### Required Fields

- **`name`** (string): Human-readable name of the bot
- **`displayName`** (string): Display name shown in chat (typically starts with @)
- **`accountId`** (string): NEAR account ID that the bot uses for authentication
- **`channels`** (array): List of channel IDs the bot has access to
- **`enabled`** (boolean): Whether the bot is active and can connect

### Optional Fields

- **`filters`** (object): Defines what messages trigger the bot
  - **`commands`** (array): List of slash commands the bot responds to (e.g., `["/tip", "/help"]`)
  - **`mentions`** (array): List of mention patterns that trigger the bot (e.g., `["@tipbot"]`)

### Permission Fields

#### Server → Bot Communication

- **`allowedServerEvents`** (array): List of server event types this bot can receive
  - Server sends signed events to notify bots about important occurrences
  - Bot will only receive events listed here
  - Common event types:
    - `"tip_status_update"` - Updates about tip transaction status
    - `"storage_required"` - When storage registration is needed
    - `"intent_created"` - When a new intent is created for monitoring
    - `"channel_activity"` - General channel activity notifications
    - `"server_started"` - Server startup notification (sent to all bots regardless of this setting)

#### Bot → Server Communication

- **`allowedRequestTypes`** (array): List of special request types this bot can send to server
  - Standard actions (join, leave, message, etc.) are always allowed
  - Special privileged actions require explicit permission
  - Common request types:
    - `"request_tip_intent"` - Request user to sign a tip intent
    - `"request_add_key"` - Request user to add access key to their account

#### Legacy Permission

- **`allowedRequestSignedIntent`** (boolean): Legacy field for tip functionality
  - `true` - Bot can request users to sign intents
  - `false` - Bot cannot request signing (default for non-financial bots)

## Security Model

The configuration implements a permission-based security model:

1. **Server Events**: Server controls what information each bot receives
2. **Request Types**: Server controls what privileged actions each bot can request
3. **Signature Verification**: All server events are cryptographically signed
4. **Channel Isolation**: Bots only receive events from channels they're configured for

## Example Configurations

### Financial Bot (Tip Bot)
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
    "allowedServerEvents": ["tip_status_update", "storage_required", "intent_created"],
    "allowedRequestTypes": ["request_tip_intent", "request_add_key"]
  }
}
```

### AI Assistant Bot
```json
{
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
    "allowedServerEvents": ["channel_activity"],
    "allowedRequestTypes": []
  }
}
```

### Read-Only Bot
```json
{
  "monitor-bot": {
    "name": "Channel Monitor",
    "displayName": "@monitor",
    "accountId": "monitor.near",
    "channels": ["general"],
    "filters": {
      "commands": [],
      "mentions": []
    },
    "enabled": true,
    "allowedRequestSignedIntent": false,
    "allowedServerEvents": [],
    "allowedRequestTypes": []
  }
}
```

## Adding New Bots

1. Add bot configuration to `shared/bots-config.json`
2. Set appropriate permissions based on bot functionality
3. Restart server to load new configuration
4. Bot can now connect using configured `accountId` for authentication

## Security Best Practices

- **Principle of Least Privilege**: Only grant permissions that bots actually need
- **Financial Operations**: Only tip-related bots should have `allowedRequestSignedIntent: true`
- **Request Types**: Carefully control which bots can make privileged requests
- **Server Events**: Only send relevant events to each bot to minimize attack surface
- **Channel Access**: Limit bot access to only necessary channels