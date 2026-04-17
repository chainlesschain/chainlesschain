# Phase 86 — 代码生成Agent 2.0设计

**版本**: v4.1.0
**创建日期**: 2026-03-10
**状态**: ✅ 已实现 (v4.1.0) | CLI Phase 86 ✅

---

## 一、模块概述

Phase 86 实现代码生成Agent 2.0，支持全栈代码生成、安全代码审查（含eval检测）、多框架脚手架生成（React/Vue/Express/FastAPI/Spring Boot）和CI/CD配置生成。

### 1.1 核心目标

1. **全栈生成**: 根据自然语言需求生成前端+后端+数据库完整代码
2. **安全审查**: 代码审查含eval/injection/XSS等安全漏洞检测
3. **脚手架生成**: 5种框架模板（React, Vue, Express, FastAPI, Spring Boot）
4. **CI/CD配置**: 自动生成GitHub Actions/GitLab CI/Jenkins配置
5. **智能重构**: 基于代码质量分析的自动重构建议和执行

### 1.2 技术架构

```
┌──────────────────────────────────────────────────┐
│           Code Generator Agent 2.0               │
│                                                  │
│  ┌───────────────────┐  ┌──────────────────────┐ │
│  │ FullStackGenerator│  │ SecurityReviewer     │ │
│  │ 需求→设计→实现    │  │ eval/XSS/注入检测   │ │
│  │ 前端+后端+数据库  │  │ OWASP规则+自定义    │ │
│  └───────────────────┘  └──────────────────────┘ │
│  ┌───────────────────┐  ┌──────────────────────┐ │
│  │ ScaffoldBuilder   │  │ CICDConfigurator     │ │
│  │ React/Vue/Express │  │ GitHub Actions       │ │
│  │ FastAPI/SpringBoot│  │ GitLab CI/Jenkins    │ │
│  └───────────────────┘  └──────────────────────┘ │
│  ┌──────────────────────────────────────────────┐ │
│  │ GitAnalyzer — 仓库分析+历史洞察             │ │
│  └──────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────┐ │
│  │      Code Agent IPC Layer (8 handlers)       │ │
│  └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

---

## 二、核心模块设计

### 2.1 CodeGeneratorV2 (`ai-engine/code-agent/code-generator-v2.js`)

代码生成Agent 2.0主模块。

**常量**:

- `SCAFFOLD_TEMPLATE`: REACT, VUE, EXPRESS, FASTAPI, SPRING_BOOT
- `REVIEW_SEVERITY`: CRITICAL, HIGH, MEDIUM, LOW, INFO
- `SECURITY_RULE`: EVAL_DETECTION, SQL_INJECTION, XSS, PATH_TRAVERSAL, COMMAND_INJECTION
- `CICD_PLATFORM`: GITHUB_ACTIONS, GITLAB_CI, JENKINS

**核心方法**:

- `initialize(deps)` — 初始化Agent，加载模板和安全规则
- `generate({ prompt, language, framework, context })` — 全栈代码生成
- `review({ code, language, securityLevel })` — 代码审查（含安全漏洞检测）
- `fix({ code, issues, autoApply })` — 自动修复审查发现的问题
- `scaffold({ template, projectName, options })` — 生成项目脚手架
- `configureCI({ platform, projectType, branches, testCommand })` — 生成CI/CD配置
- `analyzeGit({ repoPath, branch, depth })` — 分析Git仓库历史和模式
- `explain({ code, language, detailLevel })` — 代码解释
- `refactor({ code, language, strategy, targetMetrics })` — 智能重构
- `_detectEvalUsage(code)` — 检测eval/Function/setTimeout字符串执行
- `_detectInjection(code, language)` — 检测注入漏洞
- `_generateScaffoldFiles(template, options)` — 生成脚手架文件树
- `destroy()` — 销毁Agent

### 2.2 CodeAgentIPC (`ai-engine/code-agent/code-agent-ipc.js`)

IPC通道注册和参数校验。

---

## 三、数据库设计

```sql
-- Phase 86: Code Generator Agent 2.0
CREATE TABLE IF NOT EXISTS code_generations (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  language TEXT,
  framework TEXT,
  generated_code TEXT,
  file_count INTEGER DEFAULT 0,
  token_count INTEGER DEFAULT 0,
  metadata TEXT,                -- JSON: context, model used
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS code_reviews (
  id TEXT PRIMARY KEY,
  generation_id TEXT,
  code_hash TEXT,
  language TEXT,
  issues_found INTEGER DEFAULT 0,
  security_issues INTEGER DEFAULT 0,
  severity_summary TEXT,        -- JSON: { critical: 0, high: 0, ... }
  issues_detail TEXT,           -- JSON array of issues
  reviewed_at INTEGER
);

CREATE TABLE IF NOT EXISTS code_scaffolds (
  id TEXT PRIMARY KEY,
  template TEXT NOT NULL,
  project_name TEXT,
  options TEXT,                 -- JSON: configuration options
  files_generated INTEGER DEFAULT 0,
  output_path TEXT,
  created_at INTEGER
);
```

---

## 四、IPC接口设计

### Phase 86 — CodeAgentIPC (8 handlers)

| 通道                      | 说明           |
| ------------------------- | -------------- |
| `code-agent:generate`     | 全栈代码生成   |
| `code-agent:review`       | 代码审查       |
| `code-agent:fix`          | 自动修复问题   |
| `code-agent:scaffold`     | 生成项目脚手架 |
| `code-agent:configure-ci` | 生成CI/CD配置  |
| `code-agent:analyze-git`  | 分析Git仓库    |
| `code-agent:explain`      | 代码解释       |
| `code-agent:refactor`     | 智能重构       |

---

## 五、前端集成

### Pinia Stores

- `codeAgent.ts` — 生成历史、审查结果、脚手架模板、CI/CD配置

### Vue Pages

- `CodeAgentPage.vue` — 代码生成/审查/脚手架/CI配置/Git分析/重构

### Routes

- `/code-agent` — 代码生成Agent

---

## 六、配置选项

```javascript
codeAgent: {
  enabled: false,
  defaultLanguage: 'javascript',
  securityLevel: 'high',
  maxGenerationTokens: 8000,
  evalDetectionEnabled: true,
  scaffoldOutputDir: './generated',
  supportedFrameworks: ['react', 'vue', 'express', 'fastapi', 'spring-boot'],
},
```

---

## 七、测试覆盖

**测试文件**: `src/main/ai-engine/code-agent/__tests__/code-generator-v2.test.js`
**测试数量**: 21 tests

| 分类          | 数量 | 说明                                           |
| ------------- | ---- | ---------------------------------------------- |
| 初始化        | 2    | Agent初始化、模板加载                          |
| 代码生成      | 4    | 单文件生成、全栈生成、上下文感知、多语言       |
| 安全审查      | 5    | eval检测、SQL注入、XSS检测、路径遍历、综合扫描 |
| 自动修复      | 2    | 问题修复、修复验证                             |
| 脚手架        | 3    | React/Vue/Express模板、自定义选项、文件树生成  |
| CI/CD配置     | 2    | GitHub Actions生成、多平台支持                 |
| Git分析与重构 | 3    | 仓库模式分析、重构建议、代码解释               |

---

## 八、Context Engineering

- step 5.6: `setCodeAgentContext()` — 注入代码生成Agent上下文
