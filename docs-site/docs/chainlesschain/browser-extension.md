# 浏览器插件

> **版本: v1.0.0 | 215个远程命令 | Chrome/Edge/Arc兼容**

浏览器插件是 ChainlessChain Desktop 的重要扩展组件，提供完整的浏览器自动化和远程控制能力，支持网页操作、数据提取、调试工具等丰富功能。

## 安装指南

### 系统要求

- **支持的浏览器**: Chrome 88+, Edge 88+, Arc, Brave, Opera 等 Chromium 内核浏览器
- **ChainlessChain Desktop**: v0.29.0 或更高版本
- **操作系统**: Windows 10+, macOS 10.15+, Linux

### 安装步骤

#### 1. 获取插件文件

插件文件位于 ChainlessChain Desktop 安装目录：

```
Windows: %APPDATA%/chainlesschain-desktop-vue/browser-extension/
macOS: ~/Library/Application Support/chainlesschain-desktop-vue/browser-extension/
Linux: ~/.config/chainlesschain-desktop-vue/browser-extension/
```

或从源码获取：

```bash
cd desktop-app-vue/src/main/remote/browser-extension
```

#### 2. 加载到浏览器

**Chrome/Edge/Arc:**

1. 打开浏览器，访问 `chrome://extensions`（Edge 为 `edge://extensions`）
2. 开启右上角的 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择 `browser-extension` 文件夹
5. 插件图标出现在浏览器工具栏

#### 3. 启动 Desktop 应用

1. 启动 ChainlessChain Desktop
2. 确保远程控制服务已启动（默认端口 18790）
3. 点击插件图标，点击 **Connect** 连接

### 连接状态

| 状态   | 图标颜色 | 说明                        |
| ------ | -------- | --------------------------- |
| 已连接 | 🟢 绿色  | 与 Desktop 通信正常         |
| 未连接 | 🔴 红色  | 需要启动 Desktop 或点击连接 |
| 重连中 | 🟡 黄色  | 自动重连中（最多5次）       |

---

## 功能概览

### 核心能力统计

| 类别     | 命令数  | 说明                                |
| -------- | ------- | ----------------------------------- |
| 标签管理 | 8       | 创建、关闭、导航、焦点控制          |
| 页面操作 | 5       | 截图、执行脚本、导出PDF             |
| 书签历史 | 7       | 书签和浏览历史管理                  |
| Cookies  | 5       | Cookie 读写和清理                   |
| 下载管理 | 8       | 下载控制和历史管理                  |
| 窗口管理 | 7       | 窗口创建、调整、控制                |
| 存储操作 | 10      | localStorage/sessionStorage         |
| 网络拦截 | 10+     | 请求拦截、Mock、限流                |
| DOM操作  | 40+     | 点击、输入、选择、等待              |
| 调试工具 | 70+     | WebSocket、Service Worker、内存分析 |
| 设备模拟 | 20+     | 触摸、传感器、地理位置              |
| **总计** | **215** | 完整的浏览器控制能力                |

---

## 标签管理

控制浏览器标签页的创建、导航和管理。

### 命令列表

```javascript
// 列出所有标签页
tabs.list

// 获取单个标签页信息
tabs.get { tabId: 123 }

// 创建新标签页
tabs.create { url: "https://example.com", active: true }

// 关闭标签页
tabs.close { tabId: 123 }

// 激活标签页
tabs.focus { tabId: 123 }

// 导航到URL
tabs.navigate { tabId: 123, url: "https://new-url.com" }

// 重新加载
tabs.reload { tabId: 123 }

// 浏览器前进/后退
tabs.goBack { tabId: 123 }
tabs.goForward { tabId: 123 }
```

### 使用示例

在 Desktop AI 对话中：

```
用户: 帮我打开 GitHub 首页
AI: [调用 tabs.create { url: "https://github.com" }]
    已为您打开 GitHub 首页。
```

---

## 页面操作

获取页面内容、执行脚本、截图等操作。

### 命令列表

```javascript
// 获取页面HTML内容
page.getContent { tabId: 123, selector: "article" }

// 执行JavaScript代码
page.executeScript {
  tabId: 123,
  code: "document.title"
}

// 截取页面截图
page.screenshot { tabId: 123, format: "png" }

// 打印页面
page.print { tabId: 123 }

// 导出为PDF
page.pdf {
  tabId: 123,
  options: {
    format: "A4",
    printBackground: true
  }
}
```

### 安全说明

