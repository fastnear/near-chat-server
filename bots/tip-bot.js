import * as dotenv from "dotenv";
dotenv.config();
import WebSocket from "ws";
import { getKeyPairFromPrivateKey, getPublicKeyFromKeyPair, signMessage } from "../src/near.js";
import { getBotConfig, loadBotsConfig } from "../src/bots-service.js";
import { getChannelConfig, loadChannelsConfig } from "../src/channels-service.js";
import { IntentsSDK, createIntentSignerNearKeyPair } from "@defuse-protocol/intents-sdk";
import * as nearAPI from "near-api-js";


const WS_URL = process.env.WS_URL || "ws://localhost:7071";
const BOT_ACCOUNT_ID = "tipbot.near";
const BOT_PRIVATE_KEY = process.env.TIP_BOT_PRIVATE_KEY;
const NODE_URL = process.env.NODE_URL || "https://rpc.mainnet.fastnear.com";

class TipBot {
  constructor() {    
    try {
      loadBotsConfig();
      loadChannelsConfig();
      this.config = getBotConfig("tip-bot");
      this.ws = null;
      this.connected = false;
      this.joinedChannels = new Set();
      
      // Configure NEAR connection for intents.near contract calls
      this.near = new nearAPI.Near({
        networkId: "mainnet",
        nodeUrl: NODE_URL,
        walletUrl: "https://app.mynearwallet.com/",
        helperUrl: "https://helper.mainnet.near.org",
        explorerUrl: "https://nearblocks.io/"
      });
      
      // Configure IntentsSDK for tip transfers
      const keyPair = getKeyPairFromPrivateKey(BOT_PRIVATE_KEY);
      const intentSigner = createIntentSignerNearKeyPair({
        keypair: keyPair,
        accountId: BOT_ACCOUNT_ID
      });
      
      this.intentsSDK = new IntentsSDK({
        env: "production",
        intentSigner,
        referral: "tip-bot.near" // Referral for fees
      });
      
      this.messageHistory = new Map(); // channelId -> messages
      
      console.log("Tip Bot initialized successfully");
    } catch (error) {
      console.error("Failed to initialize Tip Bot:", error);
      throw error;
    }
  }

