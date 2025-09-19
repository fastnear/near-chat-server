import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const CACHE_CONFIG_TIME_IN_SECONDS = parseInt(process.env.CACHE_CONFIG_TIME_IN_SECONDS) || 60; // Default 1 minute

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Centralized configuration manager
 * Will be updated to load from smart contract in the future
 */
class ConfigManager {
  constructor() {
    this.channelsConfig = {};
    this.botsConfig = {};
    this.lastLoadTime = 0;
    this.configSource = 'file'; // Default to file-based config
  }

  isConfigCacheValid() {
    const now = Date.now();
    const cacheAgeMs = now - this.lastLoadTime;
    const cacheValidMs = CACHE_CONFIG_TIME_IN_SECONDS * 1000;
    return cacheAgeMs < cacheValidMs;
  }

  /**
   * Load all configurations with TTL cache
   */
  async loadConfigs() {
    if (this.isConfigCacheValid()) {
      return; // Cache is still valid
    }

    console.log(`🔄 ConfigManager: Loading configs (cache expired after ${CACHE_CONFIG_TIME_IN_SECONDS}s)`);

    if (this.configSource === 'smart_contract') {
      await this.loadConfigsFromSmartContract();
    } else {
      this.loadChannelsConfig();
      this.loadBotsConfig();
    }

    this.lastLoadTime = Date.now();
    console.log(`✅ ConfigManager: All configs loaded successfully from ${this.configSource}`);
  }

  /**
   * Load channels configuration
   */
  loadChannelsConfig() {
    const configPath = process.env.NODE_ENV === 'test'
      ? 'test-res/channels-config.json'
      : path.join(__dirname, 'channels-config.json');

    console.log("ConfigManager: Loading channels configuration from file", configPath);

    try {
      if (fs.existsSync(configPath)) {
        const configData = fs.readFileSync(configPath, 'utf8');
        this.channelsConfig = JSON.parse(configData);
        console.log(`ConfigManager: Loaded ${Object.keys(this.channelsConfig).length} channel configurations`);
      } else {
        console.log("ConfigManager: channels-config.json not found, using empty config");
        this.channelsConfig = {};
      }
    } catch (error) {
      console.error("ConfigManager: Error loading channels config:", error);
      this.channelsConfig = {};
    }
  }

  /**
   * Load bots configuration
   */
  loadBotsConfig() {
    const configPath = process.env.NODE_ENV === 'test'
      ? 'test-res/bots-config.json'
      : path.join(__dirname, 'bots-config.json');

    try {
      if (fs.existsSync(configPath)) {
        const configData = fs.readFileSync(configPath, 'utf8');
        this.botsConfig = JSON.parse(configData);
        console.log(`ConfigManager: Loaded ${Object.keys(this.botsConfig).length} bot configurations`);
      } else {
        console.log("ConfigManager: bots-config.json not found, using empty config");
        this.botsConfig = {};
      }
    } catch (error) {
      console.error("ConfigManager: Error loading bots config:", error);
      this.botsConfig = {};
    }
  }

  /**
   * Get channel configuration by ID
   */
  async getChannelConfig(channelId) {
    if (!this.loaded) {
      await this.loadConfigs();
    }
    return this.channelsConfig[channelId] || null;
  }

  /**
   * Get all channels configuration
   */
  async getAllChannelsConfig() {
    if (!this.loaded) {
      await this.loadConfigs();
    }
    return this.channelsConfig;
  }

  /**
   * Get bot configuration by ID
   */
  async getBotConfig(botId) {
    if (!this.loaded) {
      await this.loadConfigs();
    }
    return this.botsConfig[botId] || null;
  }

  /**
   * Get all bots configuration
   */
  async getAllBotsConfig() {
    if (!this.loaded) {
      await this.loadConfigs();
    }
    return this.botsConfig;
  }

  /**
   * Check if bot is valid and enabled
   */
  async isValidBot(accountId) {
    if (!this.loaded) {
      await this.loadConfigs();
    }
    return Object.values(this.botsConfig).some(bot =>
      bot.accountId === accountId && bot.enabled
    );
  }

  /**
   * Check if bot should receive message
   */
  async shouldBotReceiveMessage(botId, channelId, message) {
    const botConfig = await this.getBotConfig(botId);
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
  }

  /**
   * Get bots that should receive a message
   */
  async getBotsForMessage(channelId, message) {
    const matchingBots = [];
    const allBots = await this.getAllBotsConfig();

    for (const [botId, botConfig] of Object.entries(allBots)) {
      if (await this.shouldBotReceiveMessage(botId, channelId, message)) {
        matchingBots.push({
          botId,
          accountId: botConfig.accountId,
          name: botConfig.name
        });
      }
    }

    return matchingBots;
  }

