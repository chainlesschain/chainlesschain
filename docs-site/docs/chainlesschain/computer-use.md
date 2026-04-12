# Computer Use 功能

> **版本: v0.33.0 | 68+ IPC处理器 | 类似 Claude Computer Use**

## 概述

Computer Use 模块赋予 AI 直接操作电脑的能力，支持像素级坐标操作、Vision AI 元素定位、桌面截图与键鼠控制等功能。内置工作流引擎支持条件分支、循环和并行任务编排，配合安全模式（权限控制 + 区域限制 + 操作审计）确保自动化操作的安全可控。

## 核心特性

- 🖱️ **像素级坐标操作**: 精确鼠标点击、拖拽、滚轮、手势（缩放/旋转/滑动）
- 👁️ **Vision AI 元素定位**: 支持 Claude Vision / GPT-4V / LLaVA / Qwen-VL 多模型视觉定位
- 🖥️ **桌面级控制**: 截图、鼠标键盘控制、窗口管理，操作任意桌面应用
- 🔒 **安全模式**: 权限控制 + 区域限制 + 速率限制 + 操作审计，关键操作需确认
- 🔄 **工作流引擎**: 条件分支、循环执行、并行任务、子工作流，编排复杂自动化
- 🎬 **录制与回放**: 屏幕录制导出 GIF/MP4，操作回放支持断点调试和单步执行

## 系统架构

```
┌──────────────────────────────────────────────┐
│             Computer Use 系统                 │
├──────────────────────────────────────────────┤
│  ┌────────────┐  ┌────────────┐  ┌────────┐ │
│  │ Coordinate │  │ Vision     │  │Desktop │ │
│  │ Action     │  │ Action     │  │Action  │ │
│  │ (像素操作) │  │ (AI定位)   │  │(桌面)  │ │
│  └─────┬──────┘  └─────┬──────┘  └───┬────┘ │
│        └───────────────┼──────────────┘      │
│                        ↓                     │
│  ┌──────────────────────────────────────┐    │
│  │  WorkflowEngine (条件/循环/并行)     │    │
│  └──────────────┬───────────────────────┘    │
│        ┌────────┼────────┐                   │
│        ↓        ↓        ↓                   │
│  ┌──────┐ ┌────────┐ ┌────────────┐         │
│  │ Safe │ │ Audit  │ │ Screen     │         │
│  │ Mode │ │ Logger │ │ Recorder   │         │
│  └──────┘ └────────┘ └────────────┘         │
├──────────────────────────────────────────────┤
│  12 AI Tools | 68+ IPC Handlers             │
└──────────────────────────────────────────────┘
```

## 功能概述

### 与 Claude Computer Use 对比

| 特性         | ChainlessChain    | Claude Computer Use |
| ------------ | ----------------- | ------------------- |
| 浏览器控制   | ✅ 完整支持       | ✅ 支持             |
| 桌面控制     | ✅ 完整支持       | ✅ 支持             |
| Shadow DOM   | ✅ 支持           | ❌ 有限             |
| 多语言 OCR   | ✅ 10+ 语言       | ✅ 支持             |
| 工作流引擎   | ✅ 条件/循环/并行 | ❌ 不支持           |
| 操作录制回放 | ✅ 断点调试       | ❌ 不支持           |
| 安全模式     | ✅ 权限/区域限制  | ⚠️ 基础             |
| 操作审计     | ✅ 风险评估       | ⚠️ 基础             |
| 本地运行     | ✅ 完全本地       | ❌ 云端             |
| 隐私保护     | ✅ 数据不离开设备 | ⚠️ 需上传截图       |

### 核心模块

```
Computer Use System
├── CoordinateAction      # 像素级坐标操作
├── VisionAction          # 视觉AI元素定位
├── NetworkInterceptor    # 网络请求拦截
├── DesktopAction         # 桌面级操作
├── AuditLogger          # 操作审计日志
├── ScreenRecorder       # 屏幕录制
├── ActionReplay         # 操作回放引擎
├── SafeMode             # 安全模式控制
├── WorkflowEngine       # 工作流引擎
├── ElementHighlighter   # 元素高亮显示
├── TemplateActions      # 预定义操作模板
└── ComputerUseMetrics   # 性能指标收集
```

---

## 坐标操作 (CoordinateAction)

像素级精确的鼠标和手势操作。

### 点击操作

