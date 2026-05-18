# Manus/OpenManus 最佳实践优化指南

基于对 [Manus AI](https://manus.im/) 和 [OpenManus](https://github.com/FoundationAgents/OpenManus) 的深入研究，结合 ChainlessChain 现有架构，本文档提出具体的优化建议。

## 一、架构对比分析

### 当前项目 vs Manus/OpenManus

| 特性 | ChainlessChain | Manus/OpenManus | 差距分析 |
|------|----------------|-----------------|----------|
| Agent 循环 | ✅ 意图→规划→执行 | ✅ 分析→规划→执行→观察 | 缺少明确的观察阶段 |
| 任务规划 | ✅ 三层分解 | ✅ 分层规划 | 基本相当 |
| 工具调用 | ✅ FunctionCaller | ✅ CodeAct (Python) | Manus 使用代码作为通用动作 |
| 自我纠正 | ✅ SelfCorrectionLoop | ✅ 迭代纠正 | 基本相当 |
| 上下文工程 | ⚠️ 基础压缩 | ✅ KV-Cache 优化 | **需要优化** |
| 文件系统作为记忆 | ⚠️ 会话持久化 | ✅ todo.md 机制 | **需要优化** |
| 多 Agent 协作 | ❌ 单 Agent | ✅ 多 Agent 架构 | **需要新增** |
| 工具掩码 | ❌ 动态修改定义 | ✅ Logits 掩码 | **需要优化** |

## 二、核心优化建议

### P0: Context Engineering 优化（高优先级）

Manus 团队强调 "Context Engineering" 是构建生产级 Agent 的关键。

#### 2.1 KV-Cache 友好的 Prompt 设计

**问题**: 当前项目可能在 prompt 中使用动态内容（如时间戳），导致 KV-Cache 失效。

**优化方案**:

```javascript
// desktop-app-vue/src/main/llm/context-engineering.js

class ContextEngineering {
  constructor() {
    // 静态 Prompt 前缀（可缓存）
    this.staticPrefix = null;
    this.cacheBreakpoints = [];
  }

  /**
   * 构建 KV-Cache 友好的 Prompt
   * 原则：保持前缀稳定，只在末尾添加动态内容
   */
  buildCacheOptimizedPrompt(systemPrompt, messages, tools) {
    // 1. 静态部分（高度稳定）
    const staticPart = [
      { role: 'system', content: systemPrompt },
      { role: 'system', content: this.getToolDefinitions(tools) }
    ];

    // 2. 标记缓存断点
    this.markCacheBreakpoint(staticPart.length);

    // 3. 动态部分（只追加，不修改）
    const dynamicPart = messages.map(msg => ({
      role: msg.role,
      content: msg.content,
      // 避免时间戳等动态字段
    }));

    return [...staticPart, ...dynamicPart];
  }

  /**
   * 工具定义序列化（确保确定性）
   */
  getToolDefinitions(tools) {
    // 按名称排序，确保顺序一致
    const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
    return JSON.stringify(sorted);
  }

  markCacheBreakpoint(position) {
    this.cacheBreakpoints.push(position);
  }
}

module.exports = { ContextEngineering };
```

#### 2.2 工具掩码而非移除

**问题**: 动态修改工具定义会破坏 KV-Cache。

**优化方案**:

```javascript
// desktop-app-vue/src/main/ai-engine/tool-masking.js

class ToolMaskingSystem {
  constructor() {
    // 所有工具的完整定义（保持不变）
    this.allTools = new Map();
    // 当前状态下可用的工具（掩码）
    this.availableMask = new Set();
  }

  /**
   * 注册工具时使用一致的命名前缀
   * 例如: browser_navigate, browser_click, file_read, file_write
   */
  registerTool(tool) {
    this.allTools.set(tool.name, tool);
    this.availableMask.add(tool.name);
  }

  /**
   * 通过掩码控制工具可用性，而非修改定义
   */
  setToolAvailability(toolName, available) {
    if (available) {
      this.availableMask.add(toolName);
    } else {
      this.availableMask.delete(toolName);
    }
  }

  /**
   * 按前缀批量控制
   * 例如: disableToolsByPrefix('browser_') 禁用所有浏览器工具
   */
  setToolsByPrefix(prefix, available) {
    for (const name of this.allTools.keys()) {
      if (name.startsWith(prefix)) {
        this.setToolAvailability(name, available);
      }
    }
  }

  /**
   * 获取工具定义（始终返回完整列表）
   * 配合 logits 掩码在推理时过滤
   */
  getToolDefinitions() {
    return Array.from(this.allTools.values());
  }

  /**
   * 获取当前可用工具掩码
   */
  getAvailabilityMask() {
    return this.availableMask;
  }

  /**
   * 验证工具调用是否被允许
   */
  isToolAllowed(toolName) {
    return this.availableMask.has(toolName);
  }
}

module.exports = { ToolMaskingSystem };
```

### P1: todo.md 机制（注意力操纵）

Manus 的关键创新之一是使用 `todo.md` 文件"将任务目标重述到上下文末尾"，解决"丢失中间"问题。

#### 3.1 任务追踪文件系统

```javascript
// desktop-app-vue/src/main/ai-engine/task-tracker-file.js

const fs = require('fs-extra');
const path = require('path');

class TaskTrackerFile {
  constructor(workspaceDir) {
    this.workspaceDir = workspaceDir;
    this.todoPath = path.join(workspaceDir, 'todo.md');
    this.contextPath = path.join(workspaceDir, 'context.md');
  }

  /**
   * 创建或更新 todo.md
   * Manus 策略：每次迭代更新，将目标"重述"到上下文末尾
   */
  async updateTodoFile(plan, currentStep, status) {
    const content = this.generateTodoContent(plan, currentStep, status);
    await fs.writeFile(this.todoPath, content, 'utf-8');
    return content;
  }

  generateTodoContent(plan, currentStep, status) {
    const lines = [
      '# Task Progress',
      '',
      `## Current Objective`,
      `> ${plan.objective}`,
      '',
      '## Steps',
    ];

    plan.steps.forEach((step, index) => {
      const marker = index < currentStep ? '[x]' :
                     index === currentStep ? '[>]' : '[ ]';
      const statusText = index === currentStep ? ` (${status})` : '';
      lines.push(`${marker} Step ${index + 1}: ${step.description}${statusText}`);
    });

    lines.push('');
    lines.push('## Current Focus');
    lines.push(`> Working on Step ${currentStep + 1}: ${plan.steps[currentStep]?.description}`);

    return lines.join('\n');
  }

  /**
   * 读取 todo.md 内容，注入到 prompt 末尾
   */
  async getTodoContext() {
    if (await fs.pathExists(this.todoPath)) {
      return await fs.readFile(this.todoPath, 'utf-8');
    }
    return null;
  }

  /**
   * 保存中间结果到文件（可恢复）
   */
  async saveIntermediateResult(stepId, result) {
    const resultPath = path.join(this.workspaceDir, `step_${stepId}_result.json`);
    await fs.writeJson(resultPath, result, { spaces: 2 });
  }

  /**
   * 清理工作空间
   */
  async cleanup() {
    await fs.remove(this.todoPath);
    await fs.remove(this.contextPath);
  }
}

