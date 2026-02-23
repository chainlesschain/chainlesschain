# ChainlessChain PC端项目工作流程完整报告

**文档版本**: v1.0.0
**生成日期**: 2026-01-27
**应用版本**: v0.26.2

---

## 目录

1. [系统架构概览](#1-系统架构概览)
2. [项目创建到交付完整流程](#2-项目创建到交付完整流程)
3. [AI引擎核心模块详解](#3-ai引擎核心模块详解)
4. [多代理协作系统](#4-多代理协作系统)
5. [工具集详细说明](#5-工具集详细说明)
6. [工作流监控系统](#6-工作流监控系统)
7. [关键页面与组件](#7-关键页面与组件)
8. [技术架构总结](#8-技术架构总结)

---

## 1. 系统架构概览

### 1.1 整体架构

ChainlessChain Desktop 是一个基于 Electron + Vue3 的 AI 驱动项目管理平台，采用前后端分离架构：

```
┌─────────────────────────────────────────────────────────────┐
│                  Renderer Process (Vue3)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  UI Layer    │  │  Store Layer │  │ Router Layer │      │
│  │  (Components)│  │  (Pinia)     │  │ (Vue Router) │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└──────────────────────┬──────────────────────────────────────┘
                       │ IPC Communication
                       │ (invoke/on/handle)
┌──────────────────────▼──────────────────────────────────────┐
│                   Main Process (Node.js)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  AI Engine   │  │  Database    │  │  P2P/DID     │      │
│  │  (60+ mods)  │  │  (SQLCipher) │  │  (libp2p)    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  LLM Manager │  │  RAG Engine  │  │  U-Key       │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP/WebSocket
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                  Backend Services (Docker)                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Ollama     │  │  PostgreSQL  │  │    Redis     │      │
│  │  (Local LLM) │  │   (数据库)    │  │   (缓存)      │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐                        │
│  │   Qdrant     │  │  AI Service  │                        │
│  │  (向量库)     │  │  (FastAPI)   │                        │
│  └──────────────┘  └──────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 技术栈

**前端 (Renderer Process)**

- **框架**: Vue 3.4 + Vite + Electron 39.2.6
- **UI库**: Ant Design Vue 4.1
- **状态管理**: Pinia
- **路由**: Vue Router (Hash 模式)
- **组件总数**: 338个 Vue 组件

**主进程 (Main Process)**

- **运行时**: Node.js + Electron
- **AI引擎**: 60+ 模块
- **数据库**: SQLite + SQLCipher (AES-256)
- **工具集**: 14个扩展工具集 (100+ 工具)

**后端服务**

- **LLM**: Ollama (本地) + 14+ 云端 LLM 提供商
- **向量数据库**: Qdrant
- **关系型数据库**: PostgreSQL 16
- **缓存**: Redis 7
- **AI服务**: FastAPI + Python

### 1.3 目录结构

```
desktop-app-vue/
├── src/
│   ├── main/                    # Electron 主进程
│   │   ├── index.js            # 主入口 + IPC 处理
│   │   ├── database.js         # 数据库管理
│   │   ├── ai-engine/          # AI 引擎 (60+ 文件)
│   │   │   ├── task-planner-enhanced.js
│   │   │   ├── task-executor.js
│   │   │   ├── function-caller.js
│   │   │   ├── multi-agent/    # 多代理系统
│   │   │   └── cowork/         # Cowork 协作系统
│   │   ├── llm/                # LLM 管理
│   │   ├── rag/                # RAG 检索
│   │   ├── project/            # 项目管理
│   │   ├── ukey/               # U-Key 硬件集成
│   │   └── p2p/                # P2P 网络
│   └── renderer/               # Vue3 前端
│       ├── pages/              # 页面组件
│       ├── components/         # 可复用组件
│       ├── stores/             # Pinia 状态管理
│       └── router/             # 路由配置
└── data/
    └── chainlesschain.db       # 加密数据库
```

---

## 2. 项目创建到交付完整流程

### 2.1 流程概览

```
用户输入需求
    ↓
┌─────────────────────────────────────────┐
│ 阶段1: 需求理解与任务规划                 │
│ - RAG上下文检索                          │
│ - LLM任务拆解                           │
│ - 依赖关系分析                          │
└─────────────────┬───────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ 阶段2: 多代理决策                        │
│ - 判断是否使用多代理                     │
│ - 选择执行策略 (单/多代理)               │
└─────────────────┬───────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ 阶段3: 任务执行                          │
│ - 并发任务调度                          │
│ - 工具调用                              │
│ - 实时进度推送                          │
└─────────────────┬───────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ 阶段4: 项目开发与协作                    │
│ - 文件编辑                              │
│ - AI代码助手                            │
│ - Git版本管理                           │
└─────────────────┬───────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ 阶段5: 工作流监控与质量门禁              │
│ - 阶段进度跟踪                          │
│ - 质量门禁检查                          │
│ - 自动化测试                            │
└─────────────────┬───────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ 阶段6: 项目交付                          │
│ - 项目归档                              │
│ - 文档生成                              │
│ - 分享与导出                            │
└─────────────────────────────────────────┘
```

### 2.2 详细流程步骤

#### 阶段1: 需求理解与任务规划

**页面**: `ProjectsPage.vue` (项目列表页)
**入口**: 对话式输入框 (`ConversationInput.vue`)

**用户操作**:

```
1. 用户输入: "创建一个React + TypeScript的电商项目"
2. 可选择上传参考文件
3. 可选择@引用知识库内容
```

**后端处理流程**:

```javascript
// 文件: src/main/project/project-ai-ipc.js
// IPC Handler: 'project-ai:create'

// 步骤1: 接收用户输入
const userRequest = "创建一个React + TypeScript的电商项目";
const projectContext = {
  projectType: "web",
  existingFiles: [],
  technologies: [],
};

// 步骤2: 调用任务规划器
// 文件: src/main/ai-engine/task-planner-enhanced.js
const taskPlanner = new TaskPlannerEnhanced({
  db,
  llmManager,
  projectRAG,
});

const taskPlan = await taskPlanner.decomposeTask(userRequest, projectContext);

// 步骤3: 任务计划示例
/*
{
  "task_title": "创建React+TypeScript电商项目",
  "task_type": "create",
  "estimated_duration": "10分钟",
  "subtasks": [
    {
      "step": 1,
      "title": "初始化项目结构",
      "tool": "tool_npm_project_setup",
      "action": "create_react_app",
      "params": {
        "template": "typescript",
        "projectName": "ecommerce-app"
      },
      "dependencies": [],
      "output_files": ["package.json", "tsconfig.json"]
    },
    {
      "step": 2,
      "title": "创建目录结构",
      "tool": "file_writer",
      "action": "write_multiple",
      "params": {
        "files": [
          "src/components/",
          "src/pages/",
          "src/store/",
          "src/api/"
        ]
      },
      "dependencies": [1],
      "output_files": []
    },
    {
      "step": 3,
      "title": "生成核心组件",
      "tool": "code_generator",
      "action": "generate_react_components",
      "params": {
        "components": ["Header", "ProductList", "Cart", "Checkout"]
      },
      "dependencies": [2],
      "output_files": [
        "src/components/Header.tsx",
        "src/components/ProductList.tsx"
      ]
    },
    {
      "step": 4,
      "title": "配置路由",
      "tool": "code_generator",
      "action": "generate_router",
      "params": {
        "routes": [
          { "path": "/", "component": "Home" },
          { "path": "/products", "component": "ProductList" },
          { "path": "/cart", "component": "Cart" }
        ]
      },
      "dependencies": [3],
      "output_files": ["src/router/index.tsx"]
    },
    {
      "step": 5,
      "title": "生成README文档",
      "tool": "tool_markdown_generator",
      "action": "create_readme",
      "params": {
        "projectName": "ecommerce-app",
        "description": "React + TypeScript 电商项目"
      },
      "dependencies": [4],
      "output_files": ["README.md"]
    }
  ],
  "final_output": {
    "type": "project",
    "files": ["package.json", "src/", "README.md"]
  }
}
*/

// 步骤4: 保存任务计划到数据库
await db.run(
  `
  INSERT INTO project_task_plans (project_id, plan_data, status)
  VALUES (?, ?, 'pending')
`,
  [projectId, JSON.stringify(taskPlan)],
);

// 步骤5: 实时推送任务计划到前端
mainWindow.webContents.send("project-ai:task-plan", {
  projectId,
  taskPlan,
});
```

**RAG增强检索**:

```javascript
// 文件: src/main/ai-engine/task-planner-enhanced.js

// 检索相关上下文
const ragResult = await projectRAG.enhancedQuery(projectId, userRequest, {
  projectLimit: 3, // 检索3个相关项目文件
  knowledgeLimit: 2, // 检索2个知识库文档
  conversationLimit: 2, // 检索2个历史对话
  useReranker: true, // 使用重排序算法
});

// RAG结果示例
/*
{
  "projectResults": [
    {
      "filePath": "src/templates/react-typescript.json",
      "content": "...",
      "score": 0.92
    }
  ],
  "knowledgeResults": [
    {
      "title": "React最佳实践",
      "content": "...",
      "score": 0.85
    }
  ],
  "conversationResults": [
    {
      "question": "如何创建React项目？",
      "answer": "使用create-react-app...",
      "score": 0.78
    }
  ]
}
*/
```

#### 阶段2: 多代理决策

**决策引擎**: `CoworkOrchestrator.js`
**核心逻辑**: 基于 Anthropic 的三种多代理适用场景

```javascript
// 文件: src/main/ai-engine/multi-agent/cowork-orchestrator.js

function shouldUseMultiAgent(task, context) {
  // 场景1: 上下文污染检测
  const hasContextPollution =
    context.length > 10000 || context.historyMessages > 50;

  if (hasContextPollution) {
    return {
      useMultiAgent: true,
      strategy: "divide_context",
      reason: "上下文过长，需要分片处理",
      agentCount: Math.ceil(context.length / 5000),
    };
  }

  // 场景2: 可并行化检测
  const canParallelize =
    task.subtasks.length >= 2 &&
    hasIndependentTasks(task.subtasks) &&
    ["batch_processing", "data_analysis", "multi_doc_generation"].includes(
      task.type,
    );

  if (canParallelize) {
    return {
      useMultiAgent: true,
      strategy: "parallel_execution",
      reason: "任务可并行执行，提升效率",
      agentCount: task.subtasks.length,
    };
  }

  // 场景3: 专业化检测
  const needsSpecialization =
    getRequiredSkills(task).filter((s) => s.score >= 50).length >= 2 ||
    getRequiredTools(task).length >= 3 ||
    ["complex_integration", "multi_domain"].includes(task.type);

  if (needsSpecialization) {
    return {
      useMultiAgent: true,
      strategy: "specialized_agents",
      reason: "需要多领域专业知识协作",
      agentCount: getRequiredSkills(task).length,
    };
  }

  // 默认: 单代理模式
  return {
    useMultiAgent: false,
    reason: "任务简单，单代理即可完成",
  };
}

// 执行决策
const decision = shouldUseMultiAgent(taskPlan, context);

if (decision.useMultiAgent) {
  // 多代理模式
  await executeMultiAgentWorkflow(taskPlan, decision);
} else {
  // 单代理模式
  await executeSingleAgentWorkflow(taskPlan);
}
```

**多代理创建流程**:

```javascript
// 策略1: 并行执行 (针对我们的电商项目示例)
if (decision.strategy === "parallel_execution") {
  // 1. 创建团队
  const team = await teammateTool.spawnTeam({
    teamId: `ecommerce-team-${Date.now()}`,
    purpose: "并行创建电商项目组件",
    maxAgents: task.subtasks.length,
  });

  // 2. 为每个子任务创建专门代理
  const agents = [];
  for (const subtask of task.subtasks) {
    const agentId = `agent_step${subtask.step}`;

    // 代理请求加入团队
    await teammateTool.requestJoin(team.id, agentId, {
      capabilities: [subtask.tool],
      role: subtask.title,
    });

    // 分配任务
    await teammateTool.assignTask(team.id, agentId, {
      taskId: subtask.id,
      task: subtask,
      priority: subtask.priority || "normal",
    });

    agents.push(agentId);
  }

  // 3. 并行执行所有任务
  const results = await Promise.all(
    agents.map((agentId) => executeAgentTask(team.id, agentId)),
  );

  // 4. 合并结果
  const mergedResult = await teammateTool.mergeResults(team.id, results, {
    type: "aggregate",
  });

  // 5. 销毁团队
  await teammateTool.destroyTeam(team.id);

  return mergedResult;
}
```

#### 阶段3: 任务执行

**任务执行器**: `TaskExecutor.js`
**特性**: 依赖解析 + 并发控制 + 重试机制

```javascript
// 文件: src/main/ai-engine/task-executor.js

class TaskExecutor {
  constructor(options = {}) {
    this.MAX_CONCURRENCY = options.maxConcurrency || 3;
    this.TASK_TIMEOUT = options.taskTimeout || 5 * 60 * 1000; // 5分钟
    this.MAX_RETRIES = options.maxRetries || 2;

    this.tasks = new Map();
    this.dependencyGraph = new Map();
    this.completedTasks = new Set();
    this.failedTasks = new Set();
    this.runningTasks = new Set();
  }

  // 添加任务到任务图
  addTask(taskNode) {
    this.tasks.set(taskNode.id, {
      ...taskNode,
      status: "pending",
      retries: 0,
      startTime: null,
      endTime: null,
    });
  }

  // 构建依赖图
  buildDependencyGraph() {
    for (const [taskId, task] of this.tasks) {
      const deps = task.dependencies || [];
      this.dependencyGraph.set(taskId, deps);
    }
  }

  // 检测循环依赖
  detectCyclicDependencies() {
    const visited = new Set();
    const recStack = new Set();

    for (const taskId of this.tasks.keys()) {
      if (this._hasCycle(taskId, visited, recStack)) {
        throw new Error(`检测到循环依赖: ${taskId}`);
      }
    }
  }

  // 获取准备就绪的任务
  getReadyTasks() {
    const ready = [];

    for (const [taskId, task] of this.tasks) {
      if (task.status !== "pending") continue;
      if (this.runningTasks.size >= this.MAX_CONCURRENCY) break;

      const deps = this.dependencyGraph.get(taskId) || [];
      const allDepsCompleted = deps.every((depId) =>
        this.completedTasks.has(depId),
      );

      if (allDepsCompleted) {
        ready.push({ taskId, task });
      }
    }

    return ready;
  }

  // 执行单个任务
  async executeTask(taskId, task, executor) {
    const taskData = this.tasks.get(taskId);
    taskData.status = "running";
    taskData.startTime = Date.now();
    this.runningTasks.add(taskId);

    // 实时推送进度
    this.emit("task:start", { taskId, task });

    try {
      // 设置超时
      const result = await Promise.race([
        executor(task),
        this._timeout(this.TASK_TIMEOUT),
      ]);

      taskData.status = "completed";
      taskData.endTime = Date.now();
      taskData.result = result;

      this.completedTasks.add(taskId);
      this.runningTasks.delete(taskId);

      this.emit("task:complete", { taskId, task, result });

      return result;
    } catch (error) {
      // 重试逻辑
      if (taskData.retries < this.MAX_RETRIES) {
        taskData.retries++;
        taskData.status = "pending";
        this.runningTasks.delete(taskId);

        this.emit("task:retry", { taskId, task, retries: taskData.retries });

        // 重新执行
        return this.executeTask(taskId, task, executor);
      }

      // 标记为失败
      taskData.status = "failed";
      taskData.endTime = Date.now();
      taskData.error = error.message;

      this.failedTasks.add(taskId);
      this.runningTasks.delete(taskId);

      this.emit("task:fail", { taskId, task, error });

      throw error;
    }
  }

  // 执行所有任务
  async executeAll(executor) {
    this.buildDependencyGraph();
    this.detectCyclicDependencies();

    const results = new Map();

    while (this.completedTasks.size + this.failedTasks.size < this.tasks.size) {
      const readyTasks = this.getReadyTasks();

      if (readyTasks.length === 0) {
        if (this.runningTasks.size === 0) {
          // 所有任务都在等待，可能有未满足的依赖
          break;
        }
        // 等待正在运行的任务完成
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }

      // 并发执行准备就绪的任务
      const promises = readyTasks.map(({ taskId, task }) =>
        this.executeTask(taskId, task, executor)
          .then((result) => ({ taskId, result }))
          .catch((error) => ({ taskId, error })),
      );

      const batchResults = await Promise.all(promises);

      for (const { taskId, result, error } of batchResults) {
        if (result) {
          results.set(taskId, result);
        }
      }
    }

    return {
      completed: Array.from(this.completedTasks),
      failed: Array.from(this.failedTasks),
      results: Object.fromEntries(results),
    };
  }
}

// 使用示例
const executor = new TaskExecutor({ maxConcurrency: 3 });

// 添加任务
for (const subtask of taskPlan.subtasks) {
  executor.addTask({
    id: `task_${subtask.step}`,
    task: subtask,
    dependencies: subtask.dependencies.map((dep) => `task_${dep}`),
    priority: subtask.priority || "normal",
  });
}

// 执行所有任务
const results = await executor.executeAll(async (task) => {
  // 调用工具执行任务
  return await functionCaller.call(task.tool, task.params, context);
});
```

**工具调用流程**:

```javascript
// 文件: src/main/ai-engine/function-caller.js

class FunctionCaller {
  constructor() {
    this.tools = new Map();
    this.toolStats = new Map();
    this.toolMasks = new Map();

    // 注册所有工具
    this.registerAllTools();
  }

  // 注册工具
  registerTool(toolName, toolFunction, metadata = {}) {
    this.tools.set(toolName, {
      function: toolFunction,
      metadata: {
        category: metadata.category || "general",
        description: metadata.description || "",
        parameters: metadata.parameters || [],
        enabled: true,
      },
    });

    this.toolStats.set(toolName, {
      callCount: 0,
      successCount: 0,
      failCount: 0,
      totalTime: 0,
    });
  }

  // 调用工具
  async call(toolName, params, context = {}) {
    // 检查工具是否存在
    if (!this.tools.has(toolName)) {
      throw new Error(`工具不存在: ${toolName}`);
    }

    // 检查工具掩码 (Manus优化)
    if (this.isToolMasked(toolName)) {
      throw new Error(`工具被掩码: ${toolName}`);
    }

    const tool = this.tools.get(toolName);
    const stats = this.toolStats.get(toolName);

    stats.callCount++;

    const startTime = Date.now();

    try {
      // 执行工具函数
      const result = await tool.function(params, context);

      stats.successCount++;
      stats.totalTime += Date.now() - startTime;

      // 记录日志
      this.emit("tool:call:success", {
        toolName,
        params,
        result,
        duration: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      stats.failCount++;

      this.emit("tool:call:fail", {
        toolName,
        params,
        error: error.message,
        duration: Date.now() - startTime,
      });

      throw error;
    }
  }

  // Manus优化: 工具掩码
  setToolMask(toolName, enabled) {
    this.toolMasks.set(toolName, enabled);
  }

  setToolsByPrefix(prefix, enabled) {
    for (const toolName of this.tools.keys()) {
      if (toolName.startsWith(prefix)) {
        this.toolMasks.set(toolName, enabled);
      }
    }
  }

  // 任务阶段状态机
  transitionToPhase(phase) {
    switch (phase) {
      case "planning":
        // 只启用规划相关工具
        this.setToolsByPrefix("file_reader", true);
        this.setToolsByPrefix("project_analyzer", true);
        this.setToolsByPrefix("tool_", false);
        break;

      case "executing":
        // 启用所有执行工具
        this.setToolsByPrefix("tool_", true);
        this.setToolsByPrefix("file_writer", true);
        break;

      case "validating":
        // 只启用验证工具
        this.setToolsByPrefix("test_", true);
        this.setToolsByPrefix("lint_", true);
        this.setToolsByPrefix("tool_", false);
        break;

      case "committing":
        // 只启用提交工具
        this.setToolsByPrefix("git_", true);
        this.setToolsByPrefix("tool_", false);
        break;
    }

    this.currentPhase = phase;
  }
}

// 使用示例: 执行电商项目的第1个子任务
const result1 = await functionCaller.call("tool_npm_project_setup", {
  projectName: "ecommerce-app",
  projectPath: "/path/to/project",
  template: "react-typescript",
  dependencies: ["react-router-dom", "zustand", "axios"],
  initGit: true,
  installDeps: true,
});

/*
result1 = {
  success: true,
  filesCreated: [
    'package.json',
    'tsconfig.json',
    'src/index.tsx',
    'src/App.tsx',
    'public/index.html'
  ],
  message: '项目初始化成功'
}
*/
```

**前端实时进度展示**:

```vue
<!-- 文件: src/renderer/components/projects/TaskExecutionMonitor.vue -->
<template>
  <div class="task-execution-monitor">
    <!-- 整体进度条 -->
    <a-progress
      :percent="overallProgress"
      :status="status"
      :stroke-color="progressColor"
    />

    <!-- 任务步骤列表 -->
    <div class="task-steps">
      <div
        v-for="step in steps"
        :key="step.id"
        class="step-item"
        :class="step.status"
      >
        <!-- 步骤图标 -->
        <div class="step-icon">
          <loading-outlined v-if="step.status === 'running'" spin />
          <check-circle-outlined v-else-if="step.status === 'completed'" />
          <close-circle-outlined v-else-if="step.status === 'failed'" />
          <clock-circle-outlined v-else />
        </div>

        <!-- 步骤信息 -->
        <div class="step-info">
          <div class="step-title">{{ step.title }}</div>
          <div class="step-description">{{ step.description }}</div>

          <!-- 执行时间 -->
          <div v-if="step.duration" class="step-duration">
            耗时: {{ formatDuration(step.duration) }}
          </div>
        </div>
      </div>
    </div>

    <!-- AI思考过程 (可选展开) -->
    <div v-if="showThinking" class="thinking-process">
      <ThinkingProcess :messages="thinkingMessages" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { ipcRenderer } from "electron";

const steps = ref([]);
const thinkingMessages = ref([]);

// 监听任务执行事件
onMounted(() => {
  // 任务开始
  ipcRenderer.on("task:start", (event, { taskId, task }) => {
    const step = steps.value.find((s) => s.id === taskId);
    if (step) {
      step.status = "running";
      step.startTime = Date.now();
    }
  });

  // 任务完成
  ipcRenderer.on("task:complete", (event, { taskId, task, result }) => {
    const step = steps.value.find((s) => s.id === taskId);
    if (step) {
      step.status = "completed";
      step.endTime = Date.now();
      step.duration = step.endTime - step.startTime;
      step.result = result;
    }
  });

  // 任务失败
  ipcRenderer.on("task:fail", (event, { taskId, task, error }) => {
    const step = steps.value.find((s) => s.id === taskId);
    if (step) {
      step.status = "failed";
      step.endTime = Date.now();
      step.duration = step.endTime - step.startTime;
      step.error = error;
    }
  });

  // AI思考过程
  ipcRenderer.on("ai:thinking", (event, message) => {
    thinkingMessages.value.push(message);
  });
});

// 计算整体进度
const overallProgress = computed(() => {
  const completed = steps.value.filter((s) => s.status === "completed").length;
  return Math.round((completed / steps.value.length) * 100);
});
</script>
```

#### 阶段4: 项目开发与协作

项目创建完成后，用户进入 **ProjectDetailPage.vue** 进行开发。

**页面布局**:

```
┌────────────────────────────────────────────────────────────┐
│  工具栏: [文件管理] [Git] [分享] [编辑器切换] [AI助手]      │
├──────────────┬─────────────────────────────────────────────┤
│              │                                             │
│  文件树      │         编辑器面板                          │
│              │                                             │
│  [📁 src/]   │   ┌─────────────────────────────────────┐  │
│    [📁 com]  │   │  Monaco Editor                     │  │
│    [📁 pag]  │   │  (代码编辑)                         │  │
│    [📄 App]  │   │                                     │  │
│              │   │  1  import React from 'react'       │  │
│  [📁 public] │   │  2  import './App.css'              │  │
│    [📄 ind]  │   │  3                                  │  │
│              │   │  4  function App() {                │  │
│  [📄 REA...]  │   │  5    return <div>...</div>       │  │
│              │   │  6  }                               │  │
│              │   │                                     │  │
│              │   └─────────────────────────────────────┘  │
│              │                                             │
├──────────────┴─────────────────────────────────────────────┤
│  AI代码助手面板 (可展开/收起)                                │
│  > 建议: 添加错误边界处理                                    │
│  > 代码优化: 使用React.memo优化渲染                          │
└────────────────────────────────────────────────────────────┘
```

**核心功能**:

**1. 文件管理** (`EnhancedFileTree.vue`)

```vue
<template>
  <div class="enhanced-file-tree">
    <!-- 搜索框 -->
    <a-input-search
      v-model:value="searchKeyword"
      placeholder="搜索文件..."
      @search="handleSearch"
    />

    <!-- 虚拟滚动文件树 -->
    <VirtualFileTree
      :files="filteredFiles"
      :selected-file="selectedFile"
      @select="handleFileSelect"
      @context-menu="handleContextMenu"
    />

    <!-- 右键菜单 -->
    <a-dropdown v-model:visible="contextMenuVisible" :trigger="['contextmenu']">
      <a-menu>
        <a-menu-item @click="handleRename">重命名</a-menu-item>
        <a-menu-item @click="handleDelete">删除</a-menu-item>
        <a-menu-item @click="handleDuplicate">复制</a-menu-item>
        <a-menu-divider />
        <a-menu-item @click="handleAIOptimize">AI优化</a-menu-item>
      </a-menu>
    </a-dropdown>
  </div>
</template>

<script setup>
// 文件操作
async function handleFileSelect(file) {
  selectedFile.value = file;

  // 加载文件内容
  const content = await ipcRenderer.invoke("file:read", file.path);

  // 更新编辑器
  editorContent.value = content;
}

// AI优化文件
async function handleAIOptimize() {
  const file = selectedFile.value;

  const optimized = await ipcRenderer.invoke("ai:optimize-file", {
    filePath: file.path,
    content: editorContent.value,
    language: file.language,
  });

  // 显示优化建议
  showOptimizationDialog(optimized);
}
</script>
```

**2. AI代码助手** (`CodeAssistantPanel.vue`)

```vue
<template>
  <div class="code-assistant-panel">
    <a-tabs v-model:activeKey="activeTab">
      <!-- Tab1: 智能建议 -->
      <a-tab-pane key="suggestions" tab="智能建议">
        <div class="suggestions-list">
          <a-card
            v-for="suggestion in suggestions"
            :key="suggestion.id"
            size="small"
            class="suggestion-card"
          >
            <template #title>
              <bulb-outlined /> {{ suggestion.title }}
            </template>

            <div class="suggestion-content">
              {{ suggestion.description }}
            </div>

            <template #actions>
              <a @click="applySuggestion(suggestion)">应用</a>
              <a @click="dismissSuggestion(suggestion)">忽略</a>
            </template>
          </a-card>
        </div>
      </a-tab-pane>

      <!-- Tab2: 代码生成 -->
      <a-tab-pane key="generate" tab="代码生成">
        <a-form layout="vertical">
          <a-form-item label="描述需求">
            <a-textarea
              v-model:value="generateRequest"
              placeholder="例如: 创建一个用户登录表单组件"
              :rows="4"
            />
          </a-form-item>

          <a-form-item>
            <a-button type="primary" @click="handleGenerate">
              生成代码
            </a-button>
          </a-form-item>
        </a-form>

        <!-- 生成结果 -->
        <div v-if="generatedCode" class="generated-code">
          <MonacoEditor
            :value="generatedCode"
            :language="currentLanguage"
            read-only
          />

          <a-button @click="insertGeneratedCode"> 插入到编辑器 </a-button>
        </div>
      </a-tab-pane>

      <!-- Tab3: 代码解释 -->
      <a-tab-pane key="explain" tab="代码解释">
        <a-button @click="explainCurrentCode"> 解释当前选中代码 </a-button>

        <div v-if="explanation" class="explanation">
          <a-alert :message="explanation" type="info" />
        </div>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup>
// 代码生成
async function handleGenerate() {
  loading.value = true;

  const result = await ipcRenderer.invoke("ai:generate-code", {
    request: generateRequest.value,
    context: {
      currentFile: selectedFile.value.path,
      projectType: project.value.type,
      language: currentLanguage.value,
    },
  });

  generatedCode.value = result.code;
  loading.value = false;
}

// 应用建议
async function applySuggestion(suggestion) {
  // 应用代码修改
  const modified = await ipcRenderer.invoke("ai:apply-suggestion", {
    filePath: selectedFile.value.path,
    content: editorContent.value,
    suggestion: suggestion,
  });

  // 更新编辑器
  editorContent.value = modified.content;

  // 显示diff
  showDiffDialog(editorContent.value, modified.content);
}
</script>
```

**3. Git集成** (`GitStatusDialog.vue`)

```vue
<template>
  <a-modal
    v-model:visible="visible"
    title="Git 状态"
    width="800px"
    @ok="handleCommit"
  >
    <!-- 分支信息 -->
    <div class="branch-info">
      <a-tag color="blue">{{ currentBranch }}</a-tag>
      <a-button size="small" @click="handleCreateBranch"> 新建分支 </a-button>
    </div>

    <!-- 文件变更列表 -->
    <a-table
      :columns="columns"
      :data-source="changes"
      :row-selection="rowSelection"
      size="small"
    >
      <template #status="{ text }">
        <a-tag :color="getStatusColor(text)">
          {{ text }}
        </a-tag>
      </template>
    </a-table>

    <!-- 提交信息 -->
    <a-form-item label="提交信息">
      <a-textarea
        v-model:value="commitMessage"
        placeholder="描述本次变更..."
        :rows="3"
      />
    </a-form-item>

    <template #footer>
      <a-button @click="visible = false">取消</a-button>
      <a-button type="primary" @click="handleCommit"> 提交 </a-button>
      <a-button type="primary" @click="handleCommitAndPush">
        提交并推送
      </a-button>
    </template>
  </a-modal>
</template>

<script setup>
async function handleCommit() {
  const result = await ipcRenderer.invoke("git:commit", {
    projectPath: project.value.path,
    files: selectedFiles.value,
    message: commitMessage.value,
  });

  if (result.success) {
    message.success("提交成功");
    visible.value = false;
  }
}

async function handleCommitAndPush() {
  await handleCommit();

  const pushResult = await ipcRenderer.invoke("git:push", {
    projectPath: project.value.path,
  });

  if (pushResult.success) {
    message.success("推送成功");
  }
}
</script>
```

#### 阶段5: 工作流监控与质量门禁

**页面**: `WorkflowMonitorPage.vue`

**工作流定义**:

```javascript
// 文件: src/renderer/stores/workflow.js

export const useWorkflowStore = defineStore("workflow", {
  state: () => ({
    workflows: [],
    currentWorkflow: null,
  }),

  actions: {
    // 创建工作流
    async createWorkflow(options) {
      const workflow = {
        id: generateId(),
        name: options.name || "默认工作流",
        type: options.type || "standard", // standard, agile, waterfall
        stages: [
          {
            id: "stage_1",
            name: "需求分析",
            status: "pending",
            tasks: [
              { id: "task_1_1", name: "收集用户需求", status: "pending" },
              { id: "task_1_2", name: "编写需求文档", status: "pending" },
            ],
            qualityGates: [
              {
                id: "qg_1",
                name: "需求评审",
                criteria: "需求文档完整且通过评审",
                status: "pending",
              },
            ],
          },
          {
            id: "stage_2",
            name: "架构设计",
            status: "pending",
            tasks: [
              { id: "task_2_1", name: "系统架构设计", status: "pending" },
              { id: "task_2_2", name: "数据库设计", status: "pending" },
              { id: "task_2_3", name: "API接口设计", status: "pending" },
            ],
            qualityGates: [
              {
                id: "qg_2",
                name: "架构评审",
                criteria: "架构设计合理且可扩展",
                status: "pending",
              },
            ],
          },
          {
            id: "stage_3",
            name: "编码实现",
            status: "pending",
            tasks: [
              { id: "task_3_1", name: "前端开发", status: "pending" },
              { id: "task_3_2", name: "后端开发", status: "pending" },
              { id: "task_3_3", name: "数据库实现", status: "pending" },
            ],
            qualityGates: [
              {
                id: "qg_3",
                name: "代码质量",
                criteria: "代码质量≥80分, 无严重bug",
                status: "pending",
                metrics: {
                  codeQuality: 0,
                  bugCount: 0,
                  threshold: { codeQuality: 80, bugCount: 5 },
                },
              },
            ],
          },
          {
            id: "stage_4",
            name: "测试",
            status: "pending",
            tasks: [
              { id: "task_4_1", name: "单元测试", status: "pending" },
              { id: "task_4_2", name: "集成测试", status: "pending" },
              { id: "task_4_3", name: "性能测试", status: "pending" },
            ],
            qualityGates: [
              {
                id: "qg_4",
                name: "测试覆盖率",
                criteria: "测试覆盖率≥80%",
                status: "pending",
                metrics: {
                  coverage: 0,
                  threshold: 80,
                },
              },
            ],
          },
          {
            id: "stage_5",
            name: "部署",
            status: "pending",
            tasks: [
              { id: "task_5_1", name: "构建打包", status: "pending" },
              { id: "task_5_2", name: "部署到测试环境", status: "pending" },
              { id: "task_5_3", name: "部署到生产环境", status: "pending" },
            ],
            qualityGates: [
              {
                id: "qg_5",
                name: "部署验证",
                criteria: "应用正常运行且性能达标",
                status: "pending",
              },
            ],
          },
          {
            id: "stage_6",
            name: "交付",
            status: "pending",
            tasks: [
              { id: "task_6_1", name: "生成项目文档", status: "pending" },
              { id: "task_6_2", name: "用户培训", status: "pending" },
              { id: "task_6_3", name: "项目归档", status: "pending" },
            ],
            qualityGates: [
              {
                id: "qg_6",
                name: "交付验收",
                criteria: "用户验收通过",
                status: "pending",
              },
            ],
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      this.workflows.push(workflow);

      // 保存到后端
      await ipcRenderer.invoke("workflow:create", workflow);

      return workflow;
    },

    // 更新阶段状态
    async updateStageStatus(workflowId, stageId, status) {
      const workflow = this.workflows.find((w) => w.id === workflowId);
      if (!workflow) return;

      const stage = workflow.stages.find((s) => s.id === stageId);
      if (!stage) return;

      stage.status = status;
      stage.updatedAt = new Date().toISOString();

      // 检查质量门禁
      if (status === "completed") {
        await this.checkQualityGates(workflowId, stageId);
      }

      // 保存到后端
      await ipcRenderer.invoke("workflow:update-stage", {
        workflowId,
        stageId,
        status,
      });
    },

    // 检查质量门禁
    async checkQualityGates(workflowId, stageId) {
      const workflow = this.workflows.find((w) => w.id === workflowId);
      const stage = workflow.stages.find((s) => s.id === stageId);

      for (const gate of stage.qualityGates) {
        const result = await ipcRenderer.invoke("workflow:check-quality-gate", {
          workflowId,
          stageId,
          gateId: gate.id,
        });

        gate.status = result.passed ? "passed" : "failed";
        gate.result = result;

        if (!result.passed) {
          // 质量门禁失败,阻止进入下一阶段
          notification.warning({
            message: "质量门禁未通过",
            description: `${gate.name}: ${result.reason}`,
          });
        }
      }
    },
  },
});
```

**质量门禁检查示例**:

```javascript
// 文件: src/main/workflow/quality-gate-checker.js

async function checkCodeQuality(projectPath) {
  // 1. 运行ESLint
  const lintResult = await runESLint(projectPath);

  // 2. 运行测试
  const testResult = await runTests(projectPath);

  // 3. 计算代码质量分数
  const qualityScore = calculateQualityScore({
    lintErrors: lintResult.errorCount,
    lintWarnings: lintResult.warningCount,
    testCoverage: testResult.coverage,
    testsPassed: testResult.passed,
    testsTotal: testResult.total,
  });

  // 4. 判断是否通过
  const passed = qualityScore >= 80;

  return {
    passed,
    score: qualityScore,
    details: {
      lint: lintResult,
      test: testResult,
    },
    reason: passed ? "代码质量达标" : `代码质量分数${qualityScore}<80`,
  };
}

function calculateQualityScore(metrics) {
  let score = 100;

  // 扣分规则
  score -= metrics.lintErrors * 5; // 每个错误扣5分
  score -= metrics.lintWarnings * 1; // 每个警告扣1分
  score -= (100 - metrics.testCoverage) * 0.5; // 覆盖率每低1%扣0.5分

  const testPassRate = (metrics.testsPassed / metrics.testsTotal) * 100;
  score -= (100 - testPassRate) * 0.3; // 通过率每低1%扣0.3分

  return Math.max(0, Math.round(score));
}
```

#### 阶段6: 项目交付

**交付清单生成**:

```javascript
// 文件: src/main/project/project-delivery.js

async function generateDeliveryPackage(projectId) {
  const project = await db.get(
    "SELECT * FROM projects WHERE id = ?",
    projectId,
  );

  const deliveryPackage = {
    project: {
      name: project.name,
      description: project.description,
      type: project.type,
      version: project.version,
    },

    // 1. 源代码
    sourceCode: {
      files: await listAllFiles(project.path),
      repository: project.gitUrl,
      branch: project.gitBranch,
    },

    // 2. 文档
    documentation: {
      readme: await fs.readFile(path.join(project.path, "README.md"), "utf-8"),
      apiDocs: await generateAPIDocs(project.path),
      userGuide: await generateUserGuide(project),
      deploymentGuide: await generateDeploymentGuide(project),
    },

    // 3. 构建产物
    artifacts: {
      production: await buildProduction(project.path),
      docker: await buildDockerImage(project.path),
    },

    // 4. 测试报告
    testReports: {
      unit: await getTestReport(project.path, "unit"),
      integration: await getTestReport(project.path, "integration"),
      coverage: await getTestCoverage(project.path),
    },

    // 5. 质量报告
    qualityReports: {
      codeQuality: await getCodeQualityReport(project.path),
      securityScan: await getSecurityScanReport(project.path),
      performanceTest: await getPerformanceReport(project.path),
    },

    // 6. 部署配置
    deployment: {
      environment: project.deploymentConfig,
      scripts: await getDeploymentScripts(project.path),
      ci_cd: await getCICDConfig(project.path),
    },

    // 7. 依赖清单
    dependencies: {
      production: await getDependencies(project.path, "production"),
      development: await getDependencies(project.path, "development"),
      licenses: await getLicenseReport(project.path),
    },
  };

  // 生成交付报告PDF
  const pdfPath = await generateDeliveryPDF(deliveryPackage);

  // 打包所有文件
  const packagePath = await createDeliveryPackage(deliveryPackage, pdfPath);

  // 更新项目状态为已交付
  await db.run(
    "UPDATE projects SET status = ?, delivered_at = ? WHERE id = ?",
    ["delivered", new Date().toISOString(), projectId],
  );

  return {
    success: true,
    packagePath,
    pdfPath,
    deliveryPackage,
  };
}
```

**用户操作流程**:

```vue
<!-- 文件: src/renderer/pages/projects/ProjectDetailPage.vue -->

<template>
  <div class="project-detail">
    <!-- 工具栏 -->
    <div class="toolbar">
      <a-dropdown>
        <template #overlay>
          <a-menu>
            <a-menu-item @click="handleGenerateDelivery">
              生成交付包
            </a-menu-item>
            <a-menu-item @click="handleExportProject"> 导出项目 </a-menu-item>
            <a-menu-item @click="handleArchiveProject"> 归档项目 </a-menu-item>
          </a-menu>
        </template>

        <a-button> 交付 <down-outlined /> </a-button>
      </a-dropdown>
    </div>
  </div>
</template>

<script setup>
async function handleGenerateDelivery() {
  modal.confirm({
    title: "生成交付包",
    content: "将生成包含源代码、文档、测试报告等的完整交付包，是否继续？",
    async onOk() {
      loading.value = true;

      try {
        const result = await ipcRenderer.invoke("project:generate-delivery", {
          projectId: project.value.id,
        });

        message.success("交付包生成成功");

        // 显示下载对话框
        showDeliveryDialog(result);
      } catch (error) {
        message.error(`生成失败: ${error.message}`);
      } finally {
        loading.value = false;
      }
    },
  });
}

function showDeliveryDialog(result) {
  modal.info({
    title: "交付包已生成",
    width: 600,
    content: () => (
      <div>
        <p>交付包路径: {result.packagePath}</p>
        <p>PDF报告: {result.pdfPath}</p>

        <a-button
          type="primary"
          onClick={() => {
            shell.showItemInFolder(result.packagePath);
          }}
        >
          打开文件位置
        </a-button>
      </div>
    ),
  });
}
</script>
```

---

## 3. AI引擎核心模块详解

### 3.1 任务规划器 (TaskPlannerEnhanced)

**文件**: `src/main/ai-engine/task-planner-enhanced.js` (1221行)

**核心类结构**:

````javascript
class TaskPlannerEnhanced {
  constructor({ db, llmManager, projectRAG }) {
    this.db = db;
    this.llmManager = llmManager;
    this.projectRAG = projectRAG;
    this.cache = new Map();
  }

  /**
   * 主方法: 分解用户任务为可执行子任务
   * @param {string} userRequest - 用户请求
   * @param {object} projectContext - 项目上下文
   * @returns {object} 任务计划
   */
  async decomposeTask(userRequest, projectContext) {
    // 1. 检查缓存
    const cacheKey = this.getCacheKey(userRequest, projectContext);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // 2. RAG上下文检索
    const ragContext = await this.retrieveRAGContext(
      userRequest,
      projectContext,
    );

    // 3. 构建LLM提示词
    const prompt = this.buildDecomposePrompt(
      userRequest,
      projectContext,
      ragContext,
    );

    // 4. 调用LLM生成任务计划
    const response = await this.llmManager.query({
      prompt,
      systemPrompt: this.getSystemPrompt(),
      temperature: 0.3, // 低温度确保输出稳定
      maxTokens: 4000,
    });

    // 5. 解析JSON响应
    let taskPlan;
    try {
      taskPlan = this.parseTaskPlan(response.text);
    } catch (error) {
      // 降级方案: 使用简单任务计划
      taskPlan = this.createFallbackPlan(userRequest);
    }

    // 6. 规范化任务计划
    taskPlan = this.normalizeTaskPlan(taskPlan);

    // 7. 验证任务计划
    this.validateTaskPlan(taskPlan);

    // 8. 保存到数据库
    await this.saveTaskPlan(projectContext.projectId, taskPlan);

    // 9. 缓存结果
    this.cache.set(cacheKey, taskPlan);

    return taskPlan;
  }

  /**
   * 检索RAG上下文
   */
  async retrieveRAGContext(userRequest, projectContext) {
    const projectId = projectContext.projectId;

    const result = await this.projectRAG.enhancedQuery(projectId, userRequest, {
      projectLimit: 3, // 项目文件
      knowledgeLimit: 2, // 知识库
      conversationLimit: 2, // 对话历史
      useReranker: true, // 重排序
    });

    return {
      projectFiles: result.projectResults.map((r) => ({
        path: r.filePath,
        content: r.content.substring(0, 500), // 限制长度
        score: r.score,
      })),
      knowledgeDocs: result.knowledgeResults.map((r) => ({
        title: r.title,
        content: r.content.substring(0, 300),
        score: r.score,
      })),
      conversations: result.conversationResults.map((r) => ({
        question: r.question,
        answer: r.answer.substring(0, 200),
        score: r.score,
      })),
    };
  }

  /**
   * 构建LLM提示词
   */
  buildDecomposePrompt(userRequest, projectContext, ragContext) {
    return `你是一个专业的项目任务规划专家。请将用户的需求分解为可执行的子任务。

**用户需求**:
${userRequest}

**项目上下文**:
- 项目类型: ${projectContext.projectType}
- 现有文件: ${projectContext.existingFiles.length}个
- 技术栈: ${projectContext.technologies.join(", ")}

**相关项目文件** (RAG检索结果):
${ragContext.projectFiles
  .map((f) => `- ${f.path} (相关度: ${f.score.toFixed(2)})\n  ${f.content}`)
  .join("\n")}

**相关知识库** (RAG检索结果):
${ragContext.knowledgeDocs
  .map((d) => `- ${d.title} (相关度: ${d.score.toFixed(2)})\n  ${d.content}`)
  .join("\n")}

**历史对话参考**:
${ragContext.conversations
  .map((c) => `Q: ${c.question}\nA: ${c.answer}`)
  .join("\n\n")}

请按照以下JSON格式输出任务计划:

\`\`\`json
{
  "task_title": "任务标题",
  "task_type": "create/modify/analyze/export",
  "estimated_duration": "预计耗时",
  "subtasks": [
    {
      "step": 1,
      "title": "子任务标题",
      "tool": "工具名称 (如: tool_npm_project_setup, file_writer, code_generator等)",
      "action": "操作类型",
      "params": {
        "参数名": "参数值"
      },
      "dependencies": [依赖的步骤编号],
      "output_files": ["输出文件列表"],
      "priority": "high/normal/low"
    }
  ],
  "final_output": {
    "type": "file/report/visualization/project",
    "files": ["最终输出文件列表"]
  }
}
\`\`\`

**注意事项**:
1. 确保子任务之间的依赖关系正确
2. 选择合适的工具 (100+ 工具可用,见工具列表)
3. 参数必须完整且正确
4. 预估合理的执行时间
5. 只输出JSON,不要有其他内容`;
  }

  /**
   * 解析任务计划
   */
  parseTaskPlan(responseText) {
    // 1. 提取JSON块
    const jsonMatch = responseText.match(/```json\n([\s\S]+?)\n```/);
    const jsonText = jsonMatch ? jsonMatch[1] : responseText;

    // 2. 清理文本
    const cleaned = jsonText
      .replace(/\/\/.*$/gm, "") // 移除注释
      .replace(/,(\s*[}\]])/g, "$1"); // 移除尾随逗号

    // 3. 解析JSON
    const parsed = JSON.parse(cleaned);

    return parsed;
  }

  /**
   * 规范化任务计划
   */
  normalizeTaskPlan(taskPlan) {
    // 1. 确保必需字段存在
    if (!taskPlan.task_title) {
      taskPlan.task_title = "未命名任务";
    }

    if (!taskPlan.subtasks) {
      taskPlan.subtasks = [];
    }

    // 2. 规范化子任务
    taskPlan.subtasks = taskPlan.subtasks.map((subtask, index) => ({
      step: subtask.step || index + 1,
      title: subtask.title || `步骤${index + 1}`,
      tool: subtask.tool || "file_writer",
      action: subtask.action || "write",
      params: subtask.params || {},
      dependencies: subtask.dependencies || [],
      output_files: subtask.output_files || [],
      priority: subtask.priority || "normal",
      status: "pending",
    }));

    // 3. 确保依赖编号有效
    const maxStep = taskPlan.subtasks.length;
    for (const subtask of taskPlan.subtasks) {
      subtask.dependencies = subtask.dependencies.filter(
        (dep) => dep > 0 && dep < subtask.step && dep <= maxStep,
      );
    }

    return taskPlan;
  }

  /**
   * 验证任务计划
   */
  validateTaskPlan(taskPlan) {
    // 1. 检查循环依赖
    const graph = new Map();
    for (const subtask of taskPlan.subtasks) {
      graph.set(subtask.step, subtask.dependencies);
    }

    if (this.hasCircularDependency(graph)) {
      throw new Error("任务计划存在循环依赖");
    }

    // 2. 检查工具是否存在
    for (const subtask of taskPlan.subtasks) {
      if (!this.isValidTool(subtask.tool)) {
        console.warn(`未知工具: ${subtask.tool}`);
      }
    }
  }

  /**
   * 创建降级任务计划
   */
  createFallbackPlan(userRequest) {
    return {
      task_title: userRequest,
      task_type: "create",
      estimated_duration: "5分钟",
      subtasks: [
        {
          step: 1,
          title: "执行用户请求",
          tool: "general_executor",
          action: "execute",
          params: {
            request: userRequest,
          },
          dependencies: [],
          output_files: [],
          priority: "normal",
        },
      ],
      final_output: {
        type: "file",
        files: [],
      },
    };
  }
}
````

**可用工具列表** (100+ 工具):

```javascript
// 基础工具
("file_reader",
  "file_writer",
  "file_editor",
  "file_deleter",
  "html_generator",
  "css_generator",
  "js_generator",
  // Office工具
  "tool_word_generator",
  "tool_word_table_creator",
  "tool_excel_generator",
  "tool_excel_formula_builder",
  "tool_excel_chart_creator",
  "tool_ppt_generator",
  // 项目工具
  "tool_npm_project_setup",
  "tool_package_json_builder",
  "tool_python_project_setup",
  "tool_requirements_generator",
  "tool_dockerfile_generator",
  "tool_gitignore_generator",
  // 数据科学工具
  "tool_data_analyzer",
  "tool_data_visualizer",
  "tool_ml_model_trainer",
  "tool_data_preprocessor",
  // 视觉工具
  "tool_image_analyzer",
  "tool_image_enhancer",
  "tool_image_ocr",
  "tool_image_generator",
  // 代码工具
  "code_generator",
  "code_optimizer",
  "code_refactor",
  "test_generator",
  "lint_checker",
  // Git工具
  "git_init",
  "git_commit",
  "git_push",
  "git_status",
  // MemGPT工具
  "memgpt_store_memory",
  "memgpt_recall_memory",
  "memgpt_search_memory",
  "memgpt_summarize_memory");
```

### 3.2 任务执行器 (TaskExecutor)

已在阶段3详细说明,此处补充高级特性。

**高级特性1: 任务优先级队列**

```javascript
class PriorityQueue {
  constructor() {
    this.heap = []
  }

  enqueue(item, priority) {
    const priorityMap = { urgent: 4, high: 3, normal: 2, low: 1 }
    const priorityValue = priorityMap[priority] || 2

    this.heap.push({ item, priority: priorityValue })
    this.bubbleUp()
  }

  dequeue() {
    if (this.heap.length === 0) return null

    const result = this.heap[0]
    const end = this.heap.pop()

    if (this.heap.length > 0) {
      this.heap[0] = end
      this.sinkDown()
    }

    return result.item
  }

  // 堆操作...
}

// 在TaskExecutor中使用
getReadyTasks() {
  const queue = new PriorityQueue()

  for (const [taskId, task] of this.tasks) {
    if (task.status !== 'pending') continue
    if (this.runningTasks.size >= this.MAX_CONCURRENCY) break

    const deps = this.dependencyGraph.get(taskId) || []
    const allDepsCompleted = deps.every(depId =>
      this.completedTasks.has(depId)
    )

    if (allDepsCompleted) {
      queue.enqueue({ taskId, task }, task.priority)
    }
  }

  const ready = []
  while (queue.heap.length > 0) {
    const item = queue.dequeue()
    if (item) ready.push(item)
  }

  return ready
}
```

**高级特性2: 任务可视化**

```javascript
class TaskExecutor {
  // 生成Mermaid图表
  visualize() {
    let mermaid = "graph TD\n";

    for (const [taskId, task] of this.tasks) {
      const label = `${taskId}[${task.task.title}]`;
      const style = this.getNodeStyle(task.status);

      mermaid += `    ${label}${style}\n`;

      const deps = this.dependencyGraph.get(taskId) || [];
      for (const depId of deps) {
        mermaid += `    ${depId} --> ${taskId}\n`;
      }
    }

    return mermaid;
  }

  getNodeStyle(status) {
    const styles = {
      pending: ":::pending",
      running: ":::running",
      completed: ":::completed",
      failed: ":::failed",
    };
    return styles[status] || "";
  }
}

// CSS样式
/*
classDef pending fill:#fff,stroke:#ccc,stroke-width:2px;
classDef running fill:#e3f2fd,stroke:#2196f3,stroke-width:2px;
classDef completed fill:#e8f5e9,stroke:#4caf50,stroke-width:2px;
classDef failed fill:#ffebee,stroke:#f44336,stroke-width:2px;
*/
```

### 3.3 工具调用器 (FunctionCaller)

已在阶段3详细说明,此处补充Manus优化详情。

**Manus Context Engineering**:

```javascript
class FunctionCaller {
  constructor() {
    // 工具定义保持不变,只通过掩码控制可用性
    this.tools = new Map()
    this.toolMasks = new Map()
    this.currentPhase = 'planning'

    // 定义阶段状态机
    this.phaseStateMachine = {
      planning: {
        enabledTools: ['file_reader', 'project_analyzer', 'git_status'],
        nextPhases: ['executing']
      },
      executing: {
        enabledTools: ['tool_*', 'file_writer', 'code_generator'],
        nextPhases: ['validating', 'executing']
      },
      validating: {
        enabledTools: ['test_runner', 'lint_checker', 'code_quality'],
        nextPhases: ['executing', 'committing']
      },
      committing: {
        enabledTools: ['git_*'],
        nextPhases: ['planning']
      }
    }
  }

  // 阶段转换
  transitionToPhase(newPhase) {
    const currentConfig = this.phaseStateMachine[this.currentPhase]

    if (!currentConfig.nextPhases.includes(newPhase)) {
      throw new Error(`无法从${this.currentPhase}转换到${newPhase}`)
    }

    this.currentPhase = newPhase

    // 更新工具掩码
    const newConfig = this.phaseStateMachine[newPhase]

    // 1. 禁用所有工具
    for (const toolName of this.tools.keys()) {
      this.toolMasks.set(toolName, false)
    }

    // 2. 启用当前阶段的工具
    for (const pattern of newConfig.enabledTools) {
      if (pattern.includes('*')) {
        // 通配符匹配
        const prefix = pattern.replace('*', '')
        this.setToolsByPrefix(prefix, true)
      } else {
        this.toolMasks.set(pattern, true)
      }
    }

    console.log(`[FunctionCaller] 阶段转换: ${this.currentPhase} → ${newPhase}`)
    console.log(`[FunctionCaller] 启用工具: ${newConfig.enabledTools.join(', ')}`)
  }

  // 检查工具是否被掩码
  isToolMasked(toolName) {
    if (!this.toolMasks.has(toolName)) {
      return false  // 默认不掩码
    }

    return !this.toolMasks.get(toolName)  // false表示被掩码
  }

  // 获取当前可用工具
  getAvailableTools() {
    const available = []

    for (const [toolName, tool] of this.tools) {
      if (!this.isToolMasked(toolName)) {
        available.push({
          name: toolName,
          ...tool.metadata
        })
      }
    }

    return available
  }
}

// 使用示例
const functionCaller = new FunctionCaller()

// 阶段1: 规划
functionCaller.transitionToPhase('planning')
await functionCaller.call('file_reader', { path: 'src/App.jsx' })  // ✓ 成功
// await functionCaller.call('file_writer', { ... })  // ✗ 抛出错误 (工具被掩码)

// 阶段2: 执行
functionCaller.transitionToPhase('executing')
await functionCaller.call('tool_npm_project_setup', { ... })  // ✓ 成功
await functionCaller.call('file_writer', { ... })  // ✓ 成功

// 阶段3: 验证
functionCaller.transitionToPhase('validating')
await functionCaller.call('test_runner', { ... })  // ✓ 成功
await functionCaller.call('lint_checker', { ... })  // ✓ 成功

// 阶段4: 提交
functionCaller.transitionToPhase('committing')
await functionCaller.call('git_commit', { ... })  // ✓ 成功
```

**优势**:

1. **KV-Cache优化**: 工具定义保持不变,LLM缓存有效
2. **安全性**: 防止在错误阶段调用危险工具
3. **可扩展性**: 易于添加新阶段和工具
4. **可观测性**: 清晰的阶段转换日志

---

## 4. 多代理协作系统

### 4.1 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                   Cowork Orchestrator                        │
│  (多代理决策引擎)                                              │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
      ┌────────┴────────┐
      │                 │
      ▼                 ▼
┌─────────────┐   ┌─────────────┐
│ 单代理模式   │   │ 多代理模式   │
│ AgentOrch   │   │ TeammateTool│
└─────────────┘   └──────┬──────┘
                         │
            ┌────────────┼────────────┐
            │            │            │
            ▼            ▼            ▼
      ┌─────────┐  ┌─────────┐  ┌─────────┐
      │ Agent 1 │  │ Agent 2 │  │ Agent 3 │
      │(规划)    │  │(编码)    │  │(测试)    │
      └────┬────┘  └────┬────┘  └────┬────┘
           │            │            │
           └────────────┼────────────┘
                        │
                        ▼
              ┌─────────────────┐
              │   FileSandbox   │
              │  (文件访问控制)  │
              └─────────────────┘
```

### 4.2 TeammateTool详解

**文件**: `src/main/ai-engine/cowork/teammate-tool.js` (28KB)

**核心操作实现**:

```javascript
class TeammateTool {
  constructor({ db, llmManager, longRunningTaskManager, fileSandbox }) {
    this.db = db;
    this.llmManager = llmManager;
    this.taskManager = longRunningTaskManager;
    this.fileSandbox = fileSandbox;

    this.teams = new Map();
    this.agents = new Map();
  }

  /**
   * 操作1: 创建团队
   */
  async spawnTeam(options) {
    const team = {
      id: options.teamId || `team_${Date.now()}`,
      purpose: options.purpose,
      maxAgents: options.maxAgents || 10,
      createdAt: new Date().toISOString(),
      status: "active",
      members: [],
      sharedContext: {},
      messageHistory: [],
    };

    this.teams.set(team.id, team);

    // 保存到数据库
    await this.db.run(
      `
      INSERT INTO cowork_teams (id, purpose, max_agents, status, created_at)
      VALUES (?, ?, ?, ?, ?)
    `,
      [team.id, team.purpose, team.maxAgents, team.status, team.createdAt],
    );

    console.log(`[TeammateTool] 团队已创建: ${team.id}`);

    return team;
  }

  /**
   * 操作2: 发现可用团队
   */
  async discoverTeams(criteria = {}) {
    const teams = [];

    for (const [teamId, team] of this.teams) {
      // 过滤条件
      if (criteria.status && team.status !== criteria.status) continue;
      if (criteria.maxMembers && team.members.length >= criteria.maxMembers)
        continue;

      teams.push({
        id: team.id,
        purpose: team.purpose,
        memberCount: team.members.length,
        maxAgents: team.maxAgents,
        status: team.status,
      });
    }

    return teams;
  }

  /**
   * 操作3: 代理请求加入团队
   */
  async requestJoin(teamId, agentId, capabilities = {}) {
    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`团队不存在: ${teamId}`);
    }

    if (team.members.length >= team.maxAgents) {
      throw new Error(`团队已满: ${teamId}`);
    }

    // 创建代理
    const agent = {
      id: agentId,
      teamId,
      capabilities: capabilities.capabilities || [],
      role: capabilities.role || "worker",
      status: "idle",
      joinedAt: new Date().toISOString(),
      taskQueue: [],
      currentTask: null,
    };

    this.agents.set(agentId, agent);
    team.members.push(agentId);

    // 广播加入消息
    await this.broadcastMessage(teamId, {
      type: "member_joined",
      agentId,
      role: agent.role,
      timestamp: agent.joinedAt,
    });

    console.log(`[TeammateTool] 代理${agentId}加入团队${teamId}`);

    return { success: true, agent };
  }

  /**
   * 操作4: 分配任务给代理
   */
  async assignTask(teamId, agentId, taskData) {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`代理不存在: ${agentId}`);
    }

    if (agent.teamId !== teamId) {
      throw new Error(`代理不属于该团队: ${agentId} → ${teamId}`);
    }

    // 创建任务
    const task = {
      id: taskData.taskId || `task_${Date.now()}`,
      ...taskData.task,
      assignedTo: agentId,
      assignedAt: new Date().toISOString(),
      status: "pending",
      priority: taskData.priority || "normal",
    };

    agent.taskQueue.push(task);

    // 如果代理空闲,立即开始任务
    if (agent.status === "idle") {
      await this.startNextTask(agentId);
    }

    console.log(`[TeammateTool] 任务${task.id}已分配给代理${agentId}`);

    return { success: true, task };
  }

  /**
   * 启动代理的下一个任务
   */
  async startNextTask(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent || agent.taskQueue.length === 0) return;

    // 从队列取出任务 (优先级排序)
    agent.taskQueue.sort((a, b) => {
      const priorityMap = { urgent: 4, high: 3, normal: 2, low: 1 };
      return priorityMap[b.priority] - priorityMap[a.priority];
    });

    const task = agent.taskQueue.shift();
    agent.currentTask = task;
    agent.status = "busy";

    task.status = "running";
    task.startedAt = new Date().toISOString();

    // 通知团队
    await this.broadcastMessage(agent.teamId, {
      type: "task_started",
      agentId,
      taskId: task.id,
      timestamp: task.startedAt,
    });

    try {
      // 执行任务 (使用长时任务管理器)
      const result = await this.taskManager.executeTask(task, {
        agentId,
        teamId: agent.teamId,
        fileSandbox: this.fileSandbox,
      });

      task.status = "completed";
      task.completedAt = new Date().toISOString();
      task.result = result;

      agent.currentTask = null;
      agent.status = "idle";

      // 通知团队
      await this.broadcastMessage(agent.teamId, {
        type: "task_completed",
        agentId,
        taskId: task.id,
        result,
        timestamp: task.completedAt,
      });

      // 继续下一个任务
      await this.startNextTask(agentId);
    } catch (error) {
      task.status = "failed";
      task.completedAt = new Date().toISOString();
      task.error = error.message;

      agent.currentTask = null;
      agent.status = "idle";

      // 通知团队
      await this.broadcastMessage(agent.teamId, {
        type: "task_failed",
        agentId,
        taskId: task.id,
        error: error.message,
        timestamp: task.completedAt,
      });
    }
  }

  /**
   * 操作5: 广播消息到团队
   */
  async broadcastMessage(teamId, message) {
    const team = this.teams.get(teamId);
    if (!team) return;

    const fullMessage = {
      ...message,
      teamId,
      timestamp: message.timestamp || new Date().toISOString(),
    };

    team.messageHistory.push(fullMessage);

    // 发送给所有成员
    for (const memberId of team.members) {
      const agent = this.agents.get(memberId);
      if (agent) {
        // 这里可以实现实际的消息传递机制
        console.log(`[TeammateTool] ${memberId} 收到消息:`, message.type);
      }
    }

    return { success: true };
  }

  /**
   * 操作6: 点对点发送消息
   */
  async sendMessage(fromAgentId, toAgentId, message) {
    const fromAgent = this.agents.get(fromAgentId);
    const toAgent = this.agents.get(toAgentId);

    if (!fromAgent || !toAgent) {
      throw new Error("代理不存在");
    }

    if (fromAgent.teamId !== toAgent.teamId) {
      throw new Error("代理不在同一团队");
    }

    const fullMessage = {
      from: fromAgentId,
      to: toAgentId,
      content: message,
      timestamp: new Date().toISOString(),
    };

    console.log(`[TeammateTool] ${fromAgentId} → ${toAgentId}: ${message}`);

    return { success: true, message: fullMessage };
  }

  /**
   * 操作7: 投票决策
   */
  async voteOnDecision(teamId, decision) {
    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`团队不存在: ${teamId}`);
    }

    // 创建投票
    const vote = {
      id: `vote_${Date.now()}`,
      teamId,
      question: decision.question,
      options: decision.options,
      votes: {},
      createdAt: new Date().toISOString(),
      deadline: decision.deadline,
      status: "open",
    };

    // 广播投票请求
    await this.broadcastMessage(teamId, {
      type: "vote_started",
      voteId: vote.id,
      question: vote.question,
      options: vote.options,
    });

    // 收集投票 (简化实现,实际应该异步等待)
    for (const memberId of team.members) {
      const agent = this.agents.get(memberId);
      if (!agent) continue;

      // 使用LLM让代理投票
      const agentVote = await this.llmManager.query({
        prompt: `你是团队成员${memberId},请对以下问题投票:\n\n${vote.question}\n\n选项:\n${vote.options.map((opt, i) => `${i + 1}. ${opt}`).join("\n")}\n\n请回复选项编号(1-${vote.options.length}):`,
        temperature: 0.7,
        maxTokens: 10,
      });

      const optionIndex = parseInt(agentVote.text.trim()) - 1;
      if (optionIndex >= 0 && optionIndex < vote.options.length) {
        vote.votes[memberId] = vote.options[optionIndex];
      }
    }

    vote.status = "closed";

    // 统计结果
    const counts = {};
    for (const option of vote.options) {
      counts[option] = 0;
    }

    for (const v of Object.values(vote.votes)) {
      counts[v]++;
    }

    const winner = Object.keys(counts).reduce((a, b) =>
      counts[a] > counts[b] ? a : b,
    );

    vote.result = {
      winner,
      counts,
    };

    // 广播结果
    await this.broadcastMessage(teamId, {
      type: "vote_completed",
      voteId: vote.id,
      result: vote.result,
    });

    console.log(`[TeammateTool] 投票结束:`, vote.result);

    return vote;
  }

  /**
   * 操作8: 获取团队状态
   */
  async getTeamStatus(teamId) {
    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`团队不存在: ${teamId}`);
    }

    const memberStatuses = [];

    for (const memberId of team.members) {
      const agent = this.agents.get(memberId);
      if (!agent) continue;

      memberStatuses.push({
        id: agent.id,
        role: agent.role,
        status: agent.status,
        currentTask: agent.currentTask
          ? {
              id: agent.currentTask.id,
              title: agent.currentTask.title,
              status: agent.currentTask.status,
            }
          : null,
        queueLength: agent.taskQueue.length,
      });
    }

    return {
      teamId: team.id,
      purpose: team.purpose,
      status: team.status,
      memberCount: team.members.length,
      maxAgents: team.maxAgents,
      members: memberStatuses,
      messageCount: team.messageHistory.length,
    };
  }

  /**
   * 操作9: 终止代理
   */
  async terminateAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return { success: false };

    const team = this.teams.get(agent.teamId);
    if (team) {
      // 从团队移除
      team.members = team.members.filter((id) => id !== agentId);

      // 广播离开消息
      await this.broadcastMessage(agent.teamId, {
        type: "member_left",
        agentId,
        timestamp: new Date().toISOString(),
      });
    }

    // 删除代理
    this.agents.delete(agentId);

    console.log(`[TeammateTool] 代理${agentId}已终止`);

    return { success: true };
  }

  /**
   * 操作10: 合并多个代理的结果
   */
  async mergeResults(teamId, results, options = {}) {
    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`团队不存在: ${teamId}`);
    }

    const mergeType = options.type || "aggregate";

    switch (mergeType) {
      case "aggregate":
        // 聚合所有结果
        return {
          type: "aggregate",
          results: results,
          count: results.length,
          mergedAt: new Date().toISOString(),
        };

      case "majority_vote":
        // 多数投票
        const votes = {};
        for (const result of results) {
          const key = JSON.stringify(result);
          votes[key] = (votes[key] || 0) + 1;
        }

        const winner = Object.keys(votes).reduce((a, b) =>
          votes[a] > votes[b] ? a : b,
        );

        return JSON.parse(winner);

      case "best_quality":
        // 选择质量最高的结果 (基于LLM评分)
        const scores = [];

        for (const result of results) {
          const score = await this.evaluateResult(result);
          scores.push({ result, score });
        }

        scores.sort((a, b) => b.score - a.score);

        return scores[0].result;

      case "concatenate":
        // 拼接所有结果
        return results.join("\n\n---\n\n");

      default:
        return results;
    }
  }

  /**
   * 操作11: 创建检查点
   */
  async createCheckpoint(teamId, checkpointData) {
    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`团队不存在: ${teamId}`);
    }

    const checkpoint = {
      id: `checkpoint_${Date.now()}`,
      teamId,
      timestamp: new Date().toISOString(),
      teamState: {
        members: team.members,
        sharedContext: team.sharedContext,
        messageHistory: team.messageHistory,
      },
      agentStates: {},
      customData: checkpointData || {},
    };

    // 保存所有代理状态
    for (const memberId of team.members) {
      const agent = this.agents.get(memberId);
      if (!agent) continue;

      checkpoint.agentStates[memberId] = {
        status: agent.status,
        currentTask: agent.currentTask,
        taskQueue: agent.taskQueue,
      };
    }

    // 保存到数据库
    await this.db.run(
      `
      INSERT INTO cowork_checkpoints (id, team_id, checkpoint_data, created_at)
      VALUES (?, ?, ?, ?)
    `,
      [checkpoint.id, teamId, JSON.stringify(checkpoint), checkpoint.timestamp],
    );

    console.log(`[TeammateTool] 检查点已创建: ${checkpoint.id}`);

    return checkpoint;
  }

  /**
   * 操作12: 列出团队成员
   */
  async listMembers(teamId) {
    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`团队不存在: ${teamId}`);
    }

    const members = [];

    for (const memberId of team.members) {
      const agent = this.agents.get(memberId);
      if (!agent) continue;

      members.push({
        id: agent.id,
        role: agent.role,
        capabilities: agent.capabilities,
        status: agent.status,
        joinedAt: agent.joinedAt,
      });
    }

    return members;
  }

  /**
   * 操作13: 更新团队配置
   */
  async updateTeamConfig(teamId, config) {
    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`团队不存在: ${teamId}`);
    }

    // 更新配置
    if (config.maxAgents !== undefined) {
      team.maxAgents = config.maxAgents;
    }

    if (config.status !== undefined) {
      team.status = config.status;
    }

    if (config.sharedContext !== undefined) {
      team.sharedContext = {
        ...team.sharedContext,
        ...config.sharedContext,
      };
    }

    // 保存到数据库
    await this.db.run(
      `
      UPDATE cowork_teams
      SET max_agents = ?, status = ?, updated_at = ?
      WHERE id = ?
    `,
      [team.maxAgents, team.status, new Date().toISOString(), teamId],
    );

    console.log(`[TeammateTool] 团队配置已更新: ${teamId}`);

    return { success: true, team };
  }

  /**
   * 销毁团队
   */
  async destroyTeam(teamId) {
    const team = this.teams.get(teamId);
    if (!team) return { success: false };

    // 终止所有成员
    for (const memberId of [...team.members]) {
      await this.terminateAgent(memberId);
    }

    // 删除团队
    this.teams.delete(teamId);

    // 更新数据库
    await this.db.run(
      `
      UPDATE cowork_teams
      SET status = 'dissolved', updated_at = ?
      WHERE id = ?
    `,
      [new Date().toISOString(), teamId],
    );

    console.log(`[TeammateTool] 团队已销毁: ${teamId}`);

    return { success: true };
  }
}
```

### 4.3 长时任务管理器

**文件**: `src/main/ai-engine/cowork/long-running-task-manager.js` (20KB)

**核心功能**: Checkpoint/Recovery 机制

```javascript
class LongRunningTaskManager {
  constructor({ db, functionCaller }) {
    this.db = db;
    this.functionCaller = functionCaller;
    this.runningTasks = new Map();

    // 自动保存间隔 (5分钟)
    this.checkpointInterval = 5 * 60 * 1000;
  }

