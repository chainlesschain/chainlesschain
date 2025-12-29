# 文件读取

## 基本信息

- **工具ID**: tool_file_reader
- **工具名称**: file_reader
- **类型**: function
- **分类**: file
- **风险等级**: 1/5
- **状态**: 启用
- **来源**: 内置工具

## 功能描述

读取指定路径的文件内容

## 参数Schema

```json
{
  "type": "object",
  "properties": {
    "filePath": {
      "type": "string",
      "description": "要读取的文件路径"
    }
  },
  "required": [
    "filePath"
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
    "content": {
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

- `file:read`

## 使用示例

```javascript
const result = await callTool('file_reader', {
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

`docs/tools/tool_file_reader.md`

---

**创建时间**: 2025-12-29
**维护者**: ChainlessChain Team
