# IPC API 文档

本文档记录了Electron主进程与渲染进程之间的IPC接口变更和标准返回格式。

**最后更新**: 2026-01-04

## 目录

- [修复摘要](#修复摘要)
- [技能和工具管理API](#技能和工具管理api)
- [项目管理API](#项目管理api)
- [事件监听API](#事件监听api)
- [返回格式规范](#返回格式规范)

---

## 修复摘要

### 问题1: 工具数据加载为0 ✅ 已修复

**问题描述**:
- `toolManager.getAllTools()` 直接返回数组
- IPC handler错误地检查 `result.success`，导致总是返回空数组
- 前端Store无法获取工具数据

**修复方案**:
修改了 `skill-tool-ipc.js` 中的 `getAllToolsHandler` 和 `getAllSkillsHandler`，使其：
1. 正确处理数组返回格式
2. 统一返回 `{ success: true, data: [], tools: [] }` 格式
3. 兼容多种返回格式以保证向后兼容

**文件修改**:
- `desktop-app-vue/src/main/skill-tool-system/skill-tool-ipc.js`

**变更细节**:
```javascript
// 修复前
const getAllToolsHandler = async (event, options = {}) => {
  const result = await toolManager.getAllTools(options);
  if (result.success) {
    return result.tools || [];
  }
  return [];
};

// 修复后
const getAllToolsHandler = async (event, options = {}) => {
  const result = await toolManager.getAllTools(options);

  // toolManager.getAllTools 直接返回数组
  if (Array.isArray(result)) {
    return { success: true, data: result, tools: result };
  }

  // 兼容可能的对象返回格式
  if (result && result.success) {
    return { success: true, data: result.tools || [], tools: result.tools || [] };
  }

  return { success: true, data: [], tools: [] };
};
```

---

### 问题2: 任务执行事件未捕获 ✅ 已修复

**问题描述**:
- E2E测试期待通过 `electronAPI.project.onTaskExecute` 监听任务执行事件
- Preload脚本未暴露此事件监听器
- 主进程未发送任务执行事件

**修复方案**:
1. 在 `preload/index.js` 中添加 `onTaskExecute` 和 `offTaskExecute` 事件监听器
2. 在 `project-core-ipc.js` 的流式创建流程中发送 `project:task-execute` 事件

**文件修改**:
- `desktop-app-vue/src/preload/index.js`
- `desktop-app-vue/src/main/project/project-core-ipc.js`

**变更细节**:

**Preload暴露API**:
```javascript
// 任务执行事件监听
onTaskExecute: (callback) => ipcRenderer.on('project:task-execute', (_event, task) => callback(task)),
offTaskExecute: (callback) => ipcRenderer.removeListener('project:task-execute', callback),
```

**主进程发送事件**:
```javascript
// 在 onProgress 回调中
event.sender.send('project:task-execute', {
  stage: data.stage,
  name: data.stage,
  message: data.message,
  status: 'running',
  timestamp: Date.now(),
});
```

**使用示例**:
```javascript
// 监听任务执行事件
window.electronAPI.project.onTaskExecute((task) => {
  console.log(`任务执行: ${task.stage} - ${task.message}`);
});
```

---

### 问题3: 项目创建返回格式 ✅ 已优化

**问题描述**:
- `project:create` 直接返回项目对象
- 与其他IPC接口的 `{ success, data }` 格式不一致
- 测试代码已兼容两种格式

**当前状态**:
保持现有格式以避免破坏性变更，但在文档中明确说明差异。

**返回格式**:
```javascript
// project:create 返回格式（直接返回项目对象）
{
  id: string,
  name: string,
  project_type: string,
  files: Array,
  metadata: Object,
  // ...其他字段
}

// tool:getAll / skill:getAll 返回格式（统一格式）
{
  success: true,
  data: Array,
  tools: Array  // 或 skills: Array
}
```

**兼容性处理**:
```javascript
// 前端代码应这样处理
const result = await callIPC('project:create', createData);
const project = result.project || result;  // 兼容两种格式
```

---

## 技能和工具管理API

### Skill (技能) APIs

#### `skill:get-all` / `skill:getAll`

获取所有技能列表。

**调用方式**:
```javascript
const result = await window.electronAPI.skill.getAll(options);
```

**参数**:
- `options` (Object, 可选): 查询选项
  - `enabled` (Number): 筛选启用状态 (0=禁用, 1=启用)
  - `category` (String): 按分类筛选
  - `limit` (Number): 限制返回数量
  - `offset` (Number): 分页偏移量

**返回格式**:
```javascript
{
  success: true,
  data: [
    {
      id: string,
      name: string,
      display_name: string,
      description: string,
      category: string,
      enabled: number,  // 0 或 1
      tags: Object,     // JSON 解析后的对象
      config: Object,   // JSON 解析后的对象
      // ...其他字段
    }
  ],
  skills: Array  // 与 data 相同，为了向后兼容
}
```

**兼容性说明**:
- 同时支持 `skill:get-all` (短横线) 和 `skill:getAll` (驼峰) 两种调用方式
- 返回结果同时包含 `data` 和 `skills` 字段，确保兼容不同的调用代码

---

#### `skill:get-by-id`

根据ID获取单个技能。

**调用方式**:
```javascript
const result = await window.electronAPI.skill.getById(skillId);
```

**参数**:
- `skillId` (String): 技能ID

**返回格式**:
```javascript
{
  success: true,
  data: {
    id: string,
    name: string,
    display_name: string,
    description: string,
    category: string,
    enabled: number,
    tags: Object,
    config: Object,
    // ...
  }
}
```

---

### Tool (工具) APIs

#### `tool:get-all` / `tool:getAll`

获取所有工具列表。

**调用方式**:
```javascript
const result = await window.electronAPI.tool.getAll(options);
```

**参数**:
- `options` (Object, 可选): 查询选项
  - `enabled` (Number): 筛选启用状态
  - `category` (String): 按分类筛选
  - `plugin_id` (String): 按插件ID筛选
  - `is_builtin` (Number): 筛选内置工具
  - `deprecated` (Number): 筛选已弃用工具
  - `limit` (Number): 限制返回数量
  - `offset` (Number): 分页偏移量

**返回格式**:
```javascript
{
  success: true,
  data: [
    {
      id: string,
      name: string,
      display_name: string,
      description: string,
      category: string,
      tool_type: string,
      enabled: number,
      parameters_schema: Object,  // JSON 解析后的对象
      return_schema: Object,      // JSON 解析后的对象
      required_permissions: Array, // JSON 解析后的数组
      risk_level: number,
      usage_count: number,
      success_count: number,
      avg_execution_time: number,
      // ...
    }
  ],
  tools: Array  // 与 data 相同，为了向后兼容
}
```

**兼容性说明**:
- 同时支持 `tool:get-all` 和 `tool:getAll`
- 返回结果同时包含 `data` 和 `tools` 字段

---

#### `tool:get-by-id`

根据ID获取单个工具。

**调用方式**:
```javascript
const result = await window.electronAPI.tool.getById(toolId);
```

**参数**:
- `toolId` (String): 工具ID

**返回格式**:
```javascript
{
  success: true,
  data: {
    id: string,
    name: string,
    display_name: string,
    description: string,
    category: string,
    parameters_schema: Object,
    return_schema: Object,
    required_permissions: Array,
    // ...
  }
}
```

---

## 项目管理API

### `project:create`

创建新项目（调用后端AI生成）。

**调用方式**:
```javascript
const project = await window.electronAPI.project.create(createData);
```

**参数**:
- `createData` (Object): 项目创建数据
  - `name` (String): 项目名称
  - `userPrompt` (String): 用户提示词
  - `projectType` (String): 项目类型 (web/document/data等)
  - `userId` (String): 用户ID
  - `selectedSkills` (Array, 可选): 选择的技能ID列表
  - `selectedTools` (Array, 可选): 选择的工具ID列表

**返回格式**:
```javascript
// 直接返回项目对象（注意：与其他API不同）
{
  id: string,
  name: string,
  project_type: string,
  user_id: string,
  created_at: number,
  updated_at: number,
  sync_status: string,
  file_count: number,
  files: [
    {
      id: string,
      project_id: string,
      path: string,
      content: string,
      file_type: string,
      // ...
    }
  ],
  metadata: Object,
  // ...
}
```

**注意事项**:
- 此接口直接返回项目对象，而不是 `{ success, project }` 格式
- 这是为了保持向后兼容性
- 前端代码应使用 `const project = result.project || result` 来兼容两种格式

---

### `project:create-stream`

流式创建项目（SSE，实时推送进度）。

**调用方式**:
```javascript
await window.electronAPI.project.createStream(createData, callbacks);
```

**参数**:
- `createData` (Object): 同 `project:create`
- `callbacks` (Object): 回调函数
  - `onProgress` (Function): 进度回调 `(data) => void`
  - `onContent` (Function): 内容回调 `(data) => void`
  - `onComplete` (Function): 完成回调 `(data) => void`
  - `onError` (Function): 错误回调 `(error) => void`

**事件格式**:

**Progress Event** (`project:stream-chunk` with `type: 'progress'`):
```javascript
{
  type: 'progress',
  data: {
    stage: string,      // 阶段名称 (intent/spec/html/css/js等)
    message: string,    // 进度消息
    timestamp: number
  }
}
```

**Content Event** (`project:stream-chunk` with `type: 'content'`):
```javascript
{
  type: 'content',
  data: {
    stage: string,
    content: string     // 生成的内容片段
  }
}
```

**Complete Event** (`project:stream-chunk` with `type: 'complete'`):
```javascript
{
  type: 'complete',
  data: {
    files: Array,
    metadata: Object,
    project_type: string
  }
}
```

**Error Event** (`project:stream-chunk` with `type: 'error'`):
```javascript
{
  type: 'error',
  error: string
}
```

**返回格式**:
```javascript
{
  success: true
}
```

---

## 事件监听API

### 任务执行事件

**事件名称**: `project:task-execute`

**监听方式**:
```javascript
// 注册监听器
window.electronAPI.project.onTaskExecute((task) => {
  console.log(`任务: ${task.stage}`);
  console.log(`消息: ${task.message}`);
  console.log(`状态: ${task.status}`);
});

// 移除监听器
const handler = (task) => { /* ... */ };
window.electronAPI.project.onTaskExecute(handler);
window.electronAPI.project.offTaskExecute(handler);
```

**事件数据格式**:
```javascript
{
  stage: string,      // 任务阶段 (intent/spec/html/css/js等)
  name: string,       // 任务名称（通常与stage相同）
  message: string,    // 任务描述信息
  status: string,     // 任务状态 (running/completed/failed)
  timestamp: number   // 时间戳
}
```

**触发时机**:
- 在 `project:create-stream` 流程中，每个阶段开始时触发
- 与 `project:stream-chunk` (progress) 同时发送

**使用场景**:
- 在UI中显示任务执行进度
- 记录任务执行顺序
- 验证任务调度逻辑

**示例**:
```javascript
const taskOrder = [];

window.electronAPI.project.onTaskExecute((task) => {
  taskOrder.push(task.stage);
  console.log(`执行顺序: ${taskOrder.join(' → ')}`);
});

// 创建项目
await window.electronAPI.project.createStream(createData, {
  onComplete: () => {
    console.log(`完整执行顺序: ${taskOrder.join(' → ')}`);
    // 例如: intent → spec → html → css → js
  }
});
```

---

### 文件更新事件

**事件名称**: `project:files-updated`

**监听方式**:
```javascript
window.electronAPI.project.onFilesUpdated((data) => {
  console.log('文件已更新:', data);
});
```

---

### 任务进度更新事件

**事件名称**: `task:progress-update`

**监听方式**:
```javascript
window.electronAPI.project.onTaskProgressUpdate((progress) => {
  console.log('任务进度:', progress);
});
```

---

## 返回格式规范

### 标准成功响应

大多数IPC接口应遵循以下格式：

```javascript
{
  success: true,
  data: any,          // 实际数据
  [resource]: any     // 资源名称字段（如 tools, skills, projects 等），为了向后兼容
}
```

**示例**:
```javascript
// Tool API
{
  success: true,
  data: [...],
  tools: [...]  // 与 data 相同
}

// Skill API
{
  success: true,
  data: [...],
  skills: [...]  // 与 data 相同
}
```

---

### 标准错误响应

```javascript
{
  success: false,
  error: string,      // 错误消息
  data: null          // 或空数组/空对象
}
```

**示例**:
```javascript
{
  success: false,
  error: "工具不存在: tool_123",
  data: null
}
```

---

### 例外情况

某些历史遗留接口可能不遵循标准格式：

1. **`project:create`**: 直接返回项目对象
2. **`project:get-all`**: 直接返回项目数组

**前端兼容性代码**:
```javascript
// 处理 project:create
const result = await callIPC('project:create', data);
const project = result.project || result;

// 处理 tool:getAll
const result = await callIPC('tool:getAll');
const tools = result.success ? (result.data || result.tools) : [];
```

---

## Store层处理示例

### Tool Store

```javascript
// desktop-app-vue/src/renderer/stores/tool.js

async fetchAll(options = {}) {
  this.loading = true;
  try {
    const toolAPI = window.electronAPI?.tool || window.electron?.api?.tool;
    const result = await toolAPI.getAll(options);

    // 处理新的返回格式
    if (result.success) {
      const tools = Array.isArray(result.data)
        ? result.data
        : (result.tools || result.content || []);

      this.tools = tools.map(tool => ({
        ...tool,
        // 解析JSON字符串
        parameters_schema: typeof tool.parameters_schema === 'string'
          ? JSON.parse(tool.parameters_schema)
          : (tool.parameters_schema || {}),
        return_schema: typeof tool.return_schema === 'string'
          ? JSON.parse(tool.return_schema)
          : (tool.return_schema || {}),
        required_permissions: typeof tool.required_permissions === 'string'
          ? JSON.parse(tool.required_permissions)
          : (tool.required_permissions || []),
      }));
    }
  } catch (error) {
    console.error('获取工具失败:', error);
  } finally {
    this.loading = false;
  }
}
```

---

### Skill Store

```javascript
// desktop-app-vue/src/renderer/stores/skill.js

async fetchAll(options = {}) {
  this.loading = true;
  try {
    const skillAPI = window.electronAPI?.skill || window.electron?.api?.skill;
    const result = await skillAPI.getAll(options);

    if (result.success) {
      const skills = Array.isArray(result.data)
        ? result.data
        : (result.skills || []);

      this.skills = skills.map(skill => ({
        ...skill,
        tags: typeof skill.tags === 'string'
          ? JSON.parse(skill.tags)
          : (skill.tags || []),
        config: typeof skill.config === 'string'
          ? JSON.parse(skill.config)
          : (skill.config || {}),
      }));
    }
  } catch (error) {
    console.error('获取技能失败:', error);
  } finally {
    this.loading = false;
  }
}
```

---

## 测试兼容性

E2E测试应兼容多种返回格式：

```javascript
// tests/e2e/project-creation-workflow.e2e.test.ts

test('应该能够获取工具列表', async () => {
  const { app, window } = await launchElectronApp();

  try {
    const result = await callIPC(window, 'tool:getAll');

    // 兼容多种返回格式
    let tools;
    if (result.success) {
      tools = result.data || result.tools || [];
    } else if (Array.isArray(result)) {
      tools = result;
    } else {
      tools = [];
    }

    console.log('获取到的工具数量:', tools.length);

    if (tools.length > 0) {
      expect(Array.isArray(tools)).toBe(true);

      const tool = tools[0];
      expect(tool).toHaveProperty('id');
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('category');

      console.log('✅ 获取工具列表成功');
    } else {
      console.log('⚠️ 没有可用工具');
    }
  } finally {
    await closeElectronApp(app);
  }
});
```

---

## 迁移指南

### 从旧格式迁移到新格式

如果你的代码依赖旧的返回格式，可以这样迁移：

**旧代码**:
```javascript
const tools = await window.electronAPI.tool.getAll();
// 期待返回数组
```

**新代码**:
```javascript
const result = await window.electronAPI.tool.getAll();
const tools = result.success ? (result.data || result.tools || []) : [];
// 兼容新旧格式
```

---

**旧代码**:
```javascript
const project = await window.electronAPI.project.create(data);
// 直接使用 project
this.projects.push(project);
```

**新代码**:
```javascript
const result = await window.electronAPI.project.create(data);
const project = result.project || result;  // 兼容两种格式
this.projects.push(project);
```

---

## 常见问题

### Q1: 为什么工具数据加载为0？

**A**: 这是因为IPC handler错误地检查了不存在的 `success` 属性。已在最新版本中修复。确保你使用的是修复后的版本。

### Q2: 为什么任务执行事件未触发？

**A**: 需要确保：
1. Preload脚本已暴露 `onTaskExecute` 方法
2. 主进程在流程中发送 `project:task-execute` 事件
3. 使用 `project:createStream` 而不是 `project:create`

### Q3: 为什么项目创建返回格式与其他API不同？

**A**: 这是历史遗留原因，为了保持向后兼容性。建议在使用时添加兼容性处理代码。

### Q4: 如何确保IPC调用的兼容性？

**A**: 始终使用兼容性处理代码：
```javascript
const result = await callIPC('api:method', params);
const data = result.success
  ? (result.data || result.specificField || [])
  : (Array.isArray(result) ? result : []);
```

---

## 版本历史

### v0.16.1 (2026-01-04)

#### 修复
- ✅ 修复工具数据加载为0的问题
- ✅ 添加任务执行事件监听器
- ✅ 统一IPC返回格式（skill和tool API）
- ✅ 改进错误处理和日志输出

#### 新增
- ✅ `onTaskExecute` / `offTaskExecute` 事件监听器
- ✅ `project:task-execute` 事件
- ✅ 统一的返回格式 `{ success, data, [resource] }`

#### 文档
- ✅ 新增完整的IPC API文档
- ✅ 添加迁移指南
- ✅ 添加测试兼容性示例

---

## 参考资料

- [CLAUDE.md](../../CLAUDE.md) - 项目整体文档
- [TEST_EXECUTION_SUMMARY.md](./TEST_EXECUTION_SUMMARY.md) - 测试执行总结
- [BUG_FIX_SUMMARY.md](./BUG_FIX_SUMMARY.md) - Bug修复总结
- [项目E2E测试指南](./PROJECT_CREATION_TEST_GUIDE.md)

---

**注意**: 本文档会随着API的演进持续更新。如有疑问或发现问题，请参考源代码或提交Issue。
