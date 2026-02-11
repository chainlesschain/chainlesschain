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

      // Notify popup (ignore error if popup is not open)
      chrome.runtime
        .sendMessage({ type: "connectionStatus", connected: true })
        .catch(() => {
          // Popup not open, ignore
        });
    };

    ws.onclose = () => {
      console.log("[ChainlessChain] Disconnected from ChainlessChain Desktop");
      connected = false;
      ws = null;

      // Update badge
      chrome.action.setBadgeText({ text: "OFF" });
      chrome.action.setBadgeBackgroundColor({ color: "#F44336" });

      // Notify popup (ignore error if popup is not open)
      chrome.runtime
        .sendMessage({
          type: "connectionStatus",
          connected: false,
        })
        .catch(() => {
          // Popup not open, ignore
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

    // Cookies
    case "cookies.getAll":
      return await getAllCookies(params);
    case "cookies.get":
      return await getCookie(params);
    case "cookies.set":
      return await setCookie(params);
    case "cookies.remove":
      return await removeCookie(params);
    case "cookies.clear":
      return await clearCookies(params);

    // Downloads
    case "downloads.list":
      return await listDownloads(params);
    case "downloads.download":
      return await startDownload(params);
    case "downloads.cancel":
      return await cancelDownload(params.downloadId);
    case "downloads.pause":
      return await pauseDownload(params.downloadId);
    case "downloads.resume":
      return await resumeDownload(params.downloadId);
    case "downloads.open":
      return await openDownload(params.downloadId);
    case "downloads.show":
      return await showDownloadInFolder(params.downloadId);
    case "downloads.erase":
      return await eraseDownloads(params);

    // Windows
    case "windows.getAll":
      return await getAllWindows();
    case "windows.get":
      return await getWindow(params.windowId);
    case "windows.create":
      return await createWindow(params);
    case "windows.update":
      return await updateWindow(params.windowId, params);
    case "windows.remove":
      return await removeWindow(params.windowId);
    case "windows.getCurrent":
      return await getCurrentWindow();

    // Storage (via content script)
    case "storage.getLocal":
      return await getLocalStorage(params.tabId, params.keys);
    case "storage.setLocal":
      return await setLocalStorage(params.tabId, params.data);
    case "storage.getSession":
      return await getSessionStorage(params.tabId, params.keys);
    case "storage.setSession":
      return await setSessionStorage(params.tabId, params.data);
    case "storage.clearLocal":
      return await clearLocalStorage(params.tabId);
    case "storage.clearSession":
      return await clearSessionStorage(params.tabId);

    // Element interactions (via content script)
    case "element.hover":
      return await hoverElement(params.tabId, params.selector);
    case "element.focus":
      return await focusElement(params.tabId, params.selector);
    case "element.blur":
      return await blurElement(params.tabId, params.selector);
    case "element.select":
      return await selectText(
        params.tabId,
        params.selector,
        params.start,
        params.end,
      );
    case "element.getAttribute":
      return await getElementAttribute(
        params.tabId,
        params.selector,
        params.attribute,
      );
    case "element.setAttribute":
      return await setElementAttribute(
        params.tabId,
        params.selector,
        params.attribute,
        params.value,
      );
    case "element.getBoundingRect":
      return await getElementBoundingRect(params.tabId, params.selector);
    case "element.isVisible":
      return await isElementVisible(params.tabId, params.selector);
    case "element.waitForSelector":
      return await waitForSelector(
        params.tabId,
        params.selector,
        params.options,
      );
    case "element.dragDrop":
      return await dragAndDrop(
        params.tabId,
        params.sourceSelector,
        params.targetSelector,
      );

    // Page operations
    case "page.print":
      return await printPage(params.tabId, params.options);
    case "page.pdf":
      return await saveToPdf(params.tabId, params.options);
    case "page.getConsole":
      return await getConsoleLogs(params.tabId);
    case "page.setViewport":
      return await setViewport(params.tabId, params.width, params.height);
    case "page.emulateDevice":
      return await emulateDevice(params.tabId, params.device);
    case "page.setGeolocation":
      return await setGeolocation(
        params.tabId,
        params.latitude,
        params.longitude,
        params.accuracy,
      );

    // Browsing data
    case "browsingData.clear":
      return await clearBrowsingData(params);

    // Network interception
    case "network.enableInterception":
      return await enableNetworkInterception(params.tabId, params.patterns);
    case "network.disableInterception":
      return await disableNetworkInterception(params.tabId);
    case "network.setRequestBlocking":
      return await setRequestBlocking(params.patterns);
    case "network.clearRequestBlocking":
      return await clearRequestBlocking();
    case "network.getRequests":
      return await getNetworkRequests(params.tabId);
    case "network.mockResponse":
      return await mockNetworkResponse(params.tabId, params.url, params.response);

    // Console capture
    case "console.enable":
      return await enableConsoleCapture(params.tabId);
    case "console.disable":
      return await disableConsoleCapture(params.tabId);
    case "console.getLogs":
      return await getConsoleLogs(params.tabId);
    case "console.clear":
      return await clearConsoleLogs(params.tabId);

    // IndexedDB
    case "indexedDB.getDatabases":
      return await getIndexedDBDatabases(params.tabId);
    case "indexedDB.getData":
      return await getIndexedDBData(params.tabId, params.dbName, params.storeName, params.query);
    case "indexedDB.setData":
      return await setIndexedDBData(params.tabId, params.dbName, params.storeName, params.key, params.value);
    case "indexedDB.deleteData":
      return await deleteIndexedDBData(params.tabId, params.dbName, params.storeName, params.key);
    case "indexedDB.clearStore":
      return await clearIndexedDBStore(params.tabId, params.dbName, params.storeName);

    // Performance
    case "performance.getMetrics":
      return await getPerformanceMetrics(params.tabId);
    case "performance.getEntries":
      return await getPerformanceEntries(params.tabId, params.type);
    case "performance.startTrace":
      return await startPerformanceTrace(params.tabId);
    case "performance.stopTrace":
      return await stopPerformanceTrace(params.tabId);

    // CSS injection
    case "css.inject":
      return await injectCSS(params.tabId, params.css, params.options);
    case "css.remove":
      return await removeInjectedCSS(params.tabId, params.cssId);

    // Accessibility
    case "accessibility.getTree":
      return await getAccessibilityTree(params.tabId, params.selector);
    case "accessibility.getRole":
      return await getElementRole(params.tabId, params.selector);

    // Frame management
    case "frames.list":
      return await listFrames(params.tabId);
    case "frames.executeScript":
      return await executeScriptInFrame(params.tabId, params.frameId, params.script);

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

// ==================== Cookies ====================

async function getAllCookies(params) {
  const details = {};
  if (params.url) {
    details.url = params.url;
  }
  if (params.domain) {
    details.domain = params.domain;
  }
  if (params.name) {
    details.name = params.name;
  }
  const cookies = await chrome.cookies.getAll(details);
  return { cookies };
}

async function getCookie(params) {
  const cookie = await chrome.cookies.get({
    url: params.url,
    name: params.name,
  });
  return { cookie };
}

async function setCookie(params) {
  const cookie = await chrome.cookies.set({
    url: params.url,
    name: params.name,
    value: params.value,
    domain: params.domain,
    path: params.path || "/",
    secure: params.secure,
    httpOnly: params.httpOnly,
    sameSite: params.sameSite,
    expirationDate: params.expirationDate,
  });
  return { cookie };
}

async function removeCookie(params) {
  const details = await chrome.cookies.remove({
    url: params.url,
    name: params.name,
  });
  return { success: !!details };
}

async function clearCookies(params) {
  const cookies = await chrome.cookies.getAll(
    params.domain ? { domain: params.domain } : {},
  );
  let removed = 0;
  for (const cookie of cookies) {
    const protocol = cookie.secure ? "https:" : "http:";
    const url = `${protocol}//${cookie.domain}${cookie.path}`;
    await chrome.cookies.remove({ url, name: cookie.name });
    removed++;
  }
  return { success: true, removed };
}

// ==================== Downloads ====================

async function listDownloads(params = {}) {
  const query = {};
  if (params.query) {
    query.query = [params.query];
  }
  if (params.limit) {
    query.limit = params.limit;
  }
  if (params.orderBy) {
    query.orderBy = [params.orderBy];
  }
  if (params.state) {
    query.state = params.state;
  }
  const downloads = await chrome.downloads.search(query);
  return {
    downloads: downloads.map((d) => ({
      id: d.id,
      url: d.url,
      filename: d.filename,
      state: d.state,
      bytesReceived: d.bytesReceived,
      totalBytes: d.totalBytes,
      startTime: d.startTime,
      endTime: d.endTime,
      error: d.error,
      mime: d.mime,
    })),
  };
}

async function startDownload(params) {
  const options = {
    url: params.url,
  };
  if (params.filename) {
    options.filename = params.filename;
  }
  if (params.saveAs !== undefined) {
    options.saveAs = params.saveAs;
  }
  if (params.conflictAction) {
    options.conflictAction = params.conflictAction;
  }
  const downloadId = await chrome.downloads.download(options);
  return { downloadId };
}

async function cancelDownload(downloadId) {
  await chrome.downloads.cancel(downloadId);
  return { success: true };
}

async function pauseDownload(downloadId) {
  await chrome.downloads.pause(downloadId);
  return { success: true };
}

async function resumeDownload(downloadId) {
  await chrome.downloads.resume(downloadId);
  return { success: true };
}

async function openDownload(downloadId) {
  await chrome.downloads.open(downloadId);
  return { success: true };
}

async function showDownloadInFolder(downloadId) {
  await chrome.downloads.show(downloadId);
  return { success: true };
}

async function eraseDownloads(params = {}) {
  const query = {};
  if (params.state) {
    query.state = params.state;
  }
  if (params.startedBefore) {
    query.startedBefore = params.startedBefore;
  }
  const erased = await chrome.downloads.erase(query);
  return { erased: erased.length };
}

// ==================== Windows ====================

async function getAllWindows() {
  const windows = await chrome.windows.getAll({ populate: true });
  return {
    windows: windows.map((w) => ({
      id: w.id,
      type: w.type,
      state: w.state,
      focused: w.focused,
      top: w.top,
      left: w.left,
      width: w.width,
      height: w.height,
      incognito: w.incognito,
      tabCount: w.tabs ? w.tabs.length : 0,
    })),
  };
}

async function getWindow(windowId) {
  const window = await chrome.windows.get(windowId, { populate: true });
  return {
    id: window.id,
    type: window.type,
    state: window.state,
    focused: window.focused,
    top: window.top,
    left: window.left,
    width: window.width,
    height: window.height,
    incognito: window.incognito,
    tabs: window.tabs
      ? window.tabs.map((t) => ({
          id: t.id,
          title: t.title,
          url: t.url,
          active: t.active,
        }))
      : [],
  };
}

async function createWindow(params) {
  const options = {};
  if (params.url) {
    options.url = params.url;
  }
  if (params.type) {
    options.type = params.type;
  }
  if (params.state) {
    options.state = params.state;
  }
  if (params.focused !== undefined) {
    options.focused = params.focused;
  }
  if (params.incognito !== undefined) {
    options.incognito = params.incognito;
  }
  if (params.width) {
    options.width = params.width;
  }
  if (params.height) {
    options.height = params.height;
  }
  if (params.top !== undefined) {
    options.top = params.top;
  }
  if (params.left !== undefined) {
    options.left = params.left;
  }
  const window = await chrome.windows.create(options);
  return { windowId: window.id };
}

async function updateWindow(windowId, params) {
  const updateInfo = {};
  if (params.state) {
    updateInfo.state = params.state;
  }
  if (params.focused !== undefined) {
    updateInfo.focused = params.focused;
  }
  if (params.width) {
    updateInfo.width = params.width;
  }
  if (params.height) {
    updateInfo.height = params.height;
  }
  if (params.top !== undefined) {
    updateInfo.top = params.top;
  }
  if (params.left !== undefined) {
    updateInfo.left = params.left;
  }
  if (params.drawAttention !== undefined) {
    updateInfo.drawAttention = params.drawAttention;
  }
  const window = await chrome.windows.update(windowId, updateInfo);
  return { success: true, state: window.state };
}

async function removeWindow(windowId) {
  await chrome.windows.remove(windowId);
  return { success: true };
}

async function getCurrentWindow() {
  const window = await chrome.windows.getCurrent({ populate: true });
  return {
    id: window.id,
    type: window.type,
    state: window.state,
    focused: window.focused,
    width: window.width,
    height: window.height,
  };
}

// ==================== Storage (via content script) ====================

async function getLocalStorage(tabId, keys) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (keyList) => {
      if (!keyList || keyList.length === 0) {
        // Return all localStorage
        const data = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          data[key] = localStorage.getItem(key);
        }
        return data;
      }
      const data = {};
      for (const key of keyList) {
        data[key] = localStorage.getItem(key);
      }
      return data;
    },
    args: [keys],
  });
  return { data: results[0]?.result };
}

