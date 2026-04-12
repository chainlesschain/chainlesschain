# 低代码/无代码平台

> **版本: v4.5.0 | 状态: ✅ 生产就绪 | 10 IPC Handlers | 2 数据库表 | Phase 93**

ChainlessChain 低代码/无代码平台提供可视化应用构建能力，支持拖拽式设计器、15 种内置组件（表单/表格/图表/仪表盘）、多种数据连接器（REST/GraphQL/Database/CSV）、应用发布与版本管理，以及多设备响应式布局，让非开发人员也能快速构建业务应用。

## 概述

低代码/无代码平台提供拖拽式可视化应用构建器，内置 15 种组件（表单/表格/图表/仪表盘等）和 4 种数据连接器（REST/GraphQL/Database/CSV），支持一键发布、版本回滚和 Desktop/Tablet/Mobile 三端响应式布局。系统通过 10 个 IPC 接口和 2 张数据表，让非开发人员也能快速构建和管理业务应用。

## 核心特性

- 🎨 **可视化应用构建器**: 拖拽式设计器，所见即所得，支持画布自由布局和栅格布局
- 🧩 **15 种内置组件**: Form、Input、Select、Table、Chart（Line/Bar/Pie）、Dashboard、Card、Modal、Tabs、List、Image、Button、Text、Container、Divider
- 🔌 **数据连接器**: REST API、GraphQL、SQLite/PostgreSQL 数据库直连、CSV/Excel 文件导入
- 🚀 **应用发布与版本管理**: 一键发布，支持版本回滚，发布历史完整追溯
- 📱 **多设备响应式**: 自动适配 Desktop、Tablet、Mobile 三种屏幕尺寸

## 系统架构

```
┌──────────────────────────────────────────────────┐
│              前端 (Vue3 可视化设计器)              │
│  ┌──────────┐  ┌───────────┐  ┌──────────────┐  │
│  │ 拖拽画布  │  │ 组件面板   │  │ 属性编辑器   │  │
│  └─────┬────┘  └─────┬─────┘  └──────┬───────┘  │
└────────┼─────────────┼───────────────┼───────────┘
         │             │               │
         ▼             ▼               ▼
┌──────────────────────────────────────────────────┐
│            IPC 通道 (lowcode:*)                   │
└──────────────────────┬───────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────┐
│             低代码引擎 (Main Process)             │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐ │
│  │ 应用管理器  │  │ 组件注册表  │  │ 数据连接器  │ │
│  └────────────┘  └────────────┘  └────────────┘ │
│  ┌────────────┐  ┌────────────┐                  │
│  │ 版本管理器  │  │ 发布引擎   │                  │
│  └────────────┘  └────────────┘                  │
└──────────────────────┬───────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────┐
│        SQLite (lowcode_apps / lowcode_datasources)│
└──────────────────────────────────────────────────┘
```

## 创建应用

```javascript
const result = await window.electron.ipcRenderer.invoke("lowcode:create-app", {
  name: "客户管理系统",
  description: "用于管理客户信息、跟进记录和销售漏斗",
  template: "crm", // blank | crm | dashboard | form | kanban
  theme: {
    primaryColor: "#1890ff",
    layout: "sidebar", // sidebar | topbar | blank
  },
  responsive: true,
});
// {
//   success: true,
//   appId: "app-20260310-001",
//   name: "客户管理系统",
//   version: "0.1.0",
//   pages: [{ id: "page-001", name: "首页", components: [...] }],
//   createdAt: 1710100000000
// }
```

## 保存设计

```javascript
const result = await window.electron.ipcRenderer.invoke("lowcode:save-design", {
  appId: "app-20260310-001",
  pages: [
    {
      id: "page-001",
      name: "客户列表",
      layout: "grid",
      components: [
        {
          type: "Table",
          id: "comp-001",
          props: {
            dataSource: "ds-customers",
            columns: [
              { title: "姓名", dataIndex: "name", sortable: true },
              { title: "邮箱", dataIndex: "email" },
              { title: "状态", dataIndex: "status", filterable: true },
            ],
            pagination: { pageSize: 20 },
          },
          position: { x: 0, y: 0, w: 12, h: 8 },
        },
        {
          type: "Chart",
          id: "comp-002",
          props: {
            chartType: "pie",
            dataSource: "ds-customers",
            dimension: "status",
            measure: "count",
          },
          position: { x: 0, y: 8, w: 6, h: 4 },
        },
      ],
    },
  ],
  autoSave: true,
});
// { success: true, saved: true, version: "0.1.0-draft", lastSavedAt: 1710100500000 }
```

