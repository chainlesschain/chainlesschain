/**
 * Schedule Manager - 定时剪藏管理器
 */

export class ScheduleManager {
  constructor() {
    this.alarmName = 'chainlesschain-schedule';
    this.tasks = [];
  }

  /**
   * 启动定时任务
   */
  async start(intervalMinutes) {
    await chrome.alarms.create(this.alarmName, {
      periodInMinutes: intervalMinutes
    });

    // 监听alarm事件
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === this.alarmName) {
        this.executeScheduledClip();
      }
    });
  }

  /**
   * 停止定时任务
   */
  async stop() {
    await chrome.alarms.clear(this.alarmName);
  }

  /**
   * 执行定时剪藏
   */
  async executeScheduledClip() {
    const settings = await chrome.storage.sync.get({
      scheduleOnlyActive: true
    });

    if (settings.scheduleOnlyActive) {
      // 只剪藏活动标签页
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        await this.clipTab(tab);
      }
    } else {
      // 剪藏所有标签页
      const tabs = await chrome.tabs.query({ currentWindow: true });
      for (const tab of tabs) {
        await this.clipTab(tab);
      }
    }
  }

  /**
   * 剪藏标签页
   */
  async clipTab(tab) {
    await chrome.runtime.sendMessage({
      action: 'executeCommand',
      command: 'clip-page',
      tabId: tab.id
    });
  }

  /**
   * 获取任务列表
   */
  async getTasks() {
    const alarms = await chrome.alarms.getAll();
    return alarms.filter(alarm => alarm.name.startsWith('chainlesschain-'));
  }
}

/**
 * Sync Manager - 云同步管理器
 */

export class SyncManager {
  constructor() {
    this.syncKey = 'chainlesschain-sync';
  }

  /**
   * 同步数据
   */
  async sync() {
    const settings = await chrome.storage.sync.get({
      enableSync: false,
      syncHistory: true,
      syncSettings: true,
      syncTags: true
    });

    if (!settings.enableSync) {
      throw new Error('云同步未启用');
    }

    const syncData = {};

    // 同步历史
    if (settings.syncHistory) {
      const { history = [] } = await chrome.storage.local.get('history');
      syncData.history = history;
    }

    // 同步设置
    if (settings.syncSettings) {
      const allSettings = await chrome.storage.sync.get();
      syncData.settings = allSettings;
    }

    // 同步标签
    if (settings.syncTags) {
      const { tags = [] } = await chrome.storage.local.get('tags');
      syncData.tags = tags;
    }

    // 保存到chrome.storage.sync
    await chrome.storage.sync.set({
      [this.syncKey]: {
        data: syncData,
        timestamp: Date.now()
      }
    });

    return syncData;
  }

  /**
   * 从云端恢复数据
   */
  async restore() {
    const result = await chrome.storage.sync.get(this.syncKey);
    const syncData = result[this.syncKey];

    if (!syncData) {
      throw new Error('没有可恢复的数据');
    }

    // 恢复历史
    if (syncData.data.history) {
      await chrome.storage.local.set({ history: syncData.data.history });
    }

    // 恢复设置
    if (syncData.data.settings) {
      await chrome.storage.sync.set(syncData.data.settings);
    }

    // 恢复标签
    if (syncData.data.tags) {
      await chrome.storage.local.set({ tags: syncData.data.tags });
    }

    return syncData;
  }
}

/**
 * Tag Manager - 标签管理器
 */

export class TagManager {
  constructor() {
    this.tagsKey = 'tags';
  }

  /**
   * 获取所有标签
   */
  async getAllTags() {
    const { tags = [] } = await chrome.storage.local.get(this.tagsKey);
    return tags;
  }

  /**
   * 创建标签
   */
  async createTag(name, color = '#1890ff') {
    const tags = await this.getAllTags();

    const newTag = {
      id: Date.now().toString(),
      name,
      color,
      count: 0,
      created_at: Date.now()
    };

    tags.push(newTag);
    await chrome.storage.local.set({ tags });

    return newTag;
  }

  /**
   * 更新标签
   */
  async updateTag(id, updates) {
    const tags = await this.getAllTags();
    const index = tags.findIndex(t => t.id === id);

    if (index !== -1) {
      tags[index] = { ...tags[index], ...updates };
      await chrome.storage.local.set({ tags });
      return tags[index];
    }

    return null;
  }

  /**
   * 删除标签
   */
  async deleteTag(id) {
    const tags = await this.getAllTags();
    const filtered = tags.filter(t => t.id !== id);
    await chrome.storage.local.set({ tags: filtered });
  }

  /**
   * 搜索标签
   */
  async searchTags(query) {
    const tags = await this.getAllTags();
    const lowerQuery = query.toLowerCase();

    return tags.filter(tag =>
      tag.name.toLowerCase().includes(lowerQuery)
    );
  }
}

/**
 * Search Manager - 搜索管理器
 */