async function setLocalStorage(tabId, data) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (storageData) => {
      for (const [key, value] of Object.entries(storageData)) {
        localStorage.setItem(key, value);
      }
    },
    args: [data],
  });
  return { success: true };
}

async function getSessionStorage(tabId, keys) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (keyList) => {
      if (!keyList || keyList.length === 0) {
        const data = {};
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          data[key] = sessionStorage.getItem(key);
        }
        return data;
      }
      const data = {};
      for (const key of keyList) {
        data[key] = sessionStorage.getItem(key);
      }
      return data;
    },
    args: [keys],
  });
  return { data: results[0]?.result };
}

async function setSessionStorage(tabId, data) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (storageData) => {
      for (const [key, value] of Object.entries(storageData)) {
        sessionStorage.setItem(key, value);
      }
    },
    args: [data],
  });
  return { success: true };
}

async function clearLocalStorage(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      localStorage.clear();
    },
  });
  return { success: true };
}

async function clearSessionStorage(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      sessionStorage.clear();
    },
  });
  return { success: true };
}

// ==================== Element Interactions ====================

async function hoverElement(tabId, selector) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel) => {
      const element = document.querySelector(sel);
      if (!element) {
        return { error: `Element not found: ${sel}` };
      }
      const event = new MouseEvent("mouseover", {
        view: window,
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(event);
      const enterEvent = new MouseEvent("mouseenter", {
        view: window,
        bubbles: false,
        cancelable: true,
      });
      element.dispatchEvent(enterEvent);
      return { success: true };
    },
    args: [selector],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

async function focusElement(tabId, selector) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel) => {
      const element = document.querySelector(sel);
      if (!element) {
        return { error: `Element not found: ${sel}` };
      }
      element.focus();
      return { success: true };
    },
    args: [selector],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

async function blurElement(tabId, selector) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel) => {
      const element = document.querySelector(sel);
      if (!element) {
        return { error: `Element not found: ${sel}` };
      }
      element.blur();
      return { success: true };
    },
    args: [selector],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