module.exports = { TaskTrackerFile };
```

#### 3.2 集成到 AI Engine

```javascript
// 在 ai-engine-manager.js 中集成

class AIEngineManager {
  constructor() {
    // ... 现有代码
    this.taskTracker = new TaskTrackerFile(this.getWorkspaceDir());
  }

  async executeTask(userRequest, context) {
    // 1. 意图识别
    const intent = await this.intentClassifier.classify(userRequest);

    // 2. 任务规划
    const plan = await this.taskPlanner.decomposeTask(userRequest, context);

    // 3. 初始化 todo.md
    await this.taskTracker.updateTodoFile(plan, 0, 'starting');

    // 4. 迭代执行
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];

      // 更新 todo.md（注意力操纵）
      await this.taskTracker.updateTodoFile(plan, i, 'in_progress');

      // 获取 todo 上下文，注入到 prompt 末尾
      const todoContext = await this.taskTracker.getTodoContext();

      // 执行步骤（带 todo 上下文）
      const result = await this.executeStep(step, { todoContext });

      // 保存中间结果
      await this.taskTracker.saveIntermediateResult(i, result);

      // 更新完成状态
      await this.taskTracker.updateTodoFile(plan, i, 'completed');
    }

    return { success: true, plan };
  }
}
```

### P2: 文件系统作为扩展上下文

Manus 的策略：超长观察数据使用可恢复的压缩——保留 URL/路径，丢弃内容本体。

#### 4.1 可恢复压缩策略

```javascript
// desktop-app-vue/src/main/llm/recoverable-compression.js

