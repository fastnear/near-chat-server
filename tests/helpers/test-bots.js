// Test bot configurations and helpers
export const TEST_BOT_CONFIGS = {
  'tip-bot': {
    name: 'Test Tip Bot',
    displayName: '@tipbot',
    accountId: 'tipbot.testnet',
    privateKey: 'ed25519:3D4YudUQRE39Lc4JHghuB5WM8kufTqeKueARN8jMRMpr5Bds9zFz5QhgfzNjASGMtvgWd3MwjMKVZFzZnQ8fCQXv',
    channels: ['general', 'test'],
    filters: {
      commands: ['/tip'],
      mentions: ['@tipbot']
    },
    enabled: true,
    allowedRequestSignedIntent: true,
    allowedServerEvents: ['tip_status_update', 'storage_required']
  },
  'gpt-bot': {
    name: 'Test GPT Bot',
    displayName: '@ai',
    accountId: 'ai.testnet',
    privateKey: 'ed25519:2KkJYD3c7gS6b1L5M4E6v8F9nV2w7qT5hG8jN3mP6R1xS4aB7cE9fH2kL5mP8qT3v6Y9zA1cF4gJ7kM6qT8vB1x',
    channels: ['general'],
    filters: {
      commands: ['/ask'],
      mentions: ['@ai']
    },
    enabled: true,
    allowedRequestSignedIntent: false,
    allowedServerEvents: ['channel_activity']
  },
  'test-bot': {
    name: 'Generic Test Bot',
    displayName: '@testbot',
    accountId: 'testbot.testnet',
    privateKey: 'ed25519:5M8nP1qR4tU7wZ0aB3cF6gJ9kL2mP5qT8vY1zA4cG7jM9nQ2rU5wZ8aB1cF4gJ7k',
    channels: ['test'],
    filters: {
      commands: ['/test'],
      mentions: ['@testbot']
    },
    enabled: true,
    allowedRequestSignedIntent: false,
    allowedServerEvents: []
  }
};

export const TEST_USER_CONFIGS = {
  'alice': {
    accountId: 'alice.testnet',
    privateKey: 'ed25519:4G7jK0mP3qS6vY9zA2cE5hJ8kN1qT4wZ7aB4gH7kM0pS3vY6zA9cF2hJ5mP8qT1v'
  },
  'bob': {
    accountId: 'bob.testnet',
    privateKey: 'ed25519:1A4cF7gJ0kM3pS6vY9zA2eH5jK8nQ1tW4zB7eH0kM3pS6vY9zA2cF5hJ8kN1qT4w'
  },
  'charlie': {
    accountId: 'charlie.testnet',
    privateKey: 'ed25519:7B0eH3kM6pS9vY2zA5cF8gJ1kN4qT7wZ0aB3eH6kM9pS2vY5zA8cF1hJ4kN7qT0w'
  }
};

export const TEST_SERVER_CONFIG = {
  accountId: 'server.testnet',
  privateKey: 'ed25519:9C2eH5kM8pS1vY4zA7cF0gJ3kN6qT9wZ2aB5eH8kM1pS4vY7zA0cF3hJ6kN9qT2w'
};

// Helper to create test channels config
export function createTestChannelsConfig() {
  return {
    'testnet-public-channel': {
      name: 'Public Testnet',
      description: 'Public chat for Testnet',
      adminUsers: ['alice.testnet'],
      defaultToken: 'wrap.testnet',
      tokenSymbol: 'wNEAR',
      isPublic: true,
      rules: [
        {
          type: 'allowAll'
        }
      ]
    },
    'testnet-private-channel': {
      name: 'Private Testnet',
      description: 'Private chat for Testnet',
      adminUsers: ['alice.testnet'],
      isPublic: false,
      rules: [
        {
          type: 'requireAccount',
          accounts: ['private.testnet', 'alice.testnet']
        }
      ]
    },
    'general': {
      name: 'General',
      description: 'General discussion',
      adminUsers: ['alice.testnet'],
      defaultToken: 'wrap.testnet',
      tokenSymbol: 'wNEAR',
      isPublic: true,
      rules: [
        {
          type: 'allowAll'
        }
      ]
    }
  };
}

// Helper to create test bots config
export function createTestBotsConfig() {
  return TEST_BOT_CONFIGS;
}

// Helper to get test private keys by account type
export function getTestPrivateKey(accountType, accountName = null) {
  if (accountType === 'bot') {
    return TEST_BOT_CONFIGS[accountName]?.privateKey;
  } else if (accountType === 'user') {
    return TEST_USER_CONFIGS[accountName]?.privateKey;
  } else if (accountType === 'server') {
    return TEST_SERVER_CONFIG.privateKey;
  }
  throw new Error(`Unknown account type: ${accountType}`);
}

// Helper to get test account ID
export function getTestAccountId(accountType, accountName = null) {
  if (accountType === 'bot') {
    return TEST_BOT_CONFIGS[accountName]?.accountId;
  } else if (accountType === 'user') {
    return TEST_USER_CONFIGS[accountName]?.accountId;
  } else if (accountType === 'server') {
    return TEST_SERVER_CONFIG.accountId;
  }
  throw new Error(`Unknown account type: ${accountType}`);
}