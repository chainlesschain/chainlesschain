# 技能和工具管理系统集成指南

## 📌 概述

本文档提供完成技能和工具管理系统集成的详细步骤。Phase 1的核心代码已完成，剩余3个集成点需要手动修改现有文件。

## ✅ 已完成的组件

1. ✅ 数据库迁移脚本: `desktop-app-vue/src/main/database/migrations/003_skill_tool_system.sql`
2. ✅ ToolManager: `desktop-app-vue/src/main/skill-tool-system/tool-manager.js`
3. ✅ SkillManager: `desktop-app-vue/src/main/skill-tool-system/skill-manager.js`
4. ✅ 内置技能定义: `desktop-app-vue/src/main/skill-tool-system/builtin-skills.js`
5. ✅ IPC接口: `desktop-app-vue/src/main/skill-tool-system/skill-tool-ipc.js`

## 🔧 需要手动集成的3个文件

### 1. 修改 FunctionCaller 添加统计功能

**文件**: `desktop-app-vue/src/main/ai-engine/function-caller.js`

#### 步骤1: 在构造函数中添加toolManager属性

在 `constructor()` 中的 `this.tools = new Map();` 后添加：

```javascript
// ToolManager引用（用于统计）
this.toolManager = null;
```

#### 步骤2: 添加 setToolManager 方法

在 `constructor()` 后添加新方法：

```javascript
/**
 * 设置ToolManager（用于统计功能）
 * @param {ToolManager} toolManager - 工具管理器
 */
setToolManager(toolManager) {
  this.toolManager = toolManager;
  console.log('[Function Caller] ToolManager已设置');
}
```

#### 步骤3: 修改 call 方法添加统计记录

找到 `async call(toolName, params = {}, context = {})` 方法，完全替换为：

```javascript
async call(toolName, params = {}, context = {}) {
  const startTime = Date.now();  // ← 添加这行
  const tool = this.tools.get(toolName);

  if (!tool) {
    throw new Error(`工具 "${toolName}" 不存在`);
  }

  console.log(`[Function Caller] 调用工具: ${toolName}`, params);

  try {
    const result = await tool.handler(params, context);

    // ↓↓↓ 添加成功统计记录 ↓↓↓
    if (this.toolManager) {
      const duration = Date.now() - startTime;
      this.toolManager.recordToolUsage(toolName, true, duration).catch(err => {
        console.error('[Function Caller] 记录统计失败:', err);
      });
    }
    // ↑↑↑ 添加结束 ↑↑↑

    return result;
  } catch (error) {
    console.error(`[Function Caller] 工具 "${toolName}" 执行失败:`, error);

    // ↓↓↓ 添加失败统计记录 ↓↓↓
    if (this.toolManager) {
      const duration = Date.now() - startTime;
      const errorType = error.name || 'Error';
      this.toolManager.recordToolUsage(toolName, false, duration, errorType).catch(err => {
        console.error('[Function Caller] 记录统计失败:', err);
      });
    }
    // ↑↑↑ 添加结束 ↑↑↑

    throw error;
  }
}
```

---

### 2. 完善 PluginManager 的 handleAIFunctionToolExtension

**文件**: `desktop-app-vue/src/main/plugins/plugin-manager.js`

#### 找到 Line 522 左右的空桩方法

找到这个方法（应该在第522行附近）：

```javascript
async handleAIFunctionToolExtension(context) {
  console.log('[PluginManager] 处理AI Function工具扩展:', context);
  // Phase 4 实现  ← 这是占位注释
}
```

#### 完全替换为以下实现：