> **注意**: `page.executeScript` 允许执行任意 JavaScript 代码。此功能仅用于本地自动化，WebSocket 仅监听 `127.0.0.1:18790`，不暴露到网络。

---

## DOM 操作

在网页上执行点击、输入、选择等交互操作。

### 点击和输入

```javascript
// 点击元素
dom.click { selector: "#submit-btn" }

// 双击
dom.doubleClick { selector: ".item" }

// 右键菜单
dom.rightClick { selector: ".context-menu-target" }

// 悬停
dom.hover { selector: ".tooltip-trigger" }

// 输入文本
dom.type {
  selector: "#search-input",
  text: "搜索关键词",
  delay: 50  // 每个字符间隔50ms
}

// 清空并输入
dom.fill { selector: "#email", value: "user@example.com" }
```

### 表单操作

```javascript
// 下拉选择
dom.selectOption {
  selector: "#country",
  value: "CN"
}

// 复选框
dom.checkCheckbox {
  selector: "#agree-terms",
  checked: true
}

// 文件上传
dom.uploadFile {
  selector: "input[type=file]",
  filePath: "/path/to/file.pdf"
}

// 提交表单
dom.submit { selector: "#login-form" }
```

### 等待和查询

```javascript
// 等待元素出现
dom.waitForSelector {
  selector: ".loading-complete",
  timeout: 5000
}

// 等待导航完成
dom.waitForNavigation { timeout: 10000 }

// 获取元素文本
dom.getText { selector: "h1" }

// 获取元素属性
dom.getAttribute {
  selector: "a.link",
  attribute: "href"
}

// 检查元素是否存在
dom.exists { selector: "#modal" }
```

### Shadow DOM 支持

支持 Web Components 的 Shadow DOM 查询：

```javascript
// 穿透Shadow DOM查询
dom.shadowQuery {
  hostSelector: "custom-element",
  innerSelector: ".inner-button"
}
```

---

## 数据提取

从网页提取结构化数据。

### 内容提取

```javascript
// 提取所有链接
content.extractLinks { tabId: 123 }
// 返回: [{ text: "...", href: "...", title: "..." }, ...]

// 提取所有图片
content.extractImages { tabId: 123 }
// 返回: [{ src: "...", alt: "...", width: 100, height: 100 }, ...]

// 提取表格数据
content.extractTables { tabId: 123, selector: "table.data" }
// 返回: [[row1], [row2], ...]

// 提取表单字段
content.extractForms { tabId: 123 }
// 返回: [{ action: "...", method: "...", fields: [...] }]

// 提取页面元数据
content.extractMetadata { tabId: 123 }
// 返回: { title, description, keywords, ogTags, ... }
```

---

## 书签和历史

管理浏览器书签和浏览历史。

### 书签操作

```javascript
// 获取书签树
bookmarks.getTree

// 搜索书签
bookmarks.search { query: "GitHub" }

// 创建书签
bookmarks.create {
  title: "My Bookmark",
  url: "https://example.com",
  parentId: "1"  // 书签栏
}

// 删除书签
bookmarks.remove { id: "123" }
```

### 历史操作

```javascript
// 搜索历史
history.search {
  text: "github",
  maxResults: 100,
  startTime: Date.now() - 7 * 24 * 60 * 60 * 1000  // 最近7天
}

// 获取URL访问记录
history.getVisits { url: "https://github.com" }

// 删除历史记录
history.delete { url: "https://example.com" }

// 清除所有历史
history.deleteAll
```

---

## Cookies 管理

读取、设置和清理 Cookie。

### Cookie 操作

```javascript
// 获取所有Cookie
cookies.getAll { domain: "github.com" }

// 获取特定Cookie
cookies.get {
  url: "https://github.com",
  name: "session_id"
}

// 设置Cookie
cookies.set {
  url: "https://example.com",
  name: "token",
  value: "abc123",
  expirationDate: Date.now() / 1000 + 3600,  // 1小时后过期
  httpOnly: true,
  secure: true
}

// 删除Cookie
cookies.remove {
  url: "https://example.com",
  name: "token"
}

// 清除域名所有Cookie
cookies.clear { domain: "example.com" }
```

---

## 下载管理

控制浏览器下载功能。

### 下载操作

```javascript
// 列出下载历史
downloads.list {
  query: "*.pdf",
  limit: 50
}

// 开始下载
downloads.download {
  url: "https://example.com/file.pdf",
  filename: "document.pdf",
  saveAs: false  // 不弹出保存对话框
}

// 暂停下载
downloads.pause { downloadId: 123 }

// 恢复下载
downloads.resume { downloadId: 123 }

// 取消下载
downloads.cancel { downloadId: 123 }

// 打开已下载文件
downloads.open { downloadId: 123 }

// 在文件夹中显示
downloads.show { downloadId: 123 }

// 删除下载记录
downloads.erase { downloadId: 123 }
```

