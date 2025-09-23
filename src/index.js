import * as dotenv from "dotenv";
dotenv.config();
import fs from "fs";
import Denque from "denque";
import { v4 as uuidv4 } from "uuid";
import { saveJson, loadJson, isString } from "../shared/utils.js";
import {
  isValidAccountId,
  verifySignature,
  isImplicitNearAccount,
  keyFromString,
  keyToString,
  derivePublicKeyFromImplicitAccountId,
  fetchAndCacheAccessKey,
  checkStorageBalance,
} from "../shared/near.js";
import { WebSocketServer } from "ws";
import { loadChannelsConfig, getAvailableChannels, canUserAccessChannel, getChannelConfig } from "./channels-service.js";
import { loadBotsConfig, isValidBot, getBotsForMessage, getBotConfig, getAllBotsConfig } from "./bots-service.js";
import { getKeyPairFromPrivateKey, signMessage, getPublicKeyFromKeyPair } from "../shared/near.js";
import { ServerEventSystem } from "./server-events.js";
import { configManager } from "../shared/config-manager.js";
import { processMiniAppArchive } from "./webapp-processor.js";

// Initialize config source based on environment (if explicitly set)
if (process.env.CONFIG_SOURCE) {
  const CONFIG_SOURCE = process.env.CONFIG_SOURCE;
  if (['file', 'smart_contract', 'file_and_smart_contract'].includes(CONFIG_SOURCE)) {
    configManager.setConfigSource(CONFIG_SOURCE);
    console.log(`🔧 ConfigManager: Using config source from ENV: ${CONFIG_SOURCE}`);
  } else {
    console.warn(`⚠️  Invalid CONFIG_SOURCE: ${CONFIG_SOURCE}, using default`);
  }
}
console.log(`🔧 ConfigManager: Active config source: ${configManager.getConfigSource()}`);

const MAX_HISTORY = 1000;
const MAX_CHANNEL_LENGTH = 64;
const GLOBAL_MESSAGE_QUEUE_SIZE = 1000000;
const MAX_MESSAGE_DELAY_MS =
  parseFloat(process.env.MAX_MESSAGE_DELAY_MS) || 5000;
const EMPTY_CHANNEL_CLEANUP_MS =
  parseFloat(process.env.EMPTY_CHANNEL_CLEANUP_MS) || 12 * 60 * 60 * 1000; // 12 hours
const MAX_REACTIONS_PER_USER_PER_MESSAGE = 1; // Maximum reactions one user can have on one message

const SERVER_SIGNATURE_CONTRACT_ID = process.env.SERVER_SIGNATURE_CONTRACT_ID || "social.near";

const ResPath = process.env.RES_PATH || "res";
const WsSubsFilename = ResPath + "/ws_subs.json";
const StateFilename = ResPath + "/server-state.json";