```javascript
async handleAIFunctionToolExtension(context) {
  console.log('[PluginManager] 处理AI Function工具扩展:', context);

  const { pluginId, config } = context;
  const { tools = [], skills = [] } = config;

  try {
    // 1. 注册插件提供的工具
    for (const toolDef of tools) {
      const toolId = `${pluginId}_${toolDef.name}`;

      // 获取插件实例以绑定handler
      const plugin = this.plugins.get(pluginId);
      if (!plugin || !plugin.sandbox) {
        console.warn(`[PluginManager] 插件未加载，跳过工具注册: ${pluginId}`);
        continue;
      }

      // 从插件实例获取handler方法
      let handler = null;
      if (typeof toolDef.handler === 'string') {
        // handler是方法名，从插件实例获取
        handler = async (params, context) => {
          return await plugin.sandbox.callMethod(toolDef.handler, params, context);
        };
      } else if (typeof toolDef.handler === 'function') {
        handler = toolDef.handler;
      }

      if (!handler) {
        console.warn(`[PluginManager] 工具handler无效: ${toolDef.name}`);
        continue;
      }

      // 注册工具到ToolManager
      if (this.systemContext.toolManager) {
        await this.systemContext.toolManager.registerTool({
          id: toolId,
          name: toolDef.name,
          display_name: toolDef.displayName || toolDef.name,
          description: toolDef.description || '',
          category: toolDef.category || 'custom',
          parameters_schema: toolDef.parameters || {},
          return_schema: toolDef.returnSchema || {},
          plugin_id: pluginId,
          is_builtin: 0,
          enabled: 1,
          tool_type: toolDef.type || 'function',
          required_permissions: toolDef.requiredPermissions || [],
          risk_level: toolDef.riskLevel || 2,
        }, handler);

        console.log(`[PluginManager] 插件工具已注册: ${toolDef.name}`);
      }
    }

    // 2. 注册插件提供的技能
    for (const skillDef of skills) {
      const skillId = `${pluginId}_${skillDef.id}`;

      if (this.systemContext.skillManager) {
        await this.systemContext.skillManager.registerSkill({
          id: skillId,
          name: skillDef.name,
          display_name: skillDef.displayName || skillDef.name,
          description: skillDef.description || '',
          category: skillDef.category || 'custom',
          icon: skillDef.icon || null,
          plugin_id: pluginId,
          is_builtin: 0,
          enabled: 1,
          tags: skillDef.tags || [],
          config: skillDef.config || {},
        });

        // 3. 关联技能和工具
        if (skillDef.tools && skillDef.tools.length > 0) {
          for (let i = 0; i < skillDef.tools.length; i++) {
            const toolName = skillDef.tools[i];
            const toolId = `${pluginId}_${toolName}`;

            // 查找工具
            const tool = await this.systemContext.toolManager.getToolByName(toolName) ||
                         await this.systemContext.toolManager.getTool(toolId);

            if (tool) {
              await this.systemContext.skillManager.addToolToSkill(
                skillId,
                tool.id,
                i === 0 ? 'primary' : 'secondary',
                skillDef.tools.length - i
              );
            } else {
              console.warn(`[PluginManager] 工具不存在，跳过关联: ${toolName}`);
            }
          }
        }

        console.log(`[PluginManager] 插件技能已注册: ${skillDef.name}`);
      }
    }

    console.log('[PluginManager] AI工具扩展处理完成');
  } catch (error) {
    console.error('[PluginManager] 处理AI工具扩展失败:', error);
    throw error;
  }
}
```

---

### 3. 集成到 main/index.js

**文件**: `desktop-app-vue/src/main/index.js`

#### 步骤1: 在文件顶部添加导入

在其他 require 语句之后添加（建议在database相关导入之后）：

```javascript
// 导入技能和工具管理系统
const ToolManager = require('./skill-tool-system/tool-manager');
const SkillManager = require('./skill-tool-system/skill-manager');
const { registerSkillToolIPC } = require('./skill-tool-system/skill-tool-ipc');
```

#### 步骤2: 在 app.whenReady() 中初始化

找到 `app.whenReady()` 中初始化数据库和其他管理器的部分，在 `aiEngineManager` 和 `functionCaller` 初始化之后添加：

```javascript
// 初始化技能和工具管理系统
console.log('[Main] 初始化技能和工具管理系统...');

const toolManager = new ToolManager(database, functionCaller);
const skillManager = new SkillManager(database, toolManager);

await toolManager.initialize();
await skillManager.initialize();

// 设置FunctionCaller的ToolManager引用
functionCaller.setToolManager(toolManager);

// 设置AIEngineManager的SkillManager引用（如果需要）
// aiEngineManager.setSkillManager(skillManager);

console.log('[Main] 技能和工具管理系统初始化完成');
```

#### 步骤3: 更新PluginManager的系统上下文

找到 `pluginManager.setSystemContext()` 调用（应该在初始化PluginManager之后），添加新的上下文：

```javascript
pluginManager.setSystemContext({
  database: database,
  llmManager: llmManager,
  ragManager: ragManager,
  gitManager: gitManager,
  fileImporter: fileImporter,
  aiEngineManager: aiEngineManager,
  webEngine: webEngine,
  documentEngine: documentEngine,
  dataEngine: dataEngine,
  // ↓↓↓ 添加以下两行 ↓↓↓
  skillManager: skillManager,
  toolManager: toolManager,
  // ↑↑↑ 添加结束 ↑↑↑
});
```

#### 步骤4: 注册IPC handlers

在其他IPC handlers注册之后（如 `registerAIEngineIPC`、`registerPluginIPC` 等），添加：

```javascript
// 注册技能和工具IPC handlers
registerSkillToolIPC(ipcMain, skillManager, toolManager);
console.log('[Main] 技能和工具IPC handlers已注册');
```