## 预览应用

```javascript
const result = await window.electron.ipcRenderer.invoke("lowcode:preview", {
  appId: "app-20260310-001",
  device: "desktop", // desktop | tablet | mobile
  mockData: false,
});
// { success: true, previewUrl: "http://localhost:5173/preview/app-20260310-001", device: "desktop" }
```

## 发布应用

```javascript
const result = await window.electron.ipcRenderer.invoke("lowcode:publish", {
  appId: "app-20260310-001",
  version: "1.0.0",
  releaseNotes: "首次发布：客户列表、状态分布图、搜索过滤",
  access: "organization", // private | organization | public
});
// {
//   success: true,
//   publishId: "pub-001",
//   version: "1.0.0",
//   accessUrl: "/apps/app-20260310-001",
//   publishedAt: 1710200000000
// }
```

## 获取组件列表

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "lowcode:list-components",
  {
    category: "all", // all | input | display | chart | layout
  },
);
// {
//   success: true,
//   components: [
//     { type: "Form", category: "input", icon: "form", description: "表单容器，支持校验和提交" },
//     { type: "Input", category: "input", icon: "edit", description: "文本输入框" },
//     { type: "Select", category: "input", icon: "select", description: "下拉选择器" },
//     { type: "Table", category: "display", icon: "table", description: "数据表格，支持排序和过滤" },
//     { type: "Chart", category: "chart", icon: "chart", subtypes: ["line", "bar", "pie"] },
//     { type: "Dashboard", category: "layout", icon: "dashboard", description: "仪表盘布局" },
//     ... // 15 种组件
//   ]
// }
```

## 添加数据源

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "lowcode:add-datasource",
  {
    appId: "app-20260310-001",
    name: "客户数据",
    type: "rest", // rest | graphql | database | csv
    config: {
      url: "https://api.example.com/customers",
      method: "GET",
      headers: { Authorization: "Bearer {{token}}" },
      pagination: { type: "offset", pageParam: "page", sizeParam: "size" },
    },
    refreshInterval: 60000,
  },
);
// { success: true, datasourceId: "ds-customers", status: "connected", recordCount: 1523 }
```

## 测试数据源连接

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "lowcode:test-connection",
  {
    type: "database",
    config: {
      dialect: "postgresql",
      host: "localhost",
      port: 5432,
      database: "customers_db",
      username: "readonly",
      password: "***",
    },
  },
);
// { success: true, connected: true, latency: 23, tables: ["customers", "orders", "products"] }
```

## 获取版本列表

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "lowcode:get-versions",
  {
    appId: "app-20260310-001",
  },
);
// {
//   success: true,
//   versions: [
//     { version: "1.0.0", publishedAt: 1710200000000, releaseNotes: "首次发布", status: "active" },
//     { version: "0.1.0-draft", savedAt: 1710100500000, status: "draft" }
//   ]
// }
```

## 回滚版本

```javascript
const result = await window.electron.ipcRenderer.invoke("lowcode:rollback", {
  appId: "app-20260310-001",
  targetVersion: "1.0.0",
});
// { success: true, rolledBackTo: "1.0.0", previousVersion: "1.1.0" }
```

## 导出应用

```javascript
const result = await window.electron.ipcRenderer.invoke("lowcode:export", {
  appId: "app-20260310-001",
  format: "json", // json | zip | html
  includeData: false,
});
// { success: true, exportPath: "/exports/客户管理系统-v1.0.0.json", size: 245760 }
```

## IPC 接口完整列表

### 低代码平台操作（10 个）

| 通道                      | 功能         | 说明                             |
| ------------------------- | ------------ | -------------------------------- |
| `lowcode:create-app`      | 创建应用     | 支持 5 种模板快速创建            |
| `lowcode:save-design`     | 保存设计     | 保存页面布局和组件配置           |
| `lowcode:preview`         | 预览应用     | Desktop/Tablet/Mobile 三端预览   |
| `lowcode:publish`         | 发布应用     | 一键发布，支持访问权限控制       |
| `lowcode:list-components` | 获取组件列表 | 15 种内置组件分类检索            |
| `lowcode:add-datasource`  | 添加数据源   | REST/GraphQL/Database/CSV 连接器 |
| `lowcode:test-connection` | 测试连接     | 验证数据源连接状态和延迟         |
| `lowcode:get-versions`    | 获取版本列表 | 应用发布历史和版本记录           |
| `lowcode:rollback`        | 回滚版本     | 回滚到指定历史版本               |
| `lowcode:export`          | 导出应用     | JSON/ZIP/HTML 格式导出           |