class RecoverableCompression {
  /**
   * 压缩长内容，保留可恢复的引用
   */
  compress(content, type) {
    switch (type) {
      case 'webpage':
        return this.compressWebpage(content);
      case 'file':
        return this.compressFile(content);
      case 'database_result':
        return this.compressDbResult(content);
      default:
        return this.defaultCompress(content);
    }
  }

  compressWebpage(data) {
    // 保留 URL，丢弃 HTML 内容
    return {
      type: 'webpage_ref',
      url: data.url,
      title: data.title,
      summary: data.summary?.slice(0, 200),
      recoverable: true,
      _originalLength: data.content?.length
    };
  }

  compressFile(data) {
    // 保留路径，丢弃文件内容
    return {
      type: 'file_ref',
      path: data.path,
      name: data.name,
      size: data.size,
      preview: data.content?.slice(0, 500),
      recoverable: true,
      _originalLength: data.content?.length
    };
  }

  compressDbResult(data) {
    // 保留查询和元数据，截断大结果集
    const MAX_ROWS = 10;
    return {
      type: 'db_result_ref',
      query: data.query,
      totalRows: data.rows?.length,
      preview: data.rows?.slice(0, MAX_ROWS),
      columns: data.columns,
      recoverable: true
    };
  }

  /**
   * 恢复压缩内容（按需）
   */
  async recover(compressedRef) {
    switch (compressedRef.type) {
      case 'webpage_ref':
        return await this.fetchWebpage(compressedRef.url);
      case 'file_ref':
        return await this.readFile(compressedRef.path);
      case 'db_result_ref':
        return await this.rerunQuery(compressedRef.query);
      default:
        throw new Error('Unknown ref type');
    }
  }

  async fetchWebpage(url) {
    // 实现网页抓取
  }

  async readFile(filePath) {
    const fs = require('fs-extra');
    return await fs.readFile(filePath, 'utf-8');
  }

  async rerunQuery(query) {
    // 实现数据库查询
  }
}

module.exports = { RecoverableCompression };
```

### P3: CodeAct 范式（可选增强）

Manus 使用可执行 Python 代码作为通用动作机制，而非固定的 JSON 工具调用。

#### 5.1 CodeAct 执行器

```javascript
// desktop-app-vue/src/main/ai-engine/codeact-executor.js

const { PythonShell } = require('python-shell');
const vm = require('vm');

class CodeActExecutor {
  constructor(options = {}) {
    this.sandboxDir = options.sandboxDir || './sandbox';
    this.timeout = options.timeout || 30000;
    this.allowedModules = options.allowedModules || [
      'json', 'os', 'datetime', 'math', 're'
    ];
  }

  /**
   * 执行 LLM 生成的 Python 代码
   * CodeAct 核心：用代码表达复杂操作
   */
  async executePython(code, context = {}) {
    // 安全检查
    this.validateCode(code);

    const options = {
      mode: 'text',
      pythonPath: 'python3',
      pythonOptions: ['-u'],
      scriptPath: this.sandboxDir,
      args: [JSON.stringify(context)]
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Execution timeout'));
      }, this.timeout);

