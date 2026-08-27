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
 * Capture and response-mock state is bounded by count and UTF-8 bytes. Active
 * tabs own removable debugger listeners; completed capture metadata is retained
 * only within the registry limits and local to the service-worker lifetime.
 *
 * The `Network.*` debugger-event constants (Network.requestWillBeSent etc.) live
 * inside the handler bodies as CDP event names; the separate `Network.webSocket*`
 * switch arms in background.js belong to the WebSocket-debugging handler, not here.
 *
 * ESM only. chrome.* is referenced lazily inside the handler bodies.
 */

/* eslint-disable no-undef */
/* global chrome, performance, navigator, window, btoa, TextEncoder, Date */

import { ensureDebuggerAttached } from "./_shared.js";
import {
  NetworkCaptureRegistry,
  NetworkMockRegistry,
  prepareMockResponse,
  sanitizeNetworkRequest,
  sanitizeNetworkResponse,
  validateBlockingPatterns,
} from "./network-boundary.js";

// ---------- Interception state (per-tab) ----------

const networkCaptures = new NetworkCaptureRegistry();
const networkMocks = new NetworkMockRegistry();
const requestBlockingPatterns = [];

function removeDebuggerListeners(resources) {
  if (!resources) {
    return;
  }
  try {
    chrome.debugger.onEvent.removeListener(resources.eventListener);
  } catch {
    // The event target may already be gone after a tab closes.
  }
  try {
    chrome.debugger.onDetach.removeListener(resources.detachListener);
  } catch {
    // The event target may already be gone after a tab closes.
  }
}

async function attachDebugger(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    return true;
  } catch (error) {
    if (error.message?.includes("already attached")) {
      return false;
    }
    throw error;
  }
}

async function detachDebugger(tabId) {
  try {
    await chrome.debugger.detach({ tabId });
    return null;
  } catch (error) {
    return error;
  }
}

function transferDebuggerOwnership(fromResources, toControl) {
  if (!fromResources?.ownsDebugger || !toControl?.resources) {
    return false;
  }
  fromResources.ownsDebugger = false;
  toControl.resources.ownsDebugger = true;
  return true;
}

export async function enableNetworkInterception(tabId, _patterns = []) {
  const admission = networkCaptures.admit(tabId);
  if (!admission.accepted) {
    return admission;
  }

  let resources = null;
  let ownsDebugger = false;
  const eventListener = (source, method, params) => {
    if (source?.tabId !== tabId) {
      return;
    }
    if (method === "Network.requestWillBeSent") {
      networkCaptures.recordRequest(
        admission.lease,
        sanitizeNetworkRequest(params),
      );
    } else if (method === "Network.responseReceived") {
      networkCaptures.recordResponse(
        admission.lease,
        sanitizeNetworkResponse(params),
      );
    }
  };
  const detachListener = (source) => {
    if (source?.tabId !== tabId) {
      return;
    }
    removeDebuggerListeners(resources);
    networkCaptures.complete(admission.lease);
  };

  try {
    ownsDebugger = await attachDebugger(tabId);
    resources = { eventListener, detachListener, ownsDebugger };
    chrome.debugger.onEvent.addListener(eventListener);
    chrome.debugger.onDetach.addListener(detachListener);
    networkCaptures.bindResources(admission.lease, resources);
    await chrome.debugger.sendCommand({ tabId }, "Network.enable");
    if (!networkCaptures.markActive(admission.lease)) {
      throw new Error("Network capture detached before startup completed");
    }
    return { success: true, limits: networkCaptures.getRequests(tabId).limits };
  } catch (error) {
    removeDebuggerListeners(resources);
    if (ownsDebugger) {
      await detachDebugger(tabId);
    }
    networkCaptures.failStart(admission.lease);
    return { error: error.message };
  }
}

export async function disableNetworkInterception(tabId) {
  const stopAdmission = networkCaptures.beginStop(tabId);
  if (!stopAdmission.accepted) {
    if (stopAdmission.code === "NETWORK_CAPTURE_NOT_FOUND") {
      return { success: true };
    }
    return stopAdmission;
  }

  const { capture } = stopAdmission;
  let commandError = null;
  if (capture.resources?.ownsDebugger) {
    try {
      await chrome.debugger.sendCommand({ tabId }, "Network.disable");
    } catch (error) {
      commandError = error;
    }
  }
  const ownershipTransferred = transferDebuggerOwnership(
    capture.resources,
    networkMocks.getControl(tabId),
  );
  let detachError = null;
  if (capture.resources?.ownsDebugger && !ownershipTransferred) {
    detachError = await detachDebugger(tabId);
  }
  removeDebuggerListeners(capture.resources);
  networkCaptures.complete(capture.lease);

  if (commandError || detachError) {
    return { error: (commandError || detachError).message };
  }
  return { success: true };
}