  /**
   * Force reload configurations (useful for hot reload)
   */
  async reloadConfigs() {
    this.lastLoadTime = 0; // Force reload by expiring cache
    await this.loadConfigs();
  }

  /**
   * Future: Load configs from smart contract
   * This method will replace loadConfigs() when ready
   */
  async loadConfigsFromSmartContract(contractId = null) {
    // TODO: Implement smart contract integration
    // Expected implementation:
    // 1. Connect to NEAR network
    // 2. Call view methods on the config contract
    // 3. Load channels config from contract storage
    // 4. Load bots config from contract storage
    // 5. Cache configs in memory for performance

    const configContractId = contractId || process.env.CONFIG_CONTRACT_ID;
    if (!configContractId) {
      throw new Error("CONFIG_CONTRACT_ID environment variable not set");
    }

    throw new Error("Smart contract integration not implemented yet");
  }

  /**
   * Future: Save configs to smart contract
   * This will enable dynamic configuration updates
   */
  async saveConfigsToSmartContract(channelsConfig = null, botsConfig = null) {
    // TODO: Implement smart contract integration
    // Expected implementation:
    // 1. Validate configs structure
    // 2. Connect to NEAR network with admin credentials
    // 3. Call change methods on the config contract
    // 4. Update local cache after successful save

    throw new Error("Smart contract integration not implemented yet");
  }

  /**
   * Future: Watch for config changes on smart contract
   * This will enable real-time config updates
   */
  async watchConfigChanges(callback) {
    // TODO: Implement smart contract integration
    // Expected implementation:
    // 1. Set up event listeners for contract changes
    // 2. Poll contract state periodically
    // 3. Call callback when configs change
    // 4. Automatically reload configs

    throw new Error("Smart contract integration not implemented yet");
  }

  /**
   * Update bot channels without restart
   * Returns true if update was successful
   */
  async updateBotChannels(botId, newChannels) {
    if (!this.loaded) {
      await this.loadConfigs();
    }

    const botConfig = this.botsConfig[botId];
    if (!botConfig) {
      throw new Error(`Bot ${botId} not found in configuration`);
    }

    // Update in memory
    const oldChannels = [...(botConfig.channels || [])];
    botConfig.channels = [...newChannels];

    // Save to file (in production, this would save to smart contract)
    try {
      this.saveBotsConfig();
      console.log(`✅ ConfigManager: Updated ${botId} channels: ${oldChannels.join(',')} → ${newChannels.join(',')}`);
      return true;
    } catch (error) {
      // Rollback in memory changes
      botConfig.channels = oldChannels;
      console.error(`❌ ConfigManager: Failed to update ${botId} channels:`, error);
      throw error;
    }
  }

  /**
   * Add channel to bot without restart
   */
  async addChannelToBot(botId, channelId) {
    if (!this.loaded) {
      await this.loadConfigs();
    }

    const botConfig = this.botsConfig[botId];
    if (!botConfig) {
      throw new Error(`Bot ${botId} not found in configuration`);
    }

    const currentChannels = botConfig.channels || [];
    if (currentChannels.includes(channelId)) {
      console.log(`📢 ConfigManager: Bot ${botId} already has channel ${channelId}`);
      return false; // No change needed
    }

    const newChannels = [...currentChannels, channelId];
    await this.updateBotChannels(botId, newChannels);
    return true;
  }

  /**
   * Remove channel from bot without restart
   */
  async removeChannelFromBot(botId, channelId) {
    if (!this.loaded) {
      await this.loadConfigs();
    }

    const botConfig = this.botsConfig[botId];
    if (!botConfig) {
      throw new Error(`Bot ${botId} not found in configuration`);
    }

    const currentChannels = botConfig.channels || [];
    if (!currentChannels.includes(channelId)) {
      console.log(`📢 ConfigManager: Bot ${botId} doesn't have channel ${channelId}`);
      return false; // No change needed
    }

    const newChannels = currentChannels.filter(ch => ch !== channelId);
    await this.updateBotChannels(botId, newChannels);
    return true;
  }

  /**
   * Set config source (file or smart contract)
   */
  setConfigSource(source) {
    if (!['file', 'smart_contract'].includes(source)) {
      throw new Error("Config source must be 'file' or 'smart_contract'");
    }
    this.configSource = source;
    this.lastLoadTime = 0; // Force reload when source changes
  }

  /**
   * Get current config source
   */
  getConfigSource() {
    return this.configSource || 'file';
  }
}

// Export singleton instance
export const configManager = new ConfigManager();

// Export class for testing
export { ConfigManager };