---

## 网络拦截

拦截和修改网络请求，用于调试和测试。

### 请求控制

```javascript
// 启用网络拦截
network.enableInterception

// 禁用网络拦截
network.disableInterception

// 设置请求阻止规则
network.setRequestBlocking {
  patterns: ["*analytics*", "*tracking*"]
}

// 清除阻止规则
network.clearRequestBlocking

// 获取拦截的请求列表
network.getRequests { limit: 100 }
```

### Mock 响应

```javascript
// Mock API响应
network.mockResponse {
  urlPattern: "*/api/users",
  response: {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ users: [] })
  }
}
```

### 网络限流

```javascript
// 模拟慢速网络
network.setThrottling {
  profile: "3G"  // 或 "4G", "WiFi", "offline"
}

// 自定义限流
network.setThrottling {
  downloadThroughput: 500 * 1024,  // 500 KB/s
  uploadThroughput: 100 * 1024,    // 100 KB/s
  latency: 100                      // 100ms 延迟
}

// 离线模式
network.setOffline { offline: true }

// 清除限流
network.clearThrottling
```

---

## 高级调试工具

### WebSocket 调试

```javascript
// 启用WebSocket监控
websocket.enable

// 获取所有WS连接
websocket.getConnections

// 获取消息历史
websocket.getMessages { connectionId: "ws-1" }

// 发送WS消息
websocket.send {
  connectionId: "ws-1",
  message: JSON.stringify({ type: "ping" })
}

// 关闭连接
websocket.close { connectionId: "ws-1" }
```

### Service Worker 管理

```javascript
// 列出所有Service Worker
serviceWorker.list

// 获取SW详情
serviceWorker.getInfo { registrationId: "sw-1" }

// 注销SW
serviceWorker.unregister { registrationId: "sw-1" }

// 强制更新
serviceWorker.update { registrationId: "sw-1" }
```

### 内存分析

```javascript
// 获取内存信息
memory.getInfo;

// 堆快照
memory.takeHeapSnapshot;

// 启动内存采样
memory.startSampling;

// 停止采样并获取结果
memory.stopSampling;

// 强制垃圾回收
memory.forceGC;
```

### 代码覆盖率

```javascript
// 启动JS覆盖率追踪
coverage.startJSCoverage;

// 停止并获取JS覆盖率
coverage.stopJSCoverage;
// 返回每个脚本的使用/未使用字节数

// CSS覆盖率
coverage.startCSSCoverage;
coverage.stopCSSCoverage;
```

---

## 设备模拟

模拟移动设备、触摸操作和传感器。

### 设备模拟

```javascript
// 设置User-Agent
device.setUserAgent {
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)..."
}

// 设置地理位置
device.setGeolocation {
  latitude: 39.9042,
  longitude: 116.4074,
  accuracy: 100
}

// 设置时区
device.setTimezone { timezoneId: "Asia/Shanghai" }

// 设置语言
device.setLocale { locale: "zh-CN" }
```

### 视口和设备指标

```javascript
// 设置视口大小
viewport.set { width: 375, height: 812 }

// 使用预设设备
viewport.setDeviceMetrics {
  device: "iPhone 14 Pro"  // 或 "iPad Pro", "Pixel 7" 等
}

// 获取预设列表
viewport.getPresets
```

### 触摸模拟

```javascript
// 启用触摸模拟
touch.enable

// 单点触摸
touch.tap { x: 100, y: 200 }

// 滑动手势
touch.swipe {
  startX: 300, startY: 500,
  endX: 300, endY: 200,
  duration: 300
}

// 双指缩放
touch.pinch {
  centerX: 200, centerY: 300,
  scale: 0.5  // 缩小一半
}
```

### 传感器模拟

```javascript
// 设置设备方向（陀螺仪）
sensor.setOrientation {
  alpha: 0, beta: 0, gamma: 0
}

// 设置加速度计
sensor.setAccelerometer {
  x: 0, y: 9.8, z: 0
}

// 模拟环境光
sensor.setAmbientLight { illuminance: 500 }
```

---

## 媒体查询模拟

测试响应式设计和可访问性。

