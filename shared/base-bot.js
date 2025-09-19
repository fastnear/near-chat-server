import WebSocket from "ws";
import { getKeyPairFromPrivateKey, getPublicKeyFromKeyPair, signMessage, verifySignature } from "./near.js";
import { configManager } from "./config-manager.js";

const CONTRACT_ID = "social.near";

/**
 * Base class for NEAR chat bots providing common functionality
 */
export class BaseBot {
  constructor(botId, botAccountId, botPrivateKey, wsUrl = "ws://localhost:7071") {
    this.botId = botId;
    this.botAccountId = botAccountId;
    this.botPrivateKey = botPrivateKey;
    this.wsUrl = wsUrl;

    // Connection state
    this.ws = null;
    this.connected = false;
    this.joinedChannels = new Set();

    // Message tracking
    this.messageHistory = new Map(); // channelId -> messages
    this.pendingMessagePromises = []; // for tracking real nonces from server

    // Configuration
    this.config = null;
  }

  async loadConfig() {
    // Always reload to respect TTL cache in ConfigManager
    this.config = await configManager.getBotConfig(this.botId);
    return this.config;
  }

  async connect() {
    console.log(`Connecting ${this.botId} to`, this.wsUrl);

    // Load config before connecting
    await this.loadConfig();
    console.log(`${this.botId} config loaded:`, this.config ? "✅" : "❌");

    this.ws = new WebSocket(this.wsUrl);

    this.ws.on("open", async () => {
      console.log(`${this.botId} connected`);
      this.connected = true;
      await this.registerBot();
    });

    this.ws.on("message", (data) => {
      try {
        const message = JSON.parse(data);
        this.handleMessage(message);
      } catch (error) {
        console.error(`${this.botId} error parsing message:`, error);
      }
    });

    this.ws.on("close", () => {
      console.log(`${this.botId} disconnected`);
      this.connected = false;
      // Reconnect after 5 seconds
      setTimeout(async () => await this.connect(), 5000);
    });

    this.ws.on("error", (error) => {
      console.error(`${this.botId} WebSocket error:`, error);
    });
  }

  async sendMessage(action, additionalData = {}) {
    if (!this.connected) return;

    const keyPair = getKeyPairFromPrivateKey(this.botPrivateKey);

    const serializedData = JSON.stringify({
      action,
      metadata: {
        accountId: this.botAccountId,
        contractId: CONTRACT_ID,
        publicKey: getPublicKeyFromKeyPair(keyPair),
        timestampMs: Date.now(),
      },
      ...additionalData,
    });

    const signature = await signMessage(serializedData, keyPair);

    const signedMessage = {
      signature,
      serializedData: serializedData
    };

    this.ws.send(JSON.stringify(signedMessage));
  }

  async registerBot() {
    await this.sendMessage("register_bot", {
      botId: this.botId,
      botInfo: this.getBotInfo(),
    });
  }

  /**
   * Override this method in subclasses to provide bot-specific info
   */
  getBotInfo() {
    return {
      name: this.botId,
      description: "A NEAR Protocol chat bot",
    };
  }

  joinChannel(channelId) {
    if (this.joinedChannels.has(channelId)) return;

    this.sendMessage("join", {
      channelId,
      message: `${this.getBotInfo().name} has joined the channel`,
    });
  }

  /**
   * Send a message to a channel and return a promise that resolves with the real nonce
   */
  async sendChannelMessage(channelId, message, replyTo = null) {
    const messageData = {
      channelId,
      message: replyTo ? {
        text: message,
        replyTo: replyTo
      } : message,
    };

    this.sendMessage("message", messageData);

    // Return a promise that resolves with the real nonce from server
    return new Promise((resolve) => {
      this.pendingMessagePromises.push({ channelId, resolve });
    });
  }

  deleteMessage(channelId, messageNonce) {
    this.sendMessage("delete_message", {
      channelId,
      messageNonce
    });
  }

