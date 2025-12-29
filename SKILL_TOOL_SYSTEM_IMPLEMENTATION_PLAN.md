# 技能管理和工具管理系统实现方案

## 一、概述

### 目标
为 ChainlessChain 桌面应用添加完善的技能(Skill)管理和工具(Tool)管理系统,参考 Claude Code 和 Manus 的设计理念,提升 AI 助手的智能化程度和可扩展性。

### 核心概念
- **工具(Tool)**: 底层可调用的功能单元,执行具体操作(如读文件、生成HTML、数据分析)
- **技能(Skill)**: 高层能力包,包含一组相关工具,代表某个领域的综合能力(如"代码开发"技能包含file_reader、file_writer、code_executor等工具)
- **技能数量**: 通常不超过20个
- **工具数量**: 可以很多,按需扩展

### 设计原则
1. **两层架构**: Skill -> Tools 的层级关系
2. **充分复用**: 集成现有的 FunctionCaller 和 PluginManager
3. **混合存储**: 核心元数据存数据库,详细文档存Markdown
4. **插件化**: 支持从插件市场安装、用户配置、开发者自定义
5. **可视化管理**: 提供直观的UI界面

---

## 二、架构设计

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────┐
│                    Renderer Process (Vue3)              │
│  ┌──────────────────┐  ┌──────────────────┐            │
│  │ SkillManagement  │  │  ToolManagement  │            │
│  │      .vue        │  │       .vue       │            │
│  └────────┬─────────┘  └────────┬─────────┘            │
│           │ IPC                  │ IPC                  │
└───────────┼──────────────────────┼──────────────────────┘
            │                      │
┌───────────┼──────────────────────┼──────────────────────┐
│           ▼         Main Process ▼                      │
│  ┌─────────────────────────────────────┐                │
│  │      SkillManager (NEW)             │                │
│  │  - registerSkill()                  │                │
│  │  - enableSkill() / disableSkill()   │                │
│  │  - getSkillsByCategory()            │                │
│  │  - getSkillStats()                  │                │
│  └──────────┬──────────────────────────┘                │
│             │ uses                                       │
│             ▼                                            │
│  ┌─────────────────────────────────────┐                │
│  │      ToolManager (NEW)              │                │
│  │  - registerTool()                   │                │
│  │  - unregisterTool()                 │                │
│  │  - getToolsBySkill()                │                │
│  │  - updateToolStats()                │                │
│  └──────────┬──────────────────────────┘                │
│             │ integrates with                           │
│             ▼                                            │
│  ┌─────────────────────────────────────┐                │
│  │   FunctionCaller (EXISTING)         │                │
│  │  - tools: Map<name, handler>        │                │
│  │  - registerTool(name, handler, ...)│                │
│  │  - call(toolName, params, context) │                │
│  └──────────┬──────────────────────────┘                │
│             │ called by                                 │
│             ▼                                            │
│  ┌─────────────────────────────────────┐                │
│  │   AIEngineManager (EXISTING)        │                │
│  │  - processUserInput()               │                │
│  │  - getAvailableTools()              │                │
│  └─────────────────────────────────────┘                │
│                                                          │
│  ┌─────────────────────────────────────┐                │
│  │   PluginManager (EXISTING)          │                │
│  │  - handleAIFunctionToolExtension()  │◀── 完善实现    │
│  │  - extensionPoints.get('ai.func..) │                │
│  └─────────────────────────────────────┘                │
│                                                          │
│  ┌─────────────────────────────────────┐                │
│  │   DatabaseManager (EXISTING)        │                │
│  │  + skills 表                        │◀── 新增表      │
│  │  + tools 表                         │                │
│  │  + skill_tools 表                   │                │
│  │  + skill_stats 表                   │                │
│  │  + tool_stats 表                    │                │
│  └─────────────────────────────────────┘                │
└──────────────────────────────────────────────────────────┘

文件系统:
{userData}/
├── docs/
│   ├── skills/                    # 技能文档目录
│   │   ├── code-development.md   # 代码开发技能
│   │   ├── data-analysis.md      # 数据分析技能
│   │   └── ...
│   └── tools/                     # 工具文档目录
│       ├── file_reader.md
│       ├── file_writer.md
│       └── ...
└── data/
    └── chainlesschain.db          # 数据库
```

### 2.2 核心组件职责

#### **SkillManager** (新建)
- 技能的CRUD操作
- 技能启用/禁用状态管理
- 技能分类管理
- 技能使用统计
- 技能与工具的映射关系维护

#### **ToolManager** (新建)
- 工具的CRUD操作
- 工具注册到FunctionCaller
- 工具参数schema管理
- 工具使用统计
- 工具文档管理

#### **SkillExecutor** (新建,可选)
- 执行技能时的工具链编排
- 技能级别的上下文管理
- 多工具协同执行

---

## 三、数据模型设计

### 3.1 数据库表设计

```sql
-- ===========================
-- 1. 技能表
-- ===========================
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,                  -- 技能ID,如 'skill_code_dev'
  name TEXT NOT NULL,                   -- 技能名称,如 '代码开发'
  display_name TEXT,                    -- 显示名称(支持多语言)
  description TEXT,                     -- 简短描述
  category TEXT NOT NULL,               -- 分类:code/data/content/web/automation/system
  icon TEXT,                            -- 图标路径或名称
  enabled INTEGER DEFAULT 1,            -- 是否启用 (0/1)

  -- 来源标识
  is_builtin INTEGER DEFAULT 0,         -- 是否内置 (0/1)
  plugin_id TEXT,                       -- 如果来自插件,记录插件ID

  -- 配置和元数据
  config TEXT,                          -- JSON配置,如默认参数、行为选项
  tags TEXT,                            -- JSON数组,如 ["AI", "编程"]
  doc_path TEXT,                        -- Markdown文档路径

  -- 统计字段
  usage_count INTEGER DEFAULT 0,        -- 使用次数
  success_count INTEGER DEFAULT 0,      -- 成功次数
  last_used_at INTEGER,                 -- 最后使用时间

  -- 时间戳
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  -- 外键
  FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
);

CREATE INDEX idx_skills_category ON skills(category);
CREATE INDEX idx_skills_enabled ON skills(enabled);
CREATE INDEX idx_skills_plugin ON skills(plugin_id);

