/**
 * ChainlessChain Browser Bridge - Background Service Worker
 *
 * Provides WebSocket connection to ChainlessChain Desktop app and handles
 * browser automation commands.
 */

/* eslint-disable no-undef */
/* global chrome */

// Connection state
let ws = null;
let connected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 3000;
const WS_URL = "ws://127.0.0.1:18790";

// Request tracking
let _requestId = 0;
const pendingRequests = new Map();

// Stats
const stats = {
  connectTime: null,
  messagesSent: 0,
  messagesReceived: 0,
  commandsExecuted: 0,
};

/**
 * Initialize extension
 */
chrome.runtime.onInstalled.addListener(() => {
  console.log("[ChainlessChain] Extension installed");
  // Try to connect on install
  connect();
});

/**
 * Handle extension startup
 */
chrome.runtime.onStartup.addListener(() => {
  console.log("[ChainlessChain] Extension started");
  connect();
});

/**
 * Connect to ChainlessChain Desktop
 */
function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log("[ChainlessChain] Already connected");
    return;
  }

  console.log(`[ChainlessChain] Connecting to ${WS_URL}...`);

  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log("[ChainlessChain] Connected to ChainlessChain Desktop");
      connected = true;
      reconnectAttempts = 0;
      stats.connectTime = Date.now();

      // Send registration message
      sendMessage({
        type: "register",
        data: {
          name: "browser-extension",
          version: chrome.runtime.getManifest().version,
          browser: navigator.userAgent,
        },
      });

      // Update badge
      chrome.action.setBadgeText({ text: "ON" });
      chrome.action.setBadgeBackgroundColor({ color: "#4CAF50" });

      // Notify popup
      chrome.runtime.sendMessage({ type: "connectionStatus", connected: true });
    };

    ws.onclose = () => {
      console.log("[ChainlessChain] Disconnected from ChainlessChain Desktop");
      connected = false;
      ws = null;

      // Update badge
      chrome.action.setBadgeText({ text: "OFF" });
      chrome.action.setBadgeBackgroundColor({ color: "#F44336" });

      // Notify popup
      chrome.runtime.sendMessage({
        type: "connectionStatus",
        connected: false,
      });

      // Try to reconnect
      scheduleReconnect();
    };

    ws.onerror = (error) => {
      console.error("[ChainlessChain] WebSocket error:", error);
    };

    ws.onmessage = (event) => {
      handleMessage(event.data);
    };
  } catch (error) {
    console.error("[ChainlessChain] Failed to connect:", error);
    scheduleReconnect();
  }
}

/**
 * Schedule reconnection
 */
function scheduleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.log("[ChainlessChain] Max reconnect attempts reached");
    return;
  }

  reconnectAttempts++;
  const delay = RECONNECT_DELAY * reconnectAttempts;

  console.log(
    `[ChainlessChain] Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts})`,
  );

  setTimeout(connect, delay);
}

/**
 * Disconnect from server
 */
function disconnect() {
  if (ws) {
    ws.close();
    ws = null;
  }
  connected = false;
  reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // Prevent auto-reconnect
}

/**
 * Send message to server
 */
function sendMessage(message) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn("[ChainlessChain] Not connected, cannot send message");
    return false;
  }

  ws.send(JSON.stringify(message));
  stats.messagesSent++;
  return true;
}

/**
 * Handle incoming message
 */
async function handleMessage(data) {
  stats.messagesReceived++;

  try {
    const message = JSON.parse(data);
    console.log("[ChainlessChain] Received:", message.type || message.method);

    // Handle response to pending request
    if (message.id && pendingRequests.has(message.id)) {
      const { resolve, reject } = pendingRequests.get(message.id);
      pendingRequests.delete(message.id);

      if (message.error) {
        reject(new Error(message.error.message));
      } else {
        resolve(message.result);
      }
      return;
    }

    // Handle command from server
    if (message.method) {
      const result = await executeCommand(message.method, message.params || {});
      stats.commandsExecuted++;

      // Send response
      sendMessage({
        id: message.id,
        result,
      });
    }
  } catch (error) {
    console.error("[ChainlessChain] Error handling message:", error);

    // Send error response if applicable
    if (data.id) {
      sendMessage({
        id: data.id,
        error: {
          code: -32603,
          message: error.message,
        },
      });
    }
  }
}

