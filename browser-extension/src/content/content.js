/**
 * ChainlessChain Browser Extension - Content Script
 *
 * 在网页中注入的脚本，用于：
 * - 监听用户操作
 * - 提取页面内容
 * - 显示浮动工具栏
 */

// 浮动工具栏状态
let floatingToolbar = null;
let selectedText = '';

// 初始化
init();

function init() {
  console.log('ChainlessChain content script loaded');

  // 监听文本选择
  document.addEventListener('mouseup', handleTextSelection);
  document.addEventListener('keyup', handleTextSelection);

  // 监听来自background的消息
  chrome.runtime.onMessage.addListener(handleMessage);
}

/**
 * 处理文本选择
 */
function handleTextSelection(event) {
  const selection = window.getSelection();
  const text = selection.toString().trim();

  if (text.length > 0) {
    selectedText = text;
    showFloatingToolbar(event);
  } else {
    hideFloatingToolbar();
  }
}

/**
 * 显示浮动工具栏
 */
function showFloatingToolbar(event) {
  // 如果工具栏已存在，先移除
  hideFloatingToolbar();

  // 创建工具栏
  floatingToolbar = document.createElement('div');
  floatingToolbar.id = 'chainlesschain-floating-toolbar';
  floatingToolbar.innerHTML = `
    <div class="cc-toolbar-content">
      <button class="cc-toolbar-btn" data-action="clip-selection" title="保存选中内容">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
          <polyline points="17 21 17 13 7 13 7 21"/>
          <polyline points="7 3 7 8 15 8"/>
        </svg>
      </button>
      <button class="cc-toolbar-btn" data-action="search" title="在知识库中搜索">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <path d="m21 21-4.35-4.35"/>
        </svg>
      </button>
      <button class="cc-toolbar-btn cc-toolbar-close" data-action="close" title="关闭">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  `;

  // 添加事件监听
  floatingToolbar.addEventListener('click', handleToolbarClick);

  // 计算位置
  const selection = window.getSelection();
  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    floatingToolbar.style.top = `${window.scrollY + rect.top - 45}px`;
    floatingToolbar.style.left = `${window.scrollX + rect.left + rect.width / 2}px`;
  }

  // 添加到页面
  document.body.appendChild(floatingToolbar);

  // 添加动画
  setTimeout(() => {
    floatingToolbar.classList.add('cc-toolbar-visible');
  }, 10);
}

/**
 * 隐藏浮动工具栏
 */
function hideFloatingToolbar() {
  if (floatingToolbar) {
    floatingToolbar.remove();
    floatingToolbar = null;
  }
}

/**
 * 处理工具栏点击
 */
async function handleToolbarClick(event) {
  const button = event.target.closest('.cc-toolbar-btn');
  if (!button) return;

  const action = button.dataset.action;

  switch (action) {
    case 'clip-selection':
      await clipSelection();
      break;

    case 'search':
      await searchInKnowledge();
      break;

    case 'close':
      hideFloatingToolbar();
      break;
  }
}

/**
 * 剪藏选中内容
 */
async function clipSelection() {
  try {
    showLoading();

    const clipData = {
      type: 'selection',
      content: selectedText,
      url: window.location.href,
      title: document.title,
      timestamp: Date.now()
    };

    const response = await chrome.runtime.sendMessage({
      action: 'clip',
      data: clipData
    });

    if (response.success) {
      showSuccess('内容已保存');
    } else {
      showError('保存失败');
    }
  } catch (error) {
    console.error('Failed to clip selection:', error);
    showError('保存失败');
  } finally {
    hideFloatingToolbar();
  }
}

/**
 * 在知识库中搜索
 */
async function searchInKnowledge() {
  try {
    // 发送消息到background
    const response = await chrome.runtime.sendMessage({
      action: 'searchKnowledge',
      data: { query: selectedText }
    });

    if (response.success && response.results) {
      showSearchResults(response.results);
    }
  } catch (error) {
    console.error('Failed to search:', error);
  }
}

/**
 * 显示搜索结果
 */
function showSearchResults(results) {
  // 创建搜索结果面板
  const panel = document.createElement('div');
  panel.id = 'chainlesschain-search-results';
  panel.innerHTML = `
    <div class="cc-search-panel">
      <div class="cc-search-header">
        <h3>搜索结果</h3>
        <button class="cc-search-close">×</button>
      </div>
      <div class="cc-search-results">
        ${results.length === 0 ? '<p class="cc-no-results">未找到相关内容</p>' : ''}
        ${results.map(result => `
          <div class="cc-search-result">
            <h4>${result.title}</h4>
            <p>${result.content.substring(0, 150)}...</p>
            <span class="cc-result-date">${new Date(result.created_at).toLocaleDateString()}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  // 添加关闭事件
  panel.querySelector('.cc-search-close').addEventListener('click', () => {
    panel.remove();
  });

  document.body.appendChild(panel);
}

/**
 * 显示加载状态
 */
function showLoading() {
  if (floatingToolbar) {
    floatingToolbar.classList.add('cc-toolbar-loading');
  }
}

/**
 * 显示成功消息
 */
function showSuccess(message) {
  showToast(message, 'success');
}

/**
 * 显示错误消息
 */
function showError(message) {
  showToast(message, 'error');
}

/**
 * 显示Toast消息
 */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `cc-toast cc-toast-${type}`;
  toast.textContent = message;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('cc-toast-visible');
  }, 10);

  setTimeout(() => {
    toast.classList.remove('cc-toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

/**
 * 处理来自background的消息
 */
function handleMessage(message, sender, sendResponse) {
  console.log('Content script received message:', message);

  switch (message.action) {
    case 'getSelection':
      sendResponse({ text: window.getSelection().toString() });
      break;

    case 'extractContent':
      const content = extractPageContent();
      sendResponse({ content });
      break;

    default:
      sendResponse({ error: 'Unknown action' });
  }

  return true;
}

/**
 * 提取页面内容
 */
function extractPageContent() {
  // 尝试找到主要内容区域
  const article = document.querySelector('article') ||
                  document.querySelector('main') ||
                  document.querySelector('[role="main"]') ||
                  document.body;

  return {
    content: article.innerText,
    html: article.innerHTML,
    images: Array.from(article.querySelectorAll('img')).map(img => ({
      src: img.src,
      alt: img.alt,
      width: img.width,
      height: img.height
    })),
    links: Array.from(article.querySelectorAll('a')).map(a => ({
      href: a.href,
      text: a.textContent.trim()
    }))
  };
}
