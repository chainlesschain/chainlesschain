/**
 * DevTools "debug" command handlers for the ChainlessChain Browser Bridge.
 *
 * Phase 17 runtime-debugging surface, three sub-areas:
 *  - WebSocket Debugging (CDP Network domain): enable/disable + connection &
 *    message inspection. Keeps per-tab state and a module-level debugger event
 *    listener that records Network.webSocket* frames.
 *  - Service Worker Management (page-context navigator.serviceWorker): list/
 *    getInfo/unregister/update/postMessage.
 *  - Security Info (CDP Security + page context): certificate/security state,
 *    mixed-content check, site permissions.
 *
 * Extracted verbatim from background.js (Phase 1 of the split). Keeps its own
 * module-level state (webSocketState). As a once-imported ES module, the state
 * Map and the onEvent listener registration are singletons for the
 * service-worker lifetime — identical to the original background.js top-level
 * declarations.
 *
 * For security.getCertificate and security.checkMixedContent, background.js had
 * TWO same-name definitions (Phase 17 + Phase 21 Security Analysis); function
 * hoisting made the Phase 21 ones effective for BOTH switch cases. This module
 * carries the effective (Phase 21) bodies.
 *
 * ESM only. chrome.* is referenced lazily inside the handler bodies (except the
 * onEvent listener, which registers at import time exactly as before).
 */

/* eslint-disable no-undef */
/* global chrome, window, WebSocket, Date, navigator, performance, URL, document */

// ---------- WebSocket Debugging ----------

// Store WebSocket debugging state per tab
const webSocketState = new Map();

export async function enableWebSocketDebugging(tabId) {
  try {
    // Check if already attached
    const state = webSocketState.get(tabId);
    if (state?.enabled) {
      return { success: true, message: "Already enabled" };
    }

    await chrome.debugger.attach({ tabId }, "1.3");
    await chrome.debugger.sendCommand({ tabId }, "Network.enable");

    // Initialize state
    webSocketState.set(tabId, {
      enabled: true,
      connections: new Map(),
      messages: new Map(),
    });

    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

export async function disableWebSocketDebugging(tabId) {
  try {
    const state = webSocketState.get(tabId);
    if (state?.enabled) {
      await chrome.debugger.detach({ tabId });
      webSocketState.delete(tabId);
    }
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

export function getWebSocketConnections(tabId) {
  const state = webSocketState.get(tabId);
  if (!state) {
    return { connections: [] };
  }
  return {
    connections: Array.from(state.connections.values()),
  };
}

export function getWebSocketMessages(tabId, connectionId) {
  const state = webSocketState.get(tabId);
  if (!state) {
    return { messages: [] };
  }
  const messages = state.messages.get(connectionId) || [];
  return { messages };
}

export async function sendWebSocketMessage(tabId, connectionId, data) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (connId, payload) => {
        const ws = window.__chainlessWS?.get(connId);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(payload);
          return { success: true };
        }
        return { error: "WebSocket not found or not open" };
      },
      args: [connectionId, data],
    });
    return result[0]?.result || { error: "Failed to send" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function closeWebSocketConnection(tabId, connectionId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (connId) => {
        const ws = window.__chainlessWS?.get(connId);
        if (ws) {
          ws.close();
          return { success: true };
        }
        return { error: "WebSocket not found" };
      },
      args: [connectionId],
    });
    return result[0]?.result || { error: "Failed to close" };
  } catch (error) {
    return { error: error.message };
  }
}

