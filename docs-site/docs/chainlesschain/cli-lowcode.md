# 低代码平台 (lowcode)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 🏗️ **JSON Schema 驱动**: 以声明式 JSON 定义应用结构和交互逻辑
- 🧩 **15+ 内置组件**: Form、Button、DataTable、Chart、Modal、Tabs 等常用 UI 组件
- 🔌 **数据源连接**: 支持 SQLite、REST API、GraphQL 等多种数据源
- 📸 **版本控制**: 应用快照机制，支持任意版本回滚
- 🌐 **多平台部署**: Web / Desktop / Mobile / All 四种平台部署配置
- 📦 **应用导出**: 导出为独立可运行的应用包

## 概述

ChainlessChain CLI 低代码平台允许通过 JSON Schema 快速构建数据驱动的应用。每个应用由页面、组件和数据源三部分组成。页面包含组件的布局和交互定义，组件提供 UI 渲染能力，数据源提供后端数据接入。

平台内置 15 种以上常用组件，涵盖表单输入、数据展示、交互控制等场景。每次保存设计时自动创建版本快照，支持回滚到任意历史版本。应用可配置为 Web、Desktop、Mobile 或全平台部署，导出后可作为独立应用运行。

## 命令参考

### lowcode create — 创建应用

```bash
chainlesschain lowcode create <name>
chainlesschain lowcode create "任务管理" --description "团队任务追踪应用"
chainlesschain lowcode create "CRM" --platform desktop --json
chainlesschain lowcode create "Survey" --platform mobile
```

创建新的低代码应用。`--platform` 指定目标平台（web / desktop / mobile / all，默认 web）。

### lowcode list — 列出应用

```bash
chainlesschain lowcode list
chainlesschain lowcode list --json
```

显示所有已创建的低代码应用及其状态、平台、版本信息。

### lowcode preview — 预览应用

```bash
chainlesschain lowcode preview <app-id>
chainlesschain lowcode preview app-001 --json
```

预览指定应用的当前设计，返回完整的页面结构和组件配置。

### lowcode publish — 发布应用

```bash
chainlesschain lowcode publish <app-id>
chainlesschain lowcode publish app-001 --json
```

发布指定应用，将其状态从 draft 变为 published，生成可访问的应用入口。

### lowcode components — 列出组件

```bash
chainlesschain lowcode components
chainlesschain lowcode components --json
```

列出所有可用的内置组件及其属性定义和使用说明。

### lowcode datasource — 添加数据源

```bash
chainlesschain lowcode datasource <app-id> --name "main-db" --type sqlite --config '{"path":"data.db"}'
chainlesschain lowcode datasource <id> --name "api" --type rest --config '{"baseUrl":"https://api.example.com"}'
chainlesschain lowcode datasource <id> --name "graph" --type graphql --config '{"endpoint":"https://gql.example.com"}'
```

为指定应用添加数据源连接。支持 sqlite、rest、graphql 三种类型。

### lowcode versions — 查看版本历史

```bash
chainlesschain lowcode versions <app-id>
chainlesschain lowcode versions app-001 --json
```

显示指定应用的所有版本快照，包括版本号、创建时间、变更摘要。

### lowcode rollback — 版本回滚

```bash
chainlesschain lowcode rollback <app-id> <version>
chainlesschain lowcode rollback app-001 3 --json
```

将应用回滚到指定版本，恢复该版本的页面结构和组件配置。

### lowcode export — 导出应用

```bash
chainlesschain lowcode export <app-id>
chainlesschain lowcode export app-001 --format json --json
```

导出应用的完整定义，包括页面、组件、数据源配置和资产文件。

### lowcode deploy — 部署应用

```bash
chainlesschain lowcode deploy <app-id>
chainlesschain lowcode deploy <app-id> --output ./dist
```

将已发布的应用部署为静态网站。生成 `index.html`、`app.js`、`style.css` 三个文件到输出目录。

**前置条件**: 应用必须先通过 `lowcode publish` 发布后才能部署。

**输出文件**:
- `index.html` — 包含组件布局的响应式 HTML 页面
- `app.js` — 应用逻辑和组件交互脚本
- `style.css` — 组件样式（Grid 布局、卡片式组件）

**默认输出目录**: `.chainlesschain/deploys/<app-id>/`

部署完成后应用状态自动更新为 `deployed`。

## 内置组件

