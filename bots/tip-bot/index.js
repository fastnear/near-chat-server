import * as dotenv from "dotenv";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load bot-specific .env file
dotenv.config({ path: join(__dirname, '.env') });
import { BaseBot } from "../../shared/base-bot.js";
import { configManager } from "../../shared/config-manager.js";
import { IntentsSDK, createIntentSignerNearKeyPair } from "@defuse-protocol/intents-sdk";
import { getKeyPairFromPrivateKey } from "../../shared/near.js";
import * as nearAPI from "near-api-js";

const WS_URL = process.env.WS_URL || "ws://localhost:7071";
const BOT_ACCOUNT_ID = "tipbot.near";
const BOT_PRIVATE_KEY = process.env.TIP_BOT_PRIVATE_KEY;
const NODE_URL = process.env.NODE_URL || "https://rpc.mainnet.fastnear.com";

class TipBot extends BaseBot {
  constructor() {
    super("tip-bot", BOT_ACCOUNT_ID, BOT_PRIVATE_KEY, WS_URL);

    try {
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

      console.log("Tip Bot initialized successfully");
    } catch (error) {
      console.error("Failed to initialize Tip Bot:", error);
      throw error;
    }
  }

  getBotInfo() {
    return {
      name: "Tip Bot",
      description: "Handles tipping with NEAR Intents",
    };
  }

  async sendTipMessage(channelId, message, replyTo = null) {
    return await this.sendChannelMessage(channelId, message, replyTo);
  }


  requestTipIntent(channelId, recipient, amount, originalMessage, requester, replyTo = null, humanAmount = null, token) {
    const intentId = `tip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Validate token is provided for money operations
    if (!token || typeof token !== 'string' || token.trim() === '') {
      throw new Error("Token field must be a non-empty string for tip intent requests");
    }

    this.sendMessage("request_tip_intent", {
      channelId,
      intentId,
      recipient,
      amount, // blockchain amount with decimals
      humanAmount, // human readable amount for UI
      originalMessage,
      requester,
      replyTo,
      token // add token field - must not be null
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

  handleStorageRegistrationRequired(data) {
    const { channelId, message, replyTo } = data;
    console.log(`Storage registration required in ${channelId}: ${message}`);

    // Send message to channel using tip bot's sendTipMessage function
    this.sendTipMessage(channelId, message, replyTo);
  }

  handleTipSuccess(data) {
    const { channelId, requester, recipient, humanAmount, tokenSymbol, transactionHash, replyTo } = data;
    console.log(`Tip success in ${channelId}: ${requester} -> ${recipient} ${humanAmount} ${tokenSymbol}`);

    const successMessage = `✅ Tip successful! @${requester} sent ${humanAmount} ${tokenSymbol} to ${recipient}. View transaction: https://nearblocks.io/txns/${transactionHash}`;

    // Send message to channel using tip bot's sendTipMessage function
    this.sendTipMessage(channelId, successMessage, replyTo);
  }

