# 项目对话文件操作修复计划

## 问题诊断

### 问题描述
在项目详情页的对话功能中，用户无法通过自然语言对话来生成文件或修改项目中的现有文件。

### 根本原因分析

通过全面的代码探索，我发现了三个关键问题：

#### 1. **架构分离问题**（核心问题）

系统存在两套独立的AI处理流程：

**流程A：项目创建**（✅ 工作正常）
```
用户输入 → project:create-stream IPC
→ 后端 /api/projects/create/stream
→ AI生成完整文件 → 自动写入文件系统
```

**流程B：项目对话**（❌ 文件操作缺失）
```
用户输入 → llm:chat IPC
→ LLM返回文本响应
→ 显示在聊天界面 → [无文件操作执行]
```

#### 2. **前端缺失：响应解析器**

**位置**：`desktop-app-vue/src/renderer/components/projects/ChatPanel.vue`

- ✅ 已实现：构建项目上下文（文件列表、文件内容）传递给AI
- ✅ 已实现：调用 `window.electronAPI.llm.chat()` 获取AI响应
- ❌ 缺失：从AI响应中解析文件操作指令
- ❌ 缺失：执行文件操作的UI交互
- ❌ 缺失：文件操作结果的反馈展示

#### 3. **主进程缺失：统一编排器**

**位置**：`desktop-app-vue/src/main/index.js`

- ✅ 已有：`llm:chat` handler（纯对话）
- ✅ 已有：`file:readContent`, `file:writeContent` 等文件操作handlers
- ✅ 已有：AI引擎系统（`task-planner-enhanced.js`, `function-caller.js`）
- ❌ 缺失：`project:chat-with-action` handler（对话 + 文件操作）
- ❌ 缺失：AI引擎与对话流程的集成

#### 4. **后端缺失：项目对话API**

**位置**：`backend/ai-service/main.py`

- ✅ 已有：`/api/projects/create/stream`（项目创建）
- ✅ 已有：`/api/rag/query`（RAG检索）
- ⚠️ 部分实现：`/api/tasks/execute`（仅为stub，无实际功能）
- ❌ 缺失：`/api/projects/{id}/chat`（带文件操作的项目对话API）

### 关键发现

| 组件 | 功能完整度 | 缺失内容 |
|------|-----------|---------|
| ChatPanel.vue | 70% | AI响应解析、操作执行UI |
| index.js (Main) | 60% | 对话-操作桥接handler |
| AI Engine | 80% | 与对话流程集成 |
| Backend API | 40% | 项目对话API实现 |

---

## 用户需求确认

✅ **操作模式**：自动执行（AI直接创建/修改/删除文件，操作后显示结果）
✅ **功能范围**：完整CRUD（创建、读取、更新、删除全部支持）
✅ **实现范围**：全栈实现（前端 + Electron主进程 + 后端AI服务）

## 实现方案

### 方案架构

```
┌─────────────────────────────────────────────────────────────┐
│  前端 (ChatPanel.vue)                                        │
│  ┌─────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ 用户输入    │ -> │ 发送消息     │ -> │ 解析响应     │  │
│  └─────────────┘    └──────────────┘    └──────────────┘  │
│                            ↓                    ↓           │
│                     project:aiChat       显示结果 + 操作   │
└───────────────────────────────┼──────────────────────────────┘
                                ↓
┌───────────────────────────────┼──────────────────────────────┐
│  主进程 (index.js)            ↓                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │ ipcMain.handle('project:aiChat')                   │    │
│  │  1. 获取RAG上下文                                   │    │
│  │  2. 构建增强prompt                                  │    │
│  │  3. 调用LLM（带function calling schema）           │    │
│  │  4. 解析响应提取文件操作                            │    │
│  │  5. 执行文件操作                                    │    │
│  │  6. 返回响应 + 操作结果                             │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 实现步骤

#### 第一阶段：主进程桥接层（核心）

**优先级：🔥 最高**

##### 1.1 创建新的IPC Handler

**文件**：`desktop-app-vue/src/main/index.js`

创建 `ipcMain.handle('project:aiChat')` handler，集成以下功能：
- 接收参数：`{ projectId, userMessage, contextMode, currentFile }`
- 获取RAG上下文（调用现有的 `projectRAG.enhancedQuery()`）
- 构建增强的系统提示词（包含项目上下文 + 可用操作）
- 调用LLM（使用现有的 `llmManager.chatWithMessages()`）
- 解析AI响应提取文件操作
- 执行文件操作（调用现有的文件IPC handlers）
- 保存对话记录（包含操作结果）
- 返回响应和操作结果

##### 1.2 创建AI响应解析器

**新文件**：`desktop-app-vue/src/main/ai-engine/response-parser.js`

实现功能：
- 检测AI响应中的文件操作意图
- 支持多种格式：
  - JSON结构化响应：`{ "operation": "create", "path": "...", "content": "..." }`
  - Markdown代码块：````file:path/to/file.js``` [code] ````
  - 自然语言命令：解析 "创建一个文件xxx"、"修改文件yyy"
