/**
 * ChainlessChain Web Clipper - Background Script
 * Service worker for handling API communication
 */

import { detectBrowser } from '../common/utils.js';
import apiClient from '../common/api-client.js';

console.log('[Background] ChainlessChain Web Clipper started');

const NATIVE_HOST_NAME = 'com.chainlesschain.clipper';
const browser = detectBrowser();

// Connection state
let isConnected = false;
let nativePort = null;

/**
 * Connect to Native Messaging Host (Chrome/Firefox only)
 */
function connectToNativeHost() {
  // Safari doesn't support Native Messaging
  if (browser === 'safari') {
    console.log('[Background] Safari detected, using direct HTTP API');
    isConnected = true; // Assume connected
    return;
  }

  try {
    console.log('[Background] Connecting to Native Host:', NATIVE_HOST_NAME);

    // Use appropriate API
    const chromeAPI = typeof chrome !== 'undefined' ? chrome : browser;
    nativePort = chromeAPI.runtime.connectNative(NATIVE_HOST_NAME);

    nativePort.onMessage.addListener((message) => {
      console.log('[Background] Message from Native Host:', message);
      handleNativeMessage(message);
    });

    nativePort.onDisconnect.addListener(() => {
      console.log('[Background] Native Host disconnected');
      isConnected = false;
      nativePort = null;

      const lastError = chromeAPI.runtime.lastError;
      if (lastError) {
        console.error('[Background] Disconnect error:', lastError.message);
      }
    });

    isConnected = true;
    console.log('[Background] Connected to Native Host');
  } catch (error) {
    console.error('[Background] Connection failed:', error);
    isConnected = false;
    nativePort = null;
  }
}

/**
 * Handle message from Native Host
 */
function handleNativeMessage(message) {
  // Handle different message types
  if (message.type === 'ping') {
    console.log('[Background] Ping received');
  }

  if (message.type === 'clipResult') {
    console.log('[Background] Clip result:', message.data);
  }
}

/**
 * Send message via Native Host or HTTP API
 */
async function sendToDesktopApp(message) {
  // For Safari or if Native Host not connected, use HTTP API directly
  if (browser === 'safari' || !isConnected || !nativePort) {
    console.log('[Background] Using direct HTTP API');
    return handleDirectAPI(message);
  }

  // Use Native Messaging
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Request timeout'));
    }, 10000);

    try {
      nativePort.postMessage(message);

      // Listen for response (simplified - in production, use message IDs)
      const listener = (response) => {
        clearTimeout(timeout);
        nativePort.onMessage.removeListener(listener);

        if (response.success) {
          resolve(response);
        } else {
          reject(new Error(response.error || 'Operation failed'));
        }
      };

      nativePort.onMessage.addListener(listener);
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}

/**
 * Handle message directly via HTTP API
 */
async function handleDirectAPI(message) {
  const { action, data } = message;

  switch (action) {
    case 'ping':
      return apiClient.ping();

    case 'clipPage':
      return apiClient.clipPage(data);

    case 'generateTags':
      return apiClient.generateTags(data);

    case 'generateSummary':
      return apiClient.generateSummary(data);

    case 'uploadScreenshot':
      return apiClient.uploadScreenshot(data);

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

/**
 * Check connection to desktop app
 */
async function checkConnection() {
  try {
    const connected = await apiClient.ping();
    return { success: connected };
  } catch (error) {
    console.error('[Background] Connection check failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Clip page to knowledge base
 */
async function clipPage(data) {
  try {
    console.log('[Background] Clipping page:', data.title);

    const result = await handleDirectAPI({
      action: 'clipPage',
      data: data,
    });

    console.log('[Background] Clip result:', result);
    return result;
  } catch (error) {
    console.error('[Background] Clip failed:', error);
    throw error;
  }
}

/**
 * Generate AI tags
 */
async function generateAITags(data) {
  try {
    console.log('[Background] Generating AI tags');

    const result = await handleDirectAPI({
      action: 'generateTags',
      data: data,
    });

    return result;
  } catch (error) {
    console.error('[Background] Tag generation failed:', error);
    throw error;
  }
}

/**
 * Generate AI summary
 */
async function generateAISummary(data) {
  try {
    console.log('[Background] Generating AI summary');

    const result = await handleDirectAPI({
      action: 'generateSummary',
      data: data,
    });

    return result;
  } catch (error) {
    console.error('[Background] Summary generation failed:', error);
    throw error;
  }
}

/**
 * Save screenshot
 */
async function saveScreenshot(data) {
  try {
    console.log('[Background] Saving screenshot');

    const result = await handleDirectAPI({
      action: 'uploadScreenshot',
      data: data,
    });

    console.log('[Background] Screenshot saved:', result);
    return result;
  } catch (error) {
    console.error('[Background] Screenshot save failed:', error);
    throw error;
  }
}

/**
 * Message listener
 */
const chromeAPI = typeof chrome !== 'undefined' ? chrome : browser;

chromeAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Background] Message received:', request.action);

  // Check connection
  if (request.action === 'checkConnection') {
    checkConnection()
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Clip page
  if (request.action === 'clipPage') {
    clipPage(request.data)
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Generate AI tags
  if (request.action === 'generateTags') {
    generateAITags(request.data)
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Generate AI summary
  if (request.action === 'generateSummary') {
    generateAISummary(request.data)
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Save screenshot
  if (request.action === 'saveScreenshot') {
    saveScreenshot(request.data)
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  return false;
});

/**
 * Extension installed/updated
 */
chromeAPI.runtime.onInstalled.addListener((details) => {
  console.log('[Background] Extension installed/updated:', details.reason);

  if (details.reason === 'install') {
    console.log('[Background] First install');
  }

  if (details.reason === 'update') {
    console.log('[Background] Updated to version:', chromeAPI.runtime.getManifest().version);
  }

  // Try to connect
  connectToNativeHost();
});

/**
 * Extension startup
 */
chromeAPI.runtime.onStartup.addListener(() => {
  console.log('[Background] Extension started');
  connectToNativeHost();
});

// Initialize
connectToNativeHost();