-- ===========================
-- 2. 工具表
-- ===========================
CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY,                  -- 工具ID,如 'tool_file_reader'
  name TEXT NOT NULL UNIQUE,            -- 工具名称(FunctionCaller中的key)
  display_name TEXT,                    -- 显示名称
  description TEXT,                     -- 简短描述

  -- 工具类型和分类
  tool_type TEXT DEFAULT 'function',    -- function/api/command/script
  category TEXT,                        -- file/code/data/network/system/ai

  -- 参数schema
  parameters_schema TEXT,               -- JSON Schema,定义参数结构
  return_schema TEXT,                   -- 返回值schema

  -- 来源和实现
  is_builtin INTEGER DEFAULT 0,         -- 是否内置
  plugin_id TEXT,                       -- 来自哪个插件
  handler_path TEXT,                    -- 处理函数路径(用于动态加载)

  -- 状态
  enabled INTEGER DEFAULT 1,            -- 是否启用
  deprecated INTEGER DEFAULT 0,         -- 是否已废弃

  -- 配置和文档
  config TEXT,                          -- JSON配置
  examples TEXT,                        -- JSON数组,使用示例
  doc_path TEXT,                        -- Markdown文档路径

  -- 权限和安全
  required_permissions TEXT,            -- JSON数组,如 ["file:read", "network:http"]
  risk_level INTEGER DEFAULT 1,         -- 风险等级 1-5

  -- 统计
  usage_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  avg_execution_time REAL DEFAULT 0,    -- 平均执行时间(ms)
  last_used_at INTEGER,

  -- 时间戳
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
);

CREATE INDEX idx_tools_category ON tools(category);
CREATE INDEX idx_tools_enabled ON tools(enabled);
CREATE INDEX idx_tools_plugin ON tools(plugin_id);

-- ===========================
-- 3. 技能-工具关联表
-- ===========================
CREATE TABLE IF NOT EXISTS skill_tools (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,

  -- 工具在技能中的角色
  role TEXT DEFAULT 'primary',          -- primary/secondary/optional
  priority INTEGER DEFAULT 0,           -- 优先级,数字越大越优先

  -- 工具在技能中的配置覆盖
  config_override TEXT,                 -- JSON,覆盖工具的默认配置

  created_at INTEGER NOT NULL,

  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
  FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE,
  UNIQUE (skill_id, tool_id)
);

CREATE INDEX idx_skill_tools_skill ON skill_tools(skill_id);
CREATE INDEX idx_skill_tools_tool ON skill_tools(tool_id);

-- ===========================
-- 4. 技能使用统计表
-- ===========================
CREATE TABLE IF NOT EXISTS skill_stats (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,

  -- 统计时间范围
  stat_date TEXT NOT NULL,              -- 日期,如 '2024-01-01'

  -- 统计指标
  invoke_count INTEGER DEFAULT 0,       -- 调用次数
  success_count INTEGER DEFAULT 0,      -- 成功次数
  failure_count INTEGER DEFAULT 0,      -- 失败次数
  avg_duration REAL DEFAULT 0,          -- 平均执行时长(秒)
  total_duration REAL DEFAULT 0,        -- 总执行时长(秒)

  -- 用户反馈
  positive_feedback INTEGER DEFAULT 0,  -- 正面反馈次数
  negative_feedback INTEGER DEFAULT 0,  -- 负面反馈次数

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
  UNIQUE (skill_id, stat_date)
);

CREATE INDEX idx_skill_stats_skill ON skill_stats(skill_id);
CREATE INDEX idx_skill_stats_date ON skill_stats(stat_date);

-- ===========================
-- 5. 工具使用统计表
-- ===========================
CREATE TABLE IF NOT EXISTS tool_stats (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL,

  stat_date TEXT NOT NULL,

  invoke_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  avg_duration REAL DEFAULT 0,
  total_duration REAL DEFAULT 0,

  -- 错误统计
  error_types TEXT,                     -- JSON对象,记录各类错误次数

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE,
  UNIQUE (tool_id, stat_date)
);

CREATE INDEX idx_tool_stats_tool ON tool_stats(tool_id);
CREATE INDEX idx_tool_stats_date ON tool_stats(stat_date);

-- ===========================
-- 6. 技能/工具使用记录表(可选,用于详细审计)
-- ===========================
CREATE TABLE IF NOT EXISTS skill_tool_usage_logs (
  id TEXT PRIMARY KEY,
  skill_id TEXT,
  tool_id TEXT,

  -- 执行信息
  session_id TEXT,                      -- 会话ID
  input_params TEXT,                    -- JSON,输入参数
  output_result TEXT,                   -- JSON,输出结果
  status TEXT,                          -- success/failure/timeout
  error_message TEXT,
  execution_time REAL,                  -- 执行时长(ms)

  -- 上下文
  project_id TEXT,
  user_input TEXT,                      -- 用户原始输入

  created_at INTEGER NOT NULL,

  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE SET NULL,
  FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE SET NULL
);

CREATE INDEX idx_usage_logs_skill ON skill_tool_usage_logs(skill_id);
CREATE INDEX idx_usage_logs_tool ON skill_tool_usage_logs(tool_id);
CREATE INDEX idx_usage_logs_session ON skill_tool_usage_logs(session_id);
```

### 3.2 字段设计说明

**关键字段解释**:
- `is_builtin`: 区分内置和插件提供的技能/工具
- `plugin_id`: 追溯来源,插件卸载时级联删除
- `config`: 灵活的JSON配置,支持各种自定义参数
- `doc_path`: 指向Markdown文档的相对路径
- `parameters_schema`: JSON Schema格式,便于UI自动生成表单
- `required_permissions`: 与PluginManager的权限系统集成
- `risk_level`: 用于安全提示和权限检查

---

## 四、文件系统结构

### 4.1 代码文件组织

```
desktop-app-vue/src/main/
├── skill-tool-system/              # 新增目录:技能工具系统
│   ├── skill-manager.js            # SkillManager类
│   ├── tool-manager.js             # ToolManager类
│   ├── skill-executor.js           # SkillExecutor类(可选)
│   ├── skill-tool-ipc.js           # IPC处理器
│   ├── builtin-skills.js           # 内置技能定义
│   ├── builtin-tools.js            # 内置工具定义
│   └── doc-generator.js            # Markdown文档生成器
│
├── ai-engine/
│   ├── ai-engine-manager.js        # 已有:集成SkillManager
│   └── function-caller.js          # 已有:被ToolManager调用
│
├── plugins/
│   └── plugin-manager.js           # 已有:完善handleAIFunctionToolExtension
│
└── index.js                        # 已有:注册IPC handlers
```

### 4.2 Markdown文档组织

```
{userData}/
└── docs/
    ├── skills/                     # 技能文档目录
    │   ├── code-development.md     # 代码开发技能
    │   ├── data-analysis.md        # 数据分析技能
    │   ├── content-creation.md     # 内容创作技能
    │   ├── web-development.md      # Web开发技能
    │   ├── system-automation.md    # 系统自动化技能
    │   └── ...                     # 其他技能
    │
    └── tools/                      # 工具文档目录
        ├── file_reader.md
        ├── file_writer.md
        ├── html_generator.md
        ├── data_analyzer.md
        └── ...

