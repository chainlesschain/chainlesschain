# 代码生成 Agent 2.0

> **版本: v4.1.0 | 状态: ✅ 生产就绪 | 8 IPC Handlers | Phase 86**

## 概述

代码生成 Agent 2.0 是 ChainlessChain 的智能编程助手，能够根据自然语言描述生成多语言全栈代码，并集成 Git 感知上下文和实时安全审查能力。支持 JavaScript、TypeScript、Python、Java、Go、Rust 六种语言，提供项目脚手架生成和 CI/CD 自动配置功能。

## 核心特性

- 🏗️ **全栈代码生成**: 根据自然语言描述生成前后端完整代码，支持多种框架
- 🔍 **Git 感知上下文**: 分析 Git 历史、分支、变更，理解项目演进上下文
- 🛡️ **实时代码审查**: 检测 eval 注入、SQL 注入、XSS 等安全漏洞，实时报告风险
- 📦 **项目脚手架**: 一键生成 React/Vue/Express/FastAPI/Spring Boot 项目模板
- ⚙️ **CI/CD 自动配置**: 根据项目类型自动生成 GitHub Actions/GitLab CI 配置
- 🌐 **多语言支持**: JavaScript、TypeScript、Python、Java、Go、Rust

## 系统架构

```
┌─────────────────────────────────────────────────┐
│            代码生成 Agent 2.0 引擎               │
├─────────────────────────────────────────────────┤
│  自然语言描述  →  意图解析  →  代码生成器        │
│                      ↓                          │
│  ┌───────────┐ ┌──────────┐ ┌────────────────┐  │
│  │ Git 感知  │ │ 安全审查 │ │ 项目脚手架     │  │
│  │ 上下文    │ │ 漏洞检测 │ │ 模板生成       │  │
│  └─────┬─────┘ └────┬─────┘ └───────┬────────┘  │
│        └─────────────┼───────────────┘           │
│                      ↓                          │
│  ┌──────────────────────────────────────┐       │
│  │  CI/CD 配置生成 | 代码重构 | 代码解释 │       │
│  └──────────────────────────────────────┘       │
├─────────────────────────────────────────────────┤
│  LLM 层: GPT-4 / Claude / 本地模型             │
└─────────────────────────────────────────────────┘
```

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

### 代码生成错误或质量差

**现象**: 生成的代码存在语法错误、逻辑缺陷或不符合项目规范。

**排查步骤**:
1. 在 `description` 中明确指定语言版本、框架和目标环境（如 `TypeScript 5.x + Express 4`）
2. 降低 `generation.temperature` 配置值（建议 0.1-0.3）提高生成稳定性
3. 开启 `includeTests: true` 让系统同时生成测试用例以验证生成质量
4. 使用 `code-agent:review` 对生成的代码进行安全审查和质量评估

### Git 冲突处理

**现象**: `code-agent:analyze-git` 或代码重构操作遇到 Git 合并冲突。

**排查步骤**:
1. 确认当前分支是否有未提交的更改，建议先 commit 或 stash
2. `code-agent:analyze-git` 为只读操作，不会修改仓库历史
3. 代码重构前建议创建新分支，避免在主分支上直接修改
4. 缩小 `since` 时间范围以减少分析的提交量

### 脚手架生成失败

**现象**: `code-agent:scaffold` 返回失败或生成的项目结构不完整。

**排查步骤**:
1. 确认 `outputDir` 路径存在且有写入权限
2. 检查 `template` 值是否为支持的模板之一（react/vue/express/fastapi/spring-boot）
3. 确认 `features` 数组中的特性名称拼写正确且彼此兼容
4. 若涉及网络下载（npm 或模板），检查网络连接和代理配置

## 故障排查

### 常见问题

