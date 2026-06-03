/**
 * ChainlessChain Browser Extension - Options Page Script
 */

import { BatchClipManager } from '../utils/batch-clip-manager.js';
import { ScheduleManager, SyncManager, TagManager, SearchManager, ExportManager } from '../utils/managers.js';

// 初始化管理器
const batchClipManager = new BatchClipManager();
const scheduleManager = new ScheduleManager();
const syncManager = new SyncManager();
const tagManager = new TagManager();
const searchManager = new SearchManager();
const exportManager = new ExportManager();

// 当前活动标签
let currentTab = 'general';

// 初始化
document.addEventListener('DOMContentLoaded', init);

async function init() {
  // 设置导航
  setupNavigation();

  // 加载设置
  await loadAllSettings();

  // 绑定事件
  bindEvents();

  // 检查连接状态
  checkConnection();
}

/**
 * 设置导航
 */
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();

      // 更新导航状态
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');

      // 切换内容
      const tabId = item.dataset.tab;
      switchTab(tabId);
    });
  });
}

/**
 * 切换标签页
 */
function switchTab(tabId) {
  // 隐藏所有内容
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });

  // 显示目标内容
  const targetContent = document.getElementById(tabId);
  if (targetContent) {
    targetContent.classList.add('active');
    currentTab = tabId;

    // 加载标签页特定内容
    loadTabContent(tabId);
  }
}

/**
 * 加载标签页内容
 */
async function loadTabContent(tabId) {
  switch (tabId) {
    case 'batch':
      await loadTabsList();
      break;
    case 'schedule':
      await loadScheduleTasks();
      break;
    case 'tags':
      await loadTagsGrid();
      break;
    case 'export':
      await loadExportStats();
      break;
  }
}

/**
 * 加载所有设置
 */
async function loadAllSettings() {
  const settings = await chrome.storage.sync.get({
    // 基本设置
    appPath: '',
    connectionTimeout: 30,
    showFloatingToolbar: true,
    showNotifications: true,

    // 剪藏设置
    captureImages: true,
    maxImages: 10,
    captureLinks: true,
    maxLinks: 50,
    defaultTags: ['web-clip'],
    autoSave: true,

    // 批量设置
    batchConcurrency: 3,
    batchCloseAfterClip: false,

    // 定时设置
    enableSchedule: false,
    scheduleInterval: 30,
    scheduleOnlyActive: true,

    // 同步设置
    enableSync: false,
    syncHistory: true,
    syncSettings: true,
    syncTags: true,

    // 搜索设置
    searchInTitle: true,
    searchInContent: true,
    searchInTags: true
  });

  // 填充表单
  fillForm(settings);
}

/**
 * 填充表单
 */
function fillForm(settings) {
  // 基本设置
  document.getElementById('appPath').value = settings.appPath;
  document.getElementById('connectionTimeout').value = settings.connectionTimeout;
  document.getElementById('showFloatingToolbar').checked = settings.showFloatingToolbar;
  document.getElementById('showNotifications').checked = settings.showNotifications;

  // 剪藏设置
  document.getElementById('captureImages').checked = settings.captureImages;
  document.getElementById('maxImages').value = settings.maxImages;
  document.getElementById('captureLinks').checked = settings.captureLinks;
  document.getElementById('maxLinks').value = settings.maxLinks;
  document.getElementById('autoSave').checked = settings.autoSave;

  // 默认标签
  renderDefaultTags(settings.defaultTags);

  // 批量设置
  document.getElementById('batchConcurrency').value = settings.batchConcurrency;
  document.getElementById('batchCloseAfterClip').checked = settings.batchCloseAfterClip;

  // 定时设置
  document.getElementById('enableSchedule').checked = settings.enableSchedule;
  document.getElementById('scheduleInterval').value = settings.scheduleInterval;
  document.getElementById('scheduleOnlyActive').checked = settings.scheduleOnlyActive;

  // 同步设置
  document.getElementById('enableSync').checked = settings.enableSync;
  document.getElementById('syncHistory').checked = settings.syncHistory;
  document.getElementById('syncSettings').checked = settings.syncSettings;
  document.getElementById('syncTags').checked = settings.syncTags;

  // 搜索设置
  document.getElementById('searchInTitle').checked = settings.searchInTitle;
  document.getElementById('searchInContent').checked = settings.searchInContent;
  document.getElementById('searchInTags').checked = settings.searchInTags;
}

/**
 * 渲染默认标签
 */
function renderDefaultTags(tags) {
  const tagsList = document.getElementById('defaultTagsList');
  tagsList.innerHTML = tags.map(tag => `
    <span class="tag">
      ${tag}
      <button class="tag-remove" data-tag="${tag}">×</button>
    </span>
  `).join('');

  // 绑定删除事件
  tagsList.querySelectorAll('.tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag;
      removeDefaultTag(tag);
    });
  });
}

/**
 * 移除默认标签
 */
