# 低代码/无代码平台

> **版本: v4.5.0 | 状态: ✅ 生产就绪 | 10 IPC Handlers | 2 数据库表 | Phase 93**

ChainlessChain 低代码/无代码平台提供可视化应用构建能力，支持拖拽式设计器、15 种内置组件（表单/表格/图表/仪表盘）、多种数据连接器（REST/GraphQL/Database/CSV）、应用发布与版本管理，以及多设备响应式布局，让非开发人员也能快速构建业务应用。

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

## 相关文档

- [企业知识图谱](/chainlesschain/enterprise-knowledge-graph)
- [BI 智能分析](/chainlesschain/bi-engine)
- [Cowork 多智能体协作](/chainlesschain/cowork)
