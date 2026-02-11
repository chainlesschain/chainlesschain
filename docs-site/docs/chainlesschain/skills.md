# Skills 技能系统

> **版本: v0.29.0 | Markdown技能定义 | 可扩展框架**

Skills 系统提供可扩展的技能框架，使用 Markdown 定义技能，支持三层加载、门控检查和自定义命令。

## 系统概述

### 技能是什么

技能是预定义的 AI 能力模板，封装了特定任务的：

- **提示词** - AI 的行为指导
- **工具集** - 允许使用的工具
- **参数** - 可配置的选项
- **门控** - 执行条件检查

### 技能示例

```
/code-review           # 代码审查
/git-commit            # 智能提交
/explain-code          # 代码解释
/generate-tests        # 生成测试
/refactor              # 代码重构
```

---

## 三层加载

### 加载优先级

```
workspace/     # 工作区技能（最高优先级）
    ↓
managed/       # 用户管理的技能
    ↓
bundled/       # 内置技能（最低优先级）
```

高层技能可以覆盖低层同名技能。

### 技能目录

```
.chainlesschain/skills/          # 工作区技能
~/.chainlesschain/skills/        # 用户技能
<app>/resources/skills/          # 内置技能
```

---

## 技能定义格式

### Markdown 技能文件

```markdown
---
name: code-review
description: 执行代码审查，提供改进建议
version: 1.0.0
author: ChainlessChain Team
---

# Code Review 代码审查

## 门控检查

- platform: ["darwin", "linux", "win32"]
- binary: git
- env: GITHUB_TOKEN (optional)

## 参数

- `file` (required): 要审查的文件路径
- `focus` (optional): 审查重点 (security|performance|style)
- `severity` (optional): 最低报告级别 (info|warning|error)

## 工具

- Read
- Glob
- Grep

## 提示词

你是一个专业的代码审查员。请审查提供的代码，关注以下方面：

1. **代码质量** - 可读性、可维护性、命名规范
2. **潜在问题** - bug、边界情况、错误处理
3. **性能** - 算法效率、资源使用
4. **安全** - 常见漏洞、敏感信息处理
5. **最佳实践** - 设计模式、代码组织

请提供具体的改进建议，包括代码示例。
```

---

## 内置技能

### code-review

代码审查技能：

```bash
/code-review src/auth/login.js

# 可选参数
/code-review src/auth/login.js --focus=security --severity=warning
```

### git-commit

智能 Git 提交：

```bash
/git-commit

# 自动分析更改，生成符合规范的提交消息
```

### explain-code

代码解释：

```bash
/explain-code src/utils/crypto.js

# 生成详细的代码解释和文档
```

### generate-tests

生成测试用例：

```bash
/generate-tests src/services/user-service.js

# 自动生成单元测试
```

---

## 门控检查

### 平台检查

```yaml
# 仅在 macOS 和 Linux 可用
- platform: ["darwin", "linux"]
```

### 二进制依赖

```yaml
# 需要安装 git
- binary: git

# 需要安装 node 和 npm
- binary: [node, npm]
```

### 环境变量

```yaml
# 必需的环境变量
- env: OPENAI_API_KEY

# 可选的环境变量
- env: GITHUB_TOKEN (optional)
```

### 自定义检查

```yaml
# 自定义检查脚本
- check: scripts/check-prerequisites.js
```

---

## 使用技能

### 命令行调用

```bash
# 基本调用
/skill-name

# 带参数
/skill-name file.js --option=value

# 多参数
/code-review src/index.js --focus=security --severity=error
```

### API 调用

```javascript
// 执行技能
const result = await skillSystem.execute("code-review", {
  file: "src/auth/login.js",
  focus: "security",
});

// 获取技能信息
const skill = await skillSystem.get("code-review");
console.log(skill.description);
console.log(skill.parameters);
```

---

## 创建自定义技能

### 1. 创建技能文件

```bash
# 在工作区创建
mkdir -p .chainlesschain/skills
touch .chainlesschain/skills/my-skill.md
```

### 2. 编写技能定义

