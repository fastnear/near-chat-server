# Reply API Documentation

## How to Send Replies

### Message Structure
To reply to a message, include a `replyTo` field in your message object:

```javascript
{
  action: "message",
  channelId: "general",
  message: {
    text: "This is a reply!",
    replyTo: 123  // nonce (ID) of the original message
  },
  metadata: {
    accountId: "user.near",
    // ... other metadata
  }
}
```

### Message Types
1. **Regular message**: `message: "Hello world"` (string)
2. **Reply message**: `message: { text: "Reply text", replyTo: 123 }` (object)

## UI Implementation Guide

### Displaying Messages
Each message received has this structure:
```javascript
{
  type: "channel",
  data: {
    channelId: "general",
    action: "message",
    nonce: 124,  // This message's unique ID
    message: {
      text: "Reply text",
      replyTo: 123  // ID of original message (if this is a reply)
    },
    clientIdentity: {
      accountId: "user.near",
      clientId: "uuid..."
    },
    timestampMs: 1640995200000
  }
}
```

### UI Display Logic
```javascript
// Check if message is a reply
if (message.replyTo) {
  // Find original message in your message history
  const originalMessage = messageHistory.find(msg => msg.nonce === message.replyTo);
  
  // Display as:
  // ┌─ Reply to @originalUser: "Original text..."
  // └─ @currentUser: "Reply text"
}
```

### Getting Message IDs
- **All messages you receive** include `nonce` field (unique ID)
- **Your own sent messages** will come back via WebSocket with their `nonce`
- Store message IDs to enable reply functionality

### Reply UI Flow
1. User clicks "Reply" on message with `nonce: 123`
2. Show reply composer with reference to original message
3. Send message with `replyTo: 123`
4. Display threaded conversation in UI

## Validation Rules
- `replyTo` must be a positive number
- Original message must exist in channel history
- Server validates replied message exists before accepting