async function removeDefaultTag(tag) {
  const { defaultTags = [] } = await chrome.storage.sync.get('defaultTags');
  const newTags = defaultTags.filter(t => t !== tag);
  await chrome.storage.sync.set({ defaultTags: newTags });
  renderDefaultTags(newTags);
}

/**
 * 添加默认标签
 */
async function addDefaultTag(tag) {
  if (!tag.trim()) return;

  const { defaultTags = [] } = await chrome.storage.sync.get('defaultTags');
  if (!defaultTags.includes(tag)) {
    defaultTags.push(tag);
    await chrome.storage.sync.set({ defaultTags });
    renderDefaultTags(defaultTags);
  }
}

/**
 * 检查连接状态
 */
async function checkConnection() {
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('connectionStatusText');

  try {
    const response = await chrome.runtime.sendMessage({ action: 'checkConnection' });

    if (response.success && response.connected) {
      statusIndicator.className = 'status-indicator connected';
      statusText.textContent = '已连接到桌面应用';
    } else {
      statusIndicator.className = 'status-indicator disconnected';
      statusText.textContent = '未连接到桌面应用';
    }
  } catch (error) {
    statusIndicator.className = 'status-indicator error';
    statusText.textContent = '连接检查失败';
  }
}

/**
 * 加载标签页列表
 */
async function loadTabsList() {
  const tabsList = document.getElementById('tabsList');
  const tabs = await chrome.tabs.query({ currentWindow: true });

  tabsList.innerHTML = tabs.map(tab => `
    <div class="tab-item">
      <input type="checkbox" class="tab-checkbox" data-tab-id="${tab.id}">
      <img src="${tab.favIconUrl || '../../icons/icon16.png'}" class="tab-favicon">
      <div class="tab-info">
        <div class="tab-title">${tab.title}</div>
        <div class="tab-url">${tab.url}</div>
      </div>
    </div>
  `).join('');
}

/**
 * 加载定时任务列表
 */
async function loadScheduleTasks() {
  const tasks = await scheduleManager.getTasks();
  const tasksList = document.getElementById('scheduleTasksList');

  if (tasks.length === 0) {
    tasksList.innerHTML = '<p class="empty-state">暂无定时任务</p>';
    return;
  }

  tasksList.innerHTML = tasks.map(task => `
    <div class="schedule-task">
      <div class="task-info">
        <div class="task-name">${task.name}</div>
        <div class="task-schedule">每 ${task.interval} 分钟</div>
      </div>
      <div class="task-actions">
        <button class="btn-secondary btn-sm" data-task-id="${task.id}" data-action="pause">
          ${task.enabled ? '暂停' : '启用'}
        </button>
        <button class="btn-danger btn-sm" data-task-id="${task.id}" data-action="delete">删除</button>
      </div>
    </div>
  `).join('');
}

/**
 * 加载标签网格
 */
