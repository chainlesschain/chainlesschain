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
      return await mockNetworkResponse(
        params.tabId,
        params.url,
        params.response,
      );

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
      return await getIndexedDBData(
        params.tabId,
        params.dbName,
        params.storeName,
        params.query,
      );
    case "indexedDB.setData":
      return await setIndexedDBData(
        params.tabId,
        params.dbName,
        params.storeName,
        params.key,
        params.value,
      );
    case "indexedDB.deleteData":
      return await deleteIndexedDBData(
        params.tabId,
        params.dbName,
        params.storeName,
        params.key,
      );
    case "indexedDB.clearStore":
      return await clearIndexedDBStore(
        params.tabId,
        params.dbName,
        params.storeName,
      );

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
      return await executeScriptInFrame(
        params.tabId,
        params.frameId,
        params.script,
      );

    // Extension status
    case "status.get":
      return getStatus();

    // ==================== Phase 17: Advanced Debugging ====================

    // WebSocket Debugging
    case "websocket.enable":
      return await enableWebSocketDebugging(params.tabId);
    case "websocket.disable":
      return await disableWebSocketDebugging(params.tabId);
    case "websocket.getConnections":
      return getWebSocketConnections(params.tabId);
    case "websocket.getMessages":
      return getWebSocketMessages(params.tabId, params.connectionId);
    case "websocket.send":
      return await sendWebSocketMessage(
        params.tabId,
        params.connectionId,
        params.data,
      );
    case "websocket.close":
      return await closeWebSocketConnection(params.tabId, params.connectionId);

    // Service Worker Management
    case "serviceWorker.list":
      return await listServiceWorkers();
    case "serviceWorker.getInfo":
      return await getServiceWorkerInfo(params.registrationId);
    case "serviceWorker.unregister":
      return await unregisterServiceWorker(params.tabId, params.scopeUrl);
    case "serviceWorker.update":
      return await updateServiceWorker(params.tabId, params.scopeUrl);
    case "serviceWorker.postMessage":
      return await postMessageToServiceWorker(params.tabId, params.message);

    // Cache Storage
    case "cache.listCaches":
      return await listCaches(params.tabId);
    case "cache.listEntries":
      return await listCacheEntries(params.tabId, params.cacheName);
    case "cache.getEntry":
      return await getCacheEntry(params.tabId, params.cacheName, params.url);
    case "cache.deleteEntry":
      return await deleteCacheEntry(params.tabId, params.cacheName, params.url);
    case "cache.deleteCache":
      return await deleteCache(params.tabId, params.cacheName);
    case "cache.addEntry":
      return await addCacheEntry(
        params.tabId,
        params.cacheName,
        params.url,
        params.response,
      );

    // Security Info
    case "security.getCertificate":
      return await getCertificateInfo(params.tabId);
    case "security.getSecurityState":
      return await getSecurityState(params.tabId);
    case "security.checkMixedContent":
      return await checkMixedContent(params.tabId);
    case "security.getPermissions":
      return await getSitePermissions(params.tabId);

    // Animation Control
    case "animation.list":
      return await listAnimations(params.tabId);
    case "animation.pause":
      return await pauseAnimation(params.tabId, params.animationId);
    case "animation.play":
      return await playAnimation(params.tabId, params.animationId);
    case "animation.setSpeed":
      return await setAnimationSpeed(
        params.tabId,
        params.animationId,
        params.playbackRate,
      );
    case "animation.seekTo":
      return await seekAnimation(
        params.tabId,
        params.animationId,
        params.currentTime,
      );
    case "animation.cancel":
      return await cancelAnimation(params.tabId, params.animationId);

    // Layout Inspection
    case "layout.getBoxModel":
      return await getBoxModel(params.tabId, params.selector);
    case "layout.getComputedLayout":
      return await getComputedLayout(params.tabId, params.selector);
    case "layout.highlightNode":
      return await highlightNode(params.tabId, params.selector, params.options);
    case "layout.hideHighlight":
      return await hideHighlight(params.tabId);
    case "layout.getNodeInfo":
      return await getNodeInfo(params.tabId, params.selector);
    case "layout.forceElementState":
      return await forceElementState(
        params.tabId,
        params.selector,
        params.state,
      );

    // Coverage Analysis
    case "coverage.startJSCoverage":
      return await startJSCoverage(params.tabId, params.options);
    case "coverage.stopJSCoverage":
      return await stopJSCoverage(params.tabId);
    case "coverage.startCSSCoverage":
      return await startCSSCoverage(params.tabId);
    case "coverage.stopCSSCoverage":
      return await stopCSSCoverage(params.tabId);
    case "coverage.getJSCoverage":
      return getJSCoverageResults(params.tabId);
    case "coverage.getCSSCoverage":
      return getCSSCoverageResults(params.tabId);

    // Memory Profiling
    case "memory.getInfo":
      return await getMemoryInfo(params.tabId);
    case "memory.takeHeapSnapshot":
      return await takeHeapSnapshot(params.tabId);
    case "memory.startSampling":
      return await startMemorySampling(params.tabId, params.options);
    case "memory.stopSampling":
      return await stopMemorySampling(params.tabId);
    case "memory.forceGC":
      return await forceGarbageCollection(params.tabId);

    // ==================== Phase 18: DOM & Input Tools ====================

    // DOM Mutation Observer
    case "dom.observeMutations":
      return await startMutationObserver(
        params.tabId,
        params.selector,
        params.options,
      );
    case "dom.stopObserving":
      return await stopMutationObserver(params.tabId);
    case "dom.getMutations":
      return getMutationLog(params.tabId);
    case "dom.clearMutations":
      return clearMutationLog(params.tabId);

    // Event Listener Inspector
    case "events.getListeners":
      return await getEventListeners(params.tabId, params.selector);
    case "events.removeListener":
      return await removeEventListener(
        params.tabId,
        params.selector,
        params.eventType,
      );
    case "events.monitorEvents":
      return await startEventMonitor(
        params.tabId,
        params.selector,
        params.eventTypes,
      );
    case "events.stopMonitoring":
      return await stopEventMonitor(params.tabId);
    case "events.getLog":
      return getEventLog(params.tabId);

    // Input Recording
    case "input.startRecording":
      return await startInputRecording(params.tabId, params.options);
    case "input.stopRecording":
      return await stopInputRecording(params.tabId);
    case "input.getRecording":
      return getInputRecording(params.tabId);
    case "input.replay":
      return await replayInputs(params.tabId, params.recording, params.options);
    case "input.clearRecording":
      return clearInputRecording(params.tabId);

    // Media Emulation
    case "media.emulateColorScheme":
      return await emulateColorScheme(params.tabId, params.scheme);
    case "media.emulateReducedMotion":
      return await emulateReducedMotion(params.tabId, params.reduce);
    case "media.emulateForcedColors":
      return await emulateForcedColors(params.tabId, params.forced);
    case "media.emulateVisionDeficiency":
      return await emulateVisionDeficiency(params.tabId, params.type);
    case "media.clearEmulation":
      return await clearMediaEmulation(params.tabId);

    // Page Lifecycle
    case "lifecycle.getState":
      return await getPageLifecycleState(params.tabId);
    case "lifecycle.onStateChange":
      return await subscribeLifecycleChanges(params.tabId);
    case "lifecycle.freeze":
      return await freezePage(params.tabId);
    case "lifecycle.resume":
      return await resumePage(params.tabId);

    // Font Inspector
    case "fonts.getUsed":
      return await getUsedFonts(params.tabId);
    case "fonts.getComputed":
      return await getComputedFonts(params.tabId, params.selector);
    case "fonts.checkAvailability":
      return await checkFontAvailability(params.tabId, params.fontFamily);

    // Measurement Tools
    case "measure.getDistance":
      return await measureDistance(params.tabId, params.from, params.to);
    case "measure.getElementSize":
      return await measureElementSize(params.tabId, params.selector);
    case "measure.enableRuler":
      return await enableRuler(params.tabId);
    case "measure.disableRuler":
      return await disableRuler(params.tabId);

    // Color Picker
    case "color.pickFromPoint":
      return await pickColorFromPoint(params.tabId, params.x, params.y);
    case "color.getElementColors":
      return await getElementColors(params.tabId, params.selector);
    case "color.enablePicker":
      return await enableColorPicker(params.tabId);
    case "color.disablePicker":
      return await disableColorPicker(params.tabId);

    // Storage Inspector (Enhanced)
    case "storage.getQuota":
      return await getStorageQuota(params.tabId);
    case "storage.getUsage":
      return await getStorageUsage(params.tabId);
    case "storage.exportAll":
      return await exportAllStorage(params.tabId);
    case "storage.importAll":
      return await importAllStorage(params.tabId, params.data);

    // ==================== Phase 19: Network & Device Emulation ====================

    // Network Throttling
    case "network.setThrottling":
      return await setNetworkThrottling(params.tabId, params.conditions);
    case "network.clearThrottling":
      return await clearNetworkThrottling(params.tabId);
    case "network.getThrottlingProfiles":
      return getThrottlingProfiles();
    case "network.setOffline":
      return await setOfflineMode(params.tabId, params.offline);

    // Device Emulation
    case "device.setUserAgent":
      return await setUserAgent(
        params.tabId,
        params.userAgent,
        params.platform,
      );
    case "device.getUserAgent":
      return await getUserAgent(params.tabId);
    case "device.setTimezone":
      return await setTimezone(params.tabId, params.timezoneId);
    case "device.setLocale":
      return await setLocale(params.tabId, params.locale);
    case "device.setGeolocation":
      return await setGeolocationOverride(
        params.tabId,
        params.latitude,
        params.longitude,
        params.accuracy,
      );
    case "device.clearGeolocation":
      return await clearGeolocationOverride(params.tabId);

    // Touch Emulation
    case "touch.enable":
      return await enableTouchEmulation(params.tabId, params.options);
    case "touch.disable":
      return await disableTouchEmulation(params.tabId);
    case "touch.tap":
      return await emulateTap(params.tabId, params.x, params.y, params.options);
    case "touch.swipe":
      return await emulateSwipe(
        params.tabId,
        params.startX,
        params.startY,
        params.endX,
        params.endY,
        params.options,
      );
    case "touch.pinch":
      return await emulatePinch(
        params.tabId,
        params.x,
        params.y,
        params.scale,
        params.options,
      );

    // Sensor Emulation
    case "sensor.setOrientation":
      return await setSensorOrientation(
        params.tabId,
        params.alpha,
        params.beta,
        params.gamma,
      );
    case "sensor.setAccelerometer":
      return await setAccelerometer(params.tabId, params.x, params.y, params.z);
    case "sensor.setAmbientLight":
      return await setAmbientLight(params.tabId, params.illuminance);
    case "sensor.clearOverrides":
      return await clearSensorOverrides(params.tabId);

    // Viewport Management
    case "viewport.set":
      return await setViewport(
        params.tabId,
        params.width,
        params.height,
        params.options,
      );
    case "viewport.get":
      return await getViewport(params.tabId);
    case "viewport.setDeviceMetrics":
      return await setDeviceMetricsOverride(params.tabId, params.metrics);
    case "viewport.clearDeviceMetrics":
      return await clearDeviceMetricsOverride(params.tabId);
    case "viewport.getPresets":
      return getViewportPresets();

    // Screenshot Comparison
    case "screenshot.capture":
      return await captureScreenshot(params.tabId, params.options);
    case "screenshot.captureElement":
      return await captureElementScreenshot(
        params.tabId,
        params.selector,
        params.options,
      );
    case "screenshot.compare":
      return await compareScreenshots(
        params.baseline,
        params.current,
        params.options,
      );
    case "screenshot.captureFullPage":
      return await captureFullPageScreenshot(params.tabId, params.options);

    // Clipboard Advanced
    case "clipboard.readRich":
      return await readRichClipboard(params.tabId);
    case "clipboard.writeRich":
      return await writeRichClipboard(params.tabId, params.data);
    case "clipboard.getFormats":
      return await getClipboardFormats(params.tabId);
    case "clipboard.writeImage":
      return await writeImageToClipboard(params.tabId, params.imageData);

    // Print/PDF Enhanced
    case "print.preview":
      return await getPrintPreview(params.tabId, params.options);
    case "print.toPDF":
      return await printToPDF(params.tabId, params.options);
    case "print.getSettings":
      return await getPrintSettings(params.tabId);

    // ==================== Phase 20: Web APIs & System Info ====================

    // Web Workers
    case "workers.list":
      return await listWebWorkers(params.tabId);
    case "workers.terminate":
      return await terminateWorker(params.tabId, params.workerId);
    case "workers.postMessage":
      return await postMessageToWorker(
        params.tabId,
        params.workerId,
        params.message,
      );
    case "workers.getSharedWorkers":
      return await getSharedWorkers(params.tabId);

    // Broadcast Channel
    case "broadcast.create":
      return await createBroadcastChannel(params.tabId, params.channelName);
    case "broadcast.postMessage":
      return await broadcastMessage(
        params.tabId,
        params.channelName,
        params.message,
      );
    case "broadcast.close":
      return await closeBroadcastChannel(params.tabId, params.channelName);
    case "broadcast.list":
      return await listBroadcastChannels(params.tabId);

    // Web Audio
    case "audio.getContexts":
      return await getAudioContexts(params.tabId);
    case "audio.suspend":
      return await suspendAudioContext(params.tabId, params.contextId);
    case "audio.resume":
      return await resumeAudioContext(params.tabId, params.contextId);
    case "audio.getNodes":
      return await getAudioNodes(params.tabId, params.contextId);

    // Canvas/WebGL
    case "canvas.list":
      return await listCanvasElements(params.tabId);
    case "canvas.getContext":
      return await getCanvasContext(params.tabId, params.selector);
    case "canvas.toDataURL":
      return await canvasToDataURL(
        params.tabId,
        params.selector,
        params.format,
      );
    case "webgl.getInfo":
      return await getWebGLInfo(params.tabId, params.selector);
    case "webgl.getExtensions":
      return await getWebGLExtensions(params.tabId, params.selector);

    // Media Devices
    case "media.enumerateDevices":
      return await enumerateMediaDevices(params.tabId);
    case "media.getSupportedConstraints":
      return await getSupportedConstraints(params.tabId);
    case "media.getDisplayMedia":
      return await getDisplayMediaCapabilities(params.tabId);

    // System Info APIs
    case "system.getBattery":
      return await getBatteryInfo(params.tabId);
    case "system.getConnection":
      return await getConnectionInfo(params.tabId);
    case "system.getMemory":
      return await getDeviceMemory(params.tabId);
    case "system.getHardware":
      return await getHardwareInfo(params.tabId);

    // Permissions
    case "permissions.query":
      return await queryPermission(params.tabId, params.name);
    case "permissions.queryAll":
      return await queryAllPermissions(params.tabId);
    case "permissions.request":
      return await requestPermission(params.tabId, params.name);

    // Notifications
    case "notifications.getPermission":
      return await getNotificationPermission(params.tabId);
    case "notifications.requestPermission":
      return await requestNotificationPermission(params.tabId);
    case "notifications.create":
      return await createNotification(
        params.tabId,
        params.title,
        params.options,
      );

    // Fullscreen
    case "fullscreen.enter":
      return await enterFullscreen(params.tabId, params.selector);
    case "fullscreen.exit":
      return await exitFullscreen(params.tabId);
    case "fullscreen.getState":
      return await getFullscreenState(params.tabId);

    // Pointer Lock
    case "pointerLock.request":
      return await requestPointerLock(params.tabId, params.selector);
    case "pointerLock.exit":
      return await exitPointerLock(params.tabId);
    case "pointerLock.getState":
      return await getPointerLockState(params.tabId);

    // ==================== Phase 21: Accessibility & Performance ====================

    // Accessibility
    case "accessibility.getTree":
      return await getAccessibilityTree(params.tabId, params.selector);
    case "accessibility.getARIA":
      return await getARIAProperties(params.tabId, params.selector);
    case "accessibility.checkContrast":
      return await checkColorContrast(params.tabId, params.selector);
    case "accessibility.getFocusOrder":
      return await getFocusOrder(params.tabId);
    case "accessibility.getLandmarks":
      return await getAccessibilityLandmarks(params.tabId);
    case "accessibility.getHeadingStructure":
      return await getHeadingStructure(params.tabId);
    case "accessibility.checkAlt":
      return await checkAltTexts(params.tabId);
    case "accessibility.checkLabels":
      return await checkFormLabels(params.tabId);
    case "accessibility.simulate":
      return await simulateAccessibility(params.tabId, params.type);
    case "accessibility.runAudit":
      return await runAccessibilityAudit(params.tabId);

    // Performance Metrics
    case "performance.getMetrics":
      return await getPerformanceMetrics(params.tabId);
    case "performance.getTimeline":
      return await getPerformanceTimeline(params.tabId);
    case "performance.getLongTasks":
      return await getLongTasks(params.tabId, params.threshold);
    case "performance.getLayoutShifts":
      return await getLayoutShifts(params.tabId);
    case "performance.getPaintTiming":
      return await getPaintTiming(params.tabId);
    case "performance.getResourceTiming":
      return await getResourceTiming(params.tabId, params.filter);
    case "performance.getNavigationTiming":
      return await getNavigationTiming(params.tabId);
    case "performance.measureElement":
      return await measureElementPerformance(params.tabId, params.selector);
    case "performance.startMark":
      return await createPerformanceMark(params.tabId, params.name);
    case "performance.measureBetweenMarks":
      return await measureBetweenMarks(
        params.tabId,
        params.startMark,
        params.endMark,
        params.measureName,
      );
    case "performance.clearMarks":
      return await clearPerformanceMarks(params.tabId, params.name);
    case "performance.getEntries":
      return await getPerformanceEntries(params.tabId, params.type);

    // Memory Analysis
    case "memory.getUsage":
      return await getMemoryUsage(params.tabId);
    case "memory.measureHeap":
      return await measureHeapUsage(params.tabId);
    case "memory.getJSHeapSize":
      return await getJSHeapSize(params.tabId);
    case "memory.detectLeaks":
      return await detectMemoryLeaks(params.tabId);

    // Frame Analysis
    case "frames.getAll":
      return await getAllFrames(params.tabId);
    case "frames.getInfo":
      return await getFrameInfo(params.tabId, params.frameId);
    case "frames.executeInFrame":
      return await executeInFrame(params.tabId, params.frameId, params.script);
    case "frames.getFrameTree":
      return await getFrameTree(params.tabId);

    // Security Analysis
    case "security.getInfo":
      return await getSecurityInfo(params.tabId);
    case "security.getCSP":
      return await getCSPInfo(params.tabId);
    case "security.checkMixedContent":
      return await checkMixedContent(params.tabId);
    case "security.getCertificate":
      return await getCertificateInfo(params.tabId);
    case "security.checkCORS":
      return await checkCORSIssues(params.tabId);

    // Network Timing
    case "network.getTiming":
      return await getNetworkTiming(params.tabId);
    case "network.getWaterfall":
      return await getNetworkWaterfall(params.tabId);
    case "network.analyzeRequests":
      return await analyzeNetworkRequests(params.tabId);

    // ==================== Phase 22: WebRTC & Advanced Storage ====================

    // WebRTC
    case "webrtc.getPeerConnections":
      return await getWebRTCPeerConnections(params.tabId);
    case "webrtc.getConnectionStats":
      return await getWebRTCConnectionStats(params.tabId, params.connectionId);
    case "webrtc.getDataChannels":
      return await getWebRTCDataChannels(params.tabId, params.connectionId);
    case "webrtc.getMediaStreams":
      return await getWebRTCMediaStreams(params.tabId);
    case "webrtc.getICECandidates":
      return await getICECandidates(params.tabId, params.connectionId);
    case "webrtc.getLocalDescription":
      return await getLocalDescription(params.tabId, params.connectionId);
    case "webrtc.getRemoteDescription":
      return await getRemoteDescription(params.tabId, params.connectionId);
    case "webrtc.monitorConnection":
      return await monitorWebRTCConnection(params.tabId, params.connectionId);
    case "webrtc.closeConnection":
      return await closeWebRTCConnection(params.tabId, params.connectionId);

    // Advanced IndexedDB
    case "indexeddb.listDatabases":
      return await listIndexedDBDatabases(params.tabId);
    case "indexeddb.getDatabaseInfo":
      return await getIndexedDBDatabaseInfo(params.tabId, params.dbName);
    case "indexeddb.getObjectStores":
      return await getIndexedDBObjectStores(params.tabId, params.dbName);
    case "indexeddb.getStoreData":
      return await getIndexedDBStoreData(
        params.tabId,
        params.dbName,
        params.storeName,
        params.options,
      );
    case "indexeddb.getStoreIndexes":
      return await getIndexedDBStoreIndexes(
        params.tabId,
        params.dbName,
        params.storeName,
      );
    case "indexeddb.queryByIndex":
      return await queryIndexedDBByIndex(
        params.tabId,
        params.dbName,
        params.storeName,
        params.indexName,
        params.query,
      );
    case "indexeddb.countRecords":
      return await countIndexedDBRecords(
        params.tabId,
        params.dbName,
        params.storeName,
      );
    case "indexeddb.deleteDatabase":
      return await deleteIndexedDBDatabase(params.tabId, params.dbName);
    case "indexeddb.clearStore":
      return await clearIndexedDBStore(
        params.tabId,
        params.dbName,
        params.storeName,
      );
    case "indexeddb.exportDatabase":
      return await exportIndexedDBDatabase(params.tabId, params.dbName);

    // Web Components / Shadow DOM
    case "webcomponents.getCustomElements":
      return await getCustomElements(params.tabId);
    case "webcomponents.getShadowRoots":
      return await getShadowRoots(params.tabId, params.selector);
    case "webcomponents.queryShadowDOM":
      return await queryShadowDOM(
        params.tabId,
        params.hostSelector,
        params.shadowSelector,
      );
    case "webcomponents.getSlots":
      return await getSlottedContent(params.tabId, params.selector);
    case "webcomponents.getAdoptedStylesheets":
      return await getAdoptedStylesheets(params.tabId, params.selector);

    // Drag and Drop
    case "dragdrop.simulateDrag":
      return await simulateDrag(
        params.tabId,
        params.sourceSelector,
        params.targetSelector,
      );
    case "dragdrop.simulateFileDrop":
      return await simulateFileDrop(
        params.tabId,
        params.selector,
        params.files,
      );
    case "dragdrop.getDropZones":
      return await getDropZones(params.tabId);
    case "dragdrop.getDraggableElements":
      return await getDraggableElements(params.tabId);

    // Selection & Range
    case "selection.getSelection":
      return await getTextSelection(params.tabId);
    case "selection.setSelection":
      return await setTextSelection(
        params.tabId,
        params.selector,
        params.start,
        params.end,
      );
    case "selection.selectAll":
      return await selectAllText(params.tabId, params.selector);
    case "selection.clearSelection":
      return await clearSelection(params.tabId);
    case "selection.getSelectedHTML":
      return await getSelectedHTML(params.tabId);

    // History & Navigation State
    case "history.getState":
      return await getHistoryState(params.tabId);
    case "history.pushState":
      return await pushHistoryState(
        params.tabId,
        params.state,
        params.title,
        params.url,
      );
    case "history.replaceState":
      return await replaceHistoryState(
        params.tabId,
        params.state,
        params.title,
        params.url,
      );
    case "history.getLength":
      return await getHistoryLength(params.tabId);
    case "history.go":
      return await historyGo(params.tabId, params.delta);

    // Intersection Observer
    case "intersection.observe":
      return await observeIntersection(
        params.tabId,
        params.selector,
        params.options,
      );
    case "intersection.getVisibleElements":
      return await getVisibleElements(params.tabId, params.selector);
    case "intersection.checkVisibility":
      return await checkElementVisibility(params.tabId, params.selector);

    // Resize Observer
    case "resize.observe":
      return await observeResize(params.tabId, params.selector);
    case "resize.getElementSizes":
      return await getElementSizes(params.tabId, params.selectors);

    // Mutation Summary
    case "mutation.getSummary":
      return await getMutationSummary(params.tabId);
    case "mutation.getChangeHistory":
      return await getMutationChangeHistory(params.tabId, params.limit);

    // ==================== Phase 23: Advanced Web APIs ====================

    // Web Share API
    case "share.canShare":
      return await canShare(params.tabId, params.data);
    case "share.share":
      return await share(params.tabId, params.data);
    case "share.shareFiles":
      return await shareFiles(params.tabId, params.files, params.data);
    case "share.getShareTargets":
      return await getShareTargets(params.tabId);

    // Credential Management API
    case "credential.get":
      return await getCredential(params.tabId, params.options);
    case "credential.store":
      return await storeCredential(params.tabId, params.credential);
    case "credential.create":
      return await createCredential(params.tabId, params.options);
    case "credential.preventSilentAccess":
      return await preventSilentAccess(params.tabId);
    case "credential.isConditionalMediationAvailable":
      return await isConditionalMediationAvailable(params.tabId);
    case "credential.getPublicKeyCredential":
      return await getPublicKeyCredential(params.tabId, params.options);

    // Screen Wake Lock API
    case "wakeLock.request":
      return await requestWakeLock(params.tabId, params.type);
    case "wakeLock.release":
      return await releaseWakeLock(params.tabId);
    case "wakeLock.getState":
      return await getWakeLockState(params.tabId);
    case "wakeLock.isSupported":
      return await isWakeLockSupported(params.tabId);

    // File System Access API
    case "fileSystem.showOpenFilePicker":
      return await showOpenFilePicker(params.tabId, params.options);
    case "fileSystem.showSaveFilePicker":
      return await showSaveFilePicker(params.tabId, params.options);
    case "fileSystem.showDirectoryPicker":
      return await showDirectoryPicker(params.tabId, params.options);
    case "fileSystem.getFileHandle":
      return await getFileSystemHandle(
        params.tabId,
        params.name,
        params.options,
      );
    case "fileSystem.readFile":
      return await readFileFromHandle(params.tabId, params.handleId);
    case "fileSystem.writeFile":
      return await writeFileToHandle(
        params.tabId,
        params.handleId,
        params.content,
      );
    case "fileSystem.getHandleInfo":
      return await getFileHandleInfo(params.tabId, params.handleId);
    case "fileSystem.removeEntry":
      return await removeFileEntry(
        params.tabId,
        params.handleId,
        params.options,
      );

    // Tab Groups API (Chrome specific)
    case "tabGroups.create":
      return await createTabGroup(params.tabIds, params.options);
    case "tabGroups.get":
      return await getTabGroup(params.groupId);
    case "tabGroups.getAll":
      return await getAllTabGroups(params.windowId);
    case "tabGroups.update":
      return await updateTabGroup(params.groupId, params.options);
    case "tabGroups.move":
      return await moveTabGroup(params.groupId, params.moveProperties);
    case "tabGroups.ungroup":
      return await ungroupTabs(params.tabIds);

    // Eye Dropper API
    case "eyeDropper.open":
      return await openEyeDropper(params.tabId, params.options);
    case "eyeDropper.isSupported":
      return await isEyeDropperSupported(params.tabId);

    // Speech Synthesis API
    case "speech.speak":
      return await speak(params.tabId, params.text, params.options);
    case "speech.cancel":
      return await cancelSpeech(params.tabId);
    case "speech.pause":
      return await pauseSpeech(params.tabId);
    case "speech.resume":
      return await resumeSpeech(params.tabId);
    case "speech.getVoices":
      return await getVoices(params.tabId);
    case "speech.isSpeaking":
      return await isSpeaking(params.tabId);
    case "speech.isPending":
      return await isSpeechPending(params.tabId);
    case "speech.isPaused":
      return await isSpeechPaused(params.tabId);

    // Background Sync API
    case "backgroundSync.register":
      return await registerBackgroundSync(params.tabId, params.tag);
    case "backgroundSync.getTags":
      return await getBackgroundSyncTags(params.tabId);
    case "backgroundSync.getRegistration":
      return await getBackgroundSyncRegistration(params.tabId, params.tag);
    case "backgroundSync.getRegistrations":
      return await getBackgroundSyncRegistrations(params.tabId);

    // Periodic Background Sync API
    case "periodicSync.register":
      return await registerPeriodicSync(
        params.tabId,
        params.tag,
        params.options,
      );
    case "periodicSync.unregister":
      return await unregisterPeriodicSync(params.tabId, params.tag);
    case "periodicSync.getTags":
      return await getPeriodicSyncTags(params.tabId);
    case "periodicSync.getMinInterval":
      return await getPeriodicSyncMinInterval(params.tabId);

    // Idle Detection API
    case "idle.requestPermission":
      return await requestIdleDetectionPermission(params.tabId);
    case "idle.start":
      return await startIdleDetection(params.tabId, params.threshold);
    case "idle.stop":
      return await stopIdleDetection(params.tabId);
    case "idle.getState":
      return await getIdleState(params.tabId);

    // Device Memory API
    case "deviceMemory.get":
      return await getDeviceMemory(params.tabId);

    // Network Information API
    case "networkInfo.get":
      return await getNetworkInformation(params.tabId);
    case "networkInfo.onChange":
      return await onNetworkChange(params.tabId, params.enable);

    // Vibration API
    case "vibration.vibrate":
      return await vibrate(params.tabId, params.pattern);
    case "vibration.cancel":
      return await cancelVibration(params.tabId);

    // Screen Orientation API
    case "orientation.get":
      return await getScreenOrientation(params.tabId);
    case "orientation.lock":
      return await lockScreenOrientation(params.tabId, params.orientation);
    case "orientation.unlock":
      return await unlockScreenOrientation(params.tabId);

    // Presentation API
    case "presentation.getAvailability":
      return await getPresentationAvailability(params.tabId, params.urls);
    case "presentation.startPresentation":
      return await startPresentation(params.tabId, params.urls);
    case "presentation.reconnect":
      return await reconnectPresentation(params.tabId, params.presentationId);
    case "presentation.getConnections":
      return await getPresentationConnections(params.tabId);
    case "presentation.terminate":
      return await terminatePresentation(params.tabId, params.connectionId);

    // Reporting API
    case "reporting.getReports":
      return await getReports(params.tabId, params.types);
    case "reporting.clearReports":
      return await clearReports(params.tabId);

    // ==================== Phase 24: Hardware & Media APIs ====================

    // Web Bluetooth API
    case "bluetooth.requestDevice":
      return await requestBluetoothDevice(params.tabId, params.options);
    case "bluetooth.getDevices":
      return await getBluetoothDevices(params.tabId);
    case "bluetooth.getAvailability":
      return await getBluetoothAvailability(params.tabId);
    case "bluetooth.connect":
      return await connectBluetoothDevice(params.tabId, params.deviceId);
    case "bluetooth.disconnect":
      return await disconnectBluetoothDevice(params.tabId, params.deviceId);
    case "bluetooth.getServices":
      return await getBluetoothServices(params.tabId, params.deviceId);

    // Web USB API
    case "usb.requestDevice":
      return await requestUSBDevice(params.tabId, params.options);
    case "usb.getDevices":
      return await getUSBDevices(params.tabId);
    case "usb.open":
      return await openUSBDevice(params.tabId, params.deviceId);
    case "usb.close":
      return await closeUSBDevice(params.tabId, params.deviceId);
    case "usb.selectConfiguration":
      return await selectUSBConfiguration(
        params.tabId,
        params.deviceId,
        params.configurationValue,
      );
    case "usb.claimInterface":
      return await claimUSBInterface(
        params.tabId,
        params.deviceId,
        params.interfaceNumber,
      );

    // Web Serial API
    case "serial.requestPort":
      return await requestSerialPort(params.tabId, params.options);
    case "serial.getPorts":
      return await getSerialPorts(params.tabId);
    case "serial.open":
      return await openSerialPort(params.tabId, params.portId, params.options);
    case "serial.close":
      return await closeSerialPort(params.tabId, params.portId);
    case "serial.read":
      return await readSerialPort(params.tabId, params.portId, params.length);
    case "serial.write":
      return await writeSerialPort(params.tabId, params.portId, params.data);

    // Gamepad API
    case "gamepad.getGamepads":
      return await getGamepads(params.tabId);
    case "gamepad.getState":
      return await getGamepadState(params.tabId, params.index);
    case "gamepad.vibrate":
      return await vibrateGamepad(params.tabId, params.index, params.options);
    case "gamepad.isSupported":
      return await isGamepadSupported(params.tabId);

    // Web MIDI API
    case "midi.requestAccess":
      return await requestMIDIAccess(params.tabId, params.options);
    case "midi.getInputs":
      return await getMIDIInputs(params.tabId);
    case "midi.getOutputs":
      return await getMIDIOutputs(params.tabId);
    case "midi.send":
      return await sendMIDIMessage(params.tabId, params.outputId, params.data);
    case "midi.close":
      return await closeMIDIAccess(params.tabId);

    // Picture-in-Picture API
    case "pip.request":
      return await requestPictureInPicture(params.tabId, params.selector);
    case "pip.exit":
      return await exitPictureInPicture(params.tabId);
    case "pip.getWindow":
      return await getPictureInPictureWindow(params.tabId);
    case "pip.isEnabled":
      return await isPictureInPictureEnabled(params.tabId);
    case "pip.isSupported":
      return await isPictureInPictureSupported(params.tabId);

    // Document Picture-in-Picture API
    case "documentPip.request":
      return await requestDocumentPictureInPicture(
        params.tabId,
        params.options,
      );
    case "documentPip.getWindow":
      return await getDocumentPictureInPictureWindow(params.tabId);

    // Web Locks API
    case "locks.request":
      return await requestLock(params.tabId, params.name, params.options);
    case "locks.query":
      return await queryLocks(params.tabId);
    case "locks.release":
      return await releaseLock(params.tabId, params.name);
    case "locks.isSupported":
      return await isLocksSupported(params.tabId);

    // Badging API
    case "badge.set":
      return await setBadge(params.tabId, params.contents);
    case "badge.clear":
      return await clearBadge(params.tabId);
    case "badge.isSupported":
      return await isBadgeSupported(params.tabId);

    // Local Font Access API
    case "fonts.query":
      return await queryLocalFonts(params.tabId, params.options);
    case "fonts.getPostscriptNames":
      return await getFontPostscriptNames(params.tabId);
    case "fonts.isSupported":
      return await isLocalFontsSupported(params.tabId);

    // Window Management API
    case "screens.getScreens":
      return await getScreenDetails(params.tabId);
    case "screens.getCurrentScreen":
      return await getCurrentScreen(params.tabId);
    case "screens.isMultiScreen":
      return await isMultiScreenEnvironment(params.tabId);
    case "screens.requestPermission":
      return await requestScreensPermission(params.tabId);
    case "screens.getScreenById":
      return await getScreenById(params.tabId, params.screenId);

    // Compute Pressure API
    case "pressure.observe":
      return await observeComputePressure(params.tabId, params.source);
    case "pressure.unobserve":
      return await unobserveComputePressure(params.tabId);
    case "pressure.getState":
      return await getComputePressureState(params.tabId);
    case "pressure.isSupported":
      return await isComputePressureSupported(params.tabId);

    // ==================== Phase 25: Detection, Media & Navigation APIs ====================

    // Barcode Detection API
    case "barcode.detect":
      return await detectBarcodes(params.tabId, params.imageSource);
    case "barcode.getSupportedFormats":
      return await getSupportedBarcodeFormats(params.tabId);
    case "barcode.isSupported":
      return await isBarcodeDetectorSupported(params.tabId);

    // Shape Detection API - Face Detection
    case "faceDetection.detect":
      return await detectFaces(params.tabId, params.imageSource);
    case "faceDetection.isSupported":
      return await isFaceDetectorSupported(params.tabId);

    // Shape Detection API - Text Detection
    case "textDetection.detect":
      return await detectText(params.tabId, params.imageSource);
    case "textDetection.isSupported":
      return await isTextDetectorSupported(params.tabId);

    // Web Codecs API - Video
    case "videoCodecs.getConfig":
      return await getVideoDecoderConfig(params.tabId, params.config);
    case "videoCodecs.isConfigSupported":
      return await isVideoConfigSupported(params.tabId, params.config);
    case "videoCodecs.getSupportedCodecs":
      return await getSupportedVideoCodecs(params.tabId);

    // Web Codecs API - Audio
    case "audioCodecs.getConfig":
      return await getAudioDecoderConfig(params.tabId, params.config);
    case "audioCodecs.isConfigSupported":
      return await isAudioConfigSupported(params.tabId, params.config);
    case "audioCodecs.getSupportedCodecs":
      return await getSupportedAudioCodecs(params.tabId);

    // Media Session API
    case "mediaSession.setMetadata":
      return await setMediaSessionMetadata(params.tabId, params.metadata);
    case "mediaSession.setPlaybackState":
      return await setMediaSessionPlaybackState(params.tabId, params.state);
    case "mediaSession.setPositionState":
      return await setMediaSessionPositionState(params.tabId, params.state);
    case "mediaSession.setActionHandler":
      return await setMediaSessionActionHandler(
        params.tabId,
        params.action,
        params.enabled,
      );
    case "mediaSession.getMetadata":
      return await getMediaSessionMetadata(params.tabId);

    // Background Fetch API
    case "backgroundFetch.fetch":
      return await backgroundFetch(
        params.tabId,
        params.id,
        params.requests,
        params.options,
      );
    case "backgroundFetch.get":
      return await getBackgroundFetch(params.tabId, params.id);
    case "backgroundFetch.getIds":
      return await getBackgroundFetchIds(params.tabId);
    case "backgroundFetch.abort":
      return await abortBackgroundFetch(params.tabId, params.id);
    case "backgroundFetch.isSupported":
      return await isBackgroundFetchSupported(params.tabId);

    // Compression Streams API
    case "compression.compress":
      return await compressData(params.tabId, params.data, params.format);
    case "compression.decompress":
      return await decompressData(params.tabId, params.data, params.format);
    case "compression.getSupportedFormats":
      return await getSupportedCompressionFormats(params.tabId);
    case "compression.isSupported":
      return await isCompressionSupported(params.tabId);

    // Navigation API
    case "navigation.navigate":
      return await navigationNavigate(params.tabId, params.url, params.options);
    case "navigation.reload":
      return await navigationReload(params.tabId, params.options);
    case "navigation.traverseTo":
      return await navigationTraverseTo(params.tabId, params.key);
    case "navigation.getEntries":
      return await getNavigationEntries(params.tabId);
    case "navigation.getCurrentEntry":
      return await getCurrentNavigationEntry(params.tabId);
    case "navigation.canGoBack":
      return await canNavigationGoBack(params.tabId);
    case "navigation.canGoForward":
      return await canNavigationGoForward(params.tabId);

    // View Transitions API
    case "viewTransition.start":
      return await startViewTransition(params.tabId, params.options);
    case "viewTransition.getState":
      return await getViewTransitionState(params.tabId);
    case "viewTransition.skipTransition":
      return await skipViewTransition(params.tabId);
    case "viewTransition.isSupported":
      return await isViewTransitionSupported(params.tabId);

    // Sanitizer API
    case "sanitizer.sanitize":
      return await sanitizeHTML(params.tabId, params.input, params.options);
    case "sanitizer.getDefaultConfig":
      return await getSanitizerDefaultConfig(params.tabId);
    case "sanitizer.isSupported":
      return await isSanitizerSupported(params.tabId);

    // Popover API
    case "popover.show":
      return await showPopover(params.tabId, params.selector);
    case "popover.hide":
      return await hidePopover(params.tabId, params.selector);
    case "popover.toggle":
      return await togglePopover(params.tabId, params.selector, params.force);
    case "popover.isSupported":
      return await isPopoverSupported(params.tabId);

    // Highlight API
    case "highlight.create":
      return await createHighlight(params.tabId, params.ranges, params.name);
    case "highlight.delete":
      return await deleteHighlight(params.tabId, params.name);
    case "highlight.getAll":
      return await getAllHighlights(params.tabId);
    case "highlight.clear":
      return await clearAllHighlights(params.tabId);

    // EditContext API
    case "editContext.create":
      return await createEditContext(
        params.tabId,
        params.selector,
        params.options,
      );
    case "editContext.updateText":
      return await updateEditContextText(
        params.tabId,
        params.text,
        params.start,
        params.end,
      );
    case "editContext.getState":
      return await getEditContextState(params.tabId);
    case "editContext.isSupported":
      return await isEditContextSupported(params.tabId);

    // ==================== Phase 26: Reader Mode & Article Extraction ====================

    case "article.extract":
      return await extractArticle(params.tabId);
    case "article.getReadable":
      return await getReadableContent(params.tabId, params.options);
    case "article.getMetadata":
      return await extractArticleMetadata(params.tabId);

    // ==================== Phase 27: Web Annotation ====================

    case "annotation.highlight":
      return await highlightSelection(params.tabId, params.options);
    case "annotation.add":
      return await addAnnotation(params.tabId, params.annotation);
    case "annotation.getAll":
      return await getAnnotations(params.tabId);
    case "annotation.remove":
      return await removeAnnotation(params.tabId, params.annotationId);
    case "annotation.clear":
      return await clearAnnotations(params.tabId);
    case "annotation.export":
      return await exportAnnotations(params.tabId, params.format);

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
          args: params.args.map(
            (arg) => arg.value || arg.description || arg.type,
          ),
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
        return {
          databases: databases.map((db) => ({
            name: db.name,
            version: db.version,
          })),
        };
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
        domContentLoaded:
          timing.domContentLoadedEventEnd - timing.navigationStart,
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
      categories:
        "devtools.timeline,v8.execute,disabled-by-default-devtools.timeline",
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

        const computedRole =
          el.getAttribute("role") || el.tagName.toLowerCase();
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
          focusable:
            el.tabIndex >= 0 ||
            ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(el.tagName),
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

