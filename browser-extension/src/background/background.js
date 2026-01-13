/**
 * ChainlessChain Browser Extension - Background Service Worker
 *
 * 功能：
 * - 管理右键菜单
 * - 处理快捷键命令
 * - 与原生应用通信
 * - 管理扩展状态
 */

import { NativeMessaging } from '../utils/native-messaging.js';
import { ClipperService } from '../utils/clipper-service.js';

// 初始化原生消息通信
const nativeMessaging = new NativeMessaging();
const clipperService = new ClipperService(nativeMessaging);

// 扩展安装时初始化
chrome.runtime.onInstalled.addListener((details) => {
  console.log('ChainlessChain Extension installed:', details.reason);

  // 创建右键菜单
  createContextMenus();

  // 设置默认配置
  if (details.reason === 'install') {
    chrome.storage.sync.set({
      autoSave: true,
      defaultTags: ['web-clip'],
      captureImages: true,
      captureLinks: true,
      nativeAppPath: ''
    });
  }
});

/**
 * 创建右键菜单
 */
function createContextMenus() {
  // 清除现有菜单
  chrome.contextMenus.removeAll(() => {
    // 主菜单
    chrome.contextMenus.create({
      id: 'chainlesschain-main',
      title: 'ChainlessChain',
      contexts: ['all']
    });

    // 保存选中文本
    chrome.contextMenus.create({
      id: 'clip-selection',
      parentId: 'chainlesschain-main',
      title: '保存选中内容',
      contexts: ['selection']
    });

    // 保存整个页面
    chrome.contextMenus.create({
      id: 'clip-page',
      parentId: 'chainlesschain-main',
      title: '保存整个页面',
      contexts: ['page']
    });

    // 保存链接
    chrome.contextMenus.create({
      id: 'clip-link',
      parentId: 'chainlesschain-main',
      title: '保存链接',
      contexts: ['link']
    });

    // 保存图片
    chrome.contextMenus.create({
      id: 'clip-image',
      parentId: 'chainlesschain-main',
      title: '保存图片',
      contexts: ['image']
    });

    // 分隔符
    chrome.contextMenus.create({
      id: 'separator-1',
      parentId: 'chainlesschain-main',
      type: 'separator',
      contexts: ['all']
    });

    // 截图
    chrome.contextMenus.create({
      id: 'screenshot',
      parentId: 'chainlesschain-main',
      title: '截图保存',
      contexts: ['page']
    });

    // 设置
    chrome.contextMenus.create({
      id: 'open-options',
      parentId: 'chainlesschain-main',
      title: '设置',
      contexts: ['all']
    });
  });
}

/**
 * 处理右键菜单点击
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  console.log('Context menu clicked:', info.menuItemId);

  try {
    switch (info.menuItemId) {
      case 'clip-selection':
        await handleClipSelection(info, tab);
        break;

      case 'clip-page':
        await handleClipPage(info, tab);
        break;

      case 'clip-link':
        await handleClipLink(info, tab);
        break;

      case 'clip-image':
        await handleClipImage(info, tab);
        break;

      case 'screenshot':
        await handleScreenshot(info, tab);
        break;

      case 'open-options':
        chrome.runtime.openOptionsPage();
        break;
    }
  } catch (error) {
    console.error('Context menu action failed:', error);
    showNotification('操作失败', error.message, 'error');
  }
});

/**
 * 处理快捷键命令
 */
chrome.commands.onCommand.addListener(async (command) => {
  console.log('Command triggered:', command);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  try {
    switch (command) {
      case 'clip-selection':
        await handleClipSelection({}, tab);
        break;

      case 'clip-page':
        await handleClipPage({}, tab);
        break;

      case 'screenshot':
        await handleScreenshot({}, tab);
        break;
    }
  } catch (error) {
    console.error('Command execution failed:', error);
    showNotification('操作失败', error.message, 'error');
  }
});

/**
 * 处理保存选中内容
 */
