const axios = require('axios');
const config = require('./sync-config');

/**
 * 同步 HTTP 客户端
 * 扩展自 ProjectHTTPClient，提供数据同步相关的 API调用
 */
class SyncHTTPClient {
  constructor(baseURL = null) {
    this.client = axios.create({
      baseURL: baseURL || config.backendUrl,
      timeout: 60000,  // 60秒超时
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // 请求拦截器
    this.client.interceptors.request.use(
      config => {
        if (config.enableLogging) {
          console.log(`[SyncHTTP] ${config.method.toUpperCase()} ${config.url}`);
        }
        return config;
      },
      error => {
        console.error('[SyncHTTP] Request error:', error);
        return Promise.reject(error);
      }
    );

    // 响应拦截器
    this.client.interceptors.response.use(
      response => {
        // 后端返回格式: { code: 200, message: "success", data: ... }
        const { code, message, data } = response.data;

        if (code !== 200) {
          const error = new Error(message || '请求失败');
          error.code = code;
          error.response = response;
          throw error;
        }

        return data;  // 只返回data部分
      },
      error => {
        console.error('[SyncHTTP] Response error:', error.message);

        if (error.response) {
          const status = error.response.status;
          const errorMessage = error.response.data?.message || error.message;

          switch (status) {
            case 400:
              throw new Error(`请求参数错误: ${errorMessage}`);
            case 401:
              throw new Error('未授权，请登录');
            case 403:
              throw new Error('权限不足');
            case 404:
              throw new Error('资源不存在');
            case 409:
              // 冲突错误，包含冲突数据
              const conflictError = new Error('检测到数据冲突');
              conflictError.conflicts = error.response.data?.conflicts || [];
              throw conflictError;
            case 500:
              throw new Error('服务器内部错误');
            default:
              throw new Error(errorMessage || '未知错误');
          }
        } else if (error.request) {
          throw new Error('网络连接失败，请检查网络');
        } else {
          throw new Error(error.message || '请求失败');
        }
      }
    );
  }

  /**
   * 批量上传数据
   * @param {string} tableName - 表名
   * @param {Array} records - 记录列表
   * @param {string} deviceId - 设备ID
   * @returns {Promise<Object>} 上传结果
   */
  async uploadBatch(tableName, records, deviceId) {
    return this.client.post('/api/sync/upload', {
      tableName,
      records,
      deviceId,
      lastSyncedAt: Date.now()
    });
  }

  /**
   * 增量下载数据
   * @param {string} tableName - 表名
   * @param {number} lastSyncedAt - 最后同步时间戳（毫秒）
   * @param {string} deviceId - 设备ID
   * @returns {Promise<Object>} 增量数据
   */
  async downloadIncremental(tableName, lastSyncedAt, deviceId) {
    return this.client.get(`/api/sync/download/${tableName}`, {
      params: { lastSyncedAt, deviceId }
    });
  }

  /**
   * 获取同步状态
   * @param {string} deviceId - 设备ID
   * @returns {Promise<Object>} 同步状态
   */
  async getSyncStatus(deviceId) {
    return this.client.get('/api/sync/status', {
      params: { deviceId }
    });
  }

  /**
   * 解决冲突
   * @param {string} conflictId - 冲突ID
   * @param {string} resolution - 解决策略 (local/remote/manual)
   * @param {Object} selectedVersion - 选择的版本数据
   * @returns {Promise<void>}
   */
  async resolveConflict(conflictId, resolution, selectedVersion) {
    return this.client.post('/api/sync/resolve-conflict', {
      conflictId,
      resolution,
      selectedVersion
    });
  }

  /**
   * 健康检查
   * @returns {Promise<Object>} 健康状态
   */
  async health() {
    return this.client.get('/api/sync/health');
  }
}

module.exports = SyncHTTPClient;