- 提取操作类型：CREATE / UPDATE / DELETE / READ
- 提取文件路径、内容、语言类型
- 返回结构化操作列表

##### 1.3 创建操作执行器

**新文件**：`desktop-app-vue/src/main/ai-engine/conversation-executor.js`

实现功能：
- 接收操作列表
- 验证操作安全性（路径合法性、权限检查）
- 按顺序执行操作
- 处理执行错误
- 返回每个操作的结果
- 记录操作历史

#### 第二阶段：前端集成

**优先级：🔥 高**

##### 2.1 更新 ChatPanel.vue

**文件**：`desktop-app-vue/src/renderer/components/projects/ChatPanel.vue`

修改内容：
1. **消息发送逻辑** (`handleSendMessage` 方法)
   - 改为调用新的 `window.electronAPI.project.aiChat()`
   - 传递项目ID和上下文信息

2. **响应处理逻辑**
   - 处理返回的 `{ conversationResponse, fileOperations, ragSources }`
   - 显示对话响应（文本）
   - 显示文件操作列表（新增UI组件）
   - 显示RAG来源（已有）

3. **新增UI组件：FileOperationsList**
   - 显示即将执行或已执行的文件操作
   - 支持操作确认/取消（可选）
   - 显示操作状态（成功/失败）
   - 点击查看文件内容

##### 2.2 创建文件操作显示组件

**新文件**：`desktop-app-vue/src/renderer/components/projects/FileOperationsList.vue`

功能：
- 以列表形式显示文件操作
- 每个操作显示：类型、文件路径、状态
- 支持展开查看文件内容（code diff）
- 支持点击跳转到文件
- 支持撤销操作（如果需要）

##### 2.3 更新 Preload API

**文件**：`desktop-app-vue/src/preload/index.js`

添加新的API暴露：
```javascript
project: {
  // ... 现有方法
  aiChat: (data) => ipcRenderer.invoke('project:aiChat', data)
}
```

#### 第三阶段：Prompt工程优化

**优先级：🟡 中**

##### 3.1 设计系统提示词模板

**新文件**：`desktop-app-vue/src/main/prompt/project-conversation.hbs`

包含内容：
- 项目基本信息（名称、类型、描述）
- 项目文件结构（树形展示）
- 可用的文件操作（CREATE / UPDATE / DELETE / READ）
- 操作格式规范（JSON schema）
- 示例对话

##### 3.2 集成提示词模板

更新 `project:aiChat` handler 使用模板引擎（Handlebars）构建系统提示词

#### 第四阶段：后端API扩展（必需）

**优先级：🔥 高**

根据用户需求，需要实现完整的后端项目对话API：

##### 4.1 实现项目对话API

**文件**：`backend/ai-service/main.py`

创建 `POST /api/projects/{project_id}/chat` endpoint：
- **请求格式**：
  ```python
  {
    "project_id": "项目ID",
    "user_message": "用户输入",
    "conversation_history": [...],  # 可选
    "context_mode": "project|file|global",
    "current_file": "path/to/file"  # 可选
  }
  ```
