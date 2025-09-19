import { configManager } from "../shared/config-manager.js";

// Legacy functions for backward compatibility
export const loadBotsConfig = () => {
  configManager.loadConfigs();
};

export const getBotConfig = async (botId) => {
  return await configManager.getBotConfig(botId);
};

export const getAllBotsConfig = async () => {
  return await configManager.getAllBotsConfig();
};

export const isValidBot = async (accountId) => {
  return await configManager.isValidBot(accountId);
};

export const shouldBotReceiveMessage = async (botId, channelId, message) => {
  return await configManager.shouldBotReceiveMessage(botId, channelId, message);
};

export const getBotsForMessage = async (channelId, message) => {
  return await configManager.getBotsForMessage(channelId, message);
};