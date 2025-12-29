/**
 * ChainlessChain Web Clipper - Popup Script
 * Main UI logic for the extension popup
 */

import { getBrowserAdapter } from '../common/utils.js';
import { suggestTags, formatDate } from '../common/utils.js';

// Global state
let browserAdapter = null;
let currentPage = {
  url: '',
  title: '',
  content: '',
  excerpt: '',
  author: '',
  date: '',
  domain: '',
};

// DOM elements
const elements = {};

/**
 * Initialize the popup
 */
async function initialize() {
  console.log('[Popup] Initializing...');

  // Get browser adapter
  browserAdapter = await getBrowserAdapter();

  // Get DOM elements
  initializeElements();

  // Check connection
  const connected = await checkConnection();

  if (connected) {
    showContent();
    await loadPageInfo();
  } else {
    showDisconnected();
  }

  // Bind events
  bindEvents();
}

/**
 * Initialize DOM element references
 */
function initializeElements() {
  elements.status = document.getElementById('status');
  elements.statusText = document.getElementById('statusText');
  elements.content = document.getElementById('content');
  elements.disconnectedMessage = document.getElementById('disconnectedMessage');
  elements.errorMessage = document.getElementById('errorMessage');
  elements.successMessage = document.getElementById('successMessage');
  elements.clipForm = document.getElementById('clipForm');
  elements.titleInput = document.getElementById('title');
  elements.typeSelect = document.getElementById('type');
  elements.tagsInput = document.getElementById('tags');
  elements.readabilityCheckbox = document.getElementById('readability');
  elements.autoIndexCheckbox = document.getElementById('autoIndex');
  elements.clipBtn = document.getElementById('clipBtn');
  elements.btnText = document.querySelector('.btn-text');
  elements.btnLoading = document.querySelector('.btn-loading');
  elements.previewTitle = document.getElementById('previewTitle');
  elements.previewDomain = document.getElementById('previewDomain');
  elements.previewDate = document.getElementById('previewDate');
  elements.reconnectBtn = document.getElementById('reconnectBtn');
  elements.retryBtn = document.getElementById('retryBtn');
}

/**
 * Check connection to desktop app
 */
async function checkConnection() {
  try {
    updateStatus('checking', '检查连接...');

    const response = await browserAdapter.runtime.sendMessage({
      action: 'checkConnection',
    });

    if (response && response.success) {
      updateStatus('connected', '已连接');
      return true;
    } else {
      updateStatus('error', '连接失败');
      return false;
    }
  } catch (error) {
    console.error('[Popup] Connection check failed:', error);
    updateStatus('error', '连接失败');
    return false;
  }
}

/**
 * Update status display
 */
function updateStatus(status, text) {
  elements.statusText.textContent = text;
  elements.status.className = 'status ' + status;
}

/**
 * Show main content
 */
function showContent() {
  elements.content.style.display = 'block';
  elements.disconnectedMessage.style.display = 'none';
  elements.errorMessage.style.display = 'none';
  elements.successMessage.style.display = 'none';
}

/**
 * Show disconnected message
 */
function showDisconnected() {
  elements.content.style.display = 'none';
  elements.disconnectedMessage.style.display = 'block';
}

/**
 * Show success message
 */
function showSuccess() {
  elements.content.style.display = 'none';
  elements.successMessage.style.display = 'block';
}

/**
 * Load current page information
 */
async function loadPageInfo() {
  try {
    // Get current tab
    const [tab] = await browserAdapter.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      console.error('[Popup] No active tab');
      return;
    }

    // Get page info from content script
    const response = await browserAdapter.tabs.sendMessage(tab.id, {
      action: 'getPageInfo',
    });

    if (response && response.success) {
      currentPage = response.data;

      // Update UI
      elements.previewTitle.textContent = currentPage.title || '无标题';
      elements.previewDomain.textContent = currentPage.domain || '';
      elements.previewDate.textContent = formatDate(currentPage.date);

      // Fill form
      elements.titleInput.value = currentPage.title || '';

      // Auto-suggest tags
      const suggested = suggestTags(currentPage);
      if (suggested.length > 0) {
        elements.tagsInput.value = suggested.join(', ');
      }
    }
  } catch (error) {
    console.error('[Popup] Load page info failed:', error);
  }
}

/**
 * Bind event listeners
 */
function bindEvents() {
  // Clip form submit
  elements.clipForm.addEventListener('submit', handleClip);

  // Reconnect button
  if (elements.reconnectBtn) {
    elements.reconnectBtn.addEventListener('click', async () => {
      const connected = await checkConnection();
      if (connected) {
        showContent();
        await loadPageInfo();
      }
    });
  }

  // Retry button
  if (elements.retryBtn) {
    elements.retryBtn.addEventListener('click', () => {
      showContent();
    });
  }
}

/**
 * Handle clip form submission
 */
async function handleClip(event) {
  event.preventDefault();

  // Disable button
  elements.clipBtn.disabled = true;
  elements.btnText.style.display = 'none';
  elements.btnLoading.style.display = 'flex';

  try {
    // Collect form data
    const formData = {
      title: elements.titleInput.value.trim(),
      type: elements.typeSelect.value,
      tags: elements.tagsInput.value
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0),
      useReadability: elements.readabilityCheckbox.checked,
      autoIndex: elements.autoIndexCheckbox.checked,
      url: currentPage.url,
      content: currentPage.content,
      excerpt: currentPage.excerpt,
      author: currentPage.author,
      date: currentPage.date,
      domain: currentPage.domain,
    };

    // Validate
    if (!formData.title) {
      throw new Error('请输入标题');
    }

    if (!formData.content) {
      throw new Error('无法提取页面内容');
    }

    // Send to background script
    const response = await browserAdapter.runtime.sendMessage({
      action: 'clipPage',
      data: formData,
    });

    if (response && response.success) {
      console.log('[Popup] Clip success:', response.data);
      showSuccess();
    } else {
      throw new Error(response?.error || '剪藏失败');
    }
  } catch (error) {
    console.error('[Popup] Clip failed:', error);
    alert('剪藏失败: ' + error.message);
  } finally {
    // Restore button
    elements.clipBtn.disabled = false;
    elements.btnText.style.display = 'inline';
    elements.btnLoading.style.display = 'none';
  }
}

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', initialize);