  connect() {
    console.log("Connecting Tip Bot to", WS_URL);
    this.ws = new WebSocket(WS_URL);

    this.ws.on("open", async () => {
      console.log("Tip Bot connected");
      this.connected = true;
      this.reconnectAttempts = 0; // Reset reconnect attempts on successful connection
      
      try {
        await this.registerBot();
      } catch (error) {
        console.error("Failed to register bot:", error);
      }
    });

    this.ws.on("message", (data) => {
      try {
        const message = JSON.parse(data);
        this.handleMessage(message);
      } catch (error) {
        console.error("Error parsing message:", error);
      }
    });

    this.ws.on("close", (code, reason) => {
      console.log(`Tip Bot disconnected - Code: ${code}, Reason: ${reason}`);
      this.connected = false;
      this.joinedChannels.clear();
      
      // Reconnect with exponential backoff
      const reconnectDelay = Math.min(5000 * Math.pow(2, this.reconnectAttempts || 0), 30000);
      console.log(`Reconnecting in ${reconnectDelay}ms...`);
      setTimeout(() => {
        this.reconnectAttempts = (this.reconnectAttempts || 0) + 1;
        this.connect();
      }, reconnectDelay);
    });

    this.ws.on("error", (error) => {
      console.error("Tip Bot WebSocket error:", error);
      if (!this.connected) {
        console.log("Connection failed, will retry...");
      }
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
      botId: "tip-bot",
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

  sendTipMessage(channelId, message, replyToNonce = null) {
    const messageData = {
      channelId,
      message: replyToNonce ? {
        text: message,
        replyTo: replyToNonce
      } : message,
    };
    
    this.sendMessage("message", messageData);
  }

  requestTipIntent(channelId, recipient, amount, originalMessage, requester, replyToNonce = null, humanAmount = null) {
    const intentId = `tip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    this.sendMessage("request_tip_intent", {
      channelId,
      intentId,
      recipient,
      amount, // blockchain amount with decimals
      humanAmount, // human readable amount for UI
      originalMessage,
      requester,
      replyToNonce
    });

    return intentId;
  }

  sendDepositRequest(channelId, targetAccountId, requiredAmount, token, channelConfig) {
    const decimals = channelConfig?.tokenDecimals || 24;
    const tokenSymbol = channelConfig?.tokenSymbol || token;

    this.sendMessage("deposit_request", {
      channelId,
      targetAccountId, // Only this user should see the deposit UI
      token,
      requiredAmount: requiredAmount.toString(), // Human readable amount
      decimals,
      tokenSymbol
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
    const { action, message, channelId, clientIdentity, nonce } = data;
    
    if (action === "joined" && clientIdentity.accountId === BOT_ACCOUNT_ID) {
      this.joinedChannels.add(channelId);
      console.log(`Tip Bot joined channel: ${channelId}`);
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

    // Handle tip commands in replies and mentions
    if (action === "message" && message) {
      this.processTipCommand(channelId, message, clientIdentity, nonce);
    }
  }

  async processTipCommand(channelId, message, sender, currentMessageNonce) {
    // Check if message is a reply
    if (typeof message === 'object' && message.replyTo && message.text) {
      // Find the original message being replied to
      const channelHistory = this.messageHistory.get(channelId) || [];
      const originalMessage = channelHistory.find(msg => msg.nonce === message.replyTo);
      
      // Check if replying to this bot's message - auto-respond
      if (originalMessage && originalMessage.sender.accountId === BOT_ACCOUNT_ID) {
        this.sendTipMessage(
          channelId,
          `🤖 Tip Bot: Hi ${sender.accountId}! You replied to me. To send a tip, reply to a message with "/tip <amount> [message]". ` +
          `For example: "/tip 1 Great post!"`,
          currentMessageNonce
        );
        return;
      }
      
      // Check for tip command in reply
      const tipMatch = message.text.match(/^\/tip\s+(\d+(?:\.\d+)?)\s*(.*)?$/i);
      
      if (tipMatch) {
        const amount = parseFloat(tipMatch[1]);
        const tipMessage = tipMatch[2] || "Thanks!";
        
        if (!originalMessage) {
          this.sendTipMessage(channelId, `❌ Original message not found for tip.`, currentMessageNonce);
          return;
        }
        
        const recipient = originalMessage.sender.accountId;
        console.log(`Tip command: ${amount} from ${sender.accountId} to ${recipient}`);
        
        await this.processTip(channelId, sender.accountId, recipient, amount, tipMessage, sender.publicKey, currentMessageNonce);
        return;
      }
    }

    // Check for mentions (string messages)
    if (typeof message === 'string') {
      if (!message) return;

      // Check for direct tip commands: /tip @username amount [message]
      const directTipMatch = message.match(/^\/tip\s+@?([a-zA-Z0-9_\.-]+(?:\.near)?)\s+([\d\.]+)\s*(.*)?$/i);
      
      if (directTipMatch) {
        let recipient = directTipMatch[1];
        const amount = parseFloat(directTipMatch[2]);
        const tipMessage = directTipMatch[3] || "Thanks!";
        
        // Add .near suffix if not present
        if (!recipient.endsWith('.near')) {
          recipient += '.near';
        }
        
        console.log(`Direct tip command: ${amount} from ${sender.accountId} to ${recipient}`);
        await this.processTip(channelId, sender.accountId, recipient, amount, tipMessage, sender.publicKey, currentMessageNonce);
        return;
      }

      const lowerMessage = message.toLowerCase().trim();
      if (lowerMessage.includes("@tipbot") || lowerMessage.includes("@tip")) {
        this.sendTipMessage(
          channelId,
          `🤖 Tip Bot: Hi ${sender.accountId}! To send a tip, reply to a message with "/tip <amount> [message]" or use "/tip @username <amount> [message]". ` +
          `Examples: Reply with "/tip 1 Great post!" or "/tip @alice.near 5 Thanks for helping!"`,
          currentMessageNonce
        );
      }
    }
  }

  async processTip(channelId, senderAccountId, recipientAccountId, amount, tipMessage, senderPublicKey, currentMessageNonce) {
    try {
      const channelConfig = getChannelConfig(channelId);

      // Only process tips in configured channels (not user-created channels)
      if (!channelConfig || !channelConfig.defaultToken) {
        this.sendTipMessage(
          channelId,
          `❌ Tipping is not supported in this channel`,
          currentMessageNonce
        );
        return;
      }

      const defaultToken = channelConfig.defaultToken;
      const minTipAmount = channelConfig.minTipAmount || 0.01;

      // Check minimum tip amount
      if (amount < minTipAmount) {
        const tokenSymbol = channelConfig?.tokenSymbol || defaultToken;
        this.sendTipMessage(
          channelId,
          `❌ Minimum tip amount is ${minTipAmount} ${tokenSymbol}\n` +
          `💰 You tried to tip ${amount} ${tokenSymbol}`,
          currentMessageNonce
        );
        return;
      }

      // // Check if sender's public key is whitelisted on intents.near
      // const isWhitelisted = await this.checkWhitelist(senderAccountId, senderPublicKey);
      
      // if (!isWhitelisted) {
      //   this.sendTipMessage(
      //     channelId,
      //     `❌ Your public key is not whitelisted on intents.near.\n` +
      //     `🔗 Add your key to whitelist: https://intents.near.org/whitelist\n` +
      //     `📋 Your account: ${senderAccountId}\n` +
      //     `🔑 Your key: ${senderPublicKey}`,
      //     currentMessageNonce
      //   );
      //   return;
      // }
      
      const requiredAmount = this.getTokenAmountWithDecimals(amount, channelId);
      // Check balance (simplified for now)
      const hasBalance = await this.checkBalance(senderAccountId, defaultToken, requiredAmount);
      
      if (!hasBalance) {
        // Send public message about insufficient balance
        this.sendTipMessage(
          channelId,
          `❌ ${senderAccountId} has insufficient balance for this tip\n` +
          `💰 Required: ${amount} ${defaultToken}`,
          currentMessageNonce
        );

        // Send private deposit UI message to sender only
        this.sendDepositRequest(channelId, senderAccountId, amount, defaultToken, channelConfig);
        return;
      }
      
      // Request tip intent from server (new approach)
      const intentId = this.requestTipIntent(
        channelId,
        recipientAccountId,
        requiredAmount.toString(), // blockchain amount
        `/tip ${amount} ${tipMessage}`,
        senderAccountId,
        currentMessageNonce,
        amount // human readable amount for UI
      );
      
      console.log(`Requested tip intent ${intentId} for ${senderAccountId} -> ${recipientAccountId}`);
      
    } catch (error) {
      console.error("Error processing tip:", error);
      this.sendTipMessage(
        channelId,
        `❌ Error processing tip: ${error.message}`,
        currentMessageNonce
      );
    }
  }

  // async checkWhitelist(accountId, publicKey) {
  //   try {
  //     console.log(`Checking whitelist for ${accountId} with key ${publicKey}`);
  //     return true;
      
  //     // Check if account is whitelisted on intents.near contract
  //     const account = await this.near.account("dontcare");
  //     const result = await account.viewFunction(
  //       "intents.near",
  //       "is_whitelisted_account", 
  //       {
  //         account_id: accountId
  //       }
  //     );
      
  //     console.log(`Whitelist check result for ${accountId}:`, result);
  //     return result === true;
      
  //   } catch (error) {
  //     console.error("Error checking whitelist:", error);
  //     // For testing, allow if method doesn't exist yet
  //     if (error.message.includes("MethodNotFound")) {
  //       console.log("Whitelist method not found, allowing for testing");
  //       return true;
  //     }
  //     return false;
  //   }
  // }

  getTokenAmountWithDecimals(amount, channelId) {
      const channelConfig = getChannelConfig(channelId);
      console.log("Channel config for balance check:", channelConfig);
      const decimals = channelConfig?.tokenDecimals || 24; // Default to 24 for wrap.near
      const requiredAmount = BigInt(Math.floor(amount * Math.pow(10, decimals)));

      console.log(`Converted amount: ${amount} -> ${requiredAmount} (decimals: ${decimals})`);
      return requiredAmount;
  }

  async checkBalance(accountId, token, requiredAmount) {
    // try {
      console.log(`Checking balance for ${accountId}: ${requiredAmount} ${token} using Intents SDK`);
      
      console.log("Fetched account for balance check:", accountId);

      // Convert amount to smallest token unit (handle decimals)
      //const channelConfig = getChannelConfig(channelId);
      //console.log("Channel config for balance check:", channelConfig);
      //const decimals = channelConfig?.tokenDecimals || 24; // Default to 24 for wrap.near
      //const requiredAmount = BigInt(Math.floor(amount * Math.pow(10, decimals)));

      //console.log(`Converted amount: ${amount} -> ${requiredAmount} (decimals: ${decimals})`);

      const account = await this.near.account(BOT_ACCOUNT_ID);

      console.log("Fetched account for contract call:", account.accountId);
      
      const assetDeposit = await account.viewFunction({
        contractId: "intents.near",
        methodName: "mt_balance_of",
        args: {
          token_id: "nep141:" + token,
          account_id: accountId,
          // token_id: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
          
        }}
      );

      if (!assetDeposit) {
        // console.log(`No deposits found for ${accountId} on token ${token}`);
        return false;
      }

      console.log("Deposits from contract assetDeposit:", assetDeposit);

      const availableBalance = assetDeposit ? BigInt(assetDeposit) : BigInt(0);
      
      console.log(`Balance check via contract call: available=${availableBalance}, required=${requiredAmount}`);
      return availableBalance >= requiredAmount;

        
      
      // // Create asset ID for Intents SDK
      // let assetId;
      // if (token === "near") {
      //   assetId = "near:mainnet:native";
      // } else {
      //   assetId = `near:mainnet:${token}`;
      // }

      // // Use Intents SDK to get user balances
      // const deposits = await this.intentsSDK.getBalances({
      //   accountId: accountId
      // });
      
      // // Find deposit for this specific asset
      // const assetDeposit = deposits.find(deposit => deposit.assetId === assetId);
      // const availableBalance = assetDeposit ? BigInt(assetDeposit.amount) : BigInt(0);
      
      console.log(`Balance check via Intents SDK: available=${availableBalance}, required=${requiredAmount} for asset=${assetId}`);
      return availableBalance >= requiredAmount;
      
    // } catch (error) {
    //   console.error("Error checking balance via Intents SDK:", error);
      
    //   // For development/testing, allow small amounts if SDK methods aren't available yet
    //   if (error.message.includes("not implemented") || error.message.includes("MethodNotFound")) {
    //     console.log("Intents SDK balance check not available, allowing small amounts for testing");
    //     return amount <= 1; // Allow up to 1 token for testing
    //   }
      
    //   return false;
    // }
  }

  async createTipIntent(sender, recipient, token, amount) {
    try {
      console.log(`Creating tip intent: ${sender} -> ${recipient}, ${amount} ${token}`);
      
      // Create withdrawal params for IntentsSDK
      let assetId;
      if (token === "near") {
        assetId = "near:mainnet:native";
      } else {
        assetId = `near:mainnet:${token}`;
      }
      
      const withdrawalParams = {
        assetId: assetId,
        amount: BigInt(amount),
        destinationAddress: recipient,
        feeInclusive: false
      };
      
      // Estimate fee first
      const feeEstimation = await this.intentsSDK.estimateWithdrawalFee({
        withdrawalParams,
        logger: console
      });
      
      console.log("Fee estimation:", feeEstimation);
      
      // Create and execute withdrawal intent (this is essentially a tip)
      const result = await this.intentsSDK.processWithdrawal({
        withdrawalParams,
        feeEstimation,
        referral: "tip-bot.near",
        logger: console
      });
      
      console.log("Intent creation result:", result);
      
      return {
        success: true,
        intentId: result.intentHash,
        txHash: result.intentTx.hash
      };
      
    } catch (error) {
      console.error("Error creating intent:", error);
      
      // Parse common errors
      let errorMessage = error.message;
      if (error.message.includes("insufficient")) {
        errorMessage = "Insufficient balance for tip + gas fees";
      } else if (error.message.includes("not whitelisted")) {
        errorMessage = "Account not whitelisted for intents";
      } else if (error.message.includes("invalid")) {
        errorMessage = "Invalid intent parameters";
      } else if (error.message.includes("UnsupportedAssetId")) {
        errorMessage = "Token not supported by intents protocol";
      }
      
      return {
        success: false,
        error: errorMessage
      };
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