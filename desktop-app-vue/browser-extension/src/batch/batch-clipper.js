/**
 * ChainlessChain Web Clipper - Batch Clipper
 * Batch clipping multiple tabs at once
 */

import { getBrowserAdapter } from '../common/utils.js';

// Global state
let browserAdapter = null;
let allTabs = [];
let filteredTabs = [];
let selectedTabIds = new Set();
let isProcessing = false;
let shouldStop = false;

// Statistics
let stats = {
  total: 0,
  processed: 0,
  succeeded: 0,
  failed: 0,
  errors: [],
};

// DOM elements
const elements = {};

/**
 * Initialize the batch clipper
 */
async function initialize() {
  console.log('[BatchClipper] Initializing...');

  // Get browser adapter
  browserAdapter = await getBrowserAdapter();

  // Get DOM elements
  initializeElements();

  // Load tabs
  await loadTabs();

  // Bind events
  bindEvents();
}

/**
 * Initialize DOM element references
 */
function initializeElements() {
  elements.tabList = document.getElementById('tabList');
  elements.selectedCount = document.getElementById('selectedCount');
  elements.totalCount = document.getElementById('totalCount');
  elements.selectAllBtn = document.getElementById('selectAllBtn');
  elements.deselectAllBtn = document.getElementById('deselectAllBtn');
  elements.selectCurrentBtn = document.getElementById('selectCurrentBtn');
  elements.filterInput = document.getElementById('filterInput');
  elements.batchClipBtn = document.getElementById('batchClipBtn');
  elements.cancelBtn = document.getElementById('cancelBtn');
  elements.progressPanel = document.getElementById('progressPanel');
  elements.successPanel = document.getElementById('successPanel');
  elements.progressBar = document.getElementById('progressBar');
  elements.savedCount = document.getElementById('savedCount');
  elements.totalProcessCount = document.getElementById('totalProcessCount');
  elements.progressPercentage = document.getElementById('progressPercentage');
  elements.currentProcessing = document.getElementById('currentProcessing');
  elements.errorList = document.getElementById('errorList');
  elements.successCount = document.getElementById('successCount');
  elements.errorCount = document.getElementById('errorCount');
  elements.errorSummary = document.getElementById('errorSummary');
  elements.viewErrorsBtn = document.getElementById('viewErrorsBtn');
  elements.closeBtn = document.getElementById('closeBtn');
  elements.stopBtn = document.getElementById('stopBtn');
}

/**
 * Load all tabs from browser
 */
async function loadTabs() {
  try {
    console.log('[BatchClipper] Loading tabs...');

    // Query all tabs
    allTabs = await browserAdapter.tabs.query({});

    // Filter out extension pages and special URLs
    allTabs = allTabs.filter(tab => {
      const url = tab.url || '';
      return !url.startsWith('chrome://') &&
             !url.startsWith('chrome-extension://') &&
             !url.startsWith('about:') &&
             !url.startsWith('edge://') &&
             !url.startsWith('moz-extension://') &&
             url !== '';
    });

    console.log(`[BatchClipper] Loaded ${allTabs.length} tabs`);

    filteredTabs = [...allTabs];
    updateUI();
  } catch (error) {
    console.error('[BatchClipper] Failed to load tabs:', error);
    elements.tabList.innerHTML = '<div class="loading"><p>加载标签页失败</p></div>';
  }
}

/**
 * Update UI with tab list
 */
function updateUI() {
  // Update counts
  elements.totalCount.textContent = filteredTabs.length;
  elements.selectedCount.textContent = selectedTabIds.size;

  // Enable/disable batch clip button
  elements.batchClipBtn.disabled = selectedTabIds.size === 0;

  // Render tab list
  renderTabList();
}

/**
 * Render tab list
 */
function renderTabList() {
  if (filteredTabs.length === 0) {
    elements.tabList.innerHTML = '<div class="loading"><p>没有找到标签页</p></div>';
    return;
  }

  elements.tabList.innerHTML = '';

  filteredTabs.forEach(tab => {
    const item = createTabItem(tab);
    elements.tabList.appendChild(item);
  });
}

/**
 * Create a tab item element
 */
