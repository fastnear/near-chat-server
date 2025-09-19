# Message Metadata API Documentation

## Overview

The NEAR Chat Server now supports rich message metadata including image attachments, message pinning, and reactions. This document describes how to use these features from the web application.

## Important: Signed Data

When sending messages with metadata, the URL and metadata information must be included in the signed data. This means the web app should:

1. Prepare the complete message object with metadata
2. Serialize it for signing
3. Have the user sign it with their NEAR account key
4. Send the signed data to the server

## Message Structure

Messages now support an optional `messageMetadata` field:

```javascript
{
  "action": "message",
  "channelId": "my-channel",
  "message": {
    "text": "Check out this image!",
    "replyTo": 123 // optional nonce of message being replied to
  },
  "messageMetadata": {
    // Optional fields - only include if you have data
    "attachments": [...],        // Array of image attachments (max 10)
    "isPinned": true,           // Only for moderators/channel creators
    "reactionCounts": {...}     // Read-only, managed by server
  }
}
```

## 1. Image Attachments

### Sending Messages with Images

```javascript
// Example: Send message with image attachments
const messageData = {
  action: "message",
  channelId: "general",
  message: {
    text: "Look at these photos!"
  },
  messageMetadata: {
    attachments: [
      {
        type: "image",
        url: "https://example.com/image1.jpg",
        width: 800,        // optional
        height: 600,       // optional
        alt: "Sunset photo" // optional description
      },
      {
        type: "image",
        url: "https://example.com/image2.png"
      }
    ]
  },
  metadata: {
    accountId: "user.near",
    contractId: "social.near",
    publicKey: "ed25519:...",
    timestampMs: Date.now()
  }
};

// Sign and send this data
```

### Limits
- Maximum 10 attachments per message
- Server will automatically limit and log if exceeded
- Each attachment must have `type` and `url` fields

### Received Messages
```javascript
// Server sends messages with attachments like this:
{
  "type": "channel",
  "data": {
    "channelId": "general",
    "action": "message",
    "nonce": 456,
    "message": {
      "text": "Look at these photos!"
    },
    "messageMetadata": {
      "attachments": [
        {
          "type": "image",
          "url": "https://example.com/image1.jpg",
          "width": 800,
          "height": 600,
          "alt": "Sunset photo"
        }
      ]
    },
    "timestampMs": 1634567890123,
    "clientIdentity": {...}
  }
}
```

## 2. Message Pinning

### Pin/Unpin Messages (Moderators Only)

```javascript
// Pin a message
const pinData = {
  action: "pin_message",
  channelId: "general",
  messageNonce: 123,
  isPinned: true,
  metadata: {
    accountId: "moderator.near",
    contractId: "social.near",
    publicKey: "ed25519:...",
    timestampMs: Date.now()
  }
};

// Unpin a message
const unpinData = {
  action: "pin_message",
  channelId: "general",
  messageNonce: 123,
  isPinned: false,
  metadata: {...}
};
```

### Get Pinned Messages

```javascript
// Request pinned messages for a channel
const requestData = {
  action: "pinned_messages",
  channelId: "general",
  metadata: {
    accountId: "user.near",
    contractId: "social.near",
    publicKey: "ed25519:...",
    timestampMs: Date.now()
  }
};
```

### Server Responses

```javascript
// Pin update notification (sent to all channel members)
{
  "type": "pin_update",
  "data": {
    "channelId": "general",
    "messageNonce": 123,
    "isPinned": true,
    "pinnedBy": "moderator.near"
  }
}

// Pinned messages response
{
  "type": "pinned_messages",
  "data": {
    "channelId": "general",
    "pinnedMessages": [
      {
        "nonce": 123,
        "action": "message",
        "message": {"text": "Important announcement!"},
        "messageMetadata": {"isPinned": true},
        "timestampMs": 1634567890123,
        "clientIdentity": {...}
      }
    ]
  }
}
```

### Permissions
- Only channel moderators (admins) and channel creators can pin/unpin messages
- Regular users will get "Permission denied" error

## 3. Message Reactions

### Add/Remove Reactions