// Listen for WebSocket events via debugger. Guarded so this module can be
// imported outside an extension context (e.g. unit tests) where `chrome` is
// undefined; in the service worker chrome.debugger always exists, so the
// listener registers exactly as the original background.js top-level code did.
if (typeof chrome !== "undefined" && chrome.debugger?.onEvent) {
  chrome.debugger.onEvent.addListener((source, method, params) => {
    const state = webSocketState.get(source.tabId);
    if (!state) return;

    switch (method) {
      case "Network.webSocketCreated":
        state.connections.set(params.requestId, {
          id: params.requestId,
          url: params.url,
          initiator: params.initiator,
          createdAt: Date.now(),
        });
        state.messages.set(params.requestId, []);
        break;

      case "Network.webSocketClosed":
        const conn = state.connections.get(params.requestId);
        if (conn) {
          conn.closedAt = Date.now();
        }
        break;

      case "Network.webSocketFrameSent":
      case "Network.webSocketFrameReceived":
        const messages = state.messages.get(params.requestId);
        if (messages) {
          messages.push({
            type: method === "Network.webSocketFrameSent" ? "sent" : "received",
            data: params.response.payloadData,
            opcode: params.response.opcode,
            timestamp: params.timestamp,
          });
        }
        break;
    }
  });
}

// ---------- Service Worker Management ----------

export async function listServiceWorkers() {
  try {
    const registrations = await chrome.scripting.executeScript({
      target: {
        tabId: (
          await chrome.tabs.query({ active: true, currentWindow: true })
        )[0].id,
      },
      func: async () => {
        const regs = await navigator.serviceWorker.getRegistrations();
        return regs.map((reg) => ({
          scope: reg.scope,
          updateViaCache: reg.updateViaCache,
          installing: reg.installing
            ? {
                state: reg.installing.state,
                scriptURL: reg.installing.scriptURL,
              }
            : null,
          waiting: reg.waiting
            ? { state: reg.waiting.state, scriptURL: reg.waiting.scriptURL }
            : null,
          active: reg.active
            ? { state: reg.active.state, scriptURL: reg.active.scriptURL }
            : null,
        }));
      },
    });
    return { registrations: registrations[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getServiceWorkerInfo(registrationId) {
  try {
    // Use ServiceWorker API via content script
    const result = await chrome.scripting.executeScript({
      target: {
        tabId: (
          await chrome.tabs.query({ active: true, currentWindow: true })
        )[0].id,
      },
      func: async (regId) => {
        const regs = await navigator.serviceWorker.getRegistrations();
        const reg = regs.find((r) => r.scope === regId);
        if (!reg) return { error: "Registration not found" };
        return {
          scope: reg.scope,
          updateViaCache: reg.updateViaCache,
          installing: reg.installing?.state,
          waiting: reg.waiting?.state,
          active: reg.active?.state,
          navigationPreload: await reg.navigationPreload?.getState?.(),
        };
      },
      args: [registrationId],
    });
    return result[0]?.result || { error: "Failed to get info" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function unregisterServiceWorker(tabId, scopeUrl) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (scope) => {
        const regs = await navigator.serviceWorker.getRegistrations();
        const reg = regs.find((r) => r.scope === scope || !scope);
        if (reg) {
          const success = await reg.unregister();
          return { success, scope: reg.scope };
        }
        return { error: "Registration not found" };
      },
      args: [scopeUrl],
    });
    return result[0]?.result || { error: "Failed to unregister" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function updateServiceWorker(tabId, scopeUrl) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (scope) => {
        const regs = await navigator.serviceWorker.getRegistrations();
        const reg = regs.find((r) => r.scope === scope || !scope);
        if (reg) {
          await reg.update();
          return { success: true, scope: reg.scope };
        }
        return { error: "Registration not found" };
      },
      args: [scopeUrl],
    });
    return result[0]?.result || { error: "Failed to update" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function postMessageToServiceWorker(tabId, message) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (msg) => {
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage(msg);
          return { success: true };
        }
        return { error: "No active service worker controller" };
      },
      args: [message],
    });
    return result[0]?.result || { error: "Failed to post message" };
  } catch (error) {
    return { error: error.message };
  }
}

// ---------- Security Info ----------

