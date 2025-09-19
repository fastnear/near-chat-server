import * as dotenv from "dotenv";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load bot-specific .env file
dotenv.config({ path: join(__dirname, '.env') });
import { BaseBot } from "../../shared/base-bot.js";

const WS_URL = process.env.WS_URL || "ws://localhost:7071";
const BOT_ACCOUNT_ID = "ai-is-near.near";
const BOT_PRIVATE_KEY = process.env.GPT_BOT_PRIVATE_KEY;

// OpenAI Configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_ENDPOINT = process.env.OPENAI_ENDPOINT || "https://api.openai.com/v1/";
const MODEL_NAME = process.env.OPENAI_MODEL_NAME || "gpt-3.5-turbo";
const MAX_TOKENS = parseInt(process.env.OPENAI_MAX_TOKENS) || 150;

class GPTBot extends BaseBot {
  constructor() {
    super("gpt-bot", BOT_ACCOUNT_ID, BOT_PRIVATE_KEY, WS_URL);
  }

  getBotInfo() {
    return {
      name: "GPT Assistant",
      description: "AI assistant powered by OpenAI",
    };
  }

  // Removed duplicate methods - now inherited from BaseBot

  // Use sendChannelMessage from BaseBot instead of sendGPTMessage
  async sendGPTMessage(channelId, message, replyTo = null) {
    return await this.sendChannelMessage(channelId, message, replyTo);
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

  // Build full reply chain context by walking up the tree
  buildReplyChainContext(channelId, startingNonce) {
    const channelHistory = this.messageHistory.get(channelId) || [];
    const contextMessages = [];
    let currentNonce = startingNonce;

    // Walk up the reply chain (max 10 messages to avoid too long context)
    for (let i = 0; i < 10 && currentNonce; i++) {
      const msg = channelHistory.find(m => m.nonce === currentNonce);
      if (!msg) break;

      const messageText = typeof msg.message === 'string'
        ? msg.message
        : msg.message.text || '';

      // Add to context (we'll reverse later)
      contextMessages.unshift({
        role: msg.sender.accountId === BOT_ACCOUNT_ID ? "assistant" : "user",
        content: msg.sender.accountId === BOT_ACCOUNT_ID
          ? messageText.replace(/^🤖\s*/, '').replace(/\*\*.*?\*\*\s*/, '') // Clean up bot formatting
          : `${msg.sender.accountId}: ${messageText}`
      });

      // Move to the message this one was replying to
      currentNonce = typeof msg.message === 'object' ? msg.message.replyTo : null;
    }

    return contextMessages;
  }

  // Override BaseBot methods
  async onChannelMessage(channelId, message, sender, nonce, action) {
    if (action === "message" && message) {
      // First handle base bot commands (like /join)
      const handled = await super.handleBotCommands(channelId, message, sender, nonce);

      // Only handle GPT-specific commands if base command wasn't handled
      if (!handled) {
        this.processGPTCommand(channelId, message, sender, nonce);
      }
    }
  }

  async processGPTCommand(channelId, message, sender, currentMessageNonce) {
    let contextMessages = [];
    let finalPrompt = message;

    // Check if message is a reply
    if (typeof message === 'object' && message.replyTo && message.text) {
      // Build full reply chain context
      contextMessages = this.buildReplyChainContext(channelId, message.replyTo);

      // Find the original message being replied to
      const channelHistory = this.messageHistory.get(channelId) || [];
      const originalMessage = channelHistory.find(msg => msg.nonce === message.replyTo);

      // Check if replying to this bot's message - auto-respond with full context
      if (originalMessage && originalMessage.sender.accountId === BOT_ACCOUNT_ID) {
        console.log(`Reply to GPT Bot from ${sender.accountId}: ${message.text}`);

        const response = await this.callOpenAI(message.text, contextMessages);
        this.sendGPTMessage(
          channelId,
          `${response}`,
          currentMessageNonce
        );
        return;
      }

      // Use the reply text as the final prompt
      finalPrompt = message.text;
    }
    
    const lowerMessage = (typeof finalPrompt === 'string' ? finalPrompt : '').toLowerCase().trim();

    if (!lowerMessage) return;

    // Check for GPT commands: /ask <prompt>, /gpt <prompt>
    const askMatch = finalPrompt.match(/^\/(?:ask|gpt)\s+(.+)$/i);

    if (askMatch) {
      const prompt = askMatch[1].trim();
      console.log(`GPT command from ${sender.accountId}: ${prompt}`);

      this.sendGPTMessage(channelId, `Processing your request: "${prompt}"...`, currentMessageNonce);

      const response = await this.callOpenAI(prompt, contextMessages);
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

      // Extract the prompt (remove the mention)
      const prompt = finalPrompt.replace(/@(gpt|chatgpt|ai)/gi, "").trim();

      if (prompt.length < 2) {
        this.sendGPTMessage(
          channelId,
          `Hi ${sender.accountId}! Send me a prompt using "/ask <your prompt>" or mention me with @gpt followed by your prompt.`,
          currentMessageNonce
        );
        return;
      }

      // Send thinking message and save reference for later deletion
      const thinkingMessage = `Let me think about that...`;
      const thinkingNonce = await this.sendGPTMessage(channelId, thinkingMessage, currentMessageNonce);

      const response = await this.callOpenAI(prompt, contextMessages);

      // Delete the thinking message using real nonce
      this.deleteMessage(channelId, thinkingNonce);

      // Send real response
      this.sendGPTMessage(
        channelId,
        `@${sender.accountId} ${response}`,
        currentMessageNonce
      );
    }
  }

  // deleteThinkingMessage method removed - now using direct nonce deletion

  // Server event handlers now inherited from BaseBot

  // All server event handling now inherited from BaseBot
  onServerEvent(eventType, payload) {
    switch (eventType) {
      case "channel_activity":
        console.log(`GPT Bot: Channel activity in ${payload.channelId}`);
        break;
      default:
        console.log(`GPT Bot: Unknown server event type: ${eventType}`);
    }
  }
}

// Start the bot
const gptBot = new GPTBot();
await gptBot.connect();

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("Shutting down GPT Bot...");
  if (gptBot.ws) {
    gptBot.ws.close();
  }
  process.exit(0);
});