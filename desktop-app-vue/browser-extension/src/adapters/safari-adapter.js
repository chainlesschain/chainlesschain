/**
 * Safari Browser Adapter
 * Wraps Safari-specific APIs for cross-browser compatibility
 *
 * Note: Safari doesn't support Native Messaging
 * We use direct HTTP API calls instead
 */

export const BrowserAdapter = {
  runtime: {
    sendMessage: (...args) => {
      // Safari uses browser.runtime like Firefox
      if (typeof browser !== 'undefined' && browser.runtime) {
        return browser.runtime.sendMessage(...args);
      }
      // Fallback to direct HTTP API
      return Promise.reject(new Error('Not implemented in Safari'));
    },
    onMessage: (typeof browser !== 'undefined' && browser.runtime) ? browser.runtime.onMessage : null,
    connect: null, // Not supported
    connectNative: null, // Not supported in Safari
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
  getBrowser: () => 'safari',
  isChrome: () => false,
  isFirefox: () => false,
  isSafari: () => true,
};

// Export default for convenience
export default BrowserAdapter;
