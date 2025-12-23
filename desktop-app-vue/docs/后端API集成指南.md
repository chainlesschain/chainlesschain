# Electron IPC → 后端API集成指南

## 概述

本文档说明如何将Electron主进程中的本地业务逻辑替换为后端API调用，实现前后端分离。

## 已创建的API客户端

位置：`desktop-app-vue/src/main/api/backend-client.js`

提供四个API类：
- **ProjectFileAPI** - 项目文件管理
- **GitAPI** - Git操作
- **RAGAPI** - RAG索引
- **CodeAPI** - 代码助手

## 集成步骤

### 1. 在index.js中导入API客户端

```javascript
// 在index.js顶部添加
const { ProjectFileAPI, GitAPI, RAGAPI, CodeAPI } = require('./api/backend-client');
```

### 2. 替换文件管理IPC Handlers

#### 原有实现（index.js 第4535行）：
```javascript
ipcMain.handle('project:get-files', async (_event, projectId) => {
  try {
    // 本地数据库查询
    const files = await db.all(`
      SELECT id, file_name, file_path, file_type, language, file_size, version
      FROM project_files
      WHERE project_id = ?
      ORDER BY updated_at DESC
    `, [projectId]);

    return {
      success: true,
      files
    };
  } catch (error) {
    console.error('获取项目文件失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
});
```

#### 新实现（调用后端API）：
```javascript
ipcMain.handle('project:get-files', async (_event, projectId, fileType = null, pageNum = 1, pageSize = 50) => {
  try {
    // 调用后端API
    const result = await ProjectFileAPI.getFiles(projectId, fileType, pageNum, pageSize);

    // 如果后端返回分页数据，需要适配前端格式
    if (result.data && result.data.records) {
      return {
        success: true,
        files: result.data.records,
        total: result.data.total
      };
    }

    return result;
  } catch (error) {
    console.error('获取项目文件失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
});
```

