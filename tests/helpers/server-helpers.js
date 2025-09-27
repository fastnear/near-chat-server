import fs from 'fs';
import path from 'path';
import { createTestChannelsConfig, createTestBotsConfig } from './test-bots.js';

// Helper to create test environment files
export function setupTestEnvironment() {
  const testResPath = 'test-res';

  // Create test resource directory
  if (!fs.existsSync(testResPath)) {
    fs.mkdirSync(testResPath, { recursive: true });
  }

  // Create test configs
  const channelsConfig = createTestChannelsConfig();
  const botsConfig = createTestBotsConfig();

  fs.writeFileSync(
    path.join(testResPath, 'channels-config.json'),
    JSON.stringify(channelsConfig, null, 2)
  );

  fs.writeFileSync(
    path.join(testResPath, 'bots-config.json'),
    JSON.stringify(botsConfig, null, 2)
  );

  return {
    testResPath,
    channelsConfig,
    botsConfig
  };
}

// Helper to clean up test environment
export async function cleanupTestEnvironment() {
  const testResPath = 'test-res';

  // Reset ConfigManager state
  try {
    const { configManager } = await import('../../shared/config-manager.js');
    configManager.channelsConfig = {};
    configManager.botsConfig = {};
    configManager.lastLoadTime = 0; // Force reload on next access
    configManager.configSource = 'file'; // Ensure file-only mode
  } catch (error) {
    // ConfigManager might not be loaded yet
  }

  // Remove test resource directory
  if (fs.existsSync(testResPath)) {
    fs.rmSync(testResPath, { recursive: true, force: true });
  }

  // Test bot config is removed with test-res directory
}

// Helper to wait for async operations
export async function waitFor(condition, timeout = 5000, interval = 100) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (await condition()) {
      return true;
    }
    await sleep(interval);
  }

  throw new Error(`Condition not met within ${timeout}ms`);
}

// Helper to sleep
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper to create mock fetch for external API calls
export function createMockFetch() {
  const mockResponses = new Map();
  let callCount = 0;
  const calls = [];

  const mockFetch = async (url, options) => {
    callCount++;
    const call = { url, options };
    calls.push(call);

    const key = `${options?.method || 'GET'} ${url}`;
    const mockResponse = mockResponses.get(key);

    if (!mockResponse) {
      throw new Error(`No mock response defined for: ${key}`);
    }

    return {
      ok: mockResponse.ok !== false,
      status: mockResponse.status || 200,
      json: async () => mockResponse.data || {},
      text: async () => JSON.stringify(mockResponse.data || {})
    };
  };

  // Helper to set mock responses
  mockFetch.mockResponse = (method, url, response) => {
    const key = `${method} ${url}`;
    mockResponses.set(key, response);
  };

  // Helper to clear all mocks
  mockFetch.clearMocks = () => {
    mockResponses.clear();
    calls.length = 0;
    callCount = 0;
  };

  // Jest-like properties
  mockFetch.mock = {
    calls: calls,
    callCount: () => callCount
  };

  return mockFetch;
}

// Mock NEAR RPC responses
export function mockNearRpcResponses(mockFetch) {
  // Mock access key query
  mockFetch.mockResponse('POST', 'https://rpc.mainnet.fastnear.com', {
    ok: true,
    data: {
      result: {
        keys: [{
          access_key: {
            permission: 'FullAccess'
          }
        }]
      }
    }
  });

  // Mock account query
  mockFetch.mockResponse('POST', 'https://rpc.testnet.near.org/account', {
    ok: true,
    data: {
      result: {
        amount: '1000000000000000000000000',
        storage_usage: 1000
      }
    }
  });
}

// Helper to simulate WebSocket server behavior
export class TestWebSocketServer {
  constructor() {
    this.clients = new Map();
    this.messageHandlers = new Map();
  }

  addClient(ws, clientData) {
    this.clients.set(ws, clientData);
  }

  removeClient(ws) {
    this.clients.delete(ws);
  }

  broadcast(message) {
    for (const [ws, clientData] of this.clients) {
      if (ws.connected) {
        ws.receive(message);
      }
    }
  }

  broadcastToChannel(channelId, message) {
    for (const [ws, clientData] of this.clients) {
      if (ws.connected && clientData.channels.has(channelId)) {
        ws.receive(message);
      }
    }
  }

  sendToClient(accountId, message) {
    for (const [ws, clientData] of this.clients) {
      if (ws.connected && clientData.accountId === accountId) {
        ws.receive(message);
        break;
      }
    }
  }

  getConnectedClients() {
    return Array.from(this.clients.entries())
      .filter(([ws]) => ws.connected)
      .map(([ws, clientData]) => clientData);
  }

  getClientsInChannel(channelId) {
    return Array.from(this.clients.entries())
      .filter(([ws, clientData]) => ws.connected && clientData.channels.has(channelId))
      .map(([ws, clientData]) => clientData);
  }
}