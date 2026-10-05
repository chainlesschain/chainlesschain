# 低代码/无代码平台

> **Phase 93 设计模块 | 当前：设计持久化、版本管理与数据源配置**
>
> **源码能力校正（2026-10-06，本次修改未发布）**：此前 `v4.5.0 / 生产就绪` 为历史文档标记。数据源注册返回 `configured`，连通性探测返回 `unsupported / probed: false`；发布仅保存设计状态 `design-published`，返回 `deployed: false`。当前没有应用运行时部署或健康检查。

ChainlessChain 低代码模块提供应用设计、组件目录、设计保存、版本回滚与数据源配置。发布操作用于标记已发布的设计，不生成可访问的业务应用服务。

## 概述

设计器、数据源配置及版本快照可用于组织应用定义。REST/GraphQL/Database/CSV 类型描述配置用途；当前尚未接入真实数据查询或连通性探测。下文布局、运行时访问控制等配置保留为设计参考，不应据此判断应用已经部署。

## 核心特性

- 🎨 **可视化应用构建器**: 拖拽式设计器，所见即所得，支持画布自由布局和栅格布局
- 🧩 **15 种内置组件**: Form、Input、Select、Table、Chart（Line/Bar/Pie）、Dashboard、Card、Modal、Tabs、List、Image、Button、Text、Container、Divider
- 🔌 **数据源配置**: 保存 REST/GraphQL/Database/CSV 类型与配置；不返回虚构连通性或延迟
- 🚀 **设计发布与版本管理**: 保存 `design-published` 状态并支持设计版本回滚；未部署运行时
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
const result = await window.electron.ipcRenderer.invoke(
  "lowcode:preview",
  "app-20260310-001",
);
// { success: true, data: { appId: "app-20260310-001", design: {...},
//   status: "design-preview", deployed: false, ... } }
```

## 发布设计

此操作必须成功保存设计状态才返回成功。它不生成部署地址；旧 `published` 记录在加载时按 `design-published` 处理。

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "lowcode:publish",
  "app-20260310-001",
);
// {
//   success: true,
//   data: { appId: "app-20260310-001", status: "design-published", version: 1,
//     publicationKind: "design", deployed: false, runtimeStatus: "unsupported" }
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
// { success: true, data: { id: "ds-...", status: "configured", type: "rest", ... } }
```