文档模板格式(skill示例):
---
id: skill_code_dev
name: 代码开发
category: code
---

# 代码开发技能

## 概述
提供完整的代码开发能力,包括文件读写、代码生成、执行和调试。

## 包含的工具
- file_reader: 读取源代码文件
- file_writer: 写入代码文件
- code_generator: 生成代码片段
- code_executor: 执行代码并返回结果

## 使用场景
1. 创建新项目
2. 修改现有代码
3. 代码重构

## 配置选项
```json
{
  "defaultLanguage": "javascript",
  "autoFormat": true,
  "enableLinting": true
}
```

## 示例
...
```

### 4.3 前端页面组织

```
desktop-app-vue/src/renderer/
├── pages/
│   └── settings/
│       ├── SkillManagement.vue     # 新增:技能管理页面
│       └── ToolManagement.vue      # 新增:工具管理页面
│
├── components/
│   ├── skill/                      # 新增:技能相关组件
│   │   ├── SkillCard.vue          # 技能卡片
│   │   ├── SkillEditor.vue        # 技能编辑器
│   │   ├── SkillStats.vue         # 技能统计图表
│   │   └── SkillDependencyGraph.vue # 依赖关系图
│   │
│   └── tool/                       # 新增:工具相关组件
│       ├── ToolCard.vue
│       ├── ToolEditor.vue
│       ├── ToolParamEditor.vue    # 参数schema编辑器
│       └── ToolStats.vue
│
└── stores/
    ├── skill.js                    # 新增:Pinia store for skills
    └── tool.js                     # 新增:Pinia store for tools
```

---

## 五、核心类设计

### 5.1 SkillManager

**文件路径**: `desktop-app-vue/src/main/skill-tool-system/skill-manager.js`

```javascript
class SkillManager {
  constructor(database, toolManager) {
    this.db = database;
    this.toolManager = toolManager;
    this.skills = new Map(); // skillId -> skillObject
    this.isInitialized = false;
  }

  // 初始化
  async initialize() {
    await this.createTables();
    await this.loadBuiltInSkills();
    await this.loadPluginSkills();
    this.isInitialized = true;
  }

  // CRUD操作
  async registerSkill(skillData) { /* ... */ }
  async unregisterSkill(skillId) { /* ... */ }
  async updateSkill(skillId, updates) { /* ... */ }
  async getSkill(skillId) { /* ... */ }

  // 查询
  async getAllSkills(options = {}) { /* ... */ }
  async getSkillsByCategory(category) { /* ... */ }
  async getEnabledSkills() { /* ... */ }

  // 状态管理
  async enableSkill(skillId) { /* ... */ }
  async disableSkill(skillId) { /* ... */ }

  // 工具关联
  async addToolToSkill(skillId, toolId, role = 'primary') { /* ... */ }
  async removeToolFromSkill(skillId, toolId) { /* ... */ }
  async getSkillTools(skillId) { /* ... */ }

  // 统计
  async recordSkillUsage(skillId, success, duration) { /* ... */ }
  async getSkillStats(skillId, dateRange) { /* ... */ }

  // 文档管理
  async generateSkillDoc(skillId) { /* ... */ }
  async getSkillDoc(skillId) { /* ... */ }

  // 内置技能加载
  async loadBuiltInSkills() { /* ... */ }
}
```

### 5.2 ToolManager

**文件路径**: `desktop-app-vue/src/main/skill-tool-system/tool-manager.js`

```javascript
class ToolManager {
  constructor(database, functionCaller) {
    this.db = database;
    this.functionCaller = functionCaller;
    this.tools = new Map(); // toolId -> toolMeta
    this.isInitialized = false;
  }

  async initialize() {
    await this.createTables();
    await this.loadBuiltInTools();
    await this.loadPluginTools();
    this.isInitialized = true;
  }

  // CRUD操作
  async registerTool(toolData, handler) {
    // 1. 验证参数schema
    // 2. 保存到数据库
    // 3. 注册到FunctionCaller
    // 4. 生成文档
  }

  async unregisterTool(toolId) {
    // 1. 从FunctionCaller注销
    // 2. 从数据库删除
    // 3. 删除文档
  }

  async updateTool(toolId, updates) { /* ... */ }
  async getTool(toolId) { /* ... */ }

  // 查询
  async getAllTools(options = {}) { /* ... */ }
  async getToolsByCategory(category) { /* ... */ }
  async getToolsBySkill(skillId) { /* ... */ }
  async getEnabledTools() { /* ... */ }

  // 状态管理
  async enableTool(toolId) {
    // 同时启用FunctionCaller中的工具
  }
  async disableTool(toolId) {
    // 同时禁用FunctionCaller中的工具
  }

  // 统计
  async recordToolUsage(toolId, success, duration, errorType) { /* ... */ }
  async getToolStats(toolId, dateRange) { /* ... */ }

  // Schema验证
  validateParametersSchema(schema) { /* ... */ }

  // 文档管理
  async generateToolDoc(toolId) { /* ... */ }
  async getToolDoc(toolId) { /* ... */ }

