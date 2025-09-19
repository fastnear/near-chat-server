import { getKeyPairFromPrivateKey, getPublicKeyFromKeyPair, signMessage } from '../shared/near.js';
import { getBotConfig } from './bots-service.js';

const SERVER_SIGNATURE_CONTRACT_ID = process.env.SERVER_SIGNATURE_CONTRACT_ID || "social.near";

export class ServerEventSystem {
  constructor(serverAccountId, serverPrivateKey) {
    this.serverAccountId = serverAccountId;
    this.serverPrivateKey = serverPrivateKey;
    this.serverKeyPair = getKeyPairFromPrivateKey(serverPrivateKey);
    this.wsClients = null; // Will be injected
  }

  setWSClients(wsClients) {
    this.wsClients = wsClients;
  }

  async broadcastServerStartup() {
    const startupData = {
      action: "server_startup",
      eventType: "server_started",
      payload: {
        timestamp: Date.now(),
        serverAccountId: this.serverAccountId
      },
      metadata: {
        accountId: this.serverAccountId,
        contractId: SERVER_SIGNATURE_CONTRACT_ID,
        publicKey: getPublicKeyFromKeyPair(this.serverKeyPair),
        timestampMs: Date.now()
      }
    };

    const serializedData = JSON.stringify(startupData);
    const signature = await signMessage(serializedData, this.serverKeyPair);

    const signedEvent = {
      signature,
      serializedData
    };

    // Send to all connected bots
    if (!this.wsClients) {
      console.error('WSClients not set in ServerEventSystem');
      return;
    }

    console.log('Broadcasting server startup to all bots...');
    for (const [ws, client] of this.wsClients.entries()) {
      if (client.isBot) {
        try {
          ws.send(JSON.stringify(signedEvent));
          console.log(`Sent startup notification to bot ${client.botId}`);
        } catch (e) {
          console.error(`Failed to send startup notification to bot ${client.botId}:`, e);
        }
      }
    }
  }

  async sendServerEvent(channelId, eventType, payload) {
    const eventData = {
      action: "server_event",
      channelId,
      eventType,
      payload,
      metadata: {
        accountId: this.serverAccountId,
        contractId: SERVER_SIGNATURE_CONTRACT_ID,
        publicKey: getPublicKeyFromKeyPair(this.serverKeyPair),
        timestampMs: Date.now()
      }
    };

    const serializedData = JSON.stringify(eventData);
    const signature = await signMessage(serializedData, this.serverKeyPair);

    const signedEvent = {
      signature,
      serializedData
    };

    // Send to all bots in channel that allow this event type
    if (!this.wsClients) {
      console.error('WSClients not set in ServerEventSystem');
      return;
    }

    let eventsSent = 0;
    for (const [ws, client] of this.wsClients.entries()) {
      if (client.isBot && client.channels && client.channels.has(channelId)) {
        const botConfig = getBotConfig(client.botId);
        console.log(`🎯 SERVER: Checking bot ${client.botId} for event ${eventType}, allowedEvents:`, botConfig?.allowedServerEvents);
        if (botConfig?.allowedServerEvents?.includes(eventType)) {
          try {
            console.log(`🎯 SERVER: Sending ${eventType} event to bot ${client.botId} in channel ${channelId}`);
            ws.send(JSON.stringify(signedEvent));
            eventsSent++;
          } catch (e) {
            console.error(`Failed to send server event to bot ${client.botId}:`, e);
          }
        } else {
          console.log(`🎯 SERVER: Bot ${client.botId} not allowed to receive ${eventType} events`);
        }
      }
    }
    console.log(`🎯 SERVER: Sent ${eventType} event to ${eventsSent} bots in channel ${channelId}`);
  }

  async broadcastChannelUpdate(botId) {
    const botConfig = await getBotConfig(botId);
    if (!botConfig) {
      console.error(`Bot config not found for ${botId}`);
      return;
    }

    const updateData = {
      action: "update_channels",
      eventType: "update_channels",
      payload: {
        timestamp: Date.now(),
        serverAccountId: this.serverAccountId,
        botChannels: botConfig.channels || []
      },
      metadata: {
        accountId: this.serverAccountId,
        contractId: SERVER_SIGNATURE_CONTRACT_ID,
        publicKey: getPublicKeyFromKeyPair(this.serverKeyPair),
        timestampMs: Date.now()
      }
    };

    const serializedData = JSON.stringify(updateData);
    const signature = await signMessage(serializedData, this.serverKeyPair);

    const signedEvent = {
      signature,
      serializedData
    };

    // Send to specific bot
    if (!this.wsClients) {
      console.error('WSClients not set in ServerEventSystem');
      return;
    }

    for (const [ws, client] of this.wsClients.entries()) {
      if (client.isBot && client.botId === botId) {
        try {
          ws.send(JSON.stringify(signedEvent));
          console.log(`✅ Sent channel update to bot ${botId}: ${botConfig.channels.join(', ')}`);
          return;
        } catch (e) {
          console.error(`Failed to send channel update to bot ${botId}:`, e);
        }
      }
    }

    console.log(`❌ Bot ${botId} not found in connected clients`);
  }
}