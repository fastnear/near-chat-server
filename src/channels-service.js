import fs from "fs";
import path from "path";
import { evaluateAllRules } from "./rules-engine.js";

let channelsConfig = {};
const CONFIG_PATH = "channels-config.json";

export const loadChannelsConfig = () => {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const configData = fs.readFileSync(CONFIG_PATH, 'utf8');
      channelsConfig = JSON.parse(configData);
      console.log(`Loaded ${Object.keys(channelsConfig).length} channel configurations`);
    } else {
      console.log("channels-config.json not found, using empty config");
      channelsConfig = {};
    }
  } catch (error) {
    console.error("Error loading channels config:", error);
    channelsConfig = {};
  }
};

export const getChannelConfig = (channelId) => {
  return channelsConfig[channelId] || null;
};

export const getAllChannelConfigs = () => {
  return channelsConfig;
};

export const getAvailableChannels = async (accountId, channels = null, wsClients = null, userChannelVisits = null) => {
  const availableChannels = {};
  const userVisitedChannels = userChannelVisits?.get(accountId) || new Set();

  // First, add configured channels
  for (const [channelId, config] of Object.entries(channelsConfig)) {
    try {
      const hasAccess = await evaluateAllRules(accountId, config.rules);
      const showInDiscovery = config.showInDiscovery !== false; // Default to true if not specified

      if (hasAccess && showInDiscovery) {
        // Get member and bot counts from active channels
        const channelClients = channels?.get(channelId)?.clients || new Map();
        let memberCount = 0;
        let botsCount = 0;

        // Count members vs bots based on wsClients data
        for (const [clientId, ws] of channelClients) {
          const clientData = wsClients?.get(ws);
          if (clientData?.isBot) {
            botsCount++;
          } else {
            memberCount++;
          }
        }

        availableChannels[channelId] = {
          name: config.name,
          description: config.description,
          isPublic: config.isPublic,
          defaultToken: config.defaultToken || "",
          tokenDecimals: config.tokenDecimals || 24,
          tokenSymbol: config.tokenSymbol || "",
          minTipAmount: config.minTipAmount || 0.01,
          memberCount: memberCount,
          botsCount: botsCount,
          isConfigured: true,
          hasVisited: userVisitedChannels.has(channelId)
        };
      }
    } catch (error) {
      console.error(`Error evaluating rules for channel ${channelId} and user ${accountId}:`, error);
    }
  }

  // Add previously visited channels that are still active
  if (channels && userVisitedChannels.size > 0) {
    for (const visitedChannelId of userVisitedChannels) {
      // Skip if already added from configured channels
      if (!availableChannels[visitedChannelId]) {
        const channel = channels.get(visitedChannelId);
        if (channel) {
          // Count members for this channel
          let memberCount = 0;
          let botsCount = 0;

          for (const [clientId, channelWs] of channel.clients) {
            const clientData = wsClients?.get(channelWs);
            if (clientData?.isBot) {
              botsCount++;
            } else {
              memberCount++;
            }
          }

          availableChannels[visitedChannelId] = {
            name: visitedChannelId, // Use channelId as name for user-created channels
            description: "", // Need to load description from the channel regisrty
            isPublic: false, // User-created channels are private by default
            defaultToken: "",
            tokenDecimals: 24,
            tokenSymbol: "",
            minTipAmount: 0.01,
            memberCount: memberCount,
            botsCount: botsCount,
            isConfigured: false, // Mark as user-created
            createdBy: channel.createdBy,
            createdAt: channel.createdAt,
            hasVisited: true, // Always true for previously visited channels
            isCurrentlyJoined: false // User is not currently in this channel
          };
        }
      }
    }
  }

  // Add user-created channels that the user has joined in current session
  if (wsClients && channels) {
    // Find the user's WebSocket client(s)
    for (const [ws, client] of wsClients.entries()) {
      if (client.accountId === accountId && client.channels) {
        // Add channels the user has joined but aren't in configured channels or visited list
        for (const [channelId, clientChannel] of client.channels.entries()) {
          // Skip if already added from configured channels or visited channels
          if (!availableChannels[channelId]) {
            const channel = channels.get(channelId);
            if (channel) {
              // Count members for user-created channel
              let memberCount = 0;
              let botsCount = 0;

              for (const [clientId, channelWs] of channel.clients) {
                const clientData = wsClients.get(channelWs);
                if (clientData?.isBot) {
                  botsCount++;
                } else {
                  memberCount++;
                }
              }

              availableChannels[channelId] = {
                name: channelId, // Use channelId as name for user-created channels
                description: `User-created channel`,
                isPublic: false, // User-created channels are private by default
                defaultToken: "",
                tokenDecimals: 24,
                tokenSymbol: "",
                minTipAmount: 0.01,
                memberCount: memberCount,
                botsCount: botsCount,
                isConfigured: false, // Mark as user-created
                createdBy: channel.createdBy,
                createdAt: channel.createdAt,
                hasVisited: userVisitedChannels.has(channelId),
                isCurrentlyJoined: true // User is currently in this channel
              };
            }
          } else if (availableChannels[channelId]) {
            // Update the isCurrentlyJoined flag if channel was already added from visited list
            availableChannels[channelId].isCurrentlyJoined = true;
          }
        }
        // Only need to check one client per user (they should have same channels)
        break;
      }
    }
  }

  return availableChannels;
};

export const canUserAccessChannel = async (accountId, channelId) => {
  const config = getChannelConfig(channelId);
  if (!config) {
    return false;
  }
  
  try {
    return await evaluateAllRules(accountId, config.rules);
  } catch (error) {
    console.error(`Error checking access for user ${accountId} to channel ${channelId}:`, error);
    return false;
  }
};