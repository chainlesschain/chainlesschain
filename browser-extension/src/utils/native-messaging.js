/**
 * Native Messaging - 与桌面应用通信
 *
 * 使用Chrome Native Messaging API与ChainlessChain桌面应用通信
 */

export class NativeMessaging {
  constructor() {
    this.hostName = 'com.chainlesschain.native';
    this.port = null;
    this.connected = false;
    this.messageQueue = [];
    this.responseCallbacks = new Map();
    this.messageId = 0;
  }

  /**
   * 连接到原生应用
   */
  connect() {
    if (this.connected) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      try {
        // 连接到原生消息主机
        this.port = chrome.runtime.connectNative(this.hostName);

        // 监听消息
        this.port.onMessage.addListener((message) => {
          this.handleMessage(message);
        });

        // 监听断开连接
        this.port.onDisconnect.addListener(() => {
          console.log('Native messaging disconnected');
          this.connected = false;

          const error = chrome.runtime.lastError;
          if (error) {
            console.error('Disconnect error:', error);
          }

          // 清理回调
          this.responseCallbacks.forEach((callback) => {
            callback.reject(new Error('Connection closed'));
          });
          this.responseCallbacks.clear();
        });

        this.connected = true;
        console.log('Native messaging connected');

        // 发送队列中的消息
        this.flushMessageQueue();

        resolve();
      } catch (error) {
        console.error('Failed to connect to native app:', error);
        reject(error);
      }
    });
  }

  /**
   * 断开连接
   */
  disconnect() {
    if (this.port) {
      this.port.disconnect();
      this.port = null;
      this.connected = false;
    }
  }

  /**
   * 发送消息到原生应用
   */
  async sendMessage(action, data = {}) {
    const messageId = ++this.messageId;
    const message = {
      id: messageId,
      action,
      data,
      timestamp: Date.now()
    };

    // 如果未连接，先连接
    if (!this.connected) {
      try {
        await this.connect();
      } catch (error) {
        throw new Error(`Failed to connect to native app: ${error.message}`);
      }
    }

    return new Promise((resolve, reject) => {
      // 保存回调
      this.responseCallbacks.set(messageId, { resolve, reject });

      // 发送消息
      try {
        this.port.postMessage(message);
      } catch (error) {
        this.responseCallbacks.delete(messageId);
        reject(error);
      }

      // 设置超时
      setTimeout(() => {
        if (this.responseCallbacks.has(messageId)) {
          this.responseCallbacks.delete(messageId);
          reject(new Error('Request timeout'));
        }
      }, 30000); // 30秒超时
    });
  }

  /**
   * 处理来自原生应用的消息
   */
  handleMessage(message) {
    console.log('Received message from native app:', message);

    const { id, success, data, error } = message;

    // 查找对应的回调
    const callback = this.responseCallbacks.get(id);
    if (callback) {
      this.responseCallbacks.delete(id);

      if (success) {
        callback.resolve(data);
      } else {
        callback.reject(new Error(error || 'Unknown error'));
      }
    }
  }

  /**
   * 刷新消息队列
   */
  flushMessageQueue() {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      this.port.postMessage(message);
    }
  }

  /**
   * 检查连接状态
   */
  async checkConnection() {
    try {
      await this.sendMessage('ping');
      return true;
    } catch (error) {
      console.error('Connection check failed:', error);
      return false;
    }
  }

  /**
   * 保存剪藏内容
   */
  async saveClip(clipData) {
    return await this.sendMessage('saveClip', clipData);
  }

  /**
   * 获取标签列表
   */
  async getTags() {
    return await this.sendMessage('getTags');
  }

  /**
   * 搜索知识库
   */
  async searchKnowledge(query) {
    return await this.sendMessage('searchKnowledge', { query });
  }

  /**
   * 获取最近的剪藏
   */
  async getRecentClips(limit = 10) {
    return await this.sendMessage('getRecentClips', { limit });
  }

  /**
   * 上传图片
   */
  async uploadImage(dataUrl) {
    return await this.sendMessage('uploadImage', { dataUrl });
  }
}