| 组件 | 类型 | 说明 |
|------|------|------|
| `Form` | 输入 | 表单容器，支持验证规则 |
| `Input` | 输入 | 文本输入框（text / number / email / password） |
| `Select` | 输入 | 下拉选择器（单选/多选） |
| `DatePicker` | 输入 | 日期/日期时间选择器 |
| `Button` | 交互 | 按钮（submit / action / link） |
| `Modal` | 交互 | 弹窗对话框 |
| `Tabs` | 交互 | 标签页切换 |
| `DataTable` | 展示 | 数据表格（分页、排序、筛选） |
| `Chart` | 展示 | 图表（line / bar / pie / scatter） |
| `Card` | 展示 | 卡片容器 |
| `Text` | 展示 | 文本/富文本展示 |
| `Image` | 展示 | 图片展示 |
| `List` | 展示 | 列表展示 |
| `Badge` | 展示 | 状态徽标 |
| `Progress` | 展示 | 进度条 |

## 数据库表

| 表名 | 说明 |
|------|------|
| `lowcode_apps` | 应用定义（名称、描述、平台、状态、页面 Schema） |
| `lowcode_datasources` | 数据源配置（应用 ID、名称、类型、连接配置） |
| `lowcode_versions` | 版本快照（应用 ID、版本号、快照数据、创建时间） |

## 系统架构

```
用户命令 → lowcode.js (Commander) → app-builder.js
                                         │
                ┌───────────────────────┼───────────────────────┐
                ▼                       ▼                       ▼
          应用管理器              组件注册表              版本管理器
       (创建/发布/部署)       (15+ 内置组件)         (快照/回滚)
                │                       │                       │
                ▼                       ▼                       ▼
          lowcode_apps          组件属性定义          lowcode_versions
          lowcode_datasources
```

## 关键文件

- `packages/cli/src/commands/lowcode.js` — 命令实现
- `packages/cli/src/lib/app-builder.js` — 低代码应用构建库

## 使用示例

### 场景 1：创建和设计应用

```bash
# 创建一个新应用
chainlesschain lowcode create --name "CRM Dashboard" \
  --description "客户关系管理仪表板"

# 查看所有可用组件
chainlesschain lowcode components

# 保存应用设计（自动创建版本快照）
chainlesschain lowcode preview <app-id>

# 发布应用
chainlesschain lowcode publish <app-id>
```

### 场景 2：数据源连接

```bash
# 添加 REST API 数据源
chainlesschain lowcode datasource add <app-id> \
  --name "User API" \
  --type rest \
  --config '{"url":"https://api.example.com/users","method":"GET"}'

# 添加数据库数据源
chainlesschain lowcode datasource add <app-id> \
  --name "Sales DB" \
  --type database \
  --config '{"host":"localhost","port":5432,"database":"sales"}'
```

### 场景 3：版本管理与回滚

```bash
# 查看应用的版本历史
chainlesschain lowcode versions <app-id>

# 回滚到指定版本
chainlesschain lowcode rollback <app-id> --version 2

# 导出应用为 JSON
chainlesschain lowcode export <app-id> -o ./my-app.json

# 查看所有应用
chainlesschain lowcode list --json
```

## 故障排查

### 应用创建与发布问题

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| "App not found" | app-id 不存在 | 使用 `lowcode list` 查看可用应用 |
| 发布失败 | 应用未保存设计 | 先 `lowcode preview` 保存设计后再发布 |
| 数据源连接失败 | 配置参数错误 | 检查 `--config` 中的 URL、端口、认证信息 |
| 回滚版本不存在 | 指定版本号超出范围 | 使用 `lowcode versions <app-id>` 查看有效版本 |
| 组件不显示 | 组件名拼写错误 | 使用 `lowcode components` 查看 15 个内置组件的正确名称 |

### 常见错误

```bash
# 错误: "No versions found for app"
# 原因: 应用创建后未保存过设计
# 修复: 先保存设计
chainlesschain lowcode preview <app-id>

# 错误: "Data source type not supported"
# 原因: 使用了不支持的数据源类型
# 修复: 支持的类型有 rest, graphql, database, csv

# 错误: "Version rollback failed"
# 原因: 目标版本不存在
# 修复:
chainlesschain lowcode versions <app-id>
```

## 安全考虑

- **数据源凭证保护**: 数据源连接配置中的密码、API Key 等敏感信息存储在加密数据库中
- **组件沙箱**: 自定义组件运行在受限环境中，无法访问文件系统或执行系统调用
- **版本不可篡改**: 每个版本快照以 JSON 形式存储，历史版本不可修改，仅可追加新版本
- **发布权限控制**: 应用发布操作应结合 RBAC 权限系统，限制只有授权用户可以发布到生产环境
- **导出数据脱敏**: `lowcode export` 默认不导出数据源凭证，仅导出结构定义
- **输入验证**: Form 组件内置字段验证规则，防止前端注入攻击

## 相关文档

- [BI 引擎](./cli-bi) — 数据分析与仪表盘
- [工作流引擎](./cli-workflow) — 业务流程编排
- [A2A 协议](./cli-a2a) — 智能体驱动的自动化应用
