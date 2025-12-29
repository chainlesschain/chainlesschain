# ChainlessChain Web Clipper - 开发者文档

## 📚 目录

- [架构概览](#架构概览)
- [项目结构](#项目结构)
- [开发环境设置](#开发环境设置)
- [构建系统](#构建系统)
- [浏览器适配](#浏览器适配)
- [API 参考](#api-参考)
- [扩展开发](#扩展开发)
- [测试指南](#测试指南)
- [发布流程](#发布流程)

---

## 架构概览

### 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                   浏览器扩展层                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │  Popup   │  │Background│  │ Content  │  │Annotation│ │
│  │   UI     │  │  Script  │  │  Script  │  │  Editor  │ │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘  └─────┬────┘ │
│        │             │             │             │      │
│        └─────────────┴─────────────┴─────────────┘      │
│                      │                                   │
│              Browser Adapter Layer                       │
│                      │                                   │
└──────────────────────┼───────────────────────────────────┘
                       │
              ┌────────┴────────┐
              │                 │
       Native Messaging    HTTP API
              │                 │
              ▼                 ▼
    ┌─────────────────────────────────┐
    │     ChainlessChain Desktop      │
    │  ┌──────────┐  ┌──────────┐    │
    │  │ Database │  │   LLM    │    │
    │  │ (SQLite) │  │ Manager  │    │
    │  └──────────┘  └──────────┘    │
    └─────────────────────────────────┘
```

### 技术栈

| 层次 | 技术 | 版本 |
|------|------|------|
| 构建工具 | Webpack | 5.104.1 |
| 包管理 | npm | - |
| 模块系统 | ES6 Modules | - |
| UI | HTML5 + CSS3 | - |
| 内容提取 | Mozilla Readability | 0.5.0 |
| 标注编辑 | Fabric.js | 5.x |
| 通信协议 | Native Messaging / HTTP | - |
| 浏览器 API | Chrome Extensions API / WebExtensions API | V3 / V2 |

### 通信流程

```
用户操作 (Popup)
    ↓
发送消息 (runtime.sendMessage)
    ↓
Background Script 接收
    ↓
    ├─→ Native Messaging (Chrome/Firefox)
    │       ↓
    │   Desktop App (Python Host)
    │
    └─→ HTTP API (Safari/Fallback)
            ↓
        HTTP Server (localhost:23456)
            ↓
        Desktop App (Node.js)
            ↓
        Database / LLM Service
            ↓
        返回结果
            ↓
        Popup 更新 UI
```

---

## 项目结构

```
browser-extension/
├── src/                          # 源代码
│   ├── popup/                    # 弹出窗口
│   │   ├── popup.html
│   │   ├── popup.css
│   │   └── popup.js              # 主要 UI 逻辑
│   ├── background/               # 后台脚本
│   │   └── background.js         # Service Worker / 消息路由
│   ├── content/                  # 内容脚本
│   │   └── content-script.js     # 页面注入脚本
│   ├── annotation/               # 标注编辑器
│   │   ├── annotation-editor.html
│   │   ├── annotation-editor.css
│   │   └── annotation-editor.js  # Fabric.js 画布
│   ├── batch/                    # 批量剪藏
│   │   ├── batch-clipper.html
│   │   ├── batch-clipper.css
│   │   └── batch-clipper.js      # 批量处理逻辑
│   ├── common/                   # 共享代码
│   │   ├── utils.js              # 工具函数
│   │   ├── api-client.js         # HTTP API 客户端
│   │   └── readability.js        # Mozilla Readability (83KB)
│   └── adapters/                 # 浏览器适配层
│       ├── chrome-adapter.js
│       ├── firefox-adapter.js
│       └── safari-adapter.js
├── manifests/                    # 清单文件
│   ├── manifest-chrome.json      # Manifest V3 (Chrome/Edge)
│   ├── manifest-firefox.json     # Manifest V2 (Firefox)
│   └── manifest-safari.json      # Safari 格式
├── icons/                        # 图标资源
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── build/                        # 构建输出 (gitignore)
│   ├── chrome/
│   ├── firefox/
│   └── safari/
├── webpack.config.js             # Webpack 配置
├── package.json                  # 项目配置
├── USER_GUIDE.md                 # 用户指南
├── DEVELOPER_GUIDE.md            # 本文档
└── README.md                     # 项目说明
```

---

## 开发环境设置

### 前置要求

- Node.js >= 16.x
- npm >= 8.x
- 浏览器：Chrome/Edge/Firefox 最新版
- ChainlessChain Desktop App 运行中

### 安装依赖

```bash
cd desktop-app-vue/browser-extension
npm install
```

**主要依赖**：
```json
{
  "devDependencies": {
    "webpack": "^5.104.1",
    "webpack-cli": "^5.1.4",
    "copy-webpack-plugin": "^12.0.2"
  },
  "dependencies": {
    "fabric": "^5.3.0"
  }
}
```

### 启动开发服务器

**方法 1：监视模式**
```bash
npm run watch:chrome    # Chrome/Edge 开发
npm run watch:firefox   # Firefox 开发
```

**方法 2：手动构建**
```bash
npm run build:chrome
npm run build:firefox
npm run build:safari
npm run build:all       # 构建所有浏览器版本
```

### 热重载

使用 `web-ext` 工具实现热重载（Firefox）：

```bash
npm install -g web-ext
cd build/firefox
web-ext run --start-url "about:debugging"
```

Chrome 需要手动刷新扩展。

---

## 构建系统

### Webpack 配置

**文件**：`webpack.config.js`

**核心配置**：
```javascript
module.exports = (env) => {
  const browser = env.browser || 'chrome';

  return {
    mode: 'development',
    devtool: 'inline-source-map',

    // 入口点
    entry: {
      'popup/popup': './src/popup/popup.js',
      'background/background': './src/background/background.js',
      'content/content-script': './src/content/content-script.js',
      'annotation/annotation-editor': './src/annotation/annotation-editor.js',
      'batch/batch-clipper': './src/batch/batch-clipper.js',
    },

    // 输出目录（根据浏览器）
    output: {
      path: path.resolve(__dirname, `build/${browser}`),
      filename: '[name].js',
    },

    // 插件
    plugins: [
      new CopyPlugin({
        patterns: [
          // 清单文件
          {
            from: `manifests/manifest-${browser}.json`,
            to: 'manifest.json',
          },
          // HTML/CSS 文件
          { from: 'src/popup/*.html', to: 'popup/[name][ext]' },
          { from: 'src/popup/*.css', to: 'popup/[name][ext]' },
          // ... 其他文件
        ],
      }),
    ],
  };
};
```

### 构建命令

```bash
# 开发构建（包含 source map）
npm run build:chrome

# 生产构建（优化压缩）
NODE_ENV=production npm run build:chrome

# 清理构建产物
rm -rf build/
```

### 输出分析

```
build/chrome/
├── manifest.json              # 清单文件
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js              # 65.7 KB
├── background/
│   └── background.js         # 59.4 KB
├── content/
│   └── content-script.js     # 20.6 KB
├── annotation/
│   ├── annotation-editor.html
│   ├── annotation-editor.css
│   └── annotation-editor.js  # 56.6 KB
├── batch/
│   ├── batch-clipper.html
│   ├── batch-clipper.css
│   └── batch-clipper.js      # 68.9 KB
├── lib/
│   └── readability.js        # 83 KB
└── icons/
    └── ...
```

---

## 浏览器适配

### 适配器模式

使用适配器模式抽象浏览器 API 差异：

```javascript
// src/adapters/chrome-adapter.js
export const BrowserAdapter = {
  runtime: {
    sendMessage: (...args) => chrome.runtime.sendMessage(...args),
    onMessage: chrome.runtime.onMessage,
    getURL: (...args) => chrome.runtime.getURL(...args),
  },
  tabs: {
    query: (...args) => chrome.tabs.query(...args),
    captureVisibleTab: (...args) => chrome.tabs.captureVisibleTab(...args),
  },
  windows: {
    create: (...args) => chrome.windows.create(...args),
    getCurrent: (...args) => chrome.windows.getCurrent(...args),
  },
  // ...
};
```

### 使用适配器

```javascript
// src/popup/popup.js
import { getBrowserAdapter } from '../common/utils.js';

const browserAdapter = await getBrowserAdapter();

// 发送消息（跨浏览器兼容）
const response = await browserAdapter.runtime.sendMessage({
  action: 'clipPage',
  data: formData,
});

// 打开新窗口
await browserAdapter.windows.create({
  url: editorUrl,
  type: 'popup',
  width: 1200,
  height: 800,
});
```

### 浏览器差异

| 功能 | Chrome/Edge | Firefox | Safari |
|------|-------------|---------|--------|
| Manifest 版本 | V3 | V2 | V2 |
| Background | Service Worker | Background Script | Background Page |
| API 命名空间 | `chrome.*` | `browser.*` | `safari.*` |
| Native Messaging | ✅ 支持 | ✅ 支持 | ❌ 不支持 |
| HTTP API | ✅ Fallback | ✅ Fallback | ✅ 主要方式 |

### Manifest V3 vs V2

**Chrome/Edge (V3)**：
```json
{
  "manifest_version": 3,
  "background": {
    "service_worker": "background/background.js"
  },
  "host_permissions": ["<all_urls>"]
}
```

**Firefox (V2)**：
```json
{
  "manifest_version": 2,
  "background": {
    "scripts": ["background/background.js"]
  },
  "permissions": ["<all_urls>"]
}
```

---

## API 参考

### Background Script API

#### `clipPage(data)`

剪藏页面到知识库。

**参数**：
```javascript
{
  title: string,        // 页面标题
  content: string,      // 页面内容（HTML/Markdown）
  url: string,          // 页面 URL
  type: string,         // 类型：web_clip | article | note | document
  tags: string[],       // 标签数组
  excerpt: string,      // 摘要
  domain: string,       // 域名
  author: string,       // 作者（可选）
  date: string,         // 发布日期（可选）
  autoIndex: boolean,   // 是否自动添加到 RAG 索引
}
```

**返回**：
```javascript
{
  success: true,
  data: {
    id: "uuid",
    title: "页面标题"
  }
}
```

**示例**：
```javascript
const response = await chrome.runtime.sendMessage({
  action: 'clipPage',
  data: {
    title: 'React Hooks 指南',
    content: '<h1>React Hooks 指南</h1>...',
    url: 'https://example.com/react-hooks',
    type: 'article',
    tags: ['React', 'Hooks'],
    autoIndex: true,
  },
});
```

#### `generateTags(data)`

AI 生成标签。

**参数**：
```javascript
{
  title: string,
  content: string,
  url: string,
  excerpt: string,
}
```

**返回**：
```javascript
{
  success: true,
  data: {
    tags: ["React", "Hooks", "前端开发"]
  }
}
```

#### `generateSummary(data)`

AI 生成摘要。

**参数**：
```javascript
{
  title: string,
  content: string,
}
```

**返回**：
```javascript
{
  success: true,
  data: {
    summary: "本文介绍了 React Hooks 的核心概念..."
  }
}
```

#### `uploadScreenshot(data)`

上传截图。

**参数**：
```javascript
{
  image: string,              // Base64 编码的图片
  annotations: string,        // Fabric.js JSON 格式
  knowledgeItemId: string,    // 关联的知识库条目 ID（可选）
}
```

**返回**：
```javascript
{
  success: true,
  data: {
    id: "screenshot-uuid",
    path: "/path/to/screenshot.png"
  }
}
```

### Content Script API

#### `getPageInfo()`

从页面提取信息。

**消息**：
```javascript
chrome.tabs.sendMessage(tabId, { action: 'getPageInfo' });
```

**返回**：
```javascript
{
  success: true,
  data: {
    title: "页面标题",
    url: "https://example.com",
    content: "提取的正文内容（HTML）",
    excerpt: "摘要文本",
    author: "作者名",
    date: "2024-01-01",
    domain: "example.com",
  }
}
```

### HTTP API 端点

**Base URL**: `http://localhost:23456/api`

#### `POST /api/clip`

剪藏页面。

**请求体**：
```json
{
  "title": "页面标题",
  "content": "页面内容",
  "url": "https://example.com",
  "type": "web_clip",
  "tags": ["标签1", "标签2"],
  "autoIndex": true
}
```

**响应**：
```json
{
  "success": true,
  "data": {
    "id": "item-uuid",
    "title": "页面标题"
  }
}
```

#### `POST /api/generate-tags`

AI 生成标签。

**请求体**：
```json
{
  "title": "React Hooks 指南",
  "content": "内容摘要...",
  "url": "https://example.com"
}
```

**响应**：
```json
{
  "success": true,
  "data": {
    "tags": ["React", "Hooks", "JavaScript"]
  }
}
```

#### `POST /api/generate-summary`

AI 生成摘要。

**请求体**：
```json
{
  "title": "文章标题",
  "content": "完整内容..."
}
```

**响应**：
```json
{
  "success": true,
  "data": {
    "summary": "这是一篇关于..."
  }
}
```

#### `POST /api/upload-screenshot`

上传截图。

**请求体**：
```json
{
  "image": "data:image/png;base64,...",
  "annotations": "{...Fabric.js JSON...}",
  "knowledgeItemId": "optional-uuid"
}
```

**响应**：
```json
{
  "success": true,
  "data": {
    "id": "screenshot-uuid",
    "path": "/path/to/file.png"
  }
}
```

#### `POST /api/ping`

健康检查。

**响应**：
```json
{
  "success": true,
  "data": {
    "message": "pong"
  }
}
```

---

## 扩展开发

### 添加新功能

**步骤 1**：在 Popup 添加 UI

```html
<!-- src/popup/popup.html -->
<button id="myNewFeatureBtn">新功能</button>
```

**步骤 2**：添加事件处理

```javascript
// src/popup/popup.js
elements.myNewFeatureBtn = document.getElementById('myNewFeatureBtn');

elements.myNewFeatureBtn.addEventListener('click', async () => {
  const response = await browserAdapter.runtime.sendMessage({
    action: 'myNewFeature',
    data: { /* ... */ },
  });
});
```

**步骤 3**：在 Background 添加处理器

```javascript
// src/background/background.js
chromeAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'myNewFeature') {
    handleMyNewFeature(request.data)
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

async function handleMyNewFeature(data) {
  // 调用 HTTP API
  return apiClient.request('/my-endpoint', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
```

**步骤 4**：添加后端端点

```javascript
// desktop-app-vue/src/main/native-messaging/http-server.js
app.post('/api/my-endpoint', async (req, res) => {
  const { data } = req.body;

  try {
    const result = await processData(data);
    res.json({ success: true, data: result });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});
```

### 调试技巧

**1. Popup 调试**
- 右键点击扩展图标 → "检查弹出窗口"
- 使用 Chrome DevTools

**2. Background Script 调试**
- 访问 `chrome://extensions/`
- 点击 "检查视图：Service Worker"

**3. Content Script 调试**
- 打开网页 DevTools
- Content script 在页面上下文中运行

**4. 查看日志**
```javascript
console.log('[Popup] Message:', data);
console.log('[Background] Processing:', request);
console.log('[Content] Extracted:', pageInfo);
```

**5. 网络请求调试**
- DevTools → Network 标签
- 查看 `localhost:23456` 的请求

### 性能优化

**1. 代码分割**
```javascript
// 动态导入大型库
const fabric = await import('fabric');
```

**2. 减少包体积**
```bash
# 生产构建
NODE_ENV=production webpack --env browser=chrome
```

**3. 异步处理**
```javascript
// 使用 Web Workers
const worker = new Worker('worker.js');
worker.postMessage(data);
```

**4. 缓存策略**
```javascript
// 缓存常用数据
chrome.storage.local.set({ cachedData: data });
```

---

## 测试指南

### 手动测试清单

**基础功能**：
- [ ] 扩展安装成功
- [ ] 状态显示 "已连接"
- [ ] 点击剪藏按钮保存成功
- [ ] 桌面应用数据库中可见新条目

**AI 功能**：
- [ ] AI 标签生成返回结果
- [ ] AI 摘要生成返回结果
- [ ] LLM 不可用时 Fallback 工作

**截图功能**：
- [ ] 截图捕获成功
- [ ] 标注工具可用
- [ ] 保存截图到文件系统
- [ ] 数据库记录正确

**批量剪藏**：
- [ ] 标签页列表正确显示
- [ ] 选择/过滤功能正常
- [ ] 批量处理成功
- [ ] 错误处理正确

### 自动化测试

**单元测试** (TODO)
```bash
npm test
```

**集成测试** (TODO)
```bash
npm run test:integration
```

### 跨浏览器测试

**测试矩阵**：

| 浏览器 | 版本 | 状态 |
|--------|------|------|
| Chrome | 120+ | ✅ 完全支持 |
| Edge | 120+ | ✅ 完全支持 |
| Firefox | 115+ | ⚠️ 需测试 |
| Safari | 17+ | ⚠️ 开发中 |

---

## 发布流程

### 构建生产版本

```bash
# 清理旧版本
rm -rf build/

# 构建所有浏览器版本
NODE_ENV=production npm run build:all

# 验证构建
ls -lh build/chrome/
ls -lh build/firefox/
```

### 打包扩展

**Chrome/Edge**：
```bash
cd build/chrome
zip -r ../../chainlesschain-clipper-chrome-v2.0.0.zip .
```

**Firefox**：
```bash
cd build/firefox
zip -r ../../chainlesschain-clipper-firefox-v2.0.0.zip .
```

### 版本管理

**更新版本号**：
1. `package.json` → `version`
2. `manifests/manifest-*.json` → `version`
3. 创建 Git tag

```bash
git tag -a v2.0.0 -m "Release v2.0.0"
git push origin v2.0.0
```

### 发布到 Chrome Web Store

1. 访问 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. 上传 ZIP 文件
3. 填写商店信息
4. 提交审核

### 发布到 Firefox Add-ons

1. 访问 [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/)
2. 上传 ZIP 文件
3. 填写信息
4. 提交审核

---

## 常见开发问题

### Q: Webpack 构建失败

**错误**：`Module not found`

**解决**：
```bash
npm install
npm run build:chrome
```

### Q: Background Script 无法加载

**Manifest V3 限制**：
- 不能使用内联脚本
- 必须使用 Service Worker

### Q: Content Script 无法访问页面变量

**原因**：Content Script 运行在隔离环境

**解决**：使用 `window.postMessage`

### Q: CORS 错误

**原因**：HTTP API 默认只允许 localhost

**解决**：
```javascript
// 在 http-server.js 中
res.setHeader('Access-Control-Allow-Origin', '*');
```

---

## 贡献指南

### 代码规范

**命名约定**：
- 变量：`camelCase`
- 常量：`UPPER_SNAKE_CASE`
- 函数：`camelCase`
- 类：`PascalCase`

**注释**：
```javascript
/**
 * 函数功能描述
 * @param {string} title - 参数说明
 * @returns {Promise<Object>} 返回值说明
 */
async function myFunction(title) {
  // ...
}
```

### 提交 Pull Request

1. Fork 仓库
2. 创建特性分支：`git checkout -b feature/my-feature`
3. 提交更改：`git commit -m "feat: add my feature"`
4. 推送分支：`git push origin feature/my-feature`
5. 创建 Pull Request

### Commit 规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat: 新功能
fix: 修复bug
docs: 文档更新
style: 代码格式
refactor: 重构
test: 测试
chore: 构建/工具
```

---

## 许可证

MIT License

---

## 联系方式

- GitHub: https://github.com/your-repo/chainlesschain
- Email: dev@chainlesschain.com
- Discord: https://discord.gg/chainlesschain

---

**Happy Coding! 🚀**
