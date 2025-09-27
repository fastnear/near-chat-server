import {
  loadChannelsConfig,
  getChannelConfig,
  getAvailableChannels,
  canUserAccessChannel
} from '../../src/channels-service.js';
import { setupTestEnvironment, cleanupTestEnvironment } from '../helpers/server-helpers.js';
import fs from 'fs';

const TESTNET_PUBLIC_CHANNEL_ID = 'testnet-public-channel';
const TESTNET_PRIVATE_CHANNEL_ID = 'testnet-private-channel';

describe('Channels Service', () => {
  let testEnv;

  beforeEach(() => {
    testEnv = setupTestEnvironment();
    loadChannelsConfig();
  });

  afterEach(async () => {
    await cleanupTestEnvironment();
  });

  describe('loadChannelsConfig', () => {
    test('should load channels configuration', async () => {
      const testnetConfig = await getChannelConfig(TESTNET_PUBLIC_CHANNEL_ID);

      expect(testnetConfig).toBeDefined();
      expect(testnetConfig.description).toBe('Public chat for Testnet');
      expect(testnetConfig.adminUsers).toContain('alice.testnet');
    });

    test('should handle missing config file gracefully', async () => {
      // Remove config file
      fs.unlinkSync('test-res/channels-config.json');

      // We need to import configManager and force reload since it caches configs
      const { configManager } = await import('../../shared/config-manager.js');
      await configManager.reloadConfigs();

      const config = await getChannelConfig(TESTNET_PUBLIC_CHANNEL_ID);
      expect(config).toBeNull();
    });
  });

  describe('getChannelConfig', () => {
    test('should return channel config for existing channel', async () => {
      const config = await getChannelConfig(TESTNET_PUBLIC_CHANNEL_ID);

      expect(config).toBeDefined();
      expect(config.description).toBe('Public chat for Testnet');
      expect(config.adminUsers).toEqual(['alice.testnet']);
    });

    test('should return null for non-existent channel', async () => {
      const config = await getChannelConfig('non-existent');

      expect(config).toBeNull();
    });
  });

  describe('canUserAccessChannel', () => {
    test('should allow access to public channel', async () => {
      const hasAccess = await canUserAccessChannel('bob.testnet', TESTNET_PUBLIC_CHANNEL_ID);

      expect(hasAccess).toBe(true);
    });

    test('should allow access to restricted channel for authorized user', async () => {
      const hasAccess = await canUserAccessChannel('private.testnet', TESTNET_PRIVATE_CHANNEL_ID);

      expect(hasAccess).toBe(true);
    });

    test('should deny access to restricted channel for unauthorized user', async () => {
      const hasAccess = await canUserAccessChannel('unauthorized.testnet', TESTNET_PRIVATE_CHANNEL_ID);

      expect(hasAccess).toBe(false);
    });

    test('should allow access to non-configured channel', async () => {
      const hasAccess = await canUserAccessChannel('alice.testnet', 'new-testnet-channel');

      expect(hasAccess).toBe(true);
    });
  });

  describe('getAvailableChannels', () => {
    test('should return available channels for user', async () => {
      const mockChannels = new Map();
      const mockWSClients = new Map();
      const mockUserChannelVisits = new Map([
        ['alice.testnet', new Set([TESTNET_PUBLIC_CHANNEL_ID, 'custom-channel'])]
      ]);

      // Add a user-created channel
      mockChannels.set('custom-channel', {
        channelId: 'custom-channel',
        createdBy: 'alice.testnet',
        clients: new Map()
      });

      const availableChannels = await getAvailableChannels(
        'alice.testnet',
        mockChannels,
        mockWSClients,
        mockUserChannelVisits
      );

      expect(availableChannels).toEqual(
        expect.objectContaining({
          [TESTNET_PUBLIC_CHANNEL_ID]: expect.objectContaining({
            channelId: TESTNET_PUBLIC_CHANNEL_ID,
            hasAccess: true,
            memberCount: 0
          }),
          [TESTNET_PRIVATE_CHANNEL_ID]: expect.objectContaining({
            channelId: TESTNET_PRIVATE_CHANNEL_ID,
            hasAccess: true,
            memberCount: 0
          }),
          'custom-channel': expect.objectContaining({
            channelId: 'custom-channel',
            hasAccess: true,
            memberCount: 0,
            isUserCreated: true
          })
        })
      );
    });

    test('should exclude channels user cannot access', async () => {
      const mockChannels = new Map();
      const mockWSClients = new Map();
      const mockUserChannelVisits = new Map();

      const availableChannels = await getAvailableChannels(
        'unauthorized.testnet',
        mockChannels,
        mockWSClients,
        mockUserChannelVisits
      );

      // Restricted channel should be completely excluded from results
      const restrictedChannel = availableChannels[TESTNET_PRIVATE_CHANNEL_ID];
      expect(restrictedChannel).toBeUndefined();
    });

    test('should include member counts', async () => {
      const mockChannels = new Map([
        [TESTNET_PUBLIC_CHANNEL_ID, {
          channelId: TESTNET_PUBLIC_CHANNEL_ID,
          clients: new Map([
            ['client1', {}],
            ['client2', {}]
          ])
        }]
      ]);
      const mockWSClients = new Map();
      const mockUserChannelVisits = new Map();

      const availableChannels = await getAvailableChannels(
        'alice.testnet',
        mockChannels,
        mockWSClients,
        mockUserChannelVisits
      );

      const generalChannel = availableChannels[TESTNET_PUBLIC_CHANNEL_ID];
      expect(generalChannel?.memberCount).toBe(2);
    });
  });
});