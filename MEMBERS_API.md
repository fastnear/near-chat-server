# Members API Documentation

## How to Request Channel Members

Send a message with action `"members"`:

```javascript
{
  action: "members",
  channelId: "general",
  metadata: {
    accountId: "user.near",
    // ... other metadata
  }
}
```

## Response Structure

```javascript
{
  type: "members",
  data: {
    channelId: "general",
    members: [
      {
        clientId: "uuid-123",
        accountId: "alice.near",
        isBot: false,
        botAccountId: null,
        joinedAt: null
      },
      {
        clientId: "uuid-456", 
        accountId: "tip-bot.near",
        isBot: true,
        botAccountId: "tip-bot.near",
        joinedAt: null
      }
    ],
    totalCount: 2,
    humanCount: 1,
    botCount: 1
  }
}
```

## AI Agent Display Guide

### Basic Display Format
```
Channel Members (2):
👤 alice.near (human)
🤖 tip-bot.near (bot)
```

### Detailed Display
```
📊 Channel Statistics:
• Total: 2 members
• Humans: 1
• Bots: 1

👥 Member List:
👤 alice.near
🤖 tip-bot.near (Bot)
```

### Compact Display
```
Members: 1 human, 1 bot
👤 alice.near | 🤖 tip-bot.near
```

### Member Categorization
- **Human members**: `isBot: false` - show with 👤 icon
- **Bot members**: `isBot: true` - show with 🤖 icon
- Use `accountId` for display name
- `botAccountId` contains the bot's account (same as `accountId` for bots)

### Sorting Recommendations
1. Humans first, then bots
2. Alphabetical within each category
3. Or by join time if `joinedAt` is implemented