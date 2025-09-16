import * as dotenv from "dotenv";
dotenv.config();
import fs from "fs";
import Denque from "denque";
import { v4 as uuidv4 } from "uuid";
import { saveJson, loadJson, isString } from "./utils.js";
import {
  isValidAccountId,
  verifySignature,
  isImplicitNearAccount,
  keyFromString,
  keyToString,
  derivePublicKeyFromImplicitAccountId,
  fetchAndCacheAccessKey,
} from "./near.js";
import { WebSocketServer } from "ws";
import { loadChannelsConfig, getAvailableChannels, canUserAccessChannel, getChannelConfig } from "./channels-service.js";
import { loadBotsConfig, isValidBot, getBotsForMessage, getBotConfig, getAllBotsConfig } from "./bots-service.js";
import { getKeyPairFromPrivateKey, getPublicKeyFromKeyPair } from "../src/near.js";
import BotManager from "./bot-manager.js";

const MAX_HISTORY = 1000;
const MAX_CHANNEL_LENGTH = 64;
const GLOBAL_MESSAGE_QUEUE_SIZE = 1000000;
const MAX_MESSAGE_DELAY_MS =
  parseFloat(process.env.MAX_MESSAGE_DELAY_MS) || 5000;
const EMPTY_CHANNEL_CLEANUP_MS =
  parseFloat(process.env.EMPTY_CHANNEL_CLEANUP_MS) || 60 * 60 * 1000; // 60 minutes

const ResPath = process.env.RES_PATH || "res";
const WsSubsFilename = ResPath + "/ws_subs.json";
const StateFilename = ResPath + "/server-state.json";

// Global variables for state management
let channels;
let pendingIntents;

function assertValidChannelId(channelId) {
  if (!channelId) {
    throw new Error("Channel name is empty");
  }
  if (!isString(channelId)) {
    throw new Error("Channel name must be a string");
  }
  if (channelId.trim() !== channelId) {
    throw new Error("Channel name cannot start or end with spaces");
  }
  if (channelId.length < 2) {
    throw new Error("Channel name must be at least 2 characters long");
  }
  if (channelId.length > MAX_CHANNEL_LENGTH) {
    throw new Error(`Channel name is longer than ${MAX_CHANNEL_LENGTH} characters`);
  }

  // Only allow alphanumeric characters, hyphens, and underscores
  const validPattern = /^[a-zA-Z0-9_-]+$/;
  if (!validPattern.test(channelId)) {
    throw new Error("Channel name can only contain letters, numbers, hyphens (-), and underscores (_)");
  }

  // Don't allow names starting with numbers or special characters
  if (!/^[a-zA-Z]/.test(channelId)) {
    throw new Error("Channel name must start with a letter");
  }
}

function saveState() {
  try {
    // Convert channels Map to serializable object
    const channelsObj = {};
    for (const [channelId, channelData] of channels.entries()) {
      // Convert updates array to serializable messages (without signedData)
      const messages = (channelData.updates || []).map(({ update }) => update);

      channelsObj[channelId] = {
        channelId: channelData.channelId,
        nonce: channelData.nonce,
        messages: messages,
        createdBy: channelData.createdBy,
        createdAt: channelData.createdAt,
        lastActiveAt: channelData.lastActiveAt,
        // Skip non-serializable fields like 'clients' Map
      };
    }

    const state = {
      timestamp: Date.now(),
      channels: channelsObj
    };

    saveJson(state, StateFilename);
    console.log(`✅ State saved to ${StateFilename}`);
    return true;
  } catch (error) {
    console.error("❌ Failed to save state:", error);
    return false;
  }
}

function loadState() {
  try {
    if (!fs.existsSync(StateFilename)) {
      console.log("No saved state found, starting fresh");
      return null;
    }

    const state = loadJson(StateFilename);
    if (!state || !state.channels) {
      console.log("Invalid state file, starting fresh");
      return null;
    }

    const channelCount = Object.keys(state.channels).length;
    const totalMessages = Object.values(state.channels)
      .reduce((sum, channel) => sum + (channel.messages?.length || 0), 0);

    console.log(`✅ Loaded state: ${channelCount} channels, ${totalMessages} messages (saved at ${new Date(state.timestamp).toLocaleString()})`);
    return state;
  } catch (error) {
    console.error("❌ Failed to load state:", error);
    console.log("Starting with fresh state");
    return null;
  }
}