| 症状 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 代码生成语法错误 | LLM 输出不规范或目标语言版本不匹配 | 启用 `syntaxValidation`，指定语言版本参数 |
| Git 冲突导致提交失败 | 自动生成代码与已有代码冲突 | 执行 `git status` 检查冲突文件，手动合并后重试 |
| 脚手架模板缺失 | 模板目录未初始化或模板名称拼写错误 | 运行 `agent template-list` 确认模板，执行 `template-sync` |
| 代码审查超时 | 文件过大或审查规则过于复杂 | 拆分大文件，减少同时审查的规则数量 |
| 测试生成覆盖率低 | 源代码复杂度高或函数缺少类型注释 | 添加 JSDoc/TypeScript 类型标注，提高可分析性 |

### 常见错误修复

**错误: `SYNTAX_VALIDATION_FAILED` 生成代码语法不通过**

```bash
# 重新生成并启用严格语法校验
chainlesschain agent code-gen --file <path> --strict-syntax

# 使用指定语言版本
chainlesschain agent code-gen --file <path> --lang-version es2022
```

**错误: `GIT_CONFLICT` 自动提交冲突**

```bash
# 查看冲突文件
chainlesschain git status

# 以交互模式解决冲突
chainlesschain git resolve --interactive
```

**错误: `TEMPLATE_NOT_FOUND` 脚手架模板不存在**

```bash
# 列出可用模板
chainlesschain agent template-list

# 同步远程模板仓库
chainlesschain agent template-sync --source official
```

## 配置参考

在 `.chainlesschain/config.json` 中可调整以下 Code Agent 2.0 参数：

| 配置键 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `codeAgent.enabled` | boolean | `true` | 是否启用 Code Agent 2.0 |
| `codeAgent.defaultLanguage` | string | `"typescript"` | 默认代码生成语言 |
| `codeAgent.generation.model` | string | `"gpt-4"` | 代码生成使用的 LLM 模型 |
| `codeAgent.generation.temperature` | number | `0.3` | 生成随机性（0=确定，1=随机） |
| `codeAgent.generation.includeTests` | boolean | `true` | 是否随代码同步生成测试文件 |
| `codeAgent.generation.includeComments` | boolean | `true` | 是否在生成代码中添加注释 |
| `codeAgent.review.autoReview` | boolean | `true` | 生成后自动执行安全审查 |
| `codeAgent.review.qualityThreshold` | number | `70` | 代码质量评分合格阈值（0-100） |
| `codeAgent.review.securityChecks` | string[] | 见配置示例 | 启用的安全检测项列表 |
| `codeAgent.scaffold.defaultFeatures` | string[] | `["typescript","eslint","prettier"]` | 脚手架默认特性包 |
| `codeAgent.scaffold.templateDir` | string\|null | `null` | 自定义模板目录（null 使用内置） |
| `codeAgent.cicd.defaultPlatform` | string | `"github-actions"` | 默认 CI/CD 平台 |
| `codeAgent.cicd.autoDetectLanguage` | boolean | `true` | 是否根据项目自动检测语言 |