- **处理流程**：
  1. 使用RAG检索相关项目文件（调用现有的 `rag_system.query_enhanced()`）
  2. 构建增强的系统提示词（包含项目上下文）
  3. 调用LLM（带function calling schema）
  4. 解析LLM响应提取文件操作
  5. 返回响应 + 文件操作指令（不执行，由主进程执行）
- **响应格式**：
  ```python
  {
    "response": "AI文本回复",
    "operations": [
      {
        "type": "CREATE|UPDATE|DELETE|READ",
        "path": "相对路径",
        "content": "文件内容",
        "language": "文件类型"
      }
    ],
    "rag_sources": [...]
  }
  ```

##### 4.2 扩展 Function Calling Schema

**文件**：`backend/ai-service/engines/function_schemas.py`（新建）

定义文件操作的function calling schema：
```python
FILE_OPERATIONS_SCHEMA = {
    "name": "file_operations",
    "description": "Execute file operations in the project",
    "parameters": {
        "type": "object",
        "properties": {
            "operations": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {"enum": ["CREATE", "UPDATE", "DELETE", "READ"]},
                        "path": {"type": "string"},
                        "content": {"type": "string"},
                        "reason": {"type": "string"}
                    }
                }
            }
        }
    }
}
```

##### 4.3 更新 `/api/tasks/execute` Endpoint

**文件**：`backend/ai-service/main.py`

将当前的stub实现替换为完整实现：
- 复用 `/api/projects/{id}/chat` 的核心逻辑
- 支持任务分解和多步骤执行
- 集成 `TaskPlannerEnhanced` 进行复杂任务规划

---

## 关键文件清单

### 需要修改的文件

| 文件路径 | 修改类型 | 优先级 |
|---------|---------|-------|
| `desktop-app-vue/src/main/index.js` | 新增 `project:aiChat` handler | 🔥 最高 |
| `desktop-app-vue/src/renderer/components/projects/ChatPanel.vue` | 修改消息发送和响应处理逻辑 | 🔥 高 |
| `desktop-app-vue/src/preload/index.js` | 新增 `project.aiChat` API | 🔥 高 |

### 需要创建的文件

| 文件路径 | 用途 | 优先级 |
|---------|-----|-------|
| `desktop-app-vue/src/main/ai-engine/response-parser.js` | AI响应解析器 | 🔥 最高 |
| `desktop-app-vue/src/main/ai-engine/conversation-executor.js` | 文件操作执行器 | 🔥 最高 |
| `desktop-app-vue/src/renderer/components/projects/FileOperationsList.vue` | 文件操作显示组件 | 🟡 中 |
| `desktop-app-vue/src/main/prompt/project-conversation.hbs` | 系统提示词模板 | 🟡 中 |
| `backend/ai-service/engines/function_schemas.py` | Function calling schema定义 | 🔥 高 |
| `backend/ai-service/routers/project_chat.py` | 项目对话路由（新建或扩展现有） | 🔥 高 |

---

## 实现细节

### 响应格式设计

#### AI响应结构（JSON）
```json
{
  "response": "我已经为您创建了登录页面，包含HTML和CSS文件。",
  "operations": [
    {
      "type": "CREATE",
      "path": "pages/login.html",
      "content": "<!DOCTYPE html>...",
      "language": "html"
    },
    {
      "type": "CREATE",
      "path": "styles/login.css",
      "content": "body { ... }",
      "language": "css"
    }
  ]
}
```

#### 前端返回结构
```javascript
{
  conversationResponse: "AI的文本回复",
  fileOperations: [
    {
      type: "CREATE",
      path: "pages/login.html",
      status: "success",
      message: "文件创建成功",
      size: 1024
    }
  ],
  ragSources: [
    {
      text: "...",
      file_path: "...",
      score: 0.85
    }
  ]
}
```

### 安全考虑

**⚠️ 重要提示**：由于用户选择了"自动执行"模式，安全性至关重要！

1. **路径验证**（必须）：
   - 使用 `path.resolve()` 和 `path.relative()` 验证路径在项目目录内
   - 拒绝包含 `..`、`~` 等跳出路径的操作
   - 禁止操作系统敏感目录（`/etc`, `C:\Windows` 等）