  /**
   * 执行长时任务
   */
  async executeTask(task, context) {
    const taskId = task.id;

    // 检查是否有现有检查点
    const checkpoint = await this.loadCheckpoint(taskId);

    if (checkpoint) {
      console.log(`[LongRunningTaskManager] 从检查点恢复: ${taskId}`);
      return await this.resumeFromCheckpoint(checkpoint, task, context);
    }

    // 新任务执行
    return await this.executeNewTask(task, context);
  }

  /**
   * 执行新任务
   */
  async executeNewTask(task, context) {
    const taskId = task.id;

    // 创建任务状态
    const taskState = {
      taskId,
      startedAt: new Date().toISOString(),
      currentStep: 0,
      totalSteps: task.subtasks ? task.subtasks.length : 1,
      completedSteps: [],
      stepResults: {},
      status: "running",
    };

    this.runningTasks.set(taskId, taskState);

    // 设置自动检查点
    const checkpointTimer = setInterval(() => {
      this.saveCheckpoint(taskId, taskState);
    }, this.checkpointInterval);

    try {
      // 执行任务步骤
      if (task.subtasks) {
        // 多步骤任务
        for (let i = 0; i < task.subtasks.length; i++) {
          const subtask = task.subtasks[i];
          taskState.currentStep = i;

          console.log(
            `[LongRunningTaskManager] 执行步骤 ${i + 1}/${task.subtasks.length}`,
          );

          // 调用工具
          const result = await this.functionCaller.call(
            subtask.tool,
            subtask.params,
            context,
          );

          taskState.completedSteps.push(i);
          taskState.stepResults[i] = result;

          // 保存检查点
          await this.saveCheckpoint(taskId, taskState);
        }
      } else {
        // 单步骤任务
        const result = await this.functionCaller.call(
          task.tool,
          task.params,
          context,
        );

        taskState.stepResults[0] = result;
        taskState.completedSteps.push(0);
      }

      taskState.status = "completed";
      taskState.completedAt = new Date().toISOString();

      clearInterval(checkpointTimer);

      // 删除检查点
      await this.deleteCheckpoint(taskId);

      this.runningTasks.delete(taskId);

      return {
        success: true,
        results: taskState.stepResults,
      };
    } catch (error) {
      taskState.status = "failed";
      taskState.error = error.message;
      taskState.failedAt = new Date().toISOString();

      clearInterval(checkpointTimer);

      // 保存失败状态
      await this.saveCheckpoint(taskId, taskState);

      throw error;
    }
  }

