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

export const getAvailableChannels = async (accountId) => {
  const availableChannels = {};
  
  for (const [channelId, config] of Object.entries(channelsConfig)) {
    try {
      const hasAccess = await evaluateAllRules(accountId, config.rules);
      
      if (hasAccess) {
        availableChannels[channelId] = {
          name: config.name,
          description: config.description,
          isPublic: config.isPublic,
          defaultToken: config.defaultToken || "near",
        };
      }
    } catch (error) {
      console.error(`Error evaluating rules for channel ${channelId} and user ${accountId}:`, error);
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