```javascript
// 单击指定坐标
coordinate.click { x: 500, y: 300 }

// 双击
coordinate.doubleClick { x: 500, y: 300 }

// 右键点击
coordinate.rightClick { x: 500, y: 300 }

// 中键点击
coordinate.middleClick { x: 500, y: 300 }
```

### 拖拽操作

```javascript
// 拖拽从A点到B点
coordinate.drag {
  startX: 100, startY: 100,
  endX: 500, endY: 300,
  duration: 500  // 拖拽时间(ms)
}

// 拖放到元素
coordinate.dragToElement {
  startX: 100, startY: 100,
  targetSelector: ".drop-zone"
}
```

### 滚动操作

```javascript
// 滚轮滚动
coordinate.scroll {
  x: 500, y: 300,
  deltaY: -300  // 负值向上，正值向下
}

// 平滑滚动
coordinate.smoothScroll {
  x: 500, y: 300,
  deltaY: -500,
  duration: 300
}

// 水平滚动
coordinate.horizontalScroll {
  x: 500, y: 300,
  deltaX: 200
}
```

### 手势操作

```javascript
// 两指缩放
coordinate.pinch {
  centerX: 400, centerY: 300,
  scale: 1.5,  // 放大1.5倍
  duration: 300
}

// 旋转手势
coordinate.rotate {
  centerX: 400, centerY: 300,
  angle: 45,  // 旋转45度
  duration: 300
}

// 滑动手势
coordinate.swipe {
  startX: 300, startY: 500,
  endX: 300, endY: 100,
  duration: 200
}
```

---

## 视觉操作 (VisionAction)

基于 Vision AI 的智能元素定位和操作。

### 支持的视觉模型

| 模型          | 提供商    | 特点               |
| ------------- | --------- | ------------------ |
| Claude Vision | Anthropic | 高精度，中文支持好 |
| GPT-4V        | OpenAI    | 通用性强           |
| LLaVA         | 本地      | 隐私保护，离线可用 |
| Qwen-VL       | 阿里      | 中文优化           |

### 视觉元素定位

```javascript
// 通过描述定位元素
vision.findElement {
  description: "蓝色的登录按钮",
  model: "claude"  // 或 "gpt4v", "llava"
}
// 返回: { x: 500, y: 300, confidence: 0.95, boundingBox: {...} }

// 定位并点击
vision.clickElement {
  description: "提交订单按钮"
}

// 定位多个元素
vision.findAllElements {
  description: "产品卡片"
}
// 返回: [{ x, y, confidence }, ...]
```

### 截图分析

```javascript
// 分析当前屏幕
vision.analyzeScreen {
  prompt: "描述页面上的主要内容和布局"
}

// 分析特定区域
vision.analyzeRegion {
  x: 100, y: 100,
  width: 800, height: 600,
  prompt: "这个表格包含哪些数据？"
}

// OCR 文字识别
vision.extractText {
  x: 100, y: 100,
  width: 400, height: 50,
  language: "chi_sim+eng"  // 中英文混合
}
```

### 元素验证

```javascript
// 验证元素是否存在
vision.verifyElement {
  description: "登录成功提示",
  timeout: 5000
}

// 等待元素出现
vision.waitForElement {
  description: "加载完成的表格",
  timeout: 10000,
  interval: 500
}

// 比较屏幕变化
vision.compareScreens {
  baseline: "before.png",
  threshold: 0.1  // 10%差异阈值
}
```

---

## 桌面操作 (DesktopAction)

桌面级的截图、鼠标键盘控制和窗口管理。

### 截图

```javascript
// 截取整个屏幕
desktop.screenshot
// 返回: { base64: "...", width: 1920, height: 1080 }

// 截取特定区域
desktop.screenshotRegion {
  x: 100, y: 100,
  width: 800, height: 600
}

// 截取特定窗口
desktop.screenshotWindow {
  windowTitle: "Visual Studio Code"
}
```

### 鼠标控制

```javascript
// 移动鼠标
desktop.moveMouse { x: 500, y: 300 }

// 点击
desktop.click { x: 500, y: 300, button: "left" }

// 获取鼠标位置
desktop.getMousePosition
// 返回: { x: 500, y: 300 }
```

### 键盘控制

```javascript
// 输入文本
desktop.type { text: "Hello World" }

// 按键
desktop.keyPress { key: "Enter" }

// 组合键
desktop.keyCombo { keys: ["ctrl", "s"] }

// 热键
desktop.hotkey { modifiers: ["ctrl", "shift"], key: "n" }
```

### 窗口管理