  /**
   * 从检查点恢复
   */
  async resumeFromCheckpoint(checkpoint, task, context) {
    const taskState = checkpoint.taskState;
    const taskId = taskState.taskId;

    console.log(
      `[LongRunningTaskManager] 恢复任务 ${taskId} 从步骤 ${taskState.currentStep}`,
    );

    this.runningTasks.set(taskId, taskState);

    // 设置自动检查点
    const checkpointTimer = setInterval(() => {
      this.saveCheckpoint(taskId, taskState);
    }, this.checkpointInterval);

    try {
      // 从中断的步骤继续
      if (task.subtasks) {
        for (let i = taskState.currentStep; i < task.subtasks.length; i++) {
          // 跳过已完成的步骤
          if (taskState.completedSteps.includes(i)) continue;

          const subtask = task.subtasks[i];
          taskState.currentStep = i;

          console.log(
            `[LongRunningTaskManager] 执行步骤 ${i + 1}/${task.subtasks.length}`,
          );

          const result = await this.functionCaller.call(
            subtask.tool,
            subtask.params,
            context,
          );

          taskState.completedSteps.push(i);
          taskState.stepResults[i] = result;

          await this.saveCheckpoint(taskId, taskState);
        }
      }

      taskState.status = "completed";
      taskState.completedAt = new Date().toISOString();

      clearInterval(checkpointTimer);

      await this.deleteCheckpoint(taskId);

      this.runningTasks.delete(taskId);

      return {
        success: true,
        results: taskState.stepResults,
        resumed: true,
      };
    } catch (error) {
      taskState.status = "failed";
      taskState.error = error.message;
      taskState.failedAt = new Date().toISOString();

      clearInterval(checkpointTimer);

      await this.saveCheckpoint(taskId, taskState);

      throw error;
    }
  }

