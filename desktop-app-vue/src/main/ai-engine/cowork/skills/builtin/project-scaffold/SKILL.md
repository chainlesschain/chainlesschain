---
name: project-scaffold
display-name: Project Scaffold
description: 项目脚手架技能 - 模块/页面/技能/IPC处理器的样板代码生成
version: 1.0.0
category: development
user-invocable: true
tags: [scaffold, template, boilerplate, generator, module, page, skill]
capabilities:
  [
    module-scaffolding,
    page-scaffolding,
    skill-scaffolding,
    ipc-scaffolding,
    convention-enforcement,
  ]
tools:
  - file_reader
  - file_writer
  - code_analyzer
handler: ./handler.js
instructions: |
  Use this skill when the user wants to create new modules, Vue pages, skills, or IPC
  handlers following the project's established conventions. Analyze existing code patterns
  to enforce consistent structure, naming, imports, and error handling. Generate complete
  boilerplate that matches the project's architecture.
examples:
  - input: "/project-scaffold skill 'file-converter' --category data --with-handler"
    output: "Created: builtin/file-converter/SKILL.md + handler.js with standard Agent Skills fields"
  - input: "/project-scaffold page 'AnalyticsDashboard' --store --route /analytics"
    output: "Created: pages/AnalyticsDashboardPage.vue + stores/analytics.ts + router entry"
  - input: "/project-scaffold ipc-module 'notification-manager' --handlers 5"
    output: "Created: notification-manager.js + notification-ipc.js with 5 handler stubs and error middleware"
os: [win32, darwin, linux]
author: ChainlessChain
---

# 项目脚手架技能

## 描述

按照项目约定自动生成新模块、Vue 页面、技能定义或 IPC 处理器的完整样板代码。分析现有代码模式确保风格一致。

## 使用方法

```
/project-scaffold <类型> <名称> [选项]
```

## 脚手架类型

### 新技能

```
/project-scaffold skill <name> [--category <cat>] [--with-handler]
```

生成:

- `builtin/<name>/SKILL.md` - Agent Skills 标准格式
- `builtin/<name>/handler.js` - 可选的执行处理器

### 新 Vue 页面

```
/project-scaffold page <name> [--store] [--route <path>]
```

生成:

- `pages/<Name>Page.vue` - Vue 3 Composition API + Ant Design Vue
- `stores/<name>.ts` - Pinia TypeScript Store（可选）
- 路由注册（router/index.ts 追加）
- 菜单项（MainLayout.vue 追加）

### 新 IPC 模块

```
/project-scaffold ipc-module <name> [--handlers <n>]
```

生成:

- `src/main/<name>/<name>.js` - 主逻辑模块
- `src/main/<name>/<name>-ipc.js` - IPC 处理器（含错误中间件）
- `ipc-registry.js` 注册条目

### 新 API 端点

```
/project-scaffold api-endpoint <name> [--method GET|POST|PUT|DELETE]
```

生成:

- Spring Boot Controller + Service + Repository
- 或 FastAPI Router + Schema

## 遵循的项目约定

| 约定       | 规则                                  |
| ---------- | ------------------------------------- |
| 文件命名   | kebab-case (如 `session-manager.js`)  |
| 类命名     | PascalCase (如 `SessionManager`)      |
| IPC 通道   | `module:action` (如 `audit:get-logs`) |
| 页面组件   | `<Name>Page.vue`                      |
| Store 文件 | `<name>.ts` (TypeScript)              |
| 错误处理   | IPC Error Handler 中间件              |
| 日志       | `logger.info/warn/error` 格式         |

## 示例

创建新技能:

```
/project-scaffold skill "file-converter" --category data --with-handler
```

创建新页面:

```
/project-scaffold page "AnalyticsDashboard" --store --route /analytics
```

创建新 IPC 模块:

```
/project-scaffold ipc-module "notification-manager" --handlers 5
```
