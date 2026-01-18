/**
 * 自动保存管理器
 * 管理文档和数据的自动保存
 */

const EventEmitter = require("events");

class AutoSaveManager extends EventEmitter {
  constructor(options = {}) {
    super();

    this.enabled = options.enabled !== false;
    this.interval = options.interval || 30000; // 30秒
    this.debounceDelay = options.debounceDelay || 2000; // 2秒
    this.maxRetries = options.maxRetries || 3;

    this.documents = new Map(); // documentId -> document data
    this.timers = new Map(); // documentId -> timer
    this.saveQueue = [];
    this.isSaving = false;

    console.log("[AutoSaveManager] Initialized");
  }

  /**
   * 注册文档
   */
  register(documentId, saveHandler, options = {}) {
    const document = {
      id: documentId,
      saveHandler,
      lastSaved: Date.now(),
      lastModified: Date.now(),
      isDirty: false,
      isSaving: false,
      retryCount: 0,
      options: {
        interval: options.interval || this.interval,
        debounceDelay: options.debounceDelay || this.debounceDelay,
        ...options,
      },
    };

    this.documents.set(documentId, document);

    // 启动自动保存定时器
    if (this.enabled) {
      this.startAutoSave(documentId);
    }

    console.log("[AutoSaveManager] Document registered:", documentId);

    return () => this.unregister(documentId);
  }

  /**
   * 注销文档
   */
  unregister(documentId) {
    this.stopAutoSave(documentId);
    this.documents.delete(documentId);
    console.log("[AutoSaveManager] Document unregistered:", documentId);
  }

  /**
   * 标记文档为已修改
   */
  markDirty(documentId) {
    const document = this.documents.get(documentId);
    if (!document) return;

    document.isDirty = true;
    document.lastModified = Date.now();

    // 触发防抖保存
    this.debounceSave(documentId);

    this.emit("dirty", documentId);
  }

  /**
   * 防抖保存
   */
  debounceSave(documentId) {
    const document = this.documents.get(documentId);
    if (!document) return;

    // 清除现有的防抖定时器
    if (this.timers.has(`debounce-${documentId}`)) {
      clearTimeout(this.timers.get(`debounce-${documentId}`));
    }

    // 设置新的防抖定时器
    const timer = setTimeout(() => {
      this.save(documentId);
    }, document.options.debounceDelay);

    this.timers.set(`debounce-${documentId}`, timer);
  }

  /**
   * 启动自动保存
   */
  startAutoSave(documentId) {
    const document = this.documents.get(documentId);
    if (!document) return;

    // 清除现有定时器
    this.stopAutoSave(documentId);

    // 设置新定时器
    const timer = setInterval(() => {
      if (document.isDirty && !document.isSaving) {
        this.save(documentId);
      }
    }, document.options.interval);

    this.timers.set(`autosave-${documentId}`, timer);

    console.log("[AutoSaveManager] Auto-save started:", documentId);
  }

  /**
   * 停止自动保存
   */
  stopAutoSave(documentId) {
    const debounceTimer = this.timers.get(`debounce-${documentId}`);
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      this.timers.delete(`debounce-${documentId}`);
    }

    const autosaveTimer = this.timers.get(`autosave-${documentId}`);
    if (autosaveTimer) {
      clearInterval(autosaveTimer);
      this.timers.delete(`autosave-${documentId}`);
    }

    console.log("[AutoSaveManager] Auto-save stopped:", documentId);
  }

  /**
   * 保存文档
   */
  async save(documentId, force = false) {
    const document = this.documents.get(documentId);
    if (!document) {
      console.warn("[AutoSaveManager] Document not found:", documentId);
      return { success: false, error: "Document not found" };
    }

    // 如果不是强制保存且文档未修改，跳过
    if (!force && !document.isDirty) {
      return { success: true, skipped: true };
    }

    // 如果正在保存，加入队列
    if (document.isSaving) {
      if (!this.saveQueue.includes(documentId)) {
        this.saveQueue.push(documentId);
      }
      return { success: true, queued: true };
    }

    document.isSaving = true;
    this.emit("saving", documentId);

    try {
      // 调用保存处理器
      await document.saveHandler();

      // 保存成功
      document.isDirty = false;
      document.lastSaved = Date.now();
      document.retryCount = 0;
      document.isSaving = false;

      this.emit("saved", documentId);

      console.log("[AutoSaveManager] Document saved:", documentId);

      // 处理队列中的下一个保存
      this.processQueue();

      return { success: true };
    } catch (error) {
      console.error("[AutoSaveManager] Save error:", documentId, error);

      document.isSaving = false;
      document.retryCount++;

      this.emit("error", documentId, error);

      // 重试
      if (document.retryCount < this.maxRetries) {
        console.log(
          "[AutoSaveManager] Retrying save:",
          documentId,
          `(${document.retryCount}/${this.maxRetries})`,
        );
        setTimeout(() => {
          this.save(documentId, force);
        }, 1000 * document.retryCount); // 指数退避
      } else {
        this.emit("failed", documentId, error);
      }

      return { success: false, error: error.message };
    }
  }

  /**
   * 处理保存队列
   */
  async processQueue() {
    if (this.saveQueue.length === 0) return;

    const documentId = this.saveQueue.shift();
    await this.save(documentId);
  }

  /**
   * 保存所有文档
   */
  async saveAll() {
    const results = [];

    for (const [documentId, document] of this.documents) {
      if (document.isDirty) {
        const result = await this.save(documentId, true);
        results.push({ documentId, ...result });
      }
    }

    return results;
  }

  /**
   * 启用自动保存
   */
  enable() {
    this.enabled = true;

    for (const documentId of this.documents.keys()) {
      this.startAutoSave(documentId);
    }

    console.log("[AutoSaveManager] Auto-save enabled");
  }

  /**
   * 禁用自动保存
   */
  disable() {
    this.enabled = false;

    for (const documentId of this.documents.keys()) {
      this.stopAutoSave(documentId);
    }

    console.log("[AutoSaveManager] Auto-save disabled");
  }

  /**
   * 获取文档状态
   */
  getStatus(documentId) {
    const document = this.documents.get(documentId);
    if (!document) return null;

    return {
      id: document.id,
      isDirty: document.isDirty,
      isSaving: document.isSaving,
      lastSaved: document.lastSaved,
      lastModified: document.lastModified,
      retryCount: document.retryCount,
    };
  }

  /**
   * 获取所有文档状态
   */
  getAllStatus() {
    const statuses = [];

    for (const documentId of this.documents.keys()) {
      statuses.push(this.getStatus(documentId));
    }

    return statuses;
  }

  /**
   * 获取统计信息
   */
  getStatistics() {
    let dirtyCount = 0;
    let savingCount = 0;

    for (const document of this.documents.values()) {
      if (document.isDirty) dirtyCount++;
      if (document.isSaving) savingCount++;
    }

    return {
      total: this.documents.size,
      dirty: dirtyCount,
      saving: savingCount,
      queued: this.saveQueue.length,
    };
  }

  /**
   * 销毁管理器
   */
  destroy() {
    // 停止所有定时器
    for (const documentId of this.documents.keys()) {
      this.stopAutoSave(documentId);
    }

    // 清空数据
    this.documents.clear();
    this.timers.clear();
    this.saveQueue = [];

    console.log("[AutoSaveManager] Destroyed");
  }
}

// 创建全局实例
let autoSaveManager = null;

function getAutoSaveManager(options) {
  if (!autoSaveManager) {
    autoSaveManager = new AutoSaveManager(options);
  }
  return autoSaveManager;
}

module.exports = { AutoSaveManager, getAutoSaveManager };
