# AI任务智能拆解系统使用指南

**版本**: v1.0
**生成时间**: 2025-12-23
**适用版本**: ChainlessChain v0.17.0+

---

## 一、概述

AI任务智能拆解系统是ChainlessChain项目管理模块的核心功能，能够将用户的自然语言需求智能拆解为可执行的子任务步骤，并实时展示执行状态。

### 核心特性

✅ **智能拆解**: 使用LLM将自然语言需求拆解为结构化任务
✅ **依赖管理**: 自动解析任务间的依赖关系，按正确顺序执行
✅ **实时监控**: 实时展示任务执行进度和状态
✅ **多引擎支持**: 支持Web、文档、数据、PPT、代码等多种引擎
✅ **持久化存储**: 任务计划保存到数据库，可随时查看历史记录

---

## 二、系统架构

```
┌──────────────────────────────────────────────────────────┐
│                      前端（Vue3）                           │
│  ┌────────────────┐  ┌──────────────────────────────┐   │
│  │ ProjectsPage   │  │ TaskExecutionMonitor         │   │
│  │ (项目列表页)    │  │ (任务执行监控组件)            │   │
│  └────────────────┘  └──────────────────────────────┘   │
│           │                      │                        │
│           │ IPC调用              │ 监听进度更新            │
│           ↓                      ↓                        │
└───────────│──────────────────────│────────────────────────┘
            │                      │
            │  Electron IPC通道   │
            │                      │
┌───────────│──────────────────────│────────────────────────┐
│           ↓                      ↓   主进程（Node.js）     │
│  ┌─────────────────────────────────────────────────┐    │
│  │          AI引擎管理器 (AIEngineManager)           │    │
│  │  ┌────────────────────────────────────────────┐ │    │
│  │  │  TaskPlannerEnhanced (任务规划器)           │ │    │
│  │  │                                              │ │    │
│  │  │  - decomposeTask() 任务拆解                 │ │    │
│  │  │  - executeTaskPlan() 执行任务计划            │ │    │
│  │  │  - resolveExecutionOrder() 依赖解析         │ │    │
│  │  └────────────────────────────────────────────┘ │    │
│  └─────────────────────────────────────────────────┘    │
│           │                      │                        │
│           ↓                      ↓                        │
│  ┌────────────────┐  ┌──────────────────────────────┐   │
│  │  LLM管理器      │  │  各种引擎                      │   │
│  │  (Ollama/API)  │  │  - Web引擎                     │   │
│  └────────────────┘  │  - 文档引擎                     │   │
│           │          │  - 数据引擎                     │   │
│           ↓          │  - PPT引擎                      │   │
│  ┌────────────────┐  └──────────────────────────────┘   │
│  │  数据库         │                                      │
│  │  (SQLite)      │                                      │
│  └────────────────┘                                      │
└──────────────────────────────────────────────────────────┘
```

---

## 三、后端使用方法

### 3.1 文件位置

| 文件 | 路径 | 说明 |
|------|------|------|
| 核心类 | `src/main/ai-engine/task-planner-enhanced.js` | 任务规划器核心实现 |
| 管理器 | `src/main/ai-engine/ai-engine-manager.js` | AI引擎管理器 |
| IPC处理 | `src/main/index.js` (5082行) | IPC通信处理 |
| 数据库表 | `src/main/database.js` | project_task_plans表 |

### 3.2 基本用法示例

```javascript
// 1. 获取AI引擎管理器
const { getAIEngineManager } = require('./ai-engine/ai-engine-manager');
const aiEngineManager = getAIEngineManager();

// 2. 初始化（注入LLM、数据库等依赖）
await aiEngineManager.initialize();

// 3. 获取任务规划器
const taskPlanner = aiEngineManager.getTaskPlanner();

// 4. 拆解任务
const userRequest = '创建一个企业官网，包含首页、关于我们和联系我们页面';
const projectContext = {
  projectId: 'proj_12345',
  projectType: 'web',
  projectName: '企业官网',
  root_path: '/data/projects/proj_12345'
};

const taskPlan = await taskPlanner.decomposeTask(userRequest, projectContext);

console.log('任务计划:', taskPlan);
// 输出：
// {
//   id: 'uuid-xxx',
//   task_title: '创建企业官网',
//   task_type: 'create',
//   subtasks: [
//     { step: 1, title: '创建项目结构', tool: 'web-engine', ... },
//     { step: 2, title: '生成首页HTML', tool: 'web-engine', ... },
//     { step: 3, title: '生成关于我们页面', tool: 'web-engine', ... },
//     { step: 4, title: '生成联系我们页面', tool: 'web-engine', ... }
//   ],
//   status: 'pending',
//   ...
// }

// 5. 执行任务计划（带进度回调）
const result = await taskPlanner.executeTaskPlan(
  taskPlan,
  projectContext,
  (progress) => {
    console.log('进度更新:', progress);
    // progress.type: 'task-started' | 'subtask-started' | 'subtask-completed' | 'subtask-failed' | 'task-completed'
  }
);

console.log('执行结果:', result);
```