async function loadTagsGrid() {
  const tags = await tagManager.getAllTags();
  const tagsGrid = document.getElementById('tagsGrid');

  if (tags.length === 0) {
    tagsGrid.innerHTML = '<p class="empty-state">暂无标签</p>';
    return;
  }

  tagsGrid.innerHTML = tags.map(tag => `
    <div class="tag-card">
      <div class="tag-color" style="background: ${tag.color}"></div>
      <div class="tag-name">${tag.name}</div>
      <div class="tag-count">${tag.count || 0} 个剪藏</div>
      <div class="tag-actions">
        <button class="btn-icon" data-tag-id="${tag.id}" data-action="edit">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="btn-icon" data-tag-id="${tag.id}" data-action="delete">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');
}

/**
 * 加载导出统计
 */
async function loadExportStats() {
  const { history = [] } = await chrome.storage.local.get('history');
  document.getElementById('totalClips').textContent = history.length;
  document.getElementById('selectedClips').textContent = history.length;
}

/**
 * 绑定事件
 */
function bindEvents() {
  // 基本设置
  document.getElementById('saveGeneral').addEventListener('click', saveGeneralSettings);
  document.getElementById('resetGeneral').addEventListener('click', resetGeneralSettings);
  document.getElementById('testConnection').addEventListener('click', checkConnection);

  // 剪藏设置
  document.getElementById('saveClip').addEventListener('click', saveClipSettings);
  document.getElementById('newTagInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addDefaultTag(e.target.value);
      e.target.value = '';
    }
  });

  // 批量剪藏
  document.getElementById('clipAllTabs').addEventListener('click', clipAllTabs);
  document.getElementById('clipSelectedTabs').addEventListener('click', clipSelectedTabs);

  // 定时剪藏
  document.getElementById('saveSchedule').addEventListener('click', saveScheduleSettings);

  // 云同步
  document.getElementById('saveSync').addEventListener('click', saveSyncSettings);
  document.getElementById('syncNow').addEventListener('click', syncNow);

  // 标签管理
  document.getElementById('addNewTag').addEventListener('click', addNewTag);
  document.getElementById('tagSearchInput').addEventListener('input', searchTags);

  // 搜索
  document.getElementById('searchDemo').addEventListener('click', performSearch);
  document.getElementById('searchDemoInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performSearch();
  });

  // 导出
  document.querySelectorAll('.export-btn').forEach(btn => {
    btn.addEventListener('click', () => exportData(btn.dataset.format));
  });
}

// 保存设置函数
async function saveGeneralSettings() {
  const settings = {
    appPath: document.getElementById('appPath').value,
    connectionTimeout: parseInt(document.getElementById('connectionTimeout').value),
    showFloatingToolbar: document.getElementById('showFloatingToolbar').checked,
    showNotifications: document.getElementById('showNotifications').checked
  };

  await chrome.storage.sync.set(settings);
  showMessage('设置已保存', 'success');
}

async function resetGeneralSettings() {
  const defaults = {
    appPath: '',
    connectionTimeout: 30,
    showFloatingToolbar: true,
    showNotifications: true
  };

  await chrome.storage.sync.set(defaults);
  fillForm(await chrome.storage.sync.get());
  showMessage('已恢复默认设置', 'success');
}

async function saveClipSettings() {
  const settings = {
    captureImages: document.getElementById('captureImages').checked,
    maxImages: parseInt(document.getElementById('maxImages').value),
    captureLinks: document.getElementById('captureLinks').checked,
    maxLinks: parseInt(document.getElementById('maxLinks').value),
    autoSave: document.getElementById('autoSave').checked
  };

  await chrome.storage.sync.set(settings);
  showMessage('设置已保存', 'success');
}

async function saveScheduleSettings() {
  const settings = {
    enableSchedule: document.getElementById('enableSchedule').checked,
    scheduleInterval: parseInt(document.getElementById('scheduleInterval').value),
    scheduleOnlyActive: document.getElementById('scheduleOnlyActive').checked
  };

  await chrome.storage.sync.set(settings);

  if (settings.enableSchedule) {
    await scheduleManager.start(settings.scheduleInterval);
  } else {
    await scheduleManager.stop();
  }

  showMessage('设置已保存', 'success');
}

async function saveSyncSettings() {
  const settings = {
    enableSync: document.getElementById('enableSync').checked,
    syncHistory: document.getElementById('syncHistory').checked,
    syncSettings: document.getElementById('syncSettings').checked,
    syncTags: document.getElementById('syncTags').checked
  };

  await chrome.storage.sync.set(settings);
  showMessage('设置已保存', 'success');
}

// 批量剪藏
async function clipAllTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  await batchClipManager.clipTabs(tabs, updateBatchProgress);
}

async function clipSelectedTabs() {
  const checkboxes = document.querySelectorAll('.tab-checkbox:checked');
  const tabIds = Array.from(checkboxes).map(cb => parseInt(cb.dataset.tabId));
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const selectedTabs = tabs.filter(tab => tabIds.includes(tab.id));

  await batchClipManager.clipTabs(selectedTabs, updateBatchProgress);
}

function updateBatchProgress(current, total) {
  const progress = document.getElementById('batchProgress');
  const fill = document.getElementById('progressFill');
  const text = document.getElementById('progressText');

  progress.style.display = 'block';
  fill.style.width = `${(current / total) * 100}%`;
  text.textContent = `${current} / ${total}`;

  if (current === total) {
    setTimeout(() => {
      progress.style.display = 'none';
    }, 2000);
  }
}

// 云同步
async function syncNow() {
  showMessage('正在同步...', 'info');
  try {
    await syncManager.sync();
    document.getElementById('syncStatus').textContent = '已同步';
    document.getElementById('lastSyncTime').textContent = new Date().toLocaleString();
    showMessage('同步完成', 'success');
  } catch (error) {
    showMessage('同步失败: ' + error.message, 'error');
  }
}

// 标签管理
async function addNewTag() {
  const name = prompt('请输入标签名称:');
  if (!name) return;

  const color = '#' + Math.floor(Math.random()*16777215).toString(16);
  await tagManager.createTag(name, color);
  await loadTagsGrid();
  showMessage('标签已创建', 'success');
}

async function searchTags() {
  const query = document.getElementById('tagSearchInput').value;
  const tags = await tagManager.searchTags(query);
  // 渲染搜索结果...
}

// 搜索
async function performSearch() {
  const query = document.getElementById('searchDemoInput').value;
  if (!query) return;

  const results = await searchManager.search(query);
  const resultsDiv = document.getElementById('searchResults');

  if (results.length === 0) {
    resultsDiv.innerHTML = '<p class="empty-state">未找到相关内容</p>';
    return;
  }

  resultsDiv.innerHTML = results.map(result => `
    <div class="search-result">
      <h4>${result.title}</h4>
      <p>${result.content.substring(0, 150)}...</p>
      <span class="result-date">${new Date(result.timestamp).toLocaleDateString()}</span>
    </div>
  `).join('');
}

// 导出
async function exportData(format) {
  showMessage('正在导出...', 'info');
  try {
    await exportManager.export(format);
    showMessage('导出完成', 'success');
  } catch (error) {
    showMessage('导出失败: ' + error.message, 'error');
  }
}

// 显示消息
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
  }, 3000);
}