```javascript
// Add reaction (when user clicks on reaction they haven't used yet)
const reactionData = {
  action: "reaction",
  channelId: "general",
  messageNonce: 123,
  emoji: "👍",
  reactionAction: "add",
  metadata: {
    accountId: "user.near",
    contractId: "social.near",
    publicKey: "ed25519:...",
    timestampMs: Date.now()
  }
};

// Remove reaction (when user clicks on reaction they already have)
const reactionData = {
  action: "reaction",
  channelId: "general",
  messageNonce: 123,
  emoji: "👍",
  reactionAction: "remove", // ← Important: use "remove" to delete existing reaction
  metadata: {
    accountId: "user.near",
    contractId: "social.near",
    publicKey: "ed25519:...",
    timestampMs: Date.now()
  }
};
```

### ⚠️ Client Implementation Notes

**React Toggle Logic**: The web app must track which reactions the current user has added and send the correct `reactionAction`:

```javascript
// Example client logic
const handleReactionClick = (emoji, messageNonce) => {
  const currentUser = "user.near";
  const message = getMessageByNonce(messageNonce);

  // Check if user already has this reaction
  const userHasReaction = checkIfUserHasReaction(message, currentUser, emoji);

  const reactionAction = userHasReaction ? "remove" : "add";

  sendReaction({
    action: "reaction",
    channelId: currentChannelId,
    messageNonce,
    emoji,
    reactionAction, // ← This determines add/remove
    metadata: {...}
  });
};
```

### Get Detailed Reaction Information

```javascript
// Get who reacted and when
const detailsRequest = {
  action: "reaction_details",
  channelId: "general",
  messageNonce: 123,
  metadata: {
    accountId: "user.near",
    contractId: "social.near",
    publicKey: "ed25519:...",
    timestampMs: Date.now()
  }
};
```

### Server Responses

```javascript
// Reaction update (personalized for each user)
// Bob (who just reacted) receives:
{
  "type": "reaction_update",
  "data": {
    "channelId": "general",
    "messageNonce": 123,
    "emoji": "👍",
    "reactionAction": "add",
    "accountId": "bob.near",
    "reactionCounts": {
      "👍": 3,
      "❤️": 1
    },
    "userReactionCounts": {
      "👍": 1  // Bob now has 👍 reaction
    }
  }
}

// Alice (who has different reactions) receives:
{
  "type": "reaction_update",
  "data": {
    "channelId": "general",
    "messageNonce": 123,
    "emoji": "👍",
    "reactionAction": "add",
    "accountId": "bob.near",
    "reactionCounts": {
      "👍": 3,
      "❤️": 1
    },
    "userReactionCounts": {
      "❤️": 1  // Alice has ❤️ reaction
    }
  }
}

// Charlie (who has no reactions) receives:
{
  "type": "reaction_update",
  "data": {
    "channelId": "general",
    "messageNonce": 123,
    "emoji": "👍",
    "reactionAction": "add",
    "accountId": "bob.near",
    "reactionCounts": {
      "👍": 3,
      "❤️": 1
    }
    // No userReactionCounts field - Charlie has no reactions
  }
}

// Detailed reaction information
{
  "type": "reaction_details",
  "data": {
    "channelId": "general",
    "messageNonce": 123,
    "reactions": [
      {
        "emoji": "👍",
        "accountId": "user1.near",
        "timestampMs": 1634567890123
      },
      {
        "emoji": "👍",
        "accountId": "user2.near",
        "timestampMs": 1634567890456
      },
      {
        "emoji": "❤️",
        "accountId": "user3.near",
        "timestampMs": 1634567890789
      }
    ]
  }
}
```

### Reaction Limits

Each user can only have **1 reaction** per message. If a user tries to add a second reaction, their oldest reaction will be automatically removed first.

```javascript
// User adds 👍 reaction
// User later adds ❤️ reaction
// → The 👍 reaction is automatically removed and replaced with ❤️
```