2. **DELETE操作保护**（必须）：
   - DELETE操作前先备份到回收站或临时目录
   - 记录删除日志，支持恢复
   - 考虑实现"软删除"（移动到 `.trash` 目录）

3. **权限检查**（必须）：
   - 验证文件读写权限
   - 检查磁盘空间是否足够
   - 验证文件名合法性（避免特殊字符）

4. **内容审查**（推荐）：
   - 检测潜在恶意代码（eval、exec、危险系统调用）
   - 限制文件大小（避免生成超大文件）
   - 过滤敏感信息（API密钥、密码等）

5. **操作日志**（必须）：
   - 记录所有文件操作到数据库
   - 包含时间戳、操作类型、文件路径、操作结果
   - 支持操作历史查询和审计

6. **Git集成**（推荐）：
   - 文件操作后自动创建Git提交（如果启用）
   - 提交消息包含AI操作标识
   - 方便回滚和版本管理

---

## 测试计划

### 单元测试
- [ ] 响应解析器测试（`response-parser.test.js`）
- [ ] 操作执行器测试（`conversation-executor.test.js`）
- [ ] IPC handler测试

### 集成测试
- [ ] 创建文件流程测试
- [ ] 修改文件流程测试
- [ ] 删除文件流程测试
- [ ] 错误处理测试

### 端到端测试
- [ ] 用户对话创建文件
- [ ] 用户对话修改现有文件
- [ ] 多文件操作
- [ ] 操作失败回滚

---

## 预期成果

实现后，用户可以：

1. ✅ 在项目对话中说："创建一个登录页面" → 自动生成 `login.html`
2. ✅ 在项目对话中说："修改index.html的标题" → 自动更新文件
3. ✅ 在项目对话中说："给我生成一个样式表" → 自动创建CSS文件
4. ✅ 看到文件操作的实时反馈（成功/失败）
5. ✅ 在文件树中立即看到新文件/修改（自动刷新）

---

## 风险与挑战

1. **AI响应格式不稳定**：LLM可能返回格式不一致的响应
   - 缓解：使用function calling或严格的prompt约束

2. **文件冲突**：修改已被用户手动修改的文件
   - 缓解：显示diff确认界面，支持合并或拒绝

3. **性能影响**：RAG检索和LLM调用可能较慢
   - 缓解：使用流式响应、异步处理

4. **用户体验**：操作过于自动化可能让用户失去控制感
   - 缓解：提供确认机制，显示详细操作日志

---

## 实现顺序建议

**推荐按照以下顺序实现，可以快速看到效果并逐步完善：**

### 第一轮：最小可行产品（MVP）

1. **后端API基础**（先行）
   - 实现 `/api/projects/{id}/chat` endpoint（基础版）
   - 添加简单的文件操作schema
   - 支持CREATE操作

2. **主进程集成**
   - 创建 `response-parser.js`（仅支持JSON格式）
   - 创建 `conversation-executor.js`（仅支持CREATE）
   - 实现 `project:aiChat` handler

3. **前端连接**
   - 更新 ChatPanel.vue 调用新API
   - 显示文件操作结果（简单列表）
   - 文件树自动刷新

**里程碑**：用户可以说"创建一个index.html"并看到文件生成 ✅

### 第二轮：完整CRUD支持

4. **扩展操作类型**
   - response-parser 支持 UPDATE/DELETE/READ
   - conversation-executor 实现完整CRUD
   - 添加路径验证和安全检查

5. **后端增强**
   - 完善 function calling schema
   - 添加RAG上下文检索
   - 支持复杂文件操作

**里程碑**：用户可以修改和删除文件 ✅

### 第三轮：体验优化

6. **UI增强**
   - FileOperationsList 组件（美化）
   - 文件diff展示
   - 操作历史查询

7. **安全与日志**
   - DELETE操作备份
   - 操作日志记录
   - Git自动提交

**里程碑**：完整的生产级功能 ✅

---

## 后续优化方向

1. **智能代码补全**：基于项目上下文的代码建议
2. **批量操作**：一次性创建整个功能模块
3. **版本控制集成**：自动commit文件变更
4. **协作模式**：多人项目中的冲突解决
5. **操作历史**：支持撤销/重做
