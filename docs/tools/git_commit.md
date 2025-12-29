# Git提交

## 基本信息

- **工具ID**: tool_git_commit
- **工具名称**: git_commit
- **类型**: function
- **分类**: version-control
- **风险等级**: 2/5
- **状态**: 启用
- **来源**: 内置工具

## 功能描述

提交Git更改

## 参数Schema

```json
{
  "type": "object",
  "properties": {
    "repoPath": {
      "type": "string",
      "description": "仓库路径"
    },
    "message": {
      "type": "string",
      "description": "提交信息"
    }
  },
  "required": [
    "repoPath",
    "message"
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
    "commitHash": {
      "type": "string"
    },
    "message": {
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

- `file:write`
- `git:commit`

## 使用示例

```javascript
const result = await callTool('git_commit', {
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

`docs/tools/tool_git_commit.md`

---

**创建时间**: 2025-12-29
**维护者**: ChainlessChain Team
