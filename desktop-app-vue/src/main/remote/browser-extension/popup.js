/**
 * ChainlessChain Browser Bridge - Popup Script
 */

/* eslint-disable no-undef */
/* global chrome */

// DOM Elements
const statusText = document.getElementById("statusText");
const statusDot = document.getElementById("statusDot");
const commandCount = document.getElementById("commandCount");
const uptime = document.getElementById("uptime");
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const tabsSection = document.getElementById("tabsSection");
const tabsCount = document.getElementById("tabsCount");
const tabList = document.getElementById("tabList");
const version = document.getElementById("version");

// State
let _isConnected = false;

/**
 * Initialize popup
 */
async function init() {
  // Set version
  version.textContent = `v${chrome.runtime.getManifest().version}`;

  // Get initial status
  await updateStatus();

  // Load tabs
  await loadTabs();

  // Setup event listeners
  connectBtn.addEventListener("click", handleConnect);
  disconnectBtn.addEventListener("click", handleDisconnect);

  // Listen for status updates
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "connectionStatus") {
      updateUI(message.connected);
    }
  });

  // Refresh status periodically
  setInterval(updateStatus, 2000);
}

/**
 * Update status from background
 */
async function updateStatus() {
  try {
    const status = await chrome.runtime.sendMessage({ type: "getStatus" });
    updateUI(status.connected, status.stats);
  } catch (error) {
    console.error("Failed to get status:", error);
    updateUI(false);
  }
}

/**
 * Update UI based on connection state
 */
function updateUI(connected, stats = {}) {
  _isConnected = connected;

  if (connected) {
    statusText.textContent = "Connected";
    statusDot.className = "status-dot connected";
    connectBtn.classList.add("hidden");
    disconnectBtn.classList.remove("hidden");
    tabsSection.classList.remove("hidden");
  } else {
    statusText.textContent = "Disconnected";
    statusDot.className = "status-dot disconnected";
    connectBtn.classList.remove("hidden");
    disconnectBtn.classList.add("hidden");
  }

  // Update stats
  if (stats.commandsExecuted !== undefined) {
    commandCount.textContent = stats.commandsExecuted;
  }

  if (stats.uptime !== undefined && stats.uptime > 0) {
    uptime.textContent = formatUptime(stats.uptime);
  } else {
    uptime.textContent = "-";
  }
}

/**
 * Format uptime
 */
function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Load open tabs
 */
async function loadTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    tabsCount.textContent = `${tabs.length} tabs`;

    // Clear existing content safely
    while (tabList.firstChild) {
      tabList.removeChild(tabList.firstChild);
    }
    tabs.slice(0, 10).forEach((tab) => {
      const item = document.createElement("div");
      item.className = "tab-item";
      // Use textContent instead of innerHTML for XSS prevention
      const titleDiv = document.createElement("div");
      titleDiv.className = "tab-title";
      titleDiv.textContent = tab.title || "Untitled";
      const urlDiv = document.createElement("div");
      urlDiv.className = "tab-url";
      urlDiv.textContent = truncateUrl(tab.url);
      item.appendChild(titleDiv);
      item.appendChild(urlDiv);
      item.addEventListener("click", () => {
        chrome.tabs.update(tab.id, { active: true });
        chrome.windows.update(tab.windowId, { focused: true });
      });
      tabList.appendChild(item);
    });

    if (tabs.length > 10) {
      const more = document.createElement("div");
      more.className = "tab-item";
      more.style.textAlign = "center";
      more.style.opacity = "0.6";
      more.textContent = `... and ${tabs.length - 10} more`;
      tabList.appendChild(more);
    }
  } catch (error) {
    console.error("Failed to load tabs:", error);
  }
}

/**
 * Handle connect button
 */
async function handleConnect() {
  connectBtn.disabled = true;
  connectBtn.textContent = "Connecting...";

  try {
    await chrome.runtime.sendMessage({ type: "connect" });
    // Wait a bit for connection
    setTimeout(updateStatus, 1000);
  } catch (error) {
    console.error("Connect failed:", error);
  } finally {
    connectBtn.disabled = false;
    connectBtn.textContent = "Connect";
  }
}

/**
 * Handle disconnect button
 */
async function handleDisconnect() {
  try {
    await chrome.runtime.sendMessage({ type: "disconnect" });
    updateUI(false);
  } catch (error) {
    console.error("Disconnect failed:", error);
  }
}

/**
 * Truncate URL
 */
function truncateUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    return (
      u.hostname +
      (u.pathname.length > 20 ? u.pathname.slice(0, 20) + "..." : u.pathname)
    );
  } catch {
    return url.slice(0, 40);
  }
}

// Initialize on load
document.addEventListener("DOMContentLoaded", init);