// ==================== Phase 17: WebSocket Debugging ====================

// Store WebSocket debugging state per tab
const webSocketState = new Map();

async function enableWebSocketDebugging(tabId) {
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

async function disableWebSocketDebugging(tabId) {
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

function getWebSocketConnections(tabId) {
  const state = webSocketState.get(tabId);
  if (!state) {
    return { connections: [] };
  }
  return {
    connections: Array.from(state.connections.values()),
  };
}

function getWebSocketMessages(tabId, connectionId) {
  const state = webSocketState.get(tabId);
  if (!state) {
    return { messages: [] };
  }
  const messages = state.messages.get(connectionId) || [];
  return { messages };
}

async function sendWebSocketMessage(tabId, connectionId, data) {
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

async function closeWebSocketConnection(tabId, connectionId) {
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

// Listen for WebSocket events via debugger
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

// ==================== Phase 17: Service Worker Management ====================

async function listServiceWorkers() {
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

async function getServiceWorkerInfo(registrationId) {
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

async function unregisterServiceWorker(tabId, scopeUrl) {
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

async function updateServiceWorker(tabId, scopeUrl) {
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

async function postMessageToServiceWorker(tabId, message) {
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

// ==================== Phase 17: Cache Storage ====================

async function listCaches(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        const cacheNames = await caches.keys();
        const cacheInfo = await Promise.all(
          cacheNames.map(async (name) => {
            const cache = await caches.open(name);
            const keys = await cache.keys();
            return { name, entryCount: keys.length };
          }),
        );
        return { caches: cacheInfo };
      },
    });
    return result[0]?.result || { caches: [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function listCacheEntries(tabId, cacheName) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (name) => {
        const cache = await caches.open(name);
        const requests = await cache.keys();
        return {
          entries: requests.map((req) => ({
            url: req.url,
            method: req.method,
            headers: Object.fromEntries(req.headers.entries()),
          })),
        };
      },
      args: [cacheName],
    });
    return result[0]?.result || { entries: [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function getCacheEntry(tabId, cacheName, url) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (name, reqUrl) => {
        const cache = await caches.open(name);
        const response = await cache.match(reqUrl);
        if (!response) return { error: "Entry not found" };
        const text = await response.text();
        return {
          url: reqUrl,
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          body: text.substring(0, 10000), // Limit body size
          bodyTruncated: text.length > 10000,
        };
      },
      args: [cacheName, url],
    });
    return result[0]?.result || { error: "Failed to get entry" };
  } catch (error) {
    return { error: error.message };
  }
}

async function deleteCacheEntry(tabId, cacheName, url) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (name, reqUrl) => {
        const cache = await caches.open(name);
        const deleted = await cache.delete(reqUrl);
        return { success: deleted };
      },
      args: [cacheName, url],
    });
    return result[0]?.result || { success: false };
  } catch (error) {
    return { error: error.message };
  }
}

async function deleteCache(tabId, cacheName) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (name) => {
        const deleted = await caches.delete(name);
        return { success: deleted };
      },
      args: [cacheName],
    });
    return result[0]?.result || { success: false };
  } catch (error) {
    return { error: error.message };
  }
}

async function addCacheEntry(tabId, cacheName, url, responseData) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (name, reqUrl, respData) => {
        const cache = await caches.open(name);
        const response = new Response(respData.body, {
          status: respData.status || 200,
          headers: respData.headers || {},
        });
        await cache.put(reqUrl, response);
        return { success: true };
      },
      args: [cacheName, url, responseData],
    });
    return result[0]?.result || { success: false };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 17: Security Info ====================

async function getCertificateInfo(tabId) {
  try {
    await ensureDebuggerAttached(tabId);
    const result = await chrome.debugger.sendCommand(
      { tabId },
      "Security.enable",
    );
    const securityState = await chrome.debugger.sendCommand(
      { tabId },
      "Security.getSecurityState",
    );
    return {
      securityState: securityState.securityState,
      schemeIsCryptographic: securityState.schemeIsCryptographic,
      explanations: securityState.explanations,
      insecureContentStatus: securityState.insecureContentStatus,
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function getSecurityState(tabId) {
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

async function checkMixedContent(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const resources = performance.getEntriesByType("resource");
        const mixedContent = {
          insecureResources: [],
          secureResources: [],
        };
        resources.forEach((res) => {
          if (res.name.startsWith("http://")) {
            mixedContent.insecureResources.push({
              url: res.name,
              type: res.initiatorType,
            });
          } else if (res.name.startsWith("https://")) {
            mixedContent.secureResources.push(res.name);
          }
        });
        mixedContent.hasMixedContent =
          mixedContent.insecureResources.length > 0;
        return mixedContent;
      },
    });
    return result[0]?.result || { error: "Failed to check mixed content" };
  } catch (error) {
    return { error: error.message };
  }
}

async function getSitePermissions(tabId) {
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

// Helper function to ensure debugger is attached
async function ensureDebuggerAttached(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (error) {
    // Already attached is ok
    if (!error.message.includes("already attached")) {
      throw error;
    }
  }
}

// ==================== Phase 17: Animation Control ====================

async function listAnimations(tabId) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Animation.enable");

    // Get current animations via page execution
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const animations = document.getAnimations();
        return animations.map((anim, index) => ({
          id: anim.id || `anim-${index}`,
          playState: anim.playState,
          currentTime: anim.currentTime,
          playbackRate: anim.playbackRate,
          effect: anim.effect
            ? {
                target: anim.effect.target?.tagName,
                targetSelector: anim.effect.target?.id
                  ? `#${anim.effect.target.id}`
                  : anim.effect.target?.className
                    ? `.${anim.effect.target.className.split(" ")[0]}`
                    : null,
              }
            : null,
        }));
      },
    });
    return { animations: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function pauseAnimation(tabId, animationId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (animId) => {
        const animations = document.getAnimations();
        const anim = animations.find(
          (a) => a.id === animId || animations.indexOf(a) === parseInt(animId),
        );
        if (anim) {
          anim.pause();
          return { success: true, playState: anim.playState };
        }
        return { error: "Animation not found" };
      },
      args: [animationId],
    });
    return result[0]?.result || { error: "Failed to pause" };
  } catch (error) {
    return { error: error.message };
  }
}

async function playAnimation(tabId, animationId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (animId) => {
        const animations = document.getAnimations();
        const anim = animations.find(
          (a) => a.id === animId || animations.indexOf(a) === parseInt(animId),
        );
        if (anim) {
          anim.play();
          return { success: true, playState: anim.playState };
        }
        return { error: "Animation not found" };
      },
      args: [animationId],
    });
    return result[0]?.result || { error: "Failed to play" };
  } catch (error) {
    return { error: error.message };
  }
}

async function setAnimationSpeed(tabId, animationId, playbackRate) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (animId, rate) => {
        const animations = document.getAnimations();
        const anim = animations.find(
          (a) => a.id === animId || animations.indexOf(a) === parseInt(animId),
        );
        if (anim) {
          anim.playbackRate = rate;
          return { success: true, playbackRate: anim.playbackRate };
        }
        return { error: "Animation not found" };
      },
      args: [animationId, playbackRate],
    });
    return result[0]?.result || { error: "Failed to set speed" };
  } catch (error) {
    return { error: error.message };
  }
}

async function seekAnimation(tabId, animationId, currentTime) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (animId, time) => {
        const animations = document.getAnimations();
        const anim = animations.find(
          (a) => a.id === animId || animations.indexOf(a) === parseInt(animId),
        );
        if (anim) {
          anim.currentTime = time;
          return { success: true, currentTime: anim.currentTime };
        }
        return { error: "Animation not found" };
      },
      args: [animationId, currentTime],
    });
    return result[0]?.result || { error: "Failed to seek" };
  } catch (error) {
    return { error: error.message };
  }
}

async function cancelAnimation(tabId, animationId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (animId) => {
        const animations = document.getAnimations();
        const anim = animations.find(
          (a) => a.id === animId || animations.indexOf(a) === parseInt(animId),
        );
        if (anim) {
          anim.cancel();
          return { success: true };
        }
        return { error: "Animation not found" };
      },
      args: [animationId],
    });
    return result[0]?.result || { error: "Failed to cancel" };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 17: Layout Inspection ====================

async function getBoxModel(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const el = document.querySelector(sel);
        if (!el) return { error: "Element not found" };

        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);

        return {
          content: {
            x:
              rect.left +
              parseFloat(style.paddingLeft) +
              parseFloat(style.borderLeftWidth),
            y:
              rect.top +
              parseFloat(style.paddingTop) +
              parseFloat(style.borderTopWidth),
            width:
              rect.width -
              parseFloat(style.paddingLeft) -
              parseFloat(style.paddingRight) -
              parseFloat(style.borderLeftWidth) -
              parseFloat(style.borderRightWidth),
            height:
              rect.height -
              parseFloat(style.paddingTop) -
              parseFloat(style.paddingBottom) -
              parseFloat(style.borderTopWidth) -
              parseFloat(style.borderBottomWidth),
          },
          padding: {
            top: parseFloat(style.paddingTop),
            right: parseFloat(style.paddingRight),
            bottom: parseFloat(style.paddingBottom),
            left: parseFloat(style.paddingLeft),
          },
          border: {
            top: parseFloat(style.borderTopWidth),
            right: parseFloat(style.borderRightWidth),
            bottom: parseFloat(style.borderBottomWidth),
            left: parseFloat(style.borderLeftWidth),
          },
          margin: {
            top: parseFloat(style.marginTop),
            right: parseFloat(style.marginRight),
            bottom: parseFloat(style.marginBottom),
            left: parseFloat(style.marginLeft),
          },
          boundingRect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
        };
      },
      args: [selector],
    });
    return result[0]?.result || { error: "Failed to get box model" };
  } catch (error) {
    return { error: error.message };
  }
}

async function getComputedLayout(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const el = document.querySelector(sel);
        if (!el) return { error: "Element not found" };

        const style = getComputedStyle(el);
        return {
          display: style.display,
          position: style.position,
          float: style.float,
          clear: style.clear,
          overflow: style.overflow,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
          zIndex: style.zIndex,
          flexDirection: style.flexDirection,
          flexWrap: style.flexWrap,
          justifyContent: style.justifyContent,
          alignItems: style.alignItems,
          gridTemplateColumns: style.gridTemplateColumns,
          gridTemplateRows: style.gridTemplateRows,
          gap: style.gap,
          width: style.width,
          height: style.height,
          minWidth: style.minWidth,
          maxWidth: style.maxWidth,
          minHeight: style.minHeight,
          maxHeight: style.maxHeight,
        };
      },
      args: [selector],
    });
    return result[0]?.result || { error: "Failed to get layout" };
  } catch (error) {
    return { error: error.message };
  }
}

async function highlightNode(tabId, selector, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel, opts) => {
        const el = document.querySelector(sel);
        if (!el) return { error: "Element not found" };

        // Remove existing highlight
        const existing = document.getElementById("__chainless_highlight__");
        if (existing) existing.remove();

        const rect = el.getBoundingClientRect();
        const highlight = document.createElement("div");
        highlight.id = "__chainless_highlight__";
        highlight.style.cssText = `
          position: fixed;
          left: ${rect.left}px;
          top: ${rect.top}px;
          width: ${rect.width}px;
          height: ${rect.height}px;
          background: ${opts.backgroundColor || "rgba(111, 168, 220, 0.66)"};
          border: ${opts.border || "2px solid rgb(111, 168, 220)"};
          pointer-events: none;
          z-index: 999999;
          box-sizing: border-box;
        `;
        document.body.appendChild(highlight);

        if (opts.showInfo !== false) {
          const info = document.createElement("div");
          info.style.cssText = `
            position: fixed;
            left: ${rect.left}px;
            top: ${Math.max(0, rect.top - 25)}px;
            background: rgb(111, 168, 220);
            color: white;
            padding: 2px 6px;
            font-size: 12px;
            font-family: monospace;
            z-index: 1000000;
          `;
          info.textContent = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.className ? `.${el.className.split(" ")[0]}` : ""} | ${Math.round(rect.width)}×${Math.round(rect.height)}`;
          highlight.appendChild(info);
        }

        return { success: true };
      },
      args: [selector, options],
    });
    return result[0]?.result || { error: "Failed to highlight" };
  } catch (error) {
    return { error: error.message };
  }
}

async function hideHighlight(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const highlight = document.getElementById("__chainless_highlight__");
        if (highlight) highlight.remove();
      },
    });
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

async function getNodeInfo(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const el = document.querySelector(sel);
        if (!el) return { error: "Element not found" };

        return {
          tagName: el.tagName.toLowerCase(),
          id: el.id,
          className: el.className,
          attributes: Array.from(el.attributes).map((attr) => ({
            name: attr.name,
            value: attr.value,
          })),
          childElementCount: el.childElementCount,
          textContent: el.textContent?.substring(0, 200),
          innerHTML: el.innerHTML?.substring(0, 500),
          outerHTML: el.outerHTML?.substring(0, 1000),
          parentSelector: el.parentElement
            ? `${el.parentElement.tagName.toLowerCase()}${el.parentElement.id ? `#${el.parentElement.id}` : ""}`
            : null,
          siblingCount: el.parentElement?.childElementCount || 0,
          indexAmongSiblings: el.parentElement
            ? Array.from(el.parentElement.children).indexOf(el)
            : -1,
        };
      },
      args: [selector],
    });
    return result[0]?.result || { error: "Failed to get node info" };
  } catch (error) {
    return { error: error.message };
  }
}

async function forceElementState(tabId, selector, state) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "DOM.enable");

    // Get the node ID
    const doc = await chrome.debugger.sendCommand({ tabId }, "DOM.getDocument");
    const nodeResult = await chrome.debugger.sendCommand(
      { tabId },
      "DOM.querySelector",
      {
        nodeId: doc.root.nodeId,
        selector: selector,
      },
    );

    if (!nodeResult.nodeId) {
      return { error: "Element not found" };
    }

    // Force the state
    await chrome.debugger.sendCommand({ tabId }, "CSS.enable");
    await chrome.debugger.sendCommand({ tabId }, "CSS.forcePseudoState", {
      nodeId: nodeResult.nodeId,
      forcedPseudoClasses: Array.isArray(state) ? state : [state],
    });

    return { success: true, forcedState: state };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 17: Coverage Analysis ====================

const coverageState = new Map();

async function startJSCoverage(tabId, options = {}) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Profiler.enable");
    await chrome.debugger.sendCommand(
      { tabId },
      "Profiler.startPreciseCoverage",
      {
        callCount: options.callCount !== false,
        detailed: options.detailed !== false,
      },
    );

    coverageState.set(`js-${tabId}`, { started: Date.now() });
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

async function stopJSCoverage(tabId) {
  try {
    const result = await chrome.debugger.sendCommand(
      { tabId },
      "Profiler.takePreciseCoverage",
    );
    await chrome.debugger.sendCommand(
      { tabId },
      "Profiler.stopPreciseCoverage",
    );

    const state = coverageState.get(`js-${tabId}`);
    coverageState.set(`js-${tabId}`, {
      ...state,
      result: result.result,
      stopped: Date.now(),
    });

    // Calculate summary
    let totalBytes = 0;
    let coveredBytes = 0;
    result.result.forEach((script) => {
      script.functions.forEach((fn) => {
        fn.ranges.forEach((range) => {
          const rangeSize = range.endOffset - range.startOffset;
          totalBytes += rangeSize;
          if (range.count > 0) {
            coveredBytes += rangeSize;
          }
        });
      });
    });

    return {
      success: true,
      summary: {
        totalScripts: result.result.length,
        totalBytes,
        coveredBytes,
        coveragePercent:
          totalBytes > 0 ? ((coveredBytes / totalBytes) * 100).toFixed(2) : 0,
      },
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function startCSSCoverage(tabId) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "CSS.enable");
    await chrome.debugger.sendCommand({ tabId }, "CSS.startRuleUsageTracking");

    coverageState.set(`css-${tabId}`, { started: Date.now() });
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

async function stopCSSCoverage(tabId) {
  try {
    const result = await chrome.debugger.sendCommand(
      { tabId },
      "CSS.stopRuleUsageTracking",
    );

    const state = coverageState.get(`css-${tabId}`);
    coverageState.set(`css-${tabId}`, {
      ...state,
      result: result.ruleUsage,
      stopped: Date.now(),
    });

    // Calculate summary
    const usedRules = result.ruleUsage.filter((r) => r.used).length;
    const totalRules = result.ruleUsage.length;

    return {
      success: true,
      summary: {
        totalRules,
        usedRules,
        unusedRules: totalRules - usedRules,
        coveragePercent:
          totalRules > 0 ? ((usedRules / totalRules) * 100).toFixed(2) : 0,
      },
    };
  } catch (error) {
    return { error: error.message };
  }
}

function getJSCoverageResults(tabId) {
  const state = coverageState.get(`js-${tabId}`);
  if (!state?.result) {
    return { error: "No JS coverage data available" };
  }
  return {
    scripts: state.result.map((script) => ({
      scriptId: script.scriptId,
      url: script.url,
      functions: script.functions.length,
    })),
    started: state.started,
    stopped: state.stopped,
  };
}

function getCSSCoverageResults(tabId) {
  const state = coverageState.get(`css-${tabId}`);
  if (!state?.result) {
    return { error: "No CSS coverage data available" };
  }
  return {
    rules: state.result.slice(0, 100), // Limit to first 100 rules
    totalRules: state.result.length,
    started: state.started,
    stopped: state.stopped,
  };
}

// ==================== Phase 17: Memory Profiling ====================

const memoryState = new Map();

async function getMemoryInfo(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (performance.memory) {
          return {
            jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
            totalJSHeapSize: performance.memory.totalJSHeapSize,
            usedJSHeapSize: performance.memory.usedJSHeapSize,
            usedPercent: (
              (performance.memory.usedJSHeapSize /
                performance.memory.jsHeapSizeLimit) *
              100
            ).toFixed(2),
          };
        }
        return {
          error:
            "Memory info not available (requires Chrome with --enable-precise-memory-info)",
        };
      },
    });
    return result[0]?.result || { error: "Failed to get memory info" };
  } catch (error) {
    return { error: error.message };
  }
}

async function takeHeapSnapshot(tabId) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "HeapProfiler.enable");

    let chunks = [];
    const listener = (source, method, params) => {
      if (
        source.tabId === tabId &&
        method === "HeapProfiler.addHeapSnapshotChunk"
      ) {
        chunks.push(params.chunk);
      }
    };

    chrome.debugger.onEvent.addListener(listener);

    await chrome.debugger.sendCommand(
      { tabId },
      "HeapProfiler.takeHeapSnapshot",
      {
        reportProgress: false,
      },
    );

    chrome.debugger.onEvent.removeListener(listener);

    const snapshot = chunks.join("");
    const snapshotSize = snapshot.length;

    // Store snapshot reference (don't store full data due to size)
    const snapshotId = `snapshot-${Date.now()}`;
    memoryState.set(snapshotId, {
      tabId,
      size: snapshotSize,
      timestamp: Date.now(),
    });

    return {
      success: true,
      snapshotId,
      size: snapshotSize,
      sizeFormatted: `${(snapshotSize / 1024 / 1024).toFixed(2)} MB`,
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function startMemorySampling(tabId, options = {}) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "HeapProfiler.enable");
    await chrome.debugger.sendCommand({ tabId }, "HeapProfiler.startSampling", {
      samplingInterval: options.samplingInterval || 32768,
    });

    memoryState.set(`sampling-${tabId}`, { started: Date.now() });
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

async function stopMemorySampling(tabId) {
  try {
    const result = await chrome.debugger.sendCommand(
      { tabId },
      "HeapProfiler.stopSampling",
    );

    const state = memoryState.get(`sampling-${tabId}`);
    memoryState.set(`sampling-${tabId}`, {
      ...state,
      result: result.profile,
      stopped: Date.now(),
    });

    // Calculate summary
    const samples = result.profile.samples || [];
    const totalSize = samples.reduce((sum, s) => sum + (s.size || 0), 0);

    return {
      success: true,
      summary: {
        sampleCount: samples.length,
        totalAllocatedSize: totalSize,
        duration: state ? Date.now() - state.started : 0,
      },
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function forceGarbageCollection(tabId) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "HeapProfiler.enable");
    await chrome.debugger.sendCommand({ tabId }, "HeapProfiler.collectGarbage");
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 18: DOM Mutation Observer ====================

const mutationState = new Map();

async function startMutationObserver(tabId, selector, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel, opts) => {
        // Clean up existing observer
        if (window.__chainlessMutationObserver) {
          window.__chainlessMutationObserver.disconnect();
        }
        window.__chainlessMutationLog = [];

        const target = sel ? document.querySelector(sel) : document.body;
        if (!target) return { error: "Target element not found" };

        const config = {
          attributes: opts.attributes !== false,
          childList: opts.childList !== false,
          subtree: opts.subtree !== false,
          characterData: opts.characterData || false,
          attributeOldValue: opts.attributeOldValue || false,
          characterDataOldValue: opts.characterDataOldValue || false,
        };

        window.__chainlessMutationObserver = new MutationObserver(
          (mutations) => {
            mutations.forEach((mutation) => {
              window.__chainlessMutationLog.push({
                type: mutation.type,
                target:
                  mutation.target.tagName +
                  (mutation.target.id ? `#${mutation.target.id}` : ""),
                attributeName: mutation.attributeName,
                oldValue: mutation.oldValue,
                addedNodes: mutation.addedNodes.length,
                removedNodes: mutation.removedNodes.length,
                timestamp: Date.now(),
              });
              // Keep log size manageable
              if (window.__chainlessMutationLog.length > 1000) {
                window.__chainlessMutationLog.shift();
              }
            });
          },
        );

        window.__chainlessMutationObserver.observe(target, config);
        return { success: true, targetSelector: sel || "body" };
      },
      args: [selector, options],
    });

    mutationState.set(tabId, { started: Date.now(), selector });
    return result[0]?.result || { error: "Failed to start observer" };
  } catch (error) {
    return { error: error.message };
  }
}