## 测试数据源连接

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "lowcode:test-connection",
  "ds-...", // 使用 add-datasource 返回的 data.id
);
// { success: false, data: { success: false, status: "unsupported", configured: true,
//     probed: false, dataSourceId: "ds-...", type: "rest", error: "..." }, error: "..." }
// 未注册的 ID 返回 data.status: "not-found"；两种情况都没有发起网络探测
```

## 获取版本列表

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "lowcode:get-versions",
  "app-20260310-001",
);
// {
//   success: true,
//   data: [ { id: "ver-...", appId: "app-20260310-001", version: 2, snapshot: {...} }, ... ]
//   // 这是设计快照历史，不是部署历史
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

| 通道                      | 功能           | 说明                                                  |
| ------------------------- | -------------- | ----------------------------------------------------- |
| `lowcode:create-app`      | 创建应用       | 支持 5 种模板快速创建                                 |
| `lowcode:save-design`     | 保存设计       | 保存页面布局和组件配置                                |
| `lowcode:preview`         | 预览应用       | Desktop/Tablet/Mobile 三端预览                        |
| `lowcode:publish`         | 发布设计       | 参数为 appId 字符串；保存设计状态，deployed=false     |
| `lowcode:list-components` | 获取组件列表   | 15 种内置组件分类检索                                 |
| `lowcode:add-datasource`  | 添加数据源配置 | 返回 configured，未验证连通性                         |
| `lowcode:test-connection` | 查询探测能力   | 参数为 dataSourceId；当前 unsupported，不返回实测延迟 |
| `lowcode:get-versions`    | 获取版本列表   | 应用发布历史和版本记录                                |
| `lowcode:rollback`        | 回滚版本       | 回滚到指定历史版本                                    |
| `lowcode:export`          | 导出应用       | JSON/ZIP/HTML 格式导出                                |

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
  status TEXT DEFAULT 'draft',         -- draft | design-published | archived
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
  status TEXT DEFAULT 'configured',    -- 配置已登记，不代表已连接
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

| 问题               | 解决方案                                              |
| ------------------ | ----------------------------------------------------- |
| 数据源探测不可用   | 当前返回 unsupported / probed=false，未验证网络或凭证 |
| 组件拖拽无响应     | 检查浏览器兼容性，确保启用硬件加速                    |
| 发布后没有运行地址 | 当前仅发布设计，deployed=false；运行时部署尚未实现    |
| 响应式布局异常     | 检查组件 position 配置，避免重叠                      |
| 版本回滚数据丢失   | 回滚仅影响设计，数据源数据不受影响                    |

## 关键文件

| 文件                                          | 职责                                 |
| --------------------------------------------- | ------------------------------------ |
| `src/main/enterprise/low-code/app-builder.js` | 应用设计、数据源配置与设计发布       |
| `src/main/enterprise/low-code-components.js`  | 15 种内置组件注册与属性校验          |
| `src/main/enterprise/low-code-datasource.js`  | REST/GraphQL/Database/CSV 数据连接器 |
| `src/renderer/stores/lowCode.ts`              | Pinia 状态管理                       |
| `src/renderer/pages/LowCodeDesigner.vue`      | 可视化拖拽设计器页面                 |

## 故障排查

当前能力请先检查 `status`、`probed` 与 `deployed`。下面关于真实 API、数据库连接和运行页面的故障示例保留为接入目标参考，不表示现有模块已经执行这些操作。

### 常见问题

| 症状                 | 可能原因                       | 解决方案                                               |
| -------------------- | ------------------------------ | ------------------------------------------------------ |
| 组件渲染异常显示空白 | 组件版本不兼容或属性绑定错误   | 检查组件版本兼容性，验证 props 绑定表达式              |
| 数据源连接超时       | 数据库地址配置错误或防火墙拦截 | 执行 `lowcode datasource-test`，检查网络连通性         |
| 版本回滚失败         | 目标版本快照已过期或存储损坏   | 查看可用快照列表 `lowcode snapshot-list`，使用最近快照 |
| 表单提交数据丢失     | 字段映射不完整或验证规则拦截   | 检查字段映射配置，查看验证错误日志                     |
| 页面发布后样式错乱   | CSS 作用域冲突或资源路径错误   | 启用 CSS 模块隔离，检查静态资源路径                    |

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

## 配置参考

下面的连通性、部署、访问控制选项为原设计配置。当前发布接口仅接受 appId，保存设计发布状态；运行时网络和部署选项尚不生效。

完整的低代码平台配置项（`.chainlesschain/config.json`）：

```javascript
// 低代码/无代码平台完整配置参考
const lowCodeConfig = {
  lowCodePlatform: {
    enabled: true,

    // 可视化设计器行为
    designer: {
      autoSave: true,
      autoSaveInterval: 30000, // 自动保存间隔（毫秒）
      gridSize: 8, // 画布栅格尺寸（px）
      snapToGrid: true, // 组件拖拽对齐栅格
      maxComponentsPerPage: 100, // 单页最大组件数
      undoHistoryLimit: 50, // 撤销历史步数
    },

    // 内置组件配置
    components: {
      builtinEnabled: true,
      customComponentsDir: "./custom-components", // 自定义组件目录
      chartLibrary: "echarts", // 图表库: "echarts" | "chartjs"
      lazyLoadComponents: true, // 按需加载组件（降低首屏体积）
    },

    // 数据源连接器配置
    datasource: {
      maxConnections: 10,
      defaultTimeout: 30000, // 连接超时（毫秒）
      encryptCredentials: true, // 凭证 SQLCipher 加密存储
      allowedTypes: ["rest", "graphql", "database", "csv"],
      // SSRF 防护: 仅允许可信域名
      allowedRestDomains: [], // 为空表示不限制；生产环境建议配置白名单
      maxRecordsPerFetch: 10000,
    },

    // 应用发布配置
    publishing: {
      defaultAccess: "private", // "private" | "organization" | "public"
      maxVersions: 50, // 单应用保留版本上限
      autoBackup: true,
      buildOutputDir: "./apps-dist",
    },
  },
};
```

---

## 性能指标

以下保留历史设计指标；本次未复测。真实连通性和运行时部署尚未实现，不能沿用旧文档数值宣称实测通过。

| 操作                                     | 目标     | 实际   | 状态           |
| ---------------------------------------- | -------- | ------ | -------------- |
| 创建应用（`lowcode:create-app`，含模板） | < 500 ms | 180 ms | ✅ 达标        |
| 保存设计（50 个组件页面）                | < 300 ms | 95 ms  | ✅ 达标        |
| 加载组件列表（15 种）                    | < 100 ms | 22 ms  | ✅ 达标        |
| 数据源连通性测试（REST）                 | < 3 s    | 未测量 | unsupported    |
| 数据源连通性测试（PostgreSQL）           | < 2 s    | 未测量 | unsupported    |
| 应用预览启动（Desktop 模式）             | < 2 s    | 1.1 s  | ✅ 达标        |
| 设计发布状态保存                         | < 1 s    | 未复测 | 不含运行时部署 |
| 版本回滚（恢复设计 JSON）                | < 500 ms | 140 ms | ✅ 达标        |
| 导出应用（JSON 格式，50 组件）           | < 1 s    | 280 ms | ✅ 达标        |
| 获取版本历史列表（50 版本）              | < 100 ms | 30 ms  | ✅ 达标        |

---

## 测试覆盖率

以下为历史设计测试清单，不作为真实连接器或部署验证。当前状态回归位于 `src/main/enterprise/low-code/__tests__/app-builder.test.js`，覆盖 configured、未探测、设计发布、持久化失败及旧状态加载。

| 测试文件                                               | 覆盖场景                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------- |
| ✅ `tests/unit/enterprise/low-code-platform.test.js`   | 应用 CRUD、5 种模板初始化、draft/published/archived 状态流转               |
| ✅ `tests/unit/enterprise/low-code-components.test.js` | 15 种组件注册、属性校验、category 分类检索、chartType 枚举                 |
| ✅ `tests/unit/enterprise/low-code-datasource.test.js` | REST/GraphQL/Database/CSV 四类连接器、凭证加密存储、连接超时处理           |
| ✅ `tests/unit/enterprise/low-code-designer.test.js`   | 组件拖拽布局保存、栅格对齐、autoSave 防抖、撤销历史（50 步）               |
| ✅ `tests/unit/enterprise/low-code-publish.test.js`    | 一键发布、版本号递增、访问权限控制（private/org/public）、maxVersions 裁剪 |
| ✅ `tests/unit/enterprise/low-code-versioning.test.js` | 版本列表查询、回滚到历史版本、快照完整性校验、并发回滚保护                 |
| ✅ `tests/integration/lowcode-ipc-handlers.test.js`    | 10 个 IPC 通道端到端调用、错误码验证、权限边界检查                         |
| ✅ `tests/unit/enterprise/low-code-security.test.js`   | JS 表达式沙箱隔离、XSS 模板转义、SSRF 域名白名单、导入模板结构校验         |

---

## 安全考虑

### 数据源安全

- **凭证加密存储**: 数据源连接配置中的密码、Token 等敏感信息通过 SQLCipher 加密存储（`encryptCredentials: true`），切勿在日志中输出连接配置
- **最小权限连接**: 数据库数据源建议使用只读账号连接（如 `readonly` 用户），避免低代码应用意外修改或删除源数据
- **网络访问控制**: REST/GraphQL 数据源的 URL 应限制为可信域名，防止 SSRF（服务端请求伪造）攻击

### 应用访问控制

以下是未来运行时的访问控制要求。当前 `design-published` 不创建可访问服务或执行下述运行时权限策略。

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

# 3. 查询探测能力（当前 unsupported / probed=false）
# IPC: lowcode:test-connection "<data-source-id>"

# 4. 预览设计 → 发布设计（不部署运行时）
# IPC: lowcode:preview "<app-id>"
# IPC: lowcode:publish "<app-id>"
```

### 组件配置要点

- **Table 组件**: `dataSource` 需指向已添加的数据源 ID，`columns` 的 `dataIndex` 应与 API 返回字段名一致
- **Chart 组件**: `chartType` 支持 `line`/`bar`/`pie`，`dimension` 为分组字段，`measure` 为聚合方式（count/sum/avg）
- **Form 组件**: 配置 `validation` 规则实现输入校验，`onSubmit` 可绑定数据源的 POST 操作

### 数据源连接排查

| 现象                   | 排查步骤                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| 发布后没有业务页面     | 检查 `deployed`；当前为 false，仅保存设计，不能从发布成功推断应用可访问                               |
| 数据源状态 unsupported | 探测尚未接入；configured 仅表示已注册配置。当前返回不包含实测延迟                                     |
| REST 数据源返回空      | 确认 `pagination` 配置与 API 分页参数一致（`pageParam`/`sizeParam`），检查 `Authorization` 头是否有效 |

## 相关文档

- [企业知识图谱](/chainlesschain/enterprise-knowledge-graph)
- [BI 智能分析](/chainlesschain/bi-engine)
- [Cowork 多智能体协作](/chainlesschain/cowork)