// Global variables for state management
let channels;
let pendingIntents;
let userChannelVisits; // Map<accountId, Set<channelId>> - tracks which channels user has visited

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
    throw new Error(`ChannelId "${channelId}" must be at least 2 characters long`);
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
      const messages = (channelData.updates || []).map(({ update, detailedReactions }) => ({
        ...update,
        detailedReactions: detailedReactions || undefined
      }));

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

    // Convert userChannelVisits Map to serializable object
    const userVisitsObj = {};
    for (const [accountId, channelSet] of userChannelVisits.entries()) {
      userVisitsObj[accountId] = Array.from(channelSet);
    }

    const state = {
      timestamp: Date.now(),
      channels: channelsObj,
      userChannelVisits: userVisitsObj
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
  // Validate critical environment variables for money operations
  const requiredEnvVars = [
    'SERVER_ACCOUNT_ID',
    'SERVER_PRIVATE_KEY',
    'INTENTS_CONTRACT_ID'
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Required environment variable ${envVar} is not set`);
    }
  }

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
  userChannelVisits = new Map(); // accountId -> Set<channelId>

  // Restore saved state if available
  if (savedState && savedState.channels) {
    for (const [channelId, channelData] of Object.entries(savedState.channels)) {
      // Convert saved messages back to updates format (without signedData)
      const updates = (channelData.messages || []).map(savedMessage => ({
        update: {
          action: savedMessage.action,
          clientIdentity: savedMessage.clientIdentity,
          message: savedMessage.message,
          timestampMs: savedMessage.timestampMs,
          nonce: savedMessage.nonce,
          messageMetadata: savedMessage.messageMetadata
        },
        detailedReactions: savedMessage.detailedReactions || undefined,
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

  // Restore userChannelVisits if available
  if (savedState && savedState.userChannelVisits) {
    for (const [accountId, channelArray] of Object.entries(savedState.userChannelVisits)) {
      userChannelVisits.set(accountId, new Set(channelArray));
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
          message: `⏰ Tip from ${intentData.requester} to ${intentData.recipient} (${intentData.amount} ${intentData.token}) expired after 5 minutes`
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

    // Delete the channels and remove from all user visit histories
    for (const channelId of channelsToDelete) {
      channels.delete(channelId);

      // Remove this channel from all users' visit history
      for (const [accountId, visitedChannels] of userChannelVisits.entries()) {
        visitedChannels.delete(channelId);
        // Clean up empty visit sets
        if (visitedChannels.size === 0) {
          userChannelVisits.delete(accountId);
        }
      }
    }
  };

  // Run cleanup every minute
  setInterval(cleanupExpiredIntents, 60 * 1000);
  setInterval(cleanupEmptyChannels, 2 * 60 * 1000); // Every 2 minutes

  loadBotsConfig();
  loadChannelsConfig();

  // Function to check intent settlement status (like Python get_intent_settled_status)

  // Function to check if user can delete message
  const canUserDeleteMessage = async (messageAuthor, currentUser, channelId) => {
    // User can delete their own messages
    if (messageAuthor === currentUser) {
      return true;
    }

    // Check if user is admin of the channel
    const channelConfig = await getChannelConfig(channelId);
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
    if (!(await canUserDeleteMessage(messageAuthor, accountId, channelId))) {
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

  // Initialize Server Event System
  const serverEventSystem = new ServerEventSystem(
    process.env.SERVER_ACCOUNT_ID,
    process.env.SERVER_PRIVATE_KEY
  );
  serverEventSystem.setWSClients(wsClients);

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

  // Broadcast server startup to connected bots after a short delay
  setTimeout(async () => {
    console.log("🚀 Broadcasting server startup to connected bots...");
    await serverEventSystem.broadcastServerStartup();
  }, 3000);

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
    await verifySignature(publicKey, signature, serializedData);
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
    messageMetadata = null,
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

    // Add isBot flag for join/left actions if it's a bot
    if ((action === "joined" || action === "left" || action === "disconnected") && client.isBot) {
      update.isBot = true;
    }

    // Add messageMetadata if provided and not empty
    if (messageMetadata && Object.keys(messageMetadata).length > 0) {
      update.messageMetadata = messageMetadata;
    }
    const channelId = channel.channelId;    
    channel.updates.push({ update, signedData });

    // Update last activity time for user-created channels
    if (channel.createdBy) {
      channel.lastActiveAt = Date.now();
    }

    // Return the nonce of the created message
    const createdMessageNonce = update.nonce;

    channel.clients.forEach((ws, clientWs) => {
      try {
        // Get client data to determine user
        const clientData = wsClients.get(ws);
        const userAccountId = clientData?.accountId;

        // Clone update to modify for this specific client
        const messageForClient = {
          ...update
        };

        // Add userReactionCounts if this message has reactions and we know the user
        if (update.messageMetadata?.reactionCounts && userAccountId) {
          // Find user's reactions in detailedReactions
          const messageItem = channel.updates.find(item => item.update.nonce === update.nonce);
          if (messageItem?.detailedReactions) {
            const userReactions = messageItem.detailedReactions.filter(r => r.accountId === userAccountId);
            if (userReactions.length > 0) {
              const userReactionCounts = {};
              for (const reaction of userReactions) {
                userReactionCounts[reaction.emoji] = 1; // Each user can have max 1 of each emoji
              }

              // Add userReactionCounts to messageMetadata for this client
              messageForClient.messageMetadata = {
                ...messageForClient.messageMetadata,
                userReactionCounts
              };
            }
          }
        }

        ws.send(
          JSON.stringify({
            type: "channel",
            data: Object.assign({ channelId }, messageForClient),
          }),
        );
      } catch (e) {
        console.log("Failed to send update to ws", e);
      }
    });

    // Return the nonce of the created message
    return createdMessageNonce;
  };

  const getBotAccountIdFromBotId = async (botId) => {
    try {
      const botConfig = await getBotConfig(botId);
      return botConfig ? botConfig.accountId : null;
    } catch (error) {
      console.error(`Error getting bot config for ${botId}:`, error);
      return null;
    }
  };


  // Store pending miniapp requests
  const pendingMiniappRequests = new Map(); // requestId -> { resolve, timeoutId }

  const requestMiniappFromBot = async (botId, channelId, timeout = 5000) => {
    try {
      console.log(`🔄 Requesting miniapp from bot ${botId} for channel ${channelId}`);

      // Find bot WebSocket connection
      const botWs = Array.from(wsClients.keys()).find(ws => {
        const client = wsClients.get(ws);
        return client && client.isBot && client.accountId === botId;
      });

      if (!botWs || botWs.readyState !== 1) {
        console.log(`❌ Bot ${botId} not connected or ready`);
        return null;
      }

      const requestId = uuidv4();
      const request = {
        type: 'request_miniapp',
        requestId,
        channelId,
        timestamp: Date.now()
      };

      return new Promise((resolve) => {
        // Set timeout
        const timeoutId = setTimeout(() => {
          console.log(`⏰ Miniapp request to ${botId} timed out`);
          pendingMiniappRequests.delete(requestId);
          resolve(null);
        }, timeout);

        // Store pending request
        pendingMiniappRequests.set(requestId, { resolve, timeoutId });

        // Send request
        try {
          botWs.send(JSON.stringify(request));
        } catch (error) {
          clearTimeout(timeoutId);
          pendingMiniappRequests.delete(requestId);
          console.error(`Error sending miniapp request to ${botId}:`, error);
          resolve(null);
        }
      });
    } catch (error) {
      console.error(`Error requesting miniapp from bot ${botId}:`, error);
      return null;
    }
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
    const channelConfig = await getChannelConfig(channelId);
    
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

    }
    const channel = channels.get(channelId);
    channel.clients.set(client.clientId, ws);

    // Mark this channel as visited by the user
    if (!userChannelVisits.has(accountId)) {
      userChannelVisits.set(accountId, new Set());
    }
    userChannelVisits.get(accountId).add(channelId);

    addChannelMessage(channel, "joined", data.message, data, signedData);

    // Send join confirmation with moderation rights to the user
    const isChannelModerator = channelConfig && channelConfig.adminUsers &&
                               channelConfig.adminUsers.includes(accountId);

    // Check if channel has a miniapp bot configured
    let miniAppData = null;
    if (channelConfig && channelConfig.miniappBot) {
      const botAccountId = await getBotAccountIdFromBotId(channelConfig.miniappBot);
      if (botAccountId) {
        console.log(`🤖 Channel ${channelId} has miniapp bot: ${botAccountId}`);
        const rawMiniAppData = await requestMiniappFromBot(botAccountId, channelId);

        if (rawMiniAppData) {
          try {
            // Process the archive to get ready HTML content
            const htmlContent = processMiniAppArchive(rawMiniAppData.data);

            // Create new format with htmlContent instead of data
            miniAppData = {
              botId: rawMiniAppData.botId,
              htmlContent: htmlContent,
              version: rawMiniAppData.version,
              permissions: rawMiniAppData.permissions,
              lastUpdated: rawMiniAppData.lastUpdated
            };

            console.log(`✅ Processed mini-app archive for ${botAccountId}`);
          } catch (error) {
            console.error(`❌ Failed to process mini-app archive from ${botAccountId}:`, error);
            // Don't send miniAppData if processing fails
            miniAppData = null;
          }
        }
      }
    }

    try {
      ws.send(JSON.stringify({
        type: "join_success",
        data: {
          channelId: channelId,
          isChannelModerator: isChannelModerator || false,
          accountId: accountId,
          miniApp: miniAppData
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

    // Process messageMetadata from client data
    let messageMetadata = null;
    if (data.messageMetadata) {
      messageMetadata = {};

      // Handle attachments
      if (data.messageMetadata.attachments && Array.isArray(data.messageMetadata.attachments)) {
        messageMetadata.attachments = data.messageMetadata.attachments.filter(attachment => {
          // Validate attachment structure
          return attachment &&
                 typeof attachment === 'object' &&
                 attachment.type &&
                 attachment.url;
        }).slice(0, 10); // Limit to maximum 10 attachments

        if (messageMetadata.attachments.length === 0) {
          delete messageMetadata.attachments;
        } else if (data.messageMetadata.attachments.length > 10) {
          console.log(`User ${data.metadata.accountId} tried to attach ${data.messageMetadata.attachments.length} images, limited to 10`);
        }
      }

      // Handle isPinned
      if (data.messageMetadata.isPinned === true) {
        messageMetadata.isPinned = true;
      }

      // Handle reaction counts (not detailed reactions in messages)
      if (data.messageMetadata.reactionCounts && typeof data.messageMetadata.reactionCounts === 'object') {
        const validCounts = {};
        for (const [emoji, count] of Object.entries(data.messageMetadata.reactionCounts)) {
          if (typeof count === 'number' && count > 0) {
            validCounts[emoji] = count;
          }
        }
        if (Object.keys(validCounts).length > 0) {
          messageMetadata.reactionCounts = validCounts;
        }
      }

      // If messageMetadata is empty, set to null
      if (Object.keys(messageMetadata).length === 0) {
        messageMetadata = null;
      }
    }

    const messageNonce = addChannelMessage(channel, "message", data.message, data, signedData, messageMetadata);

    // Send confirmation with nonce back to sender (especially useful for bots)
    try {
      ws.send(JSON.stringify({
        type: "message_created",
        data: {
          channelId: data.channelId,
          nonce: messageNonce
        }
      }));
    } catch (e) {
      console.error("Failed to send message_created confirmation:", e);
    }
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

    // Get user accountId for userReactionCounts
    const userAccountId = client.accountId;

    // Process history to add userReactionCounts for this specific user
    const historyWithUserReactions = updates.map(({ update, detailedReactions }) => {
      const messageForUser = { ...update };

      // Add userReactionCounts if this message has reactions and we know the user
      if (update.messageMetadata?.reactionCounts && userAccountId && detailedReactions) {
        const userReactions = detailedReactions.filter(r => r.accountId === userAccountId);
        if (userReactions.length > 0) {
          const userReactionCounts = {};
          for (const reaction of userReactions) {
            userReactionCounts[reaction.emoji] = 1; // Each user can have max 1 of each emoji
          }

          messageForUser.messageMetadata = {
            ...messageForUser.messageMetadata,
            userReactionCounts
          };
        }
      }

      return messageForUser;
    });

    try {
      ws.send(
        JSON.stringify({
          type: "history",
          data: {
            channelId,
            history: historyWithUserReactions,
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
      const availableChannels = await getAvailableChannels(accountId, channels, wsClients, userChannelVisits);
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

  const handleRegisterBot = async (ws, data, signedData) => {
    const { accountId } = data.metadata;
    const client = data.client;
    const botId = data.botId; // Get botId from request

    if (!(await isValidBot(accountId))) {
      throw new Error("Bot not authorized");
    }

    // Verify botId matches config
    const botConfig = await getBotConfig(botId);
    if (!botConfig || botConfig.accountId !== accountId) {
      throw new Error(`Bot ID ${botId} doesn't match account ${accountId}`);
    }

    // Check if bot with this accountId is already connected
    for (const [existingWs, existingClient] of wsClients.entries()) {
      if (existingClient.isBot && existingClient.botAccountId === accountId && existingWs !== ws) {
        throw new Error(`Bot with account ${accountId} is already connected`);
      }
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

    // Send server identity to bot
    try {
      ws.send(JSON.stringify({
        type: "server_identity",
        data: {
          serverAccountId: process.env.SERVER_ACCOUNT_ID,
          serverPublicKey: getPublicKeyFromKeyPair(getKeyPairFromPrivateKey(process.env.SERVER_PRIVATE_KEY))
        }
      }));
    } catch (e) {
      console.log("Failed to send server identity", e);
    }

    // Send startup notification to this specific bot
    setTimeout(async () => {
      console.log(`🚀 Sending startup notification to bot ${botId}...`);

      const startupData = {
        action: "server_startup",
        eventType: "server_started",
        payload: {
          timestamp: Date.now(),
          serverAccountId: process.env.SERVER_ACCOUNT_ID,
          botChannels: botConfig.channels || []
        },
        metadata: {
          accountId: process.env.SERVER_ACCOUNT_ID,
          contractId: SERVER_SIGNATURE_CONTRACT_ID,
          publicKey: getPublicKeyFromKeyPair(getKeyPairFromPrivateKey(process.env.SERVER_PRIVATE_KEY)),
          timestampMs: Date.now()
        }
      };

      const serializedData = JSON.stringify(startupData);
      const serverKeyPair = getKeyPairFromPrivateKey(process.env.SERVER_PRIVATE_KEY);
      const signature = await signMessage(serializedData, serverKeyPair);

      const signedEvent = {
        signature,
        serializedData
      };

      try {
        ws.send(JSON.stringify(signedEvent));
        console.log(`✅ Sent startup notification to bot ${botId}`);
      } catch (e) {
        console.error(`❌ Failed to send startup notification to bot ${botId}:`, e);
      }
    }, 500); // Небольшая задержка чтобы бот успел обработать server_identity
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
            const botConfig = await getBotConfig(clientData.botId || 'unknown');
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

  const handleRequestTipIntent = async (ws, data, signedData) => {
    const { channelId, intentId, recipient, amount, humanAmount, originalMessage, requester, replyTo, token } = data;
    const { accountId } = data.metadata;
    const client = wsClients.get(ws);

    // Only bots can request tip intents
    if (!client?.isBot) {
      throw new Error("Only bots can request tip intents");
    }

    // Validate required fields for money operations - strict validation for financial operations
    if (!token || typeof token !== 'string' || token.trim() === '') {
      throw new Error("Token field must be a non-empty string for tip intents");
    }
    if (!amount || typeof amount !== 'string' || amount.trim() === '') {
      throw new Error("Amount field must be a non-empty string for tip intents");
    }
    if (!recipient || typeof recipient !== 'string' || recipient.trim() === '') {
      throw new Error("Recipient field must be a non-empty string for tip intents");
    }

    // Tip intent requested - verbose logging removed

    // Store the pending intent
    const pendingIntent = {
      intentId,
      channelId,
      recipient,
      amount,
      humanAmount,
      originalMessage,
      requester,
      replyTo, // nonce of original message to reply to
      token, // add token field to pending intent
      timestamp: Date.now(),
      status: 'pending'
    };

    pendingIntents.set(intentId, pendingIntent);

    // Send confirmation back to bot
    try {
      ws.send(JSON.stringify({
        type: "tip_intent_requested",
        data: {
          intentId,
          status: "pending",
          message: `Tip intent created: ${humanAmount} to ${recipient}`
        }
      }));
    } catch (e) {
      console.error("Failed to send tip intent confirmation:", e);
    }

    // Find the requester (user who requested the tip) and send them signing request
    const requesterClient = [...wsClients.entries()].find(([ws, client]) => {
      return client.accountId === requester;
    });

    if (requesterClient) {
      const [requesterWs] = requesterClient;

      try {
        requesterWs.send(JSON.stringify({
          type: "sign_intent",
          data: {
            intentId,
            channelId,
            recipient,
            amount,
            humanAmount,
            token
          }
        }));
        // Signing request sent
      } catch (e) {
        console.error("Failed to send signing request to requester:", e);
      }
    } else {
      console.log(`❌ Requester ${requester} not found in connected clients`);

      // Broadcast to channel that user needs to be online
      broadcastToChannel(channelId, {
        type: "tip_status",
        data: {
          intentId,
          status: "error",
          message: `❌ ${requester} needs to be online to sign the tip`
        }
      });
    }

    console.log(`✅ Tip intent ${intentId} stored for ${requester} -> ${recipient}: ${humanAmount}`);
  };

  const handleRequestAddKey = async (ws, data, signedData) => {
    const { contractId, publicKey, accountId, recipientOnly } = data;
    const client = wsClients.get(ws);

    // Only bots can request add key
    if (!client?.isBot) {
      throw new Error("Only bots can request add key");
    }

    // Validate required fields
    if (!contractId || typeof contractId !== 'string' || contractId.trim() === '') {
      throw new Error("contractId field must be a non-empty string");
    }
    if (!publicKey || typeof publicKey !== 'string' || publicKey.trim() === '') {
      throw new Error("publicKey field must be a non-empty string");
    }
    if (!accountId || typeof accountId !== 'string' || accountId.trim() === '') {
      throw new Error("accountId field must be a non-empty string");
    }

    console.log(`Add key requested for account: ${accountId}`);

    // Find the user who needs to add the key
    const userClient = [...wsClients.entries()].find(([ws, client]) => {
      return client.accountId === accountId;
    });

    if (userClient) {
      const [userWs] = userClient;
      try {
        const addKeyMessage = {
          type: "add_key_required",
          data: {
            contractId,
            publicKey,
            accountId,
            recipientOnly: recipientOnly || true
          }
        };
        console.log("Sending add_key_required to", accountId);
        userWs.send(JSON.stringify(addKeyMessage));
      } catch (e) {
        console.log("Failed to send add key message to user", e);
      }
    } else {
      console.log(`User client not found for account: ${accountId}`);
    }
  };

  const handleMiniappResponse = (data) => {
    const { requestId, error, data: responseData } = data;

    // Find pending request
    const pendingRequest = pendingMiniappRequests.get(requestId);
    if (!pendingRequest) {
      console.log(`No pending miniapp request found for requestId: ${requestId}`);
      return;
    }

    // Clean up
    clearTimeout(pendingRequest.timeoutId);
    pendingMiniappRequests.delete(requestId);

    // Resolve the promise
    if (error) {
      console.log(`❌ Bot returned miniapp error: ${error}`);
      pendingRequest.resolve(null);
    } else {
      console.log(`✅ Received miniapp data from bot`);
      pendingRequest.resolve(responseData);
    }
  };

  const handleSignedIntent = async (ws, data, signedData) => {
    const { intentId, signedIntent } = data;
    const { accountId } = data.metadata;
    const client = wsClients.get(ws);

    // Check if this bot is allowed to process signed intents
    if (client && client.isBot) {
      const botConfig = await getBotConfig(client.botId);
      if (!botConfig?.allowedRequestSignedIntent) {
        throw new Error("Bot not authorized to process signed intents");
      }
    }

    // Processing signed intent
    
    // Find pending intent
    const pendingIntent = pendingIntents.get(intentId);
    if (!pendingIntent) {
      throw new Error("Intent not found or expired");
    }
    
    // Verify it's from the correct requester
    if (pendingIntent.requester !== accountId) {
      throw new Error("Intent can only be signed by the requester");
    }
    
    // Send signed intent to tip-bot for publishing

    // Find tip-bot to send the signed intent
    for (const [botWs, botClient] of wsClients.entries()) {
      if (botClient.isBot && botClient.botId === "tip-bot") {
        try {
          botWs.send(JSON.stringify({
            type: "publish_signed_intent",
            data: {
              intentId,
              signedIntent,
              pendingIntent
            }
          }));
          // Signed intent sent to tip-bot

          // Remove from pending (tip-bot will handle it now)
          pendingIntents.delete(intentId);
          return;
        } catch (e) {
          console.error("Failed to send signed intent to tip-bot:", e);
        }
      }
    }

    console.error("❌ Tip-bot not found - cannot publish intent");

    try {
      ws.send(JSON.stringify({
        type: "error",
        error: "Tip service unavailable - tip-bot not connected"
      }));
    } catch (e) {
      console.error("Failed to send error message to user:", e);
    }

    // Restore intent to pending for potential retry
    pendingIntents.set(intentId, pendingIntent);
    return;

    // OLD CODE BELOW - REMOVE AFTER TESTING
    try {
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
        
        // Send server event to tip-bot to handle intent monitoring
        await serverEventSystem.sendServerEvent(pendingIntent.channelId, "intent_created", {
          intentId,
          intentHash,
          pendingIntent
        });
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
                  contractId: process.env.INTENTS_CONTRACT_ID,
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



  const handleReaction = async (ws, data, signedData) => {
    const { channelId, messageNonce, emoji, reactionAction } = data; // reactionAction: 'add' or 'remove'
    const { accountId } = data.metadata;

    console.log(`${reactionAction} reaction: ${accountId} ${reactionAction}s ${emoji} to message ${messageNonce} in ${channelId}`);

    const channel = channels.get(channelId);
    if (!channel) {
      throw new Error("Channel not found");
    }

    validateClientChannel(data.client, data, channel);

    // Find the message to react to
    const messageIndex = channel.updates.findIndex(item => item.update.nonce === messageNonce);
    if (messageIndex === -1) {
      throw new Error("Message not found");
    }

    const messageUpdate = channel.updates[messageIndex];

    // Initialize messageMetadata if not exists
    if (!messageUpdate.update.messageMetadata) {
      messageUpdate.update.messageMetadata = {};
    }

    // Store detailed reactions separately for later retrieval
    if (!messageUpdate.detailedReactions) {
      messageUpdate.detailedReactions = [];
    }

    const detailedReactions = messageUpdate.detailedReactions;
    const existingDetailedIndex = detailedReactions.findIndex(r => r.emoji === emoji && r.accountId === accountId);

    if (reactionAction === 'add') {
      if (existingDetailedIndex === -1) {
        // Check if user already has maximum reactions on this message
        const userReactions = detailedReactions.filter(r => r.accountId === accountId);

        if (userReactions.length >= MAX_REACTIONS_PER_USER_PER_MESSAGE) {
          // Remove oldest reaction from this user
          const oldestReactionIndex = detailedReactions.findIndex(r => r.accountId === accountId);
          if (oldestReactionIndex !== -1) {
            const removedReaction = detailedReactions.splice(oldestReactionIndex, 1)[0];
            console.log(`Removed oldest reaction ${removedReaction.emoji} from ${accountId} to add new reaction ${emoji}`);
          }
        }

        // Add new reaction
        detailedReactions.push({
          emoji,
          accountId,
          timestampMs: Date.now()
        });
      }
    } else if (reactionAction === 'remove') {
      if (existingDetailedIndex !== -1) {
        detailedReactions.splice(existingDetailedIndex, 1);
      }
    }

    // Update reaction counts in messageMetadata
    const reactionCounts = {};
    for (const reaction of detailedReactions) {
      if (!reactionCounts[reaction.emoji]) {
        reactionCounts[reaction.emoji] = 0;
      }
      reactionCounts[reaction.emoji]++;
    }

    // Update messageMetadata with counts only
    if (Object.keys(reactionCounts).length > 0) {
      messageUpdate.update.messageMetadata.reactionCounts = reactionCounts;
    } else {
      delete messageUpdate.update.messageMetadata.reactionCounts;
      // Remove detailedReactions if no reactions left
      delete messageUpdate.detailedReactions;
    }

    // Remove messageMetadata if empty
    if (Object.keys(messageUpdate.update.messageMetadata).length === 0) {
      delete messageUpdate.update.messageMetadata;
    }

    // Broadcast reaction update to all channel members (with personalized userReactionCounts)
    const channelForBroadcast = channels.get(channelId);
    channelForBroadcast.clients.forEach((ws) => {
      try {
        // Get client data to determine user
        const clientData = wsClients.get(ws);
        const userAccountId = clientData?.accountId;

        // Create base reaction update data
        const reactionUpdateData = {
          channelId,
          messageNonce,
          emoji,
          reactionAction,
          accountId,
          reactionCounts: messageUpdate.update.messageMetadata?.reactionCounts || {}
        };

        // Add userReactionCounts if we know the user and they have reactions
        if (userAccountId && messageUpdate.detailedReactions) {
          const userReactions = messageUpdate.detailedReactions.filter(r => r.accountId === userAccountId);
          if (userReactions.length > 0) {
            const userReactionCounts = {};
            for (const reaction of userReactions) {
              userReactionCounts[reaction.emoji] = 1;
            }
            reactionUpdateData.userReactionCounts = userReactionCounts;
          }
        }

        ws.send(JSON.stringify({
          type: "reaction_update",
          data: reactionUpdateData
        }));
      } catch (e) {
        console.log("Failed to broadcast reaction update to client", e);
      }
    });
  };

  const handlePinMessage = async (ws, data, signedData) => {
    const { channelId, messageNonce, isPinned } = data;
    const { accountId } = data.metadata;

    console.log(`${isPinned ? 'Pin' : 'Unpin'} message: ${accountId} ${isPinned ? 'pins' : 'unpins'} message ${messageNonce} in ${channelId}`);

    const channel = channels.get(channelId);
    if (!channel) {
      throw new Error("Channel not found");
    }

    // Check if user has permission to pin messages (admin or channel creator)
    const channelConfig = await getChannelConfig(channelId);
    const isChannelModerator = (channelConfig && channelConfig.adminUsers && channelConfig.adminUsers.includes(accountId)) ||
                               channel.createdBy === accountId;

    if (!isChannelModerator) {
      throw new Error("Permission denied: only channel moderators can pin/unpin messages");
    }

    // Find the message to pin/unpin
    const messageIndex = channel.updates.findIndex(item => item.update.nonce === messageNonce);
    if (messageIndex === -1) {
      throw new Error("Message not found");
    }

    const messageUpdate = channel.updates[messageIndex];

    // Initialize messageMetadata if not exists
    if (!messageUpdate.update.messageMetadata) {
      messageUpdate.update.messageMetadata = {};
    }

    if (isPinned) {
      messageUpdate.update.messageMetadata.isPinned = true;
    } else {
      delete messageUpdate.update.messageMetadata.isPinned;
    }

    // Remove messageMetadata if empty
    if (Object.keys(messageUpdate.update.messageMetadata).length === 0) {
      delete messageUpdate.update.messageMetadata;
    }

    // Broadcast pin update to all channel members
    broadcastToChannel(channelId, {
      type: "pin_update",
      data: {
        channelId,
        messageNonce,
        isPinned,
        pinnedBy: accountId
      }
    });
  };

  const handlePinnedMessages = async (ws, data, signedData) => {
    const client = data.client;
    const channelId = data.channelId;
    assertValidChannelId(channelId);
    const channel = channels.get(channelId);
    if (!channel) {
      throw new Error("Channel doesn't exist");
    }
    validateClientChannel(client, data, channel);

    // Get user accountId for userReactionCounts
    const userAccountId = client.accountId;

    // Get all pinned messages with userReactionCounts
    const pinnedMessagesWithUserReactions = channel.updates
      .filter(({ update }) => update.messageMetadata && update.messageMetadata.isPinned)
      .map(({ update, detailedReactions }) => {
        const messageForUser = { ...update };

        // Add userReactionCounts if this message has reactions and we know the user
        if (update.messageMetadata?.reactionCounts && userAccountId && detailedReactions) {
          const userReactions = detailedReactions.filter(r => r.accountId === userAccountId);
          if (userReactions.length > 0) {
            const userReactionCounts = {};
            for (const reaction of userReactions) {
              userReactionCounts[reaction.emoji] = 1; // Each user can have max 1 of each emoji
            }

            messageForUser.messageMetadata = {
              ...messageForUser.messageMetadata,
              userReactionCounts
            };
          }
        }

        return messageForUser;
      });

    try {
      ws.send(
        JSON.stringify({
          type: "pinned_messages",
          data: {
            channelId,
            pinnedMessages: pinnedMessagesWithUserReactions,
          },
        }),
      );
    } catch (e) {
      console.log("Failed to send pinned messages", e);
    }
  };


  const handleReactionDetails = async (ws, data, signedData) => {
    const client = data.client;
    const channelId = data.channelId;
    const messageNonce = data.messageNonce;

    assertValidChannelId(channelId);
    const channel = channels.get(channelId);
    if (!channel) {
      throw new Error("Channel doesn't exist");
    }
    validateClientChannel(client, data, channel);

    // Find the message
    const messageUpdate = channel.updates.find(item => item.update.nonce === messageNonce);
    if (!messageUpdate) {
      throw new Error("Message not found");
    }

    const detailedReactions = messageUpdate.detailedReactions || [];

    try {
      ws.send(
        JSON.stringify({
          type: "reaction_details",
          data: {
            channelId,
            messageNonce,
            reactions: detailedReactions,
          },
        }),
      );
    } catch (e) {
      console.log("Failed to send reaction details", e);
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

        // Check bot permissions for special actions
        const client = wsClients.get(ws);
        const standardActions = [
          "register_bot", "join", "leave", "message", "delete_message",
          "history", "members", "available_channels", "signed_intent",
          "reaction", "pin_message", "pinned_messages", "reaction_details"
        ];

        if (client?.isBot && !standardActions.includes(data.action)) {
          const botConfig = await getBotConfig(client.botId);
          if (!botConfig?.allowedRequestTypes?.includes(data.action)) {
            console.log("FFF", botConfig?.allowedRequestTypes);
            throw new Error(`Bot ${client.botId} is not allowed to perform action: ${data.action}`);
          }
        }

        switch (data.action) {
          case "register_bot":
            await handleRegisterBot(ws, data, signedData);
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
          // message with the signed intent after user signs it on a web app
          case "signed_intent":
            await handleSignedIntent(ws, data, signedData);
            break;
          case "reaction":
            await handleReaction(ws, data, signedData);
            break;
          case "pin_message":
            await handlePinMessage(ws, data, signedData);
            break;
          case "pinned_messages":
            await handlePinnedMessages(ws, data, signedData);
            break;
          case "reaction_details":
            await handleReactionDetails(ws, data, signedData);
            break;
          
          case "request_tip_intent":
            await handleRequestTipIntent(ws, data, signedData);
            break;
          case "request_add_key":
            await handleRequestAddKey(ws, data, signedData);
            break;
          case "miniapp_response":
            handleMiniappResponse(data);
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
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("🛑 Shutting down server...");
    console.log("💾 Saving state...");
    saveState();
    process.exit(0);
  });
})();