async function stopMutationObserver(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (window.__chainlessMutationObserver) {
          window.__chainlessMutationObserver.disconnect();
          window.__chainlessMutationObserver = null;
        }
      },
    });
    mutationState.delete(tabId);
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

function getMutationLog(tabId) {
  return chrome.scripting
    .executeScript({
      target: { tabId },
      func: () => {
        return {
          mutations: window.__chainlessMutationLog || [],
          count: window.__chainlessMutationLog?.length || 0,
        };
      },
    })
    .then((result) => result[0]?.result || { mutations: [] });
}

function clearMutationLog(tabId) {
  return chrome.scripting
    .executeScript({
      target: { tabId },
      func: () => {
        window.__chainlessMutationLog = [];
        return { success: true };
      },
    })
    .then((result) => result[0]?.result || { success: false });
}

// ==================== Phase 18: Event Listener Inspector ====================

const eventMonitorState = new Map();

async function getEventListeners(tabId, selector) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "DOM.enable");

    const doc = await chrome.debugger.sendCommand({ tabId }, "DOM.getDocument");
    const nodeResult = await chrome.debugger.sendCommand(
      { tabId },
      "DOM.querySelector",
      {
        nodeId: doc.root.nodeId,
        selector: selector,
      },
    );

    if (!nodeResult.nodeId) {
      return { error: "Element not found" };
    }

    await chrome.debugger.sendCommand({ tabId }, "DOMDebugger.enable");
    const listeners = await chrome.debugger.sendCommand(
      { tabId },
      "DOMDebugger.getEventListeners",
      {
        objectId: (
          await chrome.debugger.sendCommand({ tabId }, "DOM.resolveNode", {
            nodeId: nodeResult.nodeId,
          })
        ).object.objectId,
      },
    );

    return {
      listeners: listeners.listeners.map((l) => ({
        type: l.type,
        useCapture: l.useCapture,
        passive: l.passive,
        once: l.once,
        handler: l.handler?.description?.substring(0, 200),
        scriptId: l.scriptId,
        lineNumber: l.lineNumber,
        columnNumber: l.columnNumber,
      })),
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function removeEventListener(tabId, selector, eventType) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel, type) => {
        const el = document.querySelector(sel);
        if (!el) return { error: "Element not found" };

        // Clone and replace to remove all listeners
        const clone = el.cloneNode(true);
        el.parentNode.replaceChild(clone, el);
        return { success: true, eventType: type };
      },
      args: [selector, eventType],
    });
    return result[0]?.result || { error: "Failed to remove listener" };
  } catch (error) {
    return { error: error.message };
  }
}

async function startEventMonitor(tabId, selector, eventTypes = []) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel, types) => {
        window.__chainlessEventLog = [];

        const target = sel ? document.querySelector(sel) : document;
        if (sel && !target) return { error: "Target element not found" };

        const defaultTypes = [
          "click",
          "keydown",
          "keyup",
          "input",
          "change",
          "focus",
          "blur",
          "submit",
        ];
        const typesToMonitor = types.length > 0 ? types : defaultTypes;

        window.__chainlessEventHandlers = {};
        typesToMonitor.forEach((type) => {
          const handler = (event) => {
            window.__chainlessEventLog.push({
              type: event.type,
              target:
                event.target.tagName +
                (event.target.id ? `#${event.target.id}` : ""),
              timestamp: Date.now(),
              key: event.key,
              code: event.code,
              button: event.button,
              clientX: event.clientX,
              clientY: event.clientY,
              value: event.target.value?.substring?.(0, 100),
            });
            if (window.__chainlessEventLog.length > 500) {
              window.__chainlessEventLog.shift();
            }
          };
          window.__chainlessEventHandlers[type] = handler;
          target.addEventListener(type, handler, true);
        });

        return { success: true, monitoredTypes: typesToMonitor };
      },
      args: [selector, eventTypes],
    });

    eventMonitorState.set(tabId, { started: Date.now() });
    return result[0]?.result || { error: "Failed to start monitor" };
  } catch (error) {
    return { error: error.message };
  }
}

async function stopEventMonitor(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (window.__chainlessEventHandlers) {
          Object.entries(window.__chainlessEventHandlers).forEach(
            ([type, handler]) => {
              document.removeEventListener(type, handler, true);
            },
          );
          window.__chainlessEventHandlers = null;
        }
      },
    });
    eventMonitorState.delete(tabId);
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

function getEventLog(tabId) {
  return chrome.scripting
    .executeScript({
      target: { tabId },
      func: () => ({
        events: window.__chainlessEventLog || [],
        count: window.__chainlessEventLog?.length || 0,
      }),
    })
    .then((result) => result[0]?.result || { events: [] });
}

// ==================== Phase 18: Input Recording ====================

const inputRecordingState = new Map();

async function startInputRecording(tabId, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (opts) => {
        window.__chainlessInputRecording = {
          startTime: Date.now(),
          events: [],
          options: opts,
        };

        const recordEvent = (event) => {
          const rec = window.__chainlessInputRecording;
          if (!rec) return;

          rec.events.push({
            type: event.type,
            timestamp: Date.now() - rec.startTime,
            target: {
              tagName: event.target.tagName,
              id: event.target.id,
              className: event.target.className,
              selector: event.target.id
                ? `#${event.target.id}`
                : event.target.className
                  ? `.${event.target.className.split(" ")[0]}`
                  : event.target.tagName.toLowerCase(),
            },
            data: {
              key: event.key,
              code: event.code,
              keyCode: event.keyCode,
              button: event.button,
              clientX: event.clientX,
              clientY: event.clientY,
              value: event.target.value,
              checked: event.target.checked,
            },
          });
        };

        const eventTypes = opts.eventTypes || [
          "click",
          "dblclick",
          "keydown",
          "keyup",
          "input",
          "change",
          "focus",
          "blur",
        ];
        window.__chainlessInputHandlers = [];

        eventTypes.forEach((type) => {
          document.addEventListener(type, recordEvent, true);
          window.__chainlessInputHandlers.push({ type, handler: recordEvent });
        });

        return {
          success: true,
          startTime: window.__chainlessInputRecording.startTime,
        };
      },
      args: [options],
    });

    inputRecordingState.set(tabId, { started: Date.now() });
    return result[0]?.result || { error: "Failed to start recording" };
  } catch (error) {
    return { error: error.message };
  }
}

async function stopInputRecording(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (window.__chainlessInputHandlers) {
          window.__chainlessInputHandlers.forEach(({ type, handler }) => {
            document.removeEventListener(type, handler, true);
          });
          window.__chainlessInputHandlers = null;
        }

        const rec = window.__chainlessInputRecording;
        if (rec) {
          rec.endTime = Date.now();
          rec.duration = rec.endTime - rec.startTime;
        }

        return {
          success: true,
          eventCount: rec?.events?.length || 0,
          duration: rec?.duration || 0,
        };
      },
    });

    inputRecordingState.delete(tabId);
    return result[0]?.result || { error: "Failed to stop recording" };
  } catch (error) {
    return { error: error.message };
  }
}

function getInputRecording(tabId) {
  return chrome.scripting
    .executeScript({
      target: { tabId },
      func: () => window.__chainlessInputRecording || null,
    })
    .then((result) => result[0]?.result || null);
}

async function replayInputs(tabId, recording, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (rec, opts) => {
        const speed = opts.speed || 1;
        const events = rec.events || [];
        let replayed = 0;

        for (const event of events) {
          const delay = event.timestamp / speed;
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              delay - (events[replayed - 1]?.timestamp || 0) / speed,
            ),
          );

          const target =
            document.querySelector(event.target.selector) ||
            document.querySelector(
              event.target.id ? `#${event.target.id}` : event.target.tagName,
            );

          if (target) {
            if (event.type === "click" || event.type === "dblclick") {
              target.dispatchEvent(
                new MouseEvent(event.type, {
                  bubbles: true,
                  cancelable: true,
                  clientX: event.data.clientX,
                  clientY: event.data.clientY,
                  button: event.data.button,
                }),
              );
            } else if (event.type === "keydown" || event.type === "keyup") {
              target.dispatchEvent(
                new KeyboardEvent(event.type, {
                  bubbles: true,
                  cancelable: true,
                  key: event.data.key,
                  code: event.data.code,
                  keyCode: event.data.keyCode,
                }),
              );
            } else if (event.type === "input" || event.type === "change") {
              if (event.data.value !== undefined) {
                target.value = event.data.value;
              }
              if (event.data.checked !== undefined) {
                target.checked = event.data.checked;
              }
              target.dispatchEvent(new Event(event.type, { bubbles: true }));
            } else if (event.type === "focus") {
              target.focus();
            } else if (event.type === "blur") {
              target.blur();
            }
            replayed++;
          }
        }

        return { success: true, replayed, total: events.length };
      },
      args: [recording, options],
    });
    return result[0]?.result || { error: "Failed to replay" };
  } catch (error) {
    return { error: error.message };
  }
}

function clearInputRecording(tabId) {
  return chrome.scripting
    .executeScript({
      target: { tabId },
      func: () => {
        window.__chainlessInputRecording = null;
        return { success: true };
      },
    })
    .then((result) => result[0]?.result || { success: false });
}

// ==================== Phase 18: Media Emulation ====================

async function emulateColorScheme(tabId, scheme) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: scheme }],
    });
    return { success: true, colorScheme: scheme };
  } catch (error) {
    return { error: error.message };
  }
}

async function emulateReducedMotion(tabId, reduce) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Emulation.setEmulatedMedia", {
      features: [
        {
          name: "prefers-reduced-motion",
          value: reduce ? "reduce" : "no-preference",
        },
      ],
    });
    return { success: true, reducedMotion: reduce };
  } catch (error) {
    return { error: error.message };
  }
}

async function emulateForcedColors(tabId, forced) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Emulation.setEmulatedMedia", {
      features: [{ name: "forced-colors", value: forced ? "active" : "none" }],
    });
    return { success: true, forcedColors: forced };
  } catch (error) {
    return { error: error.message };
  }
}

async function emulateVisionDeficiency(tabId, type) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand(
      { tabId },
      "Emulation.setEmulatedVisionDeficiency",
      {
        type: type || "none", // none, achromatopsia, blurredVision, deuteranopia, protanopia, tritanopia
      },
    );
    return { success: true, visionDeficiency: type };
  } catch (error) {
    return { error: error.message };
  }
}

async function clearMediaEmulation(tabId) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Emulation.setEmulatedMedia", {
      media: "",
      features: [],
    });
    await chrome.debugger.sendCommand(
      { tabId },
      "Emulation.setEmulatedVisionDeficiency",
      {
        type: "none",
      },
    );
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 18: Page Lifecycle ====================

async function getPageLifecycleState(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        visibilityState: document.visibilityState,
        hidden: document.hidden,
        hasFocus: document.hasFocus(),
        readyState: document.readyState,
        wasDiscarded: document.wasDiscarded || false,
      }),
    });
    return result[0]?.result || { error: "Failed to get lifecycle state" };
  } catch (error) {
    return { error: error.message };
  }
}

async function subscribeLifecycleChanges(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        window.__chainlessLifecycleLog = [];

        const logChange = (type, data) => {
          window.__chainlessLifecycleLog.push({
            type,
            timestamp: Date.now(),
            ...data,
          });
        };

        document.addEventListener("visibilitychange", () => {
          logChange("visibilitychange", {
            visibilityState: document.visibilityState,
          });
        });

        window.addEventListener("focus", () => logChange("focus", {}));
        window.addEventListener("blur", () => logChange("blur", {}));
        window.addEventListener("freeze", () => logChange("freeze", {}));
        window.addEventListener("resume", () => logChange("resume", {}));
        window.addEventListener("pageshow", (e) =>
          logChange("pageshow", { persisted: e.persisted }),
        );
        window.addEventListener("pagehide", (e) =>
          logChange("pagehide", { persisted: e.persisted }),
        );

        return { success: true };
      },
    });
    return result[0]?.result || { error: "Failed to subscribe" };
  } catch (error) {
    return { error: error.message };
  }
}

async function freezePage(tabId) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Page.setWebLifecycleState", {
      state: "frozen",
    });
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

async function resumePage(tabId) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Page.setWebLifecycleState", {
      state: "active",
    });
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 18: Font Inspector ====================

async function getUsedFonts(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const fonts = new Set();
        const elements = document.querySelectorAll("*");

        elements.forEach((el) => {
          const style = getComputedStyle(el);
          const fontFamily = style.fontFamily;
          if (fontFamily) {
            fontFamily.split(",").forEach((font) => {
              fonts.add(font.trim().replace(/['"]/g, ""));
            });
          }
        });

        return {
          fonts: Array.from(fonts),
          count: fonts.size,
        };
      },
    });
    return result[0]?.result || { fonts: [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function getComputedFonts(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const el = document.querySelector(sel);
        if (!el) return { error: "Element not found" };

        const style = getComputedStyle(el);
        return {
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          fontStyle: style.fontStyle,
          fontVariant: style.fontVariant,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          textTransform: style.textTransform,
          fontFeatureSettings: style.fontFeatureSettings,
        };
      },
      args: [selector],
    });
    return result[0]?.result || { error: "Failed to get fonts" };
  } catch (error) {
    return { error: error.message };
  }
}

async function checkFontAvailability(tabId, fontFamily) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (family) => {
        try {
          const available = await document.fonts.check(`16px "${family}"`);
          const loaded = document.fonts.check(`16px "${family}"`);
          return { fontFamily: family, available, loaded };
        } catch {
          return {
            fontFamily: family,
            available: false,
            error: "Font check failed",
          };
        }
      },
      args: [fontFamily],
    });
    return result[0]?.result || { error: "Failed to check font" };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 18: Measurement Tools ====================

async function measureDistance(tabId, fromSelector, toSelector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (from, to) => {
        const el1 = document.querySelector(from);
        const el2 = document.querySelector(to);
        if (!el1 || !el2) return { error: "Element(s) not found" };

        const rect1 = el1.getBoundingClientRect();
        const rect2 = el2.getBoundingClientRect();

        const center1 = {
          x: rect1.left + rect1.width / 2,
          y: rect1.top + rect1.height / 2,
        };
        const center2 = {
          x: rect2.left + rect2.width / 2,
          y: rect2.top + rect2.height / 2,
        };

        const dx = center2.x - center1.x;
        const dy = center2.y - center1.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        return {
          from: { selector: from, center: center1 },
          to: { selector: to, center: center2 },
          distance: Math.round(distance * 100) / 100,
          horizontal: Math.round(Math.abs(dx) * 100) / 100,
          vertical: Math.round(Math.abs(dy) * 100) / 100,
        };
      },
      args: [fromSelector, toSelector],
    });
    return result[0]?.result || { error: "Failed to measure" };
  } catch (error) {
    return { error: error.message };
  }
}

async function measureElementSize(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const el = document.querySelector(sel);
        if (!el) return { error: "Element not found" };

        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);

        return {
          selector: sel,
          clientWidth: el.clientWidth,
          clientHeight: el.clientHeight,
          offsetWidth: el.offsetWidth,
          offsetHeight: el.offsetHeight,
          scrollWidth: el.scrollWidth,
          scrollHeight: el.scrollHeight,
          boundingRect: {
            width: rect.width,
            height: rect.height,
            top: rect.top,
            left: rect.left,
          },
          computed: {
            width: style.width,
            height: style.height,
            minWidth: style.minWidth,
            maxWidth: style.maxWidth,
          },
        };
      },
      args: [selector],
    });
    return result[0]?.result || { error: "Failed to measure" };
  } catch (error) {
    return { error: error.message };
  }
}

async function enableRuler(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (document.getElementById("__chainless_ruler__"))
          return { success: true };

        const ruler = document.createElement("div");
        ruler.id = "__chainless_ruler__";

        // Create horizontal ruler
        const hRuler = document.createElement("div");
        hRuler.style.cssText =
          "position:fixed;top:0;left:0;width:100%;height:20px;background:linear-gradient(90deg, transparent 0%, transparent 9px, #ccc 9px, #ccc 10px);background-size:10px 100%;z-index:999998;pointer-events:none;opacity:0.7;";
        ruler.appendChild(hRuler);

        // Create vertical ruler
        const vRuler = document.createElement("div");
        vRuler.style.cssText =
          "position:fixed;top:0;left:0;width:20px;height:100%;background:linear-gradient(180deg, transparent 0%, transparent 9px, #ccc 9px, #ccc 10px);background-size:100% 10px;z-index:999998;pointer-events:none;opacity:0.7;";
        ruler.appendChild(vRuler);

        // Create info display
        const rulerInfo = document.createElement("div");
        rulerInfo.id = "__chainless_ruler_info__";
        rulerInfo.style.cssText =
          "position:fixed;top:25px;left:25px;background:rgba(0,0,0,0.8);color:#fff;padding:5px 10px;font-size:12px;font-family:monospace;z-index:999999;pointer-events:none;display:none;";
        ruler.appendChild(rulerInfo);

        document.body.appendChild(ruler);

        const info = document.getElementById("__chainless_ruler_info__");
        document.addEventListener("mousemove", (e) => {
          info.style.display = "block";
          info.textContent = `X: ${e.clientX}px, Y: ${e.clientY}px`;
          info.style.left = `${e.clientX + 15}px`;
          info.style.top = `${e.clientY + 15}px`;
        });

        return { success: true };
      },
    });
    return result[0]?.result || { error: "Failed to enable ruler" };
  } catch (error) {
    return { error: error.message };
  }
}

async function disableRuler(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const ruler = document.getElementById("__chainless_ruler__");
        if (ruler) ruler.remove();
      },
    });
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 18: Color Picker ====================

async function pickColorFromPoint(tabId, x, y) {
  try {
    // Use canvas to get pixel color
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (px, py) => {
        // Create canvas from current view
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        // Try to use html2canvas if available, otherwise use a simple approach
        const element = document.elementFromPoint(px, py);
        if (!element) return { error: "No element at point" };

        const style = getComputedStyle(element);
        return {
          x: px,
          y: py,
          element: element.tagName + (element.id ? `#${element.id}` : ""),
          backgroundColor: style.backgroundColor,
          color: style.color,
          borderColor: style.borderColor,
        };
      },
      args: [x, y],
    });
    return result[0]?.result || { error: "Failed to pick color" };
  } catch (error) {
    return { error: error.message };
  }
}

async function getElementColors(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const el = document.querySelector(sel);
        if (!el) return { error: "Element not found" };

        const style = getComputedStyle(el);
        return {
          selector: sel,
          colors: {
            color: style.color,
            backgroundColor: style.backgroundColor,
            borderColor: style.borderColor,
            borderTopColor: style.borderTopColor,
            borderRightColor: style.borderRightColor,
            borderBottomColor: style.borderBottomColor,
            borderLeftColor: style.borderLeftColor,
            outlineColor: style.outlineColor,
            textDecorationColor: style.textDecorationColor,
            caretColor: style.caretColor,
          },
        };
      },
      args: [selector],
    });
    return result[0]?.result || { error: "Failed to get colors" };
  } catch (error) {
    return { error: error.message };
  }
}

async function enableColorPicker(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (window.__chainlessColorPicker) return { success: true };

        const overlay = document.createElement("div");
        overlay.id = "__chainless_color_picker__";
        overlay.style.cssText =
          "position:fixed;top:0;left:0;width:100%;height:100%;z-index:999997;cursor:crosshair;";

        const info = document.createElement("div");
        info.style.cssText =
          "position:fixed;background:rgba(0,0,0,0.9);color:#fff;padding:10px;font-size:12px;font-family:monospace;z-index:999999;display:none;border-radius:4px;";
        overlay.appendChild(info);

        overlay.addEventListener("mousemove", (e) => {
          const el = document.elementFromPoint(e.clientX, e.clientY);
          if (el && el !== overlay && el !== info) {
            const style = getComputedStyle(el);
            info.style.display = "block";
            info.style.left = `${e.clientX + 15}px`;
            info.style.top = `${e.clientY + 15}px`;
            // Clear previous content using DOM API (XSS safe)
            while (info.firstChild) info.removeChild(info.firstChild);
            // Create color preview box
            const colorBox = document.createElement("div");
            colorBox.style.cssText = `width:20px;height:20px;background:${style.backgroundColor};border:1px solid #fff;margin-bottom:5px;`;
            info.appendChild(colorBox);
            // Create text content
            const bgText = document.createTextNode(
              `BG: ${style.backgroundColor}`,
            );
            info.appendChild(bgText);
            info.appendChild(document.createElement("br"));
            const colorText = document.createTextNode(`Color: ${style.color}`);
            info.appendChild(colorText);
          }
        });

        overlay.addEventListener("click", (e) => {
          const el = document.elementFromPoint(e.clientX, e.clientY);
          if (el && el !== overlay) {
            const style = getComputedStyle(el);
            window.__chainlessPickedColor = {
              backgroundColor: style.backgroundColor,
              color: style.color,
              element: el.tagName,
            };
          }
          overlay.remove();
          window.__chainlessColorPicker = null;
        });

        document.body.appendChild(overlay);
        window.__chainlessColorPicker = overlay;
        return { success: true };
      },
    });
    return result[0]?.result || { error: "Failed to enable picker" };
  } catch (error) {
    return { error: error.message };
  }
}

async function disableColorPicker(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const picker = document.getElementById("__chainless_color_picker__");
        if (picker) picker.remove();
        window.__chainlessColorPicker = null;
      },
    });
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 18: Storage Inspector (Enhanced) ====================

async function getStorageQuota(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (navigator.storage && navigator.storage.estimate) {
          const estimate = await navigator.storage.estimate();
          return {
            quota: estimate.quota,
            usage: estimate.usage,
            usagePercent: ((estimate.usage / estimate.quota) * 100).toFixed(2),
            quotaFormatted: `${(estimate.quota / 1024 / 1024 / 1024).toFixed(2)} GB`,
            usageFormatted: `${(estimate.usage / 1024 / 1024).toFixed(2)} MB`,
          };
        }
        return { error: "Storage API not available" };
      },
    });
    return result[0]?.result || { error: "Failed to get quota" };
  } catch (error) {
    return { error: error.message };
  }
}

async function getStorageUsage(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const usage = {
          localStorage: {
            items: localStorage.length,
            size: new Blob(Object.values(localStorage)).size,
          },
          sessionStorage: {
            items: sessionStorage.length,
            size: new Blob(Object.values(sessionStorage)).size,
          },
        };

        // Estimate cookie size
        usage.cookies = {
          size: document.cookie.length,
        };

        return usage;
      },
    });
    return result[0]?.result || { error: "Failed to get usage" };
  } catch (error) {
    return { error: error.message };
  }
}

async function exportAllStorage(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const data = {
          localStorage: {},
          sessionStorage: {},
          exportedAt: Date.now(),
          origin: window.location.origin,
        };

        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          data.localStorage[key] = localStorage.getItem(key);
        }

        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          data.sessionStorage[key] = sessionStorage.getItem(key);
        }

        return data;
      },
    });
    return result[0]?.result || { error: "Failed to export" };
  } catch (error) {
    return { error: error.message };
  }
}

async function importAllStorage(tabId, data) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (importData) => {
        let imported = { localStorage: 0, sessionStorage: 0 };

        if (importData.localStorage) {
          Object.entries(importData.localStorage).forEach(([key, value]) => {
            localStorage.setItem(key, value);
            imported.localStorage++;
          });
        }

        if (importData.sessionStorage) {
          Object.entries(importData.sessionStorage).forEach(([key, value]) => {
            sessionStorage.setItem(key, value);
            imported.sessionStorage++;
          });
        }

        return { success: true, imported };
      },
      args: [data],
    });
    return result[0]?.result || { error: "Failed to import" };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 19: Network Throttling ====================

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

async function setNetworkThrottling(tabId, conditions) {
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

async function clearNetworkThrottling(tabId) {
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

function getThrottlingProfiles() {
  return {
    profiles: Object.keys(THROTTLING_PROFILES).map((name) => ({
      name,
      ...THROTTLING_PROFILES[name],
    })),
  };
}

async function setOfflineMode(tabId, offline) {
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

// ==================== Phase 19: Device Emulation ====================

async function setUserAgent(tabId, userAgent, platform) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand(
      { tabId },
      "Emulation.setUserAgentOverride",
      {
        userAgent: userAgent,
        platform: platform || "",
      },
    );
    return { success: true, userAgent };
  } catch (error) {
    return { error: error.message };
  }
}

async function getUserAgent(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        vendor: navigator.vendor,
        language: navigator.language,
        languages: navigator.languages,
      }),
    });
    return result[0]?.result || { error: "Failed to get user agent" };
  } catch (error) {
    return { error: error.message };
  }
}

async function setTimezone(tabId, timezoneId) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand(
      { tabId },
      "Emulation.setTimezoneOverride",
      {
        timezoneId: timezoneId,
      },
    );
    return { success: true, timezoneId };
  } catch (error) {
    return { error: error.message };
  }
}

async function setLocale(tabId, locale) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand(
      { tabId },
      "Emulation.setLocaleOverride",
      {
        locale: locale,
      },
    );
    return { success: true, locale };
  } catch (error) {
    return { error: error.message };
  }
}

async function setGeolocationOverride(tabId, latitude, longitude, accuracy) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand(
      { tabId },
      "Emulation.setGeolocationOverride",
      {
        latitude: latitude,
        longitude: longitude,
        accuracy: accuracy || 100,
      },
    );
    return { success: true, latitude, longitude, accuracy };
  } catch (error) {
    return { error: error.message };
  }
}

async function clearGeolocationOverride(tabId) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand(
      { tabId },
      "Emulation.clearGeolocationOverride",
    );
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 19: Touch Emulation ====================

async function enableTouchEmulation(tabId, options = {}) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand(
      { tabId },
      "Emulation.setTouchEmulationEnabled",
      {
        enabled: true,
        maxTouchPoints: options.maxTouchPoints || 5,
      },
    );
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

async function disableTouchEmulation(tabId) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand(
      { tabId },
      "Emulation.setTouchEmulationEnabled",
      {
        enabled: false,
      },
    );
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

async function emulateTap(tabId, x, y, options = {}) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    await new Promise((resolve) => setTimeout(resolve, options.duration || 50));
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    return { success: true, x, y };
  } catch (error) {
    return { error: error.message };
  }
}