  // 内置工具加载
  async loadBuiltInTools() {
    // 将FunctionCaller中现有的15个工具注册到数据库
  }
}
```

### 5.3 与现有系统的集成

#### 集成点1: FunctionCaller (已有)

**文件**: `desktop-app-vue/src/main/ai-engine/function-caller.js`

**修改**:
- 添加 `setToolManager(toolManager)` 方法
- 在 `call()` 方法中记录统计信息
- 支持动态启用/禁用工具

```javascript
// 在 FunctionCaller 类中添加
setToolManager(toolManager) {
  this.toolManager = toolManager;
}

async call(toolName, params = {}, context = {}) {
  const startTime = Date.now();
  const tool = this.tools.get(toolName);

  if (!tool) {
    throw new Error(`工具 "${toolName}" 不存在`);
  }

  try {
    const result = await tool.handler(params, context);

    // 记录统计
    if (this.toolManager) {
      const duration = Date.now() - startTime;
      await this.toolManager.recordToolUsage(toolName, true, duration);
    }

    return result;
  } catch (error) {
    // 记录失败统计
    if (this.toolManager) {
      const duration = Date.now() - startTime;
      await this.toolManager.recordToolUsage(toolName, false, duration, error.name);
    }
    throw error;
  }
}
```

#### 集成点2: PluginManager (已有)

**文件**: `desktop-app-vue/src/main/plugins/plugin-manager.js`

**修改Line 522**: 完善 `handleAIFunctionToolExtension` 方法

```javascript
async handleAIFunctionToolExtension(context) {
  console.log('[PluginManager] 处理AI Function工具扩展:', context);

  const { pluginId, config } = context;
  const { tools = [], skills = [] } = config;

  // 1. 注册插件提供的工具
  for (const toolDef of tools) {
    await this.systemContext.toolManager.registerTool({
      id: `${pluginId}_${toolDef.name}`,
      name: toolDef.name,
      description: toolDef.description,
      parameters_schema: JSON.stringify(toolDef.parameters),
      plugin_id: pluginId,
      is_builtin: 0,
      enabled: 1,
      // ...
    }, toolDef.handler);
  }

  // 2. 注册插件提供的技能
  for (const skillDef of skills) {
    await this.systemContext.skillManager.registerSkill({
      id: `${pluginId}_${skillDef.id}`,
      name: skillDef.name,
      description: skillDef.description,
      category: skillDef.category,
      plugin_id: pluginId,
      is_builtin: 0,
      enabled: 1,
    });

    // 关联技能和工具
    for (const toolName of skillDef.tools || []) {
      await this.systemContext.skillManager.addToolToSkill(
        `${pluginId}_${skillDef.id}`,
        `${pluginId}_${toolName}`
      );
    }
  }

  console.log('[PluginManager] AI工具扩展处理完成');
}
```

#### 集成点3: AIEngineManager (已有)

**文件**: `desktop-app-vue/src/main/ai-engine/ai-engine-manager.js`

**修改**:
- 添加 `setSkillManager(skillManager)` 方法
- 在 `processUserInput()` 中根据意图选择合适的技能

```javascript
async processUserInput(userInput, context = {}, onStepUpdate = null) {
  // ... 现有代码 ...

  // 意图识别后,选择合适的技能
  const intent = await this.intentClassifier.classify(userInput);

  if (this.skillManager) {
    const suggestedSkills = await this.skillManager.getSuggestedSkills(intent);
    console.log('[AIEngine] 建议使用的技能:', suggestedSkills);

    // 可以将技能信息传递给任务规划器
    context.suggestedSkills = suggestedSkills;
  }

  // ... 继续任务规划和执行 ...
}
```

---

## 六、内置技能和工具规划

### 6.1 内置技能分类(共15个)

基于现有的15个内置工具和15+个引擎,规划以下技能:

#### 1. **代码开发** (code-development)
- **分类**: code
- **工具**: file_reader, file_writer, file_editor, create_project_structure, git_init, git_commit
- **适用场景**: 创建项目、修改代码、版本控制

#### 2. **Web开发** (web-development)
- **分类**: web
- **工具**: html_generator, css_generator, js_generator, file_writer
- **引擎**: WebEngine
- **适用场景**: 创建网页、博客、单页应用

#### 3. **数据分析** (data-analysis)
- **分类**: data
- **工具**: file_reader, data_analyzer (新增), chart_generator (新增)
- **引擎**: DataEngine, DataVizEngine
- **适用场景**: 读取CSV/Excel、数据清洗、可视化

#### 4. **内容创作** (content-creation)
- **分类**: content
- **工具**: markdown_editor (新增), format_output
- **引擎**: DocumentEngine
- **适用场景**: 写文章、文档编辑

#### 5. **文档处理** (document-processing)
- **分类**: document
- **工具**: file_reader, file_writer
- **引擎**: WordEngine, PDFEngine, ExcelEngine, PPTEngine
- **适用场景**: Word/PDF/Excel/PPT生成和编辑

#### 6. **图像处理** (image-processing)
- **分类**: media
- **工具**: image_resize (新增), image_convert (新增)
- **引擎**: ImageEngine
- **适用场景**: 图片压缩、格式转换、OCR

#### 7. **视频处理** (video-processing)
- **分类**: media
- **工具**: video_clip (新增), video_merge (新增)
- **引擎**: VideoEngine

#### 8. **代码执行** (code-execution)
- **分类**: code
- **工具**: python_executor (新增), bash_executor (新增)
- **引擎**: CodeExecutor

#### 9. **项目管理** (project-management)
- **分类**: project
- **工具**: create_project_structure, git_init, git_commit, info_searcher

#### 10. **知识库搜索** (knowledge-search)
- **分类**: ai
- **工具**: knowledge_base_query (新增), rag_search (新增)
- **RAG集成**: RAGManager

#### 11. **模板应用** (template-application)
- **分类**: template
- **工具**: template_fill (新增), project_from_template (新增)
- **引擎**: TemplateEngine

#### 12. **系统操作** (system-operations)
- **分类**: system
- **工具**: file_reader, file_writer, generic_handler

#### 13. **网络请求** (network-requests)
- **分类**: network
- **工具**: http_get (新增), http_post (新增), web_scrape (新增)

#### 14. **AI对话** (ai-conversation)
- **分类**: ai
- **工具**: llm_query (新增), prompt_template_fill (新增)
- **LLM集成**: LLMManager

#### 15. **自动化工作流** (automation-workflow)
- **分类**: automation
- **工具**: task_chain (新增), conditional_execute (新增)
- **引擎**: TaskExecutor

### 6.2 需要新增的工具

除了现有的15个内置工具,还需新增以下工具:

1. `data_analyzer` - 数据分析
2. `chart_generator` - 图表生成
3. `markdown_editor` - Markdown编辑
4. `image_resize` - 图片缩放
5. `image_convert` - 图片格式转换
6. `video_clip` - 视频剪辑
7. `video_merge` - 视频合并
8. `python_executor` - Python代码执行
9. `bash_executor` - Bash命令执行
10. `knowledge_base_query` - 知识库查询
11. `rag_search` - RAG语义搜索
12. `template_fill` - 模板填充
13. `project_from_template` - 从模板创建项目
14. `http_get` / `http_post` - HTTP请求
15. `web_scrape` - 网页抓取
16. `llm_query` - LLM查询
17. `prompt_template_fill` - Prompt模板填充
18. `task_chain` - 任务链执行
19. `conditional_execute` - 条件执行

**注**: 部分工具可能已在引擎中实现,需要将其封装为标准工具。

---

## 七、IPC接口设计

### 7.1 技能管理IPC

**文件**: `desktop-app-vue/src/main/skill-tool-system/skill-tool-ipc.js`

```javascript
// 技能相关
ipcMain.handle('skill:get-all', async (event, options) => {})
ipcMain.handle('skill:get-by-id', async (event, skillId) => {})
ipcMain.handle('skill:get-by-category', async (event, category) => {})
ipcMain.handle('skill:enable', async (event, skillId) => {})
ipcMain.handle('skill:disable', async (event, skillId) => {})
ipcMain.handle('skill:update-config', async (event, skillId, config) => {})
ipcMain.handle('skill:get-stats', async (event, skillId, dateRange) => {})
ipcMain.handle('skill:get-tools', async (event, skillId) => {})
ipcMain.handle('skill:add-tool', async (event, skillId, toolId, role) => {})
ipcMain.handle('skill:remove-tool', async (event, skillId, toolId) => {})
ipcMain.handle('skill:get-doc', async (event, skillId) => {})

