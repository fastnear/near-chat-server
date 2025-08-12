require("dotenv").config();
const fs = require("fs");
const Denque = require("denque");
const { v4: uuidv4 } = require("uuid");
const { saveJson, loadJson, isString } = require("./utils");

const WebSocket = require("ws");

const MAX_HISTORY = 1000;
const MAX_CHANNEL_LENGTH = 64;
const GLOBAL_MESSAGE_QUEUE_SIZE = 1000000;

const ResPath = process.env.RES_PATH || "res";
const WsSubsFilename = ResPath + "/ws_subs.json";

function assertValidChannelId(channelId) {
  if (!channelId) {
    throw "channelId is empty";
  }
  if (!isString(channelId)) {
    throw "channelId is not a string";
  }
  if (channelId.length > MAX_CHANNEL_LENGTH) {
    throw `channelId is longer than ${MAX_CHANNEL_LENGTH}`;
  }
}

(async () => {
  if (!fs.existsSync(ResPath)) {
    fs.mkdirSync(ResPath);
  }

  const WS_PORT = process.env.WS_PORT || 7071;

  const wss = new WebSocket.Server({ port: WS_PORT });
  console.log("WebSocket server listening on http://localhost:%d/", WS_PORT);

  const wsClients = new Map();
  const channels = new Map();
  const globalMessageQueue = new Denque();

  const validateSignature = async ({ signature, signedData }) => {
    // TODO: Validate signature
    return JSON.parse(signedData);
  };

  const addGlobalMessage = (message) => {
    // TODO
  };

  const validateClientChannel = (client, data, channel) => {
    if (!channel) {
      throw "Channel doesn't exists";
    }
    const clientChannel = client.channels.get(channel.channelId);
    if (!clientChannel) {
      throw "Client hasn't joined the channel";
    }
    const { accountId, contractId, publicKey } = data;
    if (clientChannel.accountId !== accountId) {
      throw "Client joined with different accountId";
    }
    if (clientChannel.contractId !== contractId) {
      throw "Client joined with different contractId";
    }
    if (clientChannel.publicKey !== publicKey) {
      throw "Client joined with different publicKey";
    }
  };

  const addChannelMessage = (
    channel,
    action,
    data,
    clientIdentity,
    metadata,
  ) => {
    const { accountId, contractId, publicKey } = clientIdentity;
    const message = {
      action,
      clientIdentity: { accountId, contractId, publicKey },
      data,
      timestamp: Date.now(),
      nonce: channel.nonce++,
    };
    const channelId = channel.channelId;
    addGlobalMessage(channelId, message.timestamp);
    channel.messages.push({ message, metadata });
    channel.clients.values().forEach((ws) => {
      try {
        ws.send(
          JSON.stringify({
            type: "channel",
            data: Object.assign({ channelId }, message),
          }),
        );
      } catch (e) {
        console.log("Failed to send message to ws", e);
      }
    });
  };

  const handleJoin = (ws, req, data, metadata) => {
    const client = wsClients.get(ws);
    const clientId = client.clientId;
    const channelId = data.channelId;
    assertValidChannelId(channelId);
    if (client.channels.has(channelId)) {
      throw new Error("Already joined the channel");
    }
    const { accountId, contractId, publicKey } = data;
    client.channels.set(channelId, {
      accountId,
      contractId,
      publicKey,
    });
    if (!channels.has(channelId)) {
      channels.set(channelId, {
        channelId,
        clients: new Map(),
        messages: [],
        nonce: 1,
      });
    }
    const channel = channels.get(channelId);
    // // Try to send the history. And your ID
    // try {
    //   ws.send(
    //     JSON.stringify({
    //       type: "history",
    //       data: {
    //         messages: channel.messages.slice(-MAX_HISTORY),
    //       },
    //     }),
    //   );
    // } catch (e) {
    //   console.log("Failed to send past messages", e);
    // }
    channel.clients.set(clientId, ws);
    addChannelMessage(channel, "connected", {}, data, metadata);
  };

  const handleLeave = (ws, req, data, metadata) => {
    // TODO
  };

  const handleMessage = (ws, data, metadata) => {
    const client = wsClients.get(ws);
    const clientId = client.clientId;
    const channelId = data.channelId;
    assertValidChannelId(channelId);
    const channel = channels.get(channelId);
    validateClientChannel(client, data, channel);
    addChannelMessage(
      channel,
      "message",
      {
        message: data.message,
      },
      data,
      metadata,
    );
  };

  const handleDisconnect = (ws, clientId) => {
    const client = wsClients.get(ws);
    for (const [channelId, clientIdentity] of client.channels.entries()) {
      const channel = channels.get(channelId);
      if (channel) {
        channel.clients.delete(clientId);
        addChannelMessage(channel, "disconnected", {}, clientIdentity, null);
      }
    }
    wsClients.delete(ws);
  };

  const handleHistory = (ws, data, metadata) => {
    // TODO:
  };

  const handleMembers = (ws, data, metadata) => {
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
        const metadata = JSON.parse(dataString);
        const data = await validateSignature(metadata);
        const { signature, signedData } = metadata;

        switch (data.action) {
          case "join":
            handleJoin(ws, req, data, metadata);
            break;
          case "leave":
            handleLeave(ws, req, data, metadata);
            break;
          case "message":
            handleMessage(ws, data, metadata);
            break;
          case "history":
            handleHistory(ws, data, metadata);
            break;
          case "members":
            handleMembers(ws, data, metadata);
            break;
          default:
            throw new Error("Invalid action");
        }
      } catch (e) {
        console.log("Bad message", e);
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