/**
 * Execute command
 */
async function executeCommand(method, params) {
  console.log(`[ChainlessChain] Executing: ${method}`);

  switch (method) {
    // Tab management
    case "tabs.list":
      return await listTabs();
    case "tabs.get":
      return await getTab(params.tabId);
    case "tabs.create":
      return await createTab(params);
    case "tabs.close":
      return await closeTab(params.tabId);
    case "tabs.focus":
      return await focusTab(params.tabId);
    case "tabs.navigate":
      return await navigateTab(params.tabId, params.url);
    case "tabs.reload":
      return await reloadTab(params.tabId);
    case "tabs.goBack":
      return await goBack(params.tabId);
    case "tabs.goForward":
      return await goForward(params.tabId);

    // Page operations
    case "page.getContent":
      return await getPageContent(params.tabId, params.selector);
    case "page.executeScript":
      return await executeScript(params.tabId, params.script);
    case "page.screenshot":
      return await captureScreenshot(params.tabId, params.options);

    // Bookmarks
    case "bookmarks.getTree":
      return await getBookmarkTree();
    case "bookmarks.search":
      return await searchBookmarks(params.query);
    case "bookmarks.create":
      return await createBookmark(params);
    case "bookmarks.remove":
      return await removeBookmark(params.id);

    // History
    case "history.search":
      return await searchHistory(params);
    case "history.getVisits":
      return await getVisits(params.url);
    case "history.delete":
      return await deleteHistory(params.url);

    // Clipboard
    case "clipboard.read":
      return await readClipboard();
    case "clipboard.write":
      return await writeClipboard(params.text);

    // Notifications
    case "notification.show":
      return await showNotification(params);

    // Extension status
    case "status.get":
      return getStatus();

    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

// ==================== Tab Operations ====================

async function listTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    url: tab.url,
    active: tab.active,
    windowId: tab.windowId,
    index: tab.index,
    pinned: tab.pinned,
    favIconUrl: tab.favIconUrl,
  }));
}

async function getTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  return {
    id: tab.id,
    title: tab.title,
    url: tab.url,
    active: tab.active,
    windowId: tab.windowId,
  };
}

async function createTab(params) {
  const tab = await chrome.tabs.create({
    url: params.url || "about:blank",
    active: params.active !== false,
  });
  return { id: tab.id, url: tab.url };
}

async function closeTab(tabId) {
  await chrome.tabs.remove(tabId);
  return { success: true };
}

async function focusTab(tabId) {
  const tab = await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  return { success: true };
}

async function navigateTab(tabId, url) {
  const tab = await chrome.tabs.update(tabId, { url });
  return { id: tab.id, url: tab.url };
}

async function reloadTab(tabId) {
  await chrome.tabs.reload(tabId);
  return { success: true };
}

async function goBack(tabId) {
  await chrome.tabs.goBack(tabId);
  return { success: true };
}

async function goForward(tabId) {
  await chrome.tabs.goForward(tabId);
  return { success: true };
}

// ==================== Page Operations ====================

async function getPageContent(tabId, selector) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel) => {
      if (sel) {
        const el = document.querySelector(sel);
        return el ? el.outerHTML : null;
      }
      return document.documentElement.outerHTML;
    },
    args: [selector],
  });
  return { content: results[0]?.result };
}

async function executeScript(tabId, script) {
  // SECURITY-EXCEPTION: Dynamic code execution is INTENTIONAL here.
  // This is a browser automation feature that executes scripts from the trusted
  // ChainlessChain Desktop app only. Security is enforced by:
  // 1. WebSocket connection is localhost-only (127.0.0.1:18790)
  // 2. No external network access to this endpoint
  // 3. User must explicitly install and enable the extension
  // 4. All commands are logged and auditable
  // security-scanner-ignore: new-function
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (code) => {
      // eslint-disable-next-line no-new-func
      const fn = new Function(code); // NOSONAR SECURITY-EXCEPTION
      return fn();
    },
    args: [script],
  });
  return { result: results[0]?.result };
}