  /**
   * 保存检查点
   */
  async saveCheckpoint(taskId, taskState) {
    const checkpoint = {
      taskId,
      taskState,
      timestamp: new Date().toISOString(),
    };

    await this.db.run(
      `
      INSERT OR REPLACE INTO task_checkpoints (task_id, checkpoint_data, created_at)
      VALUES (?, ?, ?)
    `,
      [taskId, JSON.stringify(checkpoint), checkpoint.timestamp],
    );

    console.log(
      `[LongRunningTaskManager] 检查点已保存: ${taskId} (步骤 ${taskState.currentStep})`,
    );
  }

  /**
   * 加载检查点
   */
  async loadCheckpoint(taskId) {
    const row = await this.db.get(
      "SELECT * FROM task_checkpoints WHERE task_id = ?",
      taskId,
    );

    if (!row) return null;

    return JSON.parse(row.checkpoint_data);
  }

  /**
   * 删除检查点
   */
  async deleteCheckpoint(taskId) {
    await this.db.run("DELETE FROM task_checkpoints WHERE task_id = ?", taskId);
  }
}
```

### 4.4 FileSandbox安全隔离

**文件**: `src/main/ai-engine/cowork/file-sandbox.js` (20KB)

**核心功能**: 文件访问控制

```javascript
class FileSandbox {
  constructor({ projectPath, whitelist = [] }) {
    this.projectPath = path.resolve(projectPath);
    this.whitelist = whitelist.map((p) => path.resolve(this.projectPath, p));
    this.accessLog = [];
  }