      PythonShell.runString(code, options, (err, results) => {
        clearTimeout(timeout);
        if (err) reject(err);
        else resolve(results);
      });
    });
  }

  /**
   * 执行 JavaScript 代码（Node.js 环境）
   */
  async executeJavaScript(code, context = {}) {
    const sandbox = {
      console: {
        log: (...args) => this.logs.push(args.join(' ')),
        error: (...args) => this.errors.push(args.join(' '))
      },
      context,
      result: null,
      // 注入安全的工具函数
      tools: this.getSafeTools()
    };

    this.logs = [];
    this.errors = [];

    const script = new vm.Script(code, { timeout: this.timeout });
    const vmContext = vm.createContext(sandbox);

    try {
      script.runInContext(vmContext);
      return {
        success: true,
        result: sandbox.result,
        logs: this.logs,
        errors: this.errors
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        logs: this.logs,
        errors: this.errors
      };
    }
  }

  validateCode(code) {
    // 禁止危险操作
    const forbidden = [
      'subprocess', 'eval', 'exec', 'compile',
      '__import__', 'open(/etc', 'rm -rf'
    ];

    for (const pattern of forbidden) {
      if (code.includes(pattern)) {
        throw new Error(`Forbidden pattern detected: ${pattern}`);
      }
    }
  }

  getSafeTools() {
    return {
      readFile: async (path) => { /* 安全读取 */ },
      writeFile: async (path, content) => { /* 安全写入 */ },
      httpGet: async (url) => { /* 安全请求 */ },
      // ... 其他安全工具
    };
  }
}

module.exports = { CodeActExecutor };
```

### P4: 多 Agent 协作架构

OpenManus 的多 Agent 设计值得借鉴。

#### 6.1 Agent 协调器

```javascript
// desktop-app-vue/src/main/ai-engine/multi-agent/agent-orchestrator.js

class AgentOrchestrator {
  constructor() {
    this.agents = new Map();
    this.messageQueue = [];
  }

  /**
   * 注册专用 Agent
   */
  registerAgent(agentId, agentInstance) {
    this.agents.set(agentId, agentInstance);
  }

  /**
   * 分发任务到合适的 Agent
   */
  async dispatch(task) {
    const agentId = this.selectAgent(task);
    const agent = this.agents.get(agentId);

    if (!agent) {
      throw new Error(`No agent found for task type: ${task.type}`);
    }

    return await agent.execute(task);
  }

  /**
   * 选择最适合的 Agent
   */
  selectAgent(task) {
    const agentScores = new Map();

    for (const [id, agent] of this.agents) {
      const score = agent.canHandle(task);
      agentScores.set(id, score);
    }

    // 返回得分最高的 Agent
    let bestAgent = null;
    let bestScore = 0;

    for (const [id, score] of agentScores) {
      if (score > bestScore) {
        bestScore = score;
        bestAgent = id;
      }
    }

    return bestAgent;
  }

  /**
   * Agent 间通信
   */
  async sendMessage(fromAgent, toAgent, message) {
    this.messageQueue.push({
      from: fromAgent,
      to: toAgent,
      message,
      timestamp: Date.now()
    });

    const targetAgent = this.agents.get(toAgent);
    if (targetAgent) {
      return await targetAgent.receiveMessage(message);
    }
  }
}

// 专用 Agent 基类
class SpecializedAgent {
  constructor(agentId, capabilities) {
    this.agentId = agentId;
    this.capabilities = capabilities;
  }

  canHandle(task) {
    // 返回 0-1 的得分，表示处理该任务的能力
    return this.capabilities.includes(task.type) ? 1.0 : 0.0;
  }

  async execute(task) {
    throw new Error('Must be implemented by subclass');
  }

  async receiveMessage(message) {
    // 处理来自其他 Agent 的消息
  }
}

// 示例：代码生成 Agent
class CodeGenerationAgent extends SpecializedAgent {
  constructor() {
    super('code-gen', ['generate_code', 'refactor', 'review']);
  }

  async execute(task) {
    switch (task.type) {
      case 'generate_code':
        return await this.generateCode(task);
      case 'refactor':
        return await this.refactorCode(task);
      case 'review':
        return await this.reviewCode(task);
    }
  }

  async generateCode(task) {
    // 实现代码生成逻辑
  }
}

// 示例：数据分析 Agent
class DataAnalysisAgent extends SpecializedAgent {
  constructor() {
    super('data-analysis', ['analyze_data', 'visualize', 'transform']);
  }

  async execute(task) {
    // 实现数据分析逻辑
  }
}

