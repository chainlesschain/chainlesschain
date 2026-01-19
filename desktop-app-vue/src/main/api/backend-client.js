/**
 * 后端API客户端
 * 封装与Java和Python后端服务的HTTP通信
 */

const { logger, createLogger } = require('../utils/logger.js');
const axios = require('axios');

// 从环境变量或配置读取后端地址
const JAVA_SERVICE_URL = process.env.PROJECT_SERVICE_URL || 'http://localhost:9090';
const PYTHON_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8001';

// 导入Git配置来控制日志输出
let getGitConfig = null;
try {
  const gitConfigModule = require('../git/git-config');
  getGitConfig = gitConfigModule.getGitConfig;
} catch (e) {
  // Git配置模块不可用时静默失败
}

/**
 * 创建axios实例
 */
const javaClient = axios.create({
  baseURL: JAVA_SERVICE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
});

const pythonClient = axios.create({
  baseURL: PYTHON_SERVICE_URL,
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json'
  }
});

/**
 * 错误处理
 * @param {boolean} silent - 是否静默错误日志（不输出到控制台）
 */
function handleError(error, context, silent = false) {
  // 实时获取最新的配置
  // 只有在非静默模式且明确启用日志时才输出错误
  // 默认情况下（getGitConfig为null或enableLogging为false）不输出日志
  let shouldLog = false;
  if (!silent && getGitConfig) {
    try {
      const config = getGitConfig();
      shouldLog = config.isLoggingEnabled();
    } catch (e) {
      // 忽略配置读取错误
    }
  }

  if (shouldLog) {
    logger.error(`[BackendClient] ${context} 失败:`, error);
  }

  if (error.response) {
    // 服务器返回错误响应
    return {
      success: false,
      error: error.response.data.message || error.response.data.detail || error.message,
      status: error.response.status
    };
  } else if (error.request) {
    // 请求已发送但没有收到响应
    return {
      success: false,
      error: '后端服务无响应，请检查服务是否启动',
      status: 0
    };
  } else {
    // 其他错误
    return {
      success: false,
      error: error.message,
      status: -1
    };
  }
}

/**
 * 项目文件管理API
 */
class ProjectFileAPI {
  /**
   * 获取文件列表
   */
  static async getFiles(projectId, fileType = null, pageNum = 1, pageSize = 50) {
    try {
      const response = await javaClient.get(`/api/projects/${projectId}/files`, {
        params: { fileType, pageNum, pageSize }
      });
      return response.data;
    } catch (error) {
      return handleError(error, '获取文件列表');
    }
  }

  /**
   * 获取单个文件详情
   */
  static async getFile(projectId, fileId) {
    try {
      const response = await javaClient.get(`/api/projects/${projectId}/files/${fileId}`);
      return response.data;
    } catch (error) {
      return handleError(error, '获取文件详情');
    }
  }

  /**
   * 创建文件
   */
  static async createFile(projectId, fileData) {
    try {
      const response = await javaClient.post(`/api/projects/${projectId}/files`, fileData);
      return response.data;
    } catch (error) {
      return handleError(error, '创建文件');
    }
  }

  /**
   * 批量创建文件
   */
  static async batchCreateFiles(projectId, files) {
    try {
      const response = await javaClient.post(`/api/projects/${projectId}/files/batch`, files);
      return response.data;
    } catch (error) {
      return handleError(error, '批量创建文件');
    }
  }

  /**
   * 更新文件
   */
  static async updateFile(projectId, fileId, fileData) {
    try {
      const response = await javaClient.put(`/api/projects/${projectId}/files/${fileId}`, fileData);
      return response.data;
    } catch (error) {
      return handleError(error, '更新文件');
    }
  }

  /**
   * 删除文件
   */
  static async deleteFile(projectId, fileId) {
    try {
      const response = await javaClient.delete(`/api/projects/${projectId}/files/${fileId}`);
      return response.data;
    } catch (error) {
      return handleError(error, '删除文件');
    }
  }
}

/**
 * Git操作API
 */
class GitAPI {
  /**
   * 初始化仓库
   */
  static async init(repoPath, remoteUrl = null, branchName = 'main') {
    try {
      const response = await pythonClient.post('/api/git/init', {
        repo_path: repoPath,
        remote_url: remoteUrl,
        branch_name: branchName
      });
      return response.data;
    } catch (error) {
      return handleError(error, 'Git初始化');
    }
  }