  handleMessageCreated(data) {
    const { channelId, nonce } = data;

    // Resolve any pending message promises for this channel
    if (this.pendingMessagePromises.length > 0) {
      const pendingIndex = this.pendingMessagePromises.findIndex(p => p.channelId === channelId);
      if (pendingIndex !== -1) {
        const pending = this.pendingMessagePromises.splice(pendingIndex, 1)[0];
        pending.resolve(nonce);
      }
    }
  }

  handleMessage(message) {
    switch (message.type) {
      case "bot_registered":
        console.log(`${this.botId} registered successfully`);
        this.onBotRegistered();
        break;

      case "channel":
        this.handleChannelMessage(message.data);
        break;

      case "error":
        console.error(`${this.botId} server error:`, message.error);
        break;

      case "message_created":
        this.handleMessageCreated(message.data);
        break;

      case "server_identity":
        this.handleServerIdentity(message.data);
        break;

      default:
        // Check if this is a signed server event
        if (message.signature && message.serializedData) {
          this.handleServerEvent(message);
        } else {
          // Allow subclasses to handle custom message types
          this.handleCustomMessage(message);
        }
        break;
    }
  }

  handleChannelMessage(data) {
    const { action, message, channelId, clientIdentity, nonce } = data;

    if (action === "joined" && clientIdentity.accountId === this.botAccountId) {
      this.joinedChannels.add(channelId);
      console.log(`${this.botId} joined channel: ${channelId}`);
      return;
    }

    // Store message in history
    if (action === "message" && message && nonce) {
      if (!this.messageHistory.has(channelId)) {
        this.messageHistory.set(channelId, []);
      }
      this.messageHistory.get(channelId).push({
        nonce,
        message,
        sender: clientIdentity,
        timestamp: Date.now()
      });

      // Keep only last 100 messages per channel
      if (this.messageHistory.get(channelId).length > 100) {
        this.messageHistory.get(channelId).shift();
      }
    }

    // Ignore own messages
    if (clientIdentity.accountId === this.botAccountId) return;

    // Let subclass handle the message
    this.onChannelMessage(channelId, message, clientIdentity, nonce, action);
  }

  handleServerIdentity(data) {
    const { serverAccountId, serverPublicKey } = data;
    console.log(`${this.botId} received server identity: ${serverAccountId}`);
    this.serverAccountId = serverAccountId;
    this.serverPublicKey = serverPublicKey;
  }

  handleServerStartup(payload) {
    const { timestamp, serverAccountId, botChannels } = payload;
    console.log(`${this.botId} received server startup from ${serverAccountId}`);

    // Verify this is from our trusted server
    if (this.serverAccountId && serverAccountId === this.serverAccountId) {
      console.log(`✅ ${this.botId} server identity verified, joining channels...`);

      // Join channels specified by server (from bots-config.json)
      const channels = botChannels || [];
      channels.forEach(channel => {
        console.log(`🔗 ${this.botId} joining channel: ${channel}`);
        this.joinChannel(channel);
      });
    } else {
      console.log(`❌ ${this.botId} server identity mismatch`);
    }
  }

  handleUpdateChannels(payload) {
    const { botChannels, serverAccountId } = payload;
    console.log(`${this.botId} received channel update from ${serverAccountId}`);

    // Verify this is from our trusted server
    if (this.serverAccountId && serverAccountId === this.serverAccountId) {
      console.log(`✅ ${this.botId} updating channels...`);

      const newChannels = botChannels || [];
      newChannels.forEach(channel => {
        if (!this.joinedChannels.has(channel)) {
          console.log(`🔗 ${this.botId} joining new channel: ${channel}`);
          this.joinChannel(channel);
        }
      });

      console.log(`✅ ${this.botId} channels updated: ${newChannels.join(', ')}`);
    } else {
      console.log(`❌ ${this.botId} server identity mismatch for channel update`);
    }
  }