// 工具相关
ipcMain.handle('tool:get-all', async (event, options) => {})
ipcMain.handle('tool:get-by-id', async (event, toolId) => {})
ipcMain.handle('tool:get-by-category', async (event, category) => {})
ipcMain.handle('tool:get-by-skill', async (event, skillId) => {})
ipcMain.handle('tool:enable', async (event, toolId) => {})
ipcMain.handle('tool:disable', async (event, toolId) => {})
ipcMain.handle('tool:update-config', async (event, toolId, config) => {})
ipcMain.handle('tool:update-schema', async (event, toolId, schema) => {})
ipcMain.handle('tool:get-stats', async (event, toolId, dateRange) => {})
ipcMain.handle('tool:get-doc', async (event, toolId) => {})
ipcMain.handle('tool:test', async (event, toolId, params) => {})

// 依赖关系
ipcMain.handle('skill-tool:get-dependency-graph', async (event) => {})
ipcMain.handle('skill-tool:get-usage-analytics', async (event, dateRange) => {})
```

### 7.2 在 main/index.js 中注册

```javascript
// 导入
const { SkillManager } = require('./skill-tool-system/skill-manager');
const { ToolManager } = require('./skill-tool-system/tool-manager');
const { registerSkillToolIPC } = require('./skill-tool-system/skill-tool-ipc');

// 初始化
const toolManager = new ToolManager(database, functionCaller);
const skillManager = new SkillManager(database, toolManager);

await toolManager.initialize();
await skillManager.initialize();

// 设置依赖
functionCaller.setToolManager(toolManager);
aiEngineManager.setSkillManager(skillManager);

// 更新插件系统上下文
pluginManager.setSystemContext({
  // ... 现有上下文 ...
  skillManager,
  toolManager,
});

// 注册IPC
registerSkillToolIPC(ipcMain, skillManager, toolManager);
```

---

## 八、UI设计

### 8.1 技能管理页面 (SkillManagement.vue)

**路由**: `/settings/skills`

**功能模块**:
1. **技能列表**
   - 卡片式展示,支持分类筛选
   - 显示技能名称、描述、图标、启用状态
   - 显示包含的工具数量
   - 显示使用次数和成功率

2. **技能详情/编辑**
   - 基本信息编辑(名称、描述、分类、图标)
   - 配置编辑器(JSON编辑器)
   - 包含工具列表(可添加/移除)
   - 使用统计图表(柱状图、折线图)

3. **技能创建**
   - 表单:名称、描述、分类、图标
   - 工具选择器(多选)
   - 配置模板

4. **批量操作**
   - 批量启用/禁用
   - 批量导出/导入

**组件结构**:
```vue
<template>
  <div class="skill-management">
    <!-- 顶部工具栏 -->
    <div class="toolbar">
      <a-input-search placeholder="搜索技能..." />
      <a-select v-model:value="categoryFilter" placeholder="分类筛选">
        <a-select-option value="all">全部</a-select-option>
        <a-select-option value="code">代码</a-select-option>
        <a-select-option value="data">数据</a-select-option>
        <!-- ... -->
      </a-select>
      <a-button type="primary" @click="showCreateModal">创建技能</a-button>
    </div>

    <!-- 技能列表 -->
    <div class="skill-grid">
      <SkillCard
        v-for="skill in filteredSkills"
        :key="skill.id"
        :skill="skill"
        @edit="editSkill"
        @toggle="toggleSkill"
        @delete="deleteSkill"
      />
    </div>

    <!-- 创建/编辑模态框 -->
    <SkillEditor
      v-model:visible="editorVisible"
      :skill="currentSkill"
      @save="saveSkill"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useSkillStore } from '@/stores/skill';

const skillStore = useSkillStore();
const categoryFilter = ref('all');
const editorVisible = ref(false);
const currentSkill = ref(null);

const filteredSkills = computed(() => {
  return skillStore.filterByCategory(categoryFilter.value);
});

