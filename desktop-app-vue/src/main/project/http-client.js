const axios = require('axios');

/**
 * 项目服务HTTP客户端
 * 用于与后端project-service (Spring Boot) 通信
 */
class ProjectHTTPClient {
  constructor(baseURL = null) {
    // 默认使用环境变量，否则使用本地地址
    const defaultBaseURL = process.env.PROJECT_SERVICE_URL || 'http://localhost:9090';

    this.client = axios.create({
      baseURL: baseURL || defaultBaseURL,
      timeout: 300000, // 300秒超时（5分钟，AI生成复杂项目可能需要较长时间）
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // 请求拦截器
    this.client.interceptors.request.use(
      config => {
        console.log(`[ProjectHTTP] ${config.method.toUpperCase()} ${config.url}`);
        return config;
      },
      error => {
        console.error('[ProjectHTTP] Request error:', error);
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

        return data; // 只返回data部分
      },
      error => {
        console.error('[ProjectHTTP] Response error:', error);

        // 处理不同类型的错误
        if (error.response) {
          // 服务器返回错误状态码
          const status = error.response.status;
          const errorMessage = error.response.data?.message || error.message;

          switch (status) {
            case 400:
              throw new Error(`请求参数错误: ${errorMessage}`);
            case 401:
              throw new Error('未授权，请登录');
            case 403:
              throw new Error('没有权限访问');
            case 404:
              throw new Error('资源不存在');
            case 500:
              throw new Error(`服务器错误: ${errorMessage}`);
            case 503:
              throw new Error('服务暂时不可用，请稍后重试');
            default:
              throw new Error(`请求失败 (${status}): ${errorMessage}`);
          }
        } else if (error.request) {
          // 请求已发送但没有收到响应
          throw new Error('无法连接到项目服务，请检查服务是否启动');
        } else {
          // 请求配置出错
          throw new Error(`请求配置错误: ${error.message}`);
        }
      }
    );
  }

  // ==================== 项目CRUD ====================

  /**
   * 创建项目（支持AI生成）
   * @param {Object} createData - 创建数据
   * @param {string} createData.userPrompt - 用户需求描述（必填）
   * @param {string} createData.projectType - 项目类型 (web/document/data/app)
   * @param {string} createData.templateId - 模板ID（可选）
   * @param {string} createData.name - 项目名称（可选）
   * @param {string} createData.userId - 用户ID
   * @returns {Promise<Object>} 项目数据
   */
  async createProject(createData) {
    return this.client.post('/api/projects/create', createData);
  }

  /**
   * 获取项目列表（分页）
   * @param {string} userId - 用户ID
   * @param {number} pageNum - 页码（从1开始）
   * @param {number} pageSize - 每页数量
   * @returns {Promise<Object>} 分页数据 { records: [], total: 0, ... }
   */
  async listProjects(userId, pageNum = 1, pageSize = 100) {
    return this.client.get('/api/projects/list', {
      params: { userId, pageNum, pageSize }
    });
  }

  /**
   * 获取项目详情
   * @param {string} projectId - 项目ID
   * @returns {Promise<Object>} 项目详情
   */
  async getProject(projectId) {
    return this.client.get(`/api/projects/${projectId}`);
  }

  /**
   * 更新项目
   * @param {string} projectId - 项目ID
   * @param {Object} updates - 更新数据
   * @returns {Promise<Object>} 更新后的项目
   */
  async updateProject(projectId, updates) {
    return this.client.put(`/api/projects/${projectId}`, updates);
  }

  /**
   * 删除项目
   * @param {string} projectId - 项目ID
   * @returns {Promise<void>}
   */
  async deleteProject(projectId) {
    return this.client.delete(`/api/projects/${projectId}`);
  }

  // ==================== 项目任务执行 ====================

  /**
   * 执行项目任务（AI辅助）
   * @param {Object} taskData - 任务数据
   * @param {string} taskData.projectId - 项目ID
   * @param {string} taskData.userPrompt - 用户指令
   * @param {Array} taskData.context - 上下文（可选）
   * @returns {Promise<Object>} 任务执行结果
   */
  async executeTask(taskData) {
    return this.client.post('/api/projects/tasks/execute', taskData);
  }

  // ==================== 项目模板 ====================

  /**
   * 获取模板列表
   * @returns {Promise<Array>} 模板列表
   */
  async getTemplates() {
    return this.client.get('/api/templates');
  }

  /**
   * 获取模板详情
   * @param {string} templateId - 模板ID
   * @returns {Promise<Object>} 模板详情
   */
  async getTemplate(templateId) {
    return this.client.get(`/api/templates/${templateId}`);
  }

  // ==================== 健康检查 ====================

  /**
   * 健康检查
   * @returns {Promise<Object>} 服务状态
   */
  async healthCheck() {
    return this.client.get('/api/projects/health');
  }

  // ==================== 同步相关 ====================

  /**
   * 同步项目到后端
   * @param {Object} project - 项目数据
   * @returns {Promise<Object>} 同步结果
   */
  async syncProject(project) {
    return this.client.post('/api/projects/sync', project);
  }

  /**
   * 批量同步项目
   * @param {Array} projects - 项目列表
   * @returns {Promise<Object>} 同步结果
   */
  async syncProjects(projects) {
    return this.client.post('/api/projects/sync/batch', { projects });
  }

  // ==================== 工具方法 ====================

  /**
   * 设置授权Token
   * @param {string} token - JWT token
   */
  setAuthToken(token) {
    if (token) {
      this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete this.client.defaults.headers.common['Authorization'];
    }
  }

  /**
   * 更新baseURL
   * @param {string} newBaseURL - 新的base URL
   */
  setBaseURL(newBaseURL) {
    this.client.defaults.baseURL = newBaseURL;
  }

  /**
   * 获取当前配置
   * @returns {Object} 客户端配置
   */
  getConfig() {
    return {
      baseURL: this.client.defaults.baseURL,
      timeout: this.client.defaults.timeout,
    };
  }
}

// 导出单例
let instance = null;

/**
 * 获取HTTP客户端实例（单例模式）
 * @param {string} baseURL - 可选的base URL
 * @returns {ProjectHTTPClient}
 */
function getProjectHTTPClient(baseURL = null) {
  if (!instance || baseURL) {
    instance = new ProjectHTTPClient(baseURL);
  }
  return instance;
}

module.exports = {
  ProjectHTTPClient,
  getProjectHTTPClient,
};