export async function setRequestBlocking(patterns) {
  const validation = validateBlockingPatterns(patterns);
  if (!validation.accepted) {
    return validation;
  }

  // Update declarativeNetRequest rules
  const rules = validation.patterns.map((pattern, index) => ({
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
    requestBlockingPatterns.length = 0;
    requestBlockingPatterns.push(...validation.patterns);
    return {
      success: true,
      blockedPatterns: [...requestBlockingPatterns],
      retainedBytes: validation.totalBytes,
    };
  } catch (error) {
    return { error: error.message };
  }
}

export async function clearRequestBlocking() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: Array.from({ length: 100 }, (_, i) => i + 1),
    });
    requestBlockingPatterns.length = 0;
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getNetworkRequests(tabId) {
  return networkCaptures.getRequests(tabId);
}

export async function mockNetworkResponse(tabId, urlPattern, response) {
  const prepared = prepareMockResponse(urlPattern, response);
  if (!prepared.accepted) {
    return prepared;
  }
  const admission = networkMocks.admit(tabId, prepared.mock);
  if (!admission.accepted) {
    return admission;
  }

  let resources = networkMocks.getControl(tabId)?.resources || null;
  let ownsDebugger = false;
  if (admission.created) {
    const eventListener = (source, method, params) => {
      if (source?.tabId !== tabId || method !== "Fetch.requestPaused") {
        return;
      }
      const mock = networkMocks.getMatch(tabId, params.request?.url);
      try {
        const command = mock
          ? chrome.debugger.sendCommand({ tabId }, "Fetch.fulfillRequest", {
              requestId: params.requestId,
              responseCode: mock.status,
              responseHeaders: mock.headers,
              body: encodeUtf8Base64(mock.bodyJson),
            })
          : chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", {
              requestId: params.requestId,
            });
        Promise.resolve(command).catch(() => {
          // The paused request disappeared with its tab/debugger session.
        });
      } catch {
        // Invalidated debugger requests cannot be continued after detachment.
      }
    };
    const detachListener = (source) => {
      if (source?.tabId !== tabId) {
        return;
      }
      removeDebuggerListeners(resources);
      networkMocks.clear(tabId);
    };

    try {
      ownsDebugger = await attachDebugger(tabId);
      resources = { eventListener, detachListener, ownsDebugger };
      chrome.debugger.onEvent.addListener(eventListener);
      chrome.debugger.onDetach.addListener(detachListener);
      networkMocks.bindResources(admission.lease, resources);
    } catch (error) {
      networkMocks.rollback(admission.rollback);
      return { error: error.message };
    }
  }

  try {
    await chrome.debugger.sendCommand({ tabId }, "Fetch.enable", {
      patterns: admission.patterns.map((pattern) => ({ urlPattern: pattern })),
    });
    networkMocks.markActive(admission.lease);
    return { success: true, limits: networkMocks.limits };
  } catch (error) {
    networkMocks.rollback(admission.rollback);
    if (admission.created) {
      removeDebuggerListeners(resources);
      if (ownsDebugger) {
        await detachDebugger(tabId);
      }
    }
    return { error: error.message };
  }
}

function encodeUtf8Base64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 8192;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

export async function clearMockNetworkResponses(tabId) {
  const control = networkMocks.getControl(tabId);
  if (!control) {
    return { success: true };
  }

  let commandError = null;
  try {
    await chrome.debugger.sendCommand({ tabId }, "Fetch.disable");
  } catch (error) {
    commandError = error;
  }
  if (commandError) {
    return { error: commandError.message };
  }
  const ownershipTransferred = transferDebuggerOwnership(
    control.resources,
    networkCaptures.getControl(tabId),
  );
  let detachError = null;
  if (control.resources?.ownsDebugger && !ownershipTransferred) {
    detachError = await detachDebugger(tabId);
  }
  removeDebuggerListeners(control.resources);
  networkMocks.clear(tabId);

  if (detachError) {
    return { error: detachError.message };
  }
  return { success: true };
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
  "network.clearMocks": ({ tabId }) => clearMockNetworkResponses(tabId),
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
