import * as dotenv from "dotenv";
dotenv.config();
import { BaseBot } from "../../shared/base-bot.js";
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class TimeBot extends BaseBot {
  constructor() {
    const botId = "time-bot";
    const botAccountId = process.env.TIME_BOT_ACCOUNT_ID || "timebot.near";
    const botPrivateKey = process.env.TIME_BOT_PRIVATE_KEY;
    const wsUrl = process.env.WS_SERVER_URL || "ws://localhost:7071";

    super(botId, botAccountId, botPrivateKey, wsUrl);
  }

  getBotInfo() {
    return {
      name: "Time Bot",
      description: "A bot that shows the current time in a miniapp",
    };
  }

  getWebappPath() {
    return path.join(__dirname, 'webapp');
  }

  getMiniappVersion() {
    return '1.0.0';
  }

  getMiniappPermissions() {
    return ['blockchain_read'];
  }

  onChannelMessage(channelId, message, sender, nonce, action) {
    if (action !== "message" || !message) return;

    const messageText = typeof message === 'string' ? message : message.text;
    if (!messageText) return;

    // Handle /time command
    if (messageText.trim().toLowerCase() === '/time') {
      const currentTime = new Date().toLocaleString();
      this.sendChannelMessage(channelId, `⏰ Current time: ${currentTime}`, nonce);
    }
  }
}

const timeBot = new TimeBot();

timeBot.connect().catch((error) => {
  console.error("Failed to connect TimeBot:", error);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("Shutting down TimeBot...");
  timeBot.shutdown();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("Shutting down TimeBot...");
  timeBot.shutdown();
  process.exit(0);
});