```markdown
---
name: my-skill
description: 我的自定义技能
version: 1.0.0
---

# My Custom Skill

## 门控检查

- platform: ["darwin", "linux", "win32"]

## 参数

- `input` (required): 输入参数

## 工具

- Read
- Write
- Bash

## 提示词

你是一个专业的助手。请根据用户输入执行以下任务...
```

### 3. 测试技能

```bash
# 列出可用技能
/skills

# 执行技能
/my-skill input="test"
```

---

## 技能模板

### 文档生成技能

```markdown
---
name: generate-docs
description: 为代码生成文档
---

# Generate Documentation

## 工具

- Read
- Glob
- Write

## 提示词

分析提供的代码文件，生成详细的文档：

1. 模块概述
2. 函数/类说明
3. 参数和返回值
4. 使用示例
5. 注意事项

使用 JSDoc/TSDoc 格式生成注释。
```

### API 测试技能

```markdown
---
name: test-api
description: 测试 API 端点
---

# Test API

## 门控检查

- binary: curl

## 参数

- `url` (required): API URL
- `method` (optional): HTTP 方法 (GET|POST|PUT|DELETE)

## 工具

- Bash
- WebFetch

## 提示词

测试提供的 API 端点：

1. 发送请求
2. 分析响应
3. 验证状态码
4. 检查响应格式
5. 报告问题
```

---

## 技能管理

### 列出技能

```javascript
// 获取所有技能
const skills = await skillSystem.list();

// 按来源筛选
const bundled = await skillSystem.list({ source: "bundled" });
const workspace = await skillSystem.list({ source: "workspace" });
```

### 安装技能

```javascript
// 从 URL 安装
await skillSystem.install({
  url: "https://example.com/skills/my-skill.md",
  location: "managed", // 或 'workspace'
});

// 从本地文件安装
await skillSystem.install({
  path: "/path/to/skill.md",
  location: "workspace",
});
```

### 卸载技能

```javascript
// 卸载技能
await skillSystem.uninstall("my-skill");
```

### 更新技能

```javascript
// 更新技能
await skillSystem.update("my-skill");
```

---

## IPC 处理器

Skills 系统提供 17 个 IPC 处理器：

| 处理器              | 功能         |
| ------------------- | ------------ |
| `skills:list`       | 列出技能     |
| `skills:get`        | 获取技能详情 |
| `skills:execute`    | 执行技能     |
| `skills:install`    | 安装技能     |
| `skills:uninstall`  | 卸载技能     |
| `skills:update`     | 更新技能     |
| `skills:validate`   | 验证技能定义 |
| `skills:enable`     | 启用技能     |
| `skills:disable`    | 禁用技能     |
| `skills:getHistory` | 获取执行历史 |
| `skills:search`     | 搜索技能     |
| `skills:reload`     | 重新加载     |
| ...                 | ...          |

---

## 配置选项

```javascript
{
  "skills": {
    // 技能目录
    "directories": {
      "workspace": ".chainlesschain/skills",
      "managed": "~/.chainlesschain/skills"
    },

    // 自动加载
    "autoLoad": true,

    // 门控检查
    "gateChecks": {
      "enabled": true,
      "strict": false  // 严格模式下失败则禁用技能
    },

    // 执行限制
    "execution": {
      "timeout": 60000,  // 60秒超时
      "maxConcurrent": 3
    }
  }
}
```

---

## 最佳实践

### 1. 清晰的技能描述

```yaml
---
name: optimize-imports
description: 优化 JavaScript/TypeScript 文件的 import 语句，移除未使用的导入，排序并分组
---
```

### 2. 合理的工具限制

```markdown
## 工具

<!-- 只授予必要的工具权限 -->

- Read
- Glob
<!-- 不需要 Write，只分析不修改 -->
```

### 3. 详细的参数说明

```markdown
## 参数

- `file` (required): 要处理的文件路径
  - 支持 glob 模式
  - 示例: `src/**/*.ts`

- `style` (optional): 排序风格
  - `alphabetical`: 按字母排序（默认）
  - `grouped`: 按类型分组
```

---

## 下一步

- [Hooks系统](/chainlesschain/hooks) - 钩子扩展
- [Plan Mode](/chainlesschain/plan-mode) - 规划模式
- [Cowork系统](/chainlesschain/cowork) - 多智能体协作

---

**可扩展的技能，无限的能力** 🛠️