async function selectText(tabId, selector, start, end) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel, s, e) => {
      const element = document.querySelector(sel);
      if (!element) {
        return { error: `Element not found: ${sel}` };
      }
      if (element.setSelectionRange) {
        element.focus();
        const textLength = element.value ? element.value.length : 0;
        element.setSelectionRange(s || 0, e !== undefined ? e : textLength);
        return { success: true };
      }
      // For non-input elements
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return { success: true };
    },
    args: [selector, start, end],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

async function getElementAttribute(tabId, selector, attribute) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel, attr) => {
      const element = document.querySelector(sel);
      if (!element) {
        return { error: `Element not found: ${sel}` };
      }
      return { value: element.getAttribute(attr) };
    },
    args: [selector, attribute],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

async function setElementAttribute(tabId, selector, attribute, value) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel, attr, val) => {
      const element = document.querySelector(sel);
      if (!element) {
        return { error: `Element not found: ${sel}` };
      }
      element.setAttribute(attr, val);
      return { success: true };
    },
    args: [selector, attribute, value],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

async function getElementBoundingRect(tabId, selector) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel) => {
      const element = document.querySelector(sel);
      if (!element) {
        return { error: `Element not found: ${sel}` };
      }
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
      };
    },
    args: [selector],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

async function isElementVisible(tabId, selector) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel) => {
      const element = document.querySelector(sel);
      if (!element) {
        return { visible: false, reason: "not found" };
      }
      const style = window.getComputedStyle(element);
      if (style.display === "none") {
        return { visible: false, reason: "display:none" };
      }
      if (style.visibility === "hidden") {
        return { visible: false, reason: "visibility:hidden" };
      }
      if (style.opacity === "0") {
        return { visible: false, reason: "opacity:0" };
      }
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return { visible: false, reason: "zero size" };
      }
      return { visible: true };
    },
    args: [selector],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