async function captureScreenshot(tabId, options = {}) {
  // Get the tab's window
  const tab = await chrome.tabs.get(tabId);

  // Focus the tab first
  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });

  // Wait a bit for focus
  await new Promise((resolve) => setTimeout(resolve, 100));

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: options.format || "png",
    quality: options.quality || 80,
  });

  return { dataUrl };
}

// ==================== Bookmarks ====================

async function getBookmarkTree() {
  const tree = await chrome.bookmarks.getTree();
  return { tree };
}

async function searchBookmarks(query) {
  const results = await chrome.bookmarks.search(query);
  return { bookmarks: results };
}

async function createBookmark(params) {
  const bookmark = await chrome.bookmarks.create({
    parentId: params.parentId,
    title: params.title,
    url: params.url,
  });
  return { bookmark };
}

async function removeBookmark(id) {
  await chrome.bookmarks.remove(id);
  return { success: true };
}

// ==================== History ====================

async function searchHistory(params) {
  const results = await chrome.history.search({
    text: params.query || "",
    maxResults: params.limit || 100,
    startTime: params.startTime || 0,
    endTime: params.endTime || Date.now(),
  });
  return { history: results };
}

async function getVisits(url) {
  const visits = await chrome.history.getVisits({ url });
  return { visits };
}

async function deleteHistory(url) {
  await chrome.history.deleteUrl({ url });
  return { success: true };
}

// ==================== Clipboard ====================

async function readClipboard() {
  // Use content script to read clipboard
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    return { text: null, error: "No active tab" };
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async () => {
      try {
        return await navigator.clipboard.readText();
      } catch {
        return null;
      }
    },
  });

  return { text: results[0]?.result };
}

async function writeClipboard(text) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    return { success: false, error: "No active tab" };
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async (t) => {
      await navigator.clipboard.writeText(t);
    },
    args: [text],
  });

  return { success: true };
}

// ==================== Notifications ====================

async function showNotification(params) {
  const id = await chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: params.title || "ChainlessChain",
    message: params.message,
    priority: params.priority || 0,
  });
  return { id };
}

// ==================== Status ====================

function getStatus() {
  return {
    connected,
    version: chrome.runtime.getManifest().version,
    stats: {
      ...stats,
      uptime: stats.connectTime ? Date.now() - stats.connectTime : 0,
    },
  };
}

// ==================== Message Handling from Popup ====================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[ChainlessChain] Message from popup:", message);

  switch (message.type) {
    case "connect":
      reconnectAttempts = 0;
      connect();
      sendResponse({ success: true });
      break;

    case "disconnect":
      disconnect();
      sendResponse({ success: true });
      break;

    case "getStatus":
      sendResponse(getStatus());
      break;

    case "getTabs":
      listTabs().then(sendResponse);
      return true; // Async response

    default:
      sendResponse({ error: "Unknown message type" });
  }

  return false;
});

// ==================== Tab Events ====================

chrome.tabs.onCreated.addListener((tab) => {
  sendMessage({
    type: "event",
    event: "tab.created",
    data: { id: tab.id, url: tab.url, title: tab.title },
  });
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  sendMessage({
    type: "event",
    event: "tab.closed",
    data: { tabId, windowId: removeInfo.windowId },
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" || changeInfo.url) {
    sendMessage({
      type: "event",
      event: "tab.updated",
      data: {
        tabId,
        url: tab.url,
        title: tab.title,
        status: changeInfo.status,
      },
    });
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  sendMessage({
    type: "event",
    event: "tab.activated",
    data: { tabId: activeInfo.tabId, windowId: activeInfo.windowId },
  });
});

// Initial connection attempt
connect();
