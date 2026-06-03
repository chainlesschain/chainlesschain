/**
 * Network command handlers for the ChainlessChain Browser Bridge.
 *
 * Unifies four network-related areas that were scattered across background.js:
 *  - Interception (CDP Network/Fetch + declarativeNetRequest): enable/disable,
 *    request blocking, captured-request log, response mocking
 *  - Throttling (CDP Network.emulateNetworkConditions): set/clear throttling,
 *    profiles, offline mode
 *  - Timing (page-context Performance API): timing, waterfall, analyze
 *  - Network Information API (page-context navigator.connection): get, onChange
 *
 * Extracted verbatim from background.js (Phase 1 of the split). This is the first
 * handler module with its own module-level state (the interception Maps below)
 * and the first to depend on the shared CDP helper. As an ES module that is
 * imported once, the module-level state is a singleton for the service-worker
 * lifetime — identical semantics to the original background.js top-level consts.
 *
 * The `Network.*` debugger-event constants (Network.requestWillBeSent etc.) live
 * inside the handler bodies as CDP event names; the separate `Network.webSocket*`
 * switch arms in background.js belong to the WebSocket-debugging handler, not here.
 *
 * ESM only. chrome.* is referenced lazily inside the handler bodies.
 */

/* eslint-disable no-undef */
/* global chrome, performance, navigator, window, btoa, Date */

import { ensureDebuggerAttached } from "./_shared.js";

// ---------- Interception state (per-tab) ----------

// Network request storage per tab
const networkRequests = new Map();
const networkInterceptionEnabled = new Map();
const requestBlockingPatterns = [];
const mockResponses = new Map();

export async function enableNetworkInterception(tabId, _patterns = []) {
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    await chrome.debugger.sendCommand({ tabId }, "Network.enable");

    networkInterceptionEnabled.set(tabId, true);
    networkRequests.set(tabId, []);

    // Listen for network events
    chrome.debugger.onEvent.addListener((source, method, params) => {
      if (source.tabId !== tabId) {
        return;
      }

      const requests = networkRequests.get(tabId) || [];

      if (method === "Network.requestWillBeSent") {
        requests.push({
          id: params.requestId,
          url: params.request.url,
          method: params.request.method,
          headers: params.request.headers,
          timestamp: params.timestamp,
          type: params.type,
        });
        networkRequests.set(tabId, requests.slice(-500)); // Keep last 500
      }

      if (method === "Network.responseReceived") {
        const req = requests.find((r) => r.id === params.requestId);
        if (req) {
          req.status = params.response.status;
          req.statusText = params.response.statusText;
          req.responseHeaders = params.response.headers;
          req.mimeType = params.response.mimeType;
        }
      }
    });

    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

export async function disableNetworkInterception(tabId) {
  try {
    if (networkInterceptionEnabled.get(tabId)) {
      await chrome.debugger.sendCommand({ tabId }, "Network.disable");
      await chrome.debugger.detach({ tabId });
      networkInterceptionEnabled.delete(tabId);
    }
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

export async function setRequestBlocking(patterns) {
  requestBlockingPatterns.length = 0;
  requestBlockingPatterns.push(...patterns);

  // Update declarativeNetRequest rules
  const rules = patterns.map((pattern, index) => ({
    id: index + 1,
    priority: 1,
    action: { type: "block" },
    condition: {
      urlFilter: pattern,
      resourceTypes: [
        "main_frame",
        "sub_frame",
        "script",
        "stylesheet",
        "image",
        "xmlhttprequest",
      ],
    },
  }));

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: Array.from({ length: 100 }, (_, i) => i + 1),
      addRules: rules,
    });
    return { success: true, blockedPatterns: patterns };
  } catch (error) {
    return { error: error.message };
  }
}

export async function clearRequestBlocking() {
  requestBlockingPatterns.length = 0;
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: Array.from({ length: 100 }, (_, i) => i + 1),
    });
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getNetworkRequests(tabId) {
  return { requests: networkRequests.get(tabId) || [] };
}

export async function mockNetworkResponse(tabId, urlPattern, response) {
  mockResponses.set(urlPattern, response);

  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    await chrome.debugger.sendCommand({ tabId }, "Fetch.enable", {
      patterns: [{ urlPattern }],
    });

    chrome.debugger.onEvent.addListener(async (source, method, params) => {
      if (source.tabId !== tabId || method !== "Fetch.requestPaused") {
        return;
      }

      const mockResp = mockResponses.get(urlPattern);
      if (mockResp && params.request.url.includes(urlPattern)) {
        await chrome.debugger.sendCommand({ tabId }, "Fetch.fulfillRequest", {
          requestId: params.requestId,
          responseCode: mockResp.status || 200,
          responseHeaders: Object.entries(mockResp.headers || {}).map(
            ([name, value]) => ({ name, value }),
          ),
          body: btoa(JSON.stringify(mockResp.body || {})),
        });
      } else {
        await chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", {
          requestId: params.requestId,
        });
      }
    });

    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

