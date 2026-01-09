/**
 * 剪贴板历史管理器
 * 管理剪贴板历史记录
 */

const { clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class ClipboardManager {
  constructor(options = {}) {
    this.maxHistory = options.maxHistory || 100;
    this.checkInterval = options.checkInterval || 1000; // 1秒检查一次
    this.dataPath = options.dataPath || path.join(app.getPath('userData'), 'clipboard-history.json');
    this.history = [];
    this.lastText = '';
    this.isMonitoring = false;
    this.monitorTimer = null;

    // 加载历史记录
    this.loadHistory();
  }

  /**
   * 开始监控剪贴板
   */
  startMonitoring() {
    if (this.isMonitoring) return;

    this.isMonitoring = true;
    this.lastText = clipboard.readText();

    this.monitorTimer = setInterval(() => {
      this.checkClipboard();
    }, this.checkInterval);

    console.log('[ClipboardManager] Monitoring started');
  }

  /**
   * 停止监控剪贴板
   */
  stopMonitoring() {
    if (!this.isMonitoring) return;

    this.isMonitoring = false;

    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }

    console.log('[ClipboardManager] Monitoring stopped');
  }

  /**
   * 检查剪贴板
   */
  checkClipboard() {
    try {
      const currentText = clipboard.readText();

      // 如果内容有变化且不为空
      if (currentText && currentText !== this.lastText) {
        this.addToHistory({
          type: 'text',
          content: currentText,
          timestamp: Date.now(),
        });

        this.lastText = currentText;
      }
    } catch (error) {
      console.error('[ClipboardManager] Check clipboard error:', error);
    }
  }

  /**
   * 添加到历史记录
   */
  addToHistory(item) {
    // 检查是否已存在相同内容
    const existingIndex = this.history.findIndex(
      h => h.type === item.type && h.content === item.content
    );

    if (existingIndex > -1) {
      // 如果已存在，移除旧的
      this.history.splice(existingIndex, 1);
    }

    // 添加到开头
    this.history.unshift(item);

    // 限制历史记录数量
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(0, this.maxHistory);
    }

    // 保存到文件
    this.saveHistory();

    console.log('[ClipboardManager] Added to history, total:', this.history.length);
  }

  /**
   * 获取历史记录
   */
  getHistory(limit = null) {
    if (limit) {
      return this.history.slice(0, limit);
    }
    return this.history;
  }

  /**
   * 搜索历史记录
   */
  searchHistory(query) {
    if (!query) return this.history;

    const lowerQuery = query.toLowerCase();
    return this.history.filter(item =>
      item.content.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * 复制历史项到剪贴板
   */
  copyToClipboard(index) {
    if (index < 0 || index >= this.history.length) {
      return false;
    }

    const item = this.history[index];

    try {
      if (item.type === 'text') {
        clipboard.writeText(item.content);
        this.lastText = item.content;

        // 将该项移到最前面
        this.history.splice(index, 1);
        this.history.unshift(item);

        console.log('[ClipboardManager] Copied to clipboard:', index);
        return true;
      }
    } catch (error) {
      console.error('[ClipboardManager] Copy to clipboard error:', error);
      return false;
    }

    return false;
  }

  /**
   * 删除历史项
   */
  deleteHistoryItem(index) {
    if (index < 0 || index >= this.history.length) {
      return false;
    }

    this.history.splice(index, 1);
    this.saveHistory();

    console.log('[ClipboardManager] Deleted history item:', index);
    return true;
  }

  /**
   * 清空历史记录
   */
  clearHistory() {
    this.history = [];
    this.saveHistory();
    console.log('[ClipboardManager] History cleared');
  }

  /**
   * 加载历史记录
   */
  loadHistory() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const content = fs.readFileSync(this.dataPath, 'utf8');
        this.history = JSON.parse(content);
        console.log('[ClipboardManager] History loaded, count:', this.history.length);
      }
    } catch (error) {
      console.error('[ClipboardManager] Load history error:', error);
      this.history = [];
    }
  }

  /**
   * 保存历史记录
   */
  saveHistory() {
    try {
      fs.writeFileSync(this.dataPath, JSON.stringify(this.history, null, 2));
    } catch (error) {
      console.error('[ClipboardManager] Save history error:', error);
    }
  }

  /**
   * 导出历史记录
   */
  exportHistory(outputPath) {
    try {
      const exportData = {
        history: this.history,
        exportTime: new Date().toISOString(),
        count: this.history.length,
      };

      fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
      console.log('[ClipboardManager] History exported to:', outputPath);
      return true;
    } catch (error) {
      console.error('[ClipboardManager] Export history error:', error);
      return false;
    }
  }

  /**
   * 获取统计信息
   */
  getStatistics() {
    return {
      total: this.history.length,
      byType: this.history.reduce((acc, item) => {
        acc[item.type] = (acc[item.type] || 0) + 1;
        return acc;
      }, {}),
      oldest: this.history.length > 0 ? this.history[this.history.length - 1].timestamp : null,
      newest: this.history.length > 0 ? this.history[0].timestamp : null,
    };
  }

  /**
   * 销毁管理器
   */
  destroy() {
    this.stopMonitoring();
    this.saveHistory();
  }
}

// 创建全局实例
let clipboardManager = null;

function getClipboardManager(options) {
  if (!clipboardManager) {
    clipboardManager = new ClipboardManager(options);
  }
  return clipboardManager;
}

module.exports = { ClipboardManager, getClipboardManager };