```javascript
// 模拟深色模式
media.emulateColorScheme { scheme: "dark" }

// 模拟减少动画
media.emulateReducedMotion { reduce: true }

// 模拟色盲
media.emulateVisionDeficiency {
  type: "deuteranopia"  // 绿色色盲
  // 可选: protanopia, tritanopia, achromatopsia, blurredVision
}

// 清除模拟
media.clearEmulation
```

---

## 截图和对比

```javascript
// 截取可见区域
screenshot.capture { format: "png", quality: 90 }

// 截取特定元素
screenshot.captureElement {
  selector: ".main-content",
  format: "png"
}

// 截取整个页面（滚动截图）
screenshot.captureFullPage { format: "png" }

// 对比两张截图
screenshot.compare {
  baseline: "screenshot1.png",
  current: "screenshot2.png",
  threshold: 0.1  // 10%差异阈值
}
```

---

## 事件系统

插件会自动推送浏览器事件到 Desktop：

| 事件               | 触发时机     | 数据                        |
| ------------------ | ------------ | --------------------------- |
| `tab.created`      | 新标签打开   | tabId, url, title           |
| `tab.closed`       | 标签关闭     | tabId                       |
| `tab.updated`      | URL/标题变化 | tabId, url, title, status   |
| `tab.activated`    | 标签激活     | tabId                       |
| `download.created` | 下载开始     | downloadId, url, filename   |
| `download.changed` | 下载状态变化 | downloadId, state, progress |

---

## 最佳实践

### 1. 等待元素加载

```javascript
// 不推荐：直接操作可能元素未加载
dom.click { selector: "#dynamic-btn" }

// 推荐：先等待元素出现
dom.waitForSelector { selector: "#dynamic-btn", timeout: 5000 }
dom.click { selector: "#dynamic-btn" }
```

### 2. 使用唯一选择器

```javascript
// 不推荐：可能匹配多个元素
dom.click { selector: "button" }

// 推荐：使用更精确的选择器
dom.click { selector: "button[data-testid='submit']" }
dom.click { selector: "#login-form button.primary" }
```

### 3. 处理动态内容

```javascript
// 等待AJAX加载完成
dom.waitForSelector { selector: ".data-loaded" }

// 或等待网络空闲
network.waitForIdle { timeout: 5000 }
```

### 4. 错误处理

所有命令返回标准化响应：

```javascript
// 成功响应
{
  "success": true,
  "data": { ... }
}

// 错误响应
{
  "success": false,
  "error": {
    "code": "ELEMENT_NOT_FOUND",
    "message": "Selector '#btn' not found"
  }
}
```

---

## 安全特性

### 本地通信限制

- WebSocket 仅监听 `127.0.0.1:18790`
- 不暴露到局域网或互联网
- 需要用户主动安装和启用插件

### 权限系统

插件请求的 Chrome 权限：

| 权限        | 用途         |
| ----------- | ------------ |
| `tabs`      | 标签管理     |
| `activeTab` | 当前标签操作 |
| `bookmarks` | 书签管理     |
| `history`   | 历史记录     |
| `cookies`   | Cookie 管理  |
| `downloads` | 下载管理     |
| `storage`   | 扩展存储     |
| `scripting` | 内容脚本注入 |
| `debugger`  | 高级调试功能 |

### 操作审计

所有命令执行都被记录，可在 Desktop 查看：

```
设置 → 远程控制 → 操作日志
```

---

## 故障排查

### 连接失败

1. **检查 Desktop 是否运行**
   - 确保 ChainlessChain Desktop 已启动
   - 检查系统托盘图标

2. **检查端口占用**

   ```bash
   # Windows
   netstat -an | findstr 18790

   # macOS/Linux
   lsof -i :18790
   ```

3. **防火墙设置**
   - 确保 18790 端口未被防火墙阻止（本地回环）

### 命令执行失败

1. **元素未找到**
   - 检查选择器是否正确
   - 页面是否完全加载
   - 元素是否在 iframe 中

2. **权限不足**
   - 检查插件权限设置
   - 某些页面（chrome://）无法操作

3. **超时错误**
   - 增加 timeout 参数
   - 检查网络连接

### 重置插件

1. 禁用并重新启用插件
2. 或完全删除后重新加载

---

## 下一步

- [Computer Use 功能](/chainlesschain/computer-use) - 桌面级自动化
- [远程控制系统](/chainlesschain/remote-control) - 完整远程控制文档
- [AI 模型配置](/chainlesschain/ai-models) - 配置 AI 调用插件功能

---

**让 AI 控制浏览器，实现真正的智能自动化** 🌐