  /**
   * 检查路径是否在沙箱内
   */
  isPathAllowed(filePath) {
    const resolvedPath = path.resolve(this.projectPath, filePath);

    // 1. 必须在项目路径内
    if (!resolvedPath.startsWith(this.projectPath)) {
      return false;
    }

    // 2. 检查白名单 (如果有)
    if (this.whitelist.length > 0) {
      const isWhitelisted = this.whitelist.some((allowedPath) =>
        resolvedPath.startsWith(allowedPath),
      );

      if (!isWhitelisted) {
        return false;
      }
    }

    // 3. 黑名单检查 (敏感文件)
    const blacklist = [
      ".env",
      ".env.local",
      "credentials.json",
      "secrets.json",
      "*.key",
      "*.pem",
    ];

    for (const pattern of blacklist) {
      if (minimatch(resolvedPath, pattern)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 读取文件 (受限)
   */
  async readFile(filePath, options = {}) {
    if (!this.isPathAllowed(filePath)) {
      throw new Error(`拒绝访问: ${filePath} (不在沙箱内)`);
    }

    // 记录访问
    this.logAccess("read", filePath, options.agentId);

    const resolvedPath = path.resolve(this.projectPath, filePath);
    return await fs.readFile(resolvedPath, "utf-8");
  }

  /**
   * 写入文件 (受限)
   */
  async writeFile(filePath, content, options = {}) {
    if (!this.isPathAllowed(filePath)) {
      throw new Error(`拒绝访问: ${filePath} (不在沙箱内)`);
    }

    // 检查写入权限
    if (options.readOnly) {
      throw new Error(`拒绝写入: ${filePath} (只读模式)`);
    }

    this.logAccess("write", filePath, options.agentId);

    const resolvedPath = path.resolve(this.projectPath, filePath);

    // 确保目录存在
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });

    return await fs.writeFile(resolvedPath, content, "utf-8");
  }

  /**
   * 列出目录 (受限)
   */
  async listDirectory(dirPath, options = {}) {
    if (!this.isPathAllowed(dirPath)) {
      throw new Error(`拒绝访问: ${dirPath} (不在沙箱内)`);
    }

    this.logAccess("list", dirPath, options.agentId);

    const resolvedPath = path.resolve(this.projectPath, dirPath);
    const files = await fs.readdir(resolvedPath);

    // 过滤敏感文件
    return files.filter((file) => this.isPathAllowed(path.join(dirPath, file)));
  }

  /**
   * 记录访问日志
   */
  logAccess(operation, filePath, agentId) {
    const log = {
      timestamp: new Date().toISOString(),
      operation,
      filePath,
      agentId: agentId || "unknown",
    };

    this.accessLog.push(log);

    console.log(
      `[FileSandbox] ${operation} ${filePath} by ${agentId || "unknown"}`,
    );
  }

  /**
   * 获取访问日志
   */
  getAccessLog(agentId = null) {
    if (agentId) {
      return this.accessLog.filter((log) => log.agentId === agentId);
    }
    return this.accessLog;
  }
}
```

---

## 5. 工具集详细说明

### 5.1 Office 工具集 (6个工具)

**文件**: `src/main/ai-engine/extended-tools-office.js` (577行)

#### tool_word_generator - Word文档生成器

```javascript
async function tool_word_generator(params, context) {
  const { content, filePath, styles = {} } = params;

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: parseMarkdownToDocx(content, styles),
      },
    ],
  });

  // 保存文档
  const buffer = await Packer.toBuffer(doc);
  await fs.writeFile(filePath, buffer);

  return {
    success: true,
    filePath,
    message: "Word文档生成成功",
  };
}

