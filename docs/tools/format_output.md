# 格式化输出

## 基本信息

- **工具ID**: tool_format_output
- **工具名称**: format_output
- **类型**: function
- **分类**: format
- **风险等级**: 1/5
- **状态**: 启用
- **来源**: 内置工具

## 功能描述

格式化输出内容为指定格式

## 参数Schema

```json
{
  "type": "object",
  "properties": {
    "content": {
      "type": "string",
      "description": "要格式化的内容"
    },
    "format": {
      "type": "string",
      "description": "输出格式",
      "enum": [
        "json",
        "markdown",
        "html",
        "plain"
      ]
    },
    "options": {
      "type": "object",
      "description": "格式化选项"
    }
  },
  "required": [
    "content",
    "format"
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
    "formatted": {
      "type": "string"
    },
    "format": {
      "type": "string"
    }
  }
}
```

## 配置选项

```json
undefined
```

## 权限要求

无特殊权限要求

## 使用示例

```javascript
const result = await callTool('format_output', {
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

`docs/tools/tool_format_output.md`

---

**创建时间**: 2025-12-29
**维护者**: ChainlessChain Team
