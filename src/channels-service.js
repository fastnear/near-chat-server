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

export const getAvailableChannels = async (accountId, channels = null, wsClients = null) => {
  const availableChannels = {};
  
  // First, add configured channels
  for (const [channelId, config] of Object.entries(channelsConfig)) {
    try {
      const hasAccess = await evaluateAllRules(accountId, config.rules);
      
      if (hasAccess) {
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
          defaultToken: config.defaultToken || "near",
          tokenDecimals: config.tokenDecimals || 24,
          tokenSymbol: config.tokenSymbol || (config.defaultToken || "near"),
          minTipAmount: config.minTipAmount || 0.01,
          memberCount: memberCount,
          botsCount: botsCount,
          isConfigured: true
        };
      }
    } catch (error) {
      console.error(`Error evaluating rules for channel ${channelId} and user ${accountId}:`, error);
    }
  }
  
  // Then, add user-created channels (not in config)
  if (channels) {
    for (const [channelId, channel] of channels) {
      // Skip if already added from config
      if (availableChannels[channelId]) continue;
      
      // For user-created channels, show them as public
      const channelClients = channel.clients || new Map();
      let memberCount = 0;
      let botsCount = 0;
      
      // Count members vs bots
      for (const [clientId, ws] of channelClients) {
        const clientData = wsClients?.get(ws);
        if (clientData?.isBot) {
          botsCount++;
        } else {
          memberCount++;
        }
      }
      
      availableChannels[channelId] = {
        name: channelId, // Use channel ID as name for user-created channels
        description: "User-created channel",
        isPublic: true, // User-created channels are public by default
        defaultToken: "", // No tip bot support for user channels
        tokenDecimals: 0,
        tokenSymbol: "",
        memberCount: memberCount,
        botsCount: botsCount,
        isConfigured: false,
        createdBy: channel.createdBy,
        createdAt: channel.createdAt
      };
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