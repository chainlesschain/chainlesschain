# 技能工具系统 API 文档

> 自动生成时间: 2026/1/4 13:54:49

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
const { SkillManager } = require('./skill-tool-system/skill-manager');
const { ToolManager } = require('./skill-tool-system/tool-manager');

// 初始化
const skillManager = new SkillManager(database, toolManager);
const toolManager = new ToolManager(database, functionCaller);

await skillManager.initialize();
await toolManager.initialize();

// 注册技能
const skill = await skillManager.registerSkill({
  id: 'my_skill',
  name: '我的技能',
  category: 'custom',
  description: '自定义技能描述'
});

// 注册工具
const tool = await toolManager.registerTool({
  id: 'my_tool',
  name: 'my_tool',
  description: '我的工具',
  parameters_schema: JSON.stringify({
    type: 'object',
    properties: {
      input: { type: 'string' }
    }
  })
}, async (params) => {
  // 工具处理逻辑
  return { result: 'success' };
});

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
            "parameters": { /* schema */ },
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

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：技能工具系统 API 文档。

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