// ---------- Throttling (CDP) ----------

const THROTTLING_PROFILES = {
  "slow-3g": {
    downloadThroughput: 50000, // 50 KB/s
    uploadThroughput: 25000, // 25 KB/s
    latency: 2000, // 2000ms
  },
  "fast-3g": {
    downloadThroughput: 187500, // 1.5 Mbps
    uploadThroughput: 93750, // 750 Kbps
    latency: 562, // 562ms
  },
  "slow-4g": {
    downloadThroughput: 500000, // 4 Mbps
    uploadThroughput: 375000, // 3 Mbps
    latency: 170, // 170ms
  },
  "fast-4g": {
    downloadThroughput: 4000000, // 32 Mbps
    uploadThroughput: 1500000, // 12 Mbps
    latency: 50, // 50ms
  },
  wifi: {
    downloadThroughput: 3750000, // 30 Mbps
    uploadThroughput: 1500000, // 12 Mbps
    latency: 2, // 2ms
  },
};

export async function setNetworkThrottling(tabId, conditions) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Network.enable");

    // If conditions is a string, look up profile
    const profile =
      typeof conditions === "string"
        ? THROTTLING_PROFILES[conditions]
        : conditions;

    if (!profile) {
      return { error: `Unknown throttling profile: ${conditions}` };
    }

    await chrome.debugger.sendCommand(
      { tabId },
      "Network.emulateNetworkConditions",
      {
        offline: false,
        downloadThroughput: profile.downloadThroughput,
        uploadThroughput: profile.uploadThroughput,
        latency: profile.latency,
      },
    );

    return { success: true, profile: conditions };
  } catch (error) {
    return { error: error.message };
  }
}

export async function clearNetworkThrottling(tabId) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand(
      { tabId },
      "Network.emulateNetworkConditions",
      {
        offline: false,
        downloadThroughput: -1,
        uploadThroughput: -1,
        latency: 0,
      },
    );
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

export function getThrottlingProfiles() {
  return {
    profiles: Object.keys(THROTTLING_PROFILES).map((name) => ({
      name,
      ...THROTTLING_PROFILES[name],
    })),
  };
}

export async function setOfflineMode(tabId, offline) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Network.enable");
    await chrome.debugger.sendCommand(
      { tabId },
      "Network.emulateNetworkConditions",
      {
        offline: offline,
        downloadThroughput: -1,
        uploadThroughput: -1,
        latency: 0,
      },
    );
    return { success: true, offline };
  } catch (error) {
    return { error: error.message };
  }
}

// ---------- Timing (page-context Performance API) ----------

