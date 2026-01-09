/**
 * 插件市场API客户端
 *
 * 负责与插件市场后端服务通信
 * 支持插件发现、下载、评分、评论等功能
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class PluginMarketplaceAPI {
  constructor(config = {}) {
    // 市场API配置
    this.baseURL = config.baseURL || process.env.PLUGIN_MARKETPLACE_URL || 'https://plugins.chainlesschain.com/api';
    this.timeout = config.timeout || 30000;
    this.cacheDir = config.cacheDir || path.join(process.cwd(), '.plugin-cache');
    this.cacheTTL = config.cacheTTL || 3600000; // 1小时

    // 创建axios实例
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ChainlessChain-Desktop/1.0'
      }
    });

    // 确保缓存目录存在
    this.ensureCacheDir();

    // 本地缓存
    this.cache = new Map();
  }

  /**
   * 确保缓存目录存在
   */
  ensureCacheDir() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * 获取缓存键
   */
  getCacheKey(endpoint, params = {}) {
    const key = `${endpoint}:${JSON.stringify(params)}`;
    return crypto.createHash('md5').update(key).digest('hex');
  }

  /**
   * 从缓存读取
   */
  getFromCache(key) {
    // 内存缓存
    if (this.cache.has(key)) {
      const cached = this.cache.get(key);
      if (Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.data;
      }
      this.cache.delete(key);
    }

    // 文件缓存
    const cacheFile = path.join(this.cacheDir, `${key}.json`);
    if (fs.existsSync(cacheFile)) {
      try {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (Date.now() - cached.timestamp < this.cacheTTL) {
          this.cache.set(key, cached);
          return cached.data;
        }
        fs.unlinkSync(cacheFile);
      } catch (error) {
        console.error('[PluginMarketplaceAPI] Cache read error:', error);
      }
    }

    return null;
  }

  /**
   * 写入缓存
   */
  setCache(key, data) {
    const cached = {
      timestamp: Date.now(),
      data
    };

    // 内存缓存
    this.cache.set(key, cached);

    // 文件缓存
    const cacheFile = path.join(this.cacheDir, `${key}.json`);
    try {
      fs.writeFileSync(cacheFile, JSON.stringify(cached), 'utf8');
    } catch (error) {
      console.error('[PluginMarketplaceAPI] Cache write error:', error);
    }
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.cache.clear();
    try {
      const files = fs.readdirSync(this.cacheDir);
      files.forEach(file => {
        fs.unlinkSync(path.join(this.cacheDir, file));
      });
    } catch (error) {
      console.error('[PluginMarketplaceAPI] Cache clear error:', error);
    }
  }

  /**
   * 获取插件列表
   */
  async listPlugins(options = {}) {
    const {
      category = null,
      search = null,
      sort = 'popular',
      page = 1,
      pageSize = 20,
      verified = null,
      useCache = true
    } = options;

    const params = {
      category,
      search,
      sort,
      page,
      pageSize,
      verified
    };

    // 检查缓存
    if (useCache) {
      const cacheKey = this.getCacheKey('/plugins', params);
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        console.log('[PluginMarketplaceAPI] Using cached plugin list');
        return cached;
      }
    }

    try {
      const response = await this.client.get('/plugins', { params });
      const data = response.data;

      // 缓存结果
      if (useCache) {
        const cacheKey = this.getCacheKey('/plugins', params);
        this.setCache(cacheKey, data);
      }

      return data;
    } catch (error) {
      console.error('[PluginMarketplaceAPI] List plugins error:', error);

      // 如果网络失败，尝试返回缓存（即使过期）
      if (useCache) {
        const cacheKey = this.getCacheKey('/plugins', params);
        const cacheFile = path.join(this.cacheDir, `${cacheKey}.json`);
        if (fs.existsSync(cacheFile)) {
          try {
            const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            console.log('[PluginMarketplaceAPI] Using stale cache due to network error');
            return cached.data;
          } catch (e) {
            // 忽略缓存读取错误
          }
        }
      }

      throw error;
    }
  }

  /**
   * 获取插件详情
   */
  async getPlugin(pluginId, useCache = true) {
    // 检查缓存
    if (useCache) {
      const cacheKey = this.getCacheKey(`/plugins/${pluginId}`);
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        console.log('[PluginMarketplaceAPI] Using cached plugin detail');
        return cached;
      }
    }

    try {
      const response = await this.client.get(`/plugins/${pluginId}`);
      const data = response.data;

      // 缓存结果
      if (useCache) {
        const cacheKey = this.getCacheKey(`/plugins/${pluginId}`);
        this.setCache(cacheKey, data);
      }

      return data;
    } catch (error) {
      console.error('[PluginMarketplaceAPI] Get plugin error:', error);
      throw error;
    }
  }

  /**
   * 下载插件
   */
  async downloadPlugin(pluginId, version = 'latest') {
    try {
      const response = await this.client.get(`/plugins/${pluginId}/download`, {
        params: { version },
        responseType: 'arraybuffer'
      });

      return response.data;
    } catch (error) {
      console.error('[PluginMarketplaceAPI] Download plugin error:', error);
      throw error;
    }
  }

  /**
   * 获取插件版本列表
   */
  async getPluginVersions(pluginId) {
    try {
      const response = await this.client.get(`/plugins/${pluginId}/versions`);
      return response.data;
    } catch (error) {
      console.error('[PluginMarketplaceAPI] Get plugin versions error:', error);
      throw error;
    }
  }

  /**
   * 检查插件更新
   */
  async checkUpdates(installedPlugins) {
    try {
      const response = await this.client.post('/plugins/check-updates', {
        plugins: installedPlugins.map(p => ({
          id: p.id,
          version: p.version
        }))
      });

      return response.data;
    } catch (error) {
      console.error('[PluginMarketplaceAPI] Check updates error:', error);
      throw error;
    }
  }

  /**
   * 提交插件评分
   */
  async ratePlugin(pluginId, rating, comment = null) {
    try {
      const response = await this.client.post(`/plugins/${pluginId}/ratings`, {
        rating,
        comment
      });

      return response.data;
    } catch (error) {
      console.error('[PluginMarketplaceAPI] Rate plugin error:', error);
      throw error;
    }
  }

  /**
   * 获取插件评论
   */
  async getPluginReviews(pluginId, page = 1, pageSize = 10) {
    try {
      const response = await this.client.get(`/plugins/${pluginId}/reviews`, {
        params: { page, pageSize }
      });

      return response.data;
    } catch (error) {
      console.error('[PluginMarketplaceAPI] Get plugin reviews error:', error);
      throw error;
    }
  }

  /**
   * 发布插件（开发者功能）
   */
  async publishPlugin(pluginData, pluginFile) {
    try {
      const formData = new FormData();
      formData.append('manifest', JSON.stringify(pluginData));
      formData.append('file', pluginFile);

      const response = await this.client.post('/plugins/publish', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      return response.data;
    } catch (error) {
      console.error('[PluginMarketplaceAPI] Publish plugin error:', error);
      throw error;
    }
  }

  /**
   * 更新插件（开发者功能）
   */
  async updatePlugin(pluginId, version, pluginFile, changelog) {
    try {
      const formData = new FormData();
      formData.append('version', version);
      formData.append('changelog', changelog);
      formData.append('file', pluginFile);

      const response = await this.client.post(`/plugins/${pluginId}/update`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      return response.data;
    } catch (error) {
      console.error('[PluginMarketplaceAPI] Update plugin error:', error);
      throw error;
    }
  }

  /**
   * 获取分类列表
   */
  async getCategories() {
    const cacheKey = this.getCacheKey('/categories');
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const response = await this.client.get('/categories');
      const data = response.data;

      this.setCache(cacheKey, data);
      return data;
    } catch (error) {
      console.error('[PluginMarketplaceAPI] Get categories error:', error);
      throw error;
    }
  }

  /**
   * 搜索插件
   */
  async searchPlugins(query, options = {}) {
    const {
      category = null,
      sort = 'relevance',
      page = 1,
      pageSize = 20
    } = options;

    try {
      const response = await this.client.get('/plugins/search', {
        params: {
          q: query,
          category,
          sort,
          page,
          pageSize
        }
      });

      return response.data;
    } catch (error) {
      console.error('[PluginMarketplaceAPI] Search plugins error:', error);
      throw error;
    }
  }

  /**
   * 获取推荐插件
   */
  async getFeaturedPlugins(limit = 10) {
    const cacheKey = this.getCacheKey('/plugins/featured', { limit });
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const response = await this.client.get('/plugins/featured', {
        params: { limit }
      });

      const data = response.data;
      this.setCache(cacheKey, data);
      return data;
    } catch (error) {
      console.error('[PluginMarketplaceAPI] Get featured plugins error:', error);
      throw error;
    }
  }

  /**
   * 报告插件问题
   */
  async reportPlugin(pluginId, reason, description) {
    try {
      const response = await this.client.post(`/plugins/${pluginId}/report`, {
        reason,
        description
      });

      return response.data;
    } catch (error) {
      console.error('[PluginMarketplaceAPI] Report plugin error:', error);
      throw error;
    }
  }

  /**
   * 获取插件统计信息
   */
  async getPluginStats(pluginId) {
    try {
      const response = await this.client.get(`/plugins/${pluginId}/stats`);
      return response.data;
    } catch (error) {
      console.error('[PluginMarketplaceAPI] Get plugin stats error:', error);
      throw error;
    }
  }
}

// 单例模式
let marketplaceAPIInstance = null;

function getPluginMarketplaceAPI(config) {
  if (!marketplaceAPIInstance) {
    marketplaceAPIInstance = new PluginMarketplaceAPI(config);
  }
  return marketplaceAPIInstance;
}

module.exports = {
  PluginMarketplaceAPI,
  getPluginMarketplaceAPI
};