// Markdown解析器 (支持标题、段落、列表、粗体、斜体)
function parseMarkdownToDocx(markdown, styles) {
  const lines = markdown.split("\n");
  const children = [];

  for (const line of lines) {
    if (line.startsWith("# ")) {
      // H1标题
      children.push(
        new Paragraph({
          text: line.substring(2),
          heading: HeadingLevel.HEADING_1,
        }),
      );
    } else if (line.startsWith("## ")) {
      // H2标题
      children.push(
        new Paragraph({
          text: line.substring(3),
          heading: HeadingLevel.HEADING_2,
        }),
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      // 无序列表
      children.push(
        new Paragraph({
          text: line.substring(2),
          bullet: { level: 0 },
        }),
      );
    } else if (/^\d+\.\s/.test(line)) {
      // 有序列表
      children.push(
        new Paragraph({
          text: line.replace(/^\d+\.\s/, ""),
          numbering: { reference: "default", level: 0 },
        }),
      );
    } else if (line.trim()) {
      // 普通段落
      children.push(
        new Paragraph({
          text: line,
          spacing: { after: 200 },
        }),
      );
    }
  }

  return children;
}
```

#### tool_excel_generator - Excel表格生成器

```javascript
async function tool_excel_generator(params, context) {
  const { data, filePath, sheetNames = ["Sheet1"], options = {} } = params;

  const workbook = new ExcelJS.Workbook();

  // 创建工作表
  for (let i = 0; i < data.length; i++) {
    const sheetName = sheetNames[i] || `Sheet${i + 1}`;
    const worksheet = workbook.addWorksheet(sheetName);

    const sheetData = data[i];

    if (sheetData.length === 0) continue;

    // 添加表头
    const headers = Object.keys(sheetData[0]);
    worksheet.addRow(headers);

    // 样式化表头
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFD3D3D3" },
    };

    // 添加数据行
    for (const row of sheetData) {
      worksheet.addRow(Object.values(row));
    }

    // 自动调整列宽
    worksheet.columns.forEach((column) => {
      let maxLength = 0;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const length = cell.value ? cell.value.toString().length : 0;
        if (length > maxLength) {
          maxLength = length;
        }
      });
      column.width = Math.min(maxLength + 2, 50);
    });

    // 自动筛选
    if (options.autoFilter) {
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: headers.length },
      };
    }

    // 冻结首行
    if (options.freezeTopRow) {
      worksheet.views = [{ state: "frozen", ySplit: 1 }];
    }
  }

  // 保存文件
  await workbook.xlsx.writeFile(filePath);

  return {
    success: true,
    filePath,
    sheetCount: data.length,
    message: "Excel文件生成成功",
  };
}
```

#### tool_ppt_generator - PowerPoint生成器

```javascript
async function tool_ppt_generator(params, context) {
  const { slides, filePath, theme = "default" } = params;

  const pptx = new PptxGenJS();

  // 设置主题
  if (theme === "business") {
    pptx.defineLayout({ name: "CUSTOM", width: 10, height: 5.625 });
  }

  // 添加幻灯片
  for (const slideData of slides) {
    const slide = pptx.addSlide();

    if (slideData.layout === "title") {
      // 标题幻灯片
      slide.addText(slideData.title, {
        x: 1,
        y: 2,
        w: 8,
        h: 1,
        fontSize: 44,
        bold: true,
        align: "center",
      });

      if (slideData.subtitle) {
        slide.addText(slideData.subtitle, {
          x: 1,
          y: 3.5,
          w: 8,
          h: 0.5,
          fontSize: 24,
          align: "center",
        });
      }
    } else if (slideData.layout === "titleAndContent") {
      // 标题+内容布局
      slide.addText(slideData.title, {
        x: 0.5,
        y: 0.5,
        w: 9,
        h: 0.75,
        fontSize: 32,
        bold: true,
      });

      if (slideData.content) {
        slide.addText(slideData.content, {
          x: 0.5,
          y: 1.5,
          w: 9,
          h: 4,
          fontSize: 18,
        });
      }

      if (slideData.bullets) {
        slide.addText(
          slideData.bullets.map((b) => ({ text: b, bullet: true })),
          {
            x: 1,
            y: 1.5,
            w: 8,
            h: 4,
            fontSize: 18,
          },
        );
      }
    } else if (slideData.layout === "twoColumn") {
      // 双栏布局
      slide.addText(slideData.title, {
        x: 0.5,
        y: 0.5,
        w: 9,
        h: 0.75,
        fontSize: 32,
        bold: true,
      });

      slide.addText(slideData.leftContent, {
        x: 0.5,
        y: 1.5,
        w: 4.25,
        h: 4,
        fontSize: 16,
      });

      slide.addText(slideData.rightContent, {
        x: 5.25,
        y: 1.5,
        w: 4.25,
        h: 4,
        fontSize: 16,
      });
    }

    // 添加图片
    if (slideData.image) {
      slide.addImage({
        path: slideData.image.path,
        x: slideData.image.x || 1,
        y: slideData.image.y || 2,
        w: slideData.image.w || 8,
        h: slideData.image.h || 3,
      });
    }
  }

  // 保存文件
  await pptx.writeFile({ fileName: filePath });

  return {
    success: true,
    filePath,
    slideCount: slides.length,
    message: "PPT文件生成成功",
  };
}
```

### 5.2 项目初始化工具集 (6个工具)

**文件**: `src/main/ai-engine/extended-tools-project.js` (562行)

#### tool_npm_project_setup - NPM项目初始化

```javascript
async function tool_npm_project_setup(params, context) {
  const {
    projectName,
    projectPath,
    template = "basic", // basic, express, koa, cli, react, vue
    dependencies = [],
    devDependencies = [],
    initGit = false,
    installDeps = false,
  } = params;

  const fullPath = path.join(projectPath, projectName);

  // 创建项目目录
  await fs.mkdir(fullPath, { recursive: true });

  // 生成package.json
  const packageJson = generatePackageJson(
    projectName,
    template,
    dependencies,
    devDependencies,
  );
  await fs.writeFile(
    path.join(fullPath, "package.json"),
    JSON.stringify(packageJson, null, 2),
  );

  // 根据模板创建文件结构
  await createProjectStructure(fullPath, template);

  // 创建README.md
  const readme = generateReadme(projectName, template);
  await fs.writeFile(path.join(fullPath, "README.md"), readme);

  // 创建.gitignore
  const gitignore = generateGitignore("node");
  await fs.writeFile(path.join(fullPath, ".gitignore"), gitignore);

  // Git初始化
  if (initGit) {
    await execPromise("git init", { cwd: fullPath });
  }

  // 安装依赖
  if (installDeps) {
    await execPromise("npm install", { cwd: fullPath });
  }

  const filesCreated = await listFilesRecursive(fullPath);

  return {
    success: true,
    projectPath: fullPath,
    filesCreated,
    message: `项目${projectName}创建成功`,
  };
}

function generatePackageJson(name, template, dependencies, devDependencies) {
  const base = {
    name,
    version: "1.0.0",
    description: "",
    main: "index.js",
    scripts: {
      test: 'echo "Error: no test specified" && exit 1',
    },
    keywords: [],
    author: "",
    license: "MIT",
  };

  // 根据模板添加依赖和脚本
  switch (template) {
    case "express":
      base.dependencies = { express: "^4.18.0", ...dependencies };
      base.devDependencies = { nodemon: "^2.0.0", ...devDependencies };
      base.scripts.start = "node server.js";
      base.scripts.dev = "nodemon server.js";
      break;

    case "react":
      base.dependencies = {
        react: "^18.2.0",
        "react-dom": "^18.2.0",
        ...dependencies,
      };
      base.devDependencies = {
        vite: "^4.0.0",
        "@vitejs/plugin-react": "^3.0.0",
        ...devDependencies,
      };
      base.scripts.dev = "vite";
      base.scripts.build = "vite build";
      break;

    case "vue":
      base.dependencies = { vue: "^3.3.0", ...dependencies };
      base.devDependencies = {
        vite: "^4.0.0",
        "@vitejs/plugin-vue": "^4.0.0",
        ...devDependencies,
      };
      base.scripts.dev = "vite";
      base.scripts.build = "vite build";
      break;

    default:
      base.dependencies = dependencies;
      base.devDependencies = devDependencies;
  }

  return base;
}

async function createProjectStructure(projectPath, template) {
  switch (template) {
    case "express":
      await fs.mkdir(path.join(projectPath, "routes"), { recursive: true });
      await fs.mkdir(path.join(projectPath, "public"), { recursive: true });
      await fs.mkdir(path.join(projectPath, "views"), { recursive: true });

      // 创建server.js
      const serverCode = `const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.json({ message: 'Hello World!' });
});

app.listen(port, () => {
  console.log(\`Server running on port \${port}\`);
});`;

      await fs.writeFile(path.join(projectPath, "server.js"), serverCode);
      break;

    case "react":
      await fs.mkdir(path.join(projectPath, "src"), { recursive: true });
      await fs.mkdir(path.join(projectPath, "public"), { recursive: true });

      // 创建index.html
      const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>React App</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>`;

      await fs.writeFile(path.join(projectPath, "index.html"), indexHtml);

      // 创建src/main.jsx
      const mainJsx = `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)`;

      await fs.writeFile(path.join(projectPath, "src", "main.jsx"), mainJsx);

      // 创建src/App.jsx
      const appJsx = `import { useState } from 'react'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="App">
      <h1>Hello React</h1>
      <button onClick={() => setCount(count + 1)}>
        Count: {count}
      </button>
    </div>
  )
}

export default App`;

      await fs.writeFile(path.join(projectPath, "src", "App.jsx"), appJsx);

      // 创建vite.config.js
      const viteConfig = `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})`;

      await fs.writeFile(path.join(projectPath, "vite.config.js"), viteConfig);
      break;

    default:
      // 基础结构
      await fs.mkdir(path.join(projectPath, "src"), { recursive: true });
      await fs.writeFile(
        path.join(projectPath, "src", "index.js"),
        'console.log("Hello World");',
      );
  }
}
```

#### tool_dockerfile_generator - Dockerfile生成器

```javascript
async function tool_dockerfile_generator(params, context) {
  const {
    appType = "node", // node, python, java
    baseImage = null,
    workdir = "/app",
    port = 3000,
    buildSteps = [],
    filePath,
  } = params;

  let dockerfile = "";

  switch (appType) {
    case "node":
      dockerfile = `# Node.js Application
FROM ${baseImage || "node:18-alpine"}

WORKDIR ${workdir}

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Expose port
EXPOSE ${port}

# Start application
CMD ["node", "index.js"]`;
      break;

    case "python":
      dockerfile = `# Python Application
FROM ${baseImage || "python:3.11-slim"}

WORKDIR ${workdir}

# Copy requirements
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose port
EXPOSE ${port}

# Start application
CMD ["python", "app.py"]`;
      break;

    case "java":
      dockerfile = `# Java Application
FROM ${baseImage || "openjdk:17-jdk-slim"} AS build

WORKDIR ${workdir}

# Copy source and build
COPY . .
RUN ./mvnw clean package -DskipTests

FROM openjdk:17-jre-slim

WORKDIR ${workdir}

