/**
 * ContextMemory - 上下文记忆
 *
 * 跨会话保持页面状态和元素信息：
 * - 页面快照存储
 * - 元素位置记忆
 * - 操作序列记录
 * - 智能上下文恢复
 *
 * @module browser/actions/context-memory
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { EventEmitter } = require('events');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * 记忆类型
 */
const MemoryType = {
  PAGE_STATE: 'page_state',
  ELEMENT_LOCATION: 'element_location',
  OPERATION_SEQUENCE: 'operation_sequence',
  FORM_DATA: 'form_data',
  SESSION_CONTEXT: 'session_context'
};

/**
 * 持久化策略
 */
const PersistenceStrategy = {
  MEMORY_ONLY: 'memory',     // 仅内存
  SESSION: 'session',         // 会话级持久化
  PERSISTENT: 'persistent'    // 持久化到磁盘
};

class ContextMemory extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      persistenceStrategy: config.persistenceStrategy || PersistenceStrategy.SESSION,
      memoryDir: config.memoryDir || path.join(process.cwd(), '.chainlesschain', 'memory', 'browser'),
      maxMemorySize: config.maxMemorySize || 10000,
      maxPageStates: config.maxPageStates || 100,
      elementTTL: config.elementTTL || 3600000, // 1 hour
      autoSave: config.autoSave !== false,
      saveInterval: config.saveInterval || 60000, // 1 minute
      compressData: config.compressData || false,
      ...config
    };

    // 内存存储
    this.pageStates = new Map();        // URL/fingerprint -> page state
    this.elementLocations = new Map();  // element query -> location info
    this.operationSequences = new Map(); // context key -> operation list
    this.formData = new Map();          // form identifier -> saved data
    this.sessionContext = new Map();    // key -> value

    // 元数据
    this.metadata = {
      createdAt: Date.now(),
      lastModified: Date.now(),
      totalEntries: 0,
      version: '1.0'
    };

    // 初始化
    this._init();
  }

  /**
   * 初始化
   * @private
   */
  async _init() {
    if (this.config.persistenceStrategy === PersistenceStrategy.PERSISTENT) {
      await this._loadFromDisk().catch(err => {
        this.emit('loadError', { error: err.message });
      });

      if (this.config.autoSave && this.config.saveInterval > 0) {
        this._startAutoSave();
      }
    }
  }

  /**
   * 保存页面状态
   * @param {string} url - 页面 URL
   * @param {Object} state - 页面状态
   * @param {Object} options - 选项
   * @returns {Object}
   */
  savePageState(url, state, options = {}) {
    const fingerprint = options.fingerprint || this._generateFingerprint(url, state);
    const key = options.key || url;

    const entry = {
      url,
      fingerprint,
      state: {
        title: state.title,
        scrollPosition: state.scrollPosition,
        formValues: state.formValues,
        activeElement: state.activeElement,
        customData: state.customData
      },
      timestamp: Date.now(),
      ttl: options.ttl || 0,
      metadata: options.metadata || {}
    };

    // 检查大小限制
    if (this.pageStates.size >= this.config.maxPageStates) {
      this._evictOldestPageState();
    }

    this.pageStates.set(key, entry);
    this._updateMetadata();

    this.emit('pageStateSaved', { key, fingerprint });

    return {
      success: true,
      key,
      fingerprint
    };
  }

  /**
   * 获取页面状态
   * @param {string} key - 键（URL 或自定义键）
   * @returns {Object}
   */
  getPageState(key) {
    const entry = this.pageStates.get(key);

    if (!entry) {
      return null;
    }

    // 检查 TTL
    if (entry.ttl > 0 && Date.now() - entry.timestamp > entry.ttl) {
      this.pageStates.delete(key);
      return null;
    }

    return entry;
  }

  /**
   * 保存元素位置
   * @param {Object} query - 元素查询
   * @param {Object} location - 位置信息
   * @param {Object} context - 上下文（URL, 页面指纹等）
   * @returns {Object}
   */
  saveElementLocation(query, location, context = {}) {
    const key = this._generateElementKey(query, context);

    const entry = {
      query,
      location: {
        bounds: location.bounds,
        selector: location.selector,
        attributes: location.attributes,
        role: location.role
      },
      context: {
        url: context.url,
        fingerprint: context.fingerprint,
        viewport: context.viewport
      },
      timestamp: Date.now(),
      hits: 0
    };

    this.elementLocations.set(key, entry);
    this._updateMetadata();

    this.emit('elementLocationSaved', { key, query });

    return { success: true, key };
  }

  /**
   * 获取元素位置
   * @param {Object} query - 元素查询
   * @param {Object} context - 上下文
   * @returns {Object}
   */
  getElementLocation(query, context = {}) {
    const key = this._generateElementKey(query, context);
    const entry = this.elementLocations.get(key);

    if (!entry) {
      return null;
    }

    // 检查 TTL
    if (Date.now() - entry.timestamp > this.config.elementTTL) {
      this.elementLocations.delete(key);
      return null;
    }

    // 更新命中次数
    entry.hits++;

    return entry;
  }

  /**
   * 记录操作序列
   * @param {string} contextKey - 上下文键
   * @param {Object} operation - 操作
   * @returns {Object}
   */
  recordOperation(contextKey, operation) {
    if (!this.operationSequences.has(contextKey)) {
      this.operationSequences.set(contextKey, {
        operations: [],
        createdAt: Date.now(),
        lastModified: Date.now()
      });
    }

    const sequence = this.operationSequences.get(contextKey);

    sequence.operations.push({
      ...operation,
      timestamp: Date.now()
    });

    sequence.lastModified = Date.now();

    // 限制序列长度
    if (sequence.operations.length > 1000) {
      sequence.operations = sequence.operations.slice(-500);
    }

    this._updateMetadata();

    return {
      success: true,
      operationCount: sequence.operations.length
    };
  }

  /**
   * 获取操作序列
   * @param {string} contextKey - 上下文键
   * @param {Object} options - 选项
   * @returns {Array}
   */
  getOperationSequence(contextKey, options = {}) {
    const sequence = this.operationSequences.get(contextKey);

    if (!sequence) {
      return [];
    }

    let operations = sequence.operations;

    if (options.limit) {
      operations = operations.slice(-options.limit);
    }

    if (options.type) {
      operations = operations.filter(op => op.type === options.type);
    }

    if (options.since) {
      operations = operations.filter(op => op.timestamp >= options.since);
    }

    return operations;
  }

  /**
   * 保存表单数据
   * @param {string} formId - 表单标识
   * @param {Object} data - 表单数据
   * @param {Object} context - 上下文
   * @returns {Object}
   */
  saveFormData(formId, data, context = {}) {
    const key = context.url ? `${context.url}#${formId}` : formId;

    this.formData.set(key, {
      formId,
      data: { ...data },
      context: {
        url: context.url,
        timestamp: Date.now()
      },
      timestamp: Date.now()
    });

    this._updateMetadata();

    this.emit('formDataSaved', { key, formId });

    return { success: true, key };
  }

  /**
   * 获取表单数据
   * @param {string} formId - 表单标识
   * @param {Object} context - 上下文
   * @returns {Object}
   */
  getFormData(formId, context = {}) {
    const key = context.url ? `${context.url}#${formId}` : formId;
    return this.formData.get(key);
  }

  /**
   * 设置会话上下文
   * @param {string} key - 键
   * @param {*} value - 值
   */
  setSessionContext(key, value) {
    this.sessionContext.set(key, {
      value,
      timestamp: Date.now()
    });
    this._updateMetadata();
  }

  /**
   * 获取会话上下文
   * @param {string} key - 键
   * @returns {*}
   */
  getSessionContext(key) {
    const entry = this.sessionContext.get(key);
    return entry ? entry.value : undefined;
  }

  /**
   * 生成页面指纹
   * @private
   */
  _generateFingerprint(url, state) {
    const data = JSON.stringify({
      url,
      title: state.title,
      structure: state.structure // DOM 结构摘要
    });
    return crypto.createHash('md5').update(data).digest('hex').substring(0, 12);
  }

  /**
   * 生成元素键
   * @private
   */
  _generateElementKey(query, context) {
    const data = JSON.stringify({
      query: typeof query === 'string' ? { text: query } : query,
      url: context.url,
      fingerprint: context.fingerprint
    });
    return crypto.createHash('md5').update(data).digest('hex');
  }

  /**
   * 驱逐最老的页面状态
   * @private
   */
  _evictOldestPageState() {
    let oldestKey = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.pageStates) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.pageStates.delete(oldestKey);
    }
  }

  /**
   * 更新元数据
   * @private
   */
  _updateMetadata() {
    this.metadata.lastModified = Date.now();
    this.metadata.totalEntries =
      this.pageStates.size +
      this.elementLocations.size +
      this.operationSequences.size +
      this.formData.size +
      this.sessionContext.size;
  }

  /**
   * 开始自动保存
   * @private
   */
  _startAutoSave() {
    this.saveTimer = setInterval(() => {
      this._saveToDisk().catch(err => {
        this.emit('saveError', { error: err.message });
      });
    }, this.config.saveInterval);
  }

  /**
   * 保存到磁盘
   * @private
   */
  async _saveToDisk() {
    if (this.config.persistenceStrategy !== PersistenceStrategy.PERSISTENT) {
      return;
    }

    await fs.mkdir(this.config.memoryDir, { recursive: true });

    const data = {
      metadata: this.metadata,
      pageStates: Array.from(this.pageStates.entries()),
      elementLocations: Array.from(this.elementLocations.entries()),
      operationSequences: Array.from(this.operationSequences.entries()),
      formData: Array.from(this.formData.entries()),
      sessionContext: Array.from(this.sessionContext.entries())
    };

    const filepath = path.join(this.config.memoryDir, 'context-memory.json');
    await fs.writeFile(filepath, JSON.stringify(data, null, 2));

    this.emit('saved', { filepath });
  }

  /**
   * 从磁盘加载
   * @private
   */
  async _loadFromDisk() {
    const filepath = path.join(this.config.memoryDir, 'context-memory.json');

    try {
      const content = await fs.readFile(filepath, 'utf-8');
      const data = JSON.parse(content);

      if (data.pageStates) {
        this.pageStates = new Map(data.pageStates);
      }
      if (data.elementLocations) {
        this.elementLocations = new Map(data.elementLocations);
      }
      if (data.operationSequences) {
        this.operationSequences = new Map(data.operationSequences);
      }
      if (data.formData) {
        this.formData = new Map(data.formData);
      }
      if (data.sessionContext) {
        this.sessionContext = new Map(data.sessionContext);
      }
      if (data.metadata) {
        this.metadata = { ...this.metadata, ...data.metadata };
      }

      this.emit('loaded', { filepath });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      // 文件不存在是正常的
    }
  }

  /**
   * 查找相似页面状态
   * @param {string} url - URL
   * @param {Object} options - 选项
   * @returns {Array}
   */
  findSimilarPageStates(url, options = {}) {
    const results = [];
    const urlBase = new URL(url).origin + new URL(url).pathname;

    for (const [key, entry] of this.pageStates) {
      try {
        const entryBase = new URL(entry.url).origin + new URL(entry.url).pathname;
        if (entryBase === urlBase) {
          results.push(entry);
        }
      } catch (e) {
        // URL 解析失败，跳过
      }
    }

    return results.sort((a, b) => b.timestamp - a.timestamp).slice(0, options.limit || 10);
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      pageStates: this.pageStates.size,
      elementLocations: this.elementLocations.size,
      operationSequences: this.operationSequences.size,
      formData: this.formData.size,
      sessionContext: this.sessionContext.size,
      metadata: this.metadata
    };
  }

  /**
   * 清除过期条目
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    // 清理过期的元素位置
    for (const [key, entry] of this.elementLocations) {
      if (now - entry.timestamp > this.config.elementTTL) {
        this.elementLocations.delete(key);
        cleaned++;
      }
    }

    // 清理过期的页面状态
    for (const [key, entry] of this.pageStates) {
      if (entry.ttl > 0 && now - entry.timestamp > entry.ttl) {
        this.pageStates.delete(key);
        cleaned++;
      }
    }

    this._updateMetadata();
    this.emit('cleaned', { count: cleaned });

    return { cleaned };
  }

  /**
   * 清除所有数据
   */
  clear() {
    this.pageStates.clear();
    this.elementLocations.clear();
    this.operationSequences.clear();
    this.formData.clear();
    this.sessionContext.clear();
    this._updateMetadata();

    this.emit('cleared');
  }

  /**
   * 停止
   */
  stop() {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }

    if (this.config.persistenceStrategy === PersistenceStrategy.PERSISTENT) {
      this._saveToDisk().catch(() => {});
    }
  }

  /**
   * 导出数据
   * @returns {Object}
   */
  export() {
    return {
      metadata: this.metadata,
      pageStates: Array.from(this.pageStates.entries()),
      elementLocations: Array.from(this.elementLocations.entries()),
      operationSequences: Array.from(this.operationSequences.entries()),
      formData: Array.from(this.formData.entries())
    };
  }

  /**
   * 导入数据
   * @param {Object} data - 导入的数据
   */
  import(data) {
    if (data.pageStates) {
      for (const [key, entry] of data.pageStates) {
        this.pageStates.set(key, entry);
      }
    }
    if (data.elementLocations) {
      for (const [key, entry] of data.elementLocations) {
        this.elementLocations.set(key, entry);
      }
    }
    if (data.operationSequences) {
      for (const [key, entry] of data.operationSequences) {
        this.operationSequences.set(key, entry);
      }
    }
    if (data.formData) {
      for (const [key, entry] of data.formData) {
        this.formData.set(key, entry);
      }
    }
    this._updateMetadata();

    this.emit('imported', { count: this.metadata.totalEntries });
  }
}

// 单例
let memoryInstance = null;

function getContextMemory(config) {
  if (!memoryInstance) {
    memoryInstance = new ContextMemory(config);
  }
  return memoryInstance;
}

module.exports = {
  ContextMemory,
  MemoryType,
  PersistenceStrategy,
  getContextMemory
};