async function emulateSwipe(tabId, startX, startY, endX, endY, options = {}) {
  try {
    await ensureDebuggerAttached(tabId);
    const steps = options.steps || 10;
    const duration = options.duration || 300;
    const stepDelay = duration / steps;

    // Touch start
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: startX, y: startY }],
    });

    // Touch move in steps
    for (let i = 1; i <= steps; i++) {
      const progress = i / steps;
      const x = startX + (endX - startX) * progress;
      const y = startY + (endY - startY) * progress;
      await new Promise((resolve) => setTimeout(resolve, stepDelay));
      await chrome.debugger.sendCommand({ tabId }, "Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y }],
      });
    }

    // Touch end
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });

    return {
      success: true,
      from: { x: startX, y: startY },
      to: { x: endX, y: endY },
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function emulatePinch(tabId, x, y, scale, options = {}) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand(
      { tabId },
      "Input.synthesizePinchGesture",
      {
        x: x,
        y: y,
        scaleFactor: scale,
        relativeSpeed: options.speed || 800,
        gestureSourceType: "touch",
      },
    );
    return { success: true, x, y, scale };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 19: Sensor Emulation ====================

async function setSensorOrientation(tabId, alpha, beta, gamma) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand(
      { tabId },
      "DeviceOrientation.setDeviceOrientationOverride",
      {
        alpha: alpha || 0,
        beta: beta || 0,
        gamma: gamma || 0,
      },
    );
    return { success: true, alpha, beta, gamma };
  } catch (error) {
    return { error: error.message };
  }
}

async function setAccelerometer(tabId, x, y, z) {
  try {
    await ensureDebuggerAttached(tabId);
    // Use page script to override accelerometer
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (ax, ay, az) => {
        if (window.DeviceMotionEvent) {
          window.__chainlessAccel = { x: ax, y: ay, z: az };
          // Override accelerometer via page script
          return { success: true, note: "Accelerometer override set" };
        }
        return { error: "DeviceMotionEvent not supported" };
      },
      args: [x, y, z],
    });
    return result[0]?.result || { error: "Failed to set accelerometer" };
  } catch (error) {
    return { error: error.message };
  }
}

async function setAmbientLight(tabId, illuminance) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (lux) => {
        window.__chainlessAmbientLight = { illuminance: lux };
        return { success: true, illuminance: lux };
      },
      args: [illuminance],
    });
    return result[0]?.result || { error: "Failed to set ambient light" };
  } catch (error) {
    return { error: error.message };
  }
}

async function clearSensorOverrides(tabId) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand(
      { tabId },
      "DeviceOrientation.clearDeviceOrientationOverride",
    );
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        delete window.__chainlessAccel;
        delete window.__chainlessAmbientLight;
      },
    });
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 19: Viewport Management ====================

const VIEWPORT_PRESETS = {
  "iphone-se": { width: 375, height: 667, deviceScaleFactor: 2, mobile: true },
  "iphone-12": { width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
  "iphone-14-pro": {
    width: 393,
    height: 852,
    deviceScaleFactor: 3,
    mobile: true,
  },
  "pixel-5": { width: 393, height: 851, deviceScaleFactor: 2.75, mobile: true },
  "samsung-s21": {
    width: 360,
    height: 800,
    deviceScaleFactor: 3,
    mobile: true,
  },
  "ipad-mini": { width: 768, height: 1024, deviceScaleFactor: 2, mobile: true },
  "ipad-pro-11": {
    width: 834,
    height: 1194,
    deviceScaleFactor: 2,
    mobile: true,
  },
  "ipad-pro-12": {
    width: 1024,
    height: 1366,
    deviceScaleFactor: 2,
    mobile: true,
  },
  "desktop-hd": {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  },
  "desktop-fhd": {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  },
  "desktop-2k": {
    width: 2560,
    height: 1440,
    deviceScaleFactor: 1,
    mobile: false,
  },
};

async function setViewport(tabId, width, height, options = {}) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand(
      { tabId },
      "Emulation.setDeviceMetricsOverride",
      {
        width: width,
        height: height,
        deviceScaleFactor: options.deviceScaleFactor || 1,
        mobile: options.mobile || false,
        screenWidth: width,
        screenHeight: height,
      },
    );
    return { success: true, width, height };
  } catch (error) {
    return { error: error.message };
  }
}

async function getViewport(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        screenWidth: screen.width,
        screenHeight: screen.height,
        devicePixelRatio: window.devicePixelRatio,
        availWidth: screen.availWidth,
        availHeight: screen.availHeight,
      }),
    });
    return result[0]?.result || { error: "Failed to get viewport" };
  } catch (error) {
    return { error: error.message };
  }
}

async function setDeviceMetricsOverride(tabId, metrics) {
  try {
    await ensureDebuggerAttached(tabId);

    // If metrics is a string, look up preset
    const preset =
      typeof metrics === "string" ? VIEWPORT_PRESETS[metrics] : metrics;

    if (!preset) {
      return { error: `Unknown viewport preset: ${metrics}` };
    }

    await chrome.debugger.sendCommand(
      { tabId },
      "Emulation.setDeviceMetricsOverride",
      {
        width: preset.width,
        height: preset.height,
        deviceScaleFactor: preset.deviceScaleFactor || 1,
        mobile: preset.mobile || false,
        screenWidth: preset.width,
        screenHeight: preset.height,
      },
    );

    if (preset.mobile) {
      await chrome.debugger.sendCommand(
        { tabId },
        "Emulation.setTouchEmulationEnabled",
        {
          enabled: true,
          maxTouchPoints: 5,
        },
      );
    }

    return {
      success: true,
      preset: typeof metrics === "string" ? metrics : "custom",
      ...preset,
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function clearDeviceMetricsOverride(tabId) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand(
      { tabId },
      "Emulation.clearDeviceMetricsOverride",
    );
    await chrome.debugger.sendCommand(
      { tabId },
      "Emulation.setTouchEmulationEnabled",
      {
        enabled: false,
      },
    );
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
}

function getViewportPresets() {
  return {
    presets: Object.keys(VIEWPORT_PRESETS).map((name) => ({
      name,
      ...VIEWPORT_PRESETS[name],
    })),
  };
}

// ==================== Phase 19: Screenshot Comparison ====================

async function captureScreenshot(tabId, options = {}) {
  try {
    await ensureDebuggerAttached(tabId);
    const result = await chrome.debugger.sendCommand(
      { tabId },
      "Page.captureScreenshot",
      {
        format: options.format || "png",
        quality: options.quality || 100,
        fromSurface: true,
      },
    );
    return {
      success: true,
      data: result.data,
      format: options.format || "png",
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function captureElementScreenshot(tabId, selector, options = {}) {
  try {
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, "DOM.enable");

    const doc = await chrome.debugger.sendCommand({ tabId }, "DOM.getDocument");
    const nodeResult = await chrome.debugger.sendCommand(
      { tabId },
      "DOM.querySelector",
      {
        nodeId: doc.root.nodeId,
        selector: selector,
      },
    );

    if (!nodeResult.nodeId) {
      return { error: "Element not found" };
    }

    const boxModel = await chrome.debugger.sendCommand(
      { tabId },
      "DOM.getBoxModel",
      {
        nodeId: nodeResult.nodeId,
      },
    );

    const content = boxModel.model.content;
    const clip = {
      x: content[0],
      y: content[1],
      width: content[2] - content[0],
      height: content[5] - content[1],
      scale: 1,
    };

    const result = await chrome.debugger.sendCommand(
      { tabId },
      "Page.captureScreenshot",
      {
        format: options.format || "png",
        quality: options.quality || 100,
        clip: clip,
        fromSurface: true,
      },
    );

    return {
      success: true,
      data: result.data,
      format: options.format || "png",
      clip,
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function compareScreenshots(baseline, current, options = {}) {
  try {
    // Simple pixel comparison (basic implementation)
    // In production, use a proper image comparison library
    const result = await chrome.scripting.executeScript({
      target: {
        tabId: (
          await chrome.tabs.query({ active: true, currentWindow: true })
        )[0].id,
      },
      func: async (base, curr, opts) => {
        // Create canvas for comparison
        const loadImage = (data) => {
          return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.src = `data:image/png;base64,${data}`;
          });
        };

        const img1 = await loadImage(base);
        const img2 = await loadImage(curr);

        const canvas1 = document.createElement("canvas");
        const canvas2 = document.createElement("canvas");
        canvas1.width = img1.width;
        canvas1.height = img1.height;
        canvas2.width = img2.width;
        canvas2.height = img2.height;

        const ctx1 = canvas1.getContext("2d");
        const ctx2 = canvas2.getContext("2d");
        ctx1.drawImage(img1, 0, 0);
        ctx2.drawImage(img2, 0, 0);

        const data1 = ctx1.getImageData(0, 0, canvas1.width, canvas1.height);
        const data2 = ctx2.getImageData(0, 0, canvas2.width, canvas2.height);

        if (data1.data.length !== data2.data.length) {
          return { match: false, reason: "Different dimensions" };
        }

        let diffPixels = 0;
        const threshold = opts.threshold || 0;

        for (let i = 0; i < data1.data.length; i += 4) {
          const diff =
            Math.abs(data1.data[i] - data2.data[i]) +
            Math.abs(data1.data[i + 1] - data2.data[i + 1]) +
            Math.abs(data1.data[i + 2] - data2.data[i + 2]);
          if (diff > threshold * 3) {
            diffPixels++;
          }
        }

        const totalPixels = data1.data.length / 4;
        const diffPercent = (diffPixels / totalPixels) * 100;

        return {
          match: diffPercent <= (opts.maxDiffPercent || 0),
          diffPixels,
          totalPixels,
          diffPercent: diffPercent.toFixed(2),
        };
      },
      args: [baseline, current, options],
    });

    return result[0]?.result || { error: "Comparison failed" };
  } catch (error) {
    return { error: error.message };
  }
}

async function captureFullPageScreenshot(tabId, options = {}) {
  try {
    await ensureDebuggerAttached(tabId);

    // Get full page dimensions
    const layoutMetrics = await chrome.debugger.sendCommand(
      { tabId },
      "Page.getLayoutMetrics",
    );

    const contentSize = layoutMetrics.contentSize;

    // Set viewport to full page size
    await chrome.debugger.sendCommand(
      { tabId },
      "Emulation.setDeviceMetricsOverride",
      {
        width: Math.ceil(contentSize.width),
        height: Math.ceil(contentSize.height),
        deviceScaleFactor: 1,
        mobile: false,
      },
    );

    // Capture screenshot
    const result = await chrome.debugger.sendCommand(
      { tabId },
      "Page.captureScreenshot",
      {
        format: options.format || "png",
        quality: options.quality || 100,
        fromSurface: true,
        captureBeyondViewport: true,
      },
    );

    // Reset viewport
    await chrome.debugger.sendCommand(
      { tabId },
      "Emulation.clearDeviceMetricsOverride",
    );

    return {
      success: true,
      data: result.data,
      format: options.format || "png",
      dimensions: {
        width: Math.ceil(contentSize.width),
        height: Math.ceil(contentSize.height),
      },
    };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 19: Advanced Clipboard ====================

async function readRichClipboard(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        try {
          const items = await navigator.clipboard.read();
          const contents = [];

          for (const item of items) {
            for (const type of item.types) {
              const blob = await item.getType(type);
              if (type.startsWith("text/")) {
                const text = await blob.text();
                contents.push({ type, content: text.substring(0, 10000) });
              } else if (type.startsWith("image/")) {
                const arrayBuffer = await blob.arrayBuffer();
                const base64 = btoa(
                  String.fromCharCode(...new Uint8Array(arrayBuffer)),
                );
                contents.push({
                  type,
                  content: base64.substring(0, 1000) + "...",
                  size: blob.size,
                });
              } else {
                contents.push({ type, size: blob.size });
              }
            }
          }

          return { contents };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || { error: "Failed to read clipboard" };
  } catch (error) {
    return { error: error.message };
  }
}

async function writeRichClipboard(tabId, data) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (clipData) => {
        try {
          const items = {};

          if (clipData.text) {
            items["text/plain"] = new Blob([clipData.text], {
              type: "text/plain",
            });
          }
          if (clipData.html) {
            items["text/html"] = new Blob([clipData.html], {
              type: "text/html",
            });
          }

          const clipboardItem = new ClipboardItem(items);
          await navigator.clipboard.write([clipboardItem]);
          return { success: true };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [data],
    });
    return result[0]?.result || { error: "Failed to write clipboard" };
  } catch (error) {
    return { error: error.message };
  }
}

async function getClipboardFormats(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        try {
          const items = await navigator.clipboard.read();
          const formats = [];
          for (const item of items) {
            formats.push(...item.types);
          }
          return { formats };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || { formats: [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function writeImageToClipboard(tabId, imageData) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (imgData) => {
        try {
          // Convert base64 to blob
          const response = await fetch(`data:image/png;base64,${imgData}`);
          const blob = await response.blob();
          const clipboardItem = new ClipboardItem({ "image/png": blob });
          await navigator.clipboard.write([clipboardItem]);
          return { success: true };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [imageData],
    });
    return result[0]?.result || { error: "Failed to write image" };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 19: Print/PDF Enhanced ====================

async function getPrintPreview(tabId, options = {}) {
  try {
    await ensureDebuggerAttached(tabId);

    // Emulate print media
    await chrome.debugger.sendCommand({ tabId }, "Emulation.setEmulatedMedia", {
      media: "print",
    });

    // Capture screenshot in print mode
    const screenshot = await chrome.debugger.sendCommand(
      { tabId },
      "Page.captureScreenshot",
      {
        format: "png",
        quality: 100,
      },
    );

    // Reset media
    await chrome.debugger.sendCommand({ tabId }, "Emulation.setEmulatedMedia", {
      media: "",
    });

    return {
      success: true,
      preview: screenshot.data,
      format: "png",
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function printToPDF(tabId, options = {}) {
  try {
    await ensureDebuggerAttached(tabId);

    const pdfOptions = {
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
      pageRanges: options.pageRanges || "",
      preferCSSPageSize: options.preferCSSPageSize || false,
    };

    if (options.headerTemplate) {
      pdfOptions.headerTemplate = options.headerTemplate;
    }
    if (options.footerTemplate) {
      pdfOptions.footerTemplate = options.footerTemplate;
    }

    const result = await chrome.debugger.sendCommand(
      { tabId },
      "Page.printToPDF",
      pdfOptions,
    );

    return {
      success: true,
      data: result.data,
      format: "pdf",
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function getPrintSettings(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const style = getComputedStyle(document.documentElement);
        return {
          hasMediaPrint: !!document.querySelector(
            'style[media="print"], link[media="print"]',
          ),
          pageSize: style.getPropertyValue("--page-size") || "auto",
          orientation: window.matchMedia("(orientation: portrait)").matches
            ? "portrait"
            : "landscape",
        };
      },
    });
    return result[0]?.result || { error: "Failed to get settings" };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 20: Web Workers ====================

async function listWebWorkers(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Track workers via performance API
        const entries = performance.getEntriesByType("resource");
        const workerScripts = entries.filter(
          (e) => e.initiatorType === "script" && e.name.includes("worker"),
        );
        return {
          detected: workerScripts.map((w) => ({
            name: w.name,
            duration: w.duration,
            startTime: w.startTime,
          })),
          note: "Worker detection is limited without debugger API",
        };
      },
    });
    return result[0]?.result || { detected: [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function terminateWorker(tabId, workerId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (wId) => {
        const worker = window.__chainlessWorkers?.get(wId);
        if (worker) {
          worker.terminate();
          window.__chainlessWorkers.delete(wId);
          return { success: true };
        }
        return { error: "Worker not found or not tracked" };
      },
      args: [workerId],
    });
    return result[0]?.result || { error: "Failed to terminate worker" };
  } catch (error) {
    return { error: error.message };
  }
}

async function postMessageToWorker(tabId, workerId, message) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (wId, msg) => {
        const worker = window.__chainlessWorkers?.get(wId);
        if (worker) {
          worker.postMessage(msg);
          return { success: true };
        }
        return { error: "Worker not found or not tracked" };
      },
      args: [workerId, message],
    });
    return result[0]?.result || { error: "Failed to post message" };
  } catch (error) {
    return { error: error.message };
  }
}

async function getSharedWorkers(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return {
          note: "SharedWorker enumeration requires Service Worker scope",
          supported: typeof SharedWorker !== "undefined",
        };
      },
    });
    return result[0]?.result || { error: "Failed to get shared workers" };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 20: Broadcast Channel ====================

async function createBroadcastChannel(tabId, channelName) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (name) => {
        if (!window.__chainlessBroadcastChannels) {
          window.__chainlessBroadcastChannels = new Map();
        }
        if (window.__chainlessBroadcastChannels.has(name)) {
          return { error: "Channel already exists" };
        }
        const channel = new BroadcastChannel(name);
        window.__chainlessBroadcastChannels.set(name, {
          channel,
          messages: [],
        });
        channel.onmessage = (event) => {
          window.__chainlessBroadcastChannels.get(name).messages.push({
            data: event.data,
            timestamp: Date.now(),
          });
        };
        return { success: true, channelName: name };
      },
      args: [channelName],
    });
    return result[0]?.result || { error: "Failed to create channel" };
  } catch (error) {
    return { error: error.message };
  }
}

async function broadcastMessage(tabId, channelName, message) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (name, msg) => {
        const entry = window.__chainlessBroadcastChannels?.get(name);
        if (entry) {
          entry.channel.postMessage(msg);
          return { success: true };
        }
        return { error: "Channel not found" };
      },
      args: [channelName, message],
    });
    return result[0]?.result || { error: "Failed to broadcast" };
  } catch (error) {
    return { error: error.message };
  }
}

async function closeBroadcastChannel(tabId, channelName) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (name) => {
        const entry = window.__chainlessBroadcastChannels?.get(name);
        if (entry) {
          entry.channel.close();
          window.__chainlessBroadcastChannels.delete(name);
          return { success: true };
        }
        return { error: "Channel not found" };
      },
      args: [channelName],
    });
    return result[0]?.result || { error: "Failed to close channel" };
  } catch (error) {
    return { error: error.message };
  }
}

async function listBroadcastChannels(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const channels = window.__chainlessBroadcastChannels;
        if (!channels) {
          return { channels: [] };
        }
        return {
          channels: Array.from(channels.entries()).map(([name, entry]) => ({
            name,
            messageCount: entry.messages.length,
          })),
        };
      },
    });
    return result[0]?.result || { channels: [] };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 20: Web Audio ====================

async function getAudioContexts(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const contexts = [];
        // Check for tracked audio contexts
        if (window.__chainlessAudioContexts) {
          window.__chainlessAudioContexts.forEach((ctx, id) => {
            contexts.push({
              id,
              state: ctx.state,
              sampleRate: ctx.sampleRate,
              currentTime: ctx.currentTime,
              baseLatency: ctx.baseLatency,
            });
          });
        }
        return {
          contexts,
          audioContextSupported: typeof AudioContext !== "undefined",
        };
      },
    });
    return result[0]?.result || { contexts: [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function suspendAudioContext(tabId, contextId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (ctxId) => {
        const ctx = window.__chainlessAudioContexts?.get(ctxId);
        if (ctx) {
          await ctx.suspend();
          return { success: true, state: ctx.state };
        }
        return { error: "Audio context not found" };
      },
      args: [contextId],
    });
    return result[0]?.result || { error: "Failed to suspend" };
  } catch (error) {
    return { error: error.message };
  }
}

async function resumeAudioContext(tabId, contextId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (ctxId) => {
        const ctx = window.__chainlessAudioContexts?.get(ctxId);
        if (ctx) {
          await ctx.resume();
          return { success: true, state: ctx.state };
        }
        return { error: "Audio context not found" };
      },
      args: [contextId],
    });
    return result[0]?.result || { error: "Failed to resume" };
  } catch (error) {
    return { error: error.message };
  }
}

async function getAudioNodes(tabId, contextId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (ctxId) => {
        return {
          note: "Audio node enumeration requires custom tracking",
          contextId: ctxId,
        };
      },
      args: [contextId],
    });
    return result[0]?.result || { error: "Failed to get nodes" };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 20: Canvas/WebGL ====================

async function listCanvasElements(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const canvases = document.querySelectorAll("canvas");
        return {
          canvases: Array.from(canvases).map((canvas, index) => ({
            index,
            id: canvas.id || null,
            width: canvas.width,
            height: canvas.height,
            selector: canvas.id
              ? `#${canvas.id}`
              : `canvas:nth-of-type(${index + 1})`,
            hasWebGL:
              !!canvas.getContext("webgl") || !!canvas.getContext("webgl2"),
            has2D: !!canvas.getContext("2d"),
          })),
          count: canvases.length,
        };
      },
    });
    return result[0]?.result || { canvases: [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function getCanvasContext(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const canvas = document.querySelector(sel);
        if (!canvas || canvas.tagName !== "CANVAS") {
          return { error: "Canvas not found" };
        }
        const ctx2d = canvas.getContext("2d");
        const webgl = canvas.getContext("webgl") || canvas.getContext("webgl2");
        return {
          has2D: !!ctx2d,
          hasWebGL: !!webgl,
          width: canvas.width,
          height: canvas.height,
          contextAttributes: webgl?.getContextAttributes?.() || null,
        };
      },
      args: [selector],
    });
    return result[0]?.result || { error: "Failed to get context" };
  } catch (error) {
    return { error: error.message };
  }
}

async function canvasToDataURL(tabId, selector, format = "image/png") {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel, fmt) => {
        const canvas = document.querySelector(sel);
        if (!canvas || canvas.tagName !== "CANVAS") {
          return { error: "Canvas not found" };
        }
        try {
          const dataURL = canvas.toDataURL(fmt);
          return {
            success: true,
            dataURL: dataURL.substring(0, 1000) + "...",
            fullLength: dataURL.length,
            format: fmt,
          };
        } catch (e) {
          return { error: `Canvas tainted: ${e.message}` };
        }
      },
      args: [selector, format],
    });
    return result[0]?.result || { error: "Failed to convert" };
  } catch (error) {
    return { error: error.message };
  }
}

async function getWebGLInfo(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const canvas = sel
          ? document.querySelector(sel)
          : document.createElement("canvas");
        const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
        if (!gl) {
          return { error: "WebGL not available" };
        }
        const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
        return {
          version: gl.getParameter(gl.VERSION),
          vendor: gl.getParameter(gl.VENDOR),
          renderer: debugInfo
            ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
            : "Unknown",
          unmaskedVendor: debugInfo
            ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
            : "Unknown",
          shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
          maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
          maxViewportDims: gl.getParameter(gl.MAX_VIEWPORT_DIMS),
          maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
        };
      },
      args: [selector],
    });
    return result[0]?.result || { error: "Failed to get WebGL info" };
  } catch (error) {
    return { error: error.message };
  }
}

async function getWebGLExtensions(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const canvas = sel
          ? document.querySelector(sel)
          : document.createElement("canvas");
        const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
        if (!gl) {
          return { error: "WebGL not available" };
        }
        const extensions = gl.getSupportedExtensions();
        return {
          extensions: extensions || [],
          count: extensions?.length || 0,
        };
      },
      args: [selector],
    });
    return result[0]?.result || { extensions: [] };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 20: Media Devices ====================

async function enumerateMediaDevices(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          return {
            devices: devices.map((d) => ({
              deviceId: d.deviceId.substring(0, 20) + "...",
              kind: d.kind,
              label: d.label || "(no permission)",
              groupId: d.groupId.substring(0, 20) + "...",
            })),
            count: devices.length,
          };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || { devices: [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function getSupportedConstraints(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const constraints = navigator.mediaDevices.getSupportedConstraints();
        return { constraints };
      },
    });
    return result[0]?.result || { constraints: {} };
  } catch (error) {
    return { error: error.message };
  }
}

async function getDisplayMediaCapabilities(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return {
          supported:
            typeof navigator.mediaDevices.getDisplayMedia === "function",
          note: "getDisplayMedia requires user gesture",
        };
      },
    });
    return result[0]?.result || { supported: false };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 20: System Info APIs ====================

async function getBatteryInfo(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (!navigator.getBattery) {
          return { error: "Battery API not supported" };
        }
        try {
          const battery = await navigator.getBattery();
          return {
            charging: battery.charging,
            chargingTime: battery.chargingTime,
            dischargingTime: battery.dischargingTime,
            level: battery.level,
            levelPercent: (battery.level * 100).toFixed(0) + "%",
          };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || { error: "Failed to get battery info" };
  } catch (error) {
    return { error: error.message };
  }
}

async function getConnectionInfo(tabId) {
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
        };
      },
    });
    return result[0]?.result || { error: "Failed to get connection info" };
  } catch (error) {
    return { error: error.message };
  }
}

async function getDeviceMemory(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return {
          deviceMemory: navigator.deviceMemory || "Not available",
          deviceMemoryGB: navigator.deviceMemory
            ? `${navigator.deviceMemory} GB`
            : "Not available",
        };
      },
    });
    return result[0]?.result || { error: "Failed to get memory info" };
  } catch (error) {
    return { error: error.message };
  }
}

async function getHardwareInfo(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return {
          hardwareConcurrency: navigator.hardwareConcurrency,
          cpuCores: navigator.hardwareConcurrency,
          deviceMemory: navigator.deviceMemory,
          maxTouchPoints: navigator.maxTouchPoints,
          platform: navigator.platform,
          userAgent: navigator.userAgent,
        };
      },
    });
    return result[0]?.result || { error: "Failed to get hardware info" };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 20: Permissions ====================

async function queryPermission(tabId, name) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (permName) => {
        try {
          const status = await navigator.permissions.query({ name: permName });
          return {
            name: permName,
            state: status.state,
          };
        } catch (e) {
          return { name: permName, error: e.message };
        }
      },
      args: [name],
    });
    return result[0]?.result || { error: "Failed to query permission" };
  } catch (error) {
    return { error: error.message };
  }
}

async function queryAllPermissions(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        const permissionNames = [
          "geolocation",
          "notifications",
          "camera",
          "microphone",
          "clipboard-read",
          "clipboard-write",
          "accelerometer",
          "gyroscope",
          "magnetometer",
          "ambient-light-sensor",
          "background-sync",
          "midi",
          "persistent-storage",
        ];
        const results = {};
        for (const name of permissionNames) {
          try {
            const status = await navigator.permissions.query({ name });
            results[name] = status.state;
          } catch {
            results[name] = "unsupported";
          }
        }
        return { permissions: results };
      },
    });
    return result[0]?.result || { permissions: {} };
  } catch (error) {
    return { error: error.message };
  }
}

async function requestPermission(tabId, name) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (permName) => {
        try {
          // Some permissions can be requested directly
          if (permName === "notifications") {
            const permission = await Notification.requestPermission();
            return { name: permName, result: permission };
          }
          return { error: "Permission request requires user gesture" };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [name],
    });
    return result[0]?.result || { error: "Failed to request permission" };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 20: Notifications ====================

async function getNotificationPermission(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        permission: Notification.permission,
        supported: typeof Notification !== "undefined",
      }),
    });
    return result[0]?.result || { permission: "unsupported" };
  } catch (error) {
    return { error: error.message };
  }
}

async function requestNotificationPermission(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        try {
          const permission = await Notification.requestPermission();
          return { permission };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || { error: "Failed to request permission" };
  } catch (error) {
    return { error: error.message };
  }
}

async function createNotification(tabId, title, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (t, opts) => {
        if (Notification.permission !== "granted") {
          return { error: "Notification permission not granted" };
        }
        try {
          new Notification(t, opts);
          return { success: true, title: t };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [title, options],
    });
    return result[0]?.result || { error: "Failed to create notification" };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 20: Fullscreen ====================

async function enterFullscreen(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (sel) => {
        try {
          const element = sel
            ? document.querySelector(sel)
            : document.documentElement;
          if (!element) {
            return { error: "Element not found" };
          }
          await element.requestFullscreen();
          return { success: true };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [selector],
    });
    return result[0]?.result || { error: "Failed to enter fullscreen" };
  } catch (error) {
    return { error: error.message };
  }
}

async function exitFullscreen(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        try {
          if (document.fullscreenElement) {
            await document.exitFullscreen();
            return { success: true };
          }
          return { error: "Not in fullscreen mode" };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || { error: "Failed to exit fullscreen" };
  } catch (error) {
    return { error: error.message };
  }
}

async function getFullscreenState(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        isFullscreen: !!document.fullscreenElement,
        fullscreenElement: document.fullscreenElement?.tagName || null,
        fullscreenEnabled: document.fullscreenEnabled,
      }),
    });
    return result[0]?.result || { isFullscreen: false };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 20: Pointer Lock ====================

async function requestPointerLock(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (sel) => {
        try {
          const element = sel ? document.querySelector(sel) : document.body;
          if (!element) {
            return { error: "Element not found" };
          }
          await element.requestPointerLock();
          return { success: true };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [selector],
    });
    return result[0]?.result || { error: "Failed to request pointer lock" };
  } catch (error) {
    return { error: error.message };
  }
}

async function exitPointerLock(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        document.exitPointerLock();
        return { success: true };
      },
    });
    return result[0]?.result || { error: "Failed to exit pointer lock" };
  } catch (error) {
    return { error: error.message };
  }
}

async function getPointerLockState(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        isLocked: !!document.pointerLockElement,
        lockedElement: document.pointerLockElement?.tagName || null,
      }),
    });
    return result[0]?.result || { isLocked: false };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 21: Accessibility ====================

async function getAccessibilityTree(tabId, selector = "body") {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        function buildTree(element, depth = 0) {
          if (depth > 10) return null; // Limit depth
          const computed = window.getComputedStyle(element);
          const isHidden =
            computed.display === "none" || computed.visibility === "hidden";

          const node = {
            tag: element.tagName?.toLowerCase(),
            role:
              element.getAttribute("role") || element.tagName?.toLowerCase(),
            name:
              element.getAttribute("aria-label") ||
              element.getAttribute("alt") ||
              element.textContent?.slice(0, 50),
            id: element.id || null,
            isHidden,
            tabIndex: element.tabIndex,
            children: [],
          };

          if (!isHidden && element.children) {
            for (const child of element.children) {
              const childNode = buildTree(child, depth + 1);
              if (childNode) node.children.push(childNode);
            }
          }
          return node;
        }

        const root = document.querySelector(sel);
        return root ? buildTree(root) : null;
      },
      args: [selector],
    });
    return result[0]?.result || { error: "Failed to build tree" };
  } catch (error) {
    return { error: error.message };
  }
}