---

## 🗄️ 数据库迁移

### 运行迁移脚本

如果你的项目有自动迁移系统，它应该会自动执行 `003_skill_tool_system.sql`。

如果需要手动执行，可以：

1. 通过DatabaseManager的迁移机制
2. 或直接在数据库工具中执行SQL脚本

迁移脚本会创建6张表：
- `skills` - 技能表
- `tools` - 工具表
- `skill_tools` - 技能-工具关联表
- `skill_stats` - 技能统计表
- `tool_stats` - 工具统计表
- `skill_tool_usage_logs` - 使用日志表

---

## 🧪 测试集成

完成上述3个文件的修改后，重启应用并检查：

### 1. 检查日志输出

启动应用后应该看到以下日志：

```
[Main] 初始化技能和工具管理系统...
[ToolManager] 初始化工具管理器...
[ToolManager] 加载内置工具...
[ToolManager] 内置工具已加载: file_reader
[ToolManager] 内置工具已加载: file_writer
... (共15个工具)
[ToolManager] 内置工具加载完成
[ToolManager] 插件工具加载完成，共 0 个
[ToolManager] 初始化完成，共加载 15 个工具
[SkillManager] 初始化技能管理器...
[SkillManager] 加载内置技能...
[SkillManager] 技能注册成功: 代码开发 (skill_code_development)
... (共15个技能)
[SkillManager] 内置技能加载完成
[SkillManager] 初始化完成，共加载 15 个技能
[Function Caller] ToolManager已设置
[Main] 技能和工具管理系统初始化完成
[Skill-Tool IPC] IPC handlers 注册完成
```

### 2. 测试IPC调用

在渲染进程（Vue组件）中测试：

```javascript
// 获取所有技能
const result = await window.electronAPI.invoke('skill:get-all');
console.log('技能列表:', result.data);

// 获取所有工具
const tools = await window.electronAPI.invoke('tool:get-all');
console.log('工具列表:', tools.data);

// 获取依赖关系图
const graph = await window.electronAPI.invoke('skill-tool:get-dependency-graph');
console.log('依赖关系图:', graph.data);
```

### 3. 测试工具调用统计

调用任何工具后，检查数据库：

```sql
-- 查看工具使用统计
SELECT * FROM tools WHERE usage_count > 0;

-- 查看每日统计
SELECT * FROM tool_stats ORDER BY stat_date DESC LIMIT 10;
```

---

## 📁 文件结构总览

```
desktop-app-vue/src/main/
├── database/
│   └── migrations/
│       └── 003_skill_tool_system.sql      ← 新增
│
├── skill-tool-system/                      ← 新目录
│   ├── skill-manager.js                    ← 新增
│   ├── tool-manager.js                     ← 新增
│   ├── builtin-skills.js                   ← 新增
│   └── skill-tool-ipc.js                   ← 新增
│
├── ai-engine/
│   └── function-caller.js                  ← 需修改
│
├── plugins/
│   └── plugin-manager.js                   ← 需修改
│
└── index.js                                ← 需修改
```

---

## ⚠️ 常见问题

### Q1: 数据库表已存在错误

A: 迁移脚本使用了 `CREATE TABLE IF NOT EXISTS`，不会报错。如果仍有问题，检查数据库文件权限。

### Q2: ToolManager 未设置警告

A: 确保在 `app.whenReady()` 中调用了 `functionCaller.setToolManager(toolManager)`。

### Q3: 内置技能加载失败

A: 检查 `builtin-skills.js` 中引用的工具名称是否与 FunctionCaller 中注册的工具名称完全一致。

### Q4: 插件工具注册失败

A: 确保 PluginManager 的 `systemContext` 包含了 `toolManager` 和 `skillManager`。

---

## 🚀 下一步

完成集成后，你可以：

1. **开发前端UI** (Phase 3)
   - 技能管理页面 (SkillManagement.vue)
   - 工具管理页面 (ToolManagement.vue)
   - 统计可视化组件

2. **添加新工具**
   - 参考 `builtin-skills.js` 中的TODO注释
   - 实现缺失的工具（如 data_analyzer, chart_generator 等）

3. **创建文档系统** (Phase 2)
   - 实现 doc-generator.js
   - 为每个技能和工具生成Markdown文档

4. **测试插件扩展**
   - 创建测试插件
   - 验证插件提供的技能和工具能正确注册

---

## 📞 技术支持

如果在集成过程中遇到问题，请检查：

1. 控制台日志输出
2. 数据库表是否创建成功
3. IPC handlers 是否正确注册
4. 文件导入路径是否正确

祝集成顺利！🎉
