# Git初始化

## 📋 基本信息

| 属性 | 值 |
|------|-----|
| **工具ID** | `tool_git_init` |
| **工具名称** | `git_init` |
| **类型** | function |
| **分类** | version-control |
| **风险等级** | 🟡 2/5 (较低风险) |
| **状态** | ✅ 启用 |
| **来源** | 🔧 内置工具 |

---

## 📖 功能描述

初始化Git仓库

### 核心功能

- 🔧 初始化Git仓库
- 📝 创建.gitignore
- 🏷️ 设置初始分支
- ⚙️ 配置Git选项

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

### 参数说明

- **repoPath** (string) - **必填**
  仓库路径

- **initialBranch** (string) - 可选 (默认: `main`)
  初始分支名

---

## 📤 返回值Schema

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

### 返回值说明

- **success** (boolean): 暂无描述
- **repoPath** (string): 暂无描述
- **branch** (string): 暂无描述

---

## ⚙️ 配置选项

```json
undefined
```

---

## 🔐 权限要求

- `file:write` - 写入文件系统
- `git:init` - Git仓库初始化

---

## 💡 使用示例

### 示例 1: 基础用法

```javascript
const result = await callTool('git_init', {
  "repoPath": "your_repoPath",
  "initialBranch": "main"
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
const result = await callTool('git_init', {
  // 更多参数...
});
```

### 示例 3: 错误处理

```javascript
try {
  const result = await callTool('git_init', {
  "repoPath": "your_repoPath",
  "initialBranch": "main"
});

  if (!result.success) {
    throw new Error(result.error || '工具执行失败');
  }

  // 处理成功结果
  console.log('结果:', result);

} catch (error) {
  console.error('错误:', error.message);

  // 错误恢复逻辑
    // 检查是否已经是Git仓库
  const isGitRepo = await checkGitRepository();
  if (isGitRepo) {
    console.log('已经是Git仓库，跳过初始化');
  }
}
```

---

## 🎯 使用场景

根据 git_init 的功能特性选择合适的使用场景

---

## ⚠️ 注意事项

1. ⚠️ 确保目录不是已有仓库的子目录
2. 📁 检查目录是否为空
3. 🔧 配置Git用户信息
4. 📝 准备好.gitignore文件

---

## 🚀 性能优化

根据实际情况优化性能

---

## 🔧 故障排除

### 问题1: 已经是Git仓库

**原因**: 目录已初始化为Git仓库

**解决**: 检查.git目录是否存在

### 问题2: Git未安装

**原因**: 系统未安装Git

**解决**: 安装Git并配置环境变量

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

`docs/tools/tool_git_init.md`

---

**创建时间**: 2025-12-29
**维护者**: ChainlessChain Team
**反馈**: [提交Issue](https://github.com/chainlesschain/chainlesschain/issues)
