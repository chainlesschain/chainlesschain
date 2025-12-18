/**
 * ChainlessChain Web Clipper - Background Script
 * 后台服务 worker，负责与 Native Messaging Host 通信
 */

console.log('[Background] ChainlessChain Web Clipper 后台服务已启动');

// Native Messaging Host 名称
const NATIVE_HOST_NAME = 'com.chainlesschain.clipper';

// 连接状态
let isConnected = false;
let nativePort = null;

/**
 * 连接到 Native Messaging Host
 */
function connectToNativeHost() {
  try {
    console.log('[Background] 连接到 Native Messaging Host:', NATIVE_HOST_NAME);

    nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);

    nativePort.onMessage.addListener((message) => {
      console.log('[Background] 收到消息:', message);
      handleNativeMessage(message);
    });

    nativePort.onDisconnect.addListener(() => {
      console.log('[Background] Native Messaging 连接断开');
      isConnected = false;
      nativePort = null;

      if (chrome.runtime.lastError) {
        console.error('[Background] 连接错误:', chrome.runtime.lastError.message);
      }
    });

    isConnected = true;
    console.log('[Background] 连接成功');

  } catch (error) {
    console.error('[Background] 连接失败:', error);
    isConnected = false;
    nativePort = null;
  }
}

/**
 * 处理来自 Native Host 的消息
 */
function handleNativeMessage(message) {
  console.log('[Background] 处理消息:', message);

  // 可以根据消息类型进行不同的处理
  if (message.type === 'ping') {
    console.log('[Background] 收到 ping');
  }

  if (message.type === 'clipResult') {
    console.log('[Background] 剪藏结果:', message.data);
    // 可以通知 popup
  }
}

/**
 * 发送消息到 Native Host
 */
async function sendToNativeHost(message) {
  return new Promise((resolve, reject) => {
    if (!isConnected || !nativePort) {
      // 尝试重新连接
      connectToNativeHost();

      if (!isConnected || !nativePort) {
        reject(new Error('未连接到 ChainlessChain'));
        return;
      }
    }

    // 设置超时
    const timeout = setTimeout(() => {
      reject(new Error('请求超时'));
    }, 10000);

    // 发送消息
    try {
      nativePort.postMessage(message);

      // 等待响应 (简化版本，实际应该基于消息 ID 匹配)
      const listener = (response) => {
        clearTimeout(timeout);
        nativePort.onMessage.removeListener(listener);

        if (response.success) {
          resolve(response);
        } else {
          reject(new Error(response.error || '操作失败'));
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
 * 检查连接
 */
async function checkConnection() {
  try {
    if (!isConnected || !nativePort) {
      connectToNativeHost();
    }

    if (!isConnected || !nativePort) {
      return { success: false, error: '未连接' };
    }

    // 发送 ping 消息
    const response = await sendToNativeHost({
      action: 'ping',
    });

    return { success: true };
  } catch (error) {
    console.error('[Background] 检查连接失败:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 剪藏页面
 */
async function clipPage(data) {
  try {
    console.log('[Background] 剪藏页面:', data);

    const response = await sendToNativeHost({
      action: 'clipPage',
      data: data,
    });

    console.log('[Background] 剪藏响应:', response);
    return response;

  } catch (error) {
    console.error('[Background] 剪藏失败:', error);
    throw error;
  }
}

/**
 * 消息监听器
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Background] 收到消息:', request);

  if (request.action === 'checkConnection') {
    checkConnection()
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // 异步响应
  }

  if (request.action === 'clipPage') {
    clipPage(request.data)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // 异步响应
  }

  return false;
});

/**
 * 扩展安装/更新时
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Background] 扩展已安装/更新:', details.reason);

  if (details.reason === 'install') {
    console.log('[Background] 首次安装');
    // 可以打开欢迎页面
  }

  if (details.reason === 'update') {
    console.log('[Background] 更新到版本:', chrome.runtime.getManifest().version);
  }

  // 尝试连接
  connectToNativeHost();
});

/**
 * 扩展启动时
 */
chrome.runtime.onStartup.addListener(() => {
  console.log('[Background] 扩展启动');
  connectToNativeHost();
});

// 初始化
connectToNativeHost();