export class SearchManager {
  /**
   * 搜索剪藏内容
   */
  async search(query) {
    const { history = [] } = await chrome.storage.local.get('history');
    const settings = await chrome.storage.sync.get({
      searchInTitle: true,
      searchInContent: true,
      searchInTags: true
    });

    const lowerQuery = query.toLowerCase();
    const results = [];

    for (const item of history) {
      let match = false;

      // 搜索标题
      if (settings.searchInTitle && item.title) {
        if (item.title.toLowerCase().includes(lowerQuery)) {
          match = true;
        }
      }

      // 搜索内容
      if (settings.searchInContent && item.content) {
        if (item.content.toLowerCase().includes(lowerQuery)) {
          match = true;
        }
      }

      // 搜索标签
      if (settings.searchInTags && item.tags) {
        if (item.tags.some(tag => tag.toLowerCase().includes(lowerQuery))) {
          match = true;
        }
      }

      if (match) {
        results.push(item);
      }
    }

    return results;
  }

  /**
   * 高级搜索
   */
  async advancedSearch(options) {
    const { history = [] } = await chrome.storage.local.get('history');
    let results = history;

    // 按类型过滤
    if (options.type) {
      results = results.filter(item => item.type === options.type);
    }

    // 按日期范围过滤
    if (options.startDate) {
      results = results.filter(item => item.timestamp >= options.startDate);
    }

    if (options.endDate) {
      results = results.filter(item => item.timestamp <= options.endDate);
    }

    // 按标签过滤
    if (options.tags && options.tags.length > 0) {
      results = results.filter(item =>
        item.tags && item.tags.some(tag => options.tags.includes(tag))
      );
    }

    // 文本搜索
    if (options.query) {
      const lowerQuery = options.query.toLowerCase();
      results = results.filter(item =>
        (item.title && item.title.toLowerCase().includes(lowerQuery)) ||
        (item.content && item.content.toLowerCase().includes(lowerQuery))
      );
    }

    return results;
  }
}

/**
 * Export Manager - 导出管理器
 */

export class ExportManager {
  /**
   * 导出数据
   */
  async export(format, options = {}) {
    const { history = [] } = await chrome.storage.local.get('history');
    let data = history;

    // 应用过滤选项
    if (options.timeRange) {
      data = this.filterByTimeRange(data, options.timeRange);
    }

    // 根据格式导出
    switch (format) {
      case 'markdown':
        return this.exportMarkdown(data, options);
      case 'html':
        return this.exportHTML(data, options);
      case 'json':
        return this.exportJSON(data, options);
      case 'pdf':
        return this.exportPDF(data, options);
      default:
        throw new Error('Unsupported format');
    }
  }

  /**
   * 按时间范围过滤
   */
  filterByTimeRange(data, range) {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    switch (range) {
      case 'today':
        return data.filter(item => item.timestamp >= now - day);
      case 'week':
        return data.filter(item => item.timestamp >= now - 7 * day);
      case 'month':
        return data.filter(item => item.timestamp >= now - 30 * day);
      default:
        return data;
    }
  }

  /**
   * 导出为Markdown
   */
  async exportMarkdown(data, options) {
    let markdown = '# ChainlessChain 剪藏导出\n\n';
    markdown += `导出时间: ${new Date().toLocaleString()}\n\n`;
    markdown += `总计: ${data.length} 条剪藏\n\n---\n\n`;

    for (const item of data) {
      markdown += `## ${item.title}\n\n`;
      markdown += `- **URL**: ${item.url}\n`;
      markdown += `- **时间**: ${new Date(item.timestamp).toLocaleString()}\n`;
      markdown += `- **类型**: ${item.type}\n\n`;

      if (item.content) {
        markdown += `${item.content}\n\n`;
      }

      markdown += '---\n\n';
    }

    this.downloadFile('chainlesschain-export.md', markdown, 'text/markdown');
  }

  /**
   * 导出为HTML
   */
  async exportHTML(data, options) {
    let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>ChainlessChain 剪藏导出</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    .clip { margin-bottom: 40px; padding: 20px; border: 1px solid #ddd; border-radius: 8px; }
    .clip-title { font-size: 24px; font-weight: bold; margin-bottom: 10px; }
    .clip-meta { color: #666; margin-bottom: 15px; }
    .clip-content { line-height: 1.6; }
  </style>
</head>
<body>
  <h1>ChainlessChain 剪藏导出</h1>
  <p>导出时间: ${new Date().toLocaleString()}</p>
  <p>总计: ${data.length} 条剪藏</p>
  <hr>
`;

    for (const item of data) {
      html += `
  <div class="clip">
    <div class="clip-title">${this.escapeHtml(item.title)}</div>
    <div class="clip-meta">
      <a href="${item.url}" target="_blank">${item.url}</a><br>
      时间: ${new Date(item.timestamp).toLocaleString()}<br>
      类型: ${item.type}
    </div>
    <div class="clip-content">${this.escapeHtml(item.content || '')}</div>
  </div>
`;
    }

    html += `
</body>
</html>
`;

    this.downloadFile('chainlesschain-export.html', html, 'text/html');
  }

  /**
   * 导出为JSON
   */
  async exportJSON(data, options) {
    const json = JSON.stringify({
      exported_at: new Date().toISOString(),
      total: data.length,
      clips: data
    }, null, 2);

    this.downloadFile('chainlesschain-export.json', json, 'application/json');
  }

  /**
   * 导出为PDF（简化版，实际需要使用PDF库）
   */
  async exportPDF(data, options) {
    // PDF导出需要使用专门的库，这里提供一个简化的实现
    // 实际应用中可以使用jsPDF等库
    alert('PDF导出功能需要额外的库支持，请使用HTML或Markdown格式导出后转换为PDF');
  }

  /**
   * 下载文件
   */
  downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);

    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    });
  }

  /**
   * 转义HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