async function waitForSelector(tabId, selector, options = {}) {
  const timeout = options.timeout || 10000;
  const interval = options.interval || 100;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel, opts) => {
        const element = document.querySelector(sel);
        if (!element) {
          return { found: false };
        }
        if (opts.visible) {
          const style = window.getComputedStyle(element);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.opacity === "0"
          ) {
            return { found: false };
          }
        }
        return { found: true };
      },
      args: [selector, options],
    });

    if (results[0]?.result?.found) {
      return { success: true, elapsed: Date.now() - startTime };
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  return { error: `Timeout waiting for selector: ${selector}` };
}

async function dragAndDrop(tabId, sourceSelector, targetSelector) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sourceSel, targetSel) => {
      const source = document.querySelector(sourceSel);
      const target = document.querySelector(targetSel);

      if (!source) {
        return { error: `Source element not found: ${sourceSel}` };
      }
      if (!target) {
        return { error: `Target element not found: ${targetSel}` };
      }

      const sourceRect = source.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();

      const dataTransfer = new DataTransfer();

      // Dispatch drag events
      source.dispatchEvent(
        new DragEvent("dragstart", {
          bubbles: true,
          cancelable: true,
          dataTransfer,
        }),
      );

      source.dispatchEvent(
        new DragEvent("drag", {
          bubbles: true,
          cancelable: true,
          dataTransfer,
        }),
      );

      target.dispatchEvent(
        new DragEvent("dragenter", {
          bubbles: true,
          cancelable: true,
          dataTransfer,
          clientX: targetRect.x + targetRect.width / 2,
          clientY: targetRect.y + targetRect.height / 2,
        }),
      );

      target.dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          dataTransfer,
          clientX: targetRect.x + targetRect.width / 2,
          clientY: targetRect.y + targetRect.height / 2,
        }),
      );

      target.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer,
          clientX: targetRect.x + targetRect.width / 2,
          clientY: targetRect.y + targetRect.height / 2,
        }),
      );

      source.dispatchEvent(
        new DragEvent("dragend", {
          bubbles: true,
          cancelable: true,
          dataTransfer,
        }),
      );

      return { success: true };
    },
    args: [sourceSelector, targetSelector],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