```javascript
// 获取所有窗口
desktop.getWindows
// 返回: [{ title, x, y, width, height, focused }, ...]

// 激活窗口
desktop.focusWindow { title: "Chrome" }

// 移动窗口
desktop.moveWindow {
  title: "Notepad",
  x: 100, y: 100
}

// 调整窗口大小
desktop.resizeWindow {
  title: "Notepad",
  width: 800, height: 600
}

// 最大化/最小化
desktop.maximizeWindow { title: "Chrome" }
desktop.minimizeWindow { title: "Chrome" }
```

---

## 操作审计 (AuditLogger)

完整的操作日志和风险评估。

### 风险级别

| 级别     | 说明       | 示例操作           |
| -------- | ---------- | ------------------ |
| LOW      | 低风险只读 | 截图、获取信息     |
| MEDIUM   | 中风险操作 | 点击、输入文本     |
| HIGH     | 高风险操作 | 文件删除、系统设置 |
| CRITICAL | 关键操作   | 密码输入、支付确认 |

### 审计日志

```javascript
// 获取审计日志
audit.getLogs {
  startTime: Date.now() - 24 * 60 * 60 * 1000,  // 最近24小时
  riskLevel: "HIGH"  // 只看高风险
}

// 导出审计日志
audit.exportLogs {
  format: "json",  // 或 "csv"
  path: "/path/to/audit.json"
}
```

### 敏感信息脱敏

审计日志自动脱敏敏感信息：

```javascript
// 原始操作
desktop.type { text: "password123" }

// 审计日志中显示
{
  "action": "desktop.type",
  "params": { "text": "[REDACTED]" },
  "riskLevel": "CRITICAL",
  "timestamp": "2026-02-11T10:30:00Z"
}
```

---

## 屏幕录制 (ScreenRecorder)

录制操作过程，支持回放和导出。

### 录制控制

```javascript
// 开始录制
recorder.start {
  fps: 10,  // 每秒10帧
  quality: 0.8,
  region: { x: 0, y: 0, width: 1920, height: 1080 }
}

// 暂停/恢复录制
recorder.pause
recorder.resume

// 停止录制
recorder.stop
// 返回: { frameCount: 300, duration: 30000, path: "..." }

// 获取录制状态
recorder.getStatus
// 返回: { recording: true, paused: false, frameCount: 150 }
```

### 录制导出

```javascript
// 导出为截图序列
recorder.exportFrames {
  outputDir: "/path/to/frames",
  format: "png"
}

// 导出为GIF
recorder.exportGif {
  path: "/path/to/recording.gif",
  fps: 5,
  scale: 0.5
}

// 导出为视频 (需要 ffmpeg)
recorder.exportVideo {
  path: "/path/to/recording.mp4",
  fps: 30,
  codec: "h264"
}
```

---

## 操作回放 (ActionReplay)

回放录制的操作序列，支持调试。

### 基本回放

```javascript
// 加载操作序列
replay.load { path: "/path/to/actions.json" }

// 开始回放
replay.start { speed: 1.0 }  // 1.0x 速度

// 暂停/继续
replay.pause
replay.resume

// 停止
replay.stop
```

### 调试功能

```javascript
// 设置断点
replay.setBreakpoint { actionIndex: 10 }

// 单步执行
replay.stepForward
replay.stepBackward

// 跳转到指定步骤
replay.goToAction { index: 5 }

// 变速回放
replay.setSpeed { speed: 2.0 }  // 2倍速
replay.setSpeed { speed: 0.5 }  // 0.5倍速
```

### 操作编辑

```javascript
// 插入操作
replay.insertAction {
  index: 5,
  action: { type: "click", x: 500, y: 300 }
}

// 删除操作
replay.deleteAction { index: 5 }

// 修改操作
replay.modifyAction {
  index: 5,
  action: { type: "click", x: 600, y: 400 }
}

// 保存修改
replay.save { path: "/path/to/actions-modified.json" }
```

---

## 安全模式 (SafeMode)

权限控制和操作限制，确保安全使用。

### 安全模式设置

```javascript
// 启用安全模式
safeMode.enable {
  level: "strict"  // "permissive", "normal", "strict"
}

// 禁用安全模式
safeMode.disable

// 获取当前状态
safeMode.getStatus
```

### 权限控制