## 数据库 Schema

**2 张核心表**:

| 表名                  | 用途       | 关键字段                          |
| --------------------- | ---------- | --------------------------------- |
| `lowcode_apps`        | 应用存储   | id, name, design, version, status |
| `lowcode_datasources` | 数据源配置 | id, app_id, type, config, status  |

### lowcode_apps 表

```sql
CREATE TABLE IF NOT EXISTS lowcode_apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  template TEXT,                       -- blank | crm | dashboard | form | kanban
  design TEXT NOT NULL,                -- JSON: 完整页面和组件布局
  version TEXT DEFAULT '0.1.0',
  status TEXT DEFAULT 'draft',         -- draft | published | archived
  access TEXT DEFAULT 'private',       -- private | organization | public
  theme TEXT,                          -- JSON: 主题配置
  responsive INTEGER DEFAULT 1,
  published_versions TEXT,             -- JSON: 发布版本历史
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_lowcode_app_name ON lowcode_apps(name);
CREATE INDEX IF NOT EXISTS idx_lowcode_app_status ON lowcode_apps(status);
```

### lowcode_datasources 表

```sql
CREATE TABLE IF NOT EXISTS lowcode_datasources (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,                  -- rest | graphql | database | csv
  config TEXT NOT NULL,                -- JSON: 连接配置（加密存储）
  refresh_interval INTEGER DEFAULT 0,
  status TEXT DEFAULT 'connected',     -- connected | disconnected | error
  record_count INTEGER DEFAULT 0,
  last_synced_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_lowcode_ds_app ON lowcode_datasources(app_id);
CREATE INDEX IF NOT EXISTS idx_lowcode_ds_type ON lowcode_datasources(type);
```

## 配置

在 `.chainlesschain/config.json` 中配置：

```json
{
  "lowCodePlatform": {
    "enabled": true,
    "designer": {
      "autoSave": true,
      "autoSaveInterval": 30000,
      "gridSize": 8,
      "snapToGrid": true,
      "maxComponentsPerPage": 100
    },
    "components": {
      "builtinEnabled": true,
      "customComponentsDir": "./custom-components",
      "chartLibrary": "echarts"
    },
    "datasource": {
      "maxConnections": 10,
      "defaultTimeout": 30000,
      "encryptCredentials": true,
      "allowedTypes": ["rest", "graphql", "database", "csv"]
    },
    "publishing": {
      "defaultAccess": "private",
      "maxVersions": 50,
      "autoBackup": true
    }
  }
}
```

## 故障排除

| 问题             | 解决方案                                |
| ---------------- | --------------------------------------- |
| 数据源连接失败   | 使用 test-connection 检查网络和凭证配置 |
| 组件拖拽无响应   | 检查浏览器兼容性，确保启用硬件加速      |
| 发布后页面空白   | 确认数据源已配置且状态为 connected      |
| 响应式布局异常   | 检查组件 position 配置，避免重叠        |
| 版本回滚数据丢失 | 回滚仅影响设计，数据源数据不受影响      |

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/main/enterprise/low-code-platform.js` | 低代码引擎核心，应用 CRUD 与发布逻辑 |
| `src/main/enterprise/low-code-components.js` | 15 种内置组件注册与属性校验 |
| `src/main/enterprise/low-code-datasource.js` | REST/GraphQL/Database/CSV 数据连接器 |
| `src/renderer/stores/lowCode.ts` | Pinia 状态管理 |
| `src/renderer/pages/LowCodeDesigner.vue` | 可视化拖拽设计器页面 |

## 故障排查

### 常见问题

| 症状 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 组件渲染异常显示空白 | 组件版本不兼容或属性绑定错误 | 检查组件版本兼容性，验证 props 绑定表达式 |
| 数据源连接超时 | 数据库地址配置错误或防火墙拦截 | 执行 `lowcode datasource-test`，检查网络连通性 |
| 版本回滚失败 | 目标版本快照已过期或存储损坏 | 查看可用快照列表 `lowcode snapshot-list`，使用最近快照 |
| 表单提交数据丢失 | 字段映射不完整或验证规则拦截 | 检查字段映射配置，查看验证错误日志 |
| 页面发布后样式错乱 | CSS 作用域冲突或资源路径错误 | 启用 CSS 模块隔离，检查静态资源路径 |

### 常见错误修复

**错误: `COMPONENT_RENDER_FAILED` 组件渲染失败**

```bash
# 检查组件兼容性
chainlesschain lowcode component-check --app-id <id>