function createTabItem(tab) {
  const item = document.createElement('div');
  item.className = 'tab-item';
  item.dataset.tabId = tab.id;

  if (selectedTabIds.has(tab.id)) {
    item.classList.add('selected');
  }

  // Checkbox
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'tab-checkbox';
  checkbox.checked = selectedTabIds.has(tab.id);
  checkbox.addEventListener('change', (e) => {
    e.stopPropagation();
    toggleTabSelection(tab.id);
  });

  // Favicon
  const favicon = document.createElement('img');
  favicon.className = 'tab-favicon';
  if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://')) {
    favicon.src = tab.favIconUrl;
    favicon.onerror = () => {
      favicon.src = '';
      favicon.textContent = '📄';
      favicon.className = 'tab-favicon default';
    };
  } else {
    favicon.className = 'tab-favicon default';
    favicon.textContent = '📄';
  }

  // Tab info
  const info = document.createElement('div');
  info.className = 'tab-info';

  const title = document.createElement('div');
  title.className = 'tab-title';
  title.textContent = tab.title || '无标题';
  title.title = tab.title || '';

  const url = document.createElement('div');
  url.className = 'tab-url';
  url.textContent = tab.url;
  url.title = tab.url;

  info.appendChild(title);
  info.appendChild(url);

  // Assemble
  item.appendChild(checkbox);
  item.appendChild(favicon);
  item.appendChild(info);

  // Click to toggle
  item.addEventListener('click', (e) => {
    if (e.target !== checkbox) {
      toggleTabSelection(tab.id);
    }
  });

  return item;
}

/**
 * Toggle tab selection
 */
function toggleTabSelection(tabId) {
  if (selectedTabIds.has(tabId)) {
    selectedTabIds.delete(tabId);
  } else {
    selectedTabIds.add(tabId);
  }
  updateUI();
}

/**
 * Bind event listeners
 */
function bindEvents() {
  // Select all
  elements.selectAllBtn.addEventListener('click', () => {
    selectedTabIds.clear();
    filteredTabs.forEach(tab => selectedTabIds.add(tab.id));
    updateUI();
  });

  // Deselect all
  elements.deselectAllBtn.addEventListener('click', () => {
    selectedTabIds.clear();
    updateUI();
  });

  // Select current window only
  elements.selectCurrentBtn.addEventListener('click', async () => {
    try {
      const currentWindow = await browserAdapter.windows.getCurrent();
      const currentWindowTabs = allTabs.filter(tab => tab.windowId === currentWindow.id);

      selectedTabIds.clear();
      currentWindowTabs.forEach(tab => {
        if (filteredTabs.find(t => t.id === tab.id)) {
          selectedTabIds.add(tab.id);
        }
      });
      updateUI();
    } catch (error) {
      console.error('[BatchClipper] Failed to get current window:', error);
    }
  });

  // Filter input
  elements.filterInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();

    if (!query) {
      filteredTabs = [...allTabs];
    } else {
      filteredTabs = allTabs.filter(tab => {
        const title = (tab.title || '').toLowerCase();
        const url = (tab.url || '').toLowerCase();
        return title.includes(query) || url.includes(query);
      });
    }

    updateUI();
  });

  // Batch clip button
  elements.batchClipBtn.addEventListener('click', startBatchClip);

  // Cancel button
  elements.cancelBtn.addEventListener('click', () => {
    window.close();
  });

  // Stop button
  elements.stopBtn.addEventListener('click', () => {
    shouldStop = true;
    elements.stopBtn.disabled = true;
    elements.stopBtn.textContent = '⏹ 正在停止...';
  });

  // Close button (success panel)
  elements.closeBtn.addEventListener('click', () => {
    window.close();
  });

  // View errors button
  elements.viewErrorsBtn.addEventListener('click', () => {
    showErrorDetails();
  });
}

/**
 * Start batch clipping
 */