# Copy JAR from build stage
COPY --from=build ${workdir}/target/*.jar app.jar

# Expose port
EXPOSE ${port}

# Start application
CMD ["java", "-jar", "app.jar"]`;
      break;
  }

  // 添加自定义构建步骤
  if (buildSteps.length > 0) {
    dockerfile += "\n\n# Custom build steps\n";
    dockerfile += buildSteps.join("\n");
  }

  // 写入文件
  await fs.writeFile(filePath, dockerfile);

  return {
    success: true,
    filePath,
    message: "Dockerfile生成成功",
  };
}
```

### 5.3 数据科学工具集 (4个工具)

**文件**: `src/main/ai-engine/extended-tools-datascience.js` (450行)

#### tool_data_analyzer - 数据分析器

```javascript
async function tool_data_analyzer(params, context) {
  const { data, analysisType = "descriptive" } = params;

  const results = {};

  if (analysisType === "descriptive" || analysisType === "all") {
    // 描述性统计
    results.descriptive = calculateDescriptiveStats(data);
  }

  if (analysisType === "correlation" || analysisType === "all") {
    // 相关性分析
    results.correlation = calculateCorrelation(data);
  }

  if (analysisType === "distribution" || analysisType === "all") {
    // 分布分析
    results.distribution = analyzeDistribution(data);
  }

  return {
    success: true,
    results,
    rowCount: data.length,
    columnCount: Object.keys(data[0] || {}).length,
  };
}

function calculateDescriptiveStats(data) {
  const stats = {};

  // 获取数值列
  const numericColumns = Object.keys(data[0]).filter((col) => {
    return typeof data[0][col] === "number";
  });

  for (const column of numericColumns) {
    const values = data.map((row) => row[column]).filter((v) => v != null);

    stats[column] = {
      count: values.length,
      mean: mean(values),
      median: median(values),
      std: standardDeviation(values),
      min: Math.min(...values),
      max: Math.max(...values),
      q1: quantile(values, 0.25),
      q3: quantile(values, 0.75),
    };
  }

  return stats;
}

function mean(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function standardDeviation(values) {
  const avg = mean(values);
  const squareDiffs = values.map((v) => Math.pow(v - avg, 2));
  const avgSquareDiff = mean(squareDiffs);
  return Math.sqrt(avgSquareDiff);
}

function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;

  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}
```

#### tool_data_visualizer - 数据可视化

```javascript
async function tool_data_visualizer(params, context) {
  const {
    data,
    chartType = "bar", // bar, line, pie, scatter
    xAxis,
    yAxis,
    title = "",
    outputPath,
  } = params;

  // 生成ECharts配置
  const chartConfig = generateEChartsConfig(
    data,
    chartType,
    xAxis,
    yAxis,
    title,
  );

  // 生成HTML文件
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.0/dist/echarts.min.js"></script>
</head>
<body>
  <div id="chart" style="width: 100%; height: 600px;"></div>
  <script>
    var chart = echarts.init(document.getElementById('chart'));
    var option = ${JSON.stringify(chartConfig, null, 2)};
    chart.setOption(option);

    window.addEventListener('resize', function() {
      chart.resize();
    });
  </script>
</body>
</html>`;

  await fs.writeFile(outputPath, html);

  return {
    success: true,
    outputPath,
    chartType,
    message: "图表生成成功",
  };
}

function generateEChartsConfig(data, chartType, xAxis, yAxis, title) {
  const config = {
    title: { text: title },
    tooltip: {},
    legend: {},
    xAxis: { type: "category", data: data.map((row) => row[xAxis]) },
    yAxis: { type: "value" },
    series: [],
  };

  switch (chartType) {
    case "bar":
      config.series.push({
        name: yAxis,
        type: "bar",
        data: data.map((row) => row[yAxis]),
      });
      break;

    case "line":
      config.series.push({
        name: yAxis,
        type: "line",
        data: data.map((row) => row[yAxis]),
        smooth: true,
      });
      break;

    case "pie":
      delete config.xAxis;
      delete config.yAxis;
      config.series.push({
        name: title,
        type: "pie",
        radius: "50%",
        data: data.map((row) => ({
          name: row[xAxis],
          value: row[yAxis],
        })),
      });
      break;

    case "scatter":
      config.series.push({
        name: yAxis,
        type: "scatter",
        data: data.map((row) => [row[xAxis], row[yAxis]]),
      });
      break;
  }

  return config;
}
```

### 5.4 视觉工具集 (6个工具)

**文件**: `src/main/ai-engine/extended-tools-vision.js` (380行)

#### tool_image_analyzer - 图像分析

```javascript
async function tool_image_analyzer(params, context) {
  const { imagePath, analysisType = "all" } = params;

  const results = {};

  // 加载图像
  const image = await sharp(imagePath);
  const metadata = await image.metadata();

  results.metadata = {
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    size: metadata.size,
    hasAlpha: metadata.hasAlpha,
  };

  // OCR文本识别
  if (analysisType === "ocr" || analysisType === "all") {
    const ocrResult = await Tesseract.recognize(imagePath, "eng");
    results.ocr = {
      text: ocrResult.data.text,
      confidence: ocrResult.data.confidence,
    };
  }

  // 颜色分析
  if (analysisType === "color" || analysisType === "all") {
    const { dominant } = await image.stats();
    results.color = {
      dominant: {
        r: Math.round(dominant.r),
        g: Math.round(dominant.g),
        b: Math.round(dominant.b),
      },
    };
  }

  return {
    success: true,
    results,
    message: "图像分析完成",
  };
}
```

#### tool_image_enhancer - 图像增强

```javascript
async function tool_image_enhancer(params, context) {
  const {
    inputPath,
    outputPath,
    operations = [], // resize, crop, rotate, blur, sharpen, brightness, contrast
  } = params;

  let image = sharp(inputPath);

  for (const operation of operations) {
    switch (operation.type) {
      case "resize":
        image = image.resize(operation.width, operation.height);
        break;

      case "crop":
        image = image.extract({
          left: operation.x,
          top: operation.y,
          width: operation.width,
          height: operation.height,
        });
        break;

      case "rotate":
        image = image.rotate(operation.angle);
        break;

      case "blur":
        image = image.blur(operation.sigma || 5);
        break;

      case "sharpen":
        image = image.sharpen();
        break;

      case "brightness":
        image = image.modulate({
          brightness: operation.value,
        });
        break;

      case "contrast":
        image = image.normalize();
        break;
    }
  }

  await image.toFile(outputPath);

  return {
    success: true,
    inputPath,
    outputPath,
    operationsApplied: operations.length,
    message: "图像增强完成",
  };
}
```

---

## 6. 工作流监控系统

### 6.1 工作流定义

**标准工作流6阶段**:

```
1. 需求分析 (Requirement Analysis)
   - 收集用户需求
   - 编写需求文档
   - 需求评审
   质量门禁: 需求文档完整性检查

2. 架构设计 (Architecture Design)
   - 系统架构设计
   - 数据库设计
   - API接口设计
   质量门禁: 架构评审通过

3. 编码实现 (Implementation)
   - 前端开发
   - 后端开发
   - 数据库实现
   质量门禁: 代码质量≥80分, 无严重bug

4. 测试 (Testing)
   - 单元测试
   - 集成测试
   - 性能测试
   质量门禁: 测试覆盖率≥80%

5. 部署 (Deployment)
   - 构建打包
   - 部署到测试环境
   - 部署到生产环境
   质量门禁: 应用正常运行

6. 交付 (Delivery)
   - 生成项目文档
   - 用户培训
   - 项目归档
   质量门禁: 用户验收通过
```

### 6.2 质量门禁系统

**文件**: `src/main/workflow/quality-gate-checker.js`

```javascript
class QualityGateChecker {
  constructor({ db, projectPath }) {
    this.db = db;
    this.projectPath = projectPath;
  }

  /**
   * 检查质量门禁
   */
  async checkQualityGate(workflowId, stageId, gateId) {
    const gate = await this.loadQualityGate(workflowId, stageId, gateId);

    let result;

    switch (gate.type) {
      case "code_quality":
        result = await this.checkCodeQuality();
        break;

      case "test_coverage":
        result = await this.checkTestCoverage();
        break;

      case "security_scan":
        result = await this.checkSecurityScan();
        break;

      case "performance":
        result = await this.checkPerformance();
        break;

      case "documentation":
        result = await this.checkDocumentation();
        break;

      default:
        result = { passed: false, reason: "未知的质量门禁类型" };
    }

    // 保存结果
    await this.saveQualityGateResult(workflowId, stageId, gateId, result);

    return result;
  }

  /**
   * 代码质量检查
   */
  async checkCodeQuality() {
    try {
      // 1. 运行ESLint
      const lintResult = await this.runESLint();

      // 2. 运行测试
      const testResult = await this.runTests();

      // 3. 计算质量分数
      const qualityScore = this.calculateQualityScore({
        lintErrors: lintResult.errorCount,
        lintWarnings: lintResult.warningCount,
        testCoverage: testResult.coverage,
        testsPassed: testResult.passed,
        testsTotal: testResult.total,
      });

      const passed = qualityScore >= 80;

      return {
        passed,
        score: qualityScore,
        details: {
          lint: lintResult,
          test: testResult,
        },
        reason: passed ? "代码质量达标" : `代码质量分数${qualityScore}<80`,
      };
    } catch (error) {
      return {
        passed: false,
        score: 0,
        reason: `检查失败: ${error.message}`,
      };
    }
  }

  async runESLint() {
    const { stdout } = await execPromise("npx eslint . --format json", {
      cwd: this.projectPath,
    });

    const results = JSON.parse(stdout);

    const errorCount = results.reduce((sum, file) => sum + file.errorCount, 0);
    const warningCount = results.reduce(
      (sum, file) => sum + file.warningCount,
      0,
    );

    return {
      errorCount,
      warningCount,
      results,
    };
  }

  async runTests() {
    const { stdout } = await execPromise("npm test -- --coverage --json", {
      cwd: this.projectPath,
    });

    const result = JSON.parse(stdout);

    return {
      passed: result.numPassedTests,
      failed: result.numFailedTests,
      total: result.numTotalTests,
      coverage: result.coverageMap?.total?.lines?.pct || 0,
    };
  }

  calculateQualityScore(metrics) {
    let score = 100;

    // 扣分规则
    score -= metrics.lintErrors * 5;
    score -= metrics.lintWarnings * 1;
    score -= (100 - metrics.testCoverage) * 0.5;

    const testPassRate = (metrics.testsPassed / metrics.testsTotal) * 100;
    score -= (100 - testPassRate) * 0.3;

    return Math.max(0, Math.round(score));
  }

  /**
   * 测试覆盖率检查
   */
  async checkTestCoverage() {
    try {
      const testResult = await this.runTests();

      const passed = testResult.coverage >= 80;

      return {
        passed,
        coverage: testResult.coverage,
        reason: passed
          ? `测试覆盖率${testResult.coverage}%达标`
          : `测试覆盖率${testResult.coverage}%<80%`,
      };
    } catch (error) {
      return {
        passed: false,
        coverage: 0,
        reason: `测试失败: ${error.message}`,
      };
    }
  }

  /**
   * 安全扫描检查
   */
  async checkSecurityScan() {
    try {
      // 运行npm audit
      const { stdout } = await execPromise("npm audit --json", {
        cwd: this.projectPath,
      });

      const audit = JSON.parse(stdout);

      const criticalVulnerabilities =
        audit.metadata?.vulnerabilities?.critical || 0;
      const highVulnerabilities = audit.metadata?.vulnerabilities?.high || 0;

      const passed = criticalVulnerabilities === 0 && highVulnerabilities === 0;

      return {
        passed,
        vulnerabilities: audit.metadata?.vulnerabilities || {},
        reason: passed
          ? "无高危安全漏洞"
          : `发现${criticalVulnerabilities}个严重漏洞,${highVulnerabilities}个高危漏洞`,
      };
    } catch (error) {
      return {
        passed: false,
        reason: `安全扫描失败: ${error.message}`,
      };
    }
  }

  /**
   * 性能检查
   */
  async checkPerformance() {
    try {
      // 运行Lighthouse (示例)
      // 实际实现需要使用lighthouse库

      const performanceScore = 85; // 模拟分数

      const passed = performanceScore >= 80;

      return {
        passed,
        score: performanceScore,
        reason: passed
          ? `性能分数${performanceScore}达标`
          : `性能分数${performanceScore}<80`,
      };
    } catch (error) {
      return {
        passed: false,
        score: 0,
        reason: `性能测试失败: ${error.message}`,
      };
    }
  }

  /**
   * 文档完整性检查
   */
  async checkDocumentation() {
    try {
      const requiredDocs = [
        "README.md",
        "CHANGELOG.md",
        "docs/API.md",
        "docs/DEPLOYMENT.md",
      ];

      const missingDocs = [];

      for (const doc of requiredDocs) {
        const docPath = path.join(this.projectPath, doc);
        const exists = await fs
          .access(docPath)
          .then(() => true)
          .catch(() => false);

        if (!exists) {
          missingDocs.push(doc);
        }
      }

      const passed = missingDocs.length === 0;

      return {
        passed,
        requiredDocs,
        missingDocs,
        reason: passed ? "文档完整" : `缺少文档: ${missingDocs.join(", ")}`,
      };
    } catch (error) {
      return {
        passed: false,
        reason: `文档检查失败: ${error.message}`,
      };
    }
  }
}
```

### 6.3 前端工作流监控

**页面**: `src/renderer/pages/WorkflowMonitorPage.vue`

```vue
<template>
  <div class="workflow-monitor-page">
    <a-page-header title="工作流监控" />

    <!-- 工作流列表 -->
    <div class="workflow-list">
      <a-row :gutter="16">
        <a-col v-for="workflow in workflows" :key="workflow.id" :span="8">
          <a-card
            hoverable
            class="workflow-card"
            @click="handleSelectWorkflow(workflow)"
          >
            <template #title>
              {{ workflow.name }}
              <a-tag :color="getStatusColor(workflow.status)">
                {{ workflow.status }}
              </a-tag>
            </template>

            <!-- 整体进度 -->
            <a-progress
              :percent="calculateProgress(workflow)"
              :status="getProgressStatus(workflow.status)"
            />

            <!-- 阶段摘要 -->
            <div class="stage-summary">
              <a-tag
                v-for="stage in workflow.stages"
                :key="stage.id"
                :color="getStageColor(stage.status)"
              >
                {{ stage.name }}
              </a-tag>
            </div>

            <!-- 操作按钮 -->
            <template #actions>
              <a @click.stop="handlePauseWorkflow(workflow)">
                {{ workflow.status === "running" ? "暂停" : "继续" }}
              </a>
              <a @click.stop="handleViewDetails(workflow)">详情</a>
            </template>
          </a-card>
        </a-col>
      </a-row>
    </div>

    <!-- 工作流详情弹窗 -->
    <a-modal
      v-model:visible="detailModalVisible"
      title="工作流详情"
      width="1000px"
      :footer="null"
    >
      <WorkflowProgress v-if="selectedWorkflow" :workflow="selectedWorkflow" />
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { useWorkflowStore } from "@/stores/workflow";
import WorkflowProgress from "@/components/workflow/WorkflowProgress.vue";

const workflowStore = useWorkflowStore();
const workflows = computed(() => workflowStore.workflows);

const selectedWorkflow = ref(null);
const detailModalVisible = ref(false);

onMounted(() => {
  workflowStore.loadWorkflows();
});

function calculateProgress(workflow) {
  const total = workflow.stages.length;
  const completed = workflow.stages.filter(
    (s) => s.status === "completed",
  ).length;
  return Math.round((completed / total) * 100);
}

