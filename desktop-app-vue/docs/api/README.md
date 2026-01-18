# 技能工具系统 API 文档

> 自动生成时间: 2026/1/18 12:38:56

## 概述

技能工具系统提供了完整的技能和工具管理功能,包括:

- **技能管理** - 创建、配置和管理技能
- **工具管理** - 注册、执行和监控工具
- **执行调度** - 智能调度和执行技能
- **统计分析** - 使用统计和性能分析
- **定时任务** - 自动化工作流和数据清理

## 核心模块

### [SkillManager](./SkillManager.md)

技能管理器 - 负责技能的CRUD操作、状态管理和统计

### [ToolManager](./ToolManager.md)

工具管理器 - 负责工具的注册、执行和参数验证

### [SkillExecutor](./SkillExecutor.md)

技能执行器 - 负责执行技能和调度工具

### [ToolRunner](./ToolRunner.md)

工具运行器 - 负责工具的安全执行和错误处理

### [StatsCleaner](./StatsCleaner.md)

统计数据清理器 - 定期清理过期数据和优化数据库

## 快速开始

```javascript
const { SkillManager } = require("./skill-tool-system/skill-manager");
const { ToolManager } = require("./skill-tool-system/tool-manager");

// 初始化
const skillManager = new SkillManager(database, toolManager);
const toolManager = new ToolManager(database, functionCaller);

await skillManager.initialize();
await toolManager.initialize();

// 注册技能
const skill = await skillManager.registerSkill({
  id: "my_skill",
  name: "我的技能",
  category: "custom",
  description: "自定义技能描述",
});

// 注册工具
const tool = await toolManager.registerTool(
  {
    id: "my_tool",
    name: "my_tool",
    description: "我的工具",
    parameters_schema: JSON.stringify({
      type: "object",
      properties: {
        input: { type: "string" },
      },
    }),
  },
  async (params) => {
    // 工具处理逻辑
    return { result: "success" };
  },
);

// 关联技能和工具
await skillManager.addToolToSkill(skill.id, tool.id);
```

## IPC接口

技能工具系统通过IPC提供前端调用接口:

### 技能相关

- `skill:get-all` - 获取所有技能
- `skill:get-by-id` - 根据ID获取技能
- `skill:enable` - 启用技能
- `skill:disable` - 禁用技能
- `skill:get-doc` - 获取技能文档

### 工具相关

- `tool:get-all` - 获取所有工具
- `tool:get-by-id` - 根据ID获取工具
- `tool:enable` - 启用工具
- `tool:disable` - 禁用工具
- `tool:execute` - 执行工具
- `tool:get-doc` - 获取工具文档

详细的IPC接口文档请参考 [IPC接口文档](./IPC.md)

## 数据库Schema

系统使用SQLite数据库,包含以下表:

- `skills` - 技能表
- `tools` - 工具表
- `skill_tools` - 技能-工具关联表
- `skill_stats` - 技能统计表
- `tool_stats` - 工具统计表
- `skill_tool_usage_logs` - 使用日志表

详细的数据库Schema请参考 [数据库文档](./Database.md)

## 插件开发

开发插件扩展技能和工具:

```json
{
  "id": "com.example.my-plugin",
  "extensionPoints": [
    {
      "point": "ai.function-tool",
      "config": {
        "tools": [
          {
            "name": "my_tool",
            "description": "我的工具",
            "parameters": {
              /* schema */
            },
            "handler": "myToolHandler"
          }
        ],
        "skills": [
          {
            "id": "my_skill",
            "name": "我的技能",
            "tools": ["my_tool"]
          }
        ]
      }
    }
  ]
}
```

详细的插件开发指南请参考 [插件开发文档](./PluginDevelopment.md)

---

> 更多信息请参考各模块的详细文档