  /**
   * 获取状态
   */
  static async status(repoPath) {
    try {
      const response = await pythonClient.get('/api/git/status', {
        params: { repo_path: repoPath }
      });
      return response.data;
    } catch (error) {
      return handleError(error, '获取Git状态');
    }
  }

  /**
   * 提交更改
   */
  static async commit(repoPath, message = null, files = null, autoGenerateMessage = false) {
    try {
      const response = await pythonClient.post('/api/git/commit', {
        repo_path: repoPath,
        message,
        files,
        auto_generate_message: autoGenerateMessage
      });
      return response.data;
    } catch (error) {
      return handleError(error, 'Git提交');
    }
  }

  /**
   * 推送到远程
   */
  static async push(repoPath, remote = 'origin', branch = null) {
    try {
      const response = await pythonClient.post('/api/git/push', {
        repo_path: repoPath,
        remote,
        branch
      });
      return response.data;
    } catch (error) {
      return handleError(error, 'Git推送');
    }
  }

  /**
   * 从远程拉取
   */
  static async pull(repoPath, remote = 'origin', branch = null) {
    try {
      const response = await pythonClient.post('/api/git/pull', {
        repo_path: repoPath,
        remote,
        branch
      });
      return response.data;
    } catch (error) {
      return handleError(error, 'Git拉取');
    }
  }

  /**
   * 获取提交历史
   */
  static async log(repoPath, limit = 20) {
    try {
      const response = await pythonClient.get('/api/git/log', {
        params: { repo_path: repoPath, limit }
      });
      return response.data;
    } catch (error) {
      return handleError(error, '获取Git日志');
    }
  }

  /**
   * 获取差异
   */
  static async diff(repoPath, commit1 = null, commit2 = null) {
    try {
      const response = await pythonClient.get('/api/git/diff', {
        params: { repo_path: repoPath, commit1, commit2 }
      });
      return response.data;
    } catch (error) {
      return handleError(error, '获取Git差异');
    }
  }

  /**
   * 列出分支
   */
  static async branches(repoPath) {
    try {
      const response = await pythonClient.get('/api/git/branches', {
        params: { repo_path: repoPath }
      });
      return response.data;
    } catch (error) {
      return handleError(error, '获取Git分支列表');
    }
  }

  /**
   * 创建分支
   */
  static async createBranch(repoPath, branchName, fromBranch = null) {
    try {
      const response = await pythonClient.post('/api/git/branch/create', {
        repo_path: repoPath,
        branch_name: branchName,
        from_branch: fromBranch
      });
      return response.data;
    } catch (error) {
      return handleError(error, '创建Git分支');
    }
  }

  /**
   * 切换分支
   */
  static async checkoutBranch(repoPath, branchName) {
    try {
      const response = await pythonClient.post('/api/git/branch/checkout', {
        repo_path: repoPath,
        branch_name: branchName
      });
      return response.data;
    } catch (error) {
      return handleError(error, '切换Git分支');
    }
  }

  /**
   * 合并分支
   */
  static async merge(repoPath, sourceBranch, targetBranch = null) {
    try {
      const response = await pythonClient.post('/api/git/merge', {
        repo_path: repoPath,
        source_branch: sourceBranch,
        target_branch: targetBranch
      });
      return response.data;
    } catch (error) {
      return handleError(error, 'Git合并');
    }
  }

  /**
   * 解决冲突
   */
  static async resolveConflicts(repoPath, filePath = null, autoResolve = false, strategy = null) {
    try {
      const response = await pythonClient.post('/api/git/resolve-conflicts', {
        repo_path: repoPath,
        file_path: filePath,
        auto_resolve: autoResolve,
        strategy
      });
      return response.data;
    } catch (error) {
      return handleError(error, '解决Git冲突');
    }
  }

  /**
   * AI生成提交消息
   */
  static async generateCommitMessage(repoPath, stagedFiles = null, diffContent = null) {
    try {
      const response = await pythonClient.post('/api/git/generate-commit-message', {
        repo_path: repoPath,
        staged_files: stagedFiles,
        diff_content: diffContent
      });
      return response.data;
    } catch (error) {
      return handleError(error, 'AI生成提交消息');
    }
  }
}