export async function getNetworkTiming(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const resources = performance.getEntriesByType("resource");
        const nav = performance.getEntriesByType("navigation")[0];

        const byType = {};
        resources.forEach((r) => {
          if (!byType[r.initiatorType]) {
            byType[r.initiatorType] = {
              count: 0,
              totalDuration: 0,
              totalSize: 0,
            };
          }
          byType[r.initiatorType].count++;
          byType[r.initiatorType].totalDuration += r.duration;
          byType[r.initiatorType].totalSize += r.transferSize || 0;
        });

        return {
          navigation: nav
            ? {
                dns: Math.round(nav.domainLookupEnd - nav.domainLookupStart),
                tcp: Math.round(nav.connectEnd - nav.connectStart),
                ssl: Math.round(
                  nav.secureConnectionStart > 0
                    ? nav.connectEnd - nav.secureConnectionStart
                    : 0,
                ),
                ttfb: Math.round(nav.responseStart - nav.requestStart),
                download: Math.round(nav.responseEnd - nav.responseStart),
              }
            : null,
          resourcesByType: byType,
          totalResources: resources.length,
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export async function getNetworkWaterfall(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const resources = performance.getEntriesByType("resource");

        return resources.slice(0, 50).map((r) => ({
          name: r.name.split("/").pop()?.slice(0, 30) || r.name.slice(0, 30),
          type: r.initiatorType,
          start: Math.round(r.startTime),
          dns: Math.round(r.domainLookupEnd - r.domainLookupStart),
          tcp: Math.round(r.connectEnd - r.connectStart),
          ssl: Math.round(
            r.secureConnectionStart > 0
              ? r.connectEnd - r.secureConnectionStart
              : 0,
          ),
          request: Math.round(r.responseStart - r.requestStart),
          response: Math.round(r.responseEnd - r.responseStart),
          total: Math.round(r.duration),
          size: r.transferSize,
        }));
      },
    });
    return { waterfall: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

export async function analyzeNetworkRequests(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const resources = performance.getEntriesByType("resource");

        // Analyze
        const analysis = {
          total: resources.length,
          totalSize: resources.reduce(
            (sum, r) => sum + (r.transferSize || 0),
            0,
          ),
          totalDuration: Math.round(
            Math.max(...resources.map((r) => r.startTime + r.duration)),
          ),
          byType: {},
          slowest: [],
          largest: [],
        };

        // Group by type
        resources.forEach((r) => {
          if (!analysis.byType[r.initiatorType]) {
            analysis.byType[r.initiatorType] = { count: 0, size: 0 };
          }
          analysis.byType[r.initiatorType].count++;
          analysis.byType[r.initiatorType].size += r.transferSize || 0;
        });

        // Find slowest
        analysis.slowest = [...resources]
          .sort((a, b) => b.duration - a.duration)
          .slice(0, 5)
          .map((r) => ({
            name: r.name.split("/").pop()?.slice(0, 30),
            duration: Math.round(r.duration),
            type: r.initiatorType,
          }));

        // Find largest
        analysis.largest = [...resources]
          .sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0))
          .slice(0, 5)
          .map((r) => ({
            name: r.name.split("/").pop()?.slice(0, 30),
            size: r.transferSize,
            type: r.initiatorType,
          }));

        return analysis;
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ---------- Network Information API (page-context) ----------

export async function getNetworkInformation(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const connection =
          navigator.connection ||
          navigator.mozConnection ||
          navigator.webkitConnection;
        if (!connection) {
          return { error: "Network Information API not supported" };
        }
        return {
          effectiveType: connection.effectiveType,
          downlink: connection.downlink,
          rtt: connection.rtt,
          saveData: connection.saveData,
          type: connection.type,
          downlinkMax: connection.downlinkMax,
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export async function onNetworkChange(tabId, enable) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (en) => {
        const connection =
          navigator.connection ||
          navigator.mozConnection ||
          navigator.webkitConnection;
        if (!connection) {
          return { error: "Network Information API not supported" };
        }

        if (en) {
          window.__networkChangeHandler = () => {
            window.__lastNetworkChange = {
              effectiveType: connection.effectiveType,
              downlink: connection.downlink,
              rtt: connection.rtt,
              timestamp: Date.now(),
            };
          };
          connection.addEventListener("change", window.__networkChangeHandler);
          return { success: true, monitoring: true };
        } else {
          if (window.__networkChangeHandler) {
            connection.removeEventListener(
              "change",
              window.__networkChangeHandler,
            );
            window.__networkChangeHandler = null;
          }
          return { success: true, monitoring: false };
        }
      },
      args: [enable],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export const networkHandlers = {
  // Interception
  "network.enableInterception": ({ tabId, patterns }) =>
    enableNetworkInterception(tabId, patterns),
  "network.disableInterception": ({ tabId }) =>
    disableNetworkInterception(tabId),
  "network.setRequestBlocking": ({ patterns }) => setRequestBlocking(patterns),
  "network.clearRequestBlocking": () => clearRequestBlocking(),
  "network.getRequests": ({ tabId }) => getNetworkRequests(tabId),
  "network.mockResponse": ({ tabId, url, response }) =>
    mockNetworkResponse(tabId, url, response),
  // Throttling
  "network.setThrottling": ({ tabId, conditions }) =>
    setNetworkThrottling(tabId, conditions),
  "network.clearThrottling": ({ tabId }) => clearNetworkThrottling(tabId),
  "network.getThrottlingProfiles": () => getThrottlingProfiles(),
  "network.setOffline": ({ tabId, offline }) => setOfflineMode(tabId, offline),
  // Timing
  "network.getTiming": ({ tabId }) => getNetworkTiming(tabId),
  "network.getWaterfall": ({ tabId }) => getNetworkWaterfall(tabId),
  "network.analyzeRequests": ({ tabId }) => analyzeNetworkRequests(tabId),
  // Network Information API
  "networkInfo.get": ({ tabId }) => getNetworkInformation(tabId),
  "networkInfo.onChange": ({ tabId, enable }) => onNetworkChange(tabId, enable),
};
