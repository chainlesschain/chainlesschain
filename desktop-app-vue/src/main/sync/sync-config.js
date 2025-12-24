/**
 * 同步配置
 */
module.exports = {
  // 后端服务地址
  backendUrl: process.env.PROJECT_SERVICE_URL || 'http://localhost:9090',

  // 同步间隔（毫秒）
  syncInterval: 5 * 60 * 1000,  // 5分钟

  // 最大并发数
  maxConcurrency: 3,

  // 重试配置
  maxRetries: 3,
  retryDelay: 2000,  // 2秒

  // 需要同步的表（按优先级排序）
  syncTables: [
    'projects',
    'project_files',
    'knowledge_items',
    'conversations',
    'messages',
    'project_collaborators',
    'project_comments',
    'project_tasks'
  ],

  // 冲突解决策略
  defaultConflictStrategy: 'manual',  // manual | local | remote

  // 日志配置
  enableLogging: true
};
