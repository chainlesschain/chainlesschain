# 浏览器控制 - 快速开始指南

> **版本**: v0.27.0 Phase 1
> **适用平台**: Windows, macOS, Linux

---

## 🚀 快速开始

### 1. 安装依赖

浏览器控制模块需要 `playwright-core`，已自动包含在项目依赖中：

```bash
cd desktop-app-vue
npm install
```

### 2. 启动应用

```bash
npm run dev
```

### 3. 访问浏览器控制页面

在应用中访问: `#/ai/browser`

或者从主菜单导航：**AI 工具 → 浏览器控制**

---

## 📝 基本操作

### 启动浏览器

1. 点击 **"启动浏览器"** 按钮
2. 等待 2-3 秒，浏览器启动成功
3. 状态显示为 **"运行中"**

### 打开网页

1. 在 URL 输入框中输入网址（例如: `https://www.google.com`）
2. 点击 **"打开标签页"** 按钮
3. 新标签页将显示在下方列表中

### 管理标签页

每个标签页卡片支持以下操作：

- **聚焦** 👁️ - 将标签页置于前台
- **截图** 📷 - 截取当前页面并预览
- **关闭** ❌ - 关闭标签页

### 查看截图

1. 点击标签页的 **截图** 按钮
2. 在弹出的模态框中查看截图
3. 点击外部区域关闭预览

### 停止浏览器

点击 **"停止浏览器"** 按钮，所有标签页将被关闭，浏览器退出。

---

## 💻 API 使用示例

### 渲染进程（Vue 组件）

```javascript
// 启动浏览器
const result = await window.electron.ipcRenderer.invoke('browser:start', {
  headless: false,
  channel: 'chrome' // 或 'msedge'
});

console.log('浏览器已启动, PID:', result.pid);

// 创建 Profile
await window.electron.ipcRenderer.invoke('browser:createContext', 'my-profile');

// 打开标签页
const tab = await window.electron.ipcRenderer.invoke(
  'browser:openTab',
  'my-profile',
  'https://www.google.com'
);

console.log('标签页已打开:', tab.targetId);

// 截图
const { screenshot } = await window.electron.ipcRenderer.invoke(
  'browser:screenshot',
  tab.targetId,
  { type: 'png', fullPage: false }
);

// screenshot 是 base64 编码的 PNG
const img = new Image();
img.src = `data:image/png;base64,${screenshot}`;
document.body.appendChild(img);

// 列出所有标签页
const tabs = await window.electron.ipcRenderer.invoke('browser:listTabs', 'my-profile');
console.log('当前标签页:', tabs);

// 停止浏览器
await window.electron.ipcRenderer.invoke('browser:stop');
```

### 主进程（Electron）

```javascript
const { getBrowserEngine } = require('./src/main/browser/browser-ipc');

async function example() {
  const engine = getBrowserEngine();

  // 启动
  await engine.start({ headless: false });

  // 创建上下文
  await engine.createContext('default');

  // 打开标签页
  const { targetId } = await engine.openTab('default', 'https://example.com');

  // 导航
  await engine.navigate(targetId, 'https://google.com');

  // 截图
  const buffer = await engine.screenshot(targetId);
  fs.writeFileSync('screenshot.png', buffer);

  // 保存会话（Cookie）
  await engine.saveSession('default');

  // 停止
  await engine.stop();
}
```

---

## 🔧 高级功能

### 会话持久化

**保存登录状态:**

```javascript
// 1. 手动登录网站（例如 GitHub）
await window.electron.ipcRenderer.invoke(
  'browser:openTab',
  'github-profile',
  'https://github.com/login'
);

// 2. 手动登录后，保存会话
const { stateFile } = await window.electron.ipcRenderer.invoke(
  'browser:saveSession',
  'github-profile'
);

console.log('会话已保存到:', stateFile);
```

**恢复登录状态:**

```javascript
// 下次启动时，恢复会话
await window.electron.ipcRenderer.invoke(
  'browser:restoreSession',
  'github-profile'
);

// 打开 GitHub，已自动登录
await window.electron.ipcRenderer.invoke(
  'browser:openTab',
  'github-profile',
  'https://github.com'
);
```

### 多 Profile 管理

```javascript
// 创建工作 Profile
await window.electron.ipcRenderer.invoke('browser:createContext', 'work');

// 创建个人 Profile
await window.electron.ipcRenderer.invoke('browser:createContext', 'personal');

// 在不同 Profile 中打开标签页
await window.electron.ipcRenderer.invoke('browser:openTab', 'work', 'https://company.com');
await window.electron.ipcRenderer.invoke('browser:openTab', 'personal', 'https://github.com');

// 列出指定 Profile 的标签页
const workTabs = await window.electron.ipcRenderer.invoke('browser:listTabs', 'work');
```

---

## ⚡ 性能优化建议

### 1. 使用合适的等待策略

```javascript
// 快速加载（仅等待 DOM）
await window.electron.ipcRenderer.invoke('browser:openTab', 'default', url, {
  waitUntil: 'domcontentloaded'
});

// 完整加载（等待所有资源）
await window.electron.ipcRenderer.invoke('browser:openTab', 'default', url, {
  waitUntil: 'networkidle'
});
```

### 2. 批量操作

```javascript
// 并行打开多个标签页
const urls = ['https://google.com', 'https://github.com', 'https://stackoverflow.com'];
const tabs = await Promise.all(
  urls.map(url => window.electron.ipcRenderer.invoke('browser:openTab', 'default', url))
);
```

### 3. 及时关闭标签页

```javascript
// 使用完毕后关闭标签页，释放内存
await window.electron.ipcRenderer.invoke('browser:closeTab', targetId);
```

---

## 🐛 常见问题

### Q1: 启动失败 "Browser is already running"

**原因**: 浏览器已在运行
**解决**: 先停止浏览器再启动

```javascript
await window.electron.ipcRenderer.invoke('browser:stop');
await window.electron.ipcRenderer.invoke('browser:start');
```

### Q2: 端口 18800 被占用

**原因**: CDP 端口冲突
**解决**: 修改 `browser-engine.js` 中的 `cdpPort` 配置

```javascript
const browserEngine = new BrowserEngine({
  cdpPort: 18801 // 修改为其他端口
});
```

### Q3: 截图失败 "Tab not found"

**原因**: 标签页已被关闭
**解决**: 确保在截图前标签页仍然存在

```javascript
const tabs = await window.electron.ipcRenderer.invoke('browser:listTabs');
if (tabs.find(t => t.targetId === targetId)) {
  await window.electron.ipcRenderer.invoke('browser:screenshot', targetId);
}
```

### Q4: Profile 目录权限错误

**原因**: 无权限访问 userData 目录
**解决**: 以管理员权限运行，或修改目录位置

---

## 📚 下一步学习

- **Phase 2 智能快照**: 学习如何使用元素引用系统（`e12` 格式）
- **Phase 3 AI 控制**: 使用自然语言控制浏览器（"打开 Google 搜索 Electron"）
- **API 文档**: 查看 `BROWSER_CONTROL_API.md` 获取完整 API 参考

---

## 🤝 反馈与支持

遇到问题或有建议？

- 查看完整文档: `docs/features/BROWSER_CONTROL_PHASE1_SUMMARY.md`
- 提交 Issue: GitHub Issues
- 联系作者: ChainlessChain Team

---

**文档版本**: 1.0
**最后更新**: 2026-02-06
