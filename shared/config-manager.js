import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

// Import viewFunction from near.js
const { viewFunction } = await import('./near.js');

const CACHE_CONFIG_TIME_IN_SECONDS = parseInt(process.env.CACHE_CONFIG_TIME_IN_SECONDS) || 60; // Default 1 minute
const CHATROOM_CONTRACT_ID = process.env.CHATROOM_CONTRACT_ID || "chatrooms.near";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_CONFIG_SOURCE = process.env.DEFAULT_CONFIG_SOURCE || 'file_and_smart_contract'; // Options: 'file', 'smart_contract', 'file_and_smart_contract'

/**
 * Centralized configuration manager
 * Will be updated to load from smart contract in the future
 */
class ConfigManager {
  constructor() {
    this.channelsConfig = {};
    this.botsConfig = {};
    this.lastLoadTime = 0;
    this.configSource = DEFAULT_CONFIG_SOURCE; // Options: 'file', 'smart_contract', 'file_and_smart_contract'
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
    } else if (this.configSource === 'file_and_smart_contract') {
      // Load from both sources, smart contract takes precedence
      this.loadChannelsConfig();
      this.loadBotsConfig();
      await this.loadAndMergeFromSmartContract();
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
   * Load configs from smart contract
   */
  async loadConfigsFromSmartContract(contractId = null) {
    const configContractId = contractId || CHATROOM_CONTRACT_ID;
    if (!configContractId) {
      throw new Error("CHATROOM_CONTRACT_ID environment variable not set");
    }

    console.log(`ConfigManager: Loading configs from smart contract ${configContractId}`);

    try {
      const chatrooms = await this.fetchChatroomsFromContract(configContractId);
      this.channelsConfig = this.convertChatroomsToChannelsConfig(chatrooms);
      // Bots config is still loaded from file for now
      this.loadBotsConfig();

      console.log(`ConfigManager: Loaded ${Object.keys(this.channelsConfig).length} channel configurations from contract`);
    } catch (error) {
      console.error("ConfigManager: Error loading configs from smart contract:", error);
      throw error;
    }
  }

  /**
   * Load and merge configs from smart contract with file configs
   */
  async loadAndMergeFromSmartContract() {
    if (!CHATROOM_CONTRACT_ID) {
      console.log("ConfigManager: CHATROOM_CONTRACT_ID not set, skipping smart contract integration");
      return;
    }

    console.log(`ConfigManager: Attempting to fetch chatrooms from contract: ${CHATROOM_CONTRACT_ID}`);
    try {
      const chatrooms = await this.fetchChatroomsFromContract(CHATROOM_CONTRACT_ID);
      const contractChannelsConfig = this.convertChatroomsToChannelsConfig(chatrooms);

      // Merge with file config, contract takes precedence but allow file overrides for certain fields
      const mergedConfig = { ...this.channelsConfig };

      for (const [channelId, contractConfig] of Object.entries(contractChannelsConfig)) {
        const fileConfig = this.channelsConfig[channelId];

        if (fileConfig) {
          // Merge: contract config takes precedence, but allow file overrides for debug settings
          mergedConfig[channelId] = {
            ...contractConfig,
            // Allow file config to override debug settings
            debug: fileConfig.debug !== undefined ? fileConfig.debug : contractConfig.debug
          };
        } else {
          // Pure contract config
          mergedConfig[channelId] = contractConfig;
        }
      }

      this.channelsConfig = mergedConfig;

      console.log(`ConfigManager: Merged ${Object.keys(contractChannelsConfig).length} channels from contract`);
    } catch (error) {
      console.error("ConfigManager: Error loading from smart contract, using file config only:", error);
    }
  }

  /**
   * Fetch chatrooms from NEAR smart contract
   */
  async fetchChatroomsFromContract(contractId) {
    console.log(`ConfigManager: Calling viewFunction for contract ${contractId}.get_chatrooms()`);

    try {
      const result = await viewFunction(contractId, "get_chatrooms");

      if (!result) {
        throw new Error("Contract returned null/undefined - method might not exist or returned empty");
      }

      console.log(`ConfigManager: Contract returned ${Array.isArray(result) ? result.length : 'non-array'} chatrooms`);
      console.log(`ConfigManager: Raw chatrooms:`, JSON.stringify(result, null, 2));

      return result;
    } catch (error) {
      console.error(`ConfigManager: Error calling ${contractId}.get_chatrooms():`, error.message);
      throw error;
    }
  }

  /**
   * Convert contract chatrooms format to channels config format
   */
  convertChatroomsToChannelsConfig(chatrooms) {
    const channelsConfig = {};

    for (const room of chatrooms) {
      const channelId = room.channel_id;
      const config = {
        name: room.channel_name,
        description: room.channel_description,
        isPublic: false, // Contract rooms are typically private
        rules: this.convertConditionToRules(room.condition),
        defaultToken: room.default_token?.asset_id ? this.extractTokenFromAssetId(room.default_token.asset_id) : "",
        tokenSymbol: room.default_token?.symbol || "",
        tokenDecimals: room.default_token?.decimals || 24,
        adminUsers: room.admins || [],

        // Additional contract-specific fields
        logoUrl: room.logo_url,
        creatorId: room.creator_id,
        validUntil: room.valid_until,

        // Mark as contract-sourced
        isFromContract: true
      };

      channelsConfig[channelId] = config;
    }

    return channelsConfig;
  }

  /**
   * Extract token contract from asset_id (e.g., "nep141:jambo-1679.meme-cooking.near" -> "jambo-1679.meme-cooking.near")
   */
  extractTokenFromAssetId(assetId) {
    if (assetId.startsWith('nep141:')) {
      return assetId.substring(7);
    }
    return assetId;
  }

  /**
   * Convert contract condition format to config rules format
   */
  convertConditionToRules(condition) {
    if (!condition) {
      return [];
    }

    return this.convertConditionRecursive(condition);
  }

  /**
   * Recursively convert contract condition to rules
   */
  convertConditionRecursive(condition) {
    // Handle Rust enum variants
    if (condition.Logic) {
      return {
        type: "logic",
        operator: condition.Logic.operator.toLowerCase(),
        conditions: condition.Logic.conditions.map(c => this.convertConditionRecursive(c))
      };
    }

    if (condition.Not) {
      return {
        type: "not",
        condition: this.convertConditionRecursive(condition.Not.condition)
      };
    }

    if (condition.AllowAll !== undefined) {
      return { type: "allowAll" };
    }

    if (condition.Whitelist) {
      return {
        type: "whitelist",
        accounts: condition.Whitelist.accounts
      };
    }

    if (condition.NearBalance) {
      return {
        type: "near_balance",
        operator: this.convertOperator(condition.NearBalance.operator),
        value: condition.NearBalance.value.toString()
      };
    }

    if (condition.FtBalance) {
      return {
        type: "ft_balance",
        contract: condition.FtBalance.contract,
        operator: this.convertOperator(condition.FtBalance.operator),
        value: condition.FtBalance.value.toString()
      };
    }

    if (condition.NftOwned) {
      return {
        type: "nft_owned",
        contract: condition.NftOwned.contract
      };
    }

    if (condition.HasContractOnAccount) {
      return {
        type: "has_contract_on_account",
        operator: this.convertOperator(condition.HasContractOnAccount.operator),
        value: condition.HasContractOnAccount.value
      };
    }

    throw new Error(`Unknown condition type: ${JSON.stringify(condition)}`);
  }

  /**
   * Convert contract operator to config operator
   */
  convertOperator(operator) {
    const operatorMap = {
      'Gte': 'gte',
      'Lte': 'lte',
      'Gt': 'gt',
      'Lt': 'lt',
      'Eq': 'eq',
      'Ne': 'ne'
    };
    return operatorMap[operator] || operator.toLowerCase();
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
      // TODO: Implement saveBotsConfigToFile() method\n      // this.saveBotsConfigToFile();
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
   * Set config source (file, smart_contract, or file_and_smart_contract)
   */
  setConfigSource(source) {
    if (!['file', 'smart_contract', 'file_and_smart_contract'].includes(source)) {
      throw new Error("Config source must be 'file', 'smart_contract', or 'file_and_smart_contract'");
    }
    this.configSource = source;
    this.lastLoadTime = 0; // Force reload when source changes
  }

  /**
   * Get current config source
   */
  getConfigSource() {
    return this.configSource || DEFAULT_CONFIG_SOURCE;
  }
}

// Export singleton instance
export const configManager = new ConfigManager();

// Export class for testing
export { ConfigManager };