import * as dotenv from "dotenv";
dotenv.config();
import WebSocket from "ws";
import { getKeyPairFromPrivateKey, getPublicKeyFromKeyPair, signMessage } from "../src/near.js";
import { getBotConfig, loadBotsConfig } from "../src/bots-service.js";


const WS_URL = process.env.WS_URL || "ws://localhost:7071";
const BOT_ACCOUNT_ID = "zavodil.near";
const BOT_PRIVATE_KEY = process.env.TIP_BOT_PRIVATE_KEY || "ed25519:3KyUuch8pYP47krBq4DosFEVBMR5wDTMQ8AThzM8kAEcBQHqjEtzBx4JhPQqpX2vGvPEAF7V2vPPm9h3PVfDaYeP";

class TipBot {
  constructor() {    
    loadBotsConfig();
    this.config = getBotConfig("tip-bot");
    this.ws = null;
    this.connected = false;
    this.joinedChannels = new Set();
  }

  connect() {
    console.log("Connecting Tip Bot to", WS_URL);
    this.ws = new WebSocket(WS_URL);

    this.ws.on("open", async () => {
      console.log("Tip Bot connected");
      this.connected = true;
      await this.registerBot();
    });

    this.ws.on("message", (data) => {
      try {
        const message = JSON.parse(data);
        this.handleMessage(message);
      } catch (error) {
        console.error("Error parsing message:", error);
      }
    });

    this.ws.on("close", () => {
      console.log("Tip Bot disconnected");
      this.connected = false;
      // Reconnect after 5 seconds
      setTimeout(() => this.connect(), 5000);
    });

    this.ws.on("error", (error) => {
      console.error("Tip Bot WebSocket error:", error);
    });
  }

  async sendMessage(action, additionalData = {}) {
    if (!this.connected) return;

    const keyPair = getKeyPairFromPrivateKey(BOT_PRIVATE_KEY);

    const serializedData = JSON.stringify({
      action,
      metadata: {
        accountId: BOT_ACCOUNT_ID,
        contractId: "social.near",
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
      botInfo: {
        name: "Tip Bot",
        description: "Handles tipping with NEAR Intents",
      },
    });
  }

  joinChannel(channelId) {
    if (this.joinedChannels.has(channelId)) return;
    
    this.sendMessage("join", {
      channelId,
      message: "Tip Bot has joined the channel",
    });
  }

  sendTipMessage(channelId, message) {
    this.sendMessage("message", {
      channelId,
      message,
    });
  }

  handleMessage(message) {
    switch (message.type) {
      case "bot_registered":
        console.log("Tip Bot registered successfully");
        // Join configured channels
        const channels = this.config["channels"] || [];
        channels.forEach(channel => this.joinChannel(channel));
        break;

      case "channel":
        this.handleChannelMessage(message.data);
        break;

      case "error":
        console.error("Server error:", message.error);
        break;

      default:
        break;
    }
  }

  handleChannelMessage(data) {
    const { action, message, channelId, clientIdentity } = data;
    
    if (action === "joined" && clientIdentity.accountId === BOT_ACCOUNT_ID) {
      this.joinedChannels.add(channelId);
      console.log(`Tip Bot joined channel: ${channelId}`);
      return;
    }

    // Ignore own messages
    if (clientIdentity.accountId === BOT_ACCOUNT_ID) return;

    // Handle tip commands
    if (action === "message" && message) {
      this.processTipCommand(channelId, message, clientIdentity);
    }
  }

  processTipCommand(channelId, message, sender) {
    const lowerMessage = message.toLowerCase().trim();
    
    // Check for tip command: /tip <amount> [message]
    const tipMatch = lowerMessage.match(/^\/tip\s+(\d+(?:\.\d+)?)\s*(.*)?$/);
    
    if (tipMatch) {
      const amount = parseFloat(tipMatch[1]);
      const tipMessage = tipMatch[2] || "Thanks!";
      
      console.log(`Tip command detected: ${amount} from ${sender.accountId}`);
      
      // For now, just acknowledge the tip
      this.sendTipMessage(
        channelId,
        `🤖 Tip Bot: ${sender.accountId} wants to tip ${amount} tokens! ` +
        `Message: "${tipMessage}"\n\n` +
        `💡 NEAR Intents integration coming soon! This would check your balance ` +
        `and whitelist status on intents.near, then execute the tip.`
      );
      return;
    }

    // Check for mentions
    if (lowerMessage.includes("@tipbot") || lowerMessage.includes("@tip")) {
      this.sendTipMessage(
        channelId,
        `🤖 Tip Bot: Hi ${sender.accountId}! Use "/tip <amount> [message]" to send tips. ` +
        `For example: "/tip 1 Great post!"`
      );
    }
  }
}

// Start the bot
const tipBot = new TipBot();
tipBot.connect();

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("Shutting down Tip Bot...");
  if (tipBot.ws) {
    tipBot.ws.close();
  }
  process.exit(0);
});