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
import BotManager from "./bot-manager.js";

const MAX_HISTORY = 1000;
const MAX_CHANNEL_LENGTH = 64;
const GLOBAL_MESSAGE_QUEUE_SIZE = 1000000;
const MAX_MESSAGE_DELAY_MS =
  parseFloat(process.env.MAX_MESSAGE_DELAY_MS) || 5000;

const ResPath = process.env.RES_PATH || "res";
const WsSubsFilename = ResPath + "/ws_subs.json";

function assertValidChannelId(channelId) {
  if (!channelId) {
    throw new Error("channelId is empty");
  }
  if (!isString(channelId)) {
    throw new Error("channelId is not a string");
  }
  if (channelId.length > MAX_CHANNEL_LENGTH) {
    throw new Error(`channelId is longer than ${MAX_CHANNEL_LENGTH}`);
  }
}

(async () => {
  if (!fs.existsSync(ResPath)) {
    fs.mkdirSync(ResPath);
  }

  const WS_PORT = process.env.WS_PORT || 7071;

  const wsClients = new Map();
  const channels = new Map();
  const globalMessageQueue = new Denque();
  const accessKeyCache = new Map();
  const pendingIntents = new Map(); // intentId -> intent data

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
  
  // Run cleanup every minute
  setInterval(cleanupExpiredIntents, 60 * 1000);

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
        console.log("Intent status response:", result);
        
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
              amount: pendingIntent.humanAmount || pendingIntent.amount,
              token: pendingIntent.token,
              transactionHash: transactionHash,
              message: `✅ ${pendingIntent.requester} tipped ${pendingIntent.recipient} ${pendingIntent.humanAmount || pendingIntent.amount} ${pendingIntent.token}`
            }
          });
          
          // Send tip bot message as reply with transaction link
          const channel = channels.get(pendingIntent.channelId);
          if (channel) {
            const tipBotMessage = {
              action: "message",
              channelId: pendingIntent.channelId,
              clientIdentity: {
                accountId: "zavodil.near", // tip bot account
                contractId: "social.near",
                publicKey: "ed25519:3KyUuch8pYP47krBq4DosFEVBMR5wDTMQ8AThzM8kAEcBQHqjEtzBx4JhPQqpX2vGvPEAF7V2vPPm9h3PVfDaYeP",
                clientId: "tip-bot",
              },
              message: {
                text: `✅ Tip successful! @${pendingIntent.requester} sent ${pendingIntent.humanAmount || pendingIntent.amount} ${pendingIntent.token} to ${pendingIntent.recipient}. View transaction: https://nearblocks.io/txns/${transactionHash}`,
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
              amount: pendingIntent.humanAmount || pendingIntent.amount,
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
              amount: pendingIntent.humanAmount || pendingIntent.amount,
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
            amount: pendingIntent.humanAmount || pendingIntent.amount,
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

  // Ready for intent publishing via solver relay

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
    channel.clients.values().forEach((ws) => {
      try {
        ws.send(
          JSON.stringify({
            type: "channel",
            data: Object.assign({ channelId }, update),
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
    if (channelConfig) {
      const hasAccess = await canUserAccessChannel(accountId, channelId);
      if (!hasAccess) {
        throw new Error("Access denied to this channel");
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
      });
      
      // Start bots for this channel if it's newly created
      setTimeout(() => {
        botManager.startBotsForChannel(channelId);
      }, 1000);
    }
    const channel = channels.get(channelId);
    channel.clients.set(client.clientId, ws);
    addChannelMessage(channel, "joined", data.message, data, signedData);
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
    try {
      ws.send(
        JSON.stringify({
          type: "history",
          data: {
            channelId,
            history: updates.map(({ update }) => update),
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
          broadcastToChannel(pendingIntent.channelId, {
            type: "tip_status",
            data: {
              intentId: intentId,
              status: "error",
              from: pendingIntent.requester,
              to: pendingIntent.recipient,
              amount: pendingIntent.amount,
              token: pendingIntent.token,
              message: `❌ Tip from ${pendingIntent.requester} to ${pendingIntent.recipient} failed: Public key not registered on intents.near`
            }
          });
          
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
    
    // Store pending intent
    const intentData = {
      intentId,
      channelId,
      recipient,
      amount, // blockchain amount with decimals
      humanAmount, // human readable amount for UI
      token: defaultToken,
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

  wss.on("connection", (ws, req) => {
    const clientId = uuidv4();
    console.log("WS Connection open", clientId);
    ws.on("error", console.error);

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

  // Graceful shutdown for bots
  process.on("SIGINT", () => {
    console.log("🛑 Shutting down server...");
    botManager.stopAllBots();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("🛑 Shutting down server...");
    botManager.stopAllBots();
    process.exit(0);
  });
})();
