# Legacy Web Playground / Preview 原语

> **产品状态：兼容维护。** 该页面是固定 HTML/CSS/JavaScript 的开发 playground，不是独立浏览器
> IDE，也不承诺仓库树、搜索、诊断、Git/Diff、Terminal、Worktree 或 canonical session runtime。
> 规范产品方向是把可复用的预览能力接入 session-bound Preview/Artifact；详见
> [产品定位 ADR](../../../docs/implementation-plans/WEBIDE_PREVIEW_ARTIFACT_POSITIONING_ADR.md)。

## 兼容页面已有能力

### Phase 1: 基础框架 ✓

- ✅ **WebIDEPage.vue** - 主页面（三栏布局）
- ✅ **EditorPanel.vue** - HTML/CSS/JS 编辑器面板
- ✅ **PreviewFrame.vue** - 实时预览框架
- ✅ **ConsolePanel.vue** - 开发者控制台
- ✅ 路由配置（`/webide`）

### Phase 2: 后端集成 ✓

- ✅ **webide-manager.js** - 项目管理器
- ✅ **webide-ipc.js** - IPC 通信处理器
- ✅ **preload/index.js** - webIDE API 暴露
- ✅ **main/index.js** - WebIDEManager 初始化

---

## 兼容页面开发与访问

### 1. 启动开发服务器

```bash
cd C:/code/chainlesschain/desktop-app-vue
npm run dev
```

### 2. 访问 legacy playground

打开浏览器访问：

```
http://localhost:5173/#/webide
```

或从经典壳的兼容菜单进入。V6 Chat-first 壳与 Session Preview/Artifact 是当前产品主线。

---

## 兼容页面能力（不等于完整 IDE）

### 📝 编辑器

- **HTML/CSS/JavaScript** 三个独立编辑器
- **语法高亮**（基于 CodeMirror 6）
- **标签页切换**
- **自动保存**（可选）

### 👁️ 实时预览

- **srcdoc 模式**：即时预览（300ms 防抖）
- **Server 模式**：本地服务器预览（支持 fetch/XHR）
- **设备切换**：手机/平板/桌面尺寸
- **旋转和缩放**：响应式测试

### 🐛 开发工具

- **Console 面板**：
  - 捕获 `console.log/error/warn/info`
  - 日志过滤
  - 自动滚动

- **错误捕获**：
  - 运行时错误
  - Promise 错误
  - 语法错误提示

### 💾 项目管理

- **保存项目**：写入 WebIDEManager 管理的本地项目目录（含 `project.json`）
- **加载项目**：从本地项目目录读取
- **导出功能**：
  - 导出单文件 HTML
  - 导出 ZIP 压缩包（含分离的 CSS/JS）

---

## 📂 文件结构

```
desktop-app-vue/
├── src/
│   ├── main/
│   │   └── webide/
│   │       ├── webide-manager.js    # 项目管理器
│   │       └── webide-ipc.js        # IPC 处理器
│   │
│   ├── preload/
│   │   └── index.js                 # webIDE API 暴露
│   │
│   └── renderer/
│       ├── pages/
│       │   └── webide/
│       │       └── WebIDEPage.vue   # 主页面
│       │
│       └── components/
│           └── webide/
│               ├── EditorPanel.vue      # 编辑器面板
│               ├── PreviewFrame.vue     # 预览框架
│               └── ConsolePanel.vue     # 控制台面板
│
└── patch-webide.js                  # 自动补丁脚本
```

---

## 🎨 界面预览

```
┌─────────────────────────────────────────────────────────┐
│  顶部工具栏 [保存][导出][预览模式▼][设备▼][刷新]       │
├──────────────┬─────────────────────┬────────────────────┤
│ 编辑器区35%  │  预览区 45%         │  开发工具区 20%    │
│              │                     │  (可折叠)          │
│ [HTML|CSS|JS]│  📱💻🖥️设备切换      │ [Console]          │
│              │                     │                    │
│ CodeMirror 6 │  iframe 预览框       │  日志列表          │
│ 语法高亮     │  实时刷新           │  错误捕获          │
│              │  旋转/缩放          │                    │
└──────────────┴─────────────────────┴────────────────────┘
│  底部状态栏: 语言 | 预览模式 | 服务器状态 | 日志数   │
└─────────────────────────────────────────────────────────┘
```