### 3.3 IPC调用示例

在主进程的IPC处理中已经集成，渲染进程可以通过IPC调用：

```javascript
// 前端调用示例
// 1. 拆解任务
const taskPlan = await window.electronAPI.invoke('project:decompose-task', userRequest, projectContext);

// 2. 执行任务计划
const result = await window.electronAPI.invoke('project:execute-task-plan', taskPlan.id, projectContext);

// 3. 监听进度更新
window.electronAPI.onTaskProgressUpdate((progress) => {
  console.log('任务进度:', progress);
});

// 4. 获取任务计划历史
const history = await window.electronAPI.invoke('project:get-task-plan-history', projectId, 10);

// 5. 取消任务
await window.electronAPI.invoke('project:cancel-task-plan', taskPlanId);
```

---

## 四、前端集成

### 4.1 在ProjectsPage中使用

```vue
<script setup>
import { ref } from 'vue';

const userInput = ref('');
const currentTaskPlan = ref(null);
const executionProgress = ref([]);

// 提交任务
const handleSubmit = async () => {
  try {
    // 1. 拆解任务
    const taskPlan = await window.electronAPI.invoke('project:decompose-task',
      userInput.value,
      {
        projectId: currentProject.value.id,
        projectType: currentProject.value.project_type,
        projectName: currentProject.value.name,
        root_path: currentProject.value.root_path
      }
    );

    currentTaskPlan.value = taskPlan;

    // 2. 开始执行
    executeTaskPlan(taskPlan.id);
  } catch (error) {
    console.error('任务处理失败:', error);
    message.error('任务处理失败: ' + error.message);
  }
};

// 执行任务计划
const executeTaskPlan = async (taskPlanId) => {
  try {
    const result = await window.electronAPI.invoke('project:execute-task-plan',
      taskPlanId,
      {
        projectId: currentProject.value.id,
        root_path: currentProject.value.root_path
      }
    );

    message.success('任务执行完成！');
  } catch (error) {
    console.error('任务执行失败:', error);
    message.error('任务执行失败: ' + error.message);
  }
};

// 监听进度更新
onMounted(() => {
  window.electronAPI.onTaskProgressUpdate((progress) => {
    executionProgress.value.push(progress);

    // 更新UI显示
    if (progress.type === 'subtask-started') {
      message.info(`正在执行: ${progress.subtask.title}`);
    } else if (progress.type === 'subtask-completed') {
      message.success(`已完成: ${progress.subtask.title}`);
    }
  });
});
</script>
```

### 4.2 创建TaskExecutionMonitor组件

参见下一节《实时任务执行监控组件》的实现。

---

## 五、任务计划数据结构

### 5.1 TaskPlan（任务计划）

```typescript
interface TaskPlan {
  id: string;                    // UUID
  task_title: string;            // 任务标题
  task_type: 'create' | 'modify' | 'analyze' | 'export';
  user_request: string;          // 用户原始需求
  estimated_duration: string;    // 预估时长（如"5分钟"）
  subtasks: Subtask[];           // 子任务列表
  final_output: {                // 最终输出
    type: 'file' | 'report' | 'visualization';
    description: string;
    files: string[];
  };
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  current_step: number;          // 当前执行步骤（1-based）
  total_steps: number;           // 总步骤数
  progress_percentage: number;   // 进度百分比（0-100）
  error_message?: string;        // 错误信息
  started_at?: number;           // 开始时间戳
  completed_at?: number;         // 完成时间戳
  created_at: number;            // 创建时间戳
  updated_at: number;            // 更新时间戳
}
```

### 5.2 Subtask（子任务）

```typescript
interface Subtask {
  id: string;                    // UUID
  step: number;                  // 步骤编号
  title: string;                 // 子任务标题
  description: string;           // 详细描述
  tool: string;                  // 使用的工具（web-engine/document-engine等）
  action: string;                // 具体操作（generate_html/create_document等）
  estimated_tokens: number;      // 预估token消耗
  dependencies: number[];        // 依赖的步骤编号
  output_files: string[];        // 输出文件列表
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: any;                  // 执行结果
  error?: string;                // 错误信息
  command?: string;              // 执行的bash命令（如果有）
  started_at?: number;
  completed_at?: number;
}
```

### 5.3 Progress（进度更新）

