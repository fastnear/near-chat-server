import * as dotenv from "dotenv";
dotenv.config();
import WebSocket from "ws";
import { getKeyPairFromPrivateKey, getPublicKeyFromKeyPair, signMessage } from "../src/near.js";
import { getBotConfig, loadBotsConfig } from "../src/bots-service.js";

const WS_URL = process.env.WS_URL || "ws://localhost:7071";
const BOT_ACCOUNT_ID = "zavodil.near";
const BOT_PRIVATE_KEY = process.env.GPT_BOT_PRIVATE_KEY || "ed25519:3KyUuch8pYP47krBq4DosFEVBMR5wDTMQ8AThzM8kAEcBQHqjEtzBx4JhPQqpX2vGvPEAF7V2vPPm9h3PVfDaYeP";

// OpenAI Configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_ENDPOINT = process.env.OPENAI_ENDPOINT || "https://api.openai.com/v1/";
const MODEL_NAME = process.env.OPENAI_MODEL_NAME || "gpt-3.5-turbo";
const MAX_TOKENS = parseInt(process.env.OPENAI_MAX_TOKENS) || 150;

class GPTBot {
  constructor() {
    loadBotsConfig();
    this.config = getBotConfig("tip-bot");
    this.ws = null;
    this.connected = false;
    this.joinedChannels = new Set();
  }

  connect() {
    console.log("Connecting GPT Bot to", WS_URL);
    this.ws = new WebSocket(WS_URL);

    this.ws.on("open", async () => {
      console.log("GPT Bot connected");
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
      console.log("GPT Bot disconnected");
      this.connected = false;
      // Reconnect after 5 seconds
      setTimeout(() => this.connect(), 5000);
    });

    this.ws.on("error", (error) => {
      console.error("GPT Bot WebSocket error:", error);
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
        name: "GPT Assistant",
        description: "AI assistant powered by OpenAI",
      },
    });
  }

  joinChannel(channelId) {
    if (this.joinedChannels.has(channelId)) return;
    
    this.sendMessage("join", {
      channelId,
      message: "GPT Assistant has joined the channel",
    });
  }

  sendGPTMessage(channelId, message) {
    this.sendMessage("message", {
      channelId,
      message,
    });
  }

  async callOpenAI(prompt) {
    if (!OPENAI_API_KEY) {
      return "❌ OpenAI API key not configured. Please set OPENAI_API_KEY in .env file.";
    }

    try {
      const response = await fetch(`${OPENAI_ENDPOINT}chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL_NAME,
          messages: [
            {
              role: "system",
              content: "You are a helpful assistant in a NEAR Protocol chat. Keep responses concise and friendly. Focus on NEAR ecosystem, blockchain, and general tech questions."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          max_tokens: MAX_TOKENS,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = await response.json();
      return data.choices[0]?.message?.content || "Sorry, I couldn't generate a response.";
    } catch (error) {
      console.error("OpenAI API error:", error);
      return `❌ Error: ${error.message}`;
    }
  }

  handleMessage(message) {
    switch (message.type) {
      case "bot_registered":
        console.log("GPT Bot registered successfully");
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
      console.log(`GPT Bot joined channel: ${channelId}`);
      return;
    }

    // Ignore own messages
    if (clientIdentity.accountId === BOT_ACCOUNT_ID) return;

    // Handle GPT commands and mentions
    if (action === "message" && message) {
      this.processGPTCommand(channelId, message, clientIdentity);
    }
  }

  async processGPTCommand(channelId, message, sender) {
    const lowerMessage = message.toLowerCase().trim();
    
    // Check for GPT commands: /ask <question>, /gpt <question>
    const askMatch = message.match(/^\/(?:ask|gpt)\s+(.+)$/i);
    
    if (askMatch) {
      const question = askMatch[1].trim();
      console.log(`GPT command from ${sender.accountId}: ${question}`);
      
      this.sendGPTMessage(channelId, `🤖 Processing your question: "${question}"...`);
      
      const response = await this.callOpenAI(question);
      this.sendGPTMessage(
        channelId,
        `🤖 **GPT Response to ${sender.accountId}:**\n\n${response}`
      );
      return;
    }

    // Check for mentions: @gpt, @chatgpt, @ai
    if (lowerMessage.includes("@gpt") || lowerMessage.includes("@chatgpt") || lowerMessage.includes("@ai")) {
      console.log(`GPT mention from ${sender.accountId}: ${message}`);
      
      // Extract the question (remove the mention)
      const question = message.replace(/@(gpt|chatgpt|ai)/gi, "").trim();
      
      if (question.length < 3) {
        this.sendGPTMessage(
          channelId,
          `🤖 Hi ${sender.accountId}! Ask me a question using "/ask <your question>" or mention me with @gpt followed by your question.`
        );
        return;
      }
      
      this.sendGPTMessage(channelId, `🤖 Let me think about that...`);
      
      const response = await this.callOpenAI(question);
      this.sendGPTMessage(
        channelId,
        `🤖 **@${sender.accountId}** ${response}`
      );
    }
  }
}

// Start the bot
const gptBot = new GPTBot();
gptBot.connect();

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("Shutting down GPT Bot...");
  if (gptBot.ws) {
    gptBot.ws.close();
  }
  process.exit(0);
});