  async handlePublishSignedIntent(data) {
    const { intentId, signedIntent, pendingIntent } = data;
    console.log(`🎯 TIP-BOT: Received signed intent ${intentId} for publishing`);
    console.log(`🎯 TIP-BOT: Publishing intent for ${pendingIntent.requester} -> ${pendingIntent.recipient}`);

    // Send processing message as reply to user's original message
    const processingMessage = `🔄 Processing tip from ${pendingIntent.requester} to ${pendingIntent.recipient}...`;
    const processingNonce = await this.sendTipMessage(
      pendingIntent.channelId,
      processingMessage,
      pendingIntent.replyTo
    );

    // Store real processing message nonce for later deletion
    this.processingMessages = this.processingMessages || new Map();
    this.processingMessages.set(intentId, processingNonce);

    try {
      // Publish signed intent via solver relay
      const signedMultiPayload = signedIntent.signedMultiPayload;

      const request = {
        id: 1,
        jsonrpc: "2.0",
        method: "publish_intent",
        params: [
          {
            signed_data: signedMultiPayload
          }
        ]
      };

      console.log(`🎯 TIP-BOT: Publishing to solver relay:`, JSON.stringify(request, null, 2));

      const response = await fetch("https://solver-relay-v2.chaindefuser.com/rpc", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log(`🎯 TIP-BOT: Intent publish response:`, result);

      if (result.result && result.result.status === "OK") {
        const intentHash = result.result.intent_hash;
        console.log(`🎯 TIP-BOT: Intent published successfully! Hash: ${intentHash}`);

        // Start monitoring intent status immediately
        this.checkIntentStatus(intentHash, pendingIntent, intentId);
      } else {
        const errorReason = result.result?.reason || 'Unknown error';
        console.log(`🎯 TIP-BOT: Intent publish failed:`, errorReason);

        // Send error message to channel
        this.sendTipMessage(
          pendingIntent.channelId,
          `❌ Tip from ${pendingIntent.requester} to ${pendingIntent.recipient} failed: ${errorReason}`,
          pendingIntent.replyTo
        );
      }
    } catch (error) {
      console.error(`🎯 TIP-BOT: Error publishing intent:`, error);

      // Send error message to channel
      this.sendTipMessage(
        pendingIntent.channelId,
        `❌ Tip from ${pendingIntent.requester} to ${pendingIntent.recipient} failed: ${error.message}`,
        pendingIntent.replyTo
      );
    }
  }

  handleCustomMessage(message) {
    switch (message.type) {
      case "storage_registration_required":
        this.handleStorageRegistrationRequired(message.data);
        break;

      case "tip_success":
        this.handleTipSuccess(message.data);
        break;

      case "publish_signed_intent":
        this.handlePublishSignedIntent(message.data);
        break;

      case "join_success":
      case "message_deleted":
        // Ignore these common message types
        break;

      default:
        // Handle any other custom tip-bot message types
        console.log(`TipBot: Unknown message type: ${message.type}`);
        break;
    }
  }

  async onChannelMessage(channelId, message, sender, nonce, action) {
    if (action !== "message") return;

    // First handle base bot commands (like /join)
    const handled = await super.handleBotCommands(channelId, message, sender, nonce);

    // Only handle tip-specific commands if base command wasn't handled
    if (!handled) {
      this.processTipCommand(channelId, message, sender, nonce);
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
          `Examples: Reply with "/tip 1 Great post!" or "/tip zavodil.near 5 Thanks for building this chat!"`,
          currentMessageNonce
        );
      }
    }
  }

  async processTip(channelId, senderAccountId, recipientAccountId, amount, tipMessage, senderPublicKey, currentMessageNonce) {
    try {
      console.log(`Processing tip of ${amount} from ${senderAccountId} to ${recipientAccountId} in ${channelId}`);
      const channelConfig = await configManager.getChannelConfig(channelId);

      console.log("channelConfig", JSON.stringify(channelConfig))

      console.log("Channel config for tip:", channelConfig);

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
      const tokenSymbol = channelConfig?.tokenSymbol || defaultToken;

      // Check minimum tip amount
      if (amount < minTipAmount) {        
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
      
      const requiredAmount = await this.getTokenAmountWithDecimals(amount, channelId);
      // Check balance (simplified for now)
      const hasBalance = await this.checkBalance(senderAccountId, defaultToken, requiredAmount);
      
      if (!hasBalance) {
        // Send public message about insufficient balance
        this.sendTipMessage(
          channelId,
          `❌ ${senderAccountId} has insufficient balance for this tip\n` +
          `💰 Required: ${amount} ${tokenSymbol}`,
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
        amount, // human readable amount for UI
        defaultToken // add token parameter
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

  async getTokenAmountWithDecimals(amount, channelId) {
      const channelConfig = await configManager.getChannelConfig(channelId);
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
        contractId: process.env.INTENTS_CONTRACT_ID,
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

  onServerEvent(eventType, payload) {
    console.log(`🎯 TIP-BOT: Received server event: ${eventType}`, payload);

    switch (eventType) {
      case "tip_status_update":
        this.handleTipStatusUpdate(payload);
        break;
      case "storage_required":
        this.handleStorageRequired(payload);
        break;
      default:
        console.log(`TipBot: Unknown server event type: ${eventType}`);
    }
  }

  handleTipStatusUpdate(payload) {
    const { status, message, channelId } = payload;
    console.log(`Tip status update in ${channelId}: ${status} - ${message}`);

    // Send status message to channel
    if (message) {
      this.sendTipMessage(channelId, message);
    }
  }

  handleStorageRequired(payload) {
    const { channelId, recipient, requester, tokenSymbol } = payload;
    const message = `🏦 ${recipient} is not registered in ${tokenSymbol} token yet. We've asked ${requester} to register ${recipient} in the token contract so they can receive tips.`;

    console.log(`Storage required in ${channelId}: ${message}`);
    this.sendTipMessage(channelId, message);
  }

  async handleIntentCreated(payload) {
    const { intentId, intentHash, pendingIntent } = payload;
    console.log(`🎯 TIP-BOT: Intent created event received: ${intentId} with hash: ${intentHash}`);
    console.log(`🎯 TIP-BOT: Pending intent data:`, JSON.stringify(pendingIntent, null, 2));

    // Start monitoring intent status
    this.checkIntentStatus(intentHash, pendingIntent, intentId);
  }

  // Moved function from server
  async checkIntentStatus(intentHash, pendingIntent, intentId) {
    const data = {
      id: 1,
      jsonrpc: "2.0",
      method: "get_status",
      params: [
        {
          intent_hash: intentHash
        }
      ]
    };

    const startTime = Date.now();
    const maxWaitTime = 30000; // 30 seconds like Python code

    const checkStatus = async () => {
      try {
        console.log(`🎯 TIP-BOT: Checking intent status for hash: ${intentHash}`);
        const response = await fetch("https://solver-relay-v2.chaindefuser.com/rpc", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(data)
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        console.log(`🎯 TIP-BOT: Intent status response:`, result);

        if (result.result.status === "SETTLED") {
          console.log("🎯 TIP-BOT: Success! Intent settled");

          // Get transaction hash from data.hash field
          const transactionHash = result.result.data?.hash || intentHash;

          console.log("🎯 TIP-BOT: Transaction hash:", transactionHash);

          // Get token symbol from channel config for display
          const channelConfig = await configManager.getChannelConfig(pendingIntent.channelId);
          const tokenSymbol = channelConfig?.tokenSymbol || pendingIntent.token;

          // Delete processing message on success
          if (this.processingMessages && this.processingMessages.has(intentId)) {
            const processingNonce = this.processingMessages.get(intentId);
            console.log(`🗑️ Deleting processing message with nonce: ${processingNonce}`);
            this.deleteMessage(pendingIntent.channelId, processingNonce);
            this.processingMessages.delete(intentId);
          }

          // Send success message to channel using handleTipSuccess method
          this.handleTipSuccess({
            channelId: pendingIntent.channelId,
            requester: pendingIntent.requester,
            recipient: pendingIntent.recipient,
            humanAmount: pendingIntent.humanAmount || pendingIntent.amount,
            tokenSymbol: tokenSymbol,
            transactionHash: transactionHash,
            replyTo: pendingIntent.replyTo
          });

          return;

        } else if (result.result.status === "NOT_FOUND_OR_NOT_VALID_ANYMORE" ||
                   result.result.status === "NOT_FOUND_OR_NOT_VALID") {
          console.log("Intent not found or not valid anymore");

          // Send error message to channel
          const errorMessage = `❌ Tip from ${pendingIntent.requester} to ${pendingIntent.recipient} failed: Intent not found or invalid`;
          this.sendTipMessage(pendingIntent.channelId, errorMessage, pendingIntent.replyTo);

          return;

        } else if (Date.now() - startTime > maxWaitTime) {
          console.log("Timeout: Intent settlement took longer than 30 seconds");

          // Send timeout message to channel
          const timeoutMessage = `⏰ Tip from ${pendingIntent.requester} to ${pendingIntent.recipient} is taking longer than expected`;
          this.sendTipMessage(pendingIntent.channelId, timeoutMessage, pendingIntent.replyTo);

          return;
        }

        // Still processing, check again in 200ms
        setTimeout(checkStatus, 200);

      } catch (error) {
        console.error("Error checking intent status:", error);

        // Send error message to channel
        const errorMessage = `❌ Tip from ${pendingIntent.requester} to ${pendingIntent.recipient} failed: ${error.message}`;
        this.sendTipMessage(pendingIntent.channelId, errorMessage, pendingIntent.replyToNonce);
      }
    };

    // Start checking status
    setTimeout(checkStatus, 200);
  }
}

// Start the bot
const tipBot = new TipBot();
await tipBot.connect();

// Graceful shutdown
process.on("SIGINT", () => {
  tipBot.shutdown();
  process.exit(0);
});