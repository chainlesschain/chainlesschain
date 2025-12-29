# 文件编辑

## 基本信息

- **工具ID**: tool_file_editor
- **工具名称**: file_editor
- **类型**: function
- **分类**: file
- **风险等级**: 2/5
- **状态**: 启用
- **来源**: 内置工具

## 功能描述

编辑现有文件内容

## 参数Schema

```json
{
  "type": "object",
  "properties": {
    "filePath": {
      "type": "string",
      "description": "文件路径"
    },
    "operations": {
      "type": "array",
      "description": "编辑操作列表",
      "items": {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "replace",
              "insert",
              "delete"
            ]
          },
          "search": {
            "type": "string"
          },
          "replacement": {
            "type": "string"
          },
          "line": {
            "type": "number"
          }
        }
      }
    }
  },
  "required": [
    "filePath",
    "operations"
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
    "filePath": {
      "type": "string"
    },
    "changes": {
      "type": "number"
    }
  }
}
```

## 配置选项

```json
undefined
```

## 权限要求

- `file:read`
- `file:write`

## 使用示例

```javascript
const result = await callTool('file_editor', {
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

`docs/tools/tool_file_editor.md`

---

**创建时间**: 2025-12-29
**维护者**: ChainlessChain Team
