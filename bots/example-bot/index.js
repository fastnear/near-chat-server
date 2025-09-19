import * as dotenv from "dotenv";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load bot-specific .env file
dotenv.config({ path: join(__dirname, '.env') });
import { BaseBot } from "../../shared/base-bot.js";

const WS_URL = process.env.WS_URL || "ws://localhost:7071";
const BOT_ACCOUNT_ID = "example-bot.near";
const BOT_PRIVATE_KEY = process.env.EXAMPLE_BOT_PRIVATE_KEY;

class ExampleBot extends BaseBot {
  constructor() {
    super("example-bot", BOT_ACCOUNT_ID, BOT_PRIVATE_KEY, WS_URL);
  }

  getBotInfo() {
    return {
      name: "Example Bot",
      description: "An example bot built with BaseBot",
    };
  }

  onChannelMessage(channelId, message, sender, nonce, action) {
    if (action !== "message") return;

    const messageText = typeof message === 'string' ? message : message.text;
    if (!messageText) return;

    // Respond to mentions
    if (messageText.toLowerCase().includes("@example")) {
      const response = `Hello @${sender.accountId}! I'm an example bot built with BaseBot.`;

      // Reply to the original message
      this.sendChannelMessage(channelId, response, nonce);
    }

    // Simple echo command
    if (messageText.startsWith("/echo ")) {
      const echoText = messageText.substring(6);
      this.sendChannelMessage(channelId, `Echo: ${echoText}`, nonce);
    }
  }

  onServerEvent(eventType, payload) {
    console.log(`ExampleBot received server event: ${eventType}`, payload);
  }
}

// Start the bot
const exampleBot = new ExampleBot();
await exampleBot.connect();

// Graceful shutdown
process.on("SIGINT", () => {
  exampleBot.shutdown();
  process.exit(0);
});