onMounted(async () => {
  await skillStore.fetchAll();
});

// ... 方法 ...
</script>
```

### 8.2 工具管理页面 (ToolManagement.vue)

**路由**: `/settings/tools`

**功能模块**:
1. **工具列表**
   - 表格式展示(名称、类别、状态、使用次数、成功率)
   - 支持搜索和筛选(分类、状态、来源)
   - 支持排序(按使用次数、成功率、最后使用时间)

2. **工具详情/编辑**
   - 基本信息
   - 参数Schema编辑器(可视化+JSON双模式)
   - 示例代码
   - 使用统计
   - 测试工具(输入参数,查看输出)

3. **工具创建**
   - 表单:名称、描述、分类、类型
   - Schema编辑器
   - 示例添加

4. **依赖关系可视化**
   - 展示哪些技能使用了该工具
   - 展示工具间的调用关系(如果存在)

**组件结构**:
```vue
<template>
  <div class="tool-management">
    <div class="toolbar">
      <a-input-search placeholder="搜索工具..." />
      <a-select v-model:value="categoryFilter">
        <a-select-option value="all">全部分类</a-select-option>
        <a-select-option value="file">文件</a-select-option>
        <a-select-option value="code">代码</a-select-option>
        <!-- ... -->
      </a-select>
      <a-button type="primary" @click="showCreateModal">创建工具</a-button>
    </div>

    <a-table
      :columns="columns"
      :dataSource="filteredTools"
      :row-key="record => record.id"
      @row-click="showToolDetail"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'enabled'">
          <a-switch
            v-model:checked="record.enabled"
            @change="toggleTool(record.id)"
          />
        </template>
        <template v-if="column.key === 'actions'">
          <a-button size="small" @click="editTool(record)">编辑</a-button>
          <a-button size="small" @click="testTool(record)">测试</a-button>
        </template>
      </template>
    </a-table>

    <!-- 详情/编辑抽屉 -->
    <ToolEditor
      v-model:visible="editorVisible"
      :tool="currentTool"
      @save="saveTool"
    />
  </div>
</template>
```

### 8.3 统计可视化组件

**SkillStats.vue / ToolStats.vue**:
- 使用 ECharts 或 Chart.js
- 显示使用趋势(折线图)
- 显示成功率(饼图)
- 显示调用次数排行(柱状图)

**SkillDependencyGraph.vue**:
- 使用 G6 或 D3.js
- 展示技能-工具的关系图
- 支持交互(点击节点查看详情)

---

## 九、插件扩展实现

### 9.1 插件Manifest扩展

**plugin.json 示例**:
```json
{
  "id": "com.example.my-plugin",
  "name": "My Awesome Plugin",
  "version": "1.0.0",
  "main": "index.js",
  "permissions": ["database:read", "file:write", "llm:query"],

  "extensionPoints": [
    {
      "point": "ai.function-tool",
      "config": {
        "tools": [
          {
            "name": "my_custom_tool",
            "description": "我的自定义工具",
            "parameters": {
              "input": { "type": "string", "description": "输入参数" }
            },
            "handler": "myCustomToolHandler",
            "category": "custom",
            "riskLevel": 2
          }
        ],
        "skills": [
          {
            "id": "my_custom_skill",
            "name": "我的自定义技能",
            "description": "提供自定义功能",
            "category": "custom",
            "tools": ["my_custom_tool"],
            "icon": "assets/icon.png"
          }
        ]
      }
    }
  ]
}
```

### 9.2 插件代码示例

**index.js**:
```javascript
class MyPlugin {
  constructor(api) {
    this.api = api;
  }

  onEnable() {
    console.log('[MyPlugin] 插件已启用');
  }

  // 工具处理函数
  async myCustomToolHandler(params, context) {
    const { input } = params;

    // 使用插件API
    const llmResult = await this.api.llm.query(`处理: ${input}`);

    return {
      success: true,
      result: llmResult,
    };
  }

  onDisable() {
    console.log('[MyPlugin] 插件已禁用');
  }
}