export async function getCertificateInfo(tabId) {
  try {
    // Note: Chrome extension API doesn't directly expose certificate info
    // We can only get basic security state
    const tab = await chrome.tabs.get(tabId);
    return {
      url: tab.url,
      isSecure: tab.url?.startsWith("https://"),
      // Full certificate info requires different approach
      note: "Full certificate info requires native messaging or debugger API",
    };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getSecurityState(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return {
          protocol: window.location.protocol,
          isSecure: window.isSecureContext,
          ancestorOrigins: [...(window.location.ancestorOrigins || [])],
          origin: window.location.origin,
        };
      },
    });
    return result[0]?.result || { error: "Failed to get security state" };
  } catch (error) {
    return { error: error.message };
  }
}

export async function checkMixedContent(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const isHttps = window.location.protocol === "https:";
        if (!isHttps) return { isHttps: false, mixedContent: [] };

        const mixed = [];

        // Check images
        document.querySelectorAll('img[src^="http:"]').forEach((img) => {
          mixed.push({ type: "image", url: img.src });
        });

        // Check scripts
        document.querySelectorAll('script[src^="http:"]').forEach((script) => {
          mixed.push({ type: "script", url: script.src });
        });

        // Check stylesheets
        document.querySelectorAll('link[href^="http:"]').forEach((link) => {
          if (link.rel === "stylesheet") {
            mixed.push({ type: "stylesheet", url: link.href });
          }
        });

        // Check iframes
        document.querySelectorAll('iframe[src^="http:"]').forEach((iframe) => {
          mixed.push({ type: "iframe", url: iframe.src });
        });

        return { isHttps, mixedContent: mixed };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

export async function getSitePermissions(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const origin = new URL(tab.url).origin;

    const permissions = {};
    const permissionNames = [
      "geolocation",
      "notifications",
      "camera",
      "microphone",
      "clipboard-read",
      "clipboard-write",
      "persistent-storage",
    ];

    for (const name of permissionNames) {
      try {
        const result = await chrome.scripting.executeScript({
          target: { tabId },
          func: async (permName) => {
            try {
              const status = await navigator.permissions.query({
                name: permName,
              });
              return status.state;
            } catch {
              return "unsupported";
            }
          },
          args: [name],
        });
        permissions[name] = result[0]?.result || "unknown";
      } catch {
        permissions[name] = "error";
      }
    }

    return { origin, permissions };
  } catch (error) {
    return { error: error.message };
  }
}

export const devtoolsDebugHandlers = {
  // WebSocket Debugging
  "websocket.enable": ({ tabId }) => enableWebSocketDebugging(tabId),
  "websocket.disable": ({ tabId }) => disableWebSocketDebugging(tabId),
  "websocket.getConnections": ({ tabId }) => getWebSocketConnections(tabId),
  "websocket.getMessages": ({ tabId, connectionId }) =>
    getWebSocketMessages(tabId, connectionId),
  "websocket.send": ({ tabId, connectionId, data }) =>
    sendWebSocketMessage(tabId, connectionId, data),
  "websocket.close": ({ tabId, connectionId }) =>
    closeWebSocketConnection(tabId, connectionId),
  // Service Worker Management
  "serviceWorker.list": () => listServiceWorkers(),
  "serviceWorker.getInfo": ({ registrationId }) =>
    getServiceWorkerInfo(registrationId),
  "serviceWorker.unregister": ({ tabId, scopeUrl }) =>
    unregisterServiceWorker(tabId, scopeUrl),
  "serviceWorker.update": ({ tabId, scopeUrl }) =>
    updateServiceWorker(tabId, scopeUrl),
  "serviceWorker.postMessage": ({ tabId, message }) =>
    postMessageToServiceWorker(tabId, message),
  // Security Info
  "security.getCertificate": ({ tabId }) => getCertificateInfo(tabId),
  "security.getSecurityState": ({ tabId }) => getSecurityState(tabId),
  "security.checkMixedContent": ({ tabId }) => checkMixedContent(tabId),
  "security.getPermissions": ({ tabId }) => getSitePermissions(tabId),
};
