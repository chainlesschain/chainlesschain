/**
 * ChainlessChain Browser Extension - Popup Script
 */

// DOM元素
const connectionStatus = document.getElementById('connectionStatus');
const clipsList = document.getElementById('clipsList');
const clipSelectionBtn = document.getElementById('clipSelection');
const clipPageBtn = document.getElementById('clipPage');
const screenshotBtn = document.getElementById('screenshot');
const openAppBtn = document.getElementById('openApp');
const openOptionsBtn = document.getElementById('openOptions');
const viewAllBtn = document.getElementById('viewAll');

// 初始化
init();

async function init() {
  // 检查连接状态
  await checkConnection();

  // 加载最近剪藏
  await loadRecentClips();

  // 绑定事件
  bindEvents();
}

/**
 * 检查与桌面应用的连接
 */
async function checkConnection() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'checkConnection' });

    if (response.success && response.connected) {
      updateConnectionStatus(true);
    } else {
      updateConnectionStatus(false);
    }
  } catch (error) {
    console.error('Failed to check connection:', error);
    updateConnectionStatus(false);
  }
}

/**
 * 更新连接状态显示
 */
function updateConnectionStatus(connected) {
  const statusDot = connectionStatus.querySelector('.status-dot');
  const statusText = connectionStatus.querySelector('.status-text');

  if (connected) {
    statusDot.classList.add('connected');
    statusText.textContent = '已连接';
  } else {
    statusDot.classList.remove('connected');
    statusText.textContent = '未连接';
  }
}

/**
 * 加载最近剪藏
 */
async function loadRecentClips() {
  try {
    // 从本地存储获取历史
    const { history = [] } = await chrome.storage.local.get('history');

    if (history.length === 0) {
      clipsList.innerHTML = '<div class="empty-state">暂无剪藏记录</div>';
      return;
    }

    // 显示最近5条
    const recentClips = history.slice(0, 5);
    clipsList.innerHTML = recentClips.map(clip => `
      <div class="clip-item" data-id="${clip.id}">
        <div class="clip-icon">
          ${getClipIcon(clip.type)}
        </div>
        <div class="clip-info">
          <div class="clip-title">${clip.title || '无标题'}</div>
          <div class="clip-meta">
            <span class="clip-type">${getClipTypeText(clip.type)}</span>
            <span class="clip-time">${formatTime(clip.timestamp)}</span>
          </div>
        </div>
      </div>
    `).join('');

    // 绑定点击事件
    document.querySelectorAll('.clip-item').forEach(item => {
      item.addEventListener('click', () => {
        const url = item.dataset.url;
        if (url) {
          chrome.tabs.create({ url });
        }
      });
    });
  } catch (error) {
    console.error('Failed to load recent clips:', error);
    clipsList.innerHTML = '<div class="error-state">加载失败</div>';
  }
}

/**
 * 绑定事件
 */
function bindEvents() {
  // 保存选中内容
  clipSelectionBtn.addEventListener('click', async () => {
    await executeAction('clip-selection');
  });

  // 保存整页
  clipPageBtn.addEventListener('click', async () => {
    await executeAction('clip-page');
  });

  // 截图
  screenshotBtn.addEventListener('click', async () => {
    await executeAction('screenshot');
  });

  // 打开应用
  openAppBtn.addEventListener('click', () => {
    // 发送消息到原生应用
    chrome.runtime.sendMessage({ action: 'openApp' });
  });

  // 打开设置
  openOptionsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 查看全部
  viewAllBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

/**
 * 执行操作
 */
async function executeAction(action) {
  try {
    // 获取当前标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // 发送命令
    await chrome.runtime.sendMessage({
      action: 'executeCommand',
      command: action,
      tabId: tab.id
    });

    // 显示成功消息
    showMessage('操作成功', 'success');

    // 刷新列表
    setTimeout(() => {
      loadRecentClips();
    }, 500);
  } catch (error) {
    console.error('Failed to execute action:', error);
    showMessage('操作失败', 'error');
  }
}

/**
 * 获取剪藏类型图标
 */
function getClipIcon(type) {
  const icons = {
    selection: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
    </svg>`,
    page: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
    </svg>`,
    screenshot: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>`,
    link: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>`,
    image: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>`
  };

  return icons[type] || icons.page;
}

/**
 * 获取剪藏类型文本
 */
function getClipTypeText(type) {
  const texts = {
    selection: '选中内容',
    page: '整页',
    screenshot: '截图',
    link: '链接',
    image: '图片'
  };

  return texts[type] || '未知';
}

/**
 * 格式化时间
 */
function formatTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) {
    return '刚刚';
  } else if (diff < hour) {
    return `${Math.floor(diff / minute)}分钟前`;
  } else if (diff < day) {
    return `${Math.floor(diff / hour)}小时前`;
  } else if (diff < 7 * day) {
    return `${Math.floor(diff / day)}天前`;
  } else {
    const date = new Date(timestamp);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }
}

/**
 * 显示消息
 */
function showMessage(text, type = 'info') {
  const message = document.createElement('div');
  message.className = `message message-${type}`;
  message.textContent = text;

  document.body.appendChild(message);

  setTimeout(() => {
    message.classList.add('message-visible');
  }, 10);

  setTimeout(() => {
    message.classList.remove('message-visible');
    setTimeout(() => message.remove(), 300);
  }, 2000);
}