### Message Display
Messages include both `reactionCounts` (total) and `userReactionCounts` (current user's reactions):

```javascript
{
  "type": "channel",
  "data": {
    "nonce": 123,
    "message": {"text": "Great idea!"},
    "messageMetadata": {
      "reactionCounts": {
        "👍": 3,
        "❤️": 1
      },
      "userReactionCounts": {
        "👍": 1  // Current user has reacted with 👍
      }
    }
  }
}
```

### Client Usage of userReactionCounts

The `userReactionCounts` field helps determine UI state:

```javascript
// Example client logic
const renderReactionButton = (emoji, message, currentUser) => {
  const totalCount = message.messageMetadata?.reactionCounts?.[emoji] || 0;
  const userHasReaction = message.messageMetadata?.userReactionCounts?.[emoji] > 0;

  return (
    <button
      className={userHasReaction ? 'reaction-active' : 'reaction-inactive'}
      onClick={() => handleReactionClick(emoji, message.nonce)}
    >
      {emoji} {totalCount}
    </button>
  );
};

const handleReactionClick = (emoji, messageNonce) => {
  const message = getMessageByNonce(messageNonce);
  const userHasReaction = message.messageMetadata?.userReactionCounts?.[emoji] > 0;

  const reactionAction = userHasReaction ? "remove" : "add";

  sendReaction({
    action: "reaction",
    channelId: currentChannelId,
    messageNonce,
    emoji,
    reactionAction, // ← Correctly determined from userReactionCounts
    metadata: {...}
  });
};
```

## 4. Traffic Optimization

The server only sends metadata fields that contain data:

- Empty `attachments` arrays are removed
- `isPinned` only appears if `true`
- `reactionCounts` only appears if reactions exist
- If `messageMetadata` becomes empty, it's not sent at all

## 5. Example: Complete Message Flow

### 1. User uploads image and sends message
```javascript
const messageData = {
  action: "message",
  channelId: "general",
  message: {
    text: "Check this out!"
  },
  messageMetadata: {
    attachments: [
      {
        type: "image",
        url: "https://cdn.example.com/user-upload-123.jpg",
        width: 1024,
        height: 768
      }
    ]
  },
  metadata: {
    accountId: "alice.near",
    contractId: "social.near",
    publicKey: "ed25519:ABC123...",
    timestampMs: 1634567890123
  }
};

// This data is signed by alice.near and sent to server
```

### 2. Other users see the message
```javascript
{
  "type": "channel",
  "data": {
    "channelId": "general",
    "nonce": 456,
    "action": "message",
    "message": {"text": "Check this out!"},
    "messageMetadata": {
      "attachments": [{
        "type": "image",
        "url": "https://cdn.example.com/user-upload-123.jpg",
        "width": 1024,
        "height": 768
      }]
      // No userReactionCounts yet - no reactions on this message
    },
    "clientIdentity": {
      "accountId": "alice.near",
      "publicKey": "ed25519:ABC123...",
      "clientId": "uuid-123"
    },
    "timestampMs": 1634567890123
  }
}
```

### 3. Moderator pins the message
```javascript
const pinData = {
  action: "pin_message",
  channelId: "general",
  messageNonce: 456,
  isPinned: true,
  metadata: {
    accountId: "moderator.near",
    contractId: "social.near",
    publicKey: "ed25519:DEF456...",
    timestampMs: 1634567890200
  }
};
```

### 4. Everyone gets pin notification
```javascript
{
  "type": "pin_update",
  "data": {
    "channelId": "general",
    "messageNonce": 456,
    "isPinned": true,
    "pinnedBy": "moderator.near"
  }
}
```

### 5. Users react to the message
```javascript
const reactionData = {
  action: "reaction",
  channelId: "general",
  messageNonce: 456,
  emoji: "👍",
  reactionAction: "add",
  metadata: {
    accountId: "bob.near",
    contractId: "social.near",
    publicKey: "ed25519:GHI789...",
    timestampMs: 1634567890300
  }
};
```

### 6. Everyone gets personalized reaction update
```javascript
// Bob (who just reacted) receives:
{
  "type": "reaction_update",
  "data": {
    "channelId": "general",
    "messageNonce": 456,
    "emoji": "👍",
    "reactionAction": "add",
    "accountId": "bob.near",
    "reactionCounts": {
      "👍": 1
    },
    "userReactionCounts": {
      "👍": 1  // Bob now has this reaction
    }
  }
}

// Alice (original author, no reactions) receives:
{
  "type": "reaction_update",
  "data": {
    "channelId": "general",
    "messageNonce": 456,
    "emoji": "👍",
    "reactionAction": "add",
    "accountId": "bob.near",
    "reactionCounts": {
      "👍": 1
    }
    // No userReactionCounts - Alice has no reactions
  }
}
```

### 7. Users see updated message with reactions
```javascript
// Bob (who reacted) sees:
{
  "messageMetadata": {
    "attachments": [...],
    "isPinned": true,
    "reactionCounts": {
      "👍": 1
    },
    "userReactionCounts": {
      "👍": 1  // Bob has reacted with 👍
    }
  }
}

// Alice (original author) sees:
{
  "messageMetadata": {
    "attachments": [...],
    "isPinned": true,
    "reactionCounts": {
      "👍": 1
    }
    // No userReactionCounts - Alice hasn't reacted yet
  }
}
```

## Important Rules and Limitations

### Image Attachments
- Maximum **10 images** per message
- Images must have `type` and `url` fields
- Optional: `width`, `height`, `alt` fields

### Message Pinning
- Only **channel moderators** and **channel creators** can pin messages
- Pinned messages appear in channel header via `pinned_messages` action

### Reactions
- Each user can have **maximum 1 reaction** per message
- Adding a new reaction automatically removes the user's previous reaction
- Use `reaction_details` to see who reacted and when
- Message display shows only reaction counts for traffic efficiency

### Data Signing
- **All metadata must be included in signed data**
- Image URLs, pin status, and reaction info must be signed by user's NEAR key
- This prevents tampering and ensures authenticity

### UI Recommendations
- **Reaction Details**: Place the "View reaction details" option in the message context menu (right-click menu), not as a separate button near reactions
- **Reaction Toggle**: Clicking on a reaction the user already has should remove it (`reactionAction: "remove"`)
- **Visual Feedback**: Highlight reactions that the current user has added
- **Context Menu Items**: Add "Pin message" (for moderators), "View reaction details", and other message actions to the right-click menu

## Summary of New WebSocket Actions

| Action | Description | Required Fields | Permissions |
|--------|-------------|-----------------|-------------|
| `message` | Send message with optional metadata | `channelId`, `message`, optional `messageMetadata` | Channel members |
| `reaction` | Add/remove reaction | `channelId`, `messageNonce`, `emoji`, `reactionAction` | Channel members |
| `pin_message` | Pin/unpin message | `channelId`, `messageNonce`, `isPinned` | Moderators only |
| `pinned_messages` | Get pinned messages | `channelId` | Channel members |
| `reaction_details` | Get detailed reaction info | `channelId`, `messageNonce` | Channel members |

## Summary of New WebSocket Notifications

| Type | Description | Data Fields |
|------|-------------|-------------|
| `reaction_update` | Reaction added/removed | `channelId`, `messageNonce`, `emoji`, `reactionAction`, `accountId`, `reactionCounts`, optional `userReactionCounts` |
| `pin_update` | Message pinned/unpinned | `channelId`, `messageNonce`, `isPinned`, `pinnedBy` |
| `pinned_messages` | Response with pinned messages | `channelId`, `pinnedMessages[]` |
| `reaction_details` | Response with detailed reactions | `channelId`, `messageNonce`, `reactions[]` |

All notifications include `channelId` for proper client-side routing.

## Bot Activity Messages

Messages with `action: "joined"`, `action: "left"`, or `action: "disconnected"` from bots include an `isBot: true` field:

```javascript
// Bot joining channel
{
  "action": "joined",
  "clientIdentity": {
    "accountId": "ai-is-near.near",
    "contractId": "social.near",
    "publicKey": "ed25519:...",
    "clientId": "uuid-123"
  },
  "message": "GPT Assistant has joined the channel",
  "timestampMs": 1758106173634,
  "nonce": 260,
  "isBot": true  // ← Only present for bot activity
}

// Human joining channel (no isBot field)
{
  "action": "joined",
  "clientIdentity": {
    "accountId": "alice.near",
    "contractId": null,
    "publicKey": "ed25519:...",
    "clientId": "uuid-456"
  },
  "message": "alice.near joined the channel",
  "timestampMs": 1758106173635,
  "nonce": 261
  // No isBot field for humans
}
```

### Client Usage

```javascript
// Filter out bot activity from chat history
const filterMessages = (messages) => {
  return messages.filter(msg => {
    // Hide bot join/leave messages
    if (msg.isBot && (msg.action === 'joined' || msg.action === 'left' || msg.action === 'disconnected')) {
      return false;
    }
    return true;
  });
};

// Or show bot activity differently
const renderMessage = (msg) => {
  if (msg.isBot && msg.action === 'joined') {
    return <BotJoinedNotice message={msg} />;
  }
  if (msg.action === 'joined') {
    return <UserJoinedNotice message={msg} />;
  }
  return <RegularMessage message={msg} />;
};
```

This allows clients to:
- Hide bot activity from main chat flow
- Show bot joins in a separate notifications area
- Style bot messages differently from user messages
- Keep clean chat history focused on human conversation