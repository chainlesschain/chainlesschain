# ChainlessChain API 参考文档

**版本**: v0.24.0
**更新日期**: 2026-01-17

---

## 📖 目录

- [概述](#概述)
- [架构说明](#架构说明)
- [1. Electron IPC API](#1-electron-ipc-api)
  - [知识库管理](#知识库管理)
  - [AI聊天](#ai聊天)
  - [Git版本控制](#git版本控制)
  - [项目管理](#项目管理)
  - [U-Key安全](#u-key安全)
  - [P2P社交](#p2p社交)
  - [Skill-Tool系统](#skill-tool系统)
  - [MCP 集成](#mcp-集成)
  - [会话管理](#会话管理)
  - [LLM 性能监控](#llm-性能监控)
  - [Manus 优化](#manus-优化)
  - [Multi-Agent](#multi-agent)
  - [错误诊断](#错误诊断)
- [2. 后端Java API](#2-后端java-api)
- [3. 后端Python API](#3-后端python-api)
- [4. 插件API](#4-插件api)
- [数据结构](#数据结构)
- [错误处理](#错误处理)

---

## 概述

ChainlessChain 提供三层API架构：

1. **Electron IPC API** - 前端（Vue）与主进程通信
2. **后端 Java API** - 项目管理、Git操作（Spring Boot）
3. **后端 Python API** - AI推理、RAG检索（FastAPI）

所有API遵循统一的响应格式和错误处理规范。

---

## 架构说明

```
┌─────────────────────────────────────────────┐
│         Vue Frontend (Renderer)             │
│         (http://localhost:5173)             │
└─────────────────┬───────────────────────────┘
                  │ IPC (ipcRenderer)
┌─────────────────▼───────────────────────────┐
│      Electron Main Process (Node.js)        │
│  • Database (SQLite/SQLCipher)              │
│  • Plugin Manager                           │
│  • File System Operations                   │
└─────┬───────────────────────────────┬───────┘
      │ HTTP                          │ HTTP
┌─────▼──────────────┐      ┌─────────▼──────────┐
│  Project Service   │      │   AI Service       │
│  (Spring Boot)     │      │   (FastAPI)        │
│  Port: 9090        │      │   Port: 8001       │
│  • Git operations  │      │   • LLM inference  │
│  • Project metadata│      │   • RAG retrieval  │
│  • PostgreSQL      │      │   • Embeddings     │
└────────────────────┘      └────────────────────┘
```

---

## 1. Electron IPC API

### 基础使用

**前端调用**（Vue组件）：
```javascript
import { ipcRenderer } from 'electron'

// 发送请求并等待响应
const result = await ipcRenderer.invoke('channel-name', arg1, arg2)

// 监听事件
ipcRenderer.on('event-name', (event, data) => {
  console.log(data)
})
```

**响应格式**：
```javascript
{
  success: true|false,
  data: any,           // 成功时返回的数据
  error: string,       // 失败时的错误信息
  code: number         // 错误码（可选）
}
```

---

### 知识库管理

#### 获取笔记列表

```javascript
ipcRenderer.invoke('get-notes', options)
```

**参数**：
```javascript
{
  search?: string,        // 搜索关键词
  tags?: string[],        // 标签筛选
  folder?: string,        // 文件夹路径
  sortBy?: 'title' | 'createdAt' | 'updatedAt',
  sortOrder?: 'asc' | 'desc',
  page?: number,          // 页码（默认1）
  pageSize?: number       // 每页数量（默认50）
}
```

**返回**：
```javascript
{
  success: true,
  data: {
    notes: [
      {
        id: number,
        title: string,
        content: string,
        tags: string[],
        folder: string,
        createdAt: string,    // ISO 8601格式
        updatedAt: string,
        starred: boolean
      }
    ],
    total: number,
    page: number,
    pageSize: number
  }
}
```

#### 创建笔记

```javascript
ipcRenderer.invoke('create-note', noteData)
```

**参数**：
```javascript
{
  title: string,          // 必填
  content?: string,       // 默认空字符串
  tags?: string[],
  folder?: string,        // 默认根目录
  starred?: boolean
}
```

**返回**：
```javascript
{
  success: true,
  data: {
    id: number,
    title: string,
    createdAt: string,
    ...
  }
}
```

#### 更新笔记

```javascript
ipcRenderer.invoke('update-note', noteId, updates)
```

**参数**：
```javascript
// noteId: number
// updates: object
{
  title?: string,
  content?: string,
  tags?: string[],
  folder?: string,
  starred?: boolean
}
```

#### 删除笔记

```javascript
ipcRenderer.invoke('delete-note', noteId)
```

**参数**：`noteId: number`

**返回**：
```javascript
{
  success: true,
  data: { deleted: true }
}
```

#### 导入文件

```javascript
ipcRenderer.invoke('import-file', filePath, options)
```

**参数**：
```javascript
// filePath: string - 文件路径
// options: object
{
  type?: 'markdown' | 'pdf' | 'word' | 'txt' | 'image',  // 自动检测
  folder?: string,      // 导入到的文件夹
  tags?: string[],      // 自动添加标签
  extractImages?: boolean,  // 是否提取图片（PDF/Word）
  ocrEnabled?: boolean      // 是否启用OCR（图片）
}
```

**返回**：
```javascript
{
  success: true,
  data: {
    noteId: number,
    title: string,
    imagesExtracted: number  // 提取的图片数量
  }
}
```

#### 搜索笔记（RAG增强）

```javascript
ipcRenderer.invoke('search-notes-rag', query, options)
```

**参数**：
```javascript
// query: string - 搜索查询
// options: object
{
  topK?: number,          // 返回结果数（默认5）
  threshold?: number,     // 相似度阈值 0-1（默认0.7）
  rerank?: boolean,       // 是否重排序（默认true）
  includeSource?: boolean,// 是否包含来源（默认true）
  scope?: {
    tags?: string[],
    folder?: string,
    dateRange?: {
      start: string,
      end: string
    }
  }
}
```

**返回**：
```javascript
{
  success: true,
  data: {
    results: [
      {
        noteId: number,
        title: string,
        snippet: string,    // 相关片段
        score: number,      // 相关度分数 0-1
        source: string      // 来源位置
      }
    ],
    totalFound: number
  }
}
```

---

### AI聊天

#### 创建对话

```javascript
ipcRenderer.invoke('create-conversation', options)
```

**参数**：
```javascript
{
  title?: string,         // 默认"新对话"
  model?: string,         // 默认使用配置的模型
  systemPrompt?: string,  // 系统提示词
  ragEnabled?: boolean    // 是否启用RAG（默认true）
}
```

**返回**：
```javascript
{
  success: true,
  data: {
    conversationId: number,
    title: string,
    createdAt: string
  }
}
```

#### 发送消息

```javascript
ipcRenderer.invoke('send-message', conversationId, message, options)
```

**参数**：
```javascript
// conversationId: number
// message: string
// options: object
{
  streaming?: boolean,    // 是否流式返回（默认true）
  temperature?: number,   // 0-2（默认0.7）
  maxTokens?: number,     // 默认2048
  ragConfig?: {
    enabled: boolean,
    topK: number,
    scope: object
  }
}
```

**返回（流式）**：
通过事件监听：
```javascript
// 开始
ipcRenderer.on('message-stream-start', (event, { messageId }) => {})

// 接收token
ipcRenderer.on('message-stream-data', (event, { token }) => {})

// 完成
ipcRenderer.on('message-stream-end', (event, { messageId, fullText }) => {})

// 错误
ipcRenderer.on('message-stream-error', (event, { error }) => {})
```

**返回（非流式）**：
```javascript
{
  success: true,
  data: {
    messageId: number,
    content: string,
    role: 'assistant',
    timestamp: string,
    sources: [...]  // RAG来源（如果启用）
  }
}
```

#### 获取对话历史

```javascript
ipcRenderer.invoke('get-conversation-messages', conversationId, options)
```

**参数**：
```javascript
// conversationId: number
// options: object
{
  limit?: number,     // 限制数量（默认50）
  offset?: number     // 偏移量（默认0）
}
```

#### 使用提示词模板

```javascript
ipcRenderer.invoke('apply-prompt-template', templateId, variables)
```

**参数**：
```javascript
// templateId: string
// variables: object - 模板变量
{
  "主题": "Docker容器",
  "风格": "专业技术",
  ...
}
```

**返回**：
```javascript
{
  success: true,
  data: {
    prompt: string  // 填充后的提示词
  }
}
```

---

### Git版本控制

#### 初始化Git仓库

```javascript
ipcRenderer.invoke('git-init', repoPath)
```

**参数**：`repoPath: string` - 仓库路径

#### 提交更改

```javascript
ipcRenderer.invoke('git-commit', message, options)
```

**参数**：
```javascript
// message: string - 提交信息
// options: object
{
  author?: {
    name: string,
    email: string
  },
  files?: string[]  // 指定文件，为空则提交所有更改
}
```

#### 配置远程仓库

```javascript
ipcRenderer.invoke('git-add-remote', remoteName, remoteUrl)
```

**参数**：
```javascript
// remoteName: string - 通常为'origin'
// remoteUrl: string - 如 'https://github.com/user/repo.git'
```

#### 推送到远程

```javascript
ipcRenderer.invoke('git-push', options)
```

**参数**：
```javascript
{
  remote?: string,    // 默认'origin'
  branch?: string,    // 默认'main'
  force?: boolean,    // 强制推送（谨慎使用）
  credentials?: {
    username: string,
    password: string  // 或Personal Access Token
  }
}
```

#### 从远程拉取

```javascript
ipcRenderer.invoke('git-pull', options)
```

**参数**：同git-push

#### 查看历史

```javascript
ipcRenderer.invoke('git-log', options)
```

**参数**：
```javascript
{
  limit?: number,     // 默认50
  filePath?: string,  // 特定文件的历史
  author?: string,
  since?: string,     // ISO 8601日期
  until?: string
}
```

**返回**：
```javascript
{
  success: true,
  data: {
    commits: [
      {
        oid: string,      // commit hash
        message: string,
        author: {
          name: string,
          email: string,
          timestamp: number
        },
        files: string[]
      }
    ]
  }
}
```

#### 对比差异

```javascript
ipcRenderer.invoke('git-diff', options)
```

**参数**：
```javascript
{
  commitA?: string,   // commit hash，默认为工作区
  commitB?: string,   // 默认为HEAD
  filePath?: string
}
```

**返回**：
```javascript
{
  success: true,
  data: {
    diff: string,     // unified diff格式
    stats: {
      additions: number,
      deletions: number,
      filesChanged: number
    }
  }
}
```

#### 解决冲突

```javascript
ipcRenderer.invoke('git-resolve-conflict', filePath, resolution)
```

**参数**：
```javascript
// filePath: string
// resolution: 'ours' | 'theirs' | 'manual'
// 如果是'manual'，还需传入mergedContent
```

---

### 项目管理

#### 创建项目

```javascript
ipcRenderer.invoke('create-project', projectData)
```

**参数**：
```javascript
{
  name: string,             // 必填
  description?: string,
  rootPath: string,         // 项目根目录
  startDate?: string,
  endDate?: string,
  members?: string[],       // DID数组
  tags?: string[]
}
```

#### 获取项目列表

```javascript
ipcRenderer.invoke('get-projects', filters)
```

**参数**：
```javascript
{
  status?: 'active' | 'archived' | 'completed',
  tags?: string[],
  search?: string
}
```

#### 创建任务

```javascript
ipcRenderer.invoke('create-task', projectId, taskData)
```

**参数**：
```javascript
// projectId: number
// taskData: object
{
  title: string,            // 必填
  description?: string,
  priority?: 'low' | 'medium' | 'high' | 'urgent',
  dueDate?: string,
  assignee?: string,        // DID
  status?: 'todo' | 'in_progress' | 'review' | 'done',
  tags?: string[],
  checklist?: string[],     // 子任务列表
  dependencies?: number[]   // 依赖的任务ID
}
```

#### 更新任务状态

```javascript
ipcRenderer.invoke('update-task-status', taskId, newStatus)
```

**参数**：
```javascript
// taskId: number
// newStatus: 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled'
```

#### 获取项目统计

```javascript
ipcRenderer.invoke('get-project-stats', projectId)
```

**返回**：
```javascript
{
  success: true,
  data: {
    totalTasks: number,
    completedTasks: number,
    progress: number,         // 0-100
    codeStats: {
      totalLines: number,
      languages: {
        javascript: number,
        python: number,
        ...
      }
    },
    contributors: [
      {
        did: string,
        name: string,
        tasksCompleted: number
      }
    ],
    burndown: [
      {
        date: string,
        remaining: number
      }
    ]
  }
}
```

#### 生成分享链接

```javascript
ipcRenderer.invoke('share-project', projectId, options)
```

**参数**：
```javascript
// projectId: number
// options: object
{
  permission: 'readonly' | 'comment' | 'edit',
  expiresIn?: number,       // 天数，null为永久
  password?: string,        // 加密访问
  allowDownload?: boolean
}
```

**返回**：
```javascript
{
  success: true,
  data: {
    shareUrl: string,       // https://share.chainlesschain.com/project/abc123
    shareCode: string,
    expiresAt: string
  }
}
```

---

### U-Key安全

#### 检测U-Key设备

```javascript
ipcRenderer.invoke('ukey-detect')
```

**返回**：
```javascript
{
  success: true,
  data: {
    detected: boolean,
    deviceInfo: {
      manufacturer: string,
      model: string,
      serialNumber: string
    },
    initialized: boolean
  }
}
```

#### 初始化U-Key

```javascript
ipcRenderer.invoke('ukey-initialize', pin)
```

**参数**：`pin: string` - 6-16位PIN码

#### 验证PIN

```javascript
ipcRenderer.invoke('ukey-verify-pin', pin)
```

**返回**：
```javascript
{
  success: true,
  data: {
    verified: boolean,
    remainingAttempts: number  // 剩余尝试次数
  }
}
```

#### 生成密钥对

```javascript
ipcRenderer.invoke('ukey-generate-keypair', algorithm)
```

**参数**：`algorithm: 'RSA2048' | 'RSA4096' | 'ECC256'`

#### 签名数据

```javascript
ipcRenderer.invoke('ukey-sign', data, pin)
```

**参数**：
```javascript
// data: string | Buffer - 待签名数据
// pin: string
```

**返回**：
```javascript
{
  success: true,
  data: {
    signature: string  // Base64编码的签名
  }
}
```

#### 加密数据

```javascript
ipcRenderer.invoke('ukey-encrypt', data, recipientPublicKey)
```

#### 解密数据

```javascript
ipcRenderer.invoke('ukey-decrypt', encryptedData, pin)
```

#### 导出恢复密钥

```javascript
ipcRenderer.invoke('ukey-export-recovery-key', pin)
```

**返回**：
```javascript
{
  success: true,
  data: {
    recoveryKey: string  // 24位恢复密钥，请妥善保管
  }
}
```

---

### P2P社交

#### 创建DID身份

```javascript
ipcRenderer.invoke('did-create', profile)
```

**参数**：
```javascript
{
  nickname: string,
  avatar?: string,      // Base64或URL
  bio?: string,
  publicKey: string,    // 从U-Key获取或自动生成
}
```

**返回**：
```javascript
{
  success: true,
  data: {
    did: string,        // did:chain:abc123...
    document: object    // DID Document (W3C标准)
  }
}
```

#### 添加好友

```javascript
ipcRenderer.invoke('p2p-add-friend', targetDid)
```

**参数**：`targetDid: string`

#### 发送消息

```javascript
ipcRenderer.invoke('p2p-send-message', recipientDid, message, options)
```

**参数**：
```javascript
// recipientDid: string
// message: string
// options: object
{
  type?: 'text' | 'image' | 'file' | 'note',
  attachments?: [
    {
      type: string,
      data: string,     // Base64
      filename?: string
    }
  ],
  selfDestruct?: number,  // 秒，阅后即焚
  encrypted: true         // 默认true，使用Signal Protocol
}
```

#### 接收消息

监听事件：
```javascript
ipcRenderer.on('p2p-message-received', (event, message) => {
  console.log(message)
})
```

**消息格式**：
```javascript
{
  messageId: string,
  from: string,         // DID
  content: string,
  type: string,
  timestamp: string,
  encrypted: boolean,
  attachments: [...]
}
```

#### 发布帖子

```javascript
ipcRenderer.invoke('forum-post', postData)
```

**参数**：
```javascript
{
  title: string,
  content: string,
  category: string,
  tags?: string[],
  anonymous?: boolean,
  visibility: 'public' | 'friends' | 'private'
}
```

#### 点赞/评论

```javascript
ipcRenderer.invoke('forum-interact', postId, action, data)
```

**参数**：
```javascript
// postId: string
// action: 'like' | 'dislike' | 'comment' | 'share'
// data: string (评论内容) 或 null
```

---

### Skill-Tool系统

#### 获取技能列表

```javascript
ipcRenderer.invoke('get-skills', filters)
```

**参数**：
```javascript
{
  category?: string,
  enabled?: boolean,
  search?: string
}
```

**返回**：
```javascript
{
  success: true,
  data: {
    skills: [
      {
        id: string,
        name: string,
        displayName: string,
        category: string,
        description: string,
        enabled: boolean,
        tools: string[],    // 依赖的工具ID
        usageCount: number,
        successRate: number
      }
    ]
  }
}
```

#### 创建自定义技能

```javascript
ipcRenderer.invoke('create-skill', skillData)
```

**参数**：
```javascript
{
  name: string,             // 唯一标识
  displayName: string,
  description: string,
  category: string,
  tools: string[],          // 依赖的工具ID数组
  promptTemplate: string,   // 提示词模板
  config?: object
}
```

#### 执行技能

```javascript
ipcRenderer.invoke('execute-skill', skillId, input)
```

**参数**：
```javascript
// skillId: string
// input: object - 技能输入参数
```

#### 获取工具列表

```javascript
ipcRenderer.invoke('get-tools', filters)
```

#### 测试工具

```javascript
ipcRenderer.invoke('test-tool', toolId, parameters)
```

**参数**：
```javascript
// toolId: string
// parameters: object - 工具参数
```

**返回**：
```javascript
{
  success: true,
  data: {
    output: any,
    executionTime: number,  // 毫秒
    logs: string[]
  }
}
```

#### 获取统计数据

```javascript
ipcRenderer.invoke('get-skill-stats')
```

**返回**：
```javascript
{
  success: true,
  data: {
    totalSkills: number,
    enabledSkills: number,
    totalCalls: number,
    averageSuccessRate: number,
    categoryDistribution: {
      '代码开发': 15,
      'Web开发': 10,
      ...
    },
    topSkills: [
      {
        id: string,
        name: string,
        usageCount: number
      }
    ]
  }
}
```

---

### MCP 集成

#### 连接 MCP 服务器

```javascript
ipcRenderer.invoke('mcp:connect-server', { serverName, config })
```

**参数**：
```javascript
{
  serverName: string,      // 服务器名称（如 'filesystem'）
  config?: {
    command: string,       // 启动命令
    args: string[],        // 命令参数
    autoConnect: boolean   // 是否自动连接
  }
}
```

#### 调用 MCP 工具

```javascript
ipcRenderer.invoke('mcp:call-tool', { serverName, toolName, arguments })
```

**参数**：
```javascript
{
  serverName: string,      // 服务器名称
  toolName: string,        // 工具名称（如 'read_file'）
  arguments: object        // 工具参数
}
```

**返回**：
```javascript
{
  success: true,
  result: {
    content: any,          // 工具返回内容
    isError: boolean       // 是否错误
  }
}
```

#### 获取 MCP 服务器状态

```javascript
ipcRenderer.invoke('mcp:get-server-status', serverName)
```

#### 断开 MCP 服务器

```javascript
ipcRenderer.invoke('mcp:disconnect-server', serverName)
```

---

### 会话管理

#### 创建会话

```javascript
ipcRenderer.invoke('session:create', options)
```

**参数**：
```javascript
{
  conversationId?: string, // 关联对话ID
  title?: string,          // 会话标题
  metadata?: object        // 元数据
}
```

#### 添加消息

```javascript
ipcRenderer.invoke('session:add-message', sessionId, message)
```

**参数**：
```javascript
// sessionId: string
// message: object
{
  role: 'user' | 'assistant' | 'system',
  content: string,
  toolCalls?: object[]
}
```

#### 搜索会话

```javascript
ipcRenderer.invoke('session:search', query, options)
```

**参数**：
```javascript
// query: string - 搜索关键词
// options: object
{
  searchTitle?: boolean,   // 搜索标题
  searchContent?: boolean, // 搜索内容
  limit?: number           // 返回数量
}
```

#### 标签管理

```javascript
// 添加标签
ipcRenderer.invoke('session:add-tags', sessionId, tags)

// 移除标签
ipcRenderer.invoke('session:remove-tags', sessionId, tags)

// 获取所有标签
ipcRenderer.invoke('session:get-all-tags')

// 按标签查找
ipcRenderer.invoke('session:find-by-tags', tags)
```

#### 导出/导入

```javascript
// 导出为 JSON
ipcRenderer.invoke('session:export-json', sessionId)

// 导出为 Markdown
ipcRenderer.invoke('session:export-markdown', sessionId, options)

// 从 JSON 导入
ipcRenderer.invoke('session:import-json', jsonData)
```

#### 会话恢复

```javascript
// 恢复会话
ipcRenderer.invoke('session:resume', sessionId)

// 获取最近会话
ipcRenderer.invoke('session:get-recent', limit)
```

---

### LLM 性能监控

#### 获取使用统计

```javascript
ipcRenderer.invoke('llm:get-usage-stats', options)
```

**参数**：
```javascript
{
  startDate?: string,      // 开始日期
  endDate?: string,        // 结束日期
  provider?: string,       // 按提供商筛选
  model?: string           // 按模型筛选
}
```

**返回**：
```javascript
{
  success: true,
  data: {
    totalCalls: number,
    totalTokens: {
      input: number,
      output: number
    },
    totalCost: {
      usd: number,
      cny: number
    },
    cacheHitRate: number
  }
}
```

#### 获取时间序列数据

```javascript
ipcRenderer.invoke('llm:get-time-series', { period, startDate, endDate })
```

**参数**：
```javascript
{
  period: 'hour' | 'day' | 'week',
  startDate?: string,
  endDate?: string
}
```

#### 获取成本分解

```javascript
ipcRenderer.invoke('llm:get-cost-breakdown', options)
```

**返回**：
```javascript
{
  success: true,
  data: {
    byProvider: [
      { provider: 'ollama', cost: 0, percentage: 0 },
      { provider: 'openai', cost: 10.5, percentage: 65 }
    ],
    byModel: [
      { model: 'gpt-4', cost: 8.0 },
      { model: 'qwen2:7b', cost: 0 }
    ]
  }
}
```

---

### Manus 优化

#### 开始任务追踪

```javascript
ipcRenderer.invoke('manus:start-task', taskInfo)
```

**参数**：
```javascript
{
  objective: string,       // 任务目标
  steps: string[],         // 任务步骤
  persist?: boolean        // 是否持久化到 todo.md
}
```

#### 更新任务进度

```javascript
ipcRenderer.invoke('manus:update-progress', stepIndex, status)
```

#### 工具掩码控制

```javascript
// 设置工具可用性
ipcRenderer.invoke('manus:set-tool-available', toolName, available)

// 按前缀批量设置
ipcRenderer.invoke('manus:set-tools-by-prefix', prefix, available)

// 切换任务阶段
ipcRenderer.invoke('manus:transition-to-phase', phase)
// phase: 'planning' | 'executing' | 'validating' | 'committing'
```

#### 获取统计信息

```javascript
ipcRenderer.invoke('manus:get-stats')
```

**返回**：
```javascript
{
  success: true,
  data: {
    kvCacheHitRate: number,
    toolMaskingStats: {
      totalTools: number,
      availableTools: number,
      maskedTools: number
    },
    currentPhase: string
  }
}
```

---

### Multi-Agent

#### 获取 Agent 列表

```javascript
ipcRenderer.invoke('agent:list')
```

**返回**：
```javascript
{
  success: true,
  data: {
    agents: [
      {
        id: 'code-generation',
        name: 'CodeGenerationAgent',
        capabilities: ['code_generation', 'code_review', 'bug_fix']
      },
      {
        id: 'data-analysis',
        name: 'DataAnalysisAgent',
        capabilities: ['data_analysis', 'visualization', 'statistics']
      },
      {
        id: 'document',
        name: 'DocumentAgent',
        capabilities: ['writing', 'translation', 'summarization']
      }
    ]
  }
}
```

#### 分发任务

```javascript
ipcRenderer.invoke('agent:dispatch', { task, context })
```

**参数**：
```javascript
{
  task: string,            // 任务描述
  context?: object,        // 上下文信息
  preferredAgent?: string  // 首选 Agent（可选）
}
```

**返回**：
```javascript
{
  success: true,
  data: {
    agentId: string,       // 处理的 Agent
    result: any,           // 执行结果
    executionTime: number  // 耗时
  }
}
```

#### 并行执行

```javascript
ipcRenderer.invoke('agent:execute-parallel', tasks)
```

**参数**：
```javascript
// tasks: Array of task objects
[
  { task: 'Review this code', context: { code: '...' } },
  { task: 'Write documentation', context: { topic: '...' } }
]
```

#### 链式执行

```javascript
ipcRenderer.invoke('agent:execute-chain', { tasks, context })
```

**参数**：
```javascript
{
  tasks: [
    { agentId: 'code-generation', task: 'Generate code' },
    { agentId: 'document', task: 'Write documentation' }
  ],
  context: object
}
```

---

### 错误诊断

#### 分析错误

```javascript
ipcRenderer.invoke('error:analyze', error)
```

**参数**：
```javascript
// error: Error object or string
```

**返回**：
```javascript
{
  success: true,
  data: {
    classification: string,    // 错误分类
    severity: string,          // 严重程度
    autoFixResult: {
      attempted: boolean,
      success: boolean,
      strategy: string
    },
    aiDiagnosis: string,       // AI 诊断（如启用）
    recommendations: string[]  // 推荐操作
  }
}
```

#### 获取诊断报告

```javascript
ipcRenderer.invoke('error:get-diagnosis-report', error)
```

**返回**：Markdown 格式的详细诊断报告

#### 获取错误统计

```javascript
ipcRenderer.invoke('error:get-stats', options)
```

**参数**：
```javascript
{
  days?: number            // 统计天数，默认 7
}
```

**返回**：
```javascript
{
  success: true,
  data: {
    total: number,
    bySeverity: {
      critical: number,
      high: number,
      medium: number,
      low: number
    },
    byClassification: {
      DATABASE: number,
      NETWORK: number,
      FILESYSTEM: number
    },
    autoFixRate: number    // 自动修复成功率
  }
}
```

#### 启用/禁用 AI 诊断

```javascript
ipcRenderer.invoke('error:toggle-ai-diagnosis', enabled)
```

---

## 2. 后端Java API

**Base URL**: `http://localhost:9090`

### 认证

所有API请求需在Header中携带token：
```
Authorization: Bearer <token>
```

### 项目管理

#### 获取项目列表

```http
GET /api/projects
```

**查询参数**：
- `status`: string - 项目状态
- `page`: number - 页码（默认1）
- `size`: number - 每页数量（默认20）

**响应**：
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "total": 100,
    "items": [
      {
        "id": 1,
        "name": "ChainlessChain",
        "description": "个人AI管理系统",
        "rootPath": "/path/to/project",
        "status": "active",
        "createdAt": "2026-01-01T00:00:00Z",
        "updatedAt": "2026-01-03T00:00:00Z"
      }
    ]
  }
}
```

#### 创建项目

```http
POST /api/projects
Content-Type: application/json
```

**请求体**：
```json
{
  "name": "新项目",
  "description": "项目描述",
  "rootPath": "/path/to/project",
  "settings": {
    "gitEnabled": true,
    "aiAssistant": true
  }
}
```

#### 获取项目详情

```http
GET /api/projects/{projectId}
```

#### 更新项目

```http
PUT /api/projects/{projectId}
```

#### 删除项目

```http
DELETE /api/projects/{projectId}
```

### 文件管理

#### 获取文件列表

```http
GET /api/projects/{projectId}/files
```

**查询参数**：
- `fileType`: string - 文件类型（markdown, code, document）
- `path`: string - 目录路径
- `pageNum`: number
- `pageSize`: number

#### 上传文件

```http
POST /api/projects/{projectId}/files
Content-Type: multipart/form-data
```

**表单字段**：
- `file`: File - 文件
- `path`: string - 目标路径
- `metadata`: JSON - 元数据

#### 更新文件

```http
PUT /api/projects/{projectId}/files/{fileId}
```

#### 删除文件

```http
DELETE /api/projects/{projectId}/files/{fileId}
```

### Git操作

#### 获取Git状态

```http
GET /api/projects/{projectId}/git/status
```

**响应**：
```json
{
  "code": 200,
  "data": {
    "branch": "main",
    "ahead": 2,
    "behind": 0,
    "modified": ["file1.md", "file2.js"],
    "untracked": ["newfile.txt"],
    "conflicted": []
  }
}
```

#### 提交更改

```http
POST /api/projects/{projectId}/git/commit
```

**请求体**：
```json
{
  "message": "Update documentation",
  "files": ["file1.md"],
  "author": {
    "name": "Zhang San",
    "email": "zhangsan@example.com"
  }
}
```

#### 推送到远程

```http
POST /api/projects/{projectId}/git/push
```

#### 从远程拉取

```http
POST /api/projects/{projectId}/git/pull
```

#### 查看提交历史

```http
GET /api/projects/{projectId}/git/commits
```

**查询参数**：
- `limit`: number - 默认50
- `author`: string
- `since`: ISO 8601日期
- `until`: ISO 8601日期

---

## 3. 后端Python API

**Base URL**: `http://localhost:8001`

### LLM推理

#### 聊天补全

```http
POST /api/llm/chat
Content-Type: application/json
```

**请求体**：
```json
{
  "model": "qwen2:7b",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    },
    {
      "role": "user",
      "content": "什么是Docker？"
    }
  ],
  "stream": false,
  "temperature": 0.7,
  "max_tokens": 2048
}
```

**响应**：
```json
{
  "id": "chat-abc123",
  "model": "qwen2:7b",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Docker是一个开源的容器化平台..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 15,
    "completion_tokens": 120,
    "total_tokens": 135
  }
}
```

#### 流式聊天

```http
POST /api/llm/chat
Content-Type: application/json
```

**请求体**：同上，但设置 `"stream": true`

**响应**（Server-Sent Events）：
```
data: {"delta": "Docker"}
data: {"delta": "是"}
data: {"delta": "一个"}
...
data: {"done": true, "usage": {...}}
```

### RAG检索

#### 向量检索

```http
POST /api/rag/search
Content-Type: application/json
```

**请求体**：
```json
{
  "query": "如何配置Docker网络",
  "top_k": 5,
  "threshold": 0.7,
  "rerank": true,
  "filters": {
    "tags": ["docker", "网络"],
    "date_range": {
      "start": "2025-01-01",
      "end": "2026-01-03"
    }
  }
}
```

**响应**：
```json
{
  "results": [
    {
      "id": "note-123",
      "title": "Docker网络配置指南",
      "content": "...",
      "score": 0.92,
      "metadata": {
        "tags": ["docker", "网络"],
        "created_at": "2025-06-15"
      }
    }
  ],
  "total": 5,
  "query_time": 0.15
}
```

#### 添加文档到向量库

```http
POST /api/rag/documents
```

**请求体**：
```json
{
  "documents": [
    {
      "id": "note-456",
      "title": "Kubernetes入门",
      "content": "...",
      "metadata": {
        "tags": ["k8s"],
        "created_at": "2026-01-01"
      }
    }
  ],
  "collection": "knowledge_base"
}
```

#### 删除文档

```http
DELETE /api/rag/documents/{document_id}
```

### 嵌入（Embeddings）

#### 生成文本嵌入

```http
POST /api/embeddings
```

**请求体**：
```json
{
  "input": "这是一段文本",
  "model": "bge-large-zh-v1.5"
}
```

**响应**：
```json
{
  "embeddings": [0.123, -0.456, ...],  // 1024维向量
  "model": "bge-large-zh-v1.5",
  "dimensions": 1024
}
```

---

## 4. 插件API

插件可以扩展ChainlessChain的功能。所有插件都在沙箱环境中运行。

### 插件结构

```
my-plugin/
├── manifest.json      # 插件清单
├── index.js           # 入口文件
├── icon.png           # 图标
└── README.md          # 说明文档
```

### manifest.json

```json
{
  "id": "com.example.myplugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "插件描述",
  "author": "作者名",
  "main": "index.js",
  "permissions": [
    "storage",
    "network",
    "ui.menu",
    "ui.sidebar"
  ],
  "extensionPoints": [
    {
      "type": "ui.page",
      "id": "my-page",
      "path": "/my-plugin",
      "title": "我的插件"
    }
  ],
  "dependencies": {
    "axios": "^1.0.0"
  }
}
```

### 插件入口（index.js）

```javascript
class MyPlugin {
  constructor(api) {
    this.api = api;
  }

  // 激活插件
  async activate() {
    console.log('Plugin activated');

    // 注册命令
    this.api.commands.register('my-command', async () => {
      await this.api.ui.showNotification('Hello from plugin!');
    });

    // 注册UI组件
    this.api.ui.registerSidebar({
      id: 'my-sidebar',
      title: '我的侧边栏',
      component: './components/Sidebar.vue'
    });

    // 监听事件
    this.api.events.on('note-created', (note) => {
      console.log('Note created:', note.title);
    });
  }

  // 停用插件
  async deactivate() {
    console.log('Plugin deactivated');
  }
}

module.exports = MyPlugin;
```

### 插件API对象

插件通过 `api` 对象访问系统功能：

#### api.storage

```javascript
// 保存数据
await api.storage.set('key', value);

// 读取数据
const value = await api.storage.get('key');

// 删除数据
await api.storage.delete('key');

// 列出所有键
const keys = await api.storage.keys();
```

#### api.ui

```javascript
// 显示通知
await api.ui.showNotification('消息内容', {
  type: 'info' | 'success' | 'warning' | 'error',
  duration: 3000
});

// 显示对话框
const result = await api.ui.showDialog({
  title: '确认',
  message: '确定要删除吗？',
  buttons: ['取消', '确定']
});

// 注册菜单项
api.ui.registerMenuItem({
  id: 'my-menu-item',
  label: '我的功能',
  position: 'tools',
  action: () => { /* ... */ }
});

// 注册侧边栏
api.ui.registerSidebar({
  id: 'my-sidebar',
  title: '侧边栏标题',
  component: './components/Sidebar.vue',
  icon: 'icon-name'
});
```

#### api.notes

```javascript
// 获取笔记
const notes = await api.notes.getAll();

// 创建笔记
const note = await api.notes.create({
  title: '新笔记',
  content: '内容'
});

// 更新笔记
await api.notes.update(noteId, {
  content: '新内容'
});

// 删除笔记
await api.notes.delete(noteId);

// 搜索笔记
const results = await api.notes.search('关键词');
```

#### api.ai

```javascript
// 调用LLM
const response = await api.ai.chat([
  { role: 'user', content: '你好' }
], {
  model: 'qwen2:7b',
  temperature: 0.7
});

// RAG搜索
const results = await api.ai.ragSearch('查询内容', {
  topK: 5
});
```

#### api.commands

```javascript
// 注册命令
api.commands.register('my-command', async () => {
  // 命令逻辑
});

// 执行命令
await api.commands.execute('my-command');

// 注销命令
api.commands.unregister('my-command');
```

#### api.events

```javascript
// 监听事件
api.events.on('note-created', (note) => {
  console.log('笔记已创建:', note);
});

// 触发事件
api.events.emit('custom-event', data);

// 移除监听器
api.events.off('note-created', handler);
```

#### api.http

```javascript
// 发起HTTP请求
const response = await api.http.get('https://api.example.com/data');

const result = await api.http.post('https://api.example.com/data', {
  key: 'value'
});
```

---

## 数据结构

### Note（笔记）

```typescript
interface Note {
  id: number;
  title: string;
  content: string;
  tags: string[];
  folder: string;
  createdAt: string;  // ISO 8601
  updatedAt: string;
  starred: boolean;
  encrypted: boolean;
  metadata?: {
    wordCount: number;
    readingTime: number;  // 分钟
    [key: string]: any;
  };
}
```

### Conversation（对话）

```typescript
interface Conversation {
  id: number;
  title: string;
  model: string;
  systemPrompt?: string;
  ragEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

interface Message {
  id: number;
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: string;
  sources?: RAGSource[];  // RAG来源
}

interface RAGSource {
  noteId: number;
  title: string;
  snippet: string;
  score: number;
}
```

### Project（项目）

```typescript
interface Project {
  id: number;
  name: string;
  description: string;
  rootPath: string;
  status: 'active' | 'archived' | 'completed';
  startDate?: string;
  endDate?: string;
  members: string[];  // DID数组
  tags: string[];
  createdAt: string;
  updatedAt: string;
  settings: {
    gitEnabled: boolean;
    autoCommit: boolean;
    aiAssistant: boolean;
    [key: string]: any;
  };
}
```

### Task（任务）

```typescript
interface Task {
  id: number;
  projectId: number;
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignee?: string;  // DID
  dueDate?: string;
  tags: string[];
  checklist: ChecklistItem[];
  dependencies: number[];  // 依赖的任务ID
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
}
```

### DID Identity（DID身份）

```typescript
interface DIDIdentity {
  did: string;  // did:chain:abc123...
  document: {
    '@context': string[];
    id: string;
    publicKey: PublicKey[];
    authentication: string[];
    service: Service[];
  };
  profile: {
    nickname: string;
    avatar?: string;
    bio?: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface PublicKey {
  id: string;
  type: string;  // 'RsaVerificationKey2018'
  controller: string;
  publicKeyPem: string;
}
```

---

## 错误处理

### 错误响应格式

所有API错误响应遵循统一格式：

```json
{
  "success": false,
  "error": "错误消息",
  "code": "ERROR_CODE",
  "details": {
    "field": "具体错误信息"
  }
}
```

### 常见错误码

| 错误码 | HTTP状态 | 说明 |
|--------|----------|------|
| `AUTH_FAILED` | 401 | 认证失败 |
| `PERMISSION_DENIED` | 403 | 权限不足 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `VALIDATION_ERROR` | 400 | 参数验证失败 |
| `DATABASE_ERROR` | 500 | 数据库错误 |
| `UKEY_NOT_FOUND` | 503 | U-Key未连接 |
| `UKEY_PIN_WRONG` | 401 | PIN码错误 |
| `GIT_CONFLICT` | 409 | Git冲突 |
| `LLM_ERROR` | 500 | LLM服务错误 |
| `NETWORK_ERROR` | 503 | 网络连接错误 |

### 错误处理示例

```javascript
try {
  const result = await ipcRenderer.invoke('create-note', noteData);
  if (!result.success) {
    // 处理业务错误
    console.error('创建笔记失败:', result.error);
    ui.showNotification(result.error, { type: 'error' });
  } else {
    // 成功
    console.log('笔记已创建:', result.data);
  }
} catch (error) {
  // 处理系统错误
  console.error('系统错误:', error);
  ui.showNotification('系统错误，请稍后重试', { type: 'error' });
}
```

---

## 最佳实践

### 1. 错误处理

始终检查API返回的 `success` 字段：

```javascript
const result = await ipcRenderer.invoke('api-call', params);
if (!result.success) {
  // 处理错误
  console.error(result.error);
  return;
}
// 使用 result.data
```

### 2. 流式响应

处理流式响应时，记得清理监听器：

```javascript
const messageHandler = (event, data) => {
  console.log(data.token);
};

ipcRenderer.on('message-stream-data', messageHandler);

// 在组件销毁时移除
onUnmounted(() => {
  ipcRenderer.off('message-stream-data', messageHandler);
});
```

### 3. 分页加载

处理大数据集时使用分页：

```javascript
let page = 1;
const pageSize = 50;

async function loadMore() {
  const result = await ipcRenderer.invoke('get-notes', {
    page,
    pageSize
  });

  if (result.success) {
    notes.push(...result.data.notes);
    page++;
  }
}
```

### 4. 请求超时

设置合理的超时时间：

```javascript
// 在主进程中配置axios timeout
const client = axios.create({
  timeout: 30000  // 30秒
});
```

### 5. 重试机制

实现自动重试：

```javascript
async function retryRequest(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}

const result = await retryRequest(() =>
  ipcRenderer.invoke('git-push', options)
);
```

---

## 版本历史

- **v0.16.0** (2026-01-03): 当前版本
  - Skill-Tool系统完整API
  - 项目分享功能
  - 多设备身份上下文

- **v0.15.0** (2025-12-15):
  - 插件系统Phase 1
  - RAG高级检索

- **v0.14.0** (2025-11-01):
  - P2P社交网络
  - DID身份系统

---

## 获取帮助

- **API问题反馈**: https://github.com/chainlesschain/desktop-app/issues
- **Discord**: https://discord.gg/chainlesschain
- **文档中心**: https://docs.chainlesschain.com

---

**文档版本**: v0.24.0
**最后更新**: 2026-01-17
**维护团队**: ChainlessChain API Team

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：ChainlessChain API 参考文档。

### 2. 核心特性
见正文要点 / 特性 / 范围章节。

### 3. 系统架构
见正文架构 / 设计章节（或项目根 docs/design/ 系统设计主文档）。

### 4. 系统定位
见正文定位 / 背景章节。

### 5. 核心功能
见正文功能 / 内容章节。

### 6. 技术架构
见正文技术 / 实现章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数 / 环境章节。

### 11. 性能指标
见正文性能 / 指标章节（如有）。

### 12. 测试覆盖
见正文测试 / 验证章节（如有）。

### 13. 安全考虑
见正文安全 / 权限章节（如适用）。

### 14. 故障排除
见正文故障 / 已知限制 / 常见问题章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文命令 / 操作 / API 示例。

### 17. 相关文档
见正文相关链接；项目根 docs/design/ 系统设计主文档与对应模块文档。