```javascript
// 设置允许的操作类型
safeMode.setAllowedActions {
  actions: ["screenshot", "click", "type"]
}

// 禁止特定操作
safeMode.setBlockedActions {
  actions: ["deleteFile", "modifySystemSettings"]
}

// 设置需要确认的操作
safeMode.setConfirmRequired {
  actions: ["payment", "formSubmit"],
  message: "是否确认执行此操作？"
}
```

### 区域限制

```javascript
// 限制操作区域
safeMode.setAllowedRegion {
  x: 0, y: 0,
  width: 1920, height: 1000  // 排除任务栏
}

// 设置禁止区域
safeMode.setBlockedRegions {
  regions: [
    { x: 0, y: 0, width: 100, height: 100 },  // 开始菜单
    { x: 1820, y: 0, width: 100, height: 50 } // 系统托盘
  ]
}
```

### 速率限制

```javascript
// 设置操作速率限制
safeMode.setRateLimit {
  maxActionsPerSecond: 10,
  maxActionsPerMinute: 200
}

// 设置冷却时间
safeMode.setCooldown {
  afterClick: 100,    // 点击后100ms冷却
  afterType: 50,      // 输入后50ms冷却
  afterScroll: 200    // 滚动后200ms冷却
}
```

---

## 工作流引擎 (WorkflowEngine)

创建和执行复杂的自动化工作流。

### 工作流定义

```javascript
// 创建工作流
workflow.create {
  name: "登录并提交表单",
  steps: [
    { action: "navigate", url: "https://example.com/login" },
    { action: "type", selector: "#username", text: "user" },
    { action: "type", selector: "#password", text: "${PASSWORD}" },
    { action: "click", selector: "#login-btn" },
    { action: "waitForNavigation" },
    { action: "click", selector: "#submit-form" }
  ]
}

// 运行工作流
workflow.run { name: "登录并提交表单" }
```

### 条件分支

```javascript
{
  "name": "智能处理流程",
  "steps": [
    { "action": "screenshot" },
    {
      "action": "condition",
      "if": { "vision.findElement": "错误提示" },
      "then": [
        { "action": "click", "description": "关闭按钮" },
        { "action": "retry", "times": 3 }
      ],
      "else": [
        { "action": "continue" }
      ]
    }
  ]
}
```

### 循环执行

```javascript
{
  "name": "批量处理",
  "steps": [
    {
      "action": "loop",
      "items": ["item1", "item2", "item3"],
      "as": "item",
      "do": [
        { "action": "type", "selector": "#search", "text": "${item}" },
        { "action": "click", "selector": "#search-btn" },
        { "action": "wait", "ms": 1000 },
        { "action": "screenshot", "name": "${item}.png" }
      ]
    }
  ]
}
```

### 并行执行

```javascript
{
  "name": "并行任务",
  "steps": [
    {
      "action": "parallel",
      "tasks": [
        { "workflow": "任务A" },
        { "workflow": "任务B" },
        { "workflow": "任务C" }
      ],
      "waitAll": true  // 等待所有任务完成
    }
  ]
}
```

### 子工作流

```javascript
{
  "name": "主流程",
  "steps": [
    { "action": "subworkflow", "name": "登录流程" },
    { "action": "subworkflow", "name": "数据采集" },
    { "action": "subworkflow", "name": "报告生成" }
  ]
}
```

---

## 元素高亮 (ElementHighlighter)

调试和演示时高亮显示元素。

```javascript
// 高亮元素
highlight.show {
  selector: "#target-element",
  color: "rgba(255, 0, 0, 0.5)",
  duration: 3000  // 3秒后消失
}

// 高亮区域
highlight.showRegion {
  x: 100, y: 100,
  width: 200, height: 50,
  label: "点击这里"
}

// 显示操作轨迹
highlight.showPath {
  points: [
    { x: 100, y: 100 },
    { x: 300, y: 200 },
    { x: 500, y: 300 }
  ],
  duration: 2000
}

// 清除所有高亮
highlight.clear
```

---

## 操作模板 (TemplateActions)

预定义的常用操作模板。

### 内置模板

```javascript
// 网页登录
template.execute {
  name: "webLogin",
  params: {
    url: "https://example.com/login",
    username: "user",
    password: "${PASSWORD}",
    usernameSelector: "#username",
    passwordSelector: "#password",
    submitSelector: "#login-btn"
  }
}

// 表单填写
template.execute {
  name: "fillForm",
  params: {
    fields: {
      "#name": "张三",
      "#email": "zhang@example.com",
      "#phone": "13800138000"
    }
  }
}

// 文件下载
template.execute {
  name: "downloadFile",
  params: {
    url: "https://example.com/file.pdf",
    savePath: "/downloads/file.pdf"
  }
}

// 数据采集
template.execute {
  name: "scrapeData",
  params: {
    url: "https://example.com/list",
    itemSelector: ".item",
    fields: {
      title: ".title",
      price: ".price",
      link: "a@href"
    }
  }
}
```