module.exports = {
  AgentOrchestrator,
  SpecializedAgent,
  CodeGenerationAgent,
  DataAnalysisAgent
};
```

### P5: 保留错误信息

Manus 的重要经验：失败案例帮助模型适应，比隐藏错误更有效。

```javascript
// 增强现有的 self-correction-loop.js

class EnhancedSelfCorrectionLoop {
  constructor() {
    // 保留最近的错误上下文
    this.errorHistory = [];
    this.maxErrorHistory = 5;
  }

  /**
   * 执行时保留错误上下文
   */
  async executeWithErrorContext(step, context) {
    try {
      const result = await this.executor.execute(step);
      return { success: true, result };
    } catch (error) {
      // 记录错误（供模型学习）
      const errorContext = {
        step,
        error: error.message,
        stack: error.stack,
        timestamp: Date.now()
      };

      this.errorHistory.push(errorContext);
      if (this.errorHistory.length > this.maxErrorHistory) {
        this.errorHistory.shift();
      }

      // 将错误信息注入到下次的 prompt 中
      return {
        success: false,
        error,
        errorContext: this.getErrorContextForPrompt()
      };
    }
  }

  /**
   * 生成错误上下文供 LLM 参考
   */
  getErrorContextForPrompt() {
    if (this.errorHistory.length === 0) return '';

    return `
## Recent Errors (for learning)
${this.errorHistory.map((e, i) => `
### Error ${i + 1}
- Step: ${e.step.description}
- Error: ${e.error}
- Resolution: ${e.resolution || 'pending'}
`).join('\n')}
`;
  }
}
```

## 三、实施路线图

### 第一阶段（1-2 周）：Context Engineering ✅ 已完成

1. ✅ 实现 `ContextEngineering` 类 (`context-engineering.js`)
2. ✅ 重构 Prompt 构建流程，确保 KV-Cache 友好
3. ✅ 实现工具掩码系统 (`tool-masking.js`)
4. ✅ 集成到 FunctionCaller 和 LLMManager

### 第二阶段（2-3 周）：todo.md 机制 ✅ 已完成

1. ✅ 实现 `TaskTrackerFile` 类 (`task-tracker-file.js`)
2. ✅ 集成到 ManusOptimizations
3. ✅ 实现可恢复压缩策略 (`RecoverableCompressor`)
4. ✅ 创建 IPC 处理器 (`task-tracker-ipc.js`)

### 第三阶段（3-4 周）：多 Agent 架构 ✅ 已完成

1. ✅ 实现 Agent 协调器 (`agent-orchestrator.js`)
2. ✅ 创建专用 Agent 基类 (`specialized-agent.js`)
3. ✅ 实现专用 Agent：
   - `CodeGenerationAgent` - 代码生成、重构、审查
   - `DataAnalysisAgent` - 数据分析、可视化、转换
   - `DocumentAgent` - 文档编写、编辑、翻译
4. ✅ 实现 Agent 间通信和并行执行
5. ✅ 创建 IPC 处理器 (`multi-agent-ipc.js`)

### 第四阶段（可选）：CodeAct 范式

1. 实现安全的代码执行器
2. 训练 LLM 生成可执行代码
3. 集成到工具调用系统

## 四、性能优化目标

| 指标 | 当前值 | 目标值 | 优化方式 |
|------|--------|--------|----------|
| KV-Cache 命中率 | ~30% | >80% | Context Engineering |
| 长任务成功率 | ~70% | >90% | todo.md 机制 |
| Token 成本 | 基准 | -50% | 可恢复压缩 |
| 复杂任务完成时间 | 基准 | -30% | 多 Agent 并行 |

## 五、参考资源

- [Context Engineering for AI Agents: Lessons from Building Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
- [OpenManus GitHub](https://github.com/FoundationAgents/OpenManus)
- [OpenManus Technical Analysis](https://llmmultiagents.com/en/blogs/OpenManus_Technical_Analysis)
- [Manus AI Technical Investigation](https://gist.github.com/renschni/4fbc70b31bad8dd57f3370239dccd58f)

## 六、已实现文件列表

### Context Engineering & Tool Masking

| 文件 | 路径 | 说明 |
|------|------|------|
| context-engineering.js | `src/main/llm/` | KV-Cache 优化、Prompt 清理 |
| tool-masking.js | `src/main/ai-engine/` | 工具掩码系统、状态机 |
| manus-optimizations.js | `src/main/llm/` | 集成模块 |
| manus-ipc.js | `src/main/llm/` | IPC 处理器 |

### todo.md 机制

| 文件 | 路径 | 说明 |
|------|------|------|
| task-tracker-file.js | `src/main/ai-engine/` | 任务追踪文件系统 |
| task-tracker-ipc.js | `src/main/ai-engine/` | IPC 处理器 |

### 多 Agent 架构

| 文件 | 路径 | 说明 |
|------|------|------|
| agent-orchestrator.js | `src/main/ai-engine/multi-agent/` | Agent 协调器 |
| specialized-agent.js | `src/main/ai-engine/multi-agent/` | 专用 Agent 基类 |
| code-generation-agent.js | `src/main/ai-engine/multi-agent/agents/` | 代码生成 Agent |
| data-analysis-agent.js | `src/main/ai-engine/multi-agent/agents/` | 数据分析 Agent |
| document-agent.js | `src/main/ai-engine/multi-agent/agents/` | 文档处理 Agent |
| multi-agent-ipc.js | `src/main/ai-engine/multi-agent/` | IPC 处理器 |
| index.js | `src/main/ai-engine/multi-agent/` | 模块入口 |

## 七、使用示例

### 7.1 使用 TaskTrackerFile 追踪任务

```javascript
const { getTaskTrackerFile } = require('./ai-engine/task-tracker-file');

