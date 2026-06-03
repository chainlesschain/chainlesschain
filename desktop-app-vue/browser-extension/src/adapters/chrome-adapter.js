/**
 * Chrome/Edge Browser Adapter
 * Wraps Chrome-specific APIs for cross-browser compatibility
 */

export const BrowserAdapter = {
  runtime: {
    sendMessage: (...args) => chrome.runtime.sendMessage(...args),
    onMessage: chrome.runtime.onMessage,
    connect: (...args) => chrome.runtime.connect(...args),
    connectNative: (...args) => chrome.runtime.connectNative(...args),
    getManifest: () => chrome.runtime.getManifest(),
    getURL: (...args) => chrome.runtime.getURL(...args),
    lastError: () => chrome.runtime.lastError,
  },

  tabs: {
    query: (...args) => chrome.tabs.query(...args),
    sendMessage: (...args) => chrome.tabs.sendMessage(...args),
    captureVisibleTab: (...args) => chrome.tabs.captureVisibleTab(...args),
    create: (...args) => chrome.tabs.create(...args),
    update: (...args) => chrome.tabs.update(...args),
    remove: (...args) => chrome.tabs.remove(...args),
  },

  storage: {
    local: {
      get: (...args) => chrome.storage.local.get(...args),
      set: (...args) => chrome.storage.local.set(...args),
      remove: (...args) => chrome.storage.local.remove(...args),
      clear: () => chrome.storage.local.clear(),
    },
    sync: {
      get: (...args) => chrome.storage.sync.get(...args),
      set: (...args) => chrome.storage.sync.set(...args),
      remove: (...args) => chrome.storage.sync.remove(...args),
      clear: () => chrome.storage.sync.clear(),
    },
  },

  windows: {
    create: (...args) => chrome.windows.create(...args),
    update: (...args) => chrome.windows.update(...args),
    remove: (...args) => chrome.windows.remove(...args),
    getCurrent: (...args) => chrome.windows.getCurrent(...args),
  },

  // Extension-specific features
  action: {
    setIcon: (...args) => chrome.action.setIcon(...args),
    setBadgeText: (...args) => chrome.action.setBadgeText(...args),
    setBadgeBackgroundColor: (...args) => chrome.action.setBadgeBackgroundColor(...args),
  },

  // Browser detection
  getBrowser: () => 'chrome',
  isChrome: () => true,
  isFirefox: () => false,
  isSafari: () => false,
};

// Export default for convenience
export default BrowserAdapter;