#### 原有实现（index.js 第4583行）：
```javascript
ipcMain.handle('project:update-file', async (_event, fileUpdate) => {
  try {
    const { projectId, fileId, content } = fileUpdate;

    // 更新本地数据库
    await db.run(`
      UPDATE project_files
      SET content = ?, updated_at = CURRENT_TIMESTAMP, version = version + 1
      WHERE id = ? AND project_id = ?
    `, [content, fileId, projectId]);

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

#### 新实现：
```javascript
ipcMain.handle('project:update-file', async (_event, fileUpdate) => {
  try {
    const { projectId, fileId, content, is_base64 } = fileUpdate;

    // 调用后端API
    const result = await ProjectFileAPI.updateFile(projectId, fileId, {
      content,
      is_base64
    });

    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

### 3. 替换Git操作IPC Handlers

#### 原有实现（index.js 第6912行）：
```javascript
ipcMain.handle('project:git-init', async (_event, repoPath) => {
  try {
    // 本地Git初始化（使用isomorphic-git或child_process）
    const git = require('isomorphic-git');
    await git.init({ fs, dir: repoPath });

    return { success: true, message: 'Git仓库初始化成功' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

#### 新实现：
```javascript
ipcMain.handle('project:git-init', async (_event, repoPath, remoteUrl = null) => {
  try {
    // 调用Python后端API
    const result = await GitAPI.init(repoPath, remoteUrl);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

#### Git状态查询（index.js 第6935行）：
```javascript
// 原有
ipcMain.handle('project:git-status', async (_event, repoPath) => {
  try {
    const git = require('isomorphic-git');
    const status = await git.statusMatrix({ fs, dir: repoPath });
    // 处理status数据...
    return { success: true, modified, untracked, staged };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 新实现
ipcMain.handle('project:git-status', async (_event, repoPath) => {
  return await GitAPI.status(repoPath);
});
```

#### Git提交（index.js 第6980行）：
```javascript
// 原有
ipcMain.handle('project:git-commit', async (_event, projectId, repoPath, message) => {
  try {
    const git = require('isomorphic-git');
    await git.add({ fs, dir: repoPath, filepath: '.' });
    const sha = await git.commit({
      fs,
      dir: repoPath,
      message,
      author: { name: 'User', email: 'user@example.com' }
    });
    return { success: true, commit_sha: sha };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 新实现（支持AI生成提交消息）
ipcMain.handle('project:git-commit', async (_event, projectId, repoPath, message = null, autoGenerate = false) => {
  return await GitAPI.commit(repoPath, message, null, autoGenerate);
});
```

#### Git推送/拉取（index.js 第7029和7056行）：
```javascript
// 原有
ipcMain.handle('project:git-push', async (_event, repoPath) => {
  try {
    const git = require('isomorphic-git');
    await git.push({ fs, http, dir: repoPath });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 新实现
ipcMain.handle('project:git-push', async (_event, repoPath, remote = 'origin', branch = null) => {
  return await GitAPI.push(repoPath, remote, branch);
});

// Pull类似
ipcMain.handle('project:git-pull', async (_event, projectId, repoPath) => {
  return await GitAPI.pull(repoPath);
});
```

### 4. 新增RAG索引IPC Handlers

```javascript
// 索引项目文件
ipcMain.handle('project:rag-index', async (_event, projectId, repoPath) => {
  return await RAGAPI.indexProject(projectId, repoPath);
});

// 获取索引统计
ipcMain.handle('project:rag-stats', async (_event, projectId) => {
  return await RAGAPI.getIndexStats(projectId);
});

// RAG增强查询
ipcMain.handle('project:rag-query', async (_event, projectId, query) => {
  return await RAGAPI.enhancedQuery(projectId, query);
});

// 更新文件索引
ipcMain.handle('project:rag-update-file', async (_event, projectId, filePath, content) => {
  return await RAGAPI.updateFileIndex(projectId, filePath, content);
});
```

### 5. 新增代码助手IPC Handlers

```javascript
// 代码生成
ipcMain.handle('project:code-generate', async (_event, description, language, options = {}) => {
  return await CodeAPI.generate(
    description,
    language,
    options.style || 'modern',
    options.includeTests || false,
    options.includeComments !== false,
    options.context
  );
});

// 代码审查
ipcMain.handle('project:code-review', async (_event, code, language, focusAreas = null) => {
  return await CodeAPI.review(code, language, focusAreas);
});

// 代码重构
ipcMain.handle('project:code-refactor', async (_event, code, language, refactorType = 'general') => {
  return await CodeAPI.refactor(code, language, refactorType);
});

// 代码解释
ipcMain.handle('project:code-explain', async (_event, code, language) => {
  return await CodeAPI.explain(code, language);
});

// 修复Bug
ipcMain.handle('project:code-fix-bug', async (_event, code, language, bugDescription) => {
  return await CodeAPI.fixBug(code, language, bugDescription);
});

// 生成测试
ipcMain.handle('project:code-generate-tests', async (_event, code, language) => {
  return await CodeAPI.generateTests(code, language);
});

// 性能优化
ipcMain.handle('project:code-optimize', async (_event, code, language) => {
  return await CodeAPI.optimize(code, language);
});
```

### 6. Git高级操作IPC Handlers

```javascript
// 获取提交历史
ipcMain.handle('project:git-log', async (_event, repoPath, limit = 20) => {
  return await GitAPI.log(repoPath, limit);
});

// 查看差异
ipcMain.handle('project:git-diff', async (_event, repoPath, commit1 = null, commit2 = null) => {
  return await GitAPI.diff(repoPath, commit1, commit2);
});

// 分支管理
ipcMain.handle('project:git-branches', async (_event, repoPath) => {
  return await GitAPI.branches(repoPath);
});

ipcMain.handle('project:git-create-branch', async (_event, repoPath, branchName, fromBranch = null) => {
  return await GitAPI.createBranch(repoPath, branchName, fromBranch);
});

ipcMain.handle('project:git-checkout', async (_event, repoPath, branchName) => {
  return await GitAPI.checkoutBranch(repoPath, branchName);
});

ipcMain.handle('project:git-merge', async (_event, repoPath, sourceBranch, targetBranch = null) => {
  return await GitAPI.merge(repoPath, sourceBranch, targetBranch);
});

// AI辅助冲突解决
ipcMain.handle('project:git-resolve-conflicts', async (_event, repoPath, filePath = null, strategy = null) => {
  return await GitAPI.resolveConflicts(repoPath, filePath, false, strategy);
});

// AI生成提交消息
ipcMain.handle('project:git-generate-commit-message', async (_event, repoPath) => {
  return await GitAPI.generateCommitMessage(repoPath);
});
```

## 环境配置

### .env文件配置（desktop-app-vue根目录）

```env
# 后端服务地址
PROJECT_SERVICE_URL=http://localhost:9090
AI_SERVICE_URL=http://localhost:8001

# 开发模式
NODE_ENV=development
```

### 在代码中读取环境变量

```javascript
// index.js顶部
require('dotenv').config();

console.log('后端服务配置:', {
  projectService: process.env.PROJECT_SERVICE_URL || 'http://localhost:9090',
  aiService: process.env.AI_SERVICE_URL || 'http://localhost:8001'
});
```

## 错误处理策略

### 1. 后端服务不可用时的降级方案

```javascript
async function callBackendWithFallback(apiCall, localFallback) {
  try {
    const result = await apiCall();

    // 检查后端是否响应
    if (result.status === 0 || result.error?.includes('无响应')) {
      console.warn('后端服务不可用，使用本地降级方案');
      return await localFallback();
    }

    return result;
  } catch (error) {
    console.error('API调用失败，使用降级方案:', error);
    return await localFallback();
  }
}

// 使用示例
ipcMain.handle('project:get-files', async (_event, projectId) => {
  return await callBackendWithFallback(
    // 尝试调用后端
    () => ProjectFileAPI.getFiles(projectId),
    // 降级到本地查询
    async () => {
      const files = await db.all(`
        SELECT * FROM project_files WHERE project_id = ?
      `, [projectId]);
      return { success: true, files };
    }
  );
});
```

### 2. 统一错误日志

```javascript
function logAPIError(operation, error) {
  const errorLog = {
    timestamp: new Date().toISOString(),
    operation,
    error: error.message,
    stack: error.stack
  };

  console.error('[API Error]', errorLog);

  // 可选：发送到日志服务
  // sendToLogService(errorLog);
}
```

## 测试建议

### 1. 单元测试

```javascript
// test/backend-client.test.js
const { ProjectFileAPI } = require('../src/main/api/backend-client');

describe('ProjectFileAPI', () => {
  it('should get files from backend', async () => {
    const result = await ProjectFileAPI.getFiles('test-project-id');
    expect(result).toHaveProperty('data');
  });
});
```

### 2. 集成测试

确保后端服务启动后运行：

```bash
# 启动Java服务
cd backend/project-service
mvn spring-boot:run

# 启动Python服务
cd backend/ai-service
uvicorn main:app --reload --port 8001

# 运行Electron测试
cd desktop-app-vue
npm run test
```

## 迁移检查清单

- [ ] 导入backend-client模块
- [ ] 替换`project:get-files` IPC handler
- [ ] 替换`project:update-file` IPC handler
- [ ] 替换所有`project:git-*` IPC handlers
- [ ] 添加`project:rag-*` IPC handlers
- [ ] 添加`project:code-*` IPC handlers
- [ ] 配置环境变量
- [ ] 添加错误降级处理
- [ ] 移除不再使用的本地Git库（isomorphic-git）
- [ ] 更新package.json依赖
- [ ] 测试所有API调用
- [ ] 更新相关文档

## 性能优化建议

### 1. 请求缓存

```javascript
const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 60 }); // 60秒缓存

ipcMain.handle('project:get-files', async (_event, projectId) => {
  const cacheKey = `files_${projectId}`;

  // 检查缓存
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // 调用API
  const result = await ProjectFileAPI.getFiles(projectId);

  // 缓存结果
  cache.set(cacheKey, result);

  return result;
});
```

### 2. 批量请求合并

```javascript
// 使用DataLoader模式合并请求
const DataLoader = require('dataloader');

const fileLoader = new DataLoader(async (fileIds) => {
  // 批量获取文件
  return Promise.all(
    fileIds.map(id => ProjectFileAPI.getFile(projectId, id))
  );
});
```

## 总结

完成迁移后的架构：

```
┌─────────────────┐
│   Renderer      │  Vue组件
│   (前端UI)      │
└────────┬────────┘
         │ IPC
┌────────▼────────┐
│   Main Process  │  Electron主进程
│   (IPC Bridge)  │  └─ backend-client.js
└────────┬────────┘
         │ HTTP
    ┌────┴────┐
    │         │
┌───▼───┐ ┌──▼──────┐
│ Java  │ │ Python  │  后端服务
│Service│ │ Service │
└───────┘ └─────────┘
```

**优势**：
- ✅ 前后端分离，易于维护
- ✅ 后端可独立部署和扩展
- ✅ 支持多客户端（Web/Mobile/Desktop）
- ✅ AI功能集中管理
- ✅ 更好的测试覆盖

**注意事项**：
- ⚠️ 需要确保后端服务可用性
- ⚠️ 增加网络延迟（本地调用→HTTP）
- ⚠️ 需要处理网络异常情况
- ⚠️ 建议保留关键功能的本地降级方案