# 重新构建应用
chainlesschain lowcode build --app-id <id> --clean
```

**错误: `DATASOURCE_TIMEOUT` 数据源连接超时**

```bash
# 测试数据源连通性
chainlesschain lowcode datasource-test --source-id <id>

# 更新数据源配置
chainlesschain lowcode datasource-config --source-id <id> --timeout 30s
```

**错误: `ROLLBACK_FAILED` 版本回滚失败**

```bash
# 列出可用版本快照
chainlesschain lowcode snapshot-list --app-id <id>

# 回滚到指定快照版本
chainlesschain lowcode rollback --app-id <id> --snapshot <version>
```

## 安全考虑

### 数据源安全
- **凭证加密存储**: 数据源连接配置中的密码、Token 等敏感信息通过 SQLCipher 加密存储（`encryptCredentials: true`），切勿在日志中输出连接配置
- **最小权限连接**: 数据库数据源建议使用只读账号连接（如 `readonly` 用户），避免低代码应用意外修改或删除源数据
- **网络访问控制**: REST/GraphQL 数据源的 URL 应限制为可信域名，防止 SSRF（服务端请求伪造）攻击

### 应用访问控制
- **发布权限**: 应用发布支持三级访问控制（`private`/`organization`/`public`），默认 `private` 仅创建者可见
- **数据隔离**: 不同应用的数据源相互隔离，跨应用数据访问需要显式授权
- **版本回滚审计**: 所有版本发布和回滚操作记录完整审计日志，支持追溯变更历史

### 组件安全
- **输入校验**: 表单组件应配置输入校验规则（长度限制、格式校验、XSS 过滤），防止用户提交恶意数据
- **自定义表达式沙箱**: Pipeline 中的 JavaScript 表达式在沙箱环境中执行，禁止访问 `process`、`require` 等 Node.js API
- **模板注入防护**: 组件模板渲染使用安全的模板引擎，自动转义 HTML 特殊字符，防止 XSS 攻击

### 导出安全
- **导出脱敏**: 导出应用时可选择 `includeData: false` 仅导出设计结构，避免敏感业务数据随导出文件泄露
- **导入验证**: 导入外部应用模板时自动校验 JSON 结构完整性和组件类型合法性，拒绝包含未知组件的模板

## 使用示例

### 快速创建应用

```bash
# 1. 使用 CRM 模板创建应用
# IPC: lowcode:create-app { name: "客户管理", template: "crm" }

# 2. 配置表格组件的数据源
# IPC: lowcode:add-datasource { appId, type: "rest", config: { url: "https://api.example.com/customers" } }

# 3. 测试数据源连接是否正常
# IPC: lowcode:test-connection { type: "rest", config: { url: "..." } }

# 4. 预览应用 → 确认无误后发布
# IPC: lowcode:preview { appId, device: "desktop" }
# IPC: lowcode:publish { appId, version: "1.0.0", access: "organization" }
```

### 组件配置要点

- **Table 组件**: `dataSource` 需指向已添加的数据源 ID，`columns` 的 `dataIndex` 应与 API 返回字段名一致
- **Chart 组件**: `chartType` 支持 `line`/`bar`/`pie`，`dimension` 为分组字段，`measure` 为聚合方式（count/sum/avg）
- **Form 组件**: 配置 `validation` 规则实现输入校验，`onSubmit` 可绑定数据源的 POST 操作

### 数据源连接排查

| 现象 | 排查步骤 |
|------|---------|
| 渲染失败/页面空白 | 1. 确认组件绑定的 `dataSource` ID 存在且状态为 `connected` 2. 检查 API 返回的字段名与组件 `columns` 配置是否匹配 3. 使用浏览器开发者工具查看控制台错误 |
| 数据源连接错误 | 1. 使用 `lowcode:test-connection` 单独测试连接 2. 检查 URL、凭证、网络代理配置 3. 数据库类型确认端口和防火墙设置 |
| REST 数据源返回空 | 确认 `pagination` 配置与 API 分页参数一致（`pageParam`/`sizeParam`），检查 `Authorization` 头是否有效 |

## 相关文档

- [企业知识图谱](/chainlesschain/enterprise-knowledge-graph)
- [BI 智能分析](/chainlesschain/bi-engine)
- [Cowork 多智能体协作](/chainlesschain/cowork)
