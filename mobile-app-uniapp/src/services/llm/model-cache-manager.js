/**
 * 模型缓存管理器 (移动端版本)
 *
 * 功能:
 * - 模型下载管理
 * - 模型缓存 (IndexedDB for H5)
 * - 下载进度跟踪
 * - 存储空间管理
 * - 模型列表管理
 *
 * 支持Web LLM模型缓存
 */

/**
 * 模型缓存管理器类
 */
class ModelCacheManager {
  constructor(config = {}) {
    this.config = {
      // 缓存数据库名称
      dbName: config.dbName || 'webllm_model_cache',

      // 模型存储大小限制 (GB)
      maxStorageSize: config.maxStorageSize || 10,

      // 下载超时时间 (ms)
      downloadTimeout: config.downloadTimeout || 300000,

      // 并发下载数
      maxConcurrentDownloads: config.maxConcurrentDownloads || 1,

      // Web LLM基础URL
      webllmBaseURL: config.webllmBaseURL || 'https://huggingface.co/mlc-ai',

      ...config
    }

    // 下载队列
    this.downloadQueue = []

    // 活跃下载
    this.activeDownloads = new Map()

    // 缓存的模型列表
    this.cachedModels = new Map()

    // 初始化状态
    this.isInitialized = false

    // 事件监听器
    this.listeners = new Map()

    // 统计
    this.stats = {
      totalModels: 0,
      totalSize: 0,
      downloads: 0,
      failures: 0
    }
  }