### 自定义模板

```javascript
// 创建模板
template.create {
  name: "myTemplate",
  description: "自定义操作模板",
  params: ["url", "keyword"],
  steps: [
    { "action": "navigate", "url": "${url}" },
    { "action": "type", "selector": "#search", "text": "${keyword}" },
    { "action": "click", "selector": "#search-btn" }
  ]
}

// 列出所有模板
template.list

// 删除模板
template.delete { name: "myTemplate" }
```

---

## AI 工具集成

Computer Use 提供 12 个 AI 可调用的工具。

### 工具列表

| 工具名               | 功能       | 示例             |
| -------------------- | ---------- | ---------------- |
| `browser_click`      | 浏览器点击 | 点击按钮、链接   |
| `visual_click`       | 视觉点击   | 根据描述点击元素 |
| `browser_type`       | 输入文本   | 填写表单         |
| `browser_key`        | 按键操作   | 快捷键、回车     |
| `browser_scroll`     | 滚动页面   | 上下滚动         |
| `browser_screenshot` | 浏览器截图 | 获取页面状态     |
| `analyze_page`       | 页面分析   | AI 理解页面内容  |
| `browser_navigate`   | 页面导航   | 打开 URL         |
| `browser_wait`       | 等待操作   | 等待元素加载     |
| `desktop_screenshot` | 桌面截图   | 获取整个屏幕     |
| `desktop_click`      | 桌面点击   | 点击任意位置     |
| `desktop_type`       | 桌面输入   | 输入到任意应用   |

### 使用示例

在 AI 对话中：

```
用户: 帮我在 GitHub 上搜索 chainlesschain 项目

AI: 我来帮您在 GitHub 上搜索。

[调用 browser_navigate { url: "https://github.com" }]
已打开 GitHub 首页。

[调用 browser_screenshot]
看到了 GitHub 首页，有搜索框在顶部。

[调用 browser_type { selector: "input[name=q]", text: "chainlesschain" }]
已输入搜索关键词。

[调用 browser_key { key: "Enter" }]
已按下回车执行搜索。

[调用 browser_wait { selector: ".repo-list" }]
搜索结果已加载。

[调用 browser_screenshot]
找到了 chainlesschain 相关的仓库，第一个结果是...
```

---

## 前端组件

### ComputerUsePanel

位于 `src/renderer/components/browser/ComputerUsePanel.vue`

功能：

- 实时屏幕预览
- 操作历史列表
- 工作流管理
- 录制控制面板
- 安全模式切换

### 使用方式

```vue
<template>
  <ComputerUsePanel
    :showPreview="true"
    :enableRecording="true"
    @action="handleAction"
  />
</template>
```

---

## IPC 处理器

Computer Use 系统提供 68+ 个 IPC 处理器：

| 模块     | 处理器数 | 前缀           |
| -------- | -------- | -------------- |
| 审计日志 | 5        | `audit:*`      |
| 屏幕录制 | 10       | `recorder:*`   |
| 操作回放 | 8        | `replay:*`     |
| 安全模式 | 7        | `safeMode:*`   |
| 工作流   | 11       | `workflow:*`   |
| 坐标操作 | 10       | `coordinate:*` |
| 视觉操作 | 8        | `vision:*`     |
| 桌面操作 | 9        | `desktop:*`    |

---

## 最佳实践

### 1. 始终使用安全模式

```javascript
// 推荐：启用安全模式
safeMode.enable { level: "normal" }

// 设置合理的速率限制
safeMode.setRateLimit { maxActionsPerSecond: 5 }
```

### 2. 使用视觉定位替代坐标

```javascript
// 不推荐：硬编码坐标，分辨率变化会失效
coordinate.click { x: 500, y: 300 }

// 推荐：使用视觉定位
vision.clickElement { description: "蓝色提交按钮" }
```

### 3. 添加等待和验证

```javascript
// 不推荐：直接操作
browser_click { selector: "#btn" }

// 推荐：等待 + 验证
browser_wait { selector: "#btn", timeout: 5000 }
browser_click { selector: "#btn" }
vision.verifyElement { description: "操作成功提示" }
```