async function startBatchClip() {
  if (isProcessing) {
    return;
  }

  isProcessing = true;
  shouldStop = false;

  // Reset stats
  stats = {
    total: selectedTabIds.size,
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  // Show progress panel
  elements.progressPanel.classList.remove('hidden');
  elements.totalProcessCount.textContent = stats.total;
  elements.savedCount.textContent = '0';
  elements.progressBar.style.width = '0%';
  elements.progressPercentage.textContent = '0%';
  elements.currentProcessing.textContent = '';
  elements.errorList.classList.add('hidden');

  // Get selected tabs
  const selectedTabs = allTabs.filter(tab => selectedTabIds.has(tab.id));

  console.log(`[BatchClipper] Starting batch clip for ${selectedTabs.length} tabs`);

  // Process with concurrency limit (3 at a time)
  await processBatch(selectedTabs, 3);

  // Show success panel
  showSuccessPanel();

  isProcessing = false;
}

/**
 * Process batch with concurrency control
 */
async function processBatch(tabs, concurrency) {
  const queue = [...tabs];
  const workers = [];

  // Create worker promises
  for (let i = 0; i < concurrency; i++) {
    workers.push(processWorker(queue));
  }

  // Wait for all workers to finish
  await Promise.all(workers);
}

/**
 * Worker function to process tabs from queue
 */
async function processWorker(queue) {
  while (queue.length > 0 && !shouldStop) {
    const tab = queue.shift();
    if (!tab) break;

    await processTab(tab);
  }
}

/**
 * Process a single tab
 */
async function processTab(tab) {
  console.log(`[BatchClipper] Processing tab: ${tab.title}`);

  // Update current processing display
  elements.currentProcessing.textContent = `正在处理: ${tab.title}`;

  // Update tab item status
  updateTabItemStatus(tab.id, 'processing');

  try {
    // Get page info from content script
    let pageInfo;
    try {
      pageInfo = await browserAdapter.tabs.sendMessage(tab.id, {
        action: 'getPageInfo',
      });
    } catch (error) {
      // If content script not loaded, use basic info
      console.warn('[BatchClipper] Content script not available, using basic info');
      pageInfo = {
        success: true,
        data: {
          title: tab.title,
          url: tab.url,
          content: '',
          excerpt: '',
          domain: new URL(tab.url).hostname,
        },
      };
    }

    if (!pageInfo || !pageInfo.success) {
      throw new Error('无法获取页面信息');
    }

    // Clip page
    const response = await browserAdapter.runtime.sendMessage({
      action: 'clipPage',
      data: {
        title: pageInfo.data.title || tab.title,
        content: pageInfo.data.content || '',
        url: tab.url,
        excerpt: pageInfo.data.excerpt || '',
        domain: pageInfo.data.domain || '',
        type: 'web_clip',
        tags: [],
        autoIndex: true,
      },
    });

    if (!response || !response.success) {
      throw new Error(response?.error || '剪藏失败');
    }

    console.log(`[BatchClipper] Successfully clipped: ${tab.title}`);
    stats.succeeded++;
    updateTabItemStatus(tab.id, 'success');

  } catch (error) {
    console.error(`[BatchClipper] Failed to clip tab: ${tab.title}`, error);
    stats.failed++;
    stats.errors.push({
      tab: tab,
      error: error.message,
    });
    updateTabItemStatus(tab.id, 'error');
  } finally {
    stats.processed++;
    updateProgress();
  }

  // Small delay to avoid overwhelming the server
  await new Promise(resolve => setTimeout(resolve, 200));
}

/**
 * Update tab item status in UI
 */
function updateTabItemStatus(tabId, status) {
  const item = elements.tabList.querySelector(`[data-tab-id="${tabId}"]`);
  if (!item) return;

  // Remove old status classes
  item.classList.remove('processing', 'error', 'selected');

  // Add new status class
  item.classList.add(status);

  // Add status badge
  let statusBadge = item.querySelector('.tab-status');
  if (!statusBadge) {
    statusBadge = document.createElement('span');
    statusBadge.className = 'tab-status';
    item.appendChild(statusBadge);
  }

  statusBadge.className = `tab-status ${status}`;

  if (status === 'processing') {
    statusBadge.textContent = '处理中...';
  } else if (status === 'success') {
    statusBadge.textContent = '✓ 成功';
  } else if (status === 'error') {
    statusBadge.textContent = '✗ 失败';
  }
}

/**
 * Update progress display
 */
function updateProgress() {
  const percentage = Math.round((stats.processed / stats.total) * 100);

  elements.savedCount.textContent = stats.succeeded;
  elements.progressBar.style.width = percentage + '%';
  elements.progressPercentage.textContent = percentage + '%';

  // Show errors if any
  if (stats.failed > 0) {
    elements.errorList.classList.remove('hidden');
    elements.errorList.innerHTML = `<div class="error-item">失败 ${stats.failed} 个</div>`;
  }
}

/**
 * Show success panel
 */
function showSuccessPanel() {
  elements.progressPanel.classList.add('hidden');
  elements.successPanel.classList.remove('hidden');

  elements.successCount.textContent = stats.succeeded;

  if (stats.failed > 0) {
    elements.errorCount.textContent = stats.failed;
    elements.errorSummary.classList.remove('hidden');
    elements.viewErrorsBtn.classList.remove('hidden');
  }
}

/**
 * Show error details
 */
function showErrorDetails() {
  let message = '以下页面剪藏失败:\n\n';

  stats.errors.forEach((item, index) => {
    message += `${index + 1}. ${item.tab.title}\n`;
    message += `   错误: ${item.error}\n`;
    message += `   URL: ${item.tab.url}\n\n`;
  });

  alert(message);
}

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', initialize);
