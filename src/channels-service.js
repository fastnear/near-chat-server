import path from "path";
import { evaluateAllRules } from "./rules-engine.js";
import { configManager } from "../shared/config-manager.js";

// Legacy functions for backward compatibility
export const loadChannelsConfig = () => {
  configManager.loadConfigs();
};

export const getChannelConfig = async (channelId) => {
  return await configManager.getChannelConfig(channelId);
};

export const getAllChannelConfigs = async () => {
  return await configManager.getAllChannelsConfig();
};

export const getAvailableChannels = async (accountId, channels = null, wsClients = null, userChannelVisits = null) => {
  const availableChannels = {};
  const userVisitedChannels = userChannelVisits?.get(accountId) || new Set();

  // First, add configured channels
  const channelsConfig = await configManager.getAllChannelsConfig();
  for (const [channelId, config] of Object.entries(channelsConfig)) {
    try {
      const hasAccess = await canUserAccessChannel(accountId, channelId);
      const showInDiscovery = config.showInDiscovery !== false; // Default to true if not specified

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
        channelId,
        name: config.name || channelId,
        description: config.description,
        isPublic: config.isPublic,
        defaultToken: config.defaultToken || "",
        tokenDecimals: config.tokenDecimals || 24,
        tokenSymbol: config.tokenSymbol || "",
        minTipAmount: config.minTipAmount || 0.01,
        memberCount: memberCount,
        botsCount: botsCount,
        isConfigured: true,
        hasAccess,
        hasVisited: userVisitedChannels.has(channelId)
      };
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
            channelId: visitedChannelId,
            name: visitedChannelId,
            description: "",
            isPublic: false,
            defaultToken: "",
            tokenDecimals: 24,
            tokenSymbol: "",
            minTipAmount: 0.01,
            memberCount: memberCount,
            botsCount: botsCount,
            isConfigured: false,
            isUserCreated: true,
            createdBy: channel.createdBy,
            createdAt: channel.createdAt,
            hasAccess: true,
            hasVisited: true,
            isCurrentlyJoined: false
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
                channelId,
                name: channelId,
                description: `User-created channel`,
                isPublic: false,
                defaultToken: "",
                tokenDecimals: 24,
                tokenSymbol: "",
                minTipAmount: 0.01,
                memberCount: memberCount,
                botsCount: botsCount,
                isConfigured: false,
                isUserCreated: true,
                createdBy: channel.createdBy,
                createdAt: channel.createdAt,
                hasAccess: true,
                hasVisited: userVisitedChannels.has(channelId),
                isCurrentlyJoined: true
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
  const config = await getChannelConfig(channelId);
  if (!config) {
    // If channel is not configured, allow access (user can create channels)
    return true;
  }

  try {
    return await evaluateAllRules(accountId, config.rules);
  } catch (error) {
    console.error(`Error checking access for user ${accountId} to channel ${channelId}:`, error);
    return false;
  }
};