  async handleServerEvent(signedEvent) {
    const { signature, serializedData } = signedEvent;

    console.log(signedEvent);

    try {
      // Verify server signature
      if (this.serverAccountId && this.serverPublicKey) {
        console.log(`${this.botId} verifying server signature from ${this.serverAccountId}`);
        console.log(`${this.botId} signature: ${signature}`);
        console.log(`${this.botId} public key: ${this.serverPublicKey}`);
        console.log(`${this.botId} data ${JSON.stringify(serializedData, null, 2)}`);        

        try {
          const isValidSignature = await verifySignature(
            this.serverPublicKey,
            signature,
            serializedData
          );

          if (!isValidSignature) {
            console.error(`${this.botId} SECURITY: Invalid server signature from ${this.serverAccountId}`);
            return;
          }
        } catch (error) {
          console.error(`${this.botId} SECURITY: Error verifying signature:`, error);
          return;
        }

        console.log(`${this.botId} ✅ Server signature verified`);
      } else {
        console.warn(`${this.botId} ⚠️ No server identity for signature verification`);
        return;
      }

      const eventData = JSON.parse(serializedData);
      const { eventType, payload } = eventData;

      console.log(`${this.botId} received server event: ${eventType}`);

      // Handle special server startup action
      if (eventData.action === "server_startup") {
        this.handleServerStartup(payload);
        return;
      }

      // Handle update channels event
      if (eventData.action === "update_channels" || eventType === "update_channels") {
        this.handleUpdateChannels(payload);
        return;
      }

      // Let subclass handle the server event
      this.onServerEvent(eventType, payload);
    } catch (error) {
      console.error(`${this.botId} error handling server event:`, error);
    }
  }

  /**
   * Override these methods in subclasses
   */
  onBotRegistered() {
    // Override in subclass
  }

  onChannelMessage(channelId, message, sender, nonce, action) {
    if (action === "message" && message) {
      this.handleBotCommands(channelId, message, sender, nonce);
    }
    // Override in subclass
  }

  async handleBotCommands(channelId, message, sender, nonce) {
    const messageText = typeof message === 'string' ? message : message.text;
    if (!messageText) return false;

    // Check if message is addressed to this bot
    const commandText = this.extractBotCommand(messageText);
    if (!commandText) return false; // Not for this bot

    // Handle /join command
    const joinMatch = commandText.match(/^\/join\s+([a-zA-Z0-9_-]+)$/);
    if (joinMatch) {
      const targetChannelId = joinMatch[1];
      await this.handleJoinCommand(channelId, targetChannelId, sender, nonce);
      return true; // Command handled, don't process further
    }

    return false; // Command not handled
  }

  extractBotCommand(messageText) {
    // Get bot mentions for THIS bot from config (e.g. ["@ai", "@gpt"] for gpt-bot)
    const botMentions = this.config?.filters?.mentions || [];

    for (const mention of botMentions) {
      // Check if message starts with this bot's mention
      if (messageText.toLowerCase().startsWith(mention.toLowerCase())) {
        // Remove mention and trim spaces - return command text for THIS bot
        const commandText = messageText.substring(mention.length).trim();
        return commandText;
      }
    }

    return null; // Message not addressed to THIS specific bot
  }

  async handleJoinCommand(channelId, targetChannelId, sender, nonce) {
    try {
      // Reload config to get latest channel list
      await this.loadConfig();
      const botChannels = this.config?.channels || [];

      if (botChannels.includes(targetChannelId)) {
        // Channel is allowed, join it
        if (!this.joinedChannels.has(targetChannelId)) {
          this.joinChannel(targetChannelId);

          await this.sendChannelMessage(channelId,
            `✅ Joined channel: ${targetChannelId}`,
            nonce
          );
        } else {
          await this.sendChannelMessage(channelId,
            `📢 Already in channel: ${targetChannelId}`,
            nonce
          );
        }
      } else {
        await this.sendChannelMessage(channelId,
          `❌ Channel '${targetChannelId}' not in bot configuration`,
          nonce
        );
      }
    } catch (error) {
      console.error(`${this.botId} error in /join command:`, error);
      await this.sendChannelMessage(channelId,
        `❌ Error joining channel: ${error.message}`,
        nonce
      );
    }
  }

  onServerEvent(eventType, payload) {
    // Override in subclass
  }

  handleCustomMessage(message) {
    // Override in subclass for custom message types
  }

  /**
   * Graceful shutdown
   */
  shutdown() {
    console.log(`Shutting down ${this.botId}...`);
    if (this.ws) {
      this.ws.close();
    }
  }
}