> **类别路由提示**: `generation.model` 支持类别别名（如 `"deep"`、`"reasoning"`），运行时由 LLM Manager 映射到已配置的最优 Provider。详见 [LLM 类别路由](/chainlesschain/llm-manager#category-routing)。

## 性能指标

以下基准数据基于 GPT-4 / Claude Sonnet 模型，运行于本地 Electron 主进程：

| 操作 | 典型耗时 | P95 耗时 | 说明 |
| --- | --- | --- | --- |
| 代码生成（单文件，<200 行） | 3–8 s | 15 s | 含 LLM 推理和语法验证 |
| 代码生成（含测试，多文件） | 8–20 s | 35 s | 额外生成测试套件 |
| 代码审查（<500 行） | 2–5 s | 10 s | 7 类安全规则并行扫描 |
| 代码重构（提取函数） | 3–8 s | 12 s | AST 分析 + LLM 重写 |
| 项目脚手架（React/Vue） | 5–12 s | 20 s | 模板渲染 + 文件写入 |
| CI/CD 配置生成 | 2–5 s | 8 s | 根据语言类型选模板 |
| Git 上下文分析（近 30 天） | 1–3 s | 6 s | 本地 git log 解析，无 LLM |
| 代码解释（<300 行） | 3–6 s | 10 s | 含 LLM 语义理解 |

**资源占用参考**（桌面端 Electron 主进程）：

- **内存**: 生成任务峰值约 80–150 MB（含 LLM 响应缓冲区）
- **CPU**: 代码审查阶段静态分析约 20–40%（单核），LLM 推理阶段主要消耗在远端/本地模型侧
- **磁盘 I/O**: 脚手架生成写入约 50–200 个文件，视模板复杂度而定

> **优化建议**: 对大型项目使用 `since` 参数限制 Git 分析范围；降低 `temperature`（建议 0.1–0.3）可显著减少 LLM 重试次数，提升平均生成速度。

## 测试覆盖率

Code Agent 2.0 测试套件覆盖核心生成、审查、脚手架和 CI/CD 流程：

| 测试文件 | 用例数 | 覆盖范围 |
| --- | --- | --- |
| `code-agent-v2.test.js` | 38 | IPC 入口、参数校验、错误处理 |
| `code-generator.test.js` | 45 | 6 种语言生成、多框架脚手架输出 |
| `security-reviewer.test.js` | 52 | 7 类漏洞检测、误报率、评分算法 |
| `scaffold-manager.test.js` | 29 | 5 种模板、feature 组合、文件写入 |
| `cicd-configurator.test.js` | 24 | 3 平台配置生成、环境变量替换 |
| `git-analyzer.test.js` | 31 | 历史解析、热点文件、贡献者统计 |
| **合计** | **219** | **核心模块全覆盖** |

运行方式：

```bash
cd desktop-app-vue
npx vitest run tests/unit/ai-engine/code-agent/
```

关键覆盖指标：

- **语句覆盖率**: ≥ 85%（核心生成和审查路径）
- **安全规则覆盖**: 7/7 漏洞类型均有阳性 + 阴性用例
- **错误路径**: LLM 超时、语法验证失败、文件写入权限错误均有独立用例

## 安全考虑

- **代码审查强制化**: 生成的代码默认触发安全审查，检测注入、XSS 等 7 类漏洞
- **沙箱执行**: 生成的代码在沙箱环境中运行测试，不直接操作宿主文件系统
- **凭证过滤**: 代码生成器自动过滤硬编码的密钥、密码和 API Token
- **Git 操作权限**: `analyze-git` 仅执行只读操作，不会修改仓库历史
- **脚手架安全**: 项目模板使用固定版本依赖，避免供应链攻击风险
- **CI/CD 配置审查**: 生成的 CI/CD 配置不包含明文凭证，敏感值使用环境变量引用

## 相关文档

- [自主开发者](/chainlesschain/autonomous-developer)
- [流水线编排](/chainlesschain/pipeline)
- [Cowork 多智能体协作](/chainlesschain/cowork)

## 关键文件

| 文件 | 说明 |
| --- | --- |
| `desktop-app-vue/src/main/ai-engine/code-agent/code-agent-v2.js` | Code Agent 2.0 核心引擎 |
| `desktop-app-vue/src/main/ai-engine/code-agent/code-generator.js` | 多语言代码生成器 |
| `desktop-app-vue/src/main/ai-engine/code-agent/security-reviewer.js` | 安全漏洞检测模块 |
| `desktop-app-vue/src/main/ai-engine/code-agent/scaffold-manager.js` | 项目脚手架管理器 |
| `desktop-app-vue/src/main/ai-engine/code-agent/cicd-configurator.js` | CI/CD 配置生成器 |
| `desktop-app-vue/src/main/ai-engine/code-agent/git-analyzer.js` | Git 上下文分析器 |
