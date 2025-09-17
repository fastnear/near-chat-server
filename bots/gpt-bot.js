import * as dotenv from "dotenv";
dotenv.config();
import WebSocket from "ws";
import { getKeyPairFromPrivateKey, getPublicKeyFromKeyPair, signMessage } from "../src/near.js";
import { getBotConfig, loadBotsConfig } from "../src/bots-service.js";

const WS_URL = process.env.WS_URL || "ws://localhost:7071";
const BOT_ACCOUNT_ID = "ai-is-near.near";
const BOT_PRIVATE_KEY = process.env.GPT_BOT_PRIVATE_KEY;

// OpenAI Configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_ENDPOINT = process.env.OPENAI_ENDPOINT || "https://api.openai.com/v1/";
const MODEL_NAME = process.env.OPENAI_MODEL_NAME || "gpt-3.5-turbo";
const MAX_TOKENS = parseInt(process.env.OPENAI_MAX_TOKENS) || 150;

class GPTBot {
  constructor() {
    loadBotsConfig();
    this.config = getBotConfig("gpt-bot");
    this.ws = null;
    this.connected = false;
    this.joinedChannels = new Set();
    this.messageHistory = new Map(); // channelId -> messages
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
      botId: "gpt-bot",
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

  sendGPTMessage(channelId, message, replyToNonce = null) {
    const messageData = {
      channelId,
      message: replyToNonce ? {
        text: message,
        replyTo: replyToNonce
      } : message,
    };
    
    this.sendMessage("message", messageData);
    
    // Return a promise that resolves with the message nonce
    // We'll use timestamp as approximate nonce for tracking
    return Promise.resolve(Date.now());
  }

  deleteMessage(channelId, messageNonce) {
    this.sendMessage("delete_message", {
      channelId,
      messageNonce
    });
  }

  async callOpenAI(prompt, contextMessages = []) {
    if (!OPENAI_API_KEY) {
      return "OpenAI API key not configured. Please set OPENAI_API_KEY in .env file.";
    }

    try {
      const messages = [
        {
          role: "system",
          content: "You are a helpful assistant in a NEAR Protocol chat. Keep responses concise and friendly. Focus on NEAR ecosystem, blockchain, and general tech questions. IMPORTANT: Do not use markdown formatting, asterisks, or any markup. Write only plain text responses."
        }
      ];

      // Add context messages if provided
      for (const contextMsg of contextMessages) {
        messages.push({
          role: contextMsg.role || "user",
          content: contextMsg.content
        });
      }

      // Add the current prompt
      messages.push({
        role: "user",
        content: prompt
      });

      const response = await fetch(`${OPENAI_ENDPOINT}chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL_NAME,
          messages: messages,
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
      return `Error: ${error.message}`;
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
    const { action, message, channelId, clientIdentity, nonce } = data;
    
    if (action === "joined" && clientIdentity.accountId === BOT_ACCOUNT_ID) {
      this.joinedChannels.add(channelId);
      console.log(`GPT Bot joined channel: ${channelId}`);
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
    if (clientIdentity.accountId === BOT_ACCOUNT_ID) return;

    // Handle GPT commands and mentions
    if (action === "message" && message) {
      this.processGPTCommand(channelId, message, clientIdentity, nonce);
    }
  }

  async processGPTCommand(channelId, message, sender, currentMessageNonce) {
    let contextMessages = [];
    let finalPrompt = message;

    // Check if message is a reply
    if (typeof message === 'object' && message.replyTo && message.text) {
      // Find the original message being replied to
      const channelHistory = this.messageHistory.get(channelId) || [];
      const originalMessage = channelHistory.find(msg => msg.nonce === message.replyTo);

      if (originalMessage) {
        // Add original message as context
        const originalText = typeof originalMessage.message === 'string'
          ? originalMessage.message
          : originalMessage.message.text || '';

        // Check if replying to this bot's message - auto-respond with context
        if (originalMessage.sender.accountId === BOT_ACCOUNT_ID) {
          console.log(`Reply to GPT Bot from ${sender.accountId}: ${message.text}`);

          contextMessages.push({
            role: "assistant",
            content: originalText.replace(/^🤖\s*/, '').replace(/\*\*.*?\*\*\s*/, '') // Clean up bot formatting
          });

          const response = await this.callOpenAI(message.text, contextMessages);
          this.sendGPTMessage(
            channelId,
            `${response}`,
            currentMessageNonce
          );
          return;
        } else {
          // Replying to someone else's message - include it as context
          contextMessages.push({
            role: "user",
            content: `Previous message from ${originalMessage.sender.accountId}: ${originalText}`
          });
        }
      }

      // Use the reply text as the final prompt
      finalPrompt = message.text;
    }
    
    const lowerMessage = (typeof finalPrompt === 'string' ? finalPrompt : '').toLowerCase().trim();

    if (!lowerMessage) return;

    // Check for GPT commands: /ask <question>, /gpt <question>
    const askMatch = finalPrompt.match(/^\/(?:ask|gpt)\s+(.+)$/i);

    if (askMatch) {
      const question = askMatch[1].trim();
      console.log(`GPT command from ${sender.accountId}: ${question}`);

      this.sendGPTMessage(channelId, `Processing your question: "${question}"...`, currentMessageNonce);

      const response = await this.callOpenAI(question, contextMessages);
      this.sendGPTMessage(
        channelId,
        response,
        currentMessageNonce
      );
      return;
    }

    // Check for mentions: @gpt, @chatgpt, @ai
    if (lowerMessage.includes("@gpt") || lowerMessage.includes("@chatgpt") || lowerMessage.includes("@ai")) {
      console.log(`GPT mention from ${sender.accountId}: ${finalPrompt}`);

      // Extract the question (remove the mention)
      const question = finalPrompt.replace(/@(gpt|chatgpt|ai)/gi, "").trim();

      if (question.length < 3) {
        this.sendGPTMessage(
          channelId,
          `Hi ${sender.accountId}! Ask me a question using "/ask <your question>" or mention me with @gpt followed by your question.`,
          currentMessageNonce
        );
        return;
      }

      // Send thinking message and save reference for later deletion
      const thinkingMessage = `Let me think about that...`;
      this.sendGPTMessage(channelId, thinkingMessage, currentMessageNonce);

      const response = await this.callOpenAI(question, contextMessages);

      // Send real response
      this.sendGPTMessage(
        channelId,
        `@${sender.accountId} ${response}`,
        currentMessageNonce
      );

      // Delete the thinking message by finding it in message history
      setTimeout(() => {
        this.deleteThinkingMessage(channelId, thinkingMessage);
      }, 1000); // Wait 1 second to ensure message is processed
    }
  }

  deleteThinkingMessage(channelId, thinkingText) {
    // Find the thinking message in our message history
    const channelHistory = this.messageHistory.get(channelId) || [];
    const thinkingMessage = channelHistory
      .slice(-5) // Look at last 5 messages only
      .reverse() // Start from most recent
      .find(msg => 
        msg.sender.accountId === BOT_ACCOUNT_ID && 
        (typeof msg.message === 'string' ? msg.message : msg.message.text || '').includes('Let me think about that')
      );
    
    if (thinkingMessage) {
      console.log(`Deleting thinking message with nonce: ${thinkingMessage.nonce}`);
      this.deleteMessage(channelId, thinkingMessage.nonce);
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