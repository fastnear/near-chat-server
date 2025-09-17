# Message Deletion - WebApp Integration Guide

## Overview
Сервер теперь поддерживает удаление сообщений с проверкой прав доступа.

## New WebSocket Messages

### 1. Enhanced Message Format
Все сообщения теперь содержат поле `canDelete`:

```javascript
{
  type: "channel", // or "history"
  data: {
    action: "message",
    channelId: "general",
    clientIdentity: { ... },
    message: "Hello world",
    nonce: 123,
    timestampMs: 1234567890,
    canDelete: true // NEW FIELD - показывать ли кнопку удалить
  }
}
```

### 2. Message Deletion Event
Когда сообщение удаляется:

```javascript
{
  type: "message_deleted",
  data: {
    messageNonce: 123,
    channelId: "general", 
    deletedBy: "vadim.near"
  }
}
```

## Frontend Implementation

### 1. Add WebSocket Handler
```javascript
case "message_deleted":
  handleMessageDeleted(message.data);
  break;
```

### 2. Show Delete Button
```javascript
function renderMessage(messageData) {
  return `
    <div data-nonce="${messageData.nonce}">
      ${messageData.message}
      ${messageData.canDelete ? 
        `<button onclick="deleteMessage(${messageData.nonce}, '${messageData.channelId}')">🗑️</button>` 
        : ''
      }
    </div>
  `;
}
```

### 3. Send Delete Request
```javascript
function deleteMessage(messageNonce, channelId) {
  if (!confirm('Delete this message?')) return;
  
  sendSignedMessage({
    action: "delete_message",
    messageNonce: messageNonce,
    channelId: channelId
  });
}
```

### 4. Handle Message Deletion
```javascript
function handleMessageDeleted(data) {
  const messageElement = document.querySelector(`[data-nonce="${data.messageNonce}"]`);
  if (messageElement) {
    messageElement.remove(); // или messageElement.style.display = 'none';
  }
}
```

## Permission Logic

Users can delete messages if:
- **Own messages**: Any user can delete their own messages
- **Admin privileges**: Channel admins can delete any message (defined in `channels-config.json`)

## Important Notes

1. **Hard Delete**: Messages are completely removed from server history
2. **No Time Limits**: Messages can be deleted any time after posting  
3. **No Reply Handling**: If deleted message had replies, they remain but show as replying to deleted message
4. **Bot Messages**: Deleting tip commands won't cancel tips (tips are already processed)
5. **Admin Configuration**: Add admins to channel config:
   ```json
   {
     "general": {
       "adminUsers": ["vadim.near", "alice.near"]
     }
   }
   ```

## UI Recommendations

- Show delete button only when `canDelete: true`
- Use confirmation dialog before deletion
- Remove message from UI immediately after receiving `message_deleted`
- Consider showing "Message deleted by X" placeholder (optional)
- Style admin deletions differently from self-deletions (optional)