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

  loadChannelsConfig();

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
      const availableChannels = await getAvailableChannels(accountId);
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

  const handleMembers = (ws, data, signedData) => {
    // TODO:
  };

  wss.on("connection", (ws, req) => {
    const clientId = uuidv4();
    console.log("WS Connection open", clientId);
    ws.on("error", console.error);

    wsClients.set(ws, {
      clientId,
      channels: new Map(),
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
            handleMembers(ws, data, signedData);
            break;
          case "available_channels":
            handleAvailableChannels(ws, data, signedData);
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
})();
