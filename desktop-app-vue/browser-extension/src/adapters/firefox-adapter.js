/**
 * Firefox Browser Adapter
 * Wraps Firefox-specific APIs for cross-browser compatibility
 */

export const BrowserAdapter = {
  runtime: {
    sendMessage: (...args) => browser.runtime.sendMessage(...args),
    onMessage: browser.runtime.onMessage,
    connect: (...args) => browser.runtime.connect(...args),
    connectNative: (...args) => browser.runtime.connectNative(...args),
    getManifest: () => browser.runtime.getManifest(),
    getURL: (...args) => browser.runtime.getURL(...args),
    lastError: () => browser.runtime.lastError,
  },

  tabs: {
    query: (...args) => browser.tabs.query(...args),
    sendMessage: (...args) => browser.tabs.sendMessage(...args),
    captureVisibleTab: (...args) => browser.tabs.captureVisibleTab(...args),
    create: (...args) => browser.tabs.create(...args),
    update: (...args) => browser.tabs.update(...args),
    remove: (...args) => browser.tabs.remove(...args),
  },

  storage: {
    local: {
      get: (...args) => browser.storage.local.get(...args),
      set: (...args) => browser.storage.local.set(...args),
      remove: (...args) => browser.storage.local.remove(...args),
      clear: () => browser.storage.local.clear(),
    },
    sync: {
      get: (...args) => browser.storage.sync.get(...args),
      set: (...args) => browser.storage.sync.set(...args),
      remove: (...args) => browser.storage.sync.remove(...args),
      clear: () => browser.storage.sync.clear(),
    },
  },

  windows: {
    create: (...args) => browser.windows.create(...args),
    update: (...args) => browser.windows.update(...args),
    remove: (...args) => browser.windows.remove(...args),
    getCurrent: (...args) => browser.windows.getCurrent(...args),
  },

  // Extension-specific features
  action: {
    setIcon: (...args) => browser.action.setIcon(...args),
    setBadgeText: (...args) => browser.action.setBadgeText(...args),
    setBadgeBackgroundColor: (...args) => browser.action.setBadgeBackgroundColor(...args),
  },

  // Browser detection
  getBrowser: () => 'firefox',
  isChrome: () => false,
  isFirefox: () => true,
  isSafari: () => false,
};

// Export default for convenience
export default BrowserAdapter;
