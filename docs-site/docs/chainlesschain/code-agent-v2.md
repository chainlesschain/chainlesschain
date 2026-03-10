# 代码生成 Agent 2.0

> **版本: v4.1.0 | 状态: ✅ 生产就绪 | 8 IPC Handlers | Phase 86**

ChainlessChain 代码生成 Agent 2.0（Code Agent v2）提供全栈代码生成、Git 感知上下文、实时安全审查、项目脚手架和 CI/CD 自动配置能力，支持 JavaScript/TypeScript/Python/Java/Go/Rust 多语言，是开发者的智能编程助手。

## 核心特性

- 🏗️ **全栈代码生成**: 根据自然语言描述生成前后端完整代码，支持多种框架
- 🔍 **Git 感知上下文**: 分析 Git 历史、分支、变更，理解项目演进上下文
- 🛡️ **实时代码审查**: 检测 eval 注入、SQL 注入、XSS 等安全漏洞，实时报告风险
- 📦 **项目脚手架**: 一键生成 React/Vue/Express/FastAPI/Spring Boot 项目模板
- ⚙️ **CI/CD 自动配置**: 根据项目类型自动生成 GitHub Actions/GitLab CI 配置
- 🌐 **多语言支持**: JavaScript、TypeScript、Python、Java、Go、Rust

## IPC 接口

### 代码 Agent 操作（8 个）

| 通道                      | 功能       | 说明                                |
| ------------------------- | ---------- | ----------------------------------- |
| `code-agent:generate`     | 生成代码   | 根据描述生成代码，支持多语言和框架  |
| `code-agent:review`       | 代码审查   | 安全漏洞检测 + 代码质量评估         |
| `code-agent:fix`          | 修复代码   | 自动修复检测到的问题和漏洞          |
| `code-agent:scaffold`     | 项目脚手架 | 生成完整项目结构和配置文件          |
| `code-agent:configure-ci` | 配置 CI/CD | 自动生成 CI/CD 流水线配置           |
| `code-agent:analyze-git`  | Git 分析   | 分析 Git 历史、变更模式、贡献者统计 |
| `code-agent:explain`      | 代码解释   | 解释代码逻辑、算法和设计模式        |
| `code-agent:refactor`     | 代码重构   | 智能重构，优化代码结构和性能        |

## 使用示例

### 全栈代码生成

```javascript
const result = await window.electron.ipcRenderer.invoke("code-agent:generate", {
  description: "创建一个用户注册 API，包含邮箱验证和密码加密",
  language: "typescript",
  framework: "express",
  includeTests: true,
});
// result = { success: true, files: [{ path: "src/routes/auth.ts", content: "..." }, { path: "src/middleware/validate.ts", content: "..." }, { path: "tests/auth.test.ts", content: "..." }] }
```

### 安全代码审查

```javascript
const review = await window.electron.ipcRenderer.invoke("code-agent:review", {
  filePath: "src/controllers/user.js",
  checks: ["security", "quality", "performance"],
});
// review = { success: true, issues: [{ severity: "critical", type: "sql-injection", line: 42, message: "使用参数化查询替代字符串拼接", fix: "..." }, ...], score: 72 }
```

### 项目脚手架

```javascript
const scaffold = await window.electron.ipcRenderer.invoke(
  "code-agent:scaffold",
  {
    template: "vue", // react | vue | express | fastapi | spring-boot
    name: "my-dashboard",
    features: ["router", "pinia", "typescript", "tailwind"],
    outputDir: "/path/to/projects",
  },
);
// scaffold = { success: true, projectPath: "/path/to/projects/my-dashboard", files: 23, structure: { ... } }
```

### CI/CD 自动配置

```javascript
const ci = await window.electron.ipcRenderer.invoke("code-agent:configure-ci", {
  projectPath: "/path/to/my-project",
  platform: "github-actions", // github-actions | gitlab-ci | jenkins
  stages: ["lint", "test", "build", "deploy"],
  deployTarget: "docker",
});
// ci = { success: true, configFile: ".github/workflows/ci.yml", content: "..." }
```

### Git 上下文分析

```javascript
const git = await window.electron.ipcRenderer.invoke("code-agent:analyze-git", {
  repoPath: "/path/to/repo",
  analysis: ["history", "hotspots", "contributors"],
  branch: "main",
  since: "2026-01-01",
});
// git = { success: true, commits: 156, hotspots: [{ file: "src/index.js", changes: 42 }], contributors: [...] }
```

### 代码重构

```javascript
const refactor = await window.electron.ipcRenderer.invoke(
  "code-agent:refactor",
  {
    filePath: "src/utils/helpers.js",
    strategy: "extract-function", // extract-function | simplify | optimize | modernize
    description: "将重复的验证逻辑提取为独立函数",
  },
);
// refactor = { success: true, changes: [{ original: "...", refactored: "...", explanation: "提取了 validateEmail 和 validatePhone 函数" }] }
```

## 安全检测规则

Code Agent 2.0 内置以下安全检测：

| 检测类型     | 严重级别 | 说明                               |
| ------------ | -------- | ---------------------------------- |
| eval 注入    | Critical | 检测 `eval()` 和 `Function()` 使用 |
| SQL 注入     | Critical | 检测字符串拼接 SQL 查询            |
| XSS          | High     | 检测未转义的用户输入渲染           |
| 路径遍历     | High     | 检测未验证的文件路径操作           |
| 硬编码凭证   | High     | 检测代码中的密钥和密码             |
| 不安全的依赖 | Medium   | 检测已知漏洞的第三方包             |
| 命令注入     | Critical | 检测未过滤的 shell 命令执行        |

## 配置

在 `.chainlesschain/config.json` 中配置：

```json
{
  "codeAgent": {
    "enabled": true,
    "defaultLanguage": "typescript",
    "generation": {
      "model": "gpt-4",
      "temperature": 0.3,
      "includeTests": true,
      "includeComments": true
    },
    "review": {
      "autoReview": true,
      "securityChecks": [
        "eval",
        "sql-injection",
        "xss",
        "path-traversal",
        "hardcoded-secrets",
        "command-injection"
      ],
      "qualityThreshold": 70
    },
    "scaffold": {
      "defaultFeatures": ["typescript", "eslint", "prettier"],
      "templateDir": null
    },
    "cicd": {
      "defaultPlatform": "github-actions",
      "autoDetectLanguage": true
    }
  }
}
```

## 故障排除

| 问题             | 解决方案                             |
| ---------------- | ------------------------------------ |
| 代码生成质量低   | 提供更详细的描述，指定框架和约束条件 |
| 审查误报过多     | 调整安全检测规则，排除特定模式       |
| 脚手架模板缺失   | 检查模板目录配置，确认网络可用       |
| Git 分析超时     | 缩小分析时间范围，排除大型二进制文件 |
| CI/CD 配置不兼容 | 确认目标平台版本，检查部署目标配置   |

## 相关文档

- [自主开发者](/chainlesschain/autonomous-developer)
- [流水线编排](/chainlesschain/pipeline)
- [Cowork 多智能体协作](/chainlesschain/cowork)
