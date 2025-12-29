# Git初始化

## 基本信息

- **工具ID**: tool_git_init
- **工具名称**: git_init
- **类型**: function
- **分类**: version-control
- **风险等级**: 2/5
- **状态**: 启用
- **来源**: 内置工具

## 功能描述

初始化Git仓库

## 参数Schema

```json
{
  "type": "object",
  "properties": {
    "repoPath": {
      "type": "string",
      "description": "仓库路径"
    },
    "initialBranch": {
      "type": "string",
      "description": "初始分支名",
      "default": "main"
    }
  },
  "required": [
    "repoPath"
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
    "repoPath": {
      "type": "string"
    },
    "branch": {
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
- `git:init`

## 使用示例

```javascript
const result = await callTool('git_init', {
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

`docs/tools/tool_git_init.md`

---

**创建时间**: 2025-12-29
**维护者**: ChainlessChain Team