```typescript
interface Progress {
  type: 'task-started' | 'subtask-started' | 'subtask-completed' | 'subtask-failed' | 'task-completed' | 'task-failed';
  taskPlan: TaskPlan;
  subtask?: Subtask;
  result?: any;
  error?: string;
  step?: number;
  total?: number;
}
```

---

## 六、支持的工具和操作

### 6.1 Web引擎 (web-engine)

| Action | 说明 | 输出 |
|--------|------|------|
| generate_html | 生成HTML文件 | .html |
| generate_css | 生成CSS样式文件 | .css |
| generate_js | 生成JavaScript文件 | .js |
| create_web_project | 创建完整Web项目 | 项目文件夹 |

### 6.2 文档引擎 (document-engine)

| Action | 说明 | 输出 |
|--------|------|------|
| create_document | 创建Word文档 | .docx |
| create_markdown | 创建Markdown文档 | .md |
| export_pdf | 导出为PDF | .pdf |
| export_docx | 导出为Word | .docx |

### 6.3 数据引擎 (data-engine)

| Action | 说明 | 输出 |
|--------|------|------|
| read_excel | 读取Excel文件 | 数据对象 |
| analyze_data | 数据分析 | 分析报告 |
| create_chart | 创建图表 | .png/.svg |
| export_csv | 导出CSV | .csv |

### 6.4 PPT引擎 (ppt-engine)

| Action | 说明 | 输出 |
|--------|------|------|
| generate_presentation | 生成PPT | .pptx |

### 6.5 代码引擎 (code-engine)

| Action | 说明 | 输出 |
|--------|------|------|
| generate_code | 生成代码文件 | 各种代码文件 |
| create_project_structure | 创建项目结构 | 项目文件夹 |

---

## 七、数据库操作

### 7.1 查询任务计划

```javascript
// 获取单个任务计划
const taskPlan = await taskPlanner.getTaskPlan(taskPlanId);

// 获取项目的任务计划历史
const history = await taskPlanner.getTaskPlanHistory(projectId, limit);
```

### 7.2 更新任务状态

```javascript
// 系统会自动更新，也可以手动更新
await taskPlanner.updateTaskPlan(taskPlanId, {
  status: 'cancelled',
  error_message: '用户取消'
});
```

### 7.3 SQL查询示例

```sql
-- 获取项目的所有任务计划
SELECT * FROM project_task_plans
WHERE project_id = 'proj_12345'
ORDER BY created_at DESC;

-- 获取进行中的任务
SELECT * FROM project_task_plans
WHERE status = 'in_progress'
ORDER BY started_at DESC;

-- 统计任务完成情况
SELECT
  status,
  COUNT(*) as count
FROM project_task_plans
GROUP BY status;
```

---

## 八、错误处理

### 8.1 常见错误

| 错误类型 | 原因 | 解决方案 |
|---------|------|---------|
| LLM服务未初始化 | LLM管理器未启动 | 检查Ollama服务或API配置 |
| JSON解析失败 | LLM返回格式不正确 | 系统会自动降级使用简单任务 |
| 引擎加载失败 | 引擎文件不存在 | 检查引擎文件是否存在 |
| 依赖循环 | 任务依赖关系有误 | 系统会自动强制执行 |

### 8.2 降级策略

当LLM拆解失败时，系统会自动创建一个简单的单步任务：

```javascript
{
  task_title: '执行用户请求',
  subtasks: [{
    step: 1,
    title: '执行用户请求',
    description: userRequest,
    tool: '根据项目类型推断',
    action: 'execute'
  }]
}
```

---

## 九、性能优化建议

### 9.1 Token消耗优化

- 合理设置 `estimated_tokens`
- 使用较低的 `temperature` (0.2-0.3) 提高准确性
- 缓存常见的任务拆解结果

### 9.2 执行效率优化

- 尽量减少依赖关系，增加并行执行机会
- 对于大型任务，考虑分批执行
- 使用流式输出减少等待时间

---

## 十、下一步

✅ **已完成**: AI任务智能拆解系统后端实现
⏳ **进行中**: 实时任务执行监控组件（TaskExecutionMonitor.vue）
⏳ **待开发**: PPT生成引擎、文档多格式导出、项目分享功能

---

## 十一、参考资料

- **实施方案**: `docs/项目管理模块补完实施方案.md`
- **对比分析**: `docs/项目管理模块实现对比分析.md`
- **UI参考**: `参考资料/可看到当前执行的情况.png`
- **系统设计**: `系统设计_个人移动AI管理系统.md` (第2.4节)

---

**文档版本**: v1.0
**最后更新**: 2025-12-23
**作者**: Claude Code AI Assistant