### 4. 利用工作流管理复杂任务

```javascript
// 不推荐：在对话中执行多步操作
// 推荐：创建工作流，一次执行
workflow.create { name: "完整流程", steps: [...] }
workflow.run { name: "完整流程" }
```

---

## 下一步

- [浏览器插件](/chainlesschain/browser-extension) - 浏览器扩展安装和使用
- [AI 模型配置](/chainlesschain/ai-models) - 配置视觉 AI 模型
- [Cowork 多智能体](/chainlesschain/cowork) - AI 代理协作执行任务

## 关键文件

| 文件 | 说明 |
| --- | --- |
| `desktop-app-vue/src/main/browser/computer-use.js` | Computer Use 核心模块 |
| `desktop-app-vue/src/main/browser/coordinate-action.js` | 像素级坐标操作 |
| `desktop-app-vue/src/main/browser/vision-action.js` | Vision AI 元素定位 |
| `desktop-app-vue/src/main/browser/desktop-action.js` | 桌面截图与鼠标键盘控制 |
| `desktop-app-vue/src/main/browser/workflow-engine.js` | 工作流引擎（条件/循环/并行） |
| `desktop-app-vue/src/main/browser/safe-mode.js` | 安全模式与权限控制 |
| `desktop-app-vue/src/main/browser/screen-recorder.js` | 屏幕录制与导出 |
| `desktop-app-vue/src/renderer/components/browser/ComputerUsePanel.vue` | 前端操作面板 |

## 故障排查

### 桌面截图失败

**现象**: `desktop.screenshot` 返回空白图像或抛出异常。

**排查步骤**:

1. 确认应用以管理员权限运行（截图需要屏幕访问权限）
2. macOS 需在「系统偏好设置 → 隐私与安全性 → 屏幕录制」中授权 ChainlessChain
3. 检查显示器 DPI 缩放设置，可能影响截图坐标计算
4. 多显示器环境下确认截图的目标屏幕编号

### 视觉定位不准确

**现象**: `vision.findElement` 返回的坐标偏移或置信度低。

**排查步骤**:

1. 确认 Vision AI 模型已正确配置（Claude Vision / GPT-4V / LLaVA）
2. 检查截图清晰度，低分辨率或模糊截图会降低识别精度
3. 使用更具描述性的定位文本，避免歧义（如"蓝色圆角提交按钮"优于"按钮"）
4. 在高 DPI 屏幕上调整 `defaultViewport` 确保截图比例正确

### 工作流执行中断

**现象**: 工作流在某步骤卡住或超时。

**排查步骤**:

1. 检查 `workflow.getStatus` 确认当前停留的步骤和错误信息
2. 条件分支中的视觉判断可能因页面变化失效，更新判断条件
3. 增大 `wait` 步骤的超时时间以适应网络延迟
4. 启用 `pauseOnError` 便于单步调试定位问题

### 录制回放失效

**现象**: 回放时操作目标位置不正确。

**排查步骤**:

1. 确认回放时的窗口大小和分辨率与录制时一致
2. 页面布局变化可能导致坐标失效，改用选择器或视觉定位替代硬编码坐标
3. 检查回放速度设置，过快可能导致页面来不及响应

## 安全考虑

1. **安全模式必开**: 生产环境务必启用 SafeMode，设置合理的权限和速率限制
2. **区域限制**: 使用 `setBlockedRegions` 禁止操作系统关键区域（任务栏、系统托盘）
3. **敏感操作确认**: 涉及文件删除、支付确认等高风险操作需设置 `confirmRequired`
4. **审计日志**: 所有 Computer Use 操作自动记录审计日志，定期审查异常操作
5. **操作审计脱敏**: 密码输入等敏感信息在审计日志中自动标记为 `[REDACTED]`
6. **速率限制**: 设置每秒/每分钟最大操作数，防止自动化脚本失控
7. **网络隔离**: 桌面操作可能触及敏感应用，建议在独立用户会话中执行自动化任务
8. **权限最小化**: 为不同自动化任务配置最小必要的操作权限集合

## 相关文档

- [浏览器自动化](/chainlesschain/browser-automation) - Puppeteer 引擎网页自动化
- [浏览器插件](/chainlesschain/browser-extension) - 浏览器扩展 215 个命令
- [Cowork 多智能体](/chainlesschain/cowork) - AI 代理协作执行任务

---

**让 AI 成为您的数字助手，解放双手** 🖥️
