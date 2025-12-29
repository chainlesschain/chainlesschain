# 信息搜索

## 基本信息

- **工具ID**: tool_info_searcher
- **工具名称**: info_searcher
- **类型**: function
- **分类**: ai
- **风险等级**: 1/5
- **状态**: 启用
- **来源**: 内置工具

## 功能描述

在知识库中搜索相关信息

## 参数Schema

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "搜索查询"
    },
    "context": {
      "type": "object",
      "description": "上下文信息"
    }
  },
  "required": [
    "query"
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
    "results": {
      "type": "array"
    }
  }
}
```

## 配置选项

```json
undefined
```

## 权限要求

- `database:read`
- `ai:search`

## 使用示例

```javascript
const result = await callTool('info_searcher', {
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

`docs/tools/tool_info_searcher.md`

---

**创建时间**: 2025-12-29
**维护者**: ChainlessChain Team
