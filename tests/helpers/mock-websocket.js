import { EventEmitter } from 'events';
import { getKeyPairFromPrivateKey, getPublicKeyFromKeyPair, signMessage } from '../../shared/near.js';

// Mock WebSocket client for testing
export class MockWebSocketClient extends EventEmitter {
  constructor(accountId, privateKey, contractId = null) {
    super();
    this.accountId = accountId;
    this.privateKey = privateKey;
    this.contractId = contractId;
    this.publicKey = getPublicKeyFromKeyPair(getKeyPairFromPrivateKey(privateKey));
    this.connected = false;
    this.sentMessages = [];
    this.receivedMessages = [];
  }

  connect() {
    this.connected = true;
    this.emit('open');
    return this;
  }

  disconnect() {
    this.connected = false;
    this.emit('close');
    return this;
  }

  send(data) {
    if (!this.connected) {
      throw new Error('WebSocket not connected');
    }

    const message = typeof data === 'string' ? JSON.parse(data) : data;
    this.sentMessages.push(message);
    this.emit('message', data);
    return this;
  }

  // Simulate receiving a message
  receive(data) {
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    this.receivedMessages.push(JSON.parse(message));
    this.emit('message', message);
    return this;
  }

  // Create and sign a message for the server
  createSignedMessage(action, data = {}) {
    const messageData = {
      action,
      ...data,
      metadata: {
        accountId: this.accountId,
        contractId: this.contractId,
        publicKey: this.publicKey,
        timestampMs: Date.now()
      }
    };

    const serializedData = JSON.stringify(messageData);
    const signature = signMessage(this.privateKey, serializedData);

    return {
      signature,
      serializedData
    };
  }

  // Helper methods for common actions
  registerBot(botId) {
    return this.createSignedMessage('register_bot', { botId });
  }

  joinChannel(channelId, message = 'Joined') {
    return this.createSignedMessage('join', {
      channelId,
      message
    });
  }

  sendMessage(channelId, message) {
    return this.createSignedMessage('message', {
      channelId,
      message
    });
  }

  requestHistory(channelId) {
    return this.createSignedMessage('history', { channelId });
  }

  requestMembers(channelId) {
    return this.createSignedMessage('members', { channelId });
  }

  deleteMessage(channelId, messageNonce) {
    return this.createSignedMessage('delete_message', {
      channelId,
      messageNonce
    });
  }

  addReaction(channelId, messageNonce, emoji) {
    return this.createSignedMessage('reaction', {
      channelId,
      messageNonce,
      emoji,
      reactionAction: 'add'
    });
  }

  removeReaction(channelId, messageNonce, emoji) {
    return this.createSignedMessage('reaction', {
      channelId,
      messageNonce,
      emoji,
      reactionAction: 'remove'
    });
  }

  // Get sent messages of specific type
  getSentMessages(type = null) {
    if (!type) return this.sentMessages;
    return this.sentMessages.filter(msg => {
      const data = JSON.parse(msg.serializedData || '{}');
      return data.action === type;
    });
  }

  // Get received messages of specific type
  getReceivedMessages(type = null) {
    if (!type) return this.receivedMessages;
    return this.receivedMessages.filter(msg => msg.type === type);
  }

  // Clear message history
  clearMessages() {
    this.sentMessages = [];
    this.receivedMessages = [];
    return this;
  }
}

// Mock WebSocket Server for testing
export class MockWebSocketServer extends EventEmitter {
  constructor() {
    super();
    this.clients = new Set();
    this.messageHistory = [];
  }

  addClient(client) {
    this.clients.add(client);
    client.on('message', (data) => {
      const message = JSON.parse(data);
      this.messageHistory.push({
        client: client.accountId,
        message,
        timestamp: Date.now()
      });
      this.emit('message', client, message);
    });

    client.on('close', () => {
      this.clients.delete(client);
    });

    return this;
  }

  removeClient(client) {
    this.clients.delete(client);
    return this;
  }

  broadcast(data) {
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    this.clients.forEach(client => {
      if (client.connected) {
        client.receive(message);
      }
    });
    return this;
  }

  sendToClient(accountId, data) {
    const client = Array.from(this.clients).find(c => c.accountId === accountId);
    if (client && client.connected) {
      client.receive(data);
    }
    return this;
  }

  getMessageHistory(clientAccountId = null) {
    if (!clientAccountId) return this.messageHistory;
    return this.messageHistory.filter(entry => entry.client === clientAccountId);
  }

  clearHistory() {
    this.messageHistory = [];
    return this;
  }
}