  /**
   * 初始化
   * @returns {Promise<Object>}
   */
  async initialize() {
    if (this.isInitialized) {
      return { success: true }
    }

    try {
      console.log('[ModelCache] 初始化模型缓存管理器...')

      // 加载已缓存的模型列表
      await this.loadCachedModels()

      this.isInitialized = true

      console.log('[ModelCache] ✅ 初始化成功')

      return {
        success: true,
        cachedModels: this.stats.totalModels,
        totalSize: this.formatSize(this.stats.totalSize)
      }
    } catch (error) {
      console.error('[ModelCache] 初始化失败:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * 加载已缓存的模型
   * @returns {Promise<void>}
   * @private
   */
  async loadCachedModels() {
    // #ifdef H5
    if (typeof indexedDB === 'undefined') {
      console.warn('[ModelCache] IndexedDB不可用')
      return
    }

    try {
      // Web LLM使用CacheStorage API
      if ('caches' in window) {
        const cacheNames = await caches.keys()
        const webllmCaches = cacheNames.filter(name => name.includes('webllm'))

        let totalSize = 0

        for (const cacheName of webllmCaches) {
          const cache = await caches.open(cacheName)
          const requests = await cache.keys()

          for (const request of requests) {
            const response = await cache.match(request)
            if (response) {
              const blob = await response.blob()
              totalSize += blob.size
            }
          }

          this.cachedModels.set(cacheName, {
            name: cacheName,
            cached: true,
            cacheTime: Date.now()
          })
        }

        this.stats.totalModels = webllmCaches.length
        this.stats.totalSize = totalSize

        console.log('[ModelCache] 已缓存模型:', this.stats.totalModels, '个')
        console.log('[ModelCache] 缓存大小:', this.formatSize(this.stats.totalSize))
      }
    } catch (error) {
      console.error('[ModelCache] 加载缓存模型失败:', error)
    }
    // #endif

    // #ifndef H5
    console.warn('[ModelCache] 非H5环境，模型缓存功能不可用')
    // #endif
  }

  /**
   * 获取可用模型列表
   * @returns {Array}
   */
  getAvailableModels() {
    // Web LLM官方支持的模型列表
    return [
      {
        id: 'Llama-3-8B-Instruct-q4f32_1',
        name: 'Llama 3 8B Instruct',
        size: 4.3 * 1024 * 1024 * 1024, // 4.3 GB
        description: 'Meta Llama 3 8B指令微调模型',
        recommended: true
      },
      {
        id: 'Phi-3-mini-4k-instruct-q4f16_1',
        name: 'Phi 3 Mini 4K Instruct',
        size: 2.2 * 1024 * 1024 * 1024, // 2.2 GB
        description: 'Microsoft Phi 3 Mini 4K上下文指令模型',
        recommended: true
      },
      {
        id: 'TinyLlama-1.1B-Chat-v1.0-q4f16_1',
        name: 'TinyLlama 1.1B Chat',
        size: 0.7 * 1024 * 1024 * 1024, // 0.7 GB
        description: 'TinyLlama 1.1B对话模型（轻量级）',
        recommended: false
      },
      {
        id: 'Qwen2-1.5B-Instruct-q4f16_1',
        name: 'Qwen2 1.5B Instruct',
        size: 0.9 * 1024 * 1024 * 1024, // 0.9 GB
        description: 'Qwen2 1.5B指令模型',
        recommended: false
      },
      {
        id: 'Mistral-7B-Instruct-v0.3-q4f16_1',
        name: 'Mistral 7B Instruct v0.3',
        size: 4.0 * 1024 * 1024 * 1024, // 4.0 GB
        description: 'Mistral 7B指令模型 v0.3',
        recommended: false
      }
    ]
  }

  /**
   * 检查模型是否已缓存
   * @param {string} modelId - 模型ID
   * @returns {Promise<boolean>}
   */
  async isModelCached(modelId) {
    // #ifdef H5
    if ('caches' in window) {
      try {
        const cacheNames = await caches.keys()
        return cacheNames.some(name => name.includes(modelId))
      } catch (error) {
        console.error('[ModelCache] 检查缓存失败:', error)
        return false
      }
    }
    // #endif

    return false
  }

  /**
   * 获取缓存的模型列表
   * @returns {Array}
   */
  getCachedModels() {
    const availableModels = this.getAvailableModels()

    return Array.from(this.cachedModels.values()).map(cached => {
      const model = availableModels.find(m => cached.name.includes(m.id))
      return {
        ...cached,
        ...(model || {})
      }
    })
  }

  /**
   * 下载模型
   * @param {string} modelId - 模型ID
   * @param {Object} options - 选项
   * @returns {Promise<Object>}
   */
  async downloadModel(modelId, options = {}) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    // #ifdef H5
    try {
      console.log('[ModelCache] 开始下载模型:', modelId)

      this.emit('download-start', { modelId })

      // 检查是否已缓存
      const isCached = await this.isModelCached(modelId)
      if (isCached && !options.force) {
        console.log('[ModelCache] 模型已缓存:', modelId)
        return {
          success: true,
          modelId,
          cached: true
        }
      }

      // 检查存储空间
      const hasSpace = await this.checkStorageSpace(modelId)
      if (!hasSpace) {
        throw new Error('存储空间不足')
      }

      // Web LLM会自动处理模型下载和缓存
      // 我们只需要初始化引擎，它会触发下载
      if (typeof window !== 'undefined' && window.webllm) {
        // 设置进度回调
        const progressCallback = (progress) => {
          this.emit('download-progress', {
            modelId,
            progress: progress.progress || 0,
            text: progress.text || ''
          })
        }

        // 创建引擎会自动下载和缓存模型
        const engine = await window.webllm.CreateMLCEngine(
          modelId,
          { initProgressCallback: progressCallback }
        )

        // 下载完成后释放引擎
        engine = null

        // 更新缓存列表
        await this.loadCachedModels()

        this.stats.downloads++

        console.log('[ModelCache] ✅ 模型下载完成:', modelId)

        this.emit('download-complete', { modelId })

        return {
          success: true,
          modelId,
          cached: true
        }
      } else {
        throw new Error('Web LLM库未加载')
      }
    } catch (error) {
      this.stats.failures++

      console.error('[ModelCache] 模型下载失败:', error)

      this.emit('download-error', { modelId, error })

      throw error
    }
    // #endif

    // #ifndef H5
    throw new Error('模型下载仅在H5环境可用')
    // #endif
  }

  /**
   * 删除模型缓存
   * @param {string} modelId - 模型ID
   * @returns {Promise<boolean>}
   */
  async deleteModel(modelId) {
    if (!this.isInitialized) {
      await this.initialize()
    }

    // #ifdef H5
    try {
      console.log('[ModelCache] 删除模型缓存:', modelId)

      if ('caches' in window) {
        const cacheNames = await caches.keys()
        const targetCaches = cacheNames.filter(name => name.includes(modelId))

        for (const cacheName of targetCaches) {
          await caches.delete(cacheName)
          this.cachedModels.delete(cacheName)
        }

        // 重新加载统计
        await this.loadCachedModels()

        console.log('[ModelCache] ✅ 模型缓存已删除')

        this.emit('model-deleted', { modelId })

        return true
      }

      return false
    } catch (error) {
      console.error('[ModelCache] 删除模型失败:', error)
      throw error
    }
    // #endif

    // #ifndef H5
    throw new Error('模型删除仅在H5环境可用')
    // #endif
  }

  /**
   * 清空所有模型缓存
   * @returns {Promise<boolean>}
   */
  async clearAllModels() {
    if (!this.isInitialized) {
      await this.initialize()
    }

    // #ifdef H5
    try {
      console.log('[ModelCache] 清空所有模型缓存...')

      if ('caches' in window) {
        const cacheNames = await caches.keys()
        const webllmCaches = cacheNames.filter(name => name.includes('webllm'))

        for (const cacheName of webllmCaches) {
          await caches.delete(cacheName)
        }

        this.cachedModels.clear()
        this.stats.totalModels = 0
        this.stats.totalSize = 0

        console.log('[ModelCache] ✅ 所有模型缓存已清空')

        this.emit('cache-cleared')

        return true
      }

      return false
    } catch (error) {
      console.error('[ModelCache] 清空缓存失败:', error)
      throw error
    }
    // #endif

    // #ifndef H5
    throw new Error('清空缓存仅在H5环境可用')
    // #endif
  }

  /**
   * 检查存储空间
   * @param {string} modelId - 模型ID
   * @returns {Promise<boolean>}
   * @private
   */
  async checkStorageSpace(modelId) {
    // #ifdef H5
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      try {
        const estimate = await navigator.storage.estimate()
        const available = estimate.quota - estimate.usage
        const required = this.getModelSize(modelId)

        console.log('[ModelCache] 可用空间:', this.formatSize(available))
        console.log('[ModelCache] 需要空间:', this.formatSize(required))

        return available > required
      } catch (error) {
        console.error('[ModelCache] 检查存储空间失败:', error)
        // 无法确定，假设有足够空间
        return true
      }
    }
    // #endif

    // 无法检查，假设有足够空间
    return true
  }

  /**
   * 获取模型大小
   * @param {string} modelId - 模型ID
   * @returns {number}
   * @private
   */
  getModelSize(modelId) {
    const models = this.getAvailableModels()
    const model = models.find(m => m.id === modelId)
    return model ? model.size : 4 * 1024 * 1024 * 1024 // 默认4GB
  }

  /**
   * 获取存储信息
   * @returns {Promise<Object>}
   */
  async getStorageInfo() {
    // #ifdef H5
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      try {
        const estimate = await navigator.storage.estimate()

        return {
          quota: estimate.quota,
          usage: estimate.usage,
          available: estimate.quota - estimate.usage,
          quotaFormatted: this.formatSize(estimate.quota),
          usageFormatted: this.formatSize(estimate.usage),
          availableFormatted: this.formatSize(estimate.quota - estimate.usage),
          usagePercent: ((estimate.usage / estimate.quota) * 100).toFixed(2) + '%'
        }
      } catch (error) {
        console.error('[ModelCache] 获取存储信息失败:', error)
      }
    }
    // #endif

    return {
      quota: 0,
      usage: 0,
      available: 0,
      quotaFormatted: 'Unknown',
      usageFormatted: 'Unknown',
      availableFormatted: 'Unknown',
      usagePercent: '0%'
    }
  }