const tracker = getTaskTrackerFile();

// 创建任务
const task = await tracker.createTask({
  objective: '创建一个 React 组件库',
  steps: [
    '设计组件 API',
    '实现 Button 组件',
    '实现 Input 组件',
    '编写测试',
    '生成文档'
  ]
});

// 开始任务
await tracker.startTask();

// 更新进度
await tracker.updateProgress(0, 'in_progress');

// 完成步骤
await tracker.completeCurrentStep({ summary: 'API 设计完成' });

// 获取 todo.md 上下文（用于 prompt）
const todoContext = await tracker.getTodoContext();
console.log(todoContext);
```

### 7.2 使用多 Agent 系统

```javascript
const {
  getAgentOrchestrator,
  initializeDefaultAgents
} = require('./ai-engine/multi-agent');

// 获取协调器
const orchestrator = getAgentOrchestrator();

// 初始化默认 Agent
initializeDefaultAgents(orchestrator, { llmManager, functionCaller });

// 分发任务到合适的 Agent
const result = await orchestrator.dispatch({
  type: 'generate_code',
  input: {
    description: '创建一个 React Button 组件',
    language: 'typescript',
    framework: 'react'
  }
});

// 并行执行多个任务
const results = await orchestrator.executeParallel([
  { type: 'generate_code', input: { ... } },
  { type: 'analyze_data', input: { ... } },
  { type: 'write_document', input: { ... } }
]);

// 链式执行（前一个输出作为下一个输入）
const finalResult = await orchestrator.executeChain([
  { type: 'analyze_data', input: { data: [...] } },
  { type: 'visualize', input: { purpose: '展示趋势' } },
  { type: 'write_document', input: { topic: '数据分析报告' } }
]);
```

### 7.3 使用 ManusOptimizations 集成

```javascript
const { getManusOptimizations } = require('./llm/manus-optimizations');

const manus = getManusOptimizations();

// 开始任务（自动持久化到 todo.md）
await manus.startTask({
  objective: '优化数据库查询',
  steps: ['分析慢查询', '添加索引', '验证性能']
});

// 构建优化后的 Prompt
const { messages, metadata } = manus.buildOptimizedPrompt({
  systemPrompt: 'You are a helpful assistant.',
  messages: [...],
  tools: [...]
});

// 获取 todo.md 上下文
const todoContext = await manus.getTodoContext();

// 恢复未完成的任务
const task = await manus.resumeUnfinishedTask();
```

---

*文档创建日期: 2026-01-17*
*文档更新日期: 2026-01-17*
*基于 Manus/OpenManus 研究的优化实现*
