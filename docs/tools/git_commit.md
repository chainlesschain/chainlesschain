# Git提交

## 📋 基本信息

| 属性 | 值 |
|------|-----|
| **工具ID** | `tool_git_commit` |
| **工具名称** | `git_commit` |
| **类型** | function |
| **分类** | version-control |
| **风险等级** | 🟡 2/5 (较低风险) |
| **状态** | ✅ 启用 |
| **来源** | 🔧 内置工具 |

---

## 📖 功能描述

提交Git更改

### 核心功能

- 提交Git更改

---

## 📥 参数Schema

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

### 参数说明

- **repoPath** (string) - **必填**
  仓库路径

- **message** (string) - **必填**
  提交信息

---

## 📤 返回值Schema

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

### 返回值说明

- **success** (boolean): 暂无描述
- **commitHash** (string): 暂无描述
- **message** (string): 暂无描述

---

## ⚙️ 配置选项

```json
undefined
```

---

## 🔐 权限要求

- `file:write` - 写入文件系统
- `git:commit` - Git提交操作

---

## 💡 使用示例

### 示例 1: 基础用法

```javascript
const result = await callTool('git_commit', {
  "repoPath": "your_repoPath",
  "message": "your_message"
});

if (result.success) {
  console.log('✅ 执行成功:', result);
} else {
  console.error('❌ 执行失败:', result.error);
}
```

### 示例 2: 高级用法

```javascript
// 高级用法示例
const result = await callTool('git_commit', {
  // 更多参数...
});
```

### 示例 3: 错误处理

```javascript
try {
  const result = await callTool('git_commit', {
  "repoPath": "your_repoPath",
  "message": "your_message"
});

  if (!result.success) {
    throw new Error(result.error || '工具执行失败');
  }

  // 处理成功结果
  console.log('结果:', result);

} catch (error) {
  console.error('错误:', error.message);

  // 错误恢复逻辑
    // 实现错误恢复逻辑
}
```

---

## 🎯 使用场景

根据 git_commit 的功能特性选择合适的使用场景

---

## ⚠️ 注意事项

使用前请仔细阅读文档

---

## 🚀 性能优化

根据实际情况优化性能

---

## 🔧 故障排除

参考常见问题解决

---

## 📊 性能指标

| 指标 | 值 |
|------|-----|
| **平均执行时间** | 0 ms |
| **调用次数** | 0 |
| **成功次数** | 0 |
| **成功率** | 0% |

---

## 🔗 相关工具

暂无相关工具

---

## 📚 最佳实践

遵循行业最佳实践

---

## 📝 更新日志

### v1.0.0 (2025-12-29)
- ✅ 初始版本发布
- ✅ 完整功能实现
- ✅ 文档完善

---

## 📖 文档路径

`docs/tools/tool_git_commit.md`

---

**创建时间**: 2025-12-29
**维护者**: ChainlessChain Team
**反馈**: [提交Issue](https://github.com/chainlesschain/chainlesschain/issues)