module.exports = MyPlugin;
```

### 9.3 插件加载流程

1. 用户在插件管理页面安装插件
2. PluginManager 解析 manifest.json
3. 发现 `ai.function-tool` 扩展点
4. 调用 `handleAIFunctionToolExtension()`
5. ToolManager 注册工具(handler绑定到插件实例方法)
6. SkillManager 注册技能
7. 建立 skill-tool 关联关系
8. 生成文档
9. 更新UI

---

## 十、实现步骤

### Phase 1: 基础架构(优先级:高)

**目标**: 建立核心数据模型和管理器

1. **数据库表创建** (1天)
   - [ ] 编写数据库迁移脚本 `desktop-app-vue/src/main/database/migrations/002_skill_tool_system.sql`
   - [ ] 在 DatabaseManager 中执行迁移
   - [ ] 编写测试用例验证表结构

2. **ToolManager 实现** (2天)
   - [ ] 创建 `desktop-app-vue/src/main/skill-tool-system/tool-manager.js`
   - [ ] 实现 CRUD 方法
   - [ ] 实现与 FunctionCaller 的集成
   - [ ] 实现内置工具加载(将现有15个工具注册到数据库)
   - [ ] 编写单元测试

3. **SkillManager 实现** (2天)
   - [ ] 创建 `desktop-app-vue/src/main/skill-tool-system/skill-manager.js`
   - [ ] 实现 CRUD 方法
   - [ ] 实现 skill-tool 关联管理
   - [ ] 实现内置技能定义和加载
   - [ ] 编写单元测试

4. **IPC接口** (1天)
   - [ ] 创建 `desktop-app-vue/src/main/skill-tool-system/skill-tool-ipc.js`
   - [ ] 实现所有 skill 和 tool 相关的 IPC handlers
   - [ ] 在 main/index.js 中注册

5. **集成测试** (1天)
   - [ ] 测试 ToolManager 与 FunctionCaller 的集成
   - [ ] 测试 SkillManager 与 ToolManager 的协作
   - [ ] 测试 IPC 通信

**预计时间**: 7天

---

### Phase 2: 文档系统(优先级:中)

**目标**: 实现 Markdown 文档生成和管理

1. **文档生成器** (2天)
   - [ ] 创建 `desktop-app-vue/src/main/skill-tool-system/doc-generator.js`
   - [ ] 实现技能文档模板
   - [ ] 实现工具文档模板
   - [ ] 实现文档自动生成逻辑
   - [ ] 创建文档目录结构

2. **文档存储** (1天)
   - [ ] 为所有内置技能生成文档
   - [ ] 为所有内置工具生成文档
   - [ ] 实现文档的读取和更新

3. **文档查看器** (1天)
   - [ ] 在前端实现 Markdown 渲染组件
   - [ ] 支持文档内链接跳转
   - [ ] 支持代码高亮

**预计时间**: 4天

---

### Phase 3: 前端UI(优先级:高)

**目标**: 实现管理界面

1. **Pinia Stores** (1天)
   - [ ] 创建 `desktop-app-vue/src/renderer/stores/skill.js`
   - [ ] 创建 `desktop-app-vue/src/renderer/stores/tool.js`
   - [ ] 实现状态管理和 IPC 调用

2. **技能管理页面** (3天)
   - [ ] 创建 `desktop-app-vue/src/renderer/pages/settings/SkillManagement.vue`
   - [ ] 创建 `desktop-app-vue/src/renderer/components/skill/SkillCard.vue`
   - [ ] 创建 `desktop-app-vue/src/renderer/components/skill/SkillEditor.vue`
   - [ ] 实现技能列表、搜索、筛选
   - [ ] 实现技能创建、编辑、删除
   - [ ] 实现技能启用/禁用

3. **工具管理页面** (3天)
   - [ ] 创建 `desktop-app-vue/src/renderer/pages/settings/ToolManagement.vue`
   - [ ] 创建 `desktop-app-vue/src/renderer/components/tool/ToolCard.vue`
   - [ ] 创建 `desktop-app-vue/src/renderer/components/tool/ToolEditor.vue`
   - [ ] 创建 `desktop-app-vue/src/renderer/components/tool/ToolParamEditor.vue`
   - [ ] 实现工具列表、搜索、筛选
   - [ ] 实现工具创建、编辑、删除
   - [ ] 实现参数 Schema 编辑器

4. **统计可视化** (2天)
   - [ ] 创建 `desktop-app-vue/src/renderer/components/skill/SkillStats.vue`
   - [ ] 创建 `desktop-app-vue/src/renderer/components/tool/ToolStats.vue`
   - [ ] 集成 ECharts
   - [ ] 实现使用趋势图、成功率图

5. **依赖关系图** (2天)
   - [ ] 创建 `desktop-app-vue/src/renderer/components/skill/SkillDependencyGraph.vue`
   - [ ] 集成 G6 或 D3.js
   - [ ] 实现技能-工具关系可视化
   - [ ] 实现交互功能

6. **路由和导航** (1天)
   - [ ] 在路由中添加 `/settings/skills` 和 `/settings/tools`
   - [ ] 在设置页面侧边栏添加入口

**预计时间**: 12天

---

### Phase 4: 插件扩展(优先级:中)

**目标**: 支持插件提供技能和工具

1. **PluginManager 完善** (2天)
   - [ ] 修改 `desktop-app-vue/src/main/plugins/plugin-manager.js`
   - [ ] 完善 `handleAIFunctionToolExtension()` 方法(Line 522)
   - [ ] 实现插件工具注册逻辑
   - [ ] 实现插件技能注册逻辑
   - [ ] 实现插件卸载时的清理逻辑

2. **插件API扩展** (1天)
   - [ ] 在 `desktop-app-vue/src/main/plugins/plugin-api.js` 中添加工具注册API
   - [ ] 添加技能注册API
   - [ ] 更新文档

3. **测试插件** (1天)
   - [ ] 创建测试插件示例
   - [ ] 测试插件工具注册
   - [ ] 测试插件技能注册
   - [ ] 测试插件启用/禁用

**预计时间**: 4天

---

### Phase 5: 高级功能(优先级:低)

**目标**: 实现高级特性

1. **统计系统优化** (2天)
   - [ ] 实现定时任务,每日汇总统计数据
   - [ ] 实现统计数据清理策略(保留最近90天)
   - [ ] 优化统计查询性能

2. **工具测试功能** (2天)
   - [ ] 实现工具测试界面
   - [ ] 支持参数输入和结果展示
   - [ ] 支持测试历史记录

3. **技能推荐** (2天)
   - [ ] 基于用户意图推荐合适的技能
   - [ ] 基于使用频率排序
   - [ ] 实现技能搜索优化

4. **配置导入导出** (1天)
   - [ ] 支持技能配置导出为JSON
   - [ ] 支持从JSON导入技能配置
   - [ ] 支持批量操作

5. **SkillExecutor(可选)** (3天)
   - [ ] 创建 `desktop-app-vue/src/main/skill-tool-system/skill-executor.js`
   - [ ] 实现技能级别的工具链编排
   - [ ] 实现技能执行上下文管理
   - [ ] 集成到 AIEngineManager

**预计时间**: 10天

---

### Phase 6: 测试和文档(优先级:高)

1. **单元测试** (2天)
   - [ ] SkillManager 测试
   - [ ] ToolManager 测试
   - [ ] 数据库操作测试

2. **集成测试** (2天)
   - [ ] 技能-工具关联测试
   - [ ] 插件扩展测试
   - [ ] 统计系统测试

3. **UI测试** (1天)
   - [ ] E2E测试(Playwright)
   - [ ] 组件测试

4. **文档编写** (2天)
   - [ ] API 文档
   - [ ] 用户使用指南
   - [ ] 插件开发指南

**预计时间**: 7天

---

## 十一、关键技术难点和解决方案

### 难点1: 动态工具注册和热更新

**问题**: 插件启用时动态注册工具到 FunctionCaller,需要确保线程安全和状态一致性。

**解决方案**:
- FunctionCaller 使用 Map 存储工具,天然支持动态添加/删除
- 在注册时加锁(使用 Promise 队列或互斥锁)
- 维护工具的启用状态(enabled),调用时检查
- 缓存工具列表,注册后刷新缓存

### 难点2: 参数Schema验证

**问题**: 需要验证工具的参数Schema是否符合JSON Schema规范。

**解决方案**:
- 使用 `ajv` 库进行Schema验证
- 在 ToolManager.registerTool() 时验证
- 提供Schema编辑器时实时验证
- 预定义常用Schema模板

### 难点3: 统计数据聚合性能

**问题**: 随着使用时间增长,usage_logs表会变得很大,影响查询性能。

**解决方案**:
- 使用独立的统计表(skill_stats, tool_stats)存储聚合数据
- 定时任务(每日凌晨)汇总前一天的数据
- usage_logs表设置保留策略(如保留最近30天)
- 对统计表建立索引(skill_id + stat_date)

### 难点4: 技能-工具依赖图性能

**问题**: 渲染复杂的依赖关系图可能影响前端性能。

**解决方案**:
- 使用虚拟化技术(只渲染可见部分)
- 对大图进行分层显示(先显示技能层,点击后展开工具层)
- 使用WebWorker计算布局
- 提供筛选功能(只显示启用的技能/工具)

### 难点5: 插件工具的沙箱隔离

**问题**: 插件提供的工具handler需要在沙箱中执行,但需要访问系统API。

**解决方案**:
- 使用现有的 PluginSandbox 和 PluginAPI
- 工具handler通过 PluginAPI 访问系统功能
- 权限检查在PluginAPI层进行
- 超时控制在沙箱执行层

### 难点6: Markdown文档的版本控制

**问题**: 文档更新后需要保留历史版本,支持回滚。

**解决方案**:
- 文档存储在Git仓库中(如果已初始化)
- 每次更新自动提交
- 提供文档历史查看功能
- 或使用文件版本号命名(如 `tool_name.v1.md`, `tool_name.v2.md`)

---

## 十二、集成点总结

### 需要修改的现有文件

1. **desktop-app-vue/src/main/ai-engine/function-caller.js**
   - 添加 `setToolManager()` 方法
   - 在 `call()` 方法中记录统计
   - 支持工具启用/禁用检查

2. **desktop-app-vue/src/main/plugins/plugin-manager.js**
   - Line 522: 完善 `handleAIFunctionToolExtension()` 方法
   - 添加 `setSystemContext()` 调用(已有,需更新)

3. **desktop-app-vue/src/main/ai-engine/ai-engine-manager.js**
   - 添加 `setSkillManager()` 方法
   - 在 `processUserInput()` 中集成技能推荐

4. **desktop-app-vue/src/main/index.js**
   - 初始化 SkillManager 和 ToolManager
   - 注册 IPC handlers
   - 更新 PluginManager 的系统上下文

5. **desktop-app-vue/src/main/database.js**
   - 添加数据库迁移逻辑(如果没有迁移系统,需创建)

### 需要新建的文件

**后端**:
- `skill-tool-system/skill-manager.js`
- `skill-tool-system/tool-manager.js`
- `skill-tool-system/skill-executor.js` (可选)
- `skill-tool-system/skill-tool-ipc.js`
- `skill-tool-system/builtin-skills.js`
- `skill-tool-system/builtin-tools.js`
- `skill-tool-system/doc-generator.js`
- `database/migrations/002_skill_tool_system.sql`

**前端**:
- `renderer/pages/settings/SkillManagement.vue`
- `renderer/pages/settings/ToolManagement.vue`
- `renderer/components/skill/SkillCard.vue`
- `renderer/components/skill/SkillEditor.vue`
- `renderer/components/skill/SkillStats.vue`
- `renderer/components/skill/SkillDependencyGraph.vue`
- `renderer/components/tool/ToolCard.vue`
- `renderer/components/tool/ToolEditor.vue`
- `renderer/components/tool/ToolParamEditor.vue`
- `renderer/components/tool/ToolStats.vue`
- `renderer/stores/skill.js`
- `renderer/stores/tool.js`

**文档**:
- `docs/skills/*.md` (15+ 技能文档)
- `docs/tools/*.md` (30+ 工具文档)

---

## 十三、预期效果

### 功能效果
1. ✅ 用户可以在设置页面查看所有技能和工具
2. ✅ 用户可以启用/禁用特定技能或工具
3. ✅ 用户可以编辑技能和工具的配置参数
4. ✅ 用户可以查看详细的使用统计和成功率
5. ✅ 用户可以可视化查看技能-工具的依赖关系
6. ✅ 开发者可以通过插件扩展自定义技能和工具
7. ✅ AI引擎可以根据意图智能推荐合适的技能
8. ✅ 系统可以自动记录每次工具调用的统计数据

### 性能指标
- 技能/工具列表加载时间 < 500ms
- 统计数据查询时间 < 1s
- 依赖关系图渲染时间 < 2s
- 工具调用增加的额外开销 < 10ms

### 可维护性
- 代码遵循现有架构模式(Manager/IPC/Database)
- 充分复用现有组件
- 完善的单元测试覆盖率 > 80%
- 详细的文档和注释

---

## 十四、后续优化方向

1. **AI驱动的技能推荐**: 使用机器学习分析用户行为,智能推荐技能
2. **技能市场**: 类似VSCode插件市场,支持技能/工具的发布和下载
3. **技能版本管理**: 支持技能的版本升级和回滚
4. **A/B测试**: 支持技能的多版本并存,进行效果对比
5. **协作功能**: 支持技能/工具的分享和协作编辑
6. **多语言支持**: 技能和工具的国际化

---

## 总结

本方案设计了一个完整的技能和工具管理系统,核心特点:

1. **两层架构**: Skill (高层能力包) -> Tools (底层功能单元)
2. **充分复用**: 基于现有的 FunctionCaller、PluginManager、DatabaseManager
3. **插件化**: 完善 `ai.function-tool` 扩展点,支持第三方扩展
4. **混合存储**: 数据库存元数据,Markdown存文档
5. **可视化管理**: 提供直观的UI界面,支持统计分析和依赖关系可视化

**总工作量**: 约 44 天(按实际开发人员数量可并行)

**核心优势**:
- 参考 Claude Code 和 Manus 的设计理念
- 遵循现有代码架构和模式
- 完善的扩展性和可维护性
- 用户友好的管理界面

这个系统将显著提升ChainlessChain的智能化程度和用户体验,成为与Claude Code竞争的核心竞争力。
