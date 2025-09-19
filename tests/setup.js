// Global test setup
import * as dotenv from 'dotenv';

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Set test-specific environment variables
process.env.NODE_ENV = 'test';
process.env.WS_PORT = '7072'; // Different port for tests
process.env.RES_PATH = 'test-res';
process.env.MAX_MESSAGE_DELAY_MS = '1000';

// Global test utilities
global.sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));