/**
 * RAG索引API
 */
class RAGAPI {
  /**
   * 索引项目文件
   */
  static async indexProject(projectId, repoPath, fileTypes = null, forceReindex = false) {
    try {
      const response = await pythonClient.post('/api/rag/index/project', {
        project_id: projectId,
        repo_path: repoPath,
        file_types: fileTypes,
        force_reindex: forceReindex
      }, {
        timeout: 300000 // 5分钟超时
      });
      return response.data;
    } catch (error) {
      return handleError(error, 'RAG索引项目');
    }
  }

  /**
   * 获取索引统计
   */
  static async getIndexStats(projectId) {
    try {
      const response = await pythonClient.get('/api/rag/index/stats', {
        params: { project_id: projectId }
      });
      return response.data;
    } catch (error) {
      return handleError(error, '获取索引统计');
    }
  }

  /**
   * 增强查询
   */
  static async enhancedQuery(projectId, query, topK = 5, useReranker = false, sources = ['project']) {
    try {
      const response = await pythonClient.post('/api/rag/query/enhanced', {
        project_id: projectId,
        query,
        top_k: topK,
        use_reranker: useReranker,
        sources
      });
      return response.data;
    } catch (error) {
      return handleError(error, 'RAG增强查询');
    }
  }

  /**
   * 删除项目索引
   */
  static async deleteProjectIndex(projectId) {
    try {
      const response = await pythonClient.delete(`/api/rag/index/project/${projectId}`);
      return response.data;
    } catch (error) {
      return handleError(error, '删除项目索引');
    }
  }

  /**
   * 更新单文件索引
   */
  static async updateFileIndex(projectId, filePath, content) {
    try {
      const response = await pythonClient.post('/api/rag/index/update-file', {
        project_id: projectId,
        file_path: filePath,
        content
      });
      return response.data;
    } catch (error) {
      return handleError(error, '更新文件索引');
    }
  }
}

/**
 * 代码助手API
 */
class CodeAPI {
  /**
   * 生成代码
   */
  static async generate(description, language, style = 'modern', includeTests = false, includeComments = true, context = null) {
    try {
      const response = await pythonClient.post('/api/code/generate', {
        description,
        language,
        style,
        include_tests: includeTests,
        include_comments: includeComments,
        context
      });
      return response.data;
    } catch (error) {
      return handleError(error, '代码生成');
    }
  }

  /**
   * 代码审查
   */
  static async review(code, language, focusAreas = null) {
    try {
      const response = await pythonClient.post('/api/code/review', {
        code,
        language,
        focus_areas: focusAreas
      });
      return response.data;
    } catch (error) {
      return handleError(error, '代码审查');
    }
  }

  /**
   * 代码重构
   */
  static async refactor(code, language, refactorType = 'general', target = null) {
    try {
      const response = await pythonClient.post('/api/code/refactor', {
        code,
        language,
        refactor_type: refactorType,
        target
      });
      return response.data;
    } catch (error) {
      return handleError(error, '代码重构');
    }
  }

  /**
   * 代码解释
   */
  static async explain(code, language) {
    try {
      const response = await pythonClient.post('/api/code/explain', {
        code,
        language
      });
      return response.data;
    } catch (error) {
      return handleError(error, '代码解释');
    }
  }

  /**
   * 修复Bug
   */
  static async fixBug(code, language, bugDescription = null) {
    try {
      const response = await pythonClient.post('/api/code/fix-bug', {
        code,
        language,
        bug_description: bugDescription
      });
      return response.data;
    } catch (error) {
      return handleError(error, '修复Bug');
    }
  }

  /**
   * 生成单元测试
   */
  static async generateTests(code, language) {
    try {
      const response = await pythonClient.post('/api/code/generate-tests', {
        code,
        language
      });
      return response.data;
    } catch (error) {
      return handleError(error, '生成测试');
    }
  }

  /**
   * 性能优化
   */
  static async optimize(code, language) {
    try {
      const response = await pythonClient.post('/api/code/optimize', {
        code,
        language
      });
      return response.data;
    } catch (error) {
      return handleError(error, '代码优化');
    }
  }
}

module.exports = {
  ProjectFileAPI,
  GitAPI,
  RAGAPI,
  CodeAPI,
  // 导出客户端实例供高级用法
  javaClient,
  pythonClient
};