// ==================== Page Operations ====================

async function printPage(tabId, _options = {}) {
  // Note: chrome.tabs.print() requires user interaction
  // This will open the print dialog
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      window.print();
    },
  });
  return { success: true, note: "Print dialog opened" };
}

async function saveToPdf(tabId, options = {}) {
  // Note: PDF saving requires debugger API
  try {
    await chrome.debugger.attach({ tabId }, "1.3");

    const result = await chrome.debugger.sendCommand(
      { tabId },
      "Page.printToPDF",
      {
        landscape: options.landscape || false,
        displayHeaderFooter: options.displayHeaderFooter || false,
        printBackground: options.printBackground !== false,
        scale: options.scale || 1,
        paperWidth: options.paperWidth || 8.5,
        paperHeight: options.paperHeight || 11,
        marginTop: options.marginTop || 0.4,
        marginBottom: options.marginBottom || 0.4,
        marginLeft: options.marginLeft || 0.4,
        marginRight: options.marginRight || 0.4,
      },
    );

    await chrome.debugger.detach({ tabId });

    return {
      success: true,
      data: result.data, // Base64 encoded PDF
    };
  } catch (error) {
    try {
      await chrome.debugger.detach({ tabId });
    } catch (_e) {
      // Ignore detach errors
    }
    return { error: error.message };
  }
}

// Console logs storage (per tab)
const consoleLogs = new Map();

async function getConsoleLogs(tabId) {
  return { logs: consoleLogs.get(tabId) || [] };
}

