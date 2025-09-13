import fs from "fs";

let botsConfig = {};
const BOTS_CONFIG_PATH = "bots-config.json";

export const loadBotsConfig = () => {
  try {
    if (fs.existsSync(BOTS_CONFIG_PATH)) {
      const configData = fs.readFileSync(BOTS_CONFIG_PATH, 'utf8');
      botsConfig = JSON.parse(configData);
      console.log(`Loaded ${Object.keys(botsConfig).length} bot configurations`);
      console.log(Object.keys(botsConfig))
    } else {
      console.log("bots-config.json not found, using empty config");
      botsConfig = {};
    }
  } catch (error) {
    console.error("Error loading bots config:", error);
    botsConfig = {};
  }
};

export const getBotConfig = (botId) => {
  return botsConfig[botId] || null;
};

export const getAllBotsConfig = () => {
  return botsConfig;
};

export const isValidBot = (accountId) => {
  return Object.values(botsConfig).some(bot => 
    bot.accountId === accountId && bot.enabled
  );
};

export const shouldBotReceiveMessage = (botId, channelId, message) => {
  const botConfig = getBotConfig(botId);
  if (!botConfig || !botConfig.enabled) {
    return false;
  }

  if (!botConfig.channels.includes(channelId)) {
    return false;
  }

  const { filters } = botConfig;
  const messageText = message.toLowerCase();

  // Check commands
  if (filters.commands) {
    for (const command of filters.commands) {
      if (messageText.startsWith(command.toLowerCase())) {
        return true;
      }
    }
  }

  // Check mentions
  if (filters.mentions) {
    for (const mention of filters.mentions) {
      if (messageText.includes(mention.toLowerCase())) {
        return true;
      }
    }
  }

  return false;
};

export const getBotsForMessage = (channelId, message) => {
  const matchingBots = [];
  
  for (const [botId, botConfig] of Object.entries(botsConfig)) {
    if (shouldBotReceiveMessage(botId, channelId, message)) {
      matchingBots.push({
        botId,
        accountId: botConfig.accountId,
        name: botConfig.name
      });
    }
  }
  
  return matchingBots;
};