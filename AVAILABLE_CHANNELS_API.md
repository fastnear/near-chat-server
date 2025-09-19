# Available Channels API

## Overview

The `available_channels` action returns a list of channels that the user can see and access. This includes both configured channels (from `channels-config.json`) and user-created channels they've joined.

## Usage

### Request
```javascript
{
  action: "available_channels",
  metadata: {
    accountId: "user.near",
    contractId: null,
    publicKey: "ed25519:...",
    timestampMs: Date.now()
  }
}
```

### Response
```javascript
{
  type: "available_channels",
  data: {
    channels: {
      "general": {
        name: "General Chat",
        description: "Main discussion channel",
        isPublic: true,
        defaultToken: "wrap.near",
        tokenDecimals: 24,
        tokenSymbol: "wNEAR",
        minTipAmount: 0.01,
        memberCount: 15,
        botsCount: 2,
        isConfigured: true,  // This is a configured channel
        hasVisited: true     // User has visited this channel before
      },
      "private-room-abc123": {
        name: "private-room-abc123",
        description: "User-created channel",
        isPublic: false,
        defaultToken: "wrap.near",
        tokenDecimals: 24,
        tokenSymbol: "wNEAR",
        minTipAmount: 0.01,
        memberCount: 3,
        botsCount: 1,
        isConfigured: false,  // This is a user-created channel
        createdBy: "alice.near",
        createdAt: 1634567890123,
        hasVisited: false     // User hasn't visited this channel yet
      }
    }
  }
}
```

## Channel Types

### 1. Configured Channels (`isConfigured: true`)
These are channels defined in `channels-config.json`:
- Have custom names, descriptions, and settings
- Subject to access rules (token-gated, admin-only, etc.)
- Only shown if user has access AND `showInDiscovery: true`
- Use configured token settings

### 2. User-Created Channels (`isConfigured: false`)
These are private channels created when users join non-existent channels:
- Only visible to users who have joined them in current session
- Use channel ID as display name
- Always marked as private (`isPublic: false`)
- Include creator and creation timestamp
- Use default token settings (wrap.near)

## Client Implementation

### Displaying Channel List
```javascript
const renderChannelList = (availableChannels) => {
  const configured = [];
  const userCreated = [];

  Object.entries(availableChannels).forEach(([channelId, channel]) => {
    if (channel.isConfigured) {
      configured.push({ channelId, ...channel });
    } else {
      userCreated.push({ channelId, ...channel });
    }
  });

  return (
    <div>
      <h3>Public Channels</h3>
      {configured.map(channel =>
        <ChannelItem
          key={channel.channelId}
          {...channel}
          icon="🌐"
          showWelcome={!channel.hasVisited}
        />
      )}

      <h3>Private Channels</h3>
      {userCreated.map(channel =>
        <ChannelItem
          key={channel.channelId}
          {...channel}
          icon="🔒"
          showWelcome={!channel.hasVisited}
        />
      )}
    </div>
  );
};
```

### First-Time Visit Logic
```javascript
const handleChannelClick = (channel) => {
  if (!channel.hasVisited) {
    // Show welcome/introduction modal first
    showChannelWelcome(channel).then(() => {
      joinChannel(channel.channelId);
    });
  } else {
    // Join directly for returning users
    joinChannel(channel.channelId);
  }
};

const showChannelWelcome = (channel) => {
  return new Promise((resolve) => {
    const modal = createModal({
      title: `Welcome to ${channel.name}!`,
      content: `
        <div>
          <p>${channel.description}</p>
          ${channel.isConfigured ? `
            <p><strong>Token:</strong> ${channel.tokenSymbol}</p>
            <p><strong>Min tip:</strong> ${channel.minTipAmount} ${channel.tokenSymbol}</p>
          ` : `
            <p><strong>Created by:</strong> ${channel.createdBy}</p>
            <p><strong>Private channel</strong> - Only invited members can see this</p>
          `}
          <p><strong>Members:</strong> ${channel.memberCount} humans, ${channel.botsCount} bots</p>
        </div>
      `,
      buttons: [
        { text: 'Join Channel', primary: true, onClick: resolve },
        { text: 'Cancel', onClick: () => modal.close() }
      ]
    });
    modal.show();
  });
};
```

### Channel Indicators
```javascript
const ChannelItem = ({
  channelId,
  name,
  memberCount,
  botsCount,
  isConfigured,
  createdBy,
  hasVisited,
  showWelcome
}) => (
  <div className={`channel-item ${!hasVisited ? 'new-channel' : ''}`}>
    <span className="channel-icon">
      {isConfigured ? "🌐" : "🔒"}
    </span>
    <span className="channel-name">
      {name}
      {!hasVisited && <span className="new-badge">NEW</span>}
    </span>
    <span className="channel-counts">
      👥 {memberCount} 🤖 {botsCount}
    </span>
    {!isConfigured && (
      <span className="channel-creator">by {createdBy}</span>
    )}
    {showWelcome && (
      <span className="welcome-indicator">Click to see info</span>
    )}
  </div>
);
```

### CSS Styling
```css
.channel-item.new-channel {
  border-left: 3px solid #4CAF50;
  background-color: rgba(76, 175, 80, 0.1);
}

.new-badge {
  background: #4CAF50;
  color: white;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 10px;
  margin-left: 8px;
}

.welcome-indicator {
  font-size: 12px;
  color: #666;
  font-style: italic;
}
```

## When to Refresh

The client should request `available_channels` when:
1. User first connects to the app
2. After joining a new channel (to see it appear in the list)
3. Periodically to get updated member counts
4. After receiving invite links or channel access changes

## Important Notes

- **Session-based**: User-created channels are only shown if the user has joined them in the current session
- **Real-time updates**: Member/bot counts reflect current online users
- **Privacy**: Users can't see private channels they haven't joined
- **Access control**: Configured channels are filtered by user's access permissions
- **Visit tracking**: Server remembers which channels each user has visited across sessions
- **Channel cleanup**: When channels are deleted for inactivity, visit history is also cleaned up
- **Persistent storage**: Visit history survives server restarts

## Example Flow

### First-Time User Experience
1. **User connects**: Gets list of configured channels with `hasVisited: false`
2. **User clicks channel**: Shows welcome modal with channel info, then joins
3. **Server marks as visited**: Channel is added to user's visit history
4. **User disconnects/reconnects**: Same channel now shows `hasVisited: true`

### Returning User Experience
1. **User connects**: Channels they've visited show `hasVisited: true`
2. **User clicks visited channel**: Joins directly without welcome modal
3. **User joins new private channel**: Appears with `hasVisited: false` initially
4. **After joining**: Private channel marked as visited for future sessions

### Channel Lifecycle
1. **Channel created**: All users see it as `hasVisited: false`
2. **Users join over time**: Each user gets individual visit tracking
3. **Channel becomes inactive**: Server automatically deletes it
4. **Visit history cleaned**: All users' visit records for this channel removed
5. **Channel recreated later**: All users see it as `hasVisited: false` again

### Data Persistence
- Visit history stored in `server-state.json`
- Survives server restarts and updates
- Automatically cleaned when channels are deleted
- Memory-efficient: only stores channel IDs per user

This ensures users get proper onboarding for new channels while having smooth access to familiar ones.