async function getARIAProperties(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const elements = document.querySelectorAll(
          sel || "[role], [aria-label], [aria-describedby], [aria-hidden]",
        );
        return Array.from(elements)
          .slice(0, 100)
          .map((el) => ({
            tag: el.tagName?.toLowerCase(),
            selector: el.id
              ? `#${el.id}`
              : el.className
                ? `.${el.className.split(" ")[0]}`
                : el.tagName?.toLowerCase(),
            role: el.getAttribute("role"),
            ariaLabel: el.getAttribute("aria-label"),
            ariaDescribedby: el.getAttribute("aria-describedby"),
            ariaHidden: el.getAttribute("aria-hidden"),
            ariaExpanded: el.getAttribute("aria-expanded"),
            ariaSelected: el.getAttribute("aria-selected"),
            ariaChecked: el.getAttribute("aria-checked"),
            ariaDisabled: el.getAttribute("aria-disabled"),
            ariaLive: el.getAttribute("aria-live"),
            ariaAtomic: el.getAttribute("aria-atomic"),
            ariaRelevant: el.getAttribute("aria-relevant"),
            ariaBusy: el.getAttribute("aria-busy"),
            ariaControls: el.getAttribute("aria-controls"),
            ariaOwns: el.getAttribute("aria-owns"),
          }));
      },
      args: [selector],
    });
    return { elements: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function checkColorContrast(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        function getLuminance(r, g, b) {
          const [rs, gs, bs] = [r, g, b].map((c) => {
            c = c / 255;
            return c <= 0.03928
              ? c / 12.92
              : Math.pow((c + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
        }

        function parseColor(color) {
          const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (match)
            return {
              r: parseInt(match[1]),
              g: parseInt(match[2]),
              b: parseInt(match[3]),
            };
          return null;
        }

        function getContrastRatio(fg, bg) {
          const l1 = getLuminance(fg.r, fg.g, fg.b);
          const l2 = getLuminance(bg.r, bg.g, bg.b);
          const lighter = Math.max(l1, l2);
          const darker = Math.min(l1, l2);
          return (lighter + 0.05) / (darker + 0.05);
        }

        const elements = document.querySelectorAll(
          sel ||
            "p, span, a, h1, h2, h3, h4, h5, h6, li, td, th, label, button",
        );
        const issues = [];

        Array.from(elements)
          .slice(0, 100)
          .forEach((el) => {
            const style = window.getComputedStyle(el);
            const fg = parseColor(style.color);
            const bg = parseColor(style.backgroundColor);

            if (fg && bg) {
              const ratio = getContrastRatio(fg, bg);
              const fontSize = parseFloat(style.fontSize);
              const isBold = parseInt(style.fontWeight) >= 700;
              const isLargeText = fontSize >= 18 || (fontSize >= 14 && isBold);
              const minRatio = isLargeText ? 3 : 4.5;

              if (ratio < minRatio) {
                issues.push({
                  element: el.tagName?.toLowerCase(),
                  text: el.textContent?.slice(0, 30),
                  foreground: style.color,
                  background: style.backgroundColor,
                  ratio: ratio.toFixed(2),
                  required: minRatio,
                  pass: false,
                });
              }
            }
          });

        return { issues, totalChecked: elements.length };
      },
      args: [selector],
    });
    return result[0]?.result || { issues: [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function getFocusOrder(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const focusableSelector =
          'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
        const elements = document.querySelectorAll(focusableSelector);

        return Array.from(elements).map((el, index) => ({
          order: index + 1,
          tag: el.tagName?.toLowerCase(),
          type: el.type || null,
          tabIndex: el.tabIndex,
          id: el.id || null,
          name: el.name || null,
          text: (el.textContent || el.value || el.placeholder || "")?.slice(
            0,
            30,
          ),
          isVisible: el.offsetParent !== null,
          rect: el.getBoundingClientRect
            ? {
                x: Math.round(el.getBoundingClientRect().x),
                y: Math.round(el.getBoundingClientRect().y),
              }
            : null,
        }));
      },
    });
    return { elements: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function getAccessibilityLandmarks(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const landmarks = {
          banner: document.querySelectorAll('header, [role="banner"]'),
          navigation: document.querySelectorAll('nav, [role="navigation"]'),
          main: document.querySelectorAll('main, [role="main"]'),
          complementary: document.querySelectorAll(
            'aside, [role="complementary"]',
          ),
          contentinfo: document.querySelectorAll(
            'footer, [role="contentinfo"]',
          ),
          search: document.querySelectorAll('[role="search"]'),
          form: document.querySelectorAll('form, [role="form"]'),
          region: document.querySelectorAll('[role="region"]'),
        };

        const result = {};
        for (const [type, elements] of Object.entries(landmarks)) {
          result[type] = Array.from(elements).map((el) => ({
            tag: el.tagName?.toLowerCase(),
            role: el.getAttribute("role"),
            ariaLabel: el.getAttribute("aria-label"),
            id: el.id || null,
          }));
        }
        return result;
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getHeadingStructure(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const headings = document.querySelectorAll(
          "h1, h2, h3, h4, h5, h6, [role='heading']",
        );
        const structure = [];
        let previousLevel = 0;
        const issues = [];

        Array.from(headings).forEach((h, index) => {
          const level =
            parseInt(h.tagName?.charAt(1)) ||
            parseInt(h.getAttribute("aria-level")) ||
            0;
          const text = h.textContent?.trim().slice(0, 50);

          // Check for skipped heading levels
          if (level > previousLevel + 1 && previousLevel > 0) {
            issues.push({
              type: "skipped-level",
              message: `Heading level ${level} follows level ${previousLevel}`,
              element: h.tagName?.toLowerCase(),
              text,
            });
          }

          structure.push({
            level,
            tag: h.tagName?.toLowerCase(),
            text,
            id: h.id || null,
            index,
          });

          previousLevel = level;
        });

        // Check for missing h1
        const hasH1 = Array.from(headings).some((h) => h.tagName === "H1");
        if (!hasH1) {
          issues.push({
            type: "missing-h1",
            message: "Page is missing an h1 heading",
          });
        }

        // Check for multiple h1s
        const h1Count = document.querySelectorAll("h1").length;
        if (h1Count > 1) {
          issues.push({
            type: "multiple-h1",
            message: `Page has ${h1Count} h1 headings (should have only one)`,
          });
        }

        return { structure, issues };
      },
    });
    return result[0]?.result || { structure: [], issues: [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function checkAltTexts(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const images = document.querySelectorAll("img");
        const issues = [];
        const stats = {
          total: images.length,
          withAlt: 0,
          emptyAlt: 0,
          missingAlt: 0,
        };

        Array.from(images).forEach((img) => {
          const alt = img.getAttribute("alt");
          const src = img.src?.slice(0, 100);

          if (alt === null) {
            stats.missingAlt++;
            issues.push({
              type: "missing",
              src,
              message: "Image is missing alt attribute",
            });
          } else if (alt === "") {
            stats.emptyAlt++;
            // Empty alt is valid for decorative images
          } else {
            stats.withAlt++;
          }
        });

        return { stats, issues };
      },
    });
    return result[0]?.result || { stats: {}, issues: [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function checkFormLabels(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const inputs = document.querySelectorAll("input, select, textarea");
        const issues = [];
        const stats = { total: inputs.length, labeled: 0, unlabeled: 0 };

        Array.from(inputs).forEach((input) => {
          if (
            input.type === "hidden" ||
            input.type === "submit" ||
            input.type === "button"
          )
            return;

          const hasLabel = input.labels?.length > 0;
          const hasAriaLabel = input.getAttribute("aria-label");
          const hasAriaLabelledby = input.getAttribute("aria-labelledby");
          const hasTitle = input.title;
          const hasPlaceholder = input.placeholder;

          const isLabeled =
            hasLabel || hasAriaLabel || hasAriaLabelledby || hasTitle;

          if (isLabeled) {
            stats.labeled++;
          } else {
            stats.unlabeled++;
            issues.push({
              type: "missing-label",
              tag: input.tagName?.toLowerCase(),
              inputType: input.type,
              name: input.name,
              id: input.id,
              placeholder: hasPlaceholder,
            });
          }
        });

        return { stats, issues };
      },
    });
    return result[0]?.result || { stats: {}, issues: [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function simulateAccessibility(tabId, type) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (simType) => {
        // Remove any existing simulation
        const existingStyle = document.getElementById("a11y-simulation");
        if (existingStyle) existingStyle.remove();

        if (simType === "none" || simType === "reset") {
          return { success: true, message: "Simulation cleared" };
        }

        const style = document.createElement("style");
        style.id = "a11y-simulation";

        const simulations = {
          protanopia:
            'url(\'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><filter id="p"><feColorMatrix values="0.567 0.433 0 0 0 0.558 0.442 0 0 0 0 0.242 0.758 0 0 0 0 0 1 0"/></filter></svg>#p\')',
          deuteranopia:
            'url(\'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><filter id="d"><feColorMatrix values="0.625 0.375 0 0 0 0.7 0.3 0 0 0 0 0.3 0.7 0 0 0 0 0 1 0"/></filter></svg>#d\')',
          tritanopia:
            'url(\'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><filter id="t"><feColorMatrix values="0.95 0.05 0 0 0 0 0.433 0.567 0 0 0 0.475 0.525 0 0 0 0 0 1 0"/></filter></svg>#t\')',
          achromatopsia: "grayscale(100%)",
          "low-contrast": "contrast(0.5)",
          "blur-vision": "blur(2px)",
        };

        const filter = simulations[simType];
        if (!filter) return { error: `Unknown simulation type: ${simType}` };

        style.textContent = `html { filter: ${filter}; }`;
        document.head.appendChild(style);

        return { success: true, type: simType };
      },
      args: [type],
    });
    return result[0]?.result || { error: "Failed to apply simulation" };
  } catch (error) {
    return { error: error.message };
  }
}

async function runAccessibilityAudit(tabId) {
  try {
    const [headings, labels, altTexts, landmarks, focusOrder, contrast] =
      await Promise.all([
        getHeadingStructure(tabId),
        checkFormLabels(tabId),
        checkAltTexts(tabId),
        getAccessibilityLandmarks(tabId),
        getFocusOrder(tabId),
        checkColorContrast(tabId, null),
      ]);

    const issues = [];
    let score = 100;

    // Heading issues
    if (headings.issues?.length > 0) {
      issues.push(
        ...headings.issues.map((i) => ({ category: "headings", ...i })),
      );
      score -= headings.issues.length * 5;
    }

    // Label issues
    if (labels.issues?.length > 0) {
      issues.push(...labels.issues.map((i) => ({ category: "forms", ...i })));
      score -= labels.issues.length * 10;
    }

    // Alt text issues
    if (altTexts.issues?.length > 0) {
      issues.push(
        ...altTexts.issues.map((i) => ({ category: "images", ...i })),
      );
      score -= altTexts.issues.length * 5;
    }

    // Contrast issues
    if (contrast.issues?.length > 0) {
      issues.push(
        ...contrast.issues.map((i) => ({ category: "contrast", ...i })),
      );
      score -= contrast.issues.length * 3;
    }

    // Check for landmarks
    const hasMain = landmarks.main?.length > 0;
    const hasNav = landmarks.navigation?.length > 0;
    if (!hasMain) {
      issues.push({
        category: "landmarks",
        type: "missing-main",
        message: "Page is missing main landmark",
      });
      score -= 10;
    }
    if (!hasNav) {
      issues.push({
        category: "landmarks",
        type: "missing-nav",
        message: "Page is missing navigation landmark",
      });
      score -= 5;
    }

    return {
      score: Math.max(0, score),
      issues,
      summary: {
        headings: headings.structure?.length || 0,
        focusableElements: focusOrder.elements?.length || 0,
        landmarks: Object.values(landmarks).flat().length,
        images: altTexts.stats?.total || 0,
        formFields: labels.stats?.total || 0,
      },
    };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 21: Performance Metrics ====================

async function getPerformanceMetrics(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const perf = window.performance;
        const nav = perf.getEntriesByType("navigation")[0];
        const paint = perf.getEntriesByType("paint");

        return {
          timing: {
            domContentLoaded: nav?.domContentLoadedEventEnd - nav?.startTime,
            load: nav?.loadEventEnd - nav?.startTime,
            firstPaint: paint.find((p) => p.name === "first-paint")?.startTime,
            firstContentfulPaint: paint.find(
              (p) => p.name === "first-contentful-paint",
            )?.startTime,
            domInteractive: nav?.domInteractive - nav?.startTime,
            domComplete: nav?.domComplete - nav?.startTime,
          },
          memory: window.performance.memory
            ? {
                usedJSHeapSize: window.performance.memory.usedJSHeapSize,
                totalJSHeapSize: window.performance.memory.totalJSHeapSize,
                jsHeapSizeLimit: window.performance.memory.jsHeapSizeLimit,
              }
            : null,
          resources: {
            count: perf.getEntriesByType("resource").length,
            totalSize: perf
              .getEntriesByType("resource")
              .reduce((sum, r) => sum + (r.transferSize || 0), 0),
          },
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getPerformanceTimeline(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const entries = window.performance.getEntries();
        return entries.slice(0, 200).map((entry) => ({
          name: entry.name,
          entryType: entry.entryType,
          startTime: Math.round(entry.startTime),
          duration: Math.round(entry.duration),
        }));
      },
    });
    return { entries: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function getLongTasks(tabId, threshold = 50) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (thresh) => {
        const longTasks = window.performance.getEntriesByType("longtask");
        return longTasks
          .filter((t) => t.duration >= thresh)
          .map((t) => ({
            name: t.name,
            startTime: Math.round(t.startTime),
            duration: Math.round(t.duration),
            attribution: t.attribution?.map((a) => ({
              name: a.name,
              containerType: a.containerType,
              containerSrc: a.containerSrc,
            })),
          }));
      },
      args: [threshold],
    });
    return { tasks: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function getLayoutShifts(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const shifts = window.performance.getEntriesByType("layout-shift");
        let cumulativeScore = 0;

        const entries = shifts.map((s) => {
          cumulativeScore += s.value;
          return {
            startTime: Math.round(s.startTime),
            value: s.value?.toFixed(4),
            hadRecentInput: s.hadRecentInput,
            sources: s.sources?.map((src) => ({
              node: src.node?.tagName,
              previousRect: src.previousRect,
              currentRect: src.currentRect,
            })),
          };
        });

        return { entries, cls: cumulativeScore.toFixed(4) };
      },
    });
    return result[0]?.result || { entries: [], cls: 0 };
  } catch (error) {
    return { error: error.message };
  }
}