async function setViewport(tabId, width, height) {
  try {
    await chrome.debugger.attach({ tabId }, "1.3");

    await chrome.debugger.sendCommand(
      { tabId },
      "Emulation.setDeviceMetricsOverride",
      {
        width: width,
        height: height,
        deviceScaleFactor: 1,
        mobile: width < 768,
      },
    );

    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

const devicePresets = {
  "iPhone SE": { width: 375, height: 667, deviceScaleFactor: 2, mobile: true },
  "iPhone 12": { width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
  "iPhone 14 Pro Max": {
    width: 430,
    height: 932,
    deviceScaleFactor: 3,
    mobile: true,
  },
  iPad: { width: 768, height: 1024, deviceScaleFactor: 2, mobile: true },
  "iPad Pro": { width: 1024, height: 1366, deviceScaleFactor: 2, mobile: true },
  "Pixel 5": { width: 393, height: 851, deviceScaleFactor: 2.75, mobile: true },
  "Samsung Galaxy S21": {
    width: 360,
    height: 800,
    deviceScaleFactor: 3,
    mobile: true,
  },
};

async function emulateDevice(tabId, device) {
  const preset = devicePresets[device];
  if (!preset) {
    return {
      error: `Unknown device: ${device}`,
      availableDevices: Object.keys(devicePresets),
    };
  }

  try {
    await chrome.debugger.attach({ tabId }, "1.3");

    await chrome.debugger.sendCommand(
      { tabId },
      "Emulation.setDeviceMetricsOverride",
      preset,
    );

    return { success: true, device, ...preset };
  } catch (error) {
    return { error: error.message };
  }
}

async function setGeolocation(tabId, latitude, longitude, accuracy = 100) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (lat, lng, acc) => {
      // Override geolocation
      const mockPosition = {
        coords: {
          latitude: lat,
          longitude: lng,
          accuracy: acc,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      };

      navigator.geolocation.getCurrentPosition = (success) => {
        success(mockPosition);
      };

      navigator.geolocation.watchPosition = (success) => {
        success(mockPosition);
        return 1;
      };

      return { success: true };
    },
    args: [latitude, longitude, accuracy],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

// ==================== Browsing Data ====================

async function clearBrowsingData(params) {
  const dataToRemove = {};
  const options = {
    since: params.since || 0,
  };

  if (params.cache) {
    dataToRemove.cache = true;
  }
  if (params.cookies) {
    dataToRemove.cookies = true;
  }
  if (params.history) {
    dataToRemove.history = true;
  }
  if (params.localStorage) {
    dataToRemove.localStorage = true;
  }
  if (params.passwords) {
    dataToRemove.passwords = true;
  }
  if (params.formData) {
    dataToRemove.formData = true;
  }
  if (params.downloads) {
    dataToRemove.downloads = true;
  }

  if (Object.keys(dataToRemove).length === 0) {
    return { error: "No data types specified" };
  }

  await chrome.browsingData.remove(options, dataToRemove);
  return { success: true, cleared: Object.keys(dataToRemove) };
}

// ==================== Network Interception ====================

// Network request storage per tab
const networkRequests = new Map();
const networkInterceptionEnabled = new Map();
const requestBlockingPatterns = [];
const mockResponses = new Map();

async function enableNetworkInterception(tabId, _patterns = []) {
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

async function disableNetworkInterception(tabId) {
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

async function setRequestBlocking(patterns) {
  requestBlockingPatterns.length = 0;
  requestBlockingPatterns.push(...patterns);

  // Update declarativeNetRequest rules
  const rules = patterns.map((pattern, index) => ({
    id: index + 1,
    priority: 1,
    action: { type: "block" },
    condition: { urlFilter: pattern, resourceTypes: ["main_frame", "sub_frame", "script", "stylesheet", "image", "xmlhttprequest"] },
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

async function clearRequestBlocking() {
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

async function getNetworkRequests(tabId) {
  return { requests: networkRequests.get(tabId) || [] };
}

async function mockNetworkResponse(tabId, urlPattern, response) {
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
          responseHeaders: Object.entries(mockResp.headers || {}).map(([name, value]) => ({ name, value })),
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

// ==================== Console Capture ====================

const consoleCaptures = new Map();

async function enableConsoleCapture(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
    await chrome.debugger.sendCommand({ tabId }, "Log.enable");

    consoleCaptures.set(tabId, []);

    chrome.debugger.onEvent.addListener((source, method, params) => {
      if (source.tabId !== tabId) {
        return;
      }

      const logs = consoleCaptures.get(tabId) || [];

      if (method === "Runtime.consoleAPICalled") {
        logs.push({
          type: params.type,
          args: params.args.map((arg) => arg.value || arg.description || arg.type),
          timestamp: params.timestamp,
          stackTrace: params.stackTrace,
        });
        consoleCaptures.set(tabId, logs.slice(-1000)); // Keep last 1000
      }

      if (method === "Log.entryAdded") {
        logs.push({
          type: params.entry.level,
          text: params.entry.text,
          url: params.entry.url,
          lineNumber: params.entry.lineNumber,
          timestamp: params.entry.timestamp,
        });
        consoleCaptures.set(tabId, logs.slice(-1000));
      }

      if (method === "Runtime.exceptionThrown") {
        logs.push({
          type: "error",
          text: params.exceptionDetails.text,
          exception: params.exceptionDetails.exception,
          lineNumber: params.exceptionDetails.lineNumber,
          columnNumber: params.exceptionDetails.columnNumber,
          url: params.exceptionDetails.url,
          timestamp: params.timestamp,
        });
        consoleCaptures.set(tabId, logs.slice(-1000));
      }
    });

    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

async function disableConsoleCapture(tabId) {
  try {
    await chrome.debugger.sendCommand({ tabId }, "Runtime.disable");
    await chrome.debugger.sendCommand({ tabId }, "Log.disable");
    await chrome.debugger.detach({ tabId });
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

async function clearConsoleLogs(tabId) {
  consoleCaptures.set(tabId, []);
  return { success: true };
}

// ==================== IndexedDB ====================

async function getIndexedDBDatabases(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      try {
        const databases = await indexedDB.databases();
        return { databases: databases.map((db) => ({ name: db.name, version: db.version })) };
      } catch (error) {
        return { error: error.message };
      }
    },
  });
  return results[0]?.result || { error: "Script execution failed" };
}

async function getIndexedDBData(tabId, dbName, storeName, query = {}) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (db, store, q) => {
      return new Promise((resolve) => {
        const request = indexedDB.open(db);

        request.onerror = () => resolve({ error: request.error?.message });

        request.onsuccess = () => {
          const database = request.result;
          try {
            const tx = database.transaction(store, "readonly");
            const objectStore = tx.objectStore(store);

            let dataRequest;
            if (q.key) {
              dataRequest = objectStore.get(q.key);
            } else if (q.range) {
              const range = IDBKeyRange.bound(q.range.lower, q.range.upper);
              dataRequest = objectStore.getAll(range, q.limit || 100);
            } else {
              dataRequest = objectStore.getAll(null, q.limit || 100);
            }

            dataRequest.onsuccess = () => {
              database.close();
              resolve({ data: dataRequest.result });
            };

            dataRequest.onerror = () => {
              database.close();
              resolve({ error: dataRequest.error?.message });
            };
          } catch (error) {
            database.close();
            resolve({ error: error.message });
          }
        };
      });
    },
    args: [dbName, storeName, query],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

async function setIndexedDBData(tabId, dbName, storeName, key, value) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (db, store, k, v) => {
      return new Promise((resolve) => {
        const request = indexedDB.open(db);

        request.onerror = () => resolve({ error: request.error?.message });

        request.onsuccess = () => {
          const database = request.result;
          try {
            const tx = database.transaction(store, "readwrite");
            const objectStore = tx.objectStore(store);

            const putRequest = objectStore.put(v, k);

            putRequest.onsuccess = () => {
              database.close();
              resolve({ success: true });
            };

            putRequest.onerror = () => {
              database.close();
              resolve({ error: putRequest.error?.message });
            };
          } catch (error) {
            database.close();
            resolve({ error: error.message });
          }
        };
      });
    },
    args: [dbName, storeName, key, value],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

async function deleteIndexedDBData(tabId, dbName, storeName, key) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (db, store, k) => {
      return new Promise((resolve) => {
        const request = indexedDB.open(db);

        request.onerror = () => resolve({ error: request.error?.message });

        request.onsuccess = () => {
          const database = request.result;
          try {
            const tx = database.transaction(store, "readwrite");
            const objectStore = tx.objectStore(store);

            const deleteRequest = objectStore.delete(k);

            deleteRequest.onsuccess = () => {
              database.close();
              resolve({ success: true });
            };

            deleteRequest.onerror = () => {
              database.close();
              resolve({ error: deleteRequest.error?.message });
            };
          } catch (error) {
            database.close();
            resolve({ error: error.message });
          }
        };
      });
    },
    args: [dbName, storeName, key],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

async function clearIndexedDBStore(tabId, dbName, storeName) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (db, store) => {
      return new Promise((resolve) => {
        const request = indexedDB.open(db);

        request.onerror = () => resolve({ error: request.error?.message });

        request.onsuccess = () => {
          const database = request.result;
          try {
            const tx = database.transaction(store, "readwrite");
            const objectStore = tx.objectStore(store);

            const clearRequest = objectStore.clear();

            clearRequest.onsuccess = () => {
              database.close();
              resolve({ success: true });
            };

            clearRequest.onerror = () => {
              database.close();
              resolve({ error: clearRequest.error?.message });
            };
          } catch (error) {
            database.close();
            resolve({ error: error.message });
          }
        };
      });
    },
    args: [dbName, storeName],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

// ==================== Performance ====================

async function getPerformanceMetrics(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const perf = performance;
      const timing = perf.timing;
      const navigation = perf.getEntriesByType("navigation")[0];

      return {
        // Navigation timing
        dnsLookup: timing.domainLookupEnd - timing.domainLookupStart,
        tcpConnection: timing.connectEnd - timing.connectStart,
        serverResponse: timing.responseStart - timing.requestStart,
        domContentLoaded: timing.domContentLoadedEventEnd - timing.navigationStart,
        pageLoad: timing.loadEventEnd - timing.navigationStart,
        domInteractive: timing.domInteractive - timing.navigationStart,

        // Navigation entry
        transferSize: navigation?.transferSize,
        encodedBodySize: navigation?.encodedBodySize,
        decodedBodySize: navigation?.decodedBodySize,

        // Memory (if available)
        memory: perf.memory
          ? {
              usedJSHeapSize: perf.memory.usedJSHeapSize,
              totalJSHeapSize: perf.memory.totalJSHeapSize,
              jsHeapSizeLimit: perf.memory.jsHeapSizeLimit,
            }
          : null,

        // Resource counts
        resourceCount: perf.getEntriesByType("resource").length,
      };
    },
  });
  return results[0]?.result || { error: "Script execution failed" };
}

async function getPerformanceEntries(tabId, type) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (entryType) => {
      const entries = entryType
        ? performance.getEntriesByType(entryType)
        : performance.getEntries();

      return {
        entries: entries.slice(-100).map((entry) => ({
          name: entry.name,
          entryType: entry.entryType,
          startTime: entry.startTime,
          duration: entry.duration,
          transferSize: entry.transferSize,
          initiatorType: entry.initiatorType,
        })),
      };
    },
    args: [type],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

const performanceTraces = new Map();

async function startPerformanceTrace(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    await chrome.debugger.sendCommand({ tabId }, "Tracing.start", {
      categories: "devtools.timeline,v8.execute,disabled-by-default-devtools.timeline",
      options: "sampling-frequency=10000",
    });

    performanceTraces.set(tabId, { startTime: Date.now(), events: [] });

    chrome.debugger.onEvent.addListener((source, method, params) => {
      if (source.tabId !== tabId || method !== "Tracing.dataCollected") {
        return;
      }

      const trace = performanceTraces.get(tabId);
      if (trace) {
        trace.events.push(...params.value);
      }
    });

    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

async function stopPerformanceTrace(tabId) {
  try {
    await chrome.debugger.sendCommand({ tabId }, "Tracing.end");

    const trace = performanceTraces.get(tabId);
    performanceTraces.delete(tabId);

    await chrome.debugger.detach({ tabId });

    return {
      success: true,
      duration: Date.now() - (trace?.startTime || 0),
      eventCount: trace?.events?.length || 0,
    };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== CSS Injection ====================

const injectedStyles = new Map();

async function injectCSS(tabId, css, options = {}) {
  try {
    const cssId = `chainlesschain-css-${Date.now()}`;

    await chrome.scripting.insertCSS({
      target: { tabId },
      css: css,
      origin: options.origin || "USER",
    });

    const tabStyles = injectedStyles.get(tabId) || [];
    tabStyles.push({ id: cssId, css });
    injectedStyles.set(tabId, tabStyles);

    return { success: true, cssId };
  } catch (error) {
    return { error: error.message };
  }
}

async function removeInjectedCSS(tabId, cssId) {
  try {
    const tabStyles = injectedStyles.get(tabId) || [];
    const style = tabStyles.find((s) => s.id === cssId);

    if (style) {
      await chrome.scripting.removeCSS({
        target: { tabId },
        css: style.css,
      });

      injectedStyles.set(
        tabId,
        tabStyles.filter((s) => s.id !== cssId),
      );
    }

    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Accessibility ====================

async function getAccessibilityTree(tabId, selector) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel) => {
      const element = sel ? document.querySelector(sel) : document.body;
      if (!element) {
        return { error: `Element not found: ${sel}` };
      }

      function getAccessibilityInfo(el, depth = 0) {
        if (depth > 5) {
          return null;
        } // Limit depth

        const computedRole = el.getAttribute("role") || el.tagName.toLowerCase();
        const ariaLabel = el.getAttribute("aria-label");
        const ariaDescribedBy = el.getAttribute("aria-describedby");
        const ariaLabelledBy = el.getAttribute("aria-labelledby");

        const info = {
          tagName: el.tagName,
          role: computedRole,
          name: ariaLabel || el.textContent?.substring(0, 50) || "",
          ariaLabel,
          ariaDescribedBy,
          ariaLabelledBy,
          ariaHidden: el.getAttribute("aria-hidden"),
          tabIndex: el.tabIndex,
          focusable: el.tabIndex >= 0 || ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(el.tagName),
          children: [],
        };

        for (const child of el.children) {
          const childInfo = getAccessibilityInfo(child, depth + 1);
          if (childInfo) {
            info.children.push(childInfo);
          }
        }

        return info;
      }

      return { tree: getAccessibilityInfo(element) };
    },
    args: [selector],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

async function getElementRole(tabId, selector) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel) => {
      const element = document.querySelector(sel);
      if (!element) {
        return { error: `Element not found: ${sel}` };
      }

      return {
        role: element.getAttribute("role") || element.tagName.toLowerCase(),
        ariaLabel: element.getAttribute("aria-label"),
        ariaDescribedBy: element.getAttribute("aria-describedby"),
        ariaLive: element.getAttribute("aria-live"),
        ariaExpanded: element.getAttribute("aria-expanded"),
        ariaSelected: element.getAttribute("aria-selected"),
        ariaChecked: element.getAttribute("aria-checked"),
        ariaDisabled: element.getAttribute("aria-disabled"),
        tabIndex: element.tabIndex,
      };
    },
    args: [selector],
  });
  return results[0]?.result || { error: "Script execution failed" };
}

// ==================== Frame Management ====================

async function listFrames(tabId) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    return {
      frames: frames.map((frame) => ({
        frameId: frame.frameId,
        parentFrameId: frame.parentFrameId,
        url: frame.url,
        documentId: frame.documentId,
      })),
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function executeScriptInFrame(tabId, frameId, script) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: (code) => {
        // eslint-disable-next-line no-new-func
        const fn = new Function(code); // NOSONAR - intentional for automation
        return fn();
      },
      args: [script],
    });
    return { result: results[0]?.result };
  } catch (error) {
    return { error: error.message };
  }
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