---

## 🔧 API 使用示例

### 保存项目

```javascript
const result = await window.electronAPI.webIDE.saveProject({
  name: "My Web Project",
  html: "<h1>Hello World</h1>",
  css: "body { margin: 0; }",
  js: 'console.log("Hello");',
  description: "我的第一个项目",
  tags: ["demo", "tutorial"],
});

console.log(result);
// { success: true, id: '...', path: '...' }
```

### 启动开发服务器

```javascript
const result = await window.electronAPI.webIDE.startDevServer({
  html: htmlCode.value,
  css: cssCode.value,
  js: jsCode.value,
  port: 3000,
});

console.log(result.url);
// http://localhost:3000
```

### 导出 HTML

```javascript
const result = await window.electronAPI.webIDE.exportHTML({
  html: htmlCode.value,
  css: cssCode.value,
  js: jsCode.value,
  filename: "my-page.html",
});

console.log(result.path);
// C:\Users\...\Temp\webide\my-page.html
```

---

## 🧪 兼容页面回归清单

### 基础功能

- [ ] 访问 `/webide` 路由成功
- [ ] HTML/CSS/JS 编辑器正常显示
- [ ] 标签页切换正常
- [ ] 代码编辑实时生效

### 预览功能

- [ ] srcdoc 模式实时预览
- [ ] 设备尺寸切换（手机/平板/桌面）
- [ ] 旋转设备（90度旋转）
- [ ] 预览刷新按钮

### 控制台

- [ ] `console.log` 日志捕获
- [ ] `console.error` 错误显示
- [ ] 日志过滤（all/log/error/warn）
- [ ] 清空控制台

### 项目管理（本地文件存储；未接入 canonical session）

- [ ] 保存项目
- [ ] 加载项目
- [ ] 导出 HTML
- [ ] 导出 ZIP

---

## ⚠️ 已知限制

1. **服务器模式**：需要 `preview-server.js` 正常工作
2. **项目保存**：使用 WebIDEManager 管理的本地文件目录，不是 SQLite 或 canonical session artifact
3. **导出 ZIP**：需要 `archiver` 依赖包
4. **固定文件模型**：只编辑 `index.html`、`style.css` 和 `script.js`，不是通用仓库工作区
5. **未绑定 coding session**：没有 canonical session/turn/trace/worktree、权限、审计或交付 lineage

---

## 维护边界与迁移方向

允许在旧页面继续进行：

- 安全、崩溃、数据完整性、依赖兼容和无障碍缺陷修复；
- 保持既有读取、预览、Console 和导出能力所需的维护；
- 将 PreviewFrame、preview server、截图和 Console 等原语复用到 canonical session。

不再为旧页面补齐仓库树、全局搜索、诊断、Git/Diff、Terminal 或 Worktree。完整编辑器体验由 VS Code、
JetBrains 插件与统一 Desktop Coding Workbench 承担；App Preview 后续按
“启动 → 观察 → 断言 → 修复 → 复验 → evidence artifact”接入同一 session。

---

## 📞 问题反馈

如果遇到问题，请检查：

1. **开发服务器是否正常启动**

   ```bash
   npm run dev
   ```

2. **浏览器控制台是否有错误**
   - 打开开发者工具（F12）
   - 查看 Console 标签

3. **文件是否正确修改**
   - `router/index.js` - 路由配置
   - `preload/index.js` - API 暴露
   - `main/index.js` - 初始化代码

---

## 定位状态

固定三文件 playground 的基础实现已经存在，但这不等于“完整浏览器 IDE 已完成”，也不等于
session-bound App Preview 自动验证闭环已经完成。

- ✅ 兼容范围：固定 HTML/CSS/JavaScript 编辑、预览、Console、保存与导出原语
- 🧭 产品定位：不建设独立浏览器 IDE；收敛至 Session Preview/Artifact
- ⏳ 迁移实现：按 canonical session、权限、审计和 evidence lineage 的独立验收推进

---

生成时间：2025-12-25
版本：v1.0.0