  /**
   * 格式化大小
   * @param {number} bytes - 字节数
   * @returns {string}
   * @private
   */
  formatSize(bytes) {
    if (bytes === 0) return '0 B'

    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))

    return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i]
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      totalModels: this.stats.totalModels,
      totalSize: this.formatSize(this.stats.totalSize),
      downloads: this.stats.downloads,
      failures: this.stats.failures,
      cachedModels: this.getCachedModels()
    }
  }

  /**
   * 事件监听
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    this.listeners.get(event).push(callback)
  }

  /**
   * 触发事件
   */
  emit(event, data) {
    if (!this.listeners.has(event)) return

    const callbacks = this.listeners.get(event)
    for (const callback of callbacks) {
      try {
        callback(data)
      } catch (error) {
        console.error('[ModelCache] 事件回调失败:', error)
      }
    }
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.downloadQueue = []
    this.activeDownloads.clear()
    this.isInitialized = false
    console.log('[ModelCache] 资源已清理')
  }
}

// 创建单例
let modelCacheManagerInstance = null

/**
 * 获取模型缓存管理器实例
 * @param {Object} config - 配置
 * @returns {ModelCacheManager}
 */
export function getModelCacheManager(config) {
  if (!modelCacheManagerInstance) {
    modelCacheManagerInstance = new ModelCacheManager(config)
  }
  return modelCacheManagerInstance
}

export default ModelCacheManager