async function getPaintTiming(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const paint = window.performance.getEntriesByType("paint");
        const lcp = window.performance.getEntriesByType(
          "largest-contentful-paint",
        );

        return {
          firstPaint: paint.find((p) => p.name === "first-paint")?.startTime,
          firstContentfulPaint: paint.find(
            (p) => p.name === "first-contentful-paint",
          )?.startTime,
          largestContentfulPaint: lcp[lcp.length - 1]?.startTime,
          lcpElement: lcp[lcp.length - 1]?.element?.tagName,
          lcpSize: lcp[lcp.length - 1]?.size,
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getResourceTiming(tabId, filter = null) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (filterType) => {
        let resources = window.performance.getEntriesByType("resource");

        if (filterType) {
          resources = resources.filter((r) => r.initiatorType === filterType);
        }

        return resources.slice(0, 100).map((r) => ({
          name: r.name.split("/").pop()?.slice(0, 50),
          url: r.name.slice(0, 100),
          initiatorType: r.initiatorType,
          startTime: Math.round(r.startTime),
          duration: Math.round(r.duration),
          transferSize: r.transferSize,
          encodedBodySize: r.encodedBodySize,
          decodedBodySize: r.decodedBodySize,
          dns: Math.round(r.domainLookupEnd - r.domainLookupStart),
          tcp: Math.round(r.connectEnd - r.connectStart),
          ttfb: Math.round(r.responseStart - r.requestStart),
          download: Math.round(r.responseEnd - r.responseStart),
        }));
      },
      args: [filter],
    });
    return { resources: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function getNavigationTiming(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const nav = window.performance.getEntriesByType("navigation")[0];
        if (!nav) return null;

        return {
          type: nav.type,
          redirectCount: nav.redirectCount,
          redirectTime: Math.round(nav.redirectEnd - nav.redirectStart),
          dnsTime: Math.round(nav.domainLookupEnd - nav.domainLookupStart),
          tcpTime: Math.round(nav.connectEnd - nav.connectStart),
          tlsTime: Math.round(
            nav.secureConnectionStart > 0
              ? nav.connectEnd - nav.secureConnectionStart
              : 0,
          ),
          ttfb: Math.round(nav.responseStart - nav.requestStart),
          downloadTime: Math.round(nav.responseEnd - nav.responseStart),
          domParsing: Math.round(nav.domInteractive - nav.responseEnd),
          deferredScripts: Math.round(
            nav.domContentLoadedEventStart - nav.domInteractive,
          ),
          domContentLoaded: Math.round(
            nav.domContentLoadedEventEnd - nav.startTime,
          ),
          resourceLoading: Math.round(
            nav.domComplete - nav.domContentLoadedEventEnd,
          ),
          loadEvent: Math.round(nav.loadEventEnd - nav.loadEventStart),
          totalTime: Math.round(nav.loadEventEnd - nav.startTime),
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function measureElementPerformance(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const element = document.querySelector(sel);
        if (!element) return { error: "Element not found" };

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        // Measure reflow/repaint cost
        const startMeasure = performance.now();
        element.offsetHeight; // Force reflow
        const reflowTime = performance.now() - startMeasure;

        return {
          selector: sel,
          dimensions: {
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            x: Math.round(rect.x),
            y: Math.round(rect.y),
          },
          layout: {
            display: style.display,
            position: style.position,
            containsText: element.textContent?.length || 0,
            childCount: element.children?.length || 0,
          },
          performance: {
            reflowTime: reflowTime.toFixed(3),
          },
        };
      },
      args: [selector],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function createPerformanceMark(tabId, name) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (markName) => {
        performance.mark(markName);
        return { success: true, name: markName, timestamp: performance.now() };
      },
      args: [name],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function measureBetweenMarks(tabId, startMark, endMark, measureName) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (start, end, name) => {
        try {
          performance.measure(name, start, end);
          const measure = performance.getEntriesByName(name, "measure")[0];
          return {
            name,
            startMark: start,
            endMark: end,
            duration: measure?.duration,
            startTime: measure?.startTime,
          };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [startMark, endMark, measureName],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function clearPerformanceMarks(tabId, name = null) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (markName) => {
        if (markName) {
          performance.clearMarks(markName);
          performance.clearMeasures(markName);
        } else {
          performance.clearMarks();
          performance.clearMeasures();
        }
        return { success: true };
      },
      args: [name],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getPerformanceEntries(tabId, type = null) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (entryType) => {
        const entries = entryType
          ? performance.getEntriesByType(entryType)
          : performance.getEntries();

        return entries.slice(0, 100).map((e) => ({
          name: e.name?.slice(0, 100),
          entryType: e.entryType,
          startTime: Math.round(e.startTime),
          duration: Math.round(e.duration),
        }));
      },
      args: [type],
    });
    return { entries: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 21: Memory Analysis ====================

async function getMemoryUsage(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const memory = window.performance.memory;
        if (!memory) return { error: "Memory API not available" };

        return {
          usedJSHeapSize: memory.usedJSHeapSize,
          totalJSHeapSize: memory.totalJSHeapSize,
          jsHeapSizeLimit: memory.jsHeapSizeLimit,
          usedPercentage: (
            (memory.usedJSHeapSize / memory.jsHeapSizeLimit) *
            100
          ).toFixed(2),
          formatted: {
            used: (memory.usedJSHeapSize / 1024 / 1024).toFixed(2) + " MB",
            total: (memory.totalJSHeapSize / 1024 / 1024).toFixed(2) + " MB",
            limit: (memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2) + " MB",
          },
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function measureHeapUsage(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const measurements = [];

        // Take multiple samples
        for (let i = 0; i < 5; i++) {
          if (window.performance.memory) {
            measurements.push({
              timestamp: performance.now(),
              used: window.performance.memory.usedJSHeapSize,
            });
          }
        }

        if (measurements.length === 0)
          return { error: "Memory API not available" };

        const avgUsed =
          measurements.reduce((sum, m) => sum + m.used, 0) /
          measurements.length;

        return {
          samples: measurements.length,
          average: Math.round(avgUsed),
          formatted: (avgUsed / 1024 / 1024).toFixed(2) + " MB",
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getJSHeapSize(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!window.performance.memory)
          return { error: "Memory API not available" };

        const memory = window.performance.memory;
        return {
          used: memory.usedJSHeapSize,
          total: memory.totalJSHeapSize,
          limit: memory.jsHeapSizeLimit,
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function detectMemoryLeaks(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const warnings = [];

        // Check for detached DOM nodes (basic check)
        const scripts = document.querySelectorAll("script");
        const inlineScripts = Array.from(scripts).filter(
          (s) => !s.src && s.textContent.length > 10000,
        );
        if (inlineScripts.length > 0) {
          warnings.push({
            type: "large-inline-scripts",
            count: inlineScripts.length,
            message: "Large inline scripts may hold memory",
          });
        }

        // Check event listeners on window/document
        const events = ["click", "scroll", "resize", "mousemove", "keydown"];
        const potentialLeaks = [];
        events.forEach((event) => {
          // Can't directly count, but we can warn about common patterns
        });

        // Check for large arrays in global scope
        const globalKeys = Object.keys(window).filter((k) => {
          try {
            const val = window[k];
            return Array.isArray(val) && val.length > 1000;
          } catch {
            return false;
          }
        });

        if (globalKeys.length > 0) {
          warnings.push({
            type: "large-global-arrays",
            keys: globalKeys.slice(0, 10),
            message: "Large arrays in global scope",
          });
        }

        // Check DOM size
        const domSize = document.querySelectorAll("*").length;
        if (domSize > 1500) {
          warnings.push({
            type: "large-dom",
            count: domSize,
            message: `DOM has ${domSize} elements (>1500 may impact performance)`,
          });
        }

        return { warnings, domSize };
      },
    });
    return result[0]?.result || { warnings: [] };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 21: Frame Analysis ====================

async function getAllFrames(tabId) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    return {
      frames: frames.map((f) => ({
        frameId: f.frameId,
        parentFrameId: f.parentFrameId,
        url: f.url,
        frameType: f.frameType,
      })),
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function getFrameInfo(tabId, frameId) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const frame = frames.find((f) => f.frameId === frameId);

    if (!frame) return { error: "Frame not found" };

    return {
      frameId: frame.frameId,
      parentFrameId: frame.parentFrameId,
      url: frame.url,
      frameType: frame.frameType,
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function executeInFrame(tabId, frameId, script) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: new Function(`return (${script})`)(),
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getFrameTree(tabId) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });

    // Build tree structure
    const frameMap = new Map();
    const roots = [];

    frames.forEach((f) => {
      frameMap.set(f.frameId, { ...f, children: [] });
    });

    frames.forEach((f) => {
      const node = frameMap.get(f.frameId);
      if (f.parentFrameId === -1) {
        roots.push(node);
      } else {
        const parent = frameMap.get(f.parentFrameId);
        if (parent) parent.children.push(node);
      }
    });

    return { tree: roots, totalFrames: frames.length };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 21: Security Analysis ====================

async function getSecurityInfo(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        isSecureContext: window.isSecureContext,
        protocol: window.location.protocol,
        origin: window.location.origin,
        referrerPolicy: document.referrerPolicy,
        crossOriginIsolated: window.crossOriginIsolated,
      }),
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getCSPInfo(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const meta = document.querySelector(
          'meta[http-equiv="Content-Security-Policy"]',
        );
        return {
          hasCSP: !!meta,
          cspContent: meta?.content || null,
          // Note: HTTP header CSP can't be read from content script
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function checkMixedContent(tabId) {
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

async function getCertificateInfo(tabId) {
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

async function checkCORSIssues(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const resources = performance.getEntriesByType("resource");
        const crossOrigin = resources.filter((r) => {
          try {
            const url = new URL(r.name);
            return url.origin !== window.location.origin;
          } catch {
            return false;
          }
        });

        return {
          totalResources: resources.length,
          crossOriginResources: crossOrigin.length,
          crossOriginList: crossOrigin.slice(0, 20).map((r) => ({
            url: r.name.slice(0, 100),
            type: r.initiatorType,
            timing: r.transferSize > 0 ? "loaded" : "blocked-or-cached",
          })),
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 21: Network Timing ====================

async function getNetworkTiming(tabId) {
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

async function getNetworkWaterfall(tabId) {
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

async function analyzeNetworkRequests(tabId) {
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

// ==================== Phase 22: WebRTC ====================

async function getWebRTCPeerConnections(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Check if RTCPeerConnection tracking is available
        const connections = window.__rtcPeerConnections || [];
        return connections.map((pc, index) => ({
          id: index,
          connectionState: pc.connectionState,
          iceConnectionState: pc.iceConnectionState,
          iceGatheringState: pc.iceGatheringState,
          signalingState: pc.signalingState,
          localStreams: pc.getLocalStreams?.()?.length || 0,
          remoteStreams: pc.getRemoteStreams?.()?.length || 0,
        }));
      },
    });
    return { connections: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function getWebRTCConnectionStats(tabId, connectionId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (connId) => {
        const connections = window.__rtcPeerConnections || [];
        const pc = connections[connId];
        if (!pc) return { error: "Connection not found" };

        try {
          const stats = await pc.getStats();
          const statsArray = [];
          stats.forEach((stat) => {
            statsArray.push({
              id: stat.id,
              type: stat.type,
              timestamp: stat.timestamp,
              ...stat,
            });
          });
          return { stats: statsArray };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [connectionId],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getWebRTCDataChannels(tabId, connectionId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (connId) => {
        const connections = window.__rtcPeerConnections || [];
        const pc = connections[connId];
        if (!pc) return { error: "Connection not found" };

        const channels = window.__rtcDataChannels?.[connId] || [];
        return channels.map((dc) => ({
          label: dc.label,
          id: dc.id,
          readyState: dc.readyState,
          bufferedAmount: dc.bufferedAmount,
          ordered: dc.ordered,
          protocol: dc.protocol,
        }));
      },
      args: [connectionId],
    });
    return { channels: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function getWebRTCMediaStreams(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const streams = [];
        const connections = window.__rtcPeerConnections || [];

        connections.forEach((pc, pcIndex) => {
          // Local streams
          pc.getLocalStreams?.().forEach((stream) => {
            streams.push({
              connectionId: pcIndex,
              type: "local",
              id: stream.id,
              active: stream.active,
              tracks: stream.getTracks().map((t) => ({
                kind: t.kind,
                id: t.id,
                label: t.label,
                enabled: t.enabled,
                muted: t.muted,
                readyState: t.readyState,
              })),
            });
          });

          // Remote streams
          pc.getRemoteStreams?.().forEach((stream) => {
            streams.push({
              connectionId: pcIndex,
              type: "remote",
              id: stream.id,
              active: stream.active,
              tracks: stream.getTracks().map((t) => ({
                kind: t.kind,
                id: t.id,
                label: t.label,
                enabled: t.enabled,
                muted: t.muted,
                readyState: t.readyState,
              })),
            });
          });
        });

        return streams;
      },
    });
    return { streams: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function getICECandidates(tabId, connectionId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (connId) => {
        const candidates = window.__rtcICECandidates?.[connId] || [];
        return candidates.map((c) => ({
          candidate: c.candidate,
          sdpMid: c.sdpMid,
          sdpMLineIndex: c.sdpMLineIndex,
          type: c.type,
          protocol: c.protocol,
          address: c.address,
          port: c.port,
        }));
      },
      args: [connectionId],
    });
    return { candidates: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function getLocalDescription(tabId, connectionId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (connId) => {
        const connections = window.__rtcPeerConnections || [];
        const pc = connections[connId];
        if (!pc) return { error: "Connection not found" };

        const desc = pc.localDescription;
        return desc ? { type: desc.type, sdp: desc.sdp?.slice(0, 500) } : null;
      },
      args: [connectionId],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getRemoteDescription(tabId, connectionId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (connId) => {
        const connections = window.__rtcPeerConnections || [];
        const pc = connections[connId];
        if (!pc) return { error: "Connection not found" };

        const desc = pc.remoteDescription;
        return desc ? { type: desc.type, sdp: desc.sdp?.slice(0, 500) } : null;
      },
      args: [connectionId],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function monitorWebRTCConnection(tabId, connectionId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (connId) => {
        const connections = window.__rtcPeerConnections || [];
        const pc = connections[connId];
        if (!pc) return { error: "Connection not found" };

        // Set up monitoring (stores events for later retrieval)
        if (!window.__rtcMonitoring) window.__rtcMonitoring = {};
        window.__rtcMonitoring[connId] = {
          events: [],
          startTime: Date.now(),
        };

        const monitor = window.__rtcMonitoring[connId];

        pc.onconnectionstatechange = () => {
          monitor.events.push({
            type: "connectionstatechange",
            state: pc.connectionState,
            timestamp: Date.now(),
          });
        };

        pc.oniceconnectionstatechange = () => {
          monitor.events.push({
            type: "iceconnectionstatechange",
            state: pc.iceConnectionState,
            timestamp: Date.now(),
          });
        };

        return { success: true, message: "Monitoring started" };
      },
      args: [connectionId],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function closeWebRTCConnection(tabId, connectionId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (connId) => {
        const connections = window.__rtcPeerConnections || [];
        const pc = connections[connId];
        if (!pc) return { error: "Connection not found" };

        pc.close();
        return { success: true };
      },
      args: [connectionId],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 22: Advanced IndexedDB ====================

async function listIndexedDBDatabases(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (!indexedDB.databases) {
          return { error: "indexedDB.databases() not supported" };
        }
        const databases = await indexedDB.databases();
        return databases.map((db) => ({
          name: db.name,
          version: db.version,
        }));
      },
    });
    return { databases: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function getIndexedDBDatabaseInfo(tabId, dbName) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (name) => {
        return new Promise((resolve) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => {
            const db = request.result;
            const info = {
              name: db.name,
              version: db.version,
              objectStoreNames: Array.from(db.objectStoreNames),
            };
            db.close();
            resolve(info);
          };
          request.onerror = () => resolve({ error: request.error?.message });
        });
      },
      args: [dbName],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getIndexedDBObjectStores(tabId, dbName) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (name) => {
        return new Promise((resolve) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => {
            const db = request.result;
            const stores = [];

            for (const storeName of db.objectStoreNames) {
              const tx = db.transaction(storeName, "readonly");
              const store = tx.objectStore(storeName);
              stores.push({
                name: storeName,
                keyPath: store.keyPath,
                autoIncrement: store.autoIncrement,
                indexNames: Array.from(store.indexNames),
              });
            }

            db.close();
            resolve(stores);
          };
          request.onerror = () => resolve({ error: request.error?.message });
        });
      },
      args: [dbName],
    });
    return { stores: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function getIndexedDBStoreData(tabId, dbName, storeName, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (name, store, opts) => {
        return new Promise((resolve) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(store, "readonly");
            const objectStore = tx.objectStore(store);

            const limit = opts.limit || 100;
            const offset = opts.offset || 0;
            const data = [];
            let count = 0;

            const cursorRequest = objectStore.openCursor();
            cursorRequest.onsuccess = (event) => {
              const cursor = event.target.result;
              if (cursor && data.length < limit) {
                if (count >= offset) {
                  data.push({
                    key: cursor.key,
                    value: cursor.value,
                  });
                }
                count++;
                cursor.continue();
              } else {
                db.close();
                resolve({ data, total: count });
              }
            };
            cursorRequest.onerror = () => {
              db.close();
              resolve({ error: cursorRequest.error?.message });
            };
          };
          request.onerror = () => resolve({ error: request.error?.message });
        });
      },
      args: [dbName, storeName, options],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getIndexedDBStoreIndexes(tabId, dbName, storeName) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (name, store) => {
        return new Promise((resolve) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(store, "readonly");
            const objectStore = tx.objectStore(store);

            const indexes = [];
            for (const indexName of objectStore.indexNames) {
              const index = objectStore.index(indexName);
              indexes.push({
                name: indexName,
                keyPath: index.keyPath,
                unique: index.unique,
                multiEntry: index.multiEntry,
              });
            }

            db.close();
            resolve(indexes);
          };
          request.onerror = () => resolve({ error: request.error?.message });
        });
      },
      args: [dbName, storeName],
    });
    return { indexes: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function queryIndexedDBByIndex(
  tabId,
  dbName,
  storeName,
  indexName,
  query,
) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (name, store, idx, q) => {
        return new Promise((resolve) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(store, "readonly");
            const objectStore = tx.objectStore(store);
            const index = objectStore.index(idx);

            const range =
              q.value !== undefined
                ? IDBKeyRange.only(q.value)
                : q.lower !== undefined && q.upper !== undefined
                  ? IDBKeyRange.bound(
                      q.lower,
                      q.upper,
                      q.lowerOpen,
                      q.upperOpen,
                    )
                  : null;

            const data = [];
            const cursorRequest = range
              ? index.openCursor(range)
              : index.openCursor();

            cursorRequest.onsuccess = (event) => {
              const cursor = event.target.result;
              if (cursor && data.length < (q.limit || 50)) {
                data.push({
                  key: cursor.key,
                  primaryKey: cursor.primaryKey,
                  value: cursor.value,
                });
                cursor.continue();
              } else {
                db.close();
                resolve({ data });
              }
            };
            cursorRequest.onerror = () => {
              db.close();
              resolve({ error: cursorRequest.error?.message });
            };
          };
          request.onerror = () => resolve({ error: request.error?.message });
        });
      },
      args: [dbName, storeName, indexName, query],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function countIndexedDBRecords(tabId, dbName, storeName) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (name, store) => {
        return new Promise((resolve) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(store, "readonly");
            const objectStore = tx.objectStore(store);
            const countRequest = objectStore.count();

            countRequest.onsuccess = () => {
              db.close();
              resolve({ count: countRequest.result });
            };
            countRequest.onerror = () => {
              db.close();
              resolve({ error: countRequest.error?.message });
            };
          };
          request.onerror = () => resolve({ error: request.error?.message });
        });
      },
      args: [dbName, storeName],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function deleteIndexedDBDatabase(tabId, dbName) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (name) => {
        return new Promise((resolve) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve({ success: true });
          request.onerror = () => resolve({ error: request.error?.message });
          request.onblocked = () =>
            resolve({ error: "Database deletion blocked" });
        });
      },
      args: [dbName],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function clearIndexedDBStore(tabId, dbName, storeName) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (name, store) => {
        return new Promise((resolve) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(store, "readwrite");
            const objectStore = tx.objectStore(store);
            const clearRequest = objectStore.clear();

            clearRequest.onsuccess = () => {
              db.close();
              resolve({ success: true });
            };
            clearRequest.onerror = () => {
              db.close();
              resolve({ error: clearRequest.error?.message });
            };
          };
          request.onerror = () => resolve({ error: request.error?.message });
        });
      },
      args: [dbName, storeName],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function exportIndexedDBDatabase(tabId, dbName) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (name) => {
        return new Promise((resolve) => {
          const request = indexedDB.open(name);
          request.onsuccess = async () => {
            const db = request.result;
            const exportData = {
              name: db.name,
              version: db.version,
              stores: {},
            };

            const storeNames = Array.from(db.objectStoreNames);

            for (const storeName of storeNames) {
              const tx = db.transaction(storeName, "readonly");
              const store = tx.objectStore(storeName);
              const data = [];

              await new Promise((resolveStore) => {
                const cursor = store.openCursor();
                cursor.onsuccess = (e) => {
                  const c = e.target.result;
                  if (c) {
                    data.push({ key: c.key, value: c.value });
                    c.continue();
                  } else {
                    exportData.stores[storeName] = {
                      keyPath: store.keyPath,
                      autoIncrement: store.autoIncrement,
                      data: data.slice(0, 1000), // Limit for safety
                    };
                    resolveStore();
                  }
                };
              });
            }

            db.close();
            resolve(exportData);
          };
          request.onerror = () => resolve({ error: request.error?.message });
        });
      },
      args: [dbName],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 22: Web Components ====================

async function getCustomElements(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const elements = document.querySelectorAll("*");
        const customElements = [];

        elements.forEach((el) => {
          if (el.tagName.includes("-")) {
            const existing = customElements.find(
              (c) => c.tagName === el.tagName.toLowerCase(),
            );
            if (existing) {
              existing.count++;
            } else {
              customElements.push({
                tagName: el.tagName.toLowerCase(),
                count: 1,
                hasShadowRoot: !!el.shadowRoot,
                attributes: Array.from(el.attributes).map((a) => a.name),
              });
            }
          }
        });

        return customElements;
      },
    });
    return { elements: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function getShadowRoots(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const elements = sel
          ? document.querySelectorAll(sel)
          : document.querySelectorAll("*");
        const shadowRoots = [];

        elements.forEach((el) => {
          if (el.shadowRoot) {
            shadowRoots.push({
              host: el.tagName.toLowerCase(),
              hostId: el.id || null,
              mode: el.shadowRoot.mode,
              childElementCount: el.shadowRoot.childElementCount,
              innerHTML: el.shadowRoot.innerHTML?.slice(0, 200),
            });
          }
        });

        return shadowRoots;
      },
      args: [selector],
    });
    return { shadowRoots: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function queryShadowDOM(tabId, hostSelector, shadowSelector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (host, shadow) => {
        const hostElement = document.querySelector(host);
        if (!hostElement) return { error: "Host element not found" };
        if (!hostElement.shadowRoot) return { error: "No shadow root" };

        const elements = hostElement.shadowRoot.querySelectorAll(shadow);
        return Array.from(elements)
          .slice(0, 50)
          .map((el) => ({
            tagName: el.tagName.toLowerCase(),
            id: el.id || null,
            className: el.className || null,
            textContent: el.textContent?.slice(0, 100),
          }));
      },
      args: [hostSelector, shadowSelector],
    });
    return { elements: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function getSlottedContent(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const element = document.querySelector(sel);
        if (!element) return { error: "Element not found" };

        const slots = element.shadowRoot?.querySelectorAll("slot") || [];
        return Array.from(slots).map((slot) => ({
          name: slot.name || "(default)",
          assignedNodes: slot.assignedNodes().map((n) => ({
            type: n.nodeType === 1 ? "element" : "text",
            tagName: n.tagName?.toLowerCase(),
            textContent: n.textContent?.slice(0, 50),
          })),
        }));
      },
      args: [selector],
    });
    return { slots: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function getAdoptedStylesheets(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        let root = document;
        if (sel) {
          const el = document.querySelector(sel);
          root = el?.shadowRoot || document;
        }

        const sheets = root.adoptedStyleSheets || [];
        return sheets.map((sheet, index) => ({
          index,
          rulesCount: sheet.cssRules?.length || 0,
          disabled: sheet.disabled,
          media: sheet.media?.mediaText || "",
        }));
      },
      args: [selector],
    });
    return { stylesheets: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 22: Drag and Drop ====================

async function simulateDrag(tabId, sourceSelector, targetSelector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (source, target) => {
        const sourceEl = document.querySelector(source);
        const targetEl = document.querySelector(target);

        if (!sourceEl) return { error: "Source element not found" };
        if (!targetEl) return { error: "Target element not found" };

        const dataTransfer = new DataTransfer();

        // Dispatch drag events
        sourceEl.dispatchEvent(
          new DragEvent("dragstart", { bubbles: true, dataTransfer }),
        );
        targetEl.dispatchEvent(
          new DragEvent("dragenter", { bubbles: true, dataTransfer }),
        );
        targetEl.dispatchEvent(
          new DragEvent("dragover", { bubbles: true, dataTransfer }),
        );
        targetEl.dispatchEvent(
          new DragEvent("drop", { bubbles: true, dataTransfer }),
        );
        sourceEl.dispatchEvent(
          new DragEvent("dragend", { bubbles: true, dataTransfer }),
        );

        return { success: true };
      },
      args: [sourceSelector, targetSelector],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function simulateFileDrop(tabId, selector, files) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel, fileData) => {
        const element = document.querySelector(sel);
        if (!element) return { error: "Element not found" };

        const dataTransfer = new DataTransfer();

        // Create mock files
        fileData.forEach((f) => {
          const file = new File([f.content || ""], f.name, {
            type: f.type || "text/plain",
          });
          dataTransfer.items.add(file);
        });

        element.dispatchEvent(
          new DragEvent("dragenter", { bubbles: true, dataTransfer }),
        );
        element.dispatchEvent(
          new DragEvent("dragover", { bubbles: true, dataTransfer }),
        );
        element.dispatchEvent(
          new DragEvent("drop", { bubbles: true, dataTransfer }),
        );

        return { success: true, filesDropped: fileData.length };
      },
      args: [selector, files],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getDropZones(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const elements = document.querySelectorAll("*");
        const dropZones = [];

        elements.forEach((el) => {
          // Check for dragover or drop event handlers
          const events = el.ondragover || el.ondrop;
          const attr = el.getAttribute("dropzone");

          if (events || attr) {
            dropZones.push({
              tagName: el.tagName.toLowerCase(),
              id: el.id || null,
              className: el.className || null,
              dropzoneAttr: attr,
            });
          }
        });

        return dropZones;
      },
    });
    return { dropZones: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function getDraggableElements(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const elements = document.querySelectorAll("[draggable='true']");
        return Array.from(elements)
          .slice(0, 100)
          .map((el) => ({
            tagName: el.tagName.toLowerCase(),
            id: el.id || null,
            className: el.className || null,
            textContent: el.textContent?.slice(0, 50),
          }));
      },
    });
    return { elements: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 22: Selection & Range ====================

async function getTextSelection(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
          return { hasSelection: false };
        }

        const range = selection.getRangeAt(0);
        return {
          hasSelection: true,
          text: selection.toString(),
          rangeCount: selection.rangeCount,
          isCollapsed: selection.isCollapsed,
          startContainer: range.startContainer.nodeName,
          startOffset: range.startOffset,
          endContainer: range.endContainer.nodeName,
          endOffset: range.endOffset,
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function setTextSelection(tabId, selector, start, end) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel, s, e) => {
        const element = document.querySelector(sel);
        if (!element) return { error: "Element not found" };

        if (element.setSelectionRange) {
          // Input/textarea
          element.focus();
          element.setSelectionRange(s, e);
          return { success: true };
        } else {
          // Regular element
          const range = document.createRange();
          const textNode = element.firstChild;
          if (!textNode) return { error: "No text content" };

          range.setStart(textNode, Math.min(s, textNode.length));
          range.setEnd(textNode, Math.min(e, textNode.length));

          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          return { success: true };
        }
      },
      args: [selector, start, end],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function selectAllText(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const element = sel ? document.querySelector(sel) : document.body;
        if (!element) return { error: "Element not found" };

        const range = document.createRange();
        range.selectNodeContents(element);

        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        return {
          success: true,
          selectedText: selection.toString().slice(0, 100),
        };
      },
      args: [selector],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function clearSelection(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        window.getSelection().removeAllRanges();
        return { success: true };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getSelectedHTML(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
          return { html: "" };
        }

        const range = selection.getRangeAt(0);
        const div = document.createElement("div");
        div.appendChild(range.cloneContents());
        return { html: div.innerHTML };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 22: History & Navigation ====================

async function getHistoryState(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        state: window.history.state,
        length: window.history.length,
        scrollRestoration: window.history.scrollRestoration,
      }),
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function pushHistoryState(tabId, state, title, url) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (s, t, u) => {
        try {
          window.history.pushState(s, t, u);
          return { success: true, newLength: window.history.length };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [state, title, url],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function replaceHistoryState(tabId, state, title, url) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (s, t, u) => {
        try {
          window.history.replaceState(s, t, u);
          return { success: true };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [state, title, url],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getHistoryLength(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({ length: window.history.length }),
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function historyGo(tabId, delta) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (d) => {
        window.history.go(d);
        return { success: true };
      },
      args: [delta],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 22: Intersection Observer ====================

async function observeIntersection(tabId, selector, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel, opts) => {
        return new Promise((resolve) => {
          const elements = document.querySelectorAll(sel);
          if (elements.length === 0) {
            resolve({ error: "No elements found" });
            return;
          }

          const results = [];
          const observer = new IntersectionObserver(
            (entries) => {
              entries.forEach((entry) => {
                results.push({
                  target: entry.target.tagName.toLowerCase(),
                  targetId: entry.target.id || null,
                  isIntersecting: entry.isIntersecting,
                  intersectionRatio: entry.intersectionRatio,
                  boundingClientRect: {
                    top: Math.round(entry.boundingClientRect.top),
                    left: Math.round(entry.boundingClientRect.left),
                    width: Math.round(entry.boundingClientRect.width),
                    height: Math.round(entry.boundingClientRect.height),
                  },
                });
              });

              observer.disconnect();
              resolve({ entries: results });
            },
            {
              threshold: opts.threshold || [0, 0.5, 1],
              rootMargin: opts.rootMargin || "0px",
            },
          );

          elements.forEach((el) => observer.observe(el));

          // Timeout fallback
          setTimeout(() => {
            observer.disconnect();
            resolve({ entries: results, timeout: true });
          }, 500);
        });
      },
      args: [selector, options],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getVisibleElements(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const elements = document.querySelectorAll(sel);
        const visible = [];

        elements.forEach((el) => {
          const rect = el.getBoundingClientRect();
          const isVisible =
            rect.top < window.innerHeight &&
            rect.bottom > 0 &&
            rect.left < window.innerWidth &&
            rect.right > 0;

          if (isVisible) {
            visible.push({
              tagName: el.tagName.toLowerCase(),
              id: el.id || null,
              className: el.className || null,
              rect: {
                top: Math.round(rect.top),
                left: Math.round(rect.left),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              },
            });
          }
        });

        return visible;
      },
      args: [selector],
    });
    return { elements: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

async function checkElementVisibility(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const element = document.querySelector(sel);
        if (!element) return { error: "Element not found" };

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return {
          isInViewport:
            rect.top < window.innerHeight &&
            rect.bottom > 0 &&
            rect.left < window.innerWidth &&
            rect.right > 0,
          isDisplayed: style.display !== "none",
          isVisible: style.visibility !== "hidden",
          hasOpacity: parseFloat(style.opacity) > 0,
          hasSize: rect.width > 0 && rect.height > 0,
          rect: {
            top: Math.round(rect.top),
            left: Math.round(rect.left),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        };
      },
      args: [selector],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 22: Resize Observer ====================

async function observeResize(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        return new Promise((resolve) => {
          const element = document.querySelector(sel);
          if (!element) {
            resolve({ error: "Element not found" });
            return;
          }

          const initialSize = {
            width: element.offsetWidth,
            height: element.offsetHeight,
            contentRect: element.getBoundingClientRect(),
          };

          // Just return current size since ResizeObserver is async
          resolve({
            element: sel,
            size: initialSize,
            message: "Use getElementSizes for multiple elements",
          });
        });
      },
      args: [selector],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getElementSizes(tabId, selectors) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sels) => {
        return sels.map((sel) => {
          const element = document.querySelector(sel);
          if (!element) return { selector: sel, error: "Not found" };

          const rect = element.getBoundingClientRect();
          return {
            selector: sel,
            offsetWidth: element.offsetWidth,
            offsetHeight: element.offsetHeight,
            clientWidth: element.clientWidth,
            clientHeight: element.clientHeight,
            scrollWidth: element.scrollWidth,
            scrollHeight: element.scrollHeight,
            boundingRect: {
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
          };
        });
      },
      args: [selectors],
    });
    return { sizes: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 22: Mutation Summary ====================

async function getMutationSummary(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Return stored mutation data if available
        const summary = window.__mutationSummary || {
          totalMutations: 0,
          addedNodes: 0,
          removedNodes: 0,
          attributeChanges: 0,
          characterDataChanges: 0,
        };
        return summary;
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getMutationChangeHistory(tabId, limit = 50) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (lim) => {
        const history = window.__mutationHistory || [];
        return history.slice(-lim);
      },
      args: [limit],
    });
    return { history: result[0]?.result || [] };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 23: Web Share API ====================

async function canShare(tabId, data) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (shareData) => {
        if (!navigator.share) {
          return { supported: false, reason: "Web Share API not supported" };
        }
        if (!navigator.canShare) {
          return {
            supported: true,
            canShare: true,
            reason: "canShare not available, assuming true",
          };
        }
        try {
          const canShare = navigator.canShare(shareData);
          return { supported: true, canShare };
        } catch (e) {
          return { supported: true, canShare: false, reason: e.message };
        }
      },
      args: [data || {}],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function share(tabId, data) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (shareData) => {
        if (!navigator.share) {
          return { error: "Web Share API not supported" };
        }
        try {
          await navigator.share(shareData);
          return { success: true };
        } catch (e) {
          if (e.name === "AbortError") {
            return { success: false, reason: "User cancelled share" };
          }
          return { error: e.message };
        }
      },
      args: [data],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function shareFiles(tabId, files, data) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (fileDataArray, shareData) => {
        if (!navigator.share || !navigator.canShare) {
          return { error: "File sharing not supported" };
        }
        try {
          // Convert base64 files to File objects
          const fileObjects = fileDataArray.map((f) => {
            const binary = atob(f.data);
            const array = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              array[i] = binary.charCodeAt(i);
            }
            return new File([array], f.name, { type: f.type });
          });

          const fullData = { ...shareData, files: fileObjects };
          if (!navigator.canShare(fullData)) {
            return { error: "Cannot share these files" };
          }
          await navigator.share(fullData);
          return { success: true };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [files, data || {}],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getShareTargets(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Note: There's no API to enumerate share targets
        // Return capability info instead
        return {
          webShareSupported: !!navigator.share,
          canShareSupported: !!navigator.canShare,
          fileShareSupported: navigator.canShare
            ? navigator.canShare({ files: [new File(["test"], "test.txt")] })
            : false,
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 23: Credential Management API ====================

async function getCredential(tabId, options) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (opts) => {
        if (!navigator.credentials) {
          return { error: "Credential Management API not supported" };
        }
        try {
          const credential = await navigator.credentials.get(opts);
          if (!credential) {
            return { credential: null };
          }
          // Return serializable credential info
          return {
            credential: {
              id: credential.id,
              type: credential.type,
              // PasswordCredential specific
              name: credential.name,
              iconURL: credential.iconURL,
              // FederatedCredential specific
              provider: credential.provider,
              protocol: credential.protocol,
            },
          };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [options || { password: true }],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function storeCredential(tabId, credentialData) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (data) => {
        if (!navigator.credentials || !window.PasswordCredential) {
          return { error: "Credential Management API not supported" };
        }
        try {
          const credential = new PasswordCredential(data);
          const stored = await navigator.credentials.store(credential);
          return { success: true, id: stored?.id };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [credentialData],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function createCredential(tabId, options) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (opts) => {
        if (!navigator.credentials) {
          return { error: "Credential Management API not supported" };
        }
        try {
          const credential = await navigator.credentials.create(opts);
          if (!credential) {
            return { credential: null };
          }
          // Return serializable info
          const info = {
            id: credential.id,
            type: credential.type,
          };
          // PublicKeyCredential specific
          if (credential.rawId) {
            info.rawId = Array.from(new Uint8Array(credential.rawId));
          }
          return { credential: info };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [options],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function preventSilentAccess(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (!navigator.credentials) {
          return { error: "Credential Management API not supported" };
        }
        try {
          await navigator.credentials.preventSilentAccess();
          return { success: true };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function isConditionalMediationAvailable(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (!window.PublicKeyCredential) {
          return { available: false, reason: "WebAuthn not supported" };
        }
        if (!PublicKeyCredential.isConditionalMediationAvailable) {
          return {
            available: false,
            reason: "Conditional mediation not supported",
          };
        }
        try {
          const available =
            await PublicKeyCredential.isConditionalMediationAvailable();
          return { available };
        } catch (e) {
          return { available: false, error: e.message };
        }
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getPublicKeyCredential(tabId, options) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (opts) => {
        if (!window.PublicKeyCredential) {
          return { error: "WebAuthn not supported" };
        }
        try {
          // Convert challenge from array to ArrayBuffer if needed
          if (
            opts.publicKey?.challenge &&
            Array.isArray(opts.publicKey.challenge)
          ) {
            opts.publicKey.challenge = new Uint8Array(
              opts.publicKey.challenge,
            ).buffer;
          }
          const credential = await navigator.credentials.get(opts);
          if (!credential) {
            return { credential: null };
          }
          return {
            credential: {
              id: credential.id,
              type: credential.type,
              rawId: Array.from(new Uint8Array(credential.rawId)),
              authenticatorAttachment: credential.authenticatorAttachment,
            },
          };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [options],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 23: Screen Wake Lock API ====================

async function requestWakeLock(tabId, type = "screen") {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (lockType) => {
        if (!navigator.wakeLock) {
          return { error: "Screen Wake Lock API not supported" };
        }
        try {
          const wakeLock = await navigator.wakeLock.request(lockType);
          // Store reference for later release
          window.__wakeLock = wakeLock;
          wakeLock.addEventListener("release", () => {
            window.__wakeLock = null;
          });
          return { success: true, type: wakeLock.type };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [type],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function releaseWakeLock(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (!window.__wakeLock) {
          return { error: "No active wake lock" };
        }
        try {
          await window.__wakeLock.release();
          window.__wakeLock = null;
          return { success: true };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getWakeLockState(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return {
          active: !!window.__wakeLock,
          type: window.__wakeLock?.type || null,
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function isWakeLockSupported(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return { supported: !!navigator.wakeLock };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 23: File System Access API ====================

async function showOpenFilePicker(tabId, options) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (opts) => {
        if (!window.showOpenFilePicker) {
          return { error: "File System Access API not supported" };
        }
        try {
          const handles = await window.showOpenFilePicker(opts);
          // Store handles and return info
          if (!window.__fileHandles) window.__fileHandles = new Map();
          const results = [];
          for (const handle of handles) {
            const id = `fh_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            window.__fileHandles.set(id, handle);
            const file = await handle.getFile();
            results.push({
              id,
              name: handle.name,
              kind: handle.kind,
              size: file.size,
              type: file.type,
              lastModified: file.lastModified,
            });
          }
          return { handles: results };
        } catch (e) {
          if (e.name === "AbortError") {
            return { cancelled: true };
          }
          return { error: e.message };
        }
      },
      args: [options || {}],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function showSaveFilePicker(tabId, options) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (opts) => {
        if (!window.showSaveFilePicker) {
          return { error: "File System Access API not supported" };
        }
        try {
          const handle = await window.showSaveFilePicker(opts);
          if (!window.__fileHandles) window.__fileHandles = new Map();
          const id = `fh_${Date.now()}_${Math.random().toString(36).slice(2)}`;
          window.__fileHandles.set(id, handle);
          return {
            handle: {
              id,
              name: handle.name,
              kind: handle.kind,
            },
          };
        } catch (e) {
          if (e.name === "AbortError") {
            return { cancelled: true };
          }
          return { error: e.message };
        }
      },
      args: [options || {}],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function showDirectoryPicker(tabId, options) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (opts) => {
        if (!window.showDirectoryPicker) {
          return { error: "File System Access API not supported" };
        }
        try {
          const handle = await window.showDirectoryPicker(opts);
          if (!window.__fileHandles) window.__fileHandles = new Map();
          const id = `dh_${Date.now()}_${Math.random().toString(36).slice(2)}`;
          window.__fileHandles.set(id, handle);

          // Get directory entries
          const entries = [];
          for await (const [name, entryHandle] of handle.entries()) {
            entries.push({ name, kind: entryHandle.kind });
          }
          return {
            handle: {
              id,
              name: handle.name,
              kind: handle.kind,
            },
            entries,
          };
        } catch (e) {
          if (e.name === "AbortError") {
            return { cancelled: true };
          }
          return { error: e.message };
        }
      },
      args: [options || {}],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getFileSystemHandle(tabId, name, options) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (fileName, opts) => {
        if (!window.__fileHandles) {
          return { error: "No file handles available" };
        }
        // Find directory handle
        const dirHandle = Array.from(window.__fileHandles.values()).find(
          (h) => h.kind === "directory",
        );
        if (!dirHandle) {
          return { error: "No directory handle available" };
        }
        try {
          const handle = await dirHandle.getFileHandle(fileName, opts);
          const id = `fh_${Date.now()}_${Math.random().toString(36).slice(2)}`;
          window.__fileHandles.set(id, handle);
          const file = await handle.getFile();
          return {
            handle: {
              id,
              name: handle.name,
              kind: handle.kind,
              size: file.size,
              type: file.type,
            },
          };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [name, options || {}],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function readFileFromHandle(tabId, handleId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (hId) => {
        if (!window.__fileHandles || !window.__fileHandles.has(hId)) {
          return { error: "Handle not found" };
        }
        try {
          const handle = window.__fileHandles.get(hId);
          if (handle.kind !== "file") {
            return { error: "Not a file handle" };
          }
          const file = await handle.getFile();
          const content = await file.text();
          return {
            content,
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified,
          };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [handleId],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function writeFileToHandle(tabId, handleId, content) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (hId, data) => {
        if (!window.__fileHandles || !window.__fileHandles.has(hId)) {
          return { error: "Handle not found" };
        }
        try {
          const handle = window.__fileHandles.get(hId);
          if (handle.kind !== "file") {
            return { error: "Not a file handle" };
          }
          const writable = await handle.createWritable();
          await writable.write(data);
          await writable.close();
          return { success: true, bytesWritten: data.length };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [handleId, content],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getFileHandleInfo(tabId, handleId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (hId) => {
        if (!window.__fileHandles || !window.__fileHandles.has(hId)) {
          return { error: "Handle not found" };
        }
        try {
          const handle = window.__fileHandles.get(hId);
          const info = {
            name: handle.name,
            kind: handle.kind,
          };
          if (handle.kind === "file") {
            const file = await handle.getFile();
            info.size = file.size;
            info.type = file.type;
            info.lastModified = file.lastModified;
          } else if (handle.kind === "directory") {
            const entries = [];
            for await (const [name, entryHandle] of handle.entries()) {
              entries.push({ name, kind: entryHandle.kind });
            }
            info.entries = entries;
          }
          return info;
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [handleId],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function removeFileEntry(tabId, handleId, options) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (hId, opts) => {
        if (!window.__fileHandles || !window.__fileHandles.has(hId)) {
          return { error: "Handle not found" };
        }
        try {
          const handle = window.__fileHandles.get(hId);
          if (!handle.remove) {
            return { error: "Remove not supported for this handle" };
          }
          await handle.remove(opts);
          window.__fileHandles.delete(hId);
          return { success: true };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [handleId, options || {}],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 23: Tab Groups API ====================

async function createTabGroup(tabIds, options = {}) {
  try {
    if (!chrome.tabGroups) {
      return { error: "Tab Groups API not supported" };
    }
    const groupId = await chrome.tabs.group({ tabIds });
    if (options.title || options.color || options.collapsed !== undefined) {
      await chrome.tabGroups.update(groupId, {
        title: options.title,
        color: options.color,
        collapsed: options.collapsed,
      });
    }
    const group = await chrome.tabGroups.get(groupId);
    return {
      groupId,
      title: group.title,
      color: group.color,
      collapsed: group.collapsed,
      windowId: group.windowId,
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function getTabGroup(groupId) {
  try {
    if (!chrome.tabGroups) {
      return { error: "Tab Groups API not supported" };
    }
    const group = await chrome.tabGroups.get(groupId);
    const tabs = await chrome.tabs.query({ groupId });
    return {
      id: group.id,
      title: group.title,
      color: group.color,
      collapsed: group.collapsed,
      windowId: group.windowId,
      tabs: tabs.map((t) => ({ id: t.id, title: t.title, url: t.url })),
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function getAllTabGroups(windowId) {
  try {
    if (!chrome.tabGroups) {
      return { error: "Tab Groups API not supported" };
    }
    const queryInfo = windowId ? { windowId } : {};
    const groups = await chrome.tabGroups.query(queryInfo);
    const result = [];
    for (const group of groups) {
      const tabs = await chrome.tabs.query({ groupId: group.id });
      result.push({
        id: group.id,
        title: group.title,
        color: group.color,
        collapsed: group.collapsed,
        windowId: group.windowId,
        tabCount: tabs.length,
      });
    }
    return { groups: result };
  } catch (error) {
    return { error: error.message };
  }
}

async function updateTabGroup(groupId, options) {
  try {
    if (!chrome.tabGroups) {
      return { error: "Tab Groups API not supported" };
    }
    const group = await chrome.tabGroups.update(groupId, options);
    return {
      id: group.id,
      title: group.title,
      color: group.color,
      collapsed: group.collapsed,
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function moveTabGroup(groupId, moveProperties) {
  try {
    if (!chrome.tabGroups) {
      return { error: "Tab Groups API not supported" };
    }
    const group = await chrome.tabGroups.move(groupId, moveProperties);
    return {
      id: group.id,
      windowId: group.windowId,
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function ungroupTabs(tabIds) {
  try {
    await chrome.tabs.ungroup(tabIds);
    return { success: true, ungroupedTabs: tabIds.length };
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 23: Eye Dropper API ====================

async function openEyeDropper(tabId, options) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (opts) => {
        if (!window.EyeDropper) {
          return { error: "EyeDropper API not supported" };
        }
        try {
          const eyeDropper = new EyeDropper();
          const result = await eyeDropper.open(opts);
          return { color: result.sRGBHex };
        } catch (e) {
          if (e.name === "AbortError") {
            return { cancelled: true };
          }
          return { error: e.message };
        }
      },
      args: [options || {}],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function isEyeDropperSupported(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return { supported: !!window.EyeDropper };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 23: Speech Synthesis API ====================

async function speak(tabId, text, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (txt, opts) => {
        if (!window.speechSynthesis) {
          return { error: "Speech Synthesis not supported" };
        }
        try {
          const utterance = new SpeechSynthesisUtterance(txt);
          if (opts.lang) utterance.lang = opts.lang;
          if (opts.pitch !== undefined) utterance.pitch = opts.pitch;
          if (opts.rate !== undefined) utterance.rate = opts.rate;
          if (opts.volume !== undefined) utterance.volume = opts.volume;
          if (opts.voice) {
            const voices = speechSynthesis.getVoices();
            const voice = voices.find(
              (v) => v.name === opts.voice || v.voiceURI === opts.voice,
            );
            if (voice) utterance.voice = voice;
          }

          // Store for control
          window.__currentUtterance = utterance;

          return new Promise((resolve) => {
            utterance.onend = () => {
              window.__currentUtterance = null;
              resolve({ success: true, completed: true });
            };
            utterance.onerror = (e) => {
              window.__currentUtterance = null;
              resolve({ error: e.error });
            };
            speechSynthesis.speak(utterance);
            // Return immediately since speech is async
            setTimeout(() => resolve({ success: true, speaking: true }), 100);
          });
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [text, options],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function cancelSpeech(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!window.speechSynthesis) {
          return { error: "Speech Synthesis not supported" };
        }
        speechSynthesis.cancel();
        window.__currentUtterance = null;
        return { success: true };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function pauseSpeech(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!window.speechSynthesis) {
          return { error: "Speech Synthesis not supported" };
        }
        speechSynthesis.pause();
        return { success: true, paused: true };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function resumeSpeech(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!window.speechSynthesis) {
          return { error: "Speech Synthesis not supported" };
        }
        speechSynthesis.resume();
        return { success: true, resumed: true };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getVoices(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!window.speechSynthesis) {
          return { error: "Speech Synthesis not supported" };
        }
        const voices = speechSynthesis.getVoices();
        return {
          voices: voices.map((v) => ({
            name: v.name,
            lang: v.lang,
            voiceURI: v.voiceURI,
            default: v.default,
            localService: v.localService,
          })),
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function isSpeaking(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!window.speechSynthesis) {
          return { error: "Speech Synthesis not supported" };
        }
        return { speaking: speechSynthesis.speaking };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function isSpeechPending(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!window.speechSynthesis) {
          return { error: "Speech Synthesis not supported" };
        }
        return { pending: speechSynthesis.pending };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function isSpeechPaused(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!window.speechSynthesis) {
          return { error: "Speech Synthesis not supported" };
        }
        return { paused: speechSynthesis.paused };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 23: Background Sync API ====================

async function registerBackgroundSync(tabId, tag) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (syncTag) => {
        if (!navigator.serviceWorker) {
          return { error: "Service Worker not supported" };
        }
        try {
          const registration = await navigator.serviceWorker.ready;
          if (!registration.sync) {
            return { error: "Background Sync not supported" };
          }
          await registration.sync.register(syncTag);
          return { success: true, tag: syncTag };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [tag],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getBackgroundSyncTags(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (!navigator.serviceWorker) {
          return { error: "Service Worker not supported" };
        }
        try {
          const registration = await navigator.serviceWorker.ready;
          if (!registration.sync) {
            return { error: "Background Sync not supported" };
          }
          const tags = await registration.sync.getTags();
          return { tags };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getBackgroundSyncRegistration(tabId, tag) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (syncTag) => {
        if (!navigator.serviceWorker) {
          return { error: "Service Worker not supported" };
        }
        try {
          const registration = await navigator.serviceWorker.ready;
          if (!registration.sync) {
            return { error: "Background Sync not supported" };
          }
          const tags = await registration.sync.getTags();
          const exists = tags.includes(syncTag);
          return { tag: syncTag, registered: exists };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [tag],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getBackgroundSyncRegistrations(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (!navigator.serviceWorker) {
          return { error: "Service Worker not supported" };
        }
        try {
          const registration = await navigator.serviceWorker.ready;
          if (!registration.sync) {
            return { error: "Background Sync not supported" };
          }
          const tags = await registration.sync.getTags();
          return { registrations: tags.map((tag) => ({ tag })) };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 23: Periodic Background Sync API ====================

async function registerPeriodicSync(tabId, tag, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (syncTag, opts) => {
        if (!navigator.serviceWorker) {
          return { error: "Service Worker not supported" };
        }
        try {
          const registration = await navigator.serviceWorker.ready;
          if (!registration.periodicSync) {
            return { error: "Periodic Background Sync not supported" };
          }
          await registration.periodicSync.register(syncTag, opts);
          return { success: true, tag: syncTag, minInterval: opts.minInterval };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [tag, options],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function unregisterPeriodicSync(tabId, tag) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (syncTag) => {
        if (!navigator.serviceWorker) {
          return { error: "Service Worker not supported" };
        }
        try {
          const registration = await navigator.serviceWorker.ready;
          if (!registration.periodicSync) {
            return { error: "Periodic Background Sync not supported" };
          }
          await registration.periodicSync.unregister(syncTag);
          return { success: true, tag: syncTag };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [tag],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getPeriodicSyncTags(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (!navigator.serviceWorker) {
          return { error: "Service Worker not supported" };
        }
        try {
          const registration = await navigator.serviceWorker.ready;
          if (!registration.periodicSync) {
            return { error: "Periodic Background Sync not supported" };
          }
          const tags = await registration.periodicSync.getTags();
          return { tags };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getPeriodicSyncMinInterval(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Minimum interval is typically 12 hours (43200000 ms) for most browsers
        return {
          minInterval: 43200000, // 12 hours in milliseconds
          note: "Actual minimum depends on user engagement and browser heuristics",
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 23: Idle Detection API ====================

async function requestIdleDetectionPermission(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (!window.IdleDetector) {
          return { error: "Idle Detection API not supported" };
        }
        try {
          const permission = await IdleDetector.requestPermission();
          return { permission };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function startIdleDetection(tabId, threshold = 60000) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (thresh) => {
        if (!window.IdleDetector) {
          return { error: "Idle Detection API not supported" };
        }
        try {
          if (window.__idleDetector) {
            window.__idleDetector.stop();
          }
          const detector = new IdleDetector();
          window.__idleDetector = detector;

          detector.addEventListener("change", () => {
            window.__lastIdleState = {
              userState: detector.userState,
              screenState: detector.screenState,
              timestamp: Date.now(),
            };
          });

          await detector.start({ threshold: thresh });
          return {
            success: true,
            threshold: thresh,
            userState: detector.userState,
            screenState: detector.screenState,
          };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [threshold],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function stopIdleDetection(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!window.__idleDetector) {
          return { error: "No active idle detector" };
        }
        window.__idleDetector.stop();
        window.__idleDetector = null;
        return { success: true };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getIdleState(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!window.__idleDetector) {
          return {
            active: false,
            lastState: window.__lastIdleState || null,
          };
        }
        return {
          active: true,
          userState: window.__idleDetector.userState,
          screenState: window.__idleDetector.screenState,
          lastState: window.__lastIdleState || null,
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 23: Device Memory API ====================

async function getDeviceMemory(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!navigator.deviceMemory) {
          return { error: "Device Memory API not supported" };
        }
        return {
          deviceMemory: navigator.deviceMemory, // in GB, rounded
          note: "Value is rounded to protect privacy (0.25, 0.5, 1, 2, 4, 8)",
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 23: Network Information API ====================

async function getNetworkInformation(tabId) {
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

async function onNetworkChange(tabId, enable) {
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

// ==================== Phase 23: Vibration API ====================

async function vibrate(tabId, pattern) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (p) => {
        if (!navigator.vibrate) {
          return { error: "Vibration API not supported" };
        }
        const success = navigator.vibrate(p);
        return { success };
      },
      args: [pattern],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function cancelVibration(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!navigator.vibrate) {
          return { error: "Vibration API not supported" };
        }
        navigator.vibrate(0);
        return { success: true };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 23: Screen Orientation API ====================

async function getScreenOrientation(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!screen.orientation) {
          return { error: "Screen Orientation API not supported" };
        }
        return {
          type: screen.orientation.type,
          angle: screen.orientation.angle,
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function lockScreenOrientation(tabId, orientation) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (orient) => {
        if (!screen.orientation || !screen.orientation.lock) {
          return { error: "Screen Orientation Lock not supported" };
        }
        try {
          await screen.orientation.lock(orient);
          return { success: true, orientation: screen.orientation.type };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [orientation],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function unlockScreenOrientation(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!screen.orientation || !screen.orientation.unlock) {
          return { error: "Screen Orientation Unlock not supported" };
        }
        screen.orientation.unlock();
        return { success: true };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 23: Presentation API ====================

async function getPresentationAvailability(tabId, urls) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (presentUrls) => {
        if (!navigator.presentation) {
          return { error: "Presentation API not supported" };
        }
        try {
          const request = new PresentationRequest(presentUrls);
          const availability = await request.getAvailability();
          return { available: availability.value };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [urls],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function startPresentation(tabId, urls) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (presentUrls) => {
        if (!navigator.presentation) {
          return { error: "Presentation API not supported" };
        }
        try {
          const request = new PresentationRequest(presentUrls);
          const connection = await request.start();
          // Store for later control
          if (!window.__presentationConnections)
            window.__presentationConnections = new Map();
          window.__presentationConnections.set(connection.id, connection);
          return {
            id: connection.id,
            state: connection.state,
            url: connection.url,
          };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [urls],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function reconnectPresentation(tabId, presentationId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (presId) => {
        if (!navigator.presentation) {
          return { error: "Presentation API not supported" };
        }
        try {
          const request = new PresentationRequest([]);
          const connection = await request.reconnect(presId);
          if (!window.__presentationConnections)
            window.__presentationConnections = new Map();
          window.__presentationConnections.set(connection.id, connection);
          return {
            id: connection.id,
            state: connection.state,
            url: connection.url,
          };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [presentationId],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getPresentationConnections(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!window.__presentationConnections) {
          return { connections: [] };
        }
        const connections = [];
        for (const [id, conn] of window.__presentationConnections) {
          connections.push({
            id,
            state: conn.state,
            url: conn.url,
          });
        }
        return { connections };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function terminatePresentation(tabId, connectionId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (connId) => {
        if (
          !window.__presentationConnections ||
          !window.__presentationConnections.has(connId)
        ) {
          return { error: "Connection not found" };
        }
        const connection = window.__presentationConnections.get(connId);
        connection.terminate();
        window.__presentationConnections.delete(connId);
        return { success: true };
      },
      args: [connectionId],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 23: Reporting API ====================

async function getReports(tabId, types) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (reportTypes) => {
        if (!window.ReportingObserver) {
          return { error: "Reporting API not supported" };
        }
        // Note: ReportingObserver doesn't provide historical reports
        // We can only set up observation
        return {
          note: "Use observer pattern - historical reports not available",
          supportedTypes: ["deprecation", "intervention", "crash"],
          requestedTypes: reportTypes,
        };
      },
      args: [types],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function clearReports(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Clear any stored reports
        window.__collectedReports = [];
        return { success: true };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 24: Web Bluetooth API ====================

async function requestBluetoothDevice(tabId, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (opts) => {
        if (!navigator.bluetooth) {
          return { error: "Web Bluetooth API not supported" };
        }
        try {
          const device = await navigator.bluetooth.requestDevice(opts);
          // Store device for later use
          if (!window.__bluetoothDevices) window.__bluetoothDevices = new Map();
          window.__bluetoothDevices.set(device.id, device);
          return {
            device: {
              id: device.id,
              name: device.name,
              gatt: !!device.gatt,
            },
          };
        } catch (e) {
          if (e.name === "NotFoundError") {
            return { cancelled: true };
          }
          return { error: e.message };
        }
      },
      args: [options],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getBluetoothDevices(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (!navigator.bluetooth || !navigator.bluetooth.getDevices) {
          return { error: "getDevices not supported" };
        }
        try {
          const devices = await navigator.bluetooth.getDevices();
          return {
            devices: devices.map((d) => ({
              id: d.id,
              name: d.name,
              connected: d.gatt?.connected || false,
            })),
          };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getBluetoothAvailability(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (!navigator.bluetooth) {
          return { available: false, reason: "Web Bluetooth not supported" };
        }
        try {
          const available = await navigator.bluetooth.getAvailability();
          return { available };
        } catch (e) {
          return { available: false, error: e.message };
        }
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function connectBluetoothDevice(tabId, deviceId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (devId) => {
        if (
          !window.__bluetoothDevices ||
          !window.__bluetoothDevices.has(devId)
        ) {
          return { error: "Device not found" };
        }
        try {
          const device = window.__bluetoothDevices.get(devId);
          if (!device.gatt) {
            return { error: "GATT not available" };
          }
          const server = await device.gatt.connect();
          return { connected: server.connected, deviceId: devId };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [deviceId],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function disconnectBluetoothDevice(tabId, deviceId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (devId) => {
        if (
          !window.__bluetoothDevices ||
          !window.__bluetoothDevices.has(devId)
        ) {
          return { error: "Device not found" };
        }
        const device = window.__bluetoothDevices.get(devId);
        if (device.gatt?.connected) {
          device.gatt.disconnect();
        }
        return { success: true, disconnected: true };
      },
      args: [deviceId],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getBluetoothServices(tabId, deviceId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (devId) => {
        if (
          !window.__bluetoothDevices ||
          !window.__bluetoothDevices.has(devId)
        ) {
          return { error: "Device not found" };
        }
        try {
          const device = window.__bluetoothDevices.get(devId);
          if (!device.gatt?.connected) {
            return { error: "Device not connected" };
          }
          const services = await device.gatt.getPrimaryServices();
          return {
            services: services.map((s) => ({
              uuid: s.uuid,
              isPrimary: s.isPrimary,
            })),
          };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [deviceId],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 24: Web USB API ====================

async function requestUSBDevice(tabId, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (opts) => {
        if (!navigator.usb) {
          return { error: "Web USB API not supported" };
        }
        try {
          const device = await navigator.usb.requestDevice(opts);
          if (!window.__usbDevices) window.__usbDevices = new Map();
          const id = `usb_${device.vendorId}_${device.productId}_${Date.now()}`;
          window.__usbDevices.set(id, device);
          return {
            device: {
              id,
              vendorId: device.vendorId,
              productId: device.productId,
              productName: device.productName,
              manufacturerName: device.manufacturerName,
              serialNumber: device.serialNumber,
            },
          };
        } catch (e) {
          if (e.name === "NotFoundError") {
            return { cancelled: true };
          }
          return { error: e.message };
        }
      },
      args: [options],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getUSBDevices(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (!navigator.usb) {
          return { error: "Web USB API not supported" };
        }
        try {
          const devices = await navigator.usb.getDevices();
          return {
            devices: devices.map((d, i) => ({
              id: `usb_${d.vendorId}_${d.productId}_${i}`,
              vendorId: d.vendorId,
              productId: d.productId,
              productName: d.productName,
              manufacturerName: d.manufacturerName,
              opened: d.opened,
            })),
          };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function openUSBDevice(tabId, deviceId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (devId) => {
        if (!window.__usbDevices || !window.__usbDevices.has(devId)) {
          return { error: "Device not found" };
        }
        try {
          const device = window.__usbDevices.get(devId);
          await device.open();
          return { success: true, opened: device.opened };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [deviceId],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function closeUSBDevice(tabId, deviceId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (devId) => {
        if (!window.__usbDevices || !window.__usbDevices.has(devId)) {
          return { error: "Device not found" };
        }
        try {
          const device = window.__usbDevices.get(devId);
          await device.close();
          return { success: true };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [deviceId],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function selectUSBConfiguration(tabId, deviceId, configurationValue) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (devId, configVal) => {
        if (!window.__usbDevices || !window.__usbDevices.has(devId)) {
          return { error: "Device not found" };
        }
        try {
          const device = window.__usbDevices.get(devId);
          await device.selectConfiguration(configVal);
          return { success: true, configuration: device.configuration };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [deviceId, configurationValue],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function claimUSBInterface(tabId, deviceId, interfaceNumber) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (devId, intNum) => {
        if (!window.__usbDevices || !window.__usbDevices.has(devId)) {
          return { error: "Device not found" };
        }
        try {
          const device = window.__usbDevices.get(devId);
          await device.claimInterface(intNum);
          return { success: true, interfaceNumber: intNum };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [deviceId, interfaceNumber],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 24: Web Serial API ====================

async function requestSerialPort(tabId, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (opts) => {
        if (!navigator.serial) {
          return { error: "Web Serial API not supported" };
        }
        try {
          const port = await navigator.serial.requestPort(opts);
          if (!window.__serialPorts) window.__serialPorts = new Map();
          const id = `serial_${Date.now()}_${Math.random().toString(36).slice(2)}`;
          window.__serialPorts.set(id, port);
          const info = port.getInfo();
          return {
            port: {
              id,
              usbVendorId: info.usbVendorId,
              usbProductId: info.usbProductId,
            },
          };
        } catch (e) {
          if (e.name === "NotFoundError") {
            return { cancelled: true };
          }
          return { error: e.message };
        }
      },
      args: [options],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getSerialPorts(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (!navigator.serial) {
          return { error: "Web Serial API not supported" };
        }
        try {
          const ports = await navigator.serial.getPorts();
          return {
            ports: ports.map((p, i) => {
              const info = p.getInfo();
              return {
                index: i,
                usbVendorId: info.usbVendorId,
                usbProductId: info.usbProductId,
              };
            }),
          };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function openSerialPort(tabId, portId, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (pId, opts) => {
        if (!window.__serialPorts || !window.__serialPorts.has(pId)) {
          return { error: "Port not found" };
        }
        try {
          const port = window.__serialPorts.get(pId);
          await port.open(opts);
          return {
            success: true,
            readable: !!port.readable,
            writable: !!port.writable,
          };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [portId, options],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function closeSerialPort(tabId, portId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (pId) => {
        if (!window.__serialPorts || !window.__serialPorts.has(pId)) {
          return { error: "Port not found" };
        }
        try {
          const port = window.__serialPorts.get(pId);
          await port.close();
          return { success: true };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [portId],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function readSerialPort(tabId, portId, length = 1024) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (pId, len) => {
        if (!window.__serialPorts || !window.__serialPorts.has(pId)) {
          return { error: "Port not found" };
        }
        try {
          const port = window.__serialPorts.get(pId);
          if (!port.readable) {
            return { error: "Port not readable" };
          }
          const reader = port.readable.getReader();
          const { value, done } = await reader.read();
          reader.releaseLock();
          return {
            data: value ? Array.from(value.slice(0, len)) : [],
            done,
          };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [portId, length],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function writeSerialPort(tabId, portId, data) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (pId, dataArray) => {
        if (!window.__serialPorts || !window.__serialPorts.has(pId)) {
          return { error: "Port not found" };
        }
        try {
          const port = window.__serialPorts.get(pId);
          if (!port.writable) {
            return { error: "Port not writable" };
          }
          const writer = port.writable.getWriter();
          await writer.write(new Uint8Array(dataArray));
          writer.releaseLock();
          return { success: true, bytesWritten: dataArray.length };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [portId, data],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 24: Gamepad API ====================

async function getGamepads(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const gamepads = navigator.getGamepads();
        return {
          gamepads: Array.from(gamepads)
            .filter((g) => g !== null)
            .map((g) => ({
              index: g.index,
              id: g.id,
              connected: g.connected,
              mapping: g.mapping,
              axes: g.axes.length,
              buttons: g.buttons.length,
              timestamp: g.timestamp,
            })),
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getGamepadState(tabId, index) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (idx) => {
        const gamepads = navigator.getGamepads();
        const gamepad = gamepads[idx];
        if (!gamepad) {
          return { error: "Gamepad not found" };
        }
        return {
          id: gamepad.id,
          connected: gamepad.connected,
          axes: Array.from(gamepad.axes),
          buttons: gamepad.buttons.map((b) => ({
            pressed: b.pressed,
            touched: b.touched,
            value: b.value,
          })),
          timestamp: gamepad.timestamp,
        };
      },
      args: [index],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function vibrateGamepad(tabId, index, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (idx, opts) => {
        const gamepads = navigator.getGamepads();
        const gamepad = gamepads[idx];
        if (!gamepad) {
          return { error: "Gamepad not found" };
        }
        if (!gamepad.vibrationActuator) {
          return { error: "Vibration not supported" };
        }
        try {
          await gamepad.vibrationActuator.playEffect(
            opts.type || "dual-rumble",
            {
              duration: opts.duration || 200,
              startDelay: opts.startDelay || 0,
              strongMagnitude: opts.strongMagnitude || 1.0,
              weakMagnitude: opts.weakMagnitude || 0.5,
            },
          );
          return { success: true };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [index, options],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function isGamepadSupported(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return { supported: !!navigator.getGamepads };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 24: Web MIDI API ====================

async function requestMIDIAccess(tabId, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (opts) => {
        if (!navigator.requestMIDIAccess) {
          return { error: "Web MIDI API not supported" };
        }
        try {
          const access = await navigator.requestMIDIAccess(opts);
          window.__midiAccess = access;
          return {
            sysexEnabled: access.sysexEnabled,
            inputs: access.inputs.size,
            outputs: access.outputs.size,
          };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [options],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getMIDIInputs(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!window.__midiAccess) {
          return { error: "MIDI access not requested" };
        }
        const inputs = [];
        for (const [id, input] of window.__midiAccess.inputs) {
          inputs.push({
            id,
            name: input.name,
            manufacturer: input.manufacturer,
            state: input.state,
            connection: input.connection,
          });
        }
        return { inputs };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getMIDIOutputs(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!window.__midiAccess) {
          return { error: "MIDI access not requested" };
        }
        const outputs = [];
        for (const [id, output] of window.__midiAccess.outputs) {
          outputs.push({
            id,
            name: output.name,
            manufacturer: output.manufacturer,
            state: output.state,
            connection: output.connection,
          });
        }
        return { outputs };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function sendMIDIMessage(tabId, outputId, data) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (outId, midiData) => {
        if (!window.__midiAccess) {
          return { error: "MIDI access not requested" };
        }
        const output = window.__midiAccess.outputs.get(outId);
        if (!output) {
          return { error: "Output not found" };
        }
        try {
          output.send(midiData);
          return { success: true };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [outputId, data],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function closeMIDIAccess(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!window.__midiAccess) {
          return { error: "MIDI access not requested" };
        }
        // Close all ports
        for (const input of window.__midiAccess.inputs.values()) {
          input.close();
        }
        for (const output of window.__midiAccess.outputs.values()) {
          output.close();
        }
        window.__midiAccess = null;
        return { success: true };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 24: Picture-in-Picture API ====================

async function requestPictureInPicture(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (sel) => {
        const video = document.querySelector(sel);
        if (!video || video.tagName !== "VIDEO") {
          return { error: "Video element not found" };
        }
        if (!document.pictureInPictureEnabled) {
          return { error: "Picture-in-Picture not enabled" };
        }
        try {
          const pipWindow = await video.requestPictureInPicture();
          return {
            success: true,
            width: pipWindow.width,
            height: pipWindow.height,
          };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [selector],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function exitPictureInPicture(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (!document.pictureInPictureElement) {
          return { error: "No element in Picture-in-Picture" };
        }
        try {
          await document.exitPictureInPicture();
          return { success: true };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getPictureInPictureWindow(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const element = document.pictureInPictureElement;
        if (!element) {
          return { active: false };
        }
        return {
          active: true,
          element: element.tagName,
          src: element.src || element.currentSrc,
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function isPictureInPictureEnabled(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return { enabled: document.pictureInPictureEnabled };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function isPictureInPictureSupported(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return {
          supported: "pictureInPictureEnabled" in document,
          enabled: document.pictureInPictureEnabled,
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 24: Document Picture-in-Picture API ====================

async function requestDocumentPictureInPicture(tabId, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (opts) => {
        if (!window.documentPictureInPicture) {
          return { error: "Document Picture-in-Picture not supported" };
        }
        try {
          const pipWindow = await documentPictureInPicture.requestWindow(opts);
          window.__documentPipWindow = pipWindow;
          return {
            success: true,
            width: pipWindow.innerWidth,
            height: pipWindow.innerHeight,
          };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [options],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getDocumentPictureInPictureWindow(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!window.documentPictureInPicture) {
          return { error: "Document Picture-in-Picture not supported" };
        }
        const pipWindow = documentPictureInPicture.window;
        if (!pipWindow) {
          return { active: false };
        }
        return {
          active: true,
          width: pipWindow.innerWidth,
          height: pipWindow.innerHeight,
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 24: Web Locks API ====================

async function requestLock(tabId, name, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (lockName, opts) => {
        if (!navigator.locks) {
          return { error: "Web Locks API not supported" };
        }
        try {
          // Create a lock and store the release function
          const lockPromise = new Promise((resolve) => {
            navigator.locks.request(
              lockName,
              { mode: opts.mode || "exclusive", ifAvailable: opts.ifAvailable },
              async (lock) => {
                if (!lock) {
                  resolve({ acquired: false, reason: "Lock not available" });
                  return;
                }
                if (!window.__locks) window.__locks = new Map();
                const releasePromise = new Promise((rel) => {
                  window.__locks.set(lockName, rel);
                });
                resolve({ acquired: true, name: lock.name, mode: lock.mode });
                await releasePromise;
              },
            );
          });
          return await lockPromise;
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [name, options],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function queryLocks(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (!navigator.locks) {
          return { error: "Web Locks API not supported" };
        }
        try {
          const state = await navigator.locks.query();
          return {
            held: state.held.map((l) => ({
              name: l.name,
              mode: l.mode,
              clientId: l.clientId,
            })),
            pending: state.pending.map((l) => ({
              name: l.name,
              mode: l.mode,
              clientId: l.clientId,
            })),
          };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function releaseLock(tabId, name) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (lockName) => {
        if (!window.__locks || !window.__locks.has(lockName)) {
          return { error: "Lock not found" };
        }
        const release = window.__locks.get(lockName);
        release();
        window.__locks.delete(lockName);
        return { success: true, released: lockName };
      },
      args: [name],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function isLocksSupported(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return { supported: !!navigator.locks };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 24: Badging API ====================

async function setBadge(tabId, contents) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (value) => {
        if (!navigator.setAppBadge) {
          return { error: "Badging API not supported" };
        }
        try {
          if (value === undefined || value === null) {
            await navigator.setAppBadge();
          } else {
            await navigator.setAppBadge(value);
          }
          return { success: true, badge: value };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [contents],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function clearBadge(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (!navigator.clearAppBadge) {
          return { error: "Badging API not supported" };
        }
        try {
          await navigator.clearAppBadge();
          return { success: true };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function isBadgeSupported(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return {
          supported: !!navigator.setAppBadge && !!navigator.clearAppBadge,
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 24: Local Font Access API ====================

async function queryLocalFonts(tabId, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (opts) => {
        if (!window.queryLocalFonts) {
          return { error: "Local Font Access API not supported" };
        }
        try {
          const fonts = await window.queryLocalFonts(opts);
          return {
            fonts: fonts.slice(0, 100).map((f) => ({
              family: f.family,
              fullName: f.fullName,
              postscriptName: f.postscriptName,
              style: f.style,
            })),
            total: fonts.length,
          };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [options],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getFontPostscriptNames(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (!window.queryLocalFonts) {
          return { error: "Local Font Access API not supported" };
        }
        try {
          const fonts = await window.queryLocalFonts();
          const names = [...new Set(fonts.map((f) => f.postscriptName))];
          return { names: names.slice(0, 200), total: names.length };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function isLocalFontsSupported(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return { supported: !!window.queryLocalFonts };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 24: Window Management API ====================

async function getScreenDetails(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (!window.getScreenDetails) {
          return { error: "Window Management API not supported" };
        }
        try {
          const details = await window.getScreenDetails();
          return {
            screens: details.screens.map((s) => ({
              label: s.label,
              left: s.left,
              top: s.top,
              width: s.width,
              height: s.height,
              availLeft: s.availLeft,
              availTop: s.availTop,
              availWidth: s.availWidth,
              availHeight: s.availHeight,
              devicePixelRatio: s.devicePixelRatio,
              isPrimary: s.isPrimary,
              isInternal: s.isInternal,
            })),
            currentScreen: details.currentScreen?.label,
          };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getCurrentScreen(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (!window.getScreenDetails) {
          // Fallback to basic screen info
          return {
            width: screen.width,
            height: screen.height,
            availWidth: screen.availWidth,
            availHeight: screen.availHeight,
            colorDepth: screen.colorDepth,
            pixelDepth: screen.pixelDepth,
          };
        }
        try {
          const details = await window.getScreenDetails();
          const current = details.currentScreen;
          return {
            label: current.label,
            width: current.width,
            height: current.height,
            availWidth: current.availWidth,
            availHeight: current.availHeight,
            devicePixelRatio: current.devicePixelRatio,
            isPrimary: current.isPrimary,
          };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function isMultiScreenEnvironment(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (!window.getScreenDetails) {
          return { multiScreen: false, reason: "API not supported" };
        }
        try {
          const details = await window.getScreenDetails();
          return {
            multiScreen: details.screens.length > 1,
            screenCount: details.screens.length,
          };
        } catch (e) {
          return { multiScreen: false, error: e.message };
        }
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function requestScreensPermission(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (!window.getScreenDetails) {
          return { error: "Window Management API not supported" };
        }
        try {
          // Requesting getScreenDetails implicitly requests permission
          await window.getScreenDetails();
          return { granted: true };
        } catch (e) {
          if (e.name === "NotAllowedError") {
            return { granted: false, reason: "Permission denied" };
          }
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getScreenById(tabId, screenId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (sId) => {
        if (!window.getScreenDetails) {
          return { error: "Window Management API not supported" };
        }
        try {
          const details = await window.getScreenDetails();
          const screen = details.screens.find((s) => s.label === sId);
          if (!screen) {
            return { error: "Screen not found" };
          }
          return {
            label: screen.label,
            left: screen.left,
            top: screen.top,
            width: screen.width,
            height: screen.height,
            isPrimary: screen.isPrimary,
            isInternal: screen.isInternal,
          };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [screenId],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 24: Compute Pressure API ====================

async function observeComputePressure(tabId, source = "cpu") {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (src) => {
        if (!window.PressureObserver) {
          return { error: "Compute Pressure API not supported" };
        }
        try {
          if (window.__pressureObserver) {
            window.__pressureObserver.disconnect();
          }
          window.__pressureRecords = [];
          const observer = new PressureObserver((records) => {
            window.__pressureRecords = records.map((r) => ({
              source: r.source,
              state: r.state,
              time: r.time,
            }));
          });
          await observer.observe(src);
          window.__pressureObserver = observer;
          return { success: true, observing: src };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [source],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function unobserveComputePressure(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!window.__pressureObserver) {
          return { error: "No active observer" };
        }
        window.__pressureObserver.disconnect();
        window.__pressureObserver = null;
        return { success: true };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getComputePressureState(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return {
          observing: !!window.__pressureObserver,
          records: window.__pressureRecords || [],
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function isComputePressureSupported(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return { supported: !!window.PressureObserver };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 25: Barcode Detection API ====================

async function detectBarcodes(tabId, imageSource) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (imgSrc) => {
        if (!window.BarcodeDetector) {
          return { error: "BarcodeDetector not supported" };
        }
        try {
          const detector = new BarcodeDetector();
          let source;
          if (typeof imgSrc === "string") {
            // Selector
            source = document.querySelector(imgSrc);
            if (!source) return { error: "Image element not found" };
          } else {
            return { error: "Invalid image source" };
          }
          const barcodes = await detector.detect(source);
          return {
            barcodes: barcodes.map((b) => ({
              rawValue: b.rawValue,
              format: b.format,
              boundingBox: b.boundingBox,
              cornerPoints: b.cornerPoints,
            })),
          };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [imageSource],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getSupportedBarcodeFormats(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (!window.BarcodeDetector) {
          return { error: "BarcodeDetector not supported" };
        }
        try {
          const formats = await BarcodeDetector.getSupportedFormats();
          return { formats };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function isBarcodeDetectorSupported(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return { supported: !!window.BarcodeDetector };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 25: Face Detection API ====================

async function detectFaces(tabId, imageSource) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (imgSrc) => {
        if (!window.FaceDetector) {
          return { error: "FaceDetector not supported" };
        }
        try {
          const detector = new FaceDetector();
          let source;
          if (typeof imgSrc === "string") {
            source = document.querySelector(imgSrc);
            if (!source) return { error: "Image element not found" };
          } else {
            return { error: "Invalid image source" };
          }
          const faces = await detector.detect(source);
          return {
            faces: faces.map((f) => ({
              boundingBox: f.boundingBox,
              landmarks: f.landmarks?.map((l) => ({
                type: l.type,
                locations: l.locations,
              })),
            })),
          };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [imageSource],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function isFaceDetectorSupported(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return { supported: !!window.FaceDetector };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 25: Text Detection API ====================

async function detectText(tabId, imageSource) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (imgSrc) => {
        if (!window.TextDetector) {
          return { error: "TextDetector not supported" };
        }
        try {
          const detector = new TextDetector();
          let source;
          if (typeof imgSrc === "string") {
            source = document.querySelector(imgSrc);
            if (!source) return { error: "Image element not found" };
          } else {
            return { error: "Invalid image source" };
          }
          const texts = await detector.detect(source);
          return {
            texts: texts.map((t) => ({
              rawValue: t.rawValue,
              boundingBox: t.boundingBox,
              cornerPoints: t.cornerPoints,
            })),
          };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [imageSource],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function isTextDetectorSupported(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return { supported: !!window.TextDetector };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 25: Web Codecs API - Video ====================

async function getVideoDecoderConfig(tabId, config) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (cfg) => {
        if (!window.VideoDecoder) {
          return { error: "VideoDecoder not supported" };
        }
        try {
          const support = await VideoDecoder.isConfigSupported(cfg);
          return {
            supported: support.supported,
            config: support.config,
          };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [config],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function isVideoConfigSupported(tabId, config) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (cfg) => {
        if (!window.VideoDecoder) {
          return { error: "VideoDecoder not supported" };
        }
        try {
          const support = await VideoDecoder.isConfigSupported(cfg);
          return { supported: support.supported };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [config],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getSupportedVideoCodecs(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const codecs = [
          "vp8",
          "vp09.00.10.08",
          "avc1.42001E",
          "avc1.4D001E",
          "avc1.64001E",
          "hev1.1.6.L93.B0",
          "av01.0.04M.08",
        ];
        return {
          videoDecoderSupported: !!window.VideoDecoder,
          videoEncoderSupported: !!window.VideoEncoder,
          commonCodecs: codecs,
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 25: Web Codecs API - Audio ====================

async function getAudioDecoderConfig(tabId, config) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (cfg) => {
        if (!window.AudioDecoder) {
          return { error: "AudioDecoder not supported" };
        }
        try {
          const support = await AudioDecoder.isConfigSupported(cfg);
          return {
            supported: support.supported,
            config: support.config,
          };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [config],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function isAudioConfigSupported(tabId, config) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (cfg) => {
        if (!window.AudioDecoder) {
          return { error: "AudioDecoder not supported" };
        }
        try {
          const support = await AudioDecoder.isConfigSupported(cfg);
          return { supported: support.supported };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [config],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getSupportedAudioCodecs(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const codecs = ["opus", "mp3", "aac", "flac", "vorbis", "pcm"];
        return {
          audioDecoderSupported: !!window.AudioDecoder,
          audioEncoderSupported: !!window.AudioEncoder,
          commonCodecs: codecs,
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 25: Media Session API ====================

async function setMediaSessionMetadata(tabId, metadata) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (meta) => {
        if (!navigator.mediaSession) {
          return { error: "Media Session API not supported" };
        }
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: meta.title,
            artist: meta.artist,
            album: meta.album,
            artwork: meta.artwork,
          });
          return { success: true };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [metadata],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function setMediaSessionPlaybackState(tabId, state) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (s) => {
        if (!navigator.mediaSession) {
          return { error: "Media Session API not supported" };
        }
        navigator.mediaSession.playbackState = s;
        return { success: true, state: s };
      },
      args: [state],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function setMediaSessionPositionState(tabId, state) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (s) => {
        if (!navigator.mediaSession) {
          return { error: "Media Session API not supported" };
        }
        try {
          navigator.mediaSession.setPositionState(s);
          return { success: true };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [state],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function setMediaSessionActionHandler(tabId, action, enabled) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (act, en) => {
        if (!navigator.mediaSession) {
          return { error: "Media Session API not supported" };
        }
        try {
          if (en) {
            navigator.mediaSession.setActionHandler(act, () => {
              // Store action event
              if (!window.__mediaSessionActions)
                window.__mediaSessionActions = [];
              window.__mediaSessionActions.push({
                action: act,
                timestamp: Date.now(),
              });
            });
          } else {
            navigator.mediaSession.setActionHandler(act, null);
          }
          return { success: true, action: act, enabled: en };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [action, enabled],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getMediaSessionMetadata(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!navigator.mediaSession) {
          return { error: "Media Session API not supported" };
        }
        const meta = navigator.mediaSession.metadata;
        return {
          metadata: meta
            ? {
                title: meta.title,
                artist: meta.artist,
                album: meta.album,
                artwork: meta.artwork,
              }
            : null,
          playbackState: navigator.mediaSession.playbackState,
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 25: Background Fetch API ====================

async function backgroundFetch(tabId, id, requests, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (fetchId, reqs, opts) => {
        if (!navigator.serviceWorker) {
          return { error: "Service Worker not supported" };
        }
        try {
          const registration = await navigator.serviceWorker.ready;
          if (!registration.backgroundFetch) {
            return { error: "Background Fetch not supported" };
          }
          const bgFetch = await registration.backgroundFetch.fetch(
            fetchId,
            reqs,
            opts,
          );
          return {
            id: bgFetch.id,
            uploadTotal: bgFetch.uploadTotal,
            uploaded: bgFetch.uploaded,
            downloadTotal: bgFetch.downloadTotal,
            downloaded: bgFetch.downloaded,
            result: bgFetch.result,
            failureReason: bgFetch.failureReason,
          };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [id, requests, options],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getBackgroundFetch(tabId, id) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (fetchId) => {
        if (!navigator.serviceWorker) {
          return { error: "Service Worker not supported" };
        }
        try {
          const registration = await navigator.serviceWorker.ready;
          if (!registration.backgroundFetch) {
            return { error: "Background Fetch not supported" };
          }
          const bgFetch = await registration.backgroundFetch.get(fetchId);
          if (!bgFetch) {
            return { fetch: null };
          }
          return {
            fetch: {
              id: bgFetch.id,
              uploadTotal: bgFetch.uploadTotal,
              uploaded: bgFetch.uploaded,
              downloadTotal: bgFetch.downloadTotal,
              downloaded: bgFetch.downloaded,
              result: bgFetch.result,
              failureReason: bgFetch.failureReason,
            },
          };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [id],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getBackgroundFetchIds(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (!navigator.serviceWorker) {
          return { error: "Service Worker not supported" };
        }
        try {
          const registration = await navigator.serviceWorker.ready;
          if (!registration.backgroundFetch) {
            return { error: "Background Fetch not supported" };
          }
          const ids = await registration.backgroundFetch.getIds();
          return { ids };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function abortBackgroundFetch(tabId, id) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (fetchId) => {
        if (!navigator.serviceWorker) {
          return { error: "Service Worker not supported" };
        }
        try {
          const registration = await navigator.serviceWorker.ready;
          if (!registration.backgroundFetch) {
            return { error: "Background Fetch not supported" };
          }
          const bgFetch = await registration.backgroundFetch.get(fetchId);
          if (!bgFetch) {
            return { error: "Fetch not found" };
          }
          const aborted = await bgFetch.abort();
          return { aborted };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [id],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function isBackgroundFetchSupported(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        if (!navigator.serviceWorker) {
          return { supported: false, reason: "No Service Worker" };
        }
        try {
          const registration = await navigator.serviceWorker.ready;
          return { supported: !!registration.backgroundFetch };
        } catch (e) {
          return { supported: false, error: e.message };
        }
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 25: Compression Streams API ====================

async function compressData(tabId, data, format = "gzip") {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (inputData, fmt) => {
        if (!window.CompressionStream) {
          return { error: "CompressionStream not supported" };
        }
        try {
          const stream = new CompressionStream(fmt);
          const writer = stream.writable.getWriter();
          const encoder = new TextEncoder();
          await writer.write(encoder.encode(inputData));
          await writer.close();

          const reader = stream.readable.getReader();
          const chunks = [];
          let done = false;
          while (!done) {
            const { value, done: d } = await reader.read();
            if (value) chunks.push(value);
            done = d;
          }

          const compressed = new Uint8Array(
            chunks.reduce((acc, chunk) => acc + chunk.length, 0),
          );
          let offset = 0;
          for (const chunk of chunks) {
            compressed.set(chunk, offset);
            offset += chunk.length;
          }

          return {
            compressed: Array.from(compressed),
            originalSize: inputData.length,
            compressedSize: compressed.length,
            ratio:
              ((compressed.length / inputData.length) * 100).toFixed(2) + "%",
          };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [data, format],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function decompressData(tabId, data, format = "gzip") {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (compressedData, fmt) => {
        if (!window.DecompressionStream) {
          return { error: "DecompressionStream not supported" };
        }
        try {
          const stream = new DecompressionStream(fmt);
          const writer = stream.writable.getWriter();
          await writer.write(new Uint8Array(compressedData));
          await writer.close();

          const reader = stream.readable.getReader();
          const chunks = [];
          let done = false;
          while (!done) {
            const { value, done: d } = await reader.read();
            if (value) chunks.push(value);
            done = d;
          }

          const decoder = new TextDecoder();
          const decompressed = chunks.map((c) => decoder.decode(c)).join("");
          return { decompressed };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [data, format],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getSupportedCompressionFormats(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return {
          compressionSupported: !!window.CompressionStream,
          decompressionSupported: !!window.DecompressionStream,
          formats: ["gzip", "deflate", "deflate-raw"],
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function isCompressionSupported(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return {
          supported: !!window.CompressionStream && !!window.DecompressionStream,
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 25: Navigation API ====================

async function navigationNavigate(tabId, url, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (navUrl, opts) => {
        if (!window.navigation) {
          return { error: "Navigation API not supported" };
        }
        try {
          const result = await navigation.navigate(navUrl, opts);
          return {
            committed: await result.committed
              .then(() => true)
              .catch(() => false),
            finished: await result.finished.then(() => true).catch(() => false),
          };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [url, options],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function navigationReload(tabId, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (opts) => {
        if (!window.navigation) {
          return { error: "Navigation API not supported" };
        }
        try {
          const result = await navigation.reload(opts);
          return { success: true };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [options],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function navigationTraverseTo(tabId, key) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (navKey) => {
        if (!window.navigation) {
          return { error: "Navigation API not supported" };
        }
        try {
          const result = await navigation.traverseTo(navKey);
          return { success: true };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [key],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getNavigationEntries(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!window.navigation) {
          return { error: "Navigation API not supported" };
        }
        const entries = navigation.entries();
        return {
          entries: entries.map((e) => ({
            key: e.key,
            id: e.id,
            url: e.url,
            index: e.index,
            sameDocument: e.sameDocument,
          })),
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getCurrentNavigationEntry(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!window.navigation) {
          return { error: "Navigation API not supported" };
        }
        const entry = navigation.currentEntry;
        return {
          entry: entry
            ? {
                key: entry.key,
                id: entry.id,
                url: entry.url,
                index: entry.index,
                sameDocument: entry.sameDocument,
              }
            : null,
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function canNavigationGoBack(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!window.navigation) {
          return { error: "Navigation API not supported" };
        }
        return { canGoBack: navigation.canGoBack };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function canNavigationGoForward(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!window.navigation) {
          return { error: "Navigation API not supported" };
        }
        return { canGoForward: navigation.canGoForward };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 25: View Transitions API ====================

async function startViewTransition(tabId, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (opts) => {
        if (!document.startViewTransition) {
          return { error: "View Transitions API not supported" };
        }
        try {
          const transition = document.startViewTransition(() => {
            // Callback for DOM update
            if (opts.selector && opts.newContent) {
              const el = document.querySelector(opts.selector);
              if (el) {
                // Use setHTML (Sanitizer API) if available, otherwise textContent for safety
                if (el.setHTML && typeof Sanitizer !== "undefined") {
                  el.setHTML(opts.newContent, { sanitizer: new Sanitizer() });
                } else {
                  el.textContent = opts.newContent;
                }
              }
            }
          });
          window.__currentViewTransition = transition;
          await transition.ready;
          return { started: true };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [options],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getViewTransitionState(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!window.__currentViewTransition) {
          return { active: false };
        }
        return { active: true };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function skipViewTransition(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!window.__currentViewTransition) {
          return { error: "No active view transition" };
        }
        window.__currentViewTransition.skipTransition();
        return { success: true };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function isViewTransitionSupported(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return { supported: !!document.startViewTransition };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 25: Sanitizer API ====================

async function sanitizeHTML(tabId, input, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (html, opts) => {
        if (!window.Sanitizer) {
          // Fallback to basic sanitization
          const div = document.createElement("div");
          div.textContent = html;
          return { sanitized: div.innerHTML, fallback: true };
        }
        try {
          const sanitizer = new Sanitizer(opts);
          const fragment = sanitizer.sanitizeFor("div", html);
          return { sanitized: fragment.innerHTML };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [input, options],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getSanitizerDefaultConfig(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!window.Sanitizer) {
          return { error: "Sanitizer API not supported" };
        }
        try {
          const sanitizer = new Sanitizer();
          return {
            defaultConfig:
              sanitizer.getConfiguration?.() || "Configuration not accessible",
          };
        } catch (e) {
          return { error: e.message };
        }
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function isSanitizerSupported(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return { supported: !!window.Sanitizer };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 25: Popover API ====================

async function showPopover(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const element = document.querySelector(sel);
        if (!element) {
          return { error: "Element not found" };
        }
        if (!element.showPopover) {
          return { error: "Popover API not supported on this element" };
        }
        try {
          element.showPopover();
          return { success: true };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [selector],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function hidePopover(tabId, selector) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const element = document.querySelector(sel);
        if (!element) {
          return { error: "Element not found" };
        }
        if (!element.hidePopover) {
          return { error: "Popover API not supported on this element" };
        }
        try {
          element.hidePopover();
          return { success: true };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [selector],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function togglePopover(tabId, selector, force) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel, f) => {
        const element = document.querySelector(sel);
        if (!element) {
          return { error: "Element not found" };
        }
        if (!element.togglePopover) {
          return { error: "Popover API not supported on this element" };
        }
        try {
          const result = element.togglePopover(f);
          return { success: true, showing: result };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [selector, force],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function isPopoverSupported(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return { supported: "popover" in HTMLElement.prototype };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 25: Highlight API ====================

async function createHighlight(tabId, ranges, name) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (rangeData, highlightName) => {
        if (!window.Highlight || !CSS.highlights) {
          return { error: "CSS Custom Highlight API not supported" };
        }
        try {
          const rangeObjects = rangeData.map((r) => {
            const range = new Range();
            const startNode = document.querySelector(r.startSelector);
            const endNode = document.querySelector(r.endSelector);
            if (!startNode || !endNode) {
              throw new Error("Range nodes not found");
            }
            range.setStart(startNode, r.startOffset || 0);
            range.setEnd(endNode, r.endOffset || endNode.textContent.length);
            return range;
          });
          const highlight = new Highlight(...rangeObjects);
          CSS.highlights.set(highlightName, highlight);
          return { success: true, name: highlightName };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [ranges, name],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function deleteHighlight(tabId, name) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (highlightName) => {
        if (!CSS.highlights) {
          return { error: "CSS Custom Highlight API not supported" };
        }
        const deleted = CSS.highlights.delete(highlightName);
        return { success: deleted, name: highlightName };
      },
      args: [name],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getAllHighlights(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!CSS.highlights) {
          return { error: "CSS Custom Highlight API not supported" };
        }
        const highlights = [];
        for (const [name] of CSS.highlights) {
          highlights.push(name);
        }
        return { highlights };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function clearAllHighlights(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!CSS.highlights) {
          return { error: "CSS Custom Highlight API not supported" };
        }
        CSS.highlights.clear();
        return { success: true };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 25: EditContext API ====================

async function createEditContext(tabId, selector, options = {}) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel, opts) => {
        if (!window.EditContext) {
          return { error: "EditContext API not supported" };
        }
        try {
          const element = document.querySelector(sel);
          if (!element) {
            return { error: "Element not found" };
          }
          const editContext = new EditContext(opts);
          element.editContext = editContext;
          window.__editContext = editContext;
          return { success: true };
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [selector, options],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function updateEditContextText(tabId, text, start, end) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: (txt, s, e) => {
        if (!window.__editContext) {
          return { error: "No active EditContext" };
        }
        try {
          window.__editContext.updateText(s, e, txt);
          return { success: true };
        } catch (err) {
          return { error: err.message };
        }
      },
      args: [text, start, end],
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function getEditContextState(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (!window.__editContext) {
          return { active: false };
        }
        return {
          active: true,
          text: window.__editContext.text,
          selectionStart: window.__editContext.selectionStart,
          selectionEnd: window.__editContext.selectionEnd,
        };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

async function isEditContextSupported(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return { supported: !!window.EditContext };
      },
    });
    return result[0]?.result || {};
  } catch (error) {
    return { error: error.message };
  }
}

// ==================== Phase 26: Reader Mode & Article Extraction ====================

/**
 * Extract article content from the page using Readability-like algorithm
 */
async function extractArticle(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "extractArticle",
    });
    return response;
  } catch (error) {
    // Fallback: use scripting API
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Simple article extraction fallback
        const article =
          document.querySelector("article") ||
          document.querySelector('[role="main"]') ||
          document.querySelector("main") ||
          document.body;

        const title =
          document.querySelector("h1")?.textContent || document.title;

        const content = article ? article.innerText : document.body.innerText;

        return {
          success: true,
          article: {
            title: title.trim(),
            content: content.substring(0, 50000), // Limit content size
            textContent: content.substring(0, 50000),
            length: content.length,
            siteName: window.location.hostname,
            url: window.location.href,
          },
        };
      },
    });
    return results[0]?.result || { error: "Failed to extract article" };
  }
}

/**
 * Get readable content with formatting options
 */
async function getReadableContent(tabId, options = {}) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "getReadableContent",
      options,
    });
    return response;
  } catch (error) {
    // Fallback: extract basic content
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (opts) => {
        const article =
          document.querySelector("article") ||
          document.querySelector('[role="main"]') ||
          document.querySelector("main");

        if (!article) {
          return { error: "No readable content found" };
        }

        // Clean up the content
        const clone = article.cloneNode(true);

        // Remove unwanted elements
        const removeSelectors = [
          "script",
          "style",
          "nav",
          "aside",
          "footer",
          "header",
          ".ad",
          ".advertisement",
          ".social-share",
          ".comments",
        ];
        removeSelectors.forEach((sel) => {
          clone.querySelectorAll(sel).forEach((el) => el.remove());
        });

        const includeImages = opts?.includeImages !== false;
        const images = [];

        if (includeImages) {
          clone.querySelectorAll("img").forEach((img) => {
            if (img.src && img.naturalWidth > 100) {
              images.push({
                src: img.src,
                alt: img.alt,
                width: img.naturalWidth,
                height: img.naturalHeight,
              });
            }
          });
        }

        return {
          success: true,
          content: {
            html: clone.innerHTML,
            text: clone.innerText,
            images,
            wordCount: clone.innerText.split(/\s+/).length,
          },
        };
      },
      args: [options],
    });
    return results[0]?.result || { error: "Failed to get readable content" };
  }
}

/**
 * Extract article metadata (author, date, description, etc.)
 */
async function extractArticleMetadata(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "extractMetadata",
    });
    return response;
  } catch (error) {
    // Fallback: extract basic metadata
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const getMeta = (name) => {
          const meta =
            document.querySelector(`meta[name="${name}"]`) ||
            document.querySelector(`meta[property="${name}"]`) ||
            document.querySelector(`meta[property="og:${name}"]`);
          return meta?.content || null;
        };

        return {
          success: true,
          metadata: {
            title: document.title,
            description: getMeta("description"),
            author: getMeta("author"),
            publishedTime:
              getMeta("article:published_time") || getMeta("datePublished"),
            modifiedTime:
              getMeta("article:modified_time") || getMeta("dateModified"),
            siteName: getMeta("og:site_name") || window.location.hostname,
            url: window.location.href,
            image: getMeta("og:image"),
            type: getMeta("og:type"),
            keywords: getMeta("keywords"),
            language: document.documentElement.lang,
          },
        };
      },
    });
    return results[0]?.result || { error: "Failed to extract metadata" };
  }
}

// ==================== Phase 27: Web Annotation ====================

/**
 * Highlight the current text selection
 */
async function highlightSelection(tabId, options = {}) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "highlightSelection",
      options,
    });
    return response;
  } catch (error) {
    // Fallback: use scripting API
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (opts) => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
          return { error: "No text selected" };
        }

        const range = selection.getRangeAt(0);
        const highlight = document.createElement("mark");
        highlight.style.backgroundColor = opts?.color || "#ffff00";
        highlight.style.padding = "2px";
        highlight.dataset.annotationId = `ann-${Date.now()}`;

        try {
          range.surroundContents(highlight);
          selection.removeAllRanges();
          return {
            success: true,
            annotationId: highlight.dataset.annotationId,
            text: highlight.textContent,
          };
        } catch (e) {
          return { error: "Cannot highlight across element boundaries" };
        }
      },
      args: [options],
    });
    return results[0]?.result || { error: "Failed to highlight selection" };
  }
}

/**
 * Add an annotation to the page
 */
async function addAnnotation(tabId, annotation) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "addAnnotation",
      annotation,
    });
    return response;
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Get all annotations on the page
 */
async function getAnnotations(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "getAnnotations",
    });
    return response;
  } catch (error) {
    // Fallback: get annotations from DOM
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const marks = document.querySelectorAll("mark[data-annotation-id]");
        const annotations = [];
        marks.forEach((mark) => {
          annotations.push({
            id: mark.dataset.annotationId,
            text: mark.textContent,
            color: mark.style.backgroundColor,
            note: mark.dataset.note || null,
          });
        });
        return { success: true, annotations };
      },
    });
    return results[0]?.result || { annotations: [] };
  }
}

/**
 * Remove a specific annotation
 */
async function removeAnnotation(tabId, annotationId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "removeAnnotation",
      annotationId,
    });
    return response;
  } catch (error) {
    // Fallback: remove from DOM directly
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (annId) => {
        const mark = document.querySelector(
          `mark[data-annotation-id="${annId}"]`,
        );
        if (!mark) {
          return { error: "Annotation not found" };
        }
        const parent = mark.parentNode;
        while (mark.firstChild) {
          parent.insertBefore(mark.firstChild, mark);
        }
        parent.removeChild(mark);
        return { success: true };
      },
      args: [annotationId],
    });
    return results[0]?.result || { error: "Failed to remove annotation" };
  }
}

/**
 * Clear all annotations on the page
 */
async function clearAnnotations(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "clearAnnotations",
    });
    return response;
  } catch (error) {
    // Fallback: clear from DOM directly
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const marks = document.querySelectorAll("mark[data-annotation-id]");
        let removed = 0;
        marks.forEach((mark) => {
          const parent = mark.parentNode;
          while (mark.firstChild) {
            parent.insertBefore(mark.firstChild, mark);
          }
          parent.removeChild(mark);
          removed++;
        });
        return { success: true, removed };
      },
    });
    return results[0]?.result || { error: "Failed to clear annotations" };
  }
}

/**
 * Export all annotations in specified format (json, markdown, html)
 */
async function exportAnnotations(tabId, format = "json") {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "exportAnnotations",
      format,
    });
    return response;
  } catch (error) {
    // Fallback: export basic format
    const annotations = await getAnnotations(tabId);
    if (annotations.error) {
      return annotations;
    }

    const pageTitle =
      (
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () => document.title,
        })
      )[0]?.result || "Untitled";

    const pageUrl =
      (
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () => window.location.href,
        })
      )[0]?.result || "";

    if (format === "markdown") {
      let md = `# Annotations: ${pageTitle}\n\n`;
      md += `Source: ${pageUrl}\n\n`;
      md += `Exported: ${new Date().toISOString()}\n\n---\n\n`;
      annotations.annotations.forEach((ann, i) => {
        md += `## ${i + 1}. Highlight\n\n`;
        md += `> ${ann.text}\n\n`;
        if (ann.note) {
          md += `**Note:** ${ann.note}\n\n`;
        }
      });
      return { success: true, format: "markdown", content: md };
    } else if (format === "html") {
      let html = `<!DOCTYPE html>
<html><head><title>Annotations: ${pageTitle}</title>
<style>
body { font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
.highlight { background: #ffff00; padding: 2px 4px; }
.note { color: #666; font-style: italic; }
</style></head><body>
<h1>Annotations: ${pageTitle}</h1>
<p>Source: <a href="${pageUrl}">${pageUrl}</a></p>
<hr>`;
      annotations.annotations.forEach((ann) => {
        html += `<div class="annotation">
<p><span class="highlight">${ann.text}</span></p>
${ann.note ? `<p class="note">${ann.note}</p>` : ""}
</div>`;
      });
      html += "</body></html>";
      return { success: true, format: "html", content: html };
    }

    // Default: JSON
    return {
      success: true,
      format: "json",
      content: JSON.stringify(
        {
          title: pageTitle,
          url: pageUrl,
          exportedAt: new Date().toISOString(),
          annotations: annotations.annotations,
        },
        null,
        2,
      ),
    };
  }
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
