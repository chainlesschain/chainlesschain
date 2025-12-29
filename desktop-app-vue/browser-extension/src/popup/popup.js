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

  // AI功能元素
  elements.generateTagsBtn = document.getElementById('generateTagsBtn');
  elements.generateSummaryBtn = document.getElementById('generateSummaryBtn');
  elements.summarySection = document.getElementById('summarySection');
  elements.summaryTextarea = document.getElementById('summary');

  // 截图功能元素
  elements.captureScreenshotBtn = document.getElementById('captureScreenshotBtn');

  // 批量剪藏元素
  elements.openBatchClipperBtn = document.getElementById('openBatchClipperBtn');
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

  // AI功能按钮
  if (elements.generateTagsBtn) {
    elements.generateTagsBtn.addEventListener('click', handleGenerateTags);
  }

  if (elements.generateSummaryBtn) {
    elements.generateSummaryBtn.addEventListener('click', handleGenerateSummary);
  }

  // 截图功能按钮
  if (elements.captureScreenshotBtn) {
    elements.captureScreenshotBtn.addEventListener('click', handleCaptureScreenshot);
  }

  // 批量剪藏按钮
  if (elements.openBatchClipperBtn) {
    elements.openBatchClipperBtn.addEventListener('click', handleOpenBatchClipper);
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

/**
 * Handle AI tag generation
 */
async function handleGenerateTags() {
  const btn = elements.generateTagsBtn;
  const originalText = btn.textContent;

  // Disable button
  btn.disabled = true;
  btn.textContent = '生成中...';

  try {
    // Send request to background script
    const response = await browserAdapter.runtime.sendMessage({
      action: 'generateTags',
      data: {
        title: currentPage.title,
        content: currentPage.content || currentPage.excerpt,
        url: currentPage.url,
        excerpt: currentPage.excerpt,
      },
    });

    if (response && response.success && response.data.tags) {
      const tags = response.data.tags;
      console.log('[Popup] AI generated tags:', tags);

      // Update tags input
      elements.tagsInput.value = tags.join(', ');

      // Show success feedback
      btn.textContent = '✓ 已生成';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 2000);
    } else {
      throw new Error(response?.error || 'AI标签生成失败');
    }
  } catch (error) {
    console.error('[Popup] Tag generation failed:', error);
    alert('标签生成失败: ' + error.message);
    btn.textContent = originalText;
  } finally {
    // Re-enable button
    btn.disabled = false;
  }
}

/**
 * Handle AI summary generation
 */
async function handleGenerateSummary() {
  const btn = elements.generateSummaryBtn;
  const originalText = btn.textContent;

  // Disable button
  btn.disabled = true;
  btn.textContent = '生成中...';

  try {
    // Send request to background script
    const response = await browserAdapter.runtime.sendMessage({
      action: 'generateSummary',
      data: {
        title: currentPage.title,
        content: currentPage.content || currentPage.excerpt,
      },
    });

    if (response && response.success && response.data.summary) {
      const summary = response.data.summary;
      console.log('[Popup] AI generated summary:', summary.substring(0, 50) + '...');

      // Show summary section
      elements.summarySection.style.display = 'block';
      elements.summaryTextarea.value = summary;

      // Show success feedback
      btn.textContent = '✓ 已生成';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 2000);
    } else {
      throw new Error(response?.error || 'AI摘要生成失败');
    }
  } catch (error) {
    console.error('[Popup] Summary generation failed:', error);
    alert('摘要生成失败: ' + error.message);
    btn.textContent = originalText;
  } finally {
    // Re-enable button
    btn.disabled = false;
  }
}

/**
 * Handle screenshot capture
 */
async function handleCaptureScreenshot() {
  const btn = elements.captureScreenshotBtn;
  const originalText = btn.textContent;

  // Disable button
  btn.disabled = true;
  btn.textContent = '截图中...';

  try {
    console.log('[Popup] Capturing screenshot...');

    // Get current tab
    const [tab] = await browserAdapter.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      throw new Error('无法获取当前标签页');
    }

    // Capture visible tab
    const screenshotDataUrl = await browserAdapter.tabs.captureVisibleTab(null, {
      format: 'png',
    });

    console.log('[Popup] Screenshot captured, opening editor...');

    // Close popup (it will interfere with the editor window)
    // Instead, open annotation editor in a new window
    const editorUrl = browserAdapter.runtime.getURL('annotation/annotation-editor.html') +
      '?screenshot=' + encodeURIComponent(screenshotDataUrl);

    await browserAdapter.windows.create({
      url: editorUrl,
      type: 'popup',
      width: 1200,
      height: 800,
    });

    // Close the popup
    window.close();
  } catch (error) {
    console.error('[Popup] Screenshot capture failed:', error);
    alert('截图失败: ' + error.message);
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

/**
 * Handle opening batch clipper
 */
async function handleOpenBatchClipper() {
  try {
    console.log('[Popup] Opening batch clipper...');

    // Open batch clipper in a new window
    const batchClipperUrl = browserAdapter.runtime.getURL('batch/batch-clipper.html');

    await browserAdapter.windows.create({
      url: batchClipperUrl,
      type: 'popup',
      width: 900,
      height: 700,
    });

    // Close the popup
    window.close();
  } catch (error) {
    console.error('[Popup] Failed to open batch clipper:', error);
    alert('打开批量剪藏失败: ' + error.message);
  }
}

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', initialize);