function getStatusColor(status) {
  const colors = {
    running: "blue",
    paused: "orange",
    completed: "green",
    failed: "red",
  };
  return colors[status] || "default";
}

function getStageColor(status) {
  const colors = {
    pending: "default",
    running: "processing",
    completed: "success",
    failed: "error",
  };
  return colors[status] || "default";
}

function handleViewDetails(workflow) {
  selectedWorkflow.value = workflow;
  detailModalVisible.value = true;
}

async function handlePauseWorkflow(workflow) {
  const newStatus = workflow.status === "running" ? "paused" : "running";

  await workflowStore.updateWorkflowStatus(workflow.id, newStatus);
}
</script>
```

**组件**: `src/renderer/components/workflow/WorkflowProgress.vue`

```vue
<template>
  <div class="workflow-progress">
    <!-- 整体进度 -->
    <div class="overall-progress">
      <h3>整体进度</h3>
      <a-progress
        :percent="overallProgress"
        :status="progressStatus"
        stroke-color="#52c41a"
      />
    </div>

    <!-- 阶段列表 -->
    <a-timeline>
      <a-timeline-item
        v-for="(stage, index) in workflow.stages"
        :key="stage.id"
        :color="getTimelineColor(stage.status)"
      >
        <template #dot>
          <loading-outlined v-if="stage.status === 'running'" spin />
          <check-circle-outlined v-else-if="stage.status === 'completed'" />
          <close-circle-outlined v-else-if="stage.status === 'failed'" />
          <clock-circle-outlined v-else />
        </template>

        <div class="stage-item">
          <div class="stage-header">
            <h4>{{ stage.name }}</h4>
            <a-tag :color="getStatusColor(stage.status)">
              {{ stage.status }}
            </a-tag>
          </div>

          <!-- 任务列表 -->
          <a-collapse ghost>
            <a-collapse-panel key="tasks" header="任务列表">
              <a-list :data-source="stage.tasks" size="small">
                <template #renderItem="{ item }">
                  <a-list-item>
                    <a-list-item-meta>
                      <template #title>
                        {{ item.name }}
                      </template>
                      <template #avatar>
                        <check-outlined
                          v-if="item.status === 'completed'"
                          style="color: #52c41a"
                        />
                        <loading-outlined
                          v-else-if="item.status === 'running'"
                          spin
                        />
                        <minus-outlined v-else />
                      </template>
                    </a-list-item-meta>
                  </a-list-item>
                </template>
              </a-list>
            </a-collapse-panel>
          </a-collapse>

          <!-- 质量门禁 -->
          <div
            v-if="stage.qualityGates && stage.qualityGates.length > 0"
            class="quality-gates"
          >
            <h5>质量门禁</h5>
            <QualityGateCard
              v-for="gate in stage.qualityGates"
              :key="gate.id"
              :gate="gate"
            />
          </div>
        </div>
      </a-timeline-item>
    </a-timeline>
  </div>
</template>

<script setup>
import { computed } from "vue";
import QualityGateCard from "./QualityGateCard.vue";
import {
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  CheckOutlined,
  MinusOutlined,
} from "@ant-design/icons-vue";

const props = defineProps({
  workflow: {
    type: Object,
    required: true,
  },
});

const overallProgress = computed(() => {
  const total = props.workflow.stages.length;
  const completed = props.workflow.stages.filter(
    (s) => s.status === "completed",
  ).length;
  return Math.round((completed / total) * 100);
});

const progressStatus = computed(() => {
  if (props.workflow.status === "failed") return "exception";
  if (props.workflow.status === "completed") return "success";
  return "active";
});

function getTimelineColor(status) {
  const colors = {
    pending: "gray",
    running: "blue",
    completed: "green",
    failed: "red",
  };
  return colors[status] || "gray";
}

function getStatusColor(status) {
  const colors = {
    pending: "default",
    running: "processing",
    completed: "success",
    failed: "error",
  };
  return colors[status] || "default";
}
</script>
```

---

## 7. 关键页面与组件

### 7.1 核心页面文件路径

**项目管理**:

- `E:\code\chainlesschain\desktop-app-vue\src\renderer\pages\projects\ProjectsPage.vue` - 项目列表页
- `E:\code\chainlesschain\desktop-app-vue\src\renderer\pages\projects\ProjectDetailPage.vue` - 项目详情页 (2000+行)
- `E:\code\chainlesschain\desktop-app-vue\src\renderer\pages\projects\NewProjectPage.vue` - 新建项目页

**AI 对话**:

- `E:\code\chainlesschain\desktop-app-vue\src\renderer\pages\AIChatPage.vue` - AI对话主页
- `E:\code\chainlesschain\desktop-app-vue\src\renderer\pages\AIPromptsPage.vue` - AI提示词管理

**Cowork 协作**:

- `E:\code\chainlesschain\desktop-app-vue\src\renderer\pages\CoworkDashboard.vue` - 协作仪表板
- `E:\code\chainlesschain\desktop-app-vue\src\renderer\pages\TaskMonitor.vue` - 任务监控
- `E:\code\chainlesschain\desktop-app-vue\src\renderer\pages\SkillManager.vue` - 技能管理
- `E:\code\chainlesschain\desktop-app-vue\src\renderer\pages\CoworkAnalytics.vue` - 数据分析

**工作流**:

- `E:\code\chainlesschain\desktop-app-vue\src\renderer\pages\WorkflowMonitorPage.vue` - 工作流监控

### 7.2 核心组件

**项目组件** (`src/renderer/components/projects/`):

- `AIProjectCreator.vue` - AI辅助创建
- `ChatPanel.vue` - 对话面板 (115KB)
- `CodeAssistantPanel.vue` - 代码助手
- `ConversationInput.vue` - 对话输入
- `TaskExecutionMonitor.vue` - 任务执行监控
- `EnhancedFileTree.vue` - 文件树
- `MonacoEditor.vue` - 代码编辑器

**Cowork 组件** (`src/renderer/components/cowork/`):

- `TeamCard.vue` - 团队卡片
- `TeamDetailPanel.vue` - 团队详情 (15KB)
- `TaskDetailPanel.vue` - 任务详情 (10KB)
- `SkillCard.vue` - 技能卡片

**工作流组件** (`src/renderer/components/workflow/`):

- `WorkflowProgress.vue` - 工作流进度 (16KB)
- `QualityGateCard.vue` - 质量门禁卡片
- `StepTimeline.vue` - 步骤时间轴

### 7.3 主进程模块

**AI 引擎** (`src/main/ai-engine/`):

- `task-planner-enhanced.js` - 任务规划器 (1221行)
- `task-executor.js` - 任务执行器 (532行)
- `function-caller.js` - 工具调用器 (1050行)
- `tool-masking.js` - 工具掩码 (Manus优化)

**Cowork 系统** (`src/main/ai-engine/cowork/`):

- `teammate-tool.js` - TeammateTool (28KB)
- `long-running-task-manager.js` - 长时任务管理 (20KB)
- `file-sandbox.js` - 文件沙箱 (20KB)
- `cowork-ipc.js` - IPC处理器 (25KB, 45+ handlers)

**多代理系统** (`src/main/ai-engine/multi-agent/`):

- `agent-orchestrator.js` - 代理协调器 (584行)
- `cowork-orchestrator.js` - Cowork协调器 (507行)

**扩展工具** (`src/main/ai-engine/extended-tools-*.js`):

- `extended-tools-office.js` - Office工具 (577行, 6工具)
- `extended-tools-project.js` - 项目工具 (562行, 6工具)
- `extended-tools-datascience.js` - 数据科学工具 (450行, 4工具)
- `extended-tools-vision.js` - 视觉工具 (380行, 6工具)
- 以及其他10个工具集文件

---

## 8. 技术架构总结

### 8.1 前端架构

**技术栈**:

- **核心**: Vue 3.4 + Composition API + `<script setup>`
- **构建**: Vite (开发服务器 + HMR)
- **UI库**: Ant Design Vue 4.1 (组件库)
- **状态**: Pinia (集中式状态管理)
- **路由**: Vue Router (Hash模式)
- **编辑器**: Monaco Editor (VS Code内核)
- **图表**: ECharts 5.4 (数据可视化)

**组件总数**: 338个Vue组件

**关键特性**:

- 代码分割与懒加载
- 虚拟滚动 (大列表优化)
- 实时IPC通信
- 对话式UI交互

### 8.2 主进程架构

**核心模块**:

- **AI引擎**: 60+ 模块文件
- **数据库**: SQLite + SQLCipher (AES-256加密)
- **LLM管理器**: 支持14+ 云端LLM + 本地Ollama
- **RAG引擎**: 向量检索 + 重排序
- **P2P网络**: libp2p + Signal Protocol
- **U-Key集成**: Windows硬件安全 (Koffi FFI)

**IPC通信**: 100+ IPC handlers

**工具集**: 14个扩展工具集,总计100+ 工具函数

### 8.3 AI引擎架构

```
┌─────────────────────────────────────────────────────────────┐
│                    AI Engine (5层架构)                        │
├─────────────────────────────────────────────────────────────┤
│ Layer 5: 决策层 (Decision Layer)                             │
│  - CoworkOrchestrator (多代理决策)                           │
│  - 单代理 vs 多代理选择                                       │
│  - 三种多代理策略                                             │
├─────────────────────────────────────────────────────────────┤
│ Layer 4: 协调层 (Orchestration Layer)                        │
│  - TeammateTool (13个核心操作)                               │
│  - AgentOrchestrator (单代理协调)                            │
│  - 长时任务管理 (Checkpoint/Recovery)                        │
├─────────────────────────────────────────────────────────────┤
│ Layer 3: 规划层 (Planning Layer)                             │
│  - TaskPlannerEnhanced (RAG增强)                             │
│  - HierarchicalTaskPlanner (分层规划)                        │
│  - TaskTracker (任务跟踪)                                    │
├─────────────────────────────────────────────────────────────┤
│ Layer 2: 执行层 (Execution Layer)                            │
│  - TaskExecutor (并发控制 + 依赖解析)                        │
│  - FunctionCaller (工具调用 + 工具掩码)                      │
│  - FileSandbox (文件访问控制)                                │
├─────────────────────────────────────────────────────────────┤
│ Layer 1: 工具层 (Tool Layer)                                 │
│  - 14个扩展工具集 (100+ 工具)                                │
│  - Office / 项目 / 数据科学 / 视觉 / 沙箱 / MemGPT...       │
└─────────────────────────────────────────────────────────────┘
```

### 8.4 数据流

```
用户输入 (Vue)
  ↓ IPC invoke
Main Process
  ↓ TaskPlannerEnhanced
RAG检索 + LLM规划
  ↓ JSON任务计划
CoworkOrchestrator
  ↓ 多代理决策
TaskExecutor / TeammateTool
  ↓ 并发执行
FunctionCaller
  ↓ 工具调用
扩展工具集
  ↓ 文件操作 / LLM调用
结果返回
  ↓ IPC on/send
Renderer Process (实时更新)
```

### 8.5 性能优化

**前端优化**:

- 虚拟滚动 (VirtualFileTree)
- 懒加载路由
- 图片懒加载
- 防抖/节流
- Memoization (computed)

**主进程优化**:

- KV-Cache优化 (Manus工具掩码)
- 任务计划缓存
- 连接池 (数据库)
- 批量操作
- Checkpoint机制 (长时任务)

**LLM优化**:

- Context Engineering
- Tool Masking
- 低温度采样 (规划阶段)
- Token限制
- 流式响应

### 8.6 安全机制

**文件安全**:

- FileSandbox沙箱隔离
- 白名单/黑名单机制
- 路径规范化
- 访问日志审计

**数据安全**:

- SQLCipher AES-256加密
- U-Key硬件安全
- 敏感文件过滤 (.env, \*.key等)

**网络安全**:

- P2P加密通信 (Signal Protocol)
- DID去中心化身份

---

## 9. 快速开始指南

### 9.1 开发环境启动

```bash
# 1. 启动后端服务
docker-compose up -d

# 2. 启动桌面应用
cd desktop-app-vue
npm install
npm run dev

# 访问: http://localhost:5173 (Vite自动打开Electron)
```

### 9.2 创建第一个项目

1. **打开项目列表页** (`#/projects`)
2. **输入需求**: "创建一个React + TypeScript的Todo应用"
3. **等待AI规划**: 自动生成任务计划
4. **实时监控**: 查看任务执行进度
5. **项目创建完成**: 自动跳转到项目详情页

### 9.3 使用AI代码助手

1. **打开项目详情页**
2. **选择文件**: 在文件树中选择要编辑的文件
3. **打开AI助手面板**: 右侧工具栏
4. **使用功能**:
   - 代码生成
   - 智能建议
   - 代码解释
   - 代码优化

### 9.4 启动多代理协作

1. **打开Cowork仪表板** (`#/cowork/dashboard`)
2. **创建团队**: 点击"创建新团队"
3. **分配任务**: 为团队成员分配具体任务
4. **监控进度**: 在任务监控页面查看实时状态
5. **查看结果**: 任务完成后自动合并结果

---

## 10. 常见使用场景

### 场景1: 快速生成项目脚手架

**需求**: "创建一个Express + MongoDB的博客后端"

**流程**:

1. AI规划: 4个步骤
   - 初始化Express项目
   - 创建MongoDB模型
   - 生成CRUD API
   - 生成API文档
2. 并发执行: 2-3分钟完成
3. 输出: 完整的项目结构 + 代码 + README

### 场景2: 批量处理Office文档

**需求**: "将50个Excel数据文件合并并生成可视化报告"

**流程**:

1. 多代理决策: 检测到可并行化
2. 创建10个代理并行处理
3. 使用data_analyzer工具分析
4. 使用data_visualizer生成图表
5. 使用word_generator生成报告

### 场景3: AI辅助代码重构

**需求**: "优化现有React组件的性能"

**流程**:

1. 打开组件文件
2. AI助手分析代码
3. 提供优化建议:
   - 使用React.memo
   - 提取昂贵计算到useMemo
   - 避免不必要的重渲染
4. 应用建议,查看Diff
5. Git提交

---

## 11. 参考文档

### 官方文档

- **系统设计**: `docs/design/系统设计_个人移动AI管理系统.md`
- **快速开始**: `QUICK_START.md`, `HOW_TO_RUN.md`
- **Cowork系统**: `docs/features/COWORK_QUICK_START.md`
- **Manus优化**: `docs/MANUS_OPTIMIZATION_GUIDE.md`
- **工作流集成**: `docs/PROJECT_WORKFLOW_OPTIMIZATION_PLAN.md`

### 技术参考

- Vue 3: https://vuejs.org/
- Ant Design Vue: https://antdv.com/
- Electron: https://www.electronjs.org/
- Monaco Editor: https://microsoft.github.io/monaco-editor/
- ECharts: https://echarts.apache.org/

---

## 附录: 项目统计

**代码规模**:

- 总行数: ~200,000 行
- Vue组件: 338 个
- 主进程模块: 100+ 个
- 工具函数: 100+ 个

**功能模块**:

- AI引擎: 60+ 模块
- 扩展工具: 14 个工具集
- Cowork系统: 13 个核心操作
- 质量门禁: 6 种检查类型

**测试覆盖**:

- 单元测试: 200+ 测试用例
- Cowork系统测试覆盖率: ~90%

---

**报告完成日期**: 2026-01-27
**版本**: v1.0.0
**作者**: ChainlessChain开发团队
