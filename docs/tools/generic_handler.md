# 通用处理器

## 基本信息

- **工具ID**: tool_generic_handler
- **工具名称**: generic_handler
- **类型**: function
- **分类**: system
- **风险等级**: 3/5
- **状态**: 启用
- **来源**: 内置工具

## 功能描述

处理通用任务的默认处理器

## 参数Schema

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "description": "要执行的操作"
    },
    "params": {
      "type": "object",
      "description": "操作参数"
    }
  },
  "required": [
    "action"
  ]
}
```

## 返回值Schema

```json
{
  "type": "object",
  "properties": {
    "success": {
      "type": "boolean"
    },
    "result": {
      "type": "any"
    }
  }
}
```

## 配置选项

```json
undefined
```

## 权限要求

- `system:execute`

## 使用示例

```javascript
const result = await callTool('generic_handler', {
  // 参数根据 parameters_schema 定义
});

if (result.success) {
  console.log('执行成功:', result);
} else {
  console.error('执行失败:', result.error);
}
```

## 性能指标

- **平均执行时间**: 0 ms
- **调用次数**: 0
- **成功次数**: 0

## 文档路径

`docs/tools/tool_generic_handler.md`

---

**创建时间**: 2025-12-29
**维护者**: ChainlessChain Team
