import WebSocket from "ws";
import { getKeyPairFromPrivateKey, getPublicKeyFromKeyPair, signMessage, verifySignature } from "./near.js";
import { configManager } from "./config-manager.js";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createGzip } from 'zlib';
import { promisify } from 'util';

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

    // Miniapp cache
    this.miniappCache = null;
    this.miniappCacheTime = 0;
    this.miniappCacheDuration = 10 * 60 * 1000; // 10 minutes
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
        // Sent by server after successful bot registration - confirms bot can start operations
        console.log(`${this.botId} registered successfully`);
        this.onBotRegistered();
        break;

      case "channel":
        // Contains all channel-related events: join/leave/message/members etc.
        // Main communication channel for chat interactions
        this.handleChannelMessage(message.data);
        break;

      case "error":
        // Server error notifications - connection issues, invalid requests, etc.
        console.error(`${this.botId} server error:`, message.error);
        break;

      case "message_created":
        // Sent when bot's own message is successfully created on server
        // Contains real nonce assigned by server - used for message tracking/replies
        this.handleMessageCreated(message.data);
        break;

      case "server_identity":
        // Server's NEAR account identity for signature verification
        // Received on connection - enables verification of signed server events
        this.handleServerIdentity(message.data);
        break;

      case "request_miniapp":
        // Server requests bot's webapp/miniapp data for channel integration
        // Bot responds with compressed webapp bundle
        this.handleMiniappRequest(message).catch(error => {
          console.error(`${this.botId} error in handleMiniappRequest:`, error);
        });
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
   * Handle miniapp request from server
   */
  async handleMiniappRequest(message) {
    try {
      console.log(`${this.botId} handling miniapp request for channel: ${message.channelId}`);
      const miniappData = await this.getMiniappData();

      // Use sendMessage to properly sign the response
      await this.sendMessage('miniapp_response', {
        requestId: message.requestId,
        channelId: message.channelId,
        data: miniappData
      });
    } catch (error) {
      console.error(`${this.botId} error handling miniapp request:`, error);

      // Use sendMessage to properly sign the error response
      await this.sendMessage('miniapp_response', {
        requestId: message.requestId,
        channelId: message.channelId,
        error: 'Failed to load miniapp'
      });
    }
  }

  /**
   * Get miniapp data with caching
   */
  async getMiniappData() {
    const now = Date.now();

    // Return cached data if still valid
    if (this.miniappCache && (now - this.miniappCacheTime) < this.miniappCacheDuration) {
      console.log(`${this.botId} returning cached miniapp data`);
      return this.miniappCache;
    }

    console.log(`${this.botId} generating new miniapp data`);

    // Generate new miniapp data
    const webappPath = this.getWebappPath();

    if (!fs.existsSync(webappPath)) {
      throw new Error(`Webapp directory not found: ${webappPath}`);
    }

    const gzData = await this.compressWebapp(webappPath);

    this.miniappCache = {
      botId: this.botAccountId,
      data: gzData,
      version: this.getMiniappVersion(),
      permissions: this.getMiniappPermissions(),
      lastUpdated: now
    };

    this.miniappCacheTime = now;

    return this.miniappCache;
  }

  /**
   * Get webapp directory path - override in subclasses
   */
  getWebappPath() {
    const __filename = fileURLToPath(import.meta.url);
    const botDir = path.dirname(__filename);
    return path.join(botDir, 'webapp');
  }

  /**
   * Get miniapp version - override in subclasses
   */
  getMiniappVersion() {
    return '1.0.0';
  }

  /**
   * Get miniapp permissions - override in subclasses
   */
  getMiniappPermissions() {
    return ['blockchain_read'];
  }

  /**
   * Compress webapp directory into gz archive
   */
  async compressWebapp(webappPath) {
    const files = await this.collectWebappFiles(webappPath);

    // Create a simple archive format (could use tar later)
    const archive = {
      files: {}
    };

    for (const file of files) {
      const relativePath = path.relative(webappPath, file);
      const content = fs.readFileSync(file);

      // Determine if file is binary
      const isBinary = this.isBinaryFile(file);
      archive.files[relativePath] = {
        content: isBinary ? content.toString('base64') : content.toString('utf8'),
        encoding: isBinary ? 'base64' : 'utf8'
      };
    }

    const archiveString = JSON.stringify(archive);
    const buffer = Buffer.from(archiveString);

    return new Promise((resolve, reject) => {
      const chunks = [];
      const gzip = createGzip();

      gzip.on('data', (chunk) => chunks.push(chunk));
      gzip.on('end', () => {
        const compressed = Buffer.concat(chunks);
        resolve(compressed.toString('base64'));
      });
      gzip.on('error', reject);

      gzip.end(buffer);
    });
  }

  /**
   * Recursively collect all files in webapp directory
   */
  async collectWebappFiles(dir) {
    const files = [];
    const items = fs.readdirSync(dir);

    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        const subFiles = await this.collectWebappFiles(fullPath);
        files.push(...subFiles);
      } else {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Check if file is binary
   */
  isBinaryFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const binaryExts = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.exe', '.bin'];
    return binaryExts.includes(ext);
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