async function handleClipSelection(info, tab) {
  const selectedText = info.selectionText || await getSelectedText(tab.id);

  if (!selectedText) {
    showNotification('提示', '请先选中要保存的内容', 'warning');
    return;
  }

  const clipData = {
    type: 'selection',
    content: selectedText,
    url: tab.url,
    title: tab.title,
    timestamp: Date.now()
  };

  await clipperService.saveClip(clipData);
  showNotification('成功', '选中内容已保存', 'success');
}

/**
 * 处理保存整个页面
 */
async function handleClipPage(info, tab) {
  // 注入内容脚本获取页面内容
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractPageContent
  });

  const pageContent = result.result;

  const clipData = {
    type: 'page',
    content: pageContent.content,
    html: pageContent.html,
    url: tab.url,
    title: tab.title,
    images: pageContent.images,
    links: pageContent.links,
    timestamp: Date.now()
  };

  await clipperService.saveClip(clipData);
  showNotification('成功', '页面已保存', 'success');
}

/**
 * 处理保存链接
 */
async function handleClipLink(info, tab) {
  const clipData = {
    type: 'link',
    url: info.linkUrl,
    text: info.linkText || info.linkUrl,
    sourceUrl: tab.url,
    sourceTitle: tab.title,
    timestamp: Date.now()
  };

  await clipperService.saveClip(clipData);
  showNotification('成功', '链接已保存', 'success');
}

/**
 * 处理保存图片
 */
async function handleClipImage(info, tab) {
  const clipData = {
    type: 'image',
    url: info.srcUrl,
    sourceUrl: tab.url,
    sourceTitle: tab.title,
    timestamp: Date.now()
  };

  await clipperService.saveClip(clipData);
  showNotification('成功', '图片已保存', 'success');
}

/**
 * 处理截图
 */
async function handleScreenshot(info, tab) {
  // 捕获可见区域
  const dataUrl = await chrome.tabs.captureVisibleTab(null, {
    format: 'png',
    quality: 100
  });

  const clipData = {
    type: 'screenshot',
    dataUrl: dataUrl,
    url: tab.url,
    title: tab.title,
    timestamp: Date.now()
  };

  await clipperService.saveClip(clipData);
  showNotification('成功', '截图已保存', 'success');
}

/**
 * 获取选中文本（通过内容脚本）
 */
async function getSelectedText(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.getSelection().toString()
  });
  return result.result;
}

/**
 * 提取页面内容（在页面上下文中执行）
 */
function extractPageContent() {
  // 获取主要内容
  const article = document.querySelector('article') ||
                  document.querySelector('main') ||
                  document.body;

  // 提取文本内容
  const content = article.innerText;

  // 提取HTML
  const html = article.innerHTML;

  // 提取图片
  const images = Array.from(article.querySelectorAll('img')).map(img => ({
    src: img.src,
    alt: img.alt,
    width: img.width,
    height: img.height
  }));

  // 提取链接
  const links = Array.from(article.querySelectorAll('a')).map(a => ({
    href: a.href,
    text: a.textContent.trim()
  }));

  return {
    content,
    html,
    images,
    links
  };
}

/**
 * 显示通知
 */
function showNotification(title, message, type = 'info') {
  const iconMap = {
    success: 'icons/icon48.png',
    error: 'icons/icon48.png',
    warning: 'icons/icon48.png',
    info: 'icons/icon48.png'
  };

  chrome.notifications.create({
    type: 'basic',
    iconUrl: iconMap[type],
    title: title,
    message: message,
    priority: 2
  });
}

/**
 * 处理来自内容脚本的消息
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received:', message);

  (async () => {
    try {
      switch (message.action) {
        case 'clip':
          await clipperService.saveClip(message.data);
          sendResponse({ success: true });
          break;

        case 'checkConnection':
          const connected = await nativeMessaging.checkConnection();
          sendResponse({ success: true, connected });
          break;

        case 'getConfig':
          const config = await chrome.storage.sync.get();
          sendResponse({ success: true, config });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Message handling failed:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true; // 保持消息通道开放
});

console.log('ChainlessChain Extension background service worker loaded');