(async () => {
  if (!fs.existsSync(ResPath)) {
    fs.mkdirSync(ResPath);
  }

  // Load saved state if exists
  const savedState = loadState();

  const WS_PORT = process.env.WS_PORT || 7071;

  const wsClients = new Map();
  const globalMessageQueue = new Denque();
  const accessKeyCache = new Map();

  // Initialize global state variables
  channels = new Map();
  pendingIntents = new Map(); // intentId -> intent data

  // Restore saved state if available
  if (savedState && savedState.channels) {
    for (const [channelId, channelData] of Object.entries(savedState.channels)) {
      // Convert saved messages back to updates format (without signedData)
      const updates = (channelData.messages || []).map(update => ({
        update,
        signedData: null // We don't save signedData, set to null
      }));

      // Restore channel with proper structure
      channels.set(channelId, {
        channelId: channelData.channelId,
        nonce: channelData.nonce || 1,
        createdBy: channelData.createdBy,
        createdAt: channelData.createdAt,
        lastActiveAt: channelData.lastActiveAt || channelData.createdAt,
        clients: new Map(), // Will be populated as clients reconnect
        updates: updates // Restored from saved messages
      });
    }
  }

  // Cleanup expired intents (5 minute timeout)
  const cleanupExpiredIntents = () => {
    const now = Date.now();
    const expiredIntents = [];
    
    for (const [intentId, intentData] of pendingIntents.entries()) {
      if (now - intentData.timestamp > 5 * 60 * 1000) { // 5 minutes
        expiredIntents.push({intentId, intentData});
      }
    }
    
    expiredIntents.forEach(({intentId, intentData}) => {
      pendingIntents.delete(intentId);
      console.log(`Intent ${intentId} expired after 5 minutes`);
      
      // Broadcast timeout message to channel
      broadcastToChannel(intentData.channelId, {
        type: "tip_status",
        data: {
          intentId,
          status: "timeout",
          message: `⏰ Tip from ${intentData.requester} to ${intentData.recipient} (${intentData.amount} ${intentData.token || 'wrap.near'}) expired after 5 minutes`
        }
      });
    });
  };
  
  // Cleanup empty user-created channels
  const cleanupEmptyChannels = () => {
    const now = Date.now();
    const channelsToDelete = [];

    for (const [channelId, channel] of channels.entries()) {
      // Only cleanup user-created channels (have createdBy field)
      if (channel.createdBy) {
        const isEmpty = channel.clients.size === 0;
        const isInactive = channel.lastActiveAt && (now - channel.lastActiveAt > EMPTY_CHANNEL_CLEANUP_MS);

        if (isEmpty && isInactive) {
          console.log(`🗑️ Cleaning up empty user channel: ${channelId} (inactive for ${Math.round((now - channel.lastActiveAt) / 60000)} minutes)`);
          channelsToDelete.push(channelId);
        }
      }
    }

    // Delete the channels
    for (const channelId of channelsToDelete) {
      channels.delete(channelId);
    }
  };

  // Run cleanup every minute
  setInterval(cleanupExpiredIntents, 60 * 1000);
  setInterval(cleanupEmptyChannels, 2 * 60 * 1000); // Every 2 minutes

  loadBotsConfig();
  loadChannelsConfig();

  // Function to check intent settlement status (like Python get_intent_settled_status)
  const checkIntentStatus = async (intentHash, pendingIntent, intentId) => {
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
        
        if (result.result.status === "SETTLED") {
          console.log("Success! Intent settled");
          
          // Get transaction hash from data.hash field
          const transactionHash = result.result.data?.hash || intentHash;
          
          console.log("Transaction hash:", transactionHash);
          
          // Send success status
          broadcastToChannel(pendingIntent.channelId, {
            type: "tip_status", 
            data: {
              intentId: intentId,
              status: "success",
              from: pendingIntent.requester,
              to: pendingIntent.recipient,
              amount: pendingIntent.amount,
              humanAmount: pendingIntent.humanAmount,
              token: pendingIntent.token,
              transactionHash: transactionHash,
              message: `✅ ${pendingIntent.requester} tipped ${pendingIntent.recipient} ${pendingIntent.humanAmount || pendingIntent.amount} ${pendingIntent.tokenSymbol}`
            }
          });
          
          // Send tip bot message as reply with transaction link
          const channel = channels.get(pendingIntent.channelId);
          if (channel) {
            // Get tip bot public key from private key
            const botPrivateKey = process.env.TIP_BOT_PRIVATE_KEY;
            const botKeyPair = botPrivateKey ? getKeyPairFromPrivateKey(botPrivateKey) : null;
            const botPublicKey = botKeyPair ? getPublicKeyFromKeyPair(botKeyPair) : "";

            console.log("Tip bot public key:", botPublicKey);

            const tipBotMessage = {
              action: "message",
              channelId: pendingIntent.channelId,
              clientIdentity: {
                accountId: process.env.TIP_BOT_ACCOUNT_ID || "tipbot.near",
                contractId: "social.near",
                publicKey: botPublicKey,
                clientId: "tip-bot",
              },
              message: {
                text: `✅ Tip successful! @${pendingIntent.requester} sent ${pendingIntent.humanAmount || pendingIntent.amount} ${pendingIntent.tokenSymbol} to ${pendingIntent.recipient}. View transaction: https://nearblocks.io/txns/${transactionHash}`,
                replyTo: pendingIntent.replyToNonce
              },
              timestampMs: Date.now(),
              nonce: channel.nonce++,
            };
            
            // Broadcast tip bot reply to all channel members
            channel.clients.forEach((ws) => {
              try {
                ws.send(JSON.stringify({
                  type: "channel",
                  data: tipBotMessage
                }));
              } catch (e) {
                console.log("Failed to broadcast tip bot message", e);
              }
            });
          }
          
          // Clean up processed intent
          pendingIntents.delete(intentId);
          return;
          
        } else if (result.result.status === "NOT_FOUND_OR_NOT_VALID_ANYMORE" || 
                   result.result.status === "NOT_FOUND_OR_NOT_VALID") {
          console.log("Intent not found or not valid anymore");
          
          // Send error status
          broadcastToChannel(pendingIntent.channelId, {
            type: "tip_status",
            data: {
              intentId: intentId,
              status: "error",
              from: pendingIntent.requester,
              to: pendingIntent.recipient,
              amount: pendingIntent.amount,
              humanAmount: pendingIntent.humanAmount,
              token: pendingIntent.token,
              message: `❌ Tip from ${pendingIntent.requester} to ${pendingIntent.recipient} failed: Intent not found or invalid`
            }
          });
          
          // Clean up failed intent
          pendingIntents.delete(intentId);
          return;
          
        } else if (Date.now() - startTime > maxWaitTime) {
          console.log("Timeout: Intent settlement took longer than 30 seconds");
          
          // Send timeout status  
          broadcastToChannel(pendingIntent.channelId, {
            type: "tip_status",
            data: {
              intentId: intentId,
              status: "timeout",
              from: pendingIntent.requester,
              to: pendingIntent.recipient,
              amount: pendingIntent.amount,
              humanAmount: pendingIntent.humanAmount,
              token: pendingIntent.token,
              message: `⏰ Tip from ${pendingIntent.requester} to ${pendingIntent.recipient} is taking longer than expected`
            }
          });
          
          // Clean up timed out intent
          pendingIntents.delete(intentId);
          return;
        }
        
        // Still processing, check again in 200ms
        setTimeout(checkStatus, 200);
        
      } catch (error) {
        console.error("Error checking intent status:", error);
        
        // Send error status
        broadcastToChannel(pendingIntent.channelId, {
          type: "tip_status",
          data: {
            intentId: intentId,
            status: "error",
            from: pendingIntent.requester,
            to: pendingIntent.recipient,
            amount: pendingIntent.amount,
            humanAmount: pendingIntent.humanAmount,
            token: pendingIntent.token,
            message: `❌ Tip from ${pendingIntent.requester} to ${pendingIntent.recipient} failed: ${error.message}`
          }
        });
        
        // Clean up failed intent
        pendingIntents.delete(intentId);
      }
    };
    
    // Start checking status
    setTimeout(checkStatus, 200);
  };

  // Function to check if user can delete message
  const canUserDeleteMessage = (messageAuthor, currentUser, channelId) => {
    // User can delete their own messages
    if (messageAuthor === currentUser) {
      return true;
    }
    
    // Check if user is admin of the channel
    const channelConfig = getChannelConfig(channelId);
    if (channelConfig?.adminUsers?.includes(currentUser)) {
      return true;
    }
    
    return false;
  };

  const handleDeleteMessage = async (ws, data, signedData) => {
    const { messageNonce, channelId } = data;
    const { accountId } = data.metadata;
    
    console.log(`Delete message request: ${accountId} wants to delete nonce ${messageNonce} in ${channelId}`);
    
    const channel = channels.get(channelId);
    if (!channel) {
      throw new Error("Channel not found");
    }
    
    // Find the message to delete
    const messageIndex = channel.updates.findIndex(item => item.update.nonce === messageNonce);
    if (messageIndex === -1) {
      throw new Error("Message not found");
    }
    
    const messageToDelete = channel.updates[messageIndex];
    const messageAuthor = messageToDelete.update.clientIdentity.accountId;
    
    // Check permissions
    if (!canUserDeleteMessage(messageAuthor, accountId, channelId)) {
      throw new Error("Permission denied: cannot delete this message");
    }
    
    // Remove message from updates
    channel.updates.splice(messageIndex, 1);
    
    // Broadcast deletion to all channel members
    broadcastToChannel(channelId, {
      type: "message_deleted",
      data: {
        messageNonce,
        channelId,
        deletedBy: accountId
      }
    });
    
    console.log(`Message ${messageNonce} deleted by ${accountId}`);
  };

  const botManager = new BotManager();

  // console.log(
  //   JSON.stringify(
  //     await fetchAndCacheAccessKey(
  //       accessKeyCache,
  //       "alice.near",
  //       "ed25519:3Fh3ZdiNn5kA5eNDNrgRmvt2bCuK4ggGEp44E6xACbLz",
  //     ),
  //   ),
  // );

  const wss = new WebSocketServer({ port: WS_PORT });
  console.log("WebSocket server listening on http://localhost:%d/", WS_PORT);

  // WebSocket heartbeat to prevent disconnections
  const heartbeat = setInterval(() => {
    wss.clients.forEach(ws => {
      if (ws.isAlive === false) {
        console.log("Terminating dead connection");
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000); // every 30 seconds

  // Start all bots after server is ready
  setTimeout(() => {
    console.log("🤖 Starting all enabled bots...");
    botManager.startAllBots();
  }, 2000);

  const validateDataAndSignature = async ({ signature, serializedData }) => {
    const data = JSON.parse(serializedData);
    if (!data || typeof data !== "object") {
      throw new Error("Invalid data format");
    }
    if (!data.metadata || typeof data.metadata !== "object") {
      throw new Error("Missing metadata");
    }
    const { accountId, contractId, publicKey, timestampMs } = data.metadata;
    if (!isValidAccountId(accountId)) {
      throw new Error("Invalid accountId");
    }
    if (contractId !== null && !isValidAccountId(contractId)) {
      throw new Error("Invalid contractId");
    }
    const currentTimestampMs = Date.now();
    if (
      !timestampMs ||
      typeof timestampMs !== "number" ||
      currentTimestampMs < timestampMs ||
      currentTimestampMs - timestampMs > MAX_MESSAGE_DELAY_MS
    ) {
      throw new Error("Invalid timestamp");
    }
    verifySignature(publicKey, signature, serializedData);
    data.publicKey = keyToString(keyFromString(publicKey));
    if (contractId === null) {
      // It's a full access key
      if (isImplicitNearAccount(accountId)) {
        const expectedPublicKey =
          derivePublicKeyFromImplicitAccountId(publicKey);
        if (data.publicKey === expectedPublicKey) {
          // Don't check the key on the blockchain
          return data;
        }
      }
    }
    const chainAccessKey = await fetchAndCacheAccessKey(
      accessKeyCache,
      accountId,
      publicKey,
    );
    if (!chainAccessKey) {
      throw new Error("Error fetching the access key");
    }
    if (chainAccessKey.error) {
      throw new Error("The access key doesn't exist");
    }
    if (contractId) {
      const expectedContractId =
        chainAccessKey.permission?.FunctionCall?.receiver_id;
      if (expectedContractId !== contractId) {
        console.log("Account Id:", accountId);
        console.log("Expected contractId:", expectedContractId);
        console.log("Provided contractId:", contractId);  
        throw new Error("Access key contractId doesn't match");
      }
    } else if (chainAccessKey.permission !== "FullAccess") {
      throw new Error("Access key is not full access");
    }
    return data;
  };

  const addGlobalMessage = (message) => {
    // TODO
  };

  const broadcastToChannel = (channelId, messageData) => {
    const channel = channels.get(channelId);
    if (!channel) return;
    
    channel.clients.forEach((ws) => {
      try {
        ws.send(JSON.stringify(messageData));
      } catch (e) {
        console.log("Failed to broadcast to client", e);
      }
    });
  };

  const validateClientChannel = (client, data, channel) => {
    if (!channel) {
      throw new Error("Channel doesn't exists");
    }
    const clientChannel = client.channels.get(channel.channelId);
    if (!clientChannel) {
      throw new Error("Client hasn't joined the channel");
    }
    const { accountId, contractId, publicKey } = data.metadata;
    if (clientChannel.accountId !== accountId) {
      throw new Error("Client joined with different accountId");
    }
    if (clientChannel.contractId !== contractId) {
      throw new Error("Client joined with different contractId");
    }
    if (clientChannel.publicKey !== publicKey) {
      throw new Error("Client joined with different publicKey");
    }
  };

  const addChannelMessage = (
    channel,
    action,
    message,
    clientIdentity,
    signedData,
  ) => {
    const { metadata, client } = clientIdentity;
    if (!metadata || !client) {
      return console.error("Invalid client identity");
    }

    const update = {
      action,
      clientIdentity: {
        accountId: metadata.accountId,
        contractId: metadata.contractId,
        publicKey: metadata.publicKey,
        clientId: client.clientId,
      },
      message,
      timestampMs: Date.now(),
      nonce: channel.nonce++,
    };
    const channelId = channel.channelId;
    addGlobalMessage(channelId, update.timestampMs);
    channel.updates.push({ update, signedData });

    // Update last activity time for user-created channels
    if (channel.createdBy) {
      channel.lastActiveAt = Date.now();
    }

    channel.clients.forEach((ws, clientWs) => {
      try {
        // Remove canDelete from real-time messages - client will calculate it
        const messageWithPermissions = {
          ...update
        };
        
        ws.send(
          JSON.stringify({
            type: "channel",
            data: Object.assign({ channelId }, messageWithPermissions),
          }),
        );
      } catch (e) {
        console.log("Failed to send update to ws", e);
      }
    });
  };

  const handleJoin = async (ws, req, data, signedData) => {
    const client = data.client;
    const channelId = data.channelId;
    assertValidChannelId(channelId);
    if (client.channels.has(channelId)) {
      throw new Error("Already joined the channel");
    }
    
    const { accountId, contractId, publicKey } = data.metadata;
    
    // Save accountId to client for later use (like sending private messages)
    if (!client.accountId) {
      client.accountId = accountId;
    }
    
    // Check if channel exists in config - if yes, validate access
    const channelConfig = getChannelConfig(channelId);
    
    // Bot skips the access check
    if (!client.isBot) {
      if (channelConfig) {
        const hasAccess = await canUserAccessChannel(accountId, channelId);
        if (!hasAccess) {
          throw new Error("Access denied to this channel");
        }
      }
    }

    // If channel doesn't exist in config, allow free creation
    client.channels.set(channelId, {
      accountId,
      contractId,
      publicKey,
    });
    if (!channels.has(channelId)) {
      channels.set(channelId, {
        channelId,
        clients: new Map(),
        updates: [],
        nonce: 1,
        createdBy: accountId, // Track who created this channel
        createdAt: Date.now(), // Track when it was created
        lastActiveAt: Date.now() // Track last activity
      });

      console.log(`📝 User-created channel "${channelId}" created by ${accountId}`);

      // Start bots for this channel if it's newly created
      setTimeout(() => {
        botManager.startBotsForChannel(channelId);
      }, 1000);
    }
    const channel = channels.get(channelId);
    channel.clients.set(client.clientId, ws);
    addChannelMessage(channel, "joined", data.message, data, signedData);

    // Send join confirmation with moderation rights to the user
    const isChannelModerator = channelConfig && channelConfig.adminUsers &&
                               channelConfig.adminUsers.includes(accountId);

    try {
      ws.send(JSON.stringify({
        type: "join_success",
        data: {
          channelId: channelId,
          isChannelModerator: isChannelModerator || false,
          accountId: accountId
        }
      }));
    } catch (e) {
      console.log("Failed to send join confirmation", e);
    }
  };

  const handleLeave = (ws, req, data, signedData) => {
    const client = data.client;
    const channelId = data.channelId;
    assertValidChannelId(channelId);
    const channel = channels.get(channelId);
    if (!channel) {
      throw new Error("Channel doesn't exist");
    }
    validateClientChannel(client, data, channel);
    addChannelMessage(channel, "left", data.message, data, signedData);
    client.channels.delete(channelId);
    channel.clients.delete(client.clientId);
  };

  const handleMessage = (ws, data, signedData) => {
    const client = data.client;
    const channelId = data.channelId;
    assertValidChannelId(channelId);
    const channel = channels.get(channelId);
    validateClientChannel(client, data, channel);
    
    // Validate replyTo if present
    if (data.message && typeof data.message === 'object' && data.message.replyTo) {
      const replyToNonce = data.message.replyTo;
      if (typeof replyToNonce !== 'number' || replyToNonce < 1) {
        throw new Error("Invalid replyTo nonce");
      }
      // Check if replied message exists in channel history
      const originalMessage = channel.updates.find(({ update }) => update.nonce === replyToNonce);
      if (!originalMessage) {
        throw new Error("Replied message not found");
      }
    }
    
    addChannelMessage(channel, "message", data.message, data, signedData);
  };

  const handleDisconnect = (ws, clientId) => {
    const client = wsClients.get(ws);
    for (const [channelId, clientIdentity] of client.channels.entries()) {
      const channel = channels.get(channelId);
      if (channel) {
        channel.clients.delete(clientId);
        addChannelMessage(
          channel,
          "disconnected",
          undefined,
          Object.assign({ client }, clientIdentity),
          null,
        );
      }
    }
    wsClients.delete(ws);
  };

  const handleHistory = (ws, data, signedData) => {
    const client = data.client;
    const channelId = data.channelId;
    assertValidChannelId(channelId);
    const channel = channels.get(channelId);
    if (!channel) {
      throw new Error("Channel doesn't exist");
    }
    validateClientChannel(client, data, channel);
    const updates = channel.updates.slice(-MAX_HISTORY);
    
    // Permissions are now handled client-side
    
    try {
      ws.send(
        JSON.stringify({
          type: "history",
          data: {
            channelId,
            history: updates.map(({ update }) => update), // Remove canDelete from history - client will calculate it
          },
        }),
      );
    } catch (e) {
      console.log("Failed to send history", e);
    }
  };

  const handleAvailableChannels = async (ws, data, signedData) => {
    const { accountId } = data.metadata;
    try {
      const availableChannels = await getAvailableChannels(accountId, channels, wsClients);
      ws.send(
        JSON.stringify({
          type: "available_channels",
          data: {
            channels: availableChannels,
          },
        }),
      );
    } catch (e) {
      console.log("Failed to send available channels", e);
    }
  };

  const handleRegisterBot = (ws, data, signedData) => {
    const { accountId } = data.metadata;
    const client = data.client;
    const botId = data.botId; // Get botId from request
    
    if (!isValidBot(accountId)) {
      throw new Error("Bot not authorized");
    }
    
    // Verify botId matches config
    const botConfig = getBotConfig(botId);
    if (!botConfig || botConfig.accountId !== accountId) {
      throw new Error(`Bot ID ${botId} doesn't match account ${accountId}`);
    }
    
    client.isBot = true;
    client.botAccountId = accountId;
    client.botId = botId;
    
    console.log(`Bot registered: ${accountId} (${botId})`);
    
    try {
      ws.send(
        JSON.stringify({
          type: "bot_registered",
          data: {
            success: true,
            botId: accountId,
          },
        }),
      );
    } catch (e) {
      console.log("Failed to send bot registration confirmation", e);
    }
  };

  const handleMembers = async (ws, data, signedData) => {
    const client = data.client;
    const channelId = data.channelId;
    assertValidChannelId(channelId);
    const channel = channels.get(channelId);
    if (!channel) {
      throw new Error("Channel doesn't exist");
    }
    
    // Check if user has access to this channel (instead of validateClientChannel)
    const { accountId } = data.metadata;
    const hasAccess = await canUserAccessChannel(accountId, channelId);
    if (!hasAccess) {
      throw new Error("Access denied to this channel");
    }
    
    const members = [];
    
    // Get all clients in the channel
    for (const [clientId, ws] of channel.clients) {
      const clientData = wsClients.get(ws);
      if (clientData) {
        // Get client identity from their channel membership
        const clientChannel = clientData.channels.get(channelId);
        if (clientChannel) {
          let displayName = clientChannel.accountId;
          
          // For bots, use displayName from config if available
          if (clientData.isBot && clientData.botAccountId) {
            const botConfig = getBotConfig(clientData.botId || 'unknown');
            if (botConfig && botConfig.displayName) {
              displayName = botConfig.displayName;
            }
          }
          
          members.push({
            clientId: clientData.clientId,
            accountId: clientChannel.accountId,
            displayName: displayName,
            isBot: clientData.isBot || false,
            botAccountId: clientData.botAccountId || null,
            joinedAt: null // Could add timestamp if needed
          });
        }
      }
    }
    
    try {
      ws.send(
        JSON.stringify({
          type: "members",
          data: {
            channelId,
            members: members,
            totalCount: members.length,
            humanCount: members.filter(m => !m.isBot).length,
            botCount: members.filter(m => m.isBot).length,
          },
        }),
      );
    } catch (e) {
      console.log("Failed to send members list", e);
    }
  };

  const handleSignedIntent = async (ws, data, signedData) => {
    const { intentId, signedIntent } = data;
    const { accountId } = data.metadata;
    
    console.log(`Processing signed intent ${intentId} from ${accountId}`);
    
    // Find pending intent
    const pendingIntent = pendingIntents.get(intentId);
    if (!pendingIntent) {
      throw new Error("Intent not found or expired");
    }
    
    // Verify it's from the correct requester
    if (pendingIntent.requester !== accountId) {
      throw new Error("Intent can only be signed by the requester");
    }
    
    // Remove from pending (it's being processed)
    pendingIntents.delete(intentId);
    
    // Send processing status to channel
    broadcastToChannel(pendingIntent.channelId, {
      type: "tip_status",
      data: {
        intentId: intentId,
        status: "processing",
        from: pendingIntent.requester,
        to: pendingIntent.recipient,
        amount: pendingIntent.amount,
        humanAmount: pendingIntent.humanAmount,
        token: pendingIntent.token,
        message: `🔄 Processing tip from ${pendingIntent.requester} to ${pendingIntent.recipient}...`
      }
    });
    
    try {
      // Publish signed intent via solver relay (like Python code)
      console.log(`Publishing signed intent ${intentId} via solver relay`);
      
      const signedMultiPayload = signedIntent.signedMultiPayload;
      
      // Prepare request as in Python code
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
      
      console.log("Intent publish request:", JSON.stringify(request, null, 2));
      
      // Send request to solver relay
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
      console.log("Intent publish response:", result);
      
      if (result.result && result.result.status === "OK") {
        const intentHash = result.result.intent_hash;
        console.log('Successfully published! Intent Hash:', intentHash);
        
        // Now wait for intent to settle
        checkIntentStatus(intentHash, pendingIntent, intentId);
      } else {
        // Handle specific error types
        const errorReason = result.result?.reason || 'Unknown error';
        console.log("Intent publish failed:", errorReason);
        
        // Check if it's a public key not found error
        if (errorReason.includes("public key") && errorReason.includes("doesn't exist")) {
          // Send public message to all channel members
          // broadcastToChannel(pendingIntent.channelId, {
          //   type: "tip_status",
          //   data: {
          //     intentId: intentId,
          //     status: "error",
          //     from: pendingIntent.requester,
          //     to: pendingIntent.recipient,
          //     amount: pendingIntent.amount,
          //     token: pendingIntent.token,
          //     message: `❌ Tip from ${pendingIntent.requester} to ${pendingIntent.recipient} failed: Public key not registered on intents.near`
          //   }
          // });
          
          // Send private message to the sender with add key data
          const senderClient = [...wsClients.entries()].find(([ws, client]) => {
            return client.accountId === pendingIntent.requester;
          });
          
          if (senderClient) {
            const [senderWs] = senderClient;
            try {
              const addKeyMessage = {
                type: "add_key_required",
                data: {
                  contract: "intents.near",
                  publicKey: signedIntent.signedMultiPayload.public_key,
                  accountId: pendingIntent.requester,
                  recipientOnly: true
                }
              };
              console.log("Sending add_key_required to", pendingIntent.requester);
              senderWs.send(JSON.stringify(addKeyMessage));
            } catch (e) {
              console.log("Failed to send add key message to sender", e);
            }
          } else {
            console.log(`Sender client not found for account: ${pendingIntent.requester}`);
          }
        } else {
          // Generic error handling
          broadcastToChannel(pendingIntent.channelId, {
            type: "tip_status",
            data: {
              intentId: intentId,
              status: "error",
              from: pendingIntent.requester,
              to: pendingIntent.recipient,
              amount: pendingIntent.amount,
              humanAmount: pendingIntent.humanAmount,
              token: pendingIntent.token,
              message: `❌ Tip from ${pendingIntent.requester} to ${pendingIntent.recipient} failed: ${errorReason}`
            }
          });
        }
        
        // Clean up failed intent
        pendingIntents.delete(intentId);
      }
      
    } catch (error) {
      console.error("Error processing intent:", error);
      
      // Send error status
      broadcastToChannel(pendingIntent.channelId, {
        type: "tip_status",
        data: {
          intentId: intentId,
          status: "error", 
          from: pendingIntent.requester,
          to: pendingIntent.recipient,
          amount: pendingIntent.amount,
          humanAmount: pendingIntent.humanAmount,
          token: pendingIntent.token,
          error: error.message,
          message: `❌ Tip failed: ${error.message}`
        }
      });
    }
  };

  const handleRequestTipIntent = async (ws, data, signedData) => {
    const { channelId, intentId, recipient, amount, humanAmount, originalMessage, requester, replyToNonce } = data;
    
    console.log(`Tip intent requested: ${requester} -> ${recipient} (${amount}) in ${channelId}`);
    
    // Get channel config for token info
    const channelConfig = getChannelConfig(channelId);
    const defaultToken = channelConfig?.defaultToken || "wrap.near";
    const tokenSymbol = channelConfig?.tokenSymbol || defaultToken;

    // Store pending intent
    const intentData = {
      intentId,
      channelId,
      recipient,
      amount, // blockchain amount with decimals
      humanAmount, // human readable amount for UI
      token: defaultToken,
      tokenSymbol,
      originalMessage,
      requester,
      replyToNonce,
      createdAt: Date.now()
    };
    
    pendingIntents.set(intentId, intentData);
    
    // Set timeout (5 minutes)
    setTimeout(() => {
      if (pendingIntents.has(intentId)) {
        pendingIntents.delete(intentId);
        
        // Notify about timeout
        broadcastToChannel(channelId, {
          type: "tip_status",
          data: {
            intentId,
            status: "error",
            from: requester,
            to: recipient,
            amount: amount,
            humanAmount: humanAmount,
            token: defaultToken,
            error: "Intent signing timeout",
            message: `❌ Tip from ${requester} to ${recipient} timed out (not signed within 5 minutes)`
          }
        });
      }
    }, 5 * 60 * 1000); // 5 minutes
    
    // Find requester's WebSocket to send sign_intent
    let requesterWs = null;
    for (const [clientWs, client] of wsClients.entries()) {
      // Check if this client is in the channel and matches the requester
      const clientChannel = client.channels.get(channelId);
      if (clientChannel && clientChannel.accountId === requester) {
        requesterWs = clientWs;
        break;
      }
    }
    
    if (!requesterWs) {
      throw new Error("Requester not found in channel");
    }
    
    // Send sign_intent to the requester
    try {
      requesterWs.send(JSON.stringify({
        type: "sign_intent",
        data: {
          intentId,
          recipient,
          amount, // blockchain amount for signing
          humanAmount, // human readable amount for UI display
          token: defaultToken,
          originalMessage,
          requester
        }
      }));
      
      console.log(`Sent sign_intent ${intentId} to ${requester}`);
    } catch (e) {
      console.error("Failed to send sign_intent:", e);
      // Clean up pending intent
      pendingIntents.delete(intentId);
      throw new Error("Failed to send signing request to client");
    }
  };

  const handleDepositRequest = async (ws, data, signedData) => {
    const { channelId, targetAccountId, token, requiredAmount, decimals, tokenSymbol } = data;

    console.log(`Deposit request for ${targetAccountId}: ${requiredAmount} ${token} in ${channelId}`);

    // Find the target user's WebSocket in the channel
    let targetWs = null;
    for (const [clientWs, client] of wsClients.entries()) {
      const clientChannel = client.channels.get(channelId);
      if (clientChannel && clientChannel.accountId === targetAccountId) {
        targetWs = clientWs;
        break;
      }
    }

    if (!targetWs) {
      console.log(`Target user ${targetAccountId} not found in channel ${channelId}`);
      return;
    }

    // Send deposit UI message only to the target user
    try {
      targetWs.send(JSON.stringify({
        type: "deposit_ui",
        data: {
          channelId,
          accountId: targetAccountId,
          token,
          requiredAmount, // Human readable amount
          decimals,
          tokenSymbol
        }
      }));

      console.log(`Sent deposit UI to ${targetAccountId}`);
    } catch (e) {
      console.error("Failed to send deposit UI:", e);
    }
  };

  wss.on("connection", (ws, req) => {
    const clientId = uuidv4();
    console.log("WS Connection open", clientId);
    ws.on("error", console.error);

    // Initialize heartbeat
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    wsClients.set(ws, {
      clientId,
      channels: new Map(),
      isBot: false,
    });

    ws.on("close", () => {
      console.log("connection closed", clientId);
      handleDisconnect(ws, clientId);
    });

    ws.on("message", async (dataString) => {
      try {        
        const signedData = JSON.parse(dataString);
        console.log("WS Message", clientId, signedData);
        const data = await validateDataAndSignature(signedData);
        data.client = wsClients.get(ws);

        switch (data.action) {
          case "register_bot":
            handleRegisterBot(ws, data, signedData);
            break;
          case "join":
            await handleJoin(ws, req, data, signedData);
            break;
          case "leave":
            handleLeave(ws, req, data, signedData);
            break;
          case "message":
            handleMessage(ws, data, signedData);
            break;
          case "delete_message":
            await handleDeleteMessage(ws, data, signedData);
            break;
          case "history":
            handleHistory(ws, data, signedData);
            break;
          case "members":
            await handleMembers(ws, data, signedData);
            break;
          case "available_channels":
            handleAvailableChannels(ws, data, signedData);
            break;
          case "signed_intent":
            await handleSignedIntent(ws, data, signedData);
            break;
          case "request_tip_intent":
            await handleRequestTipIntent(ws, data, signedData);
            break;
          case "deposit_request":
            await handleDepositRequest(ws, data, signedData);
            break;
          default:
            throw new Error("Invalid action");
        }
      } catch (e) {
        console.log(e);
        try {
          ws.send(
            JSON.stringify({
              type: "error",
              error: e.message || "Unknown error",
            }),
          );
        } catch (e) {
          console.log("Failed to send error message", e);
        }
      }
    });

    try {
      ws.send(
        JSON.stringify({
          type: "welcome",
          data: {},
        }),
      );
    } catch (e) {
      console.log("Failed to send welcome message", e);
    }
  });

  // Graceful shutdown with state saving
  process.on("SIGINT", () => {
    console.log("🛑 Shutting down server...");
    console.log("💾 Saving state...");
    saveState();
    botManager.stopAllBots();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("🛑 Shutting down server...");
    console.log("💾 Saving state...");
    saveState();
    botManager.stopAllBots();
    process.exit(0);
  });
})();
