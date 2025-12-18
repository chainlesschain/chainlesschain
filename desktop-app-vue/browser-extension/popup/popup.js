/**
 * ChainlessChain Web Clipper - Popup Script
 * 处理扩展弹窗的交互逻辑
 */

// DOM 元素
const elements = {
  status: document.getElementById('status'),
  statusIndicator: document.getElementById('statusIndicator'),
  statusText: document.getElementById('statusText'),
  content: document.getElementById('content'),
  preview: document.getElementById('preview'),
  previewTitle: document.getElementById('previewTitle'),
  previewDomain: document.getElementById('previewDomain'),
  previewDate: document.getElementById('previewDate'),
  clipForm: document.getElementById('clipForm'),
  titleInput: document.getElementById('title'),
  typeSelect: document.getElementById('type'),
  tagsInput: document.getElementById('tags'),
  readabilityCheckbox: document.getElementById('readability'),
  includeImagesCheckbox: document.getElementById('includeImages'),
  autoIndexCheckbox: document.getElementById('autoIndex'),
  clipBtn: document.getElementById('clipBtn'),
  btnText: document.querySelector('.btn-text'),
  btnLoading: document.querySelector('.btn-loading'),
  successMessage: document.getElementById('successMessage'),
  errorMessage: document.getElementById('errorMessage'),
  errorText: document.getElementById('errorText'),
  disconnectedMessage: document.getElementById('disconnectedMessage'),
  viewInAppBtn: document.getElementById('viewInApp'),
  retryBtn: document.getElementById('retryBtn'),
  reconnectBtn: document.getElementById('reconnectBtn'),
};

// 当前页面信息
let currentPage = {
  url: '',
  title: '',
  content: '',
  excerpt: '',
  author: '',
  date: '',
  domain: '',
};

// 初始化
async function initialize() {
  console.log('[Popup] 初始化中...');

  // 检查与桌面应用的连接
  const connected = await checkConnection();

  if (connected) {
    showContent();
    await loadPageInfo();
  } else {
    showDisconnected();
  }

  // 绑定事件
  bindEvents();
}

// 检查连接
async function checkConnection() {
  try {
    updateStatus('checking', '检查连接...');

    // 通过 background script 发送消息到桌面应用
    const response = await chrome.runtime.sendMessage({
      action: 'checkConnection',
    });

    if (response && response.success) {
      updateStatus('connected', '已连接到 ChainlessChain');
      return true;
    } else {
      updateStatus('error', '连接失败');
      return false;
    }
  } catch (error) {
    console.error('[Popup] 检查连接失败:', error);
    updateStatus('error', '连接失败');
    return false;
  }
}

// 更新状态
function updateStatus(status, text) {
  elements.statusText.textContent = text;
  elements.status.className = 'status ' + status;
}

// 显示主内容
function showContent() {
  elements.content.style.display = 'block';
  elements.disconnectedMessage.style.display = 'none';
  elements.errorMessage.style.display = 'none';
  elements.successMessage.style.display = 'none';
}

// 显示未连接消息
function showDisconnected() {
  elements.content.style.display = 'none';
  elements.disconnectedMessage.style.display = 'block';
  elements.errorMessage.style.display = 'none';
  elements.successMessage.style.display = 'none';
}

// 显示错误消息
function showError(message) {
  elements.content.style.display = 'none';
  elements.disconnectedMessage.style.display = 'none';
  elements.errorMessage.style.display = 'block';
  elements.successMessage.style.display = 'none';
  elements.errorText.textContent = message;
}

// 显示成功消息
function showSuccess() {
  elements.content.style.display = 'none';
  elements.disconnectedMessage.style.display = 'none';
  elements.errorMessage.style.display = 'none';
  elements.successMessage.style.display = 'block';
}

// 加载当前页面信息
async function loadPageInfo() {
  try {
    // 获取当前活动标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      console.error('[Popup] 无法获取当前标签页');
      return;
    }

    // 向 content script 发送消息获取页面信息
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'getPageInfo',
    });

    if (response && response.success) {
      currentPage = response.data;

      // 更新 UI
      elements.previewTitle.textContent = currentPage.title || '无标题';
      elements.previewDomain.textContent = currentPage.domain || '';
      elements.previewDate.textContent = currentPage.date || new Date().toLocaleDateString('zh-CN');

      // 填充表单
      elements.titleInput.value = currentPage.title || '';

      // 自动推荐标签
      const suggestedTags = suggestTags(currentPage);
      if (suggestedTags.length > 0) {
        elements.tagsInput.value = suggestedTags.join(', ');
      }
    } else {
      console.error('[Popup] 获取页面信息失败');
    }
  } catch (error) {
    console.error('[Popup] 加载页面信息失败:', error);
  }
}

// 智能推荐标签
function suggestTags(page) {
  const tags = [];

  // 从域名提取
  if (page.domain) {
    const domainParts = page.domain.split('.');
    if (domainParts.length >= 2) {
      tags.push(domainParts[domainParts.length - 2]);
    }
  }

  // 从标题提取关键词（简化版）
  if (page.title) {
    const keywords = ['教程', '指南', '文档', '博客', '新闻', '技术', '开发'];
    for (const keyword of keywords) {
      if (page.title.includes(keyword)) {
        tags.push(keyword);
        break;
      }
    }
  }

  // 限制标签数量
  return tags.slice(0, 3);
}

// 绑定事件
function bindEvents() {
  // 提交表单
  elements.clipForm.addEventListener('submit', handleClip);

  // 重试按钮
  elements.retryBtn.addEventListener('click', () => {
    showContent();
  });

  // 重新连接按钮
  elements.reconnectBtn.addEventListener('click', async () => {
    const connected = await checkConnection();
    if (connected) {
      showContent();
      await loadPageInfo();
    }
  });

  // 在应用中查看按钮
  elements.viewInAppBtn.addEventListener('click', () => {
    // TODO: 打开桌面应用
    window.close();
  });
}

// 处理剪藏
async function handleClip(event) {
  event.preventDefault();

  // 禁用按钮，显示加载状态
  elements.clipBtn.disabled = true;
  elements.btnText.style.display = 'none';
  elements.btnLoading.style.display = 'flex';

  try {
    // 收集表单数据
    const formData = {
      title: elements.titleInput.value.trim(),
      type: elements.typeSelect.value,
      tags: elements.tagsInput.value
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0),
      useReadability: elements.readabilityCheckbox.checked,
      includeImages: elements.includeImagesCheckbox.checked,
      autoIndex: elements.autoIndexCheckbox.checked,
      url: currentPage.url,
      content: currentPage.content,
      excerpt: currentPage.excerpt,
      author: currentPage.author,
      date: currentPage.date,
      domain: currentPage.domain,
    };

    // 验证
    if (!formData.title) {
      throw new Error('请输入标题');
    }

    if (!formData.content) {
      throw new Error('无法提取页面内容');
    }

    // 发送到桌面应用
    const response = await chrome.runtime.sendMessage({
      action: 'clipPage',
      data: formData,
    });

    if (response && response.success) {
      console.log('[Popup] 剪藏成功:', response.data);
      showSuccess();
    } else {
      throw new Error(response?.error || '剪藏失败');
    }
  } catch (error) {
    console.error('[Popup] 剪藏失败:', error);
    showError(error.message);
  } finally {
    // 恢复按钮状态
    elements.clipBtn.disabled = false;
    elements.btnText.style.display = 'inline';
    elements.btnLoading.style.display = 'none';
  }
}

// 启动
document.addEventListener('DOMContentLoaded', initialize);
