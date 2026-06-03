/**
 * Jest Setup File
 * Global test configuration and mocks
 */

// Mock Chrome API
global.chrome = {
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },
    connect: jest.fn(),
    connectNative: jest.fn(),
    getManifest: jest.fn(() => ({ version: '2.0.0' })),
    getURL: jest.fn((path) => `chrome-extension://test/${path}`),
    lastError: null
  },
  tabs: {
    query: jest.fn(),
    sendMessage: jest.fn(),
    captureVisibleTab: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn()
  },
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
      clear: jest.fn()
    },
    sync: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
      clear: jest.fn()
    }
  },
  windows: {
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    getCurrent: jest.fn()
  },
  action: {
    setIcon: jest.fn(),
    setBadgeText: jest.fn(),
    setBadgeBackgroundColor: jest.fn()
  }
};

// Mock fetch API
global.fetch = jest.fn();

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  error: jest.fn(),
  warn: jest.fn(),
  log: jest.fn()
};

// Reset mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});
