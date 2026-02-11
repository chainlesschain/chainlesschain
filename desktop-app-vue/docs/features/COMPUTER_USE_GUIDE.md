# Computer Use 能力指南

> 版本: v0.33.0 | 状态: ✅ 已实现

ChainlessChain 实现了类似 Claude Computer Use 的电脑操作能力，支持浏览器自动化和桌面级操作。

## 概述

### 与 Claude Computer Use 对比

| 能力       | Claude Computer Use | ChainlessChain | 备注                |
| ---------- | ------------------- | -------------- | ------------------- |
| 屏幕截图   | ✅                  | ✅             | 支持浏览器和桌面级  |
| 坐标点击   | ✅                  | ✅             | 像素级精确控制      |
| 键盘输入   | ✅                  | ✅             | 支持快捷键组合      |
| 鼠标拖拽   | ✅                  | ✅             | 平滑拖拽            |
| 视觉理解   | ✅ Claude Vision    | ✅ 多模型支持  | Claude/GPT-4V/LLaVA |
| 元素定位   | ✅                  | ✅ 6层降级     | 更稳定              |
| Shadow DOM | ❌                  | ✅             | 独有优势            |
| 网络拦截   | ❌                  | ✅             | 独有优势            |
| 工作流引擎 | ❌                  | ✅             | 独有优势            |
| 录制回放   | ❌                  | ✅             | 独有优势            |
| 安全模式   | ❌                  | ✅             | 权限控制和限制      |
| 审计日志   | ❌                  | ✅             | 操作追踪和合规      |
| 元素高亮   | ❌                  | ✅             | 可视化调试          |
| 模板操作   | ❌                  | ✅             | 常用任务快速执行    |
| 性能指标   | ❌                  | ✅             | 统计和分析          |
| 剪贴板管理 | ❌                  | ✅             | 历史、敏感过滤      |
| 文件处理   | ❌                  | ✅             | 下载上传管理        |
| 通知系统   | ❌                  | ✅             | 模板、静默时段      |
| 桌面操作   | ✅                  | ✅             | 需要 robotjs        |

## 核心模块

### 1. 坐标级操作 (CoordinateAction)

像素级精确控制鼠标和触控操作。

```javascript
const { CoordinateAction, MouseButton, GestureType } = require("./actions");

const coordAction = new CoordinateAction(browserEngine);

// 点击指定坐标
await coordAction.clickAt(targetId, 500, 300);

// 双击
await coordAction.doubleClickAt(targetId, 500, 300);

// 右键点击
await coordAction.rightClickAt(targetId, 500, 300);

// 平滑移动鼠标
await coordAction.moveTo(targetId, 800, 400, { smooth: true, steps: 20 });

// 拖拽操作
await coordAction.dragFromTo(targetId, 100, 100, 500, 500, { smooth: true });

// 手势操作
await coordAction.gesture(targetId, GestureType.SWIPE_UP, { distance: 300 });

// 在指定位置滚动
await coordAction.scrollAt(targetId, 500, 300, 0, 200);

// 绘制路径（用于 Canvas）
await coordAction.drawPath(targetId, [
  { x: 100, y: 100 },
  { x: 200, y: 150 },
  { x: 300, y: 100 },
]);
```

### 2. Vision AI 操作 (VisionAction)

集成视觉 AI 能力，支持视觉元素定位和页面理解。

```javascript
const { VisionAction, VisionModel } = require("./actions");

const visionAction = new VisionAction(browserEngine, llmService);

// 分析页面
const analysis = await visionAction.analyze(
  targetId,
  "这个页面的主要功能是什么？",
);

// 定位元素（视觉方式）
const location = await visionAction.locateElement(targetId, "红色的登录按钮");
// 返回: { found: true, confidence: 0.95, element: { x, y, width, height } }

// 视觉引导点击（找到并点击）
await visionAction.visualClick(targetId, "搜索图标");

// 描述页面
const description = await visionAction.describePage(targetId);

// 与基线截图对比
const comparison = await visionAction.compareWithBaseline(
  targetId,
  baselineBase64,
);

// 执行多步视觉任务
const taskResult = await visionAction.executeVisualTask(
  targetId,
  '在搜索框中输入"人工智能"并点击搜索按钮',
);
```

**支持的 Vision 模型：**

- `claude-3-5-sonnet-20241022` (默认)
- `claude-3-opus-20240229`
- `gpt-4-vision-preview`
- `gpt-4o`
- `llava:13b` (本地 Ollama)

### 3. 网络拦截 (NetworkInterceptor)

拦截和控制网络请求。

```javascript
const {
  NetworkInterceptor,
  NetworkCondition,
  InterceptType,
} = require("./actions");

const interceptor = new NetworkInterceptor(browserEngine);

// 启用拦截
await interceptor.enableInterception(targetId);

// 添加拦截规则
interceptor.addRule({
  urlPattern: "**/api/users",
  type: InterceptType.MOCK,
  response: {
    status: 200,
    body: JSON.stringify({ users: [] }),
  },
});

// 模拟 API 响应
interceptor.mockAPI("**/api/login", {
  status: 200,
  body: { success: true, token: "mock-token" },
});

// 阻止特定资源
interceptor.blockResourceTypes(targetId, ["image", "media"]);

// 设置网络条件（模拟慢速网络）
await interceptor.setNetworkCondition(targetId, NetworkCondition.SLOW_3G);

// 等待特定请求
const request = await interceptor.waitForRequest(targetId, "/api/submit");

// 获取请求日志
const log = interceptor.getRequestLog({ limit: 50 });
```

**网络条件预设：**

- `OFFLINE` - 离线
- `SLOW_2G` / `GOOD_2G`
- `SLOW_3G` / `FAST_3G`
- `SLOW_4G` / `FAST_4G`
- `WIFI`
- `NO_THROTTLE` - 不限速

### 4. 桌面操作 (DesktopAction)

操作浏览器外的桌面应用。

```javascript
const { DesktopAction, SpecialKey, Modifier } = require("./actions");

const desktop = new DesktopAction();

// 获取屏幕信息
const screenInfo = desktop.getScreenInfo();

// 截取桌面屏幕
const capture = await desktop.captureScreen({ displayId: 0 });

// 桌面点击
await desktop.click(500, 300);
await desktop.click(500, 300, { button: "right" });
await desktop.click(500, 300, { double: true });

// 平滑移动鼠标
await desktop.moveMouse(800, 400, { smooth: true });

// 拖拽
await desktop.drag(100, 100, 500, 500);

// 输入文本
await desktop.typeText("Hello World");
await desktop.typeText("你好世界", { useClipboard: true }); // 中文使用剪贴板

// 按键
await desktop.pressKey("enter");
await desktop.pressKey("c", ["control"]); // Ctrl+C
await desktop.executeShortcut("Ctrl+Shift+S");

// 剪贴板操作
desktop.setClipboard("复制的文本", "text");
const clipboardContent = desktop.getClipboard("text");

// 获取像素颜色
const color = desktop.getPixelColor(100, 100);

// 窗口管理
const windows = desktop.getAllWindows();
desktop.focusWindow(windowId);
desktop.setWindowBounds(windowId, { x: 0, y: 0, width: 800, height: 600 });
```

**注意：** 桌面操作需要安装 `robotjs` 依赖：

```bash
npm install robotjs
```

### 5. 统一代理 (ComputerUseAgent)

整合所有能力的统一接口。

```javascript
const { ComputerUseAgent, ActionType } = require("./computer-use-agent");

// 创建并初始化
const agent = new ComputerUseAgent();
await agent.initialize();

// 打开页面
await agent.openTab("https://example.com");

// 执行操作
await agent.execute({ type: ActionType.CLICK, x: 500, y: 300 });
await agent.execute({ type: ActionType.TYPE, text: "Hello" });
await agent.execute({ type: ActionType.KEY, key: "Enter" });
await agent.execute({ type: ActionType.SCROLL, deltaY: 300 });

// 视觉操作
await agent.execute({
  type: ActionType.VISION_CLICK,
  description: "提交按钮",
});

// 执行自然语言任务
const result = await agent.executeTask('在搜索框输入"AI"并点击搜索');

// 获取状态
const status = agent.getStatus();

// 关闭
await agent.close();
```

## IPC 接口

### 浏览器坐标操作

```javascript
// 渲染进程调用
await window.api.invoke("browser:action:coordinate", targetId, {
  action: "click",
  x: 500,
  y: 300,
});
```

### Vision AI 操作

```javascript
await window.api.invoke("browser:action:vision", targetId, {
  task: "analyze",
  prompt: "描述这个页面",
});

// 视觉点击
await window.api.invoke("browser:visualClick", targetId, "红色按钮");
```

### 网络拦截

```javascript
await window.api.invoke("browser:network", targetId, {
  action: "enable",
});

await window.api.invoke("browser:network", targetId, {
  action: "mockAPI",
  urlPattern: "**/api/test",
  response: { status: 200, body: { data: "mocked" } },
});
```

### 桌面操作

```javascript
// 截图
await window.api.invoke("browser:desktop:capture");

// 点击
await window.api.invoke("browser:desktop:click", 500, 300);

// 输入
await window.api.invoke("browser:desktop:type", "Hello");

// 按键
await window.api.invoke("browser:desktop:key", "enter", ["control"]);
```

## 使用场景

### 1. 自动化测试

```javascript
// 端到端测试
await agent.openTab("https://app.example.com/login");
await agent.execute({ type: "vision_click", description: "用户名输入框" });
await agent.execute({ type: "type", text: "testuser" });
await agent.execute({ type: "vision_click", description: "密码输入框" });
await agent.execute({ type: "type", text: "password123" });
await agent.execute({ type: "vision_click", description: "登录按钮" });
```

### 2. RPA 流程自动化

```javascript
// 自动填写表单
await agent.executeTask(
  "填写联系表单：姓名张三，邮箱test@example.com，提交表单",
);
```

### 3. 网页数据采集

```javascript
// 启用网络拦截，获取 API 响应
await interceptor.enableInterception(targetId);
const response = await interceptor.waitForResponse(targetId, "/api/products");
console.log(response.body);
```

### 4. 视觉回归测试

```javascript
// 对比页面变化
const comparison = await visionAction.compareWithBaseline(
  targetId,
  baselineScreenshot,
);
if (comparison.similarity < 95) {
  console.log("检测到视觉变化:", comparison.changes);
}
```

## 最佳实践

1. **优先使用元素引用**：当有明确的 DOM 元素时，优先使用快照中的元素引用，比坐标更稳定
2. **视觉操作作为后备**：当元素定位失败时，使用视觉 AI 作为后备方案
3. **网络拦截用于调试**：在开发和测试阶段使用网络拦截来模拟各种场景
4. **桌面操作谨慎使用**：桌面操作可能影响其他应用，仅在必要时使用
5. **错误时截图**：配置 `screenshotOnError: true` 以便调试失败的操作

## 依赖要求

- **playwright-core**: 浏览器自动化核心
- **robotjs** (可选): 桌面级操作支持
- **tesseract.js**: OCR 文字识别
- **sharp**: 图像处理

```bash
npm install playwright-core robotjs tesseract.js sharp
```

## AI 工具集成

Computer Use 工具已集成到 AI 引擎的 Function Calling 框架中，AI 可以自动调用这些工具。

### 工具列表

| 工具名               | 描述     | 参数                     |
| -------------------- | -------- | ------------------------ |
| `browser_click`      | 坐标点击 | x, y, button, clickCount |
| `visual_click`       | 视觉点击 | description              |
| `browser_type`       | 键盘输入 | text                     |
| `browser_key`        | 按键操作 | key, modifiers           |
| `browser_scroll`     | 滚动     | direction, amount        |
| `browser_screenshot` | 截图     | fullPage                 |
| `analyze_page`       | 页面分析 | prompt                   |
| `browser_navigate`   | 导航     | url                      |
| `browser_wait`       | 等待     | duration, selector       |
| `desktop_screenshot` | 桌面截图 | displayId                |
| `desktop_click`      | 桌面点击 | x, y, button, double     |
| `desktop_type`       | 桌面输入 | text                     |

### AI 对话中使用

AI 可以在对话中自动调用这些工具：

```
用户: 帮我打开 Google 并搜索"人工智能"

AI: 好的，我来帮你完成这个任务。
[调用 browser_navigate 打开 Google]
[调用 visual_click 点击搜索框]
[调用 browser_type 输入"人工智能"]
[调用 browser_key 按下 Enter]
搜索完成！
```

## 审计日志 (AuditLogger)

记录所有 Computer Use 操作，用于安全审计、操作回放、问题排查。

```javascript
const { getAuditLogger, OperationType, RiskLevel } = require("./actions");

const auditLogger = getAuditLogger();

// 手动记录操作
await auditLogger.log({
  type: OperationType.MOUSE_CLICK,
  action: "click",
  params: { x: 100, y: 200 },
  success: true,
  duration: 50,
  targetId: "tab_123",
  url: "https://example.com",
});

// 使用包装器自动记录
const wrappedClick = auditLogger.wrap(
  OperationType.MOUSE_CLICK,
  async (params) => {
    // 执行点击操作
    return { success: true };
  },
);
await wrappedClick({ x: 100, y: 200 });

// 查询日志
const recentLogs = auditLogger.query({ limit: 50 });
const highRisk = auditLogger.getHighRiskOperations();
const failures = auditLogger.getFailedOperations();

// 导出
const jsonExport = auditLogger.export("json");
const csvExport = auditLogger.export("csv");

// 获取统计
const stats = auditLogger.getStats();
```

**风险级别评估：**

- `LOW` - 普通浏览器操作
- `MEDIUM` - 涉及敏感关键词（password、bank等）或网络拦截
- `HIGH` - 桌面级操作（DESKTOP_CLICK、DESKTOP_TYPE）
- `CRITICAL` - 系统级敏感操作

### IPC 接口

```javascript
// 记录操作
await window.api.invoke("browser:audit:log", operationData);

// 查询日志
const logs = await window.api.invoke("browser:audit:query", {
  type: "mouse_click",
  limit: 50,
});

// 获取统计
const stats = await window.api.invoke("browser:audit:stats");

// 获取高风险操作
const highRisk = await window.api.invoke("browser:audit:highRisk", 50);

// 导出
const data = await window.api.invoke("browser:audit:export", "json", {
  limit: 100,
});
```

## 屏幕录制 (ScreenRecorder)

录制浏览器页面或桌面操作，生成截图序列。

```javascript
const {
  getScreenRecorder,
  RecordingState,
  RecordingMode,
} = require("./actions");

const recorder = getScreenRecorder(browserEngine, {
  fps: 2, // 每秒帧数
  quality: 80, // JPEG 质量
  maxDuration: 300000, // 最大录制时长 5分钟
});

// 开始录制（浏览器页面）
const { recordingId } = await recorder.startRecording("tab_123");

// 开始录制（桌面）
const { recordingId: desktopRecId } = await recorder.startRecording(null);

// 暂停/恢复
recorder.pauseRecording();
recorder.resumeRecording();

// 停止录制
const result = await recorder.stopRecording();
console.log(`录制完成: ${result.frameCount} 帧, 时长 ${result.duration}ms`);

// 获取状态
const status = recorder.getStatus();

// 列出所有录制
const recordings = await recorder.listRecordings();

// 获取录制详情
const recording = await recorder.getRecording(recordingId);

// 导出为 GIF 数据
const gifData = await recorder.exportToGif(recordingId);

// 获取单帧
const frame = await recorder.getFrame(recordingId, 0);

// 删除录制
await recorder.deleteRecording(recordingId);
```

### IPC 接口

```javascript
// 开始录制
const result = await window.api.invoke(
  "browser:recording:start",
  targetId,
  options,
);

// 暂停/恢复/停止
await window.api.invoke("browser:recording:pause");
await window.api.invoke("browser:recording:resume");
const result = await window.api.invoke("browser:recording:stop");

// 获取状态
const status = await window.api.invoke("browser:recording:status");

// 列出录制
const recordings = await window.api.invoke("browser:recording:list");

// 获取录制详情
const recording = await window.api.invoke("browser:recording:get", recordingId);

// 删除录制
await window.api.invoke("browser:recording:delete", recordingId);

// 导出 GIF 数据
const gifData = await window.api.invoke(
  "browser:recording:exportGif",
  recordingId,
);

// 获取单帧
const frame = await window.api.invoke(
  "browser:recording:frame",
  recordingId,
  0,
);
```

## 操作回放 (ActionReplay)

回放录制的操作序列，支持变速、单步、断点调试。

```javascript
const { getActionReplay, ReplayState, ReplayMode } = require("./actions");

const replay = getActionReplay(browserEngine);

// 加载操作序列
replay.load(
  [
    { type: "click", x: 100, y: 200, delay: 500 },
    { type: "type", text: "hello world", delay: 100 },
    { type: "key", key: "Enter" },
    { type: "wait", duration: 1000 },
    { type: "screenshot" },
  ],
  { targetId: "tab_123" },
);

// 设置断点
replay.setBreakpoint(2);

// 开始回放
await replay.play({ speed: 1.5 });

// 暂停/恢复
replay.pause();
replay.resume();

// 单步执行
await replay.step();

// 跳转到指定位置
replay.jumpTo(3);

// 获取状态
const status = replay.getStatus();

// 停止回放
replay.stop();
```

### IPC 接口

```javascript
// 加载操作
await window.api.invoke("browser:replay:load", actions, options);

// 播放/暂停/恢复/停止
await window.api.invoke("browser:replay:play", { speed: 2.0 });
await window.api.invoke("browser:replay:pause");
await window.api.invoke("browser:replay:resume");
await window.api.invoke("browser:replay:stop");

// 单步执行
await window.api.invoke("browser:replay:step");

// 获取状态
const status = await window.api.invoke("browser:replay:status");
```

## 安全模式 (SafeMode)

提供操作权限控制和限制，防止敏感操作。

```javascript
const { getSafeMode, SafetyLevel, ActionCategory } = require("./actions");

const safeMode = getSafeMode();

// 设置安全级别
safeMode.setLevel(SafetyLevel.CAUTIOUS);

// 安全级别：
// - UNRESTRICTED: 无限制
// - NORMAL: 普通（允许浏览器操作，禁止桌面/网络）
// - CAUTIOUS: 谨慎（需要确认输入和点击）
// - STRICT: 严格（仅允许只读和导航）
// - READONLY: 只读（仅允许截图和分析）

// 检查权限
const permission = await safeMode.checkPermission(
  "click",
  { x: 100, y: 200 },
  {
    url: "https://example.com",
  },
);
if (permission.allowed) {
  if (permission.requiresConfirmation) {
    // 请求用户确认
    const confirmed = await safeMode.requestConfirmation(
      "click",
      params,
      context,
    );
  }
}

// 阻止特定操作
safeMode.blockAction("desktopClick");
safeMode.unblockAction("desktopClick");

// 阻止特定 URL
safeMode.blockUrl("*://blocked-site.com/*");

// 添加受限区域（不允许点击）
safeMode.addRestrictedRegion({
  name: "protected-area",
  x: 0,
  y: 0,
  width: 200,
  height: 100,
});

// 速率限制
safeMode.updateConfig({
  rateLimit: {
    enabled: true,
    maxOperationsPerMinute: 30,
    maxOperationsPerHour: 500,
  },
});

// 包装操作（自动权限检查）
const safeClick = safeMode.wrap(clickFunction, "click");
await safeClick({ x: 100, y: 200 });
```

### IPC 接口

```javascript
// 检查权限
const result = await window.api.invoke(
  "browser:safeMode:checkPermission",
  "click",
  params,
  context,
);

// 设置安全级别
await window.api.invoke("browser:safeMode:setLevel", "cautious");

// 启用/禁用
await window.api.invoke("browser:safeMode:setEnabled", true);

// 获取/更新配置
const config = await window.api.invoke("browser:safeMode:getConfig");
await window.api.invoke("browser:safeMode:updateConfig", {
  desktopAllowed: true,
});

// 响应确认请求
await window.api.invoke("browser:safeMode:respond", confirmationId, true);
```

## 工作流引擎 (WorkflowEngine)

定义和执行多步骤自动化工作流，支持条件、循环、并行。

```javascript
const { getWorkflowEngine, StepType } = require("./actions");

const engine = getWorkflowEngine(browserEngine);

// 创建工作流
engine.createWorkflow({
  id: "login-workflow",
  name: "自动登录流程",
  variables: {
    username: "test@example.com",
    password: "secret",
  },
  steps: [
    // 导航到登录页
    {
      type: StepType.ACTION,
      name: "打开登录页",
      action: { type: "navigate", url: "https://example.com/login" },
    },
    // 输入用户名
    {
      type: StepType.ACTION,
      name: "输入用户名",
      action: { type: "type", text: "${username}" },
    },
    // 条件分支
    {
      type: StepType.CONDITION,
      name: "检查验证码",
      condition: { left: "${hasCaptcha}", operator: "==", right: true },
      then: [
        { type: StepType.WAIT, duration: 30000 }, // 等待手动输入验证码
      ],
      else: [],
    },
    // 循环
    {
      type: StepType.LOOP,
      name: "重试登录",
      loopType: "times",
      times: 3,
      steps: [
        { type: StepType.ACTION, action: { type: "click", x: 200, y: 300 } },
      ],
    },
  ],
  onError: "continue", // 或 'stop'
});

// 执行工作流
const result = await engine.execute("login-workflow", {
  targetId: "tab_123",
  variables: { hasCaptcha: false },
});

// 暂停/恢复/取消
engine.pause();
engine.resume();
engine.cancel();

// 保存/加载工作流
await engine.saveWorkflow("login-workflow");
await engine.loadWorkflow("login-workflow");

// 列出工作流
const workflows = engine.listWorkflows();
```

### 步骤类型

- `action` - 执行操作
- `condition` - 条件分支
- `loop` - 循环（forEach/while/times）
- `wait` - 等待
- `parallel` - 并行执行多个分支
- `subWorkflow` - 调用子工作流
- `script` - 执行自定义脚本

### IPC 接口

```javascript
// 创建工作流
await window.api.invoke("browser:workflow:create", definition);

// 执行工作流
await window.api.invoke("browser:workflow:execute", workflowId, options);

// 暂停/恢复/取消
await window.api.invoke("browser:workflow:pause");
await window.api.invoke("browser:workflow:resume");
await window.api.invoke("browser:workflow:cancel");

// 管理工作流
const workflows = await window.api.invoke("browser:workflow:list");
const workflow = await window.api.invoke("browser:workflow:get", workflowId);
await window.api.invoke("browser:workflow:delete", workflowId);

// 持久化
await window.api.invoke("browser:workflow:save", workflowId);
await window.api.invoke("browser:workflow:load", workflowId);
```

## 文件结构

```
src/main/browser/
├── browser-engine.js           # 浏览器引擎核心
├── computer-use-agent.js       # 统一代理 (v0.33.0)
├── browser-ipc.js              # IPC 处理器 (68+ handlers)
├── actions/
│   ├── index.js                # 模块导出
│   ├── coordinate-action.js    # 坐标操作 (v0.33.0)
│   ├── vision-action.js        # Vision AI (v0.33.0)
│   ├── network-interceptor.js  # 网络拦截 (v0.33.0)
│   ├── desktop-action.js       # 桌面操作 (v0.33.0)
│   ├── audit-logger.js         # 审计日志 (v0.33.0)
│   ├── screen-recorder.js      # 屏幕录制 (v0.33.0)
│   ├── action-replay.js        # 操作回放 (v0.33.0)
│   ├── safe-mode.js            # 安全模式 (v0.33.0)
│   ├── workflow-engine.js      # 工作流引擎 (v0.33.0)
│   ├── element-highlighter.js  # 元素高亮 (v0.33.0)
│   ├── template-actions.js     # 模板操作 (v0.33.0)
│   ├── computer-use-metrics.js # 性能指标 (v0.33.0)
│   ├── keyboard-action.js      # 键盘操作
│   ├── scroll-action.js        # 滚动操作
│   └── ...
├── examples/
│   └── computer-use-example.js # 使用示例
└── ...

src/main/ai-engine/
├── extended-tools-computeruse.js  # AI 工具定义 (v0.33.0)
├── computer-use-bridge.js         # 桥接模块 (v0.33.0)
└── tools/
    ├── index.js
    └── computer-use-tools.js      # 工具执行器

src/renderer/components/browser/
└── ComputerUsePanel.vue           # 前端控制面板 (v0.33.0)
```

## 元素高亮 (ElementHighlighter)

在页面上可视化标注元素位置，用于调试、演示和用户引导。

```javascript
const { getElementHighlighter, HighlightStyle } = require("./actions");

const highlighter = getElementHighlighter(browserEngine);

// 按坐标高亮
await highlighter.highlightBounds(
  "tab1",
  {
    x: 100,
    y: 100,
    width: 200,
    height: 50,
  },
  {
    style: HighlightStyle.SUCCESS,
    duration: 3000,
    label: "目标按钮",
  },
);

// 按 CSS 选择器高亮
await highlighter.highlightSelector("tab1", "#submit-btn", {
  style: HighlightStyle.INFO,
});

// 按元素引用高亮
await highlighter.highlightRef("tab1", "button[1]");

// 显示点击位置
await highlighter.showClickHighlight("tab1", 150, 200, {
  radius: 20,
  color: "rgba(255, 0, 0, 0.5)",
});

// 绘制路径（用于展示操作轨迹）
await highlighter.drawPath(
  "tab1",
  [
    { x: 100, y: 100 },
    { x: 200, y: 150 },
    { x: 300, y: 100 },
  ],
  {
    lineWidth: 2,
    lineColor: "blue",
  },
);

// 显示标注
await highlighter.showAnnotation(
  "tab1",
  "点击这里",
  { x: 150, y: 200 },
  {
    arrowDirection: "down",
    backgroundColor: "#333",
    textColor: "#fff",
  },
);

// 清除高亮
await highlighter.clearHighlights("tab1");

// 获取当前高亮列表
const highlights = highlighter.getActiveHighlights("tab1");
```

**高亮样式：**

- `DEFAULT` - 蓝色边框
- `SUCCESS` - 绿色边框
- `ERROR` - 红色边框
- `WARNING` - 黄色边框
- `INFO` - 青色边框
- `PULSE` - 脉冲动画效果
- `OUTLINE` - 纯轮廓样式

### IPC 接口

```javascript
// 按坐标高亮
await window.api.invoke("browser:highlight:bounds", targetId, bounds, options);

// 按选择器高亮
await window.api.invoke(
  "browser:highlight:selector",
  targetId,
  selector,
  options,
);

// 按引用高亮
await window.api.invoke("browser:highlight:ref", targetId, ref, options);

// 点击高亮
await window.api.invoke("browser:highlight:click", targetId, x, y, options);

// 绘制路径
await window.api.invoke("browser:highlight:path", targetId, points, options);

// 标注
await window.api.invoke(
  "browser:highlight:annotate",
  targetId,
  text,
  position,
  options,
);

// 清除高亮
await window.api.invoke("browser:highlight:clear", targetId);

// 获取活动高亮
const highlights = await window.api.invoke("browser:highlight:list", targetId);
```

## 模板操作 (TemplateActions)

提供预定义的常用操作模板，快速执行常见自动化任务。

```javascript
const { getTemplateActions, TemplateCategory } = require("./actions");

const templates = getTemplateActions(browserEngine);

// 列出所有模板
const allTemplates = templates.listTemplates();

// 按分类列出
const formTemplates = templates.listTemplates(TemplateCategory.FORM);

// 获取模板详情
const template = templates.getTemplate("form:fill");

// 执行表单填充模板
await templates.executeTemplate("tab1", "form:fill", {
  fields: [
    { selector: "#name", value: "张三" },
    { selector: "#email", value: "test@example.com" },
    { selector: "#phone", value: "13812345678" },
  ],
});

// 执行登录模板
await templates.executeTemplate("tab1", "auth:login", {
  usernameSelector: "#username",
  passwordSelector: "#password",
  submitSelector: "#login-btn",
  username: "user@example.com",
  password: "secret",
});

// 执行搜索模板
await templates.executeTemplate("tab1", "search:query", {
  searchInputSelector: "#search",
  submitSelector: "#search-btn",
  query: "人工智能",
});

// 执行截图模板
await templates.executeTemplate("tab1", "utility:screenshot", {
  outputPath: "/tmp/screenshot.png",
  fullPage: true,
});

// 执行数据提取模板
const data = await templates.executeTemplate("tab1", "data:extract", {
  selector: ".product-item",
  fields: {
    title: ".title",
    price: ".price",
    link: { selector: "a", attr: "href" },
  },
});

// 注册自定义模板
templates.registerTemplate({
  id: "custom:checkout",
  name: "结账流程",
  category: TemplateCategory.FORM,
  description: "自动完成购物车结账",
  params: [
    { name: "address", type: "string", required: true },
    { name: "paymentMethod", type: "string", required: true },
  ],
  execute: async (page, params) => {
    // 自定义逻辑
    return { success: true };
  },
});

// 验证参数
const validation = templates.validateParams("form:fill", {
  fields: [{ selector: "#name", value: "test" }],
});

// 注销模板
templates.unregisterTemplate("custom:checkout");
```

**内置模板分类：**

- `form` - 表单操作（填充、提交）
- `auth` - 认证操作（登录、注册）
- `search` - 搜索操作
- `navigation` - 导航操作（滚动、翻页）
- `data` - 数据操作（提取、下载）
- `utility` - 实用工具（截图、等待）

### IPC 接口

```javascript
// 列出模板
const templates = await window.api.invoke("browser:template:list", category);

// 获取模板详情
const template = await window.api.invoke("browser:template:get", templateId);

// 执行模板
const result = await window.api.invoke(
  "browser:template:execute",
  targetId,
  templateId,
  params,
);

// 注册自定义模板
await window.api.invoke("browser:template:register", templateDefinition);

// 注销模板
await window.api.invoke("browser:template:unregister", templateId);

// 验证参数
const validation = await window.api.invoke(
  "browser:template:validate",
  templateId,
  params,
);

// 获取分类列表
const categories = await window.api.invoke("browser:template:categories");
```

## 性能指标 (ComputerUseMetrics)

收集和分析 Computer Use 操作的性能数据和统计信息。

```javascript
const { getComputerUseMetrics, TimeRange, MetricType } = require("./actions");

const metrics = getComputerUseMetrics();

// 记录操作
metrics.recordOperation({
  type: "click",
  targetId: "tab1",
  x: 100,
  y: 200,
  success: true,
  duration: 50,
  sessionId: "session_123",
});

// 获取会话统计
const sessionStats = metrics.getSessionStats("session_123");
console.log(`操作数: ${sessionStats.operationCount}`);
console.log(`成功率: ${sessionStats.successRate}%`);
console.log(`平均耗时: ${sessionStats.averageDuration}ms`);

// 获取操作类型统计
const typeStats = metrics.getTypeStats(TimeRange.DAY);
console.log(`点击次数: ${typeStats.click}`);
console.log(`输入次数: ${typeStats.type}`);

// 获取错误统计
const errorStats = metrics.getErrorStats(TimeRange.WEEK);
console.log(`总错误数: ${errorStats.totalErrors}`);
console.log(`错误率: ${errorStats.errorRate}`);
console.log(`按错误类型分布:`, errorStats.byError);

// 获取性能指标
const perf = metrics.getPerformanceMetrics(TimeRange.DAY);
console.log(`平均耗时: ${perf.averageDuration}ms`);
console.log(`P50: ${perf.p50}ms`);
console.log(`P90: ${perf.p90}ms`);
console.log(`P99: ${perf.p99}ms`);

// 获取时间序列数据
const timeSeries = metrics.getTimeSeries("operations", TimeRange.DAY, "hour");
// 返回: [{ timestamp, count, avgDuration }, ...]

// 获取总体摘要
const summary = metrics.getSummary();
console.log(`总操作数: ${summary.totalOperations}`);
console.log(`总会话数: ${summary.totalSessions}`);
console.log(`成功率: ${summary.successRate}`);

// 导出数据
const jsonData = metrics.export("json", { timeRange: TimeRange.WEEK });
const csvData = metrics.export("csv");

// 重置统计
metrics.reset();
```

**时间范围：**

- `HOUR` - 最近一小时
- `DAY` - 最近一天
- `WEEK` - 最近一周
- `MONTH` - 最近一月
- `ALL` - 全部数据

**指标类型：**

- `COUNTER` - 计数器（如操作总数）
- `GAUGE` - 当前值（如活跃会话数）
- `HISTOGRAM` - 分布直方图（如耗时分布）
- `SUMMARY` - 摘要统计（如百分位数）

### IPC 接口

```javascript
// 记录操作
await window.api.invoke("browser:metrics:record", operationData);

// 获取会话统计
const stats = await window.api.invoke(
  "browser:metrics:sessionStats",
  sessionId,
);

// 获取类型统计
const typeStats = await window.api.invoke("browser:metrics:typeStats", "day");

// 获取错误统计
const errorStats = await window.api.invoke(
  "browser:metrics:errorStats",
  "week",
);

// 获取性能指标
const perf = await window.api.invoke("browser:metrics:performance", "day");

// 获取时间序列
const series = await window.api.invoke(
  "browser:metrics:timeSeries",
  "operations",
  "day",
  "hour",
);

// 获取总体摘要
const summary = await window.api.invoke("browser:metrics:summary");

// 导出数据
const data = await window.api.invoke("browser:metrics:export", "json", options);

// 重置统计
await window.api.invoke("browser:metrics:reset", true);
```

## 智能元素检测 (SmartElementDetector)

多策略元素检测引擎，支持精确、模糊、视觉、无障碍等多种检测方式。

```javascript
const {
  getSmartElementDetector,
  DetectionStrategy,
  ElementType,
} = require("./actions");

const detector = getSmartElementDetector(browserEngine);

// 通过选择器精确检测
const result = await detector.detect("tab1", { selector: "#submit-btn" });

// 通过文本模糊检测
const result = await detector.detect("tab1", { text: "Submit" });

// 使用缓存
const cached = await detector.detect("tab1", { text: "Submit" });
// cached.strategy === 'cached'

// 批量检测
const results = await detector.detectMultiple("tab1", [
  { selector: "#username" },
  { selector: "#password" },
  { text: "Login" },
]);

// 等待元素出现
const waitResult = await detector.waitFor(
  "tab1",
  { text: "Success" },
  {
    timeout: 5000,
    interval: 200,
  },
);

// 清除缓存
detector.clearCache("tab1");

// 获取统计
const stats = detector.getStats();
console.log(`检测次数: ${stats.totalDetections}`);
console.log(`缓存命中率: ${stats.cacheHitRate}`);
```

**检测策略优先级：**

1. `EXACT` - 精确选择器匹配
2. `CACHED` - 缓存结果
3. `FUZZY` - 模糊文本匹配
4. `ACCESSIBILITY` - 无障碍属性匹配
5. `VISUAL` - 视觉特征匹配
6. `HEURISTIC` - 启发式推断

### IPC 接口

```javascript
// 检测元素
const result = await window.api.invoke(
  "browser:detector:detect",
  targetId,
  criteria,
);

// 批量检测
const results = await window.api.invoke(
  "browser:detector:detectMultiple",
  targetId,
  criteriaList,
);

// 等待元素
const result = await window.api.invoke(
  "browser:detector:waitFor",
  targetId,
  criteria,
  options,
);

// 清除缓存
await window.api.invoke("browser:detector:clearCache", targetId);

// 获取统计
const stats = await window.api.invoke("browser:detector:stats");
```

## 错误恢复管理 (ErrorRecoveryManager)

自动处理操作失败并尝试恢复，支持多种恢复策略。

```javascript
const {
  getErrorRecoveryManager,
  ErrorType,
  RecoveryStrategy,
} = require("./actions");

const recovery = getErrorRecoveryManager(browserEngine);

// 包装操作以启用自动恢复
const safeOperation = recovery.wrap(async () => {
  await page.click("#submit");
});

const result = await safeOperation();
// result.success - 是否成功
// result.recovered - 是否经过恢复
// result.attempts - 尝试次数

// 直接执行带恢复的操作
const result = await recovery.executeWithRecovery(
  async () => page.click("#dynamic-button"),
  [],
  { maxRetries: 3 },
);

// 设置特定错误类型的恢复策略
recovery.setStrategies(ErrorType.ELEMENT_NOT_FOUND, [
  RecoveryStrategy.WAIT_AND_RETRY,
  RecoveryStrategy.SCROLL_AND_RETRY,
  RecoveryStrategy.REFRESH_AND_RETRY,
]);

// 手动触发恢复
await recovery.manualRecover("tab1", RecoveryStrategy.REFRESH_AND_RETRY, {});

// 获取统计
const stats = recovery.getStats();
console.log(`总错误: ${stats.totalErrors}`);
console.log(`恢复成功率: ${stats.recoveryRate}`);

// 获取历史
const history = recovery.getHistory(20);

// 重置
recovery.reset();
```

**恢复策略：**

- `RETRY` - 立即重试
- `RETRY_WITH_DELAY` - 延迟重试
- `EXPONENTIAL_BACKOFF` - 指数退避
- `REFRESH_AND_RETRY` - 刷新页面后重试
- `RELOCATE_AND_RETRY` - 重新定位元素
- `SCROLL_AND_RETRY` - 滚动后重试
- `WAIT_AND_RETRY` - 等待条件后重试
- `SKIP` - 跳过
- `ABORT` - 中止

### IPC 接口

```javascript
// 执行带恢复的操作
const result = await window.api.invoke(
  "browser:recovery:execute",
  targetId,
  operationData,
);

// 手动恢复
await window.api.invoke("browser:recovery:manual", targetId, strategy, context);

// 获取统计
const stats = await window.api.invoke("browser:recovery:stats");

// 获取历史
const history = await window.api.invoke("browser:recovery:history", limit);

// 重置
await window.api.invoke("browser:recovery:reset");
```

## 上下文记忆 (ContextMemory)

跨会话持久化页面状态、元素位置、操作序列等信息。

```javascript
const {
  getContextMemory,
  MemoryType,
  PersistenceStrategy,
} = require("./actions");

const memory = getContextMemory();

// 保存页面状态
memory.savePageState("https://example.com", {
  title: "Example Page",
  scrollPosition: { x: 0, y: 500 },
  formData: { name: "test" },
});

// 获取页面状态
const state = memory.getPageState("https://example.com");

// 保存元素位置
memory.saveElementLocation(
  { text: "Submit Button" },
  { bounds: { x: 100, y: 200, width: 100, height: 40 } },
  { url: "https://example.com" },
);

// 获取元素位置
const location = memory.getElementLocation(
  { text: "Submit Button" },
  { url: "https://example.com" },
);

// 记录操作序列
memory.recordOperation("checkout-flow", { type: "click", target: "cart" });
memory.recordOperation("checkout-flow", { type: "click", target: "checkout" });

// 获取操作序列
const ops = memory.getOperationSequence("checkout-flow");

// 保存表单数据
memory.saveFormData("login-form", { username: "test@example.com" });

// 获取表单数据
const formData = memory.getFormData("login-form");

// 设置会话上下文
memory.setSessionContext("currentUser", { id: 1, name: "Test" });
const user = memory.getSessionContext("currentUser");

// 查找相似页面状态
const similar = memory.findSimilarPageStates("https://example.com/page1");

// 获取统计
const stats = memory.getStats();

// 清理过期数据
memory.cleanup();

// 清除所有数据
memory.clear();

// 导出/导入
const data = memory.export();
memory.import(data);
```

**持久化策略：**

- `MEMORY_ONLY` - 仅内存（会话结束丢失）
- `SESSION` - 会话持久化
- `PERSISTENT` - 永久持久化

### IPC 接口

```javascript
// 页面状态
await window.api.invoke("browser:memory:savePageState", url, state, options);
const state = await window.api.invoke("browser:memory:getPageState", url);

// 元素位置
await window.api.invoke(
  "browser:memory:saveElementLocation",
  criteria,
  location,
  context,
);
const location = await window.api.invoke(
  "browser:memory:getElementLocation",
  criteria,
  context,
);

// 操作序列
await window.api.invoke(
  "browser:memory:recordOperation",
  sequenceId,
  operation,
);
const ops = await window.api.invoke(
  "browser:memory:getOperationSequence",
  sequenceId,
  options,
);

// 表单数据
await window.api.invoke("browser:memory:saveFormData", formId, data);
const data = await window.api.invoke("browser:memory:getFormData", formId);

// 会话上下文
await window.api.invoke("browser:memory:setSessionContext", key, value);
const value = await window.api.invoke("browser:memory:getSessionContext", key);

// 统计
const stats = await window.api.invoke("browser:memory:stats");

// 清理/清除
await window.api.invoke("browser:memory:cleanup");
await window.api.invoke("browser:memory:clear");

// 导入/导出
const data = await window.api.invoke("browser:memory:export");
await window.api.invoke("browser:memory:import", data);
```

## 自动化策略 (AutomationPolicy)

定义和执行自动化安全策略，控制哪些操作被允许。

```javascript
const { getAutomationPolicy, PolicyType, PolicyAction } = require("./actions");

const policy = getAutomationPolicy();

// 添加 URL 黑名单策略
policy.addPolicy({
  id: "block-payment",
  name: "阻止支付页面",
  type: PolicyType.URL_BLACKLIST,
  priority: 100,
  config: {
    patterns: ["*payment*", "*checkout*"],
    action: PolicyAction.DENY,
    message: "不允许在支付页面自动化",
  },
});

// 添加频率限制策略
policy.addPolicy({
  id: "rate-limit",
  type: PolicyType.RATE_LIMIT,
  config: {
    maxActions: 60,
    windowMs: 60000,
    action: PolicyAction.DELAY,
    delayMs: 1000,
  },
});

// 添加区域保护策略
policy.addPolicy({
  id: "protect-sidebar",
  type: PolicyType.REGION_PROTECTION,
  config: {
    protectedRegions: [
      { x: 0, y: 0, width: 200, height: 1080, name: "Sidebar" },
    ],
    action: PolicyAction.ASK,
  },
});

// 检查操作是否被允许
const result = await policy.check({
  url: "https://example.com/payment",
  action: "click",
  target: { x: 500, y: 300 },
});

if (!result.allowed) {
  console.log(`操作被阻止: ${result.reason}`);
}

// 列出所有策略
const policies = policy.list();

// 启用/禁用策略
policy.setEnabled("block-payment", false);

// 获取违规记录
const violations = policy.getViolations(50);

// 获取统计
const stats = policy.getStats();

// 导出/导入
const data = policy.export();
policy.import(data, true); // merge = true
```

**策略类型：**

- `URL_WHITELIST` / `URL_BLACKLIST` - URL 匹配
- `DOMAIN_WHITELIST` / `DOMAIN_BLACKLIST` - 域名匹配
- `ACTION_RESTRICTION` - 操作类型限制
- `TIME_WINDOW` - 时间窗口限制
- `RATE_LIMIT` - 频率限制
- `REGION_PROTECTION` - 区域保护
- `CONTENT_FILTER` - 内容过滤
- `CONFIRMATION_REQUIRED` - 需要确认

**策略动作：**

- `ALLOW` - 允许
- `DENY` - 拒绝
- `ASK` - 询问用户
- `LOG` - 仅记录
- `DELAY` - 延迟执行

### IPC 接口

```javascript
// 检查操作
const result = await window.api.invoke("browser:policy:check", context);

// 策略管理
await window.api.invoke("browser:policy:add", policyConfig);
await window.api.invoke("browser:policy:remove", policyId);
await window.api.invoke("browser:policy:update", policyId, updates);
const policies = await window.api.invoke("browser:policy:list");
const policy = await window.api.invoke("browser:policy:get", policyId);

// 违规和统计
const violations = await window.api.invoke("browser:policy:violations", limit);
const stats = await window.api.invoke("browser:policy:stats");

// 导入/导出
const data = await window.api.invoke("browser:policy:export");
await window.api.invoke("browser:policy:import", data, merge);
```

## 屏幕分析 (ScreenAnalyzer)

高级屏幕分析功能，检测页面区域和布局变化。

```javascript
const { getScreenAnalyzer, RegionType, AnalysisMode } = require("./actions");

const analyzer = getScreenAnalyzer(browserEngine);

// 分析屏幕
const result = await analyzer.analyze("tab1", {
  mode: AnalysisMode.STANDARD,
});

console.log(`视口: ${result.viewport.width}x${result.viewport.height}`);
console.log(`区域数: ${result.regions.length}`);
console.log(
  `布局: 有头部=${result.layout.hasHeader}, 有导航=${result.layout.hasNavigation}`,
);

// 查找特定类型的区域
const forms = await analyzer.findRegions("tab1", { type: RegionType.FORM });
const buttons = await analyzer.findRegions("tab1", { type: RegionType.BUTTON });

// 查找可见区域
const visible = await analyzer.findRegions("tab1", { visible: true });

// 查找交互元素
const interactive = await analyzer.findRegions("tab1", { interactive: true });

// 按文本查找
const submitButtons = await analyzer.findRegions("tab1", { text: "Submit" });

// 捕获区域截图
const screenshot = await analyzer.captureRegion("tab1", {
  x: 100,
  y: 100,
  width: 300,
  height: 200,
});

// 比较两次分析结果
const before = await analyzer.analyze("tab1");
// ... 页面变化 ...
const after = await analyzer.analyze("tab1", { forceRefresh: true });

const diff = analyzer.compare(before, after);
console.log(`URL变化: ${diff.urlChanged}`);
console.log(`新增区域: ${diff.regionsDiff.added.length}`);
console.log(`移除区域: ${diff.regionsDiff.removed.length}`);

// 变化检测（自动）
const analysis = await analyzer.analyze("tab1");
if (analysis.changes && analysis.changes.hasChanges) {
  console.log("页面发生变化");
}

// 获取统计
const stats = analyzer.getStats();
console.log(`分析次数: ${stats.totalAnalyses}`);
console.log(`缓存命中率: ${stats.cacheHitRate}`);

// 清除缓存
analyzer.clearCache("tab1");
```

**分析模式：**

- `QUICK` - 快速分析（主要区域）
- `STANDARD` - 标准分析
- `DETAILED` - 详细分析（含子元素）
- `FULL` - 完整分析（递归）

**区域类型：**
`header`, `footer`, `sidebar`, `content`, `navigation`, `form`, `table`, `list`, `modal`, `popup`, `button`, `input`, `image`, `video`

### IPC 接口

```javascript
// 分析
const result = await window.api.invoke(
  "browser:analyzer:analyze",
  targetId,
  options,
);

// 查找区域
const regions = await window.api.invoke(
  "browser:analyzer:findRegions",
  targetId,
  criteria,
);

// 捕获区域
const screenshot = await window.api.invoke(
  "browser:analyzer:captureRegion",
  targetId,
  bounds,
);

// 比较
const diff = await window.api.invoke("browser:analyzer:compare", before, after);

// 缓存
await window.api.invoke("browser:analyzer:clearCache", targetId);

// 统计
const stats = await window.api.invoke("browser:analyzer:stats");
```

## 操作建议 (ActionSuggestion)

AI 驱动的操作建议引擎，基于上下文智能推荐下一步操作。

```javascript
const {
  getActionSuggestion,
  SuggestionType,
  SuggestionPriority,
} = require("./actions");

const suggestion = getActionSuggestion();

// 获取操作建议
const result = await suggestion.suggest({
  url: "https://example.com/login",
  title: "Login Page",
  buttons: [{ text: "Submit", isPrimary: true }, { text: "Cancel" }],
  inputs: [
    { type: "text", label: "Username", value: "" },
    { type: "password", label: "Password", value: "" },
  ],
  forms: [{ hasEmptyFields: true, firstEmptyField: { label: "Username" } }],
});

for (const s of result.suggestions) {
  console.log(`${s.priority}: ${s.type} - ${s.description}`);
  console.log(`  置信度: ${s.confidence}`);
  console.log(`  来源: ${s.source}`);
}

// 记录实际执行的操作
suggestion.recordAction({
  type: SuggestionType.TYPE,
  target: { selector: "#username" },
  description: "输入用户名",
});

// 提供反馈
suggestion.feedback(result.suggestions[0], true); // 接受
suggestion.feedback(result.suggestions[1], false); // 拒绝

// 获取历史
const history = suggestion.getHistory(20);

// 获取统计
const stats = suggestion.getStats();
console.log(`总建议数: ${stats.totalSuggestions}`);
console.log(`接受率: ${stats.acceptanceRate}`);
console.log(`学习模式数: ${stats.learnedPatterns}`);

// 清除历史
suggestion.clearHistory();

// 清除学习模式
suggestion.clearLearnedPatterns();

// 导出/导入
const data = suggestion.export();
suggestion.import(data);
```

**建议类型：**
`click`, `type`, `select`, `scroll`, `navigate`, `wait`, `submit`, `confirm`, `cancel`, `upload`, `download`

**建议优先级：**

- `HIGH` - 高优先级（主要操作）
- `MEDIUM` - 中优先级
- `LOW` - 低优先级（可选操作）

**内置工作流模式：**

- `login` - 登录流程
- `search` - 搜索流程
- `form-fill` - 表单填写
- `checkout` - 结账流程
- `pagination` - 翻页操作

### IPC 接口

```javascript
// 获取建议
const result = await window.api.invoke("browser:suggestion:suggest", context);

// 记录操作
await window.api.invoke("browser:suggestion:recordAction", action);

// 提供反馈
await window.api.invoke("browser:suggestion:feedback", suggestion, accepted);

// 获取历史
const history = await window.api.invoke("browser:suggestion:history", limit);

// 获取统计
const stats = await window.api.invoke("browser:suggestion:stats");

// 清除
await window.api.invoke("browser:suggestion:clearHistory");
await window.api.invoke("browser:suggestion:clearPatterns");

// 导入/导出
const data = await window.api.invoke("browser:suggestion:export");
await window.api.invoke("browser:suggestion:import", data);
```

---

## 剪贴板管理 (ClipboardManager)

高级剪贴板操作管理，支持文本、HTML、图片复制粘贴，剪贴板历史和敏感内容过滤。

```javascript
const { getClipboardManager, ClipboardType } = require("./actions");

const clipboard = getClipboardManager(browserEngine);

// 复制文本
const result = clipboard.copyText("Hello World");

// 复制 HTML（带备用文本）
clipboard.copyHTML("<p>Hello</p>", "Hello");

// 复制图片（Base64 或 Buffer）
clipboard.copyImage("data:image/png;base64,...");
clipboard.copyImage(imageBuffer);

// 从页面元素复制
await clipboard.copyFromElement(targetId, "#content");

// 读取剪贴板
const content = clipboard.read(ClipboardType.TEXT);
const html = clipboard.read(ClipboardType.HTML);

// 粘贴到元素
await clipboard.pasteToElement(targetId, "#input");

// 模拟键盘粘贴 (Ctrl+V)
await clipboard.simulatePaste(targetId);

// 剪贴板历史
const history = clipboard.getHistory(10); // 最近10条
clipboard.restoreFromHistory(0); // 恢复第一条

// 清除
clipboard.clear();
clipboard.clearHistory();

// 统计
const stats = clipboard.getStats();
```

**内容类型：**

- `text` - 纯文本
- `html` - HTML 内容
- `image` - 图片
- `rtf` - 富文本
- `files` - 文件列表

**敏感内容过滤：**
自动检测并阻止包含信用卡号、SSN、密码、API Key 等敏感信息的内容。

### IPC 接口

```javascript
// 复制操作
await window.api.invoke("browser:clipboard:copyText", text, options);
await window.api.invoke("browser:clipboard:copyHTML", html, fallbackText);
await window.api.invoke("browser:clipboard:copyImage", imageData);
await window.api.invoke(
  "browser:clipboard:copyFromElement",
  targetId,
  selector,
);

// 读取/粘贴
const content = await window.api.invoke("browser:clipboard:read", type);
await window.api.invoke("browser:clipboard:pasteToElement", targetId, selector);
await window.api.invoke("browser:clipboard:simulatePaste", targetId);

// 历史和统计
const history = await window.api.invoke("browser:clipboard:history", limit);
const stats = await window.api.invoke("browser:clipboard:stats");
await window.api.invoke("browser:clipboard:clear");
```

---

## 文件处理 (FileHandler)

浏览器自动化中的文件下载/上传管理，支持进度跟踪和文件验证。

```javascript
const { getFileHandler, DownloadState, FileCategory } = require("./actions");

const handler = getFileHandler(browserEngine, {
  downloadDir: "/path/to/downloads",
  maxConcurrentDownloads: 3,
  blockExecutables: true,
});

// 开始下载
const result = await handler.startDownload(targetId, url, {
  savePath: "/path/to/save",
  filename: "custom-name.pdf",
});

// 取消下载
handler.cancelDownload(downloadId);

// 获取下载状态
const download = handler.getDownload(downloadId);

// 列出所有下载
const downloads = handler.listDownloads({
  state: DownloadState.IN_PROGRESS,
  category: FileCategory.DOCUMENT,
});

// 记录上传
handler.recordUpload(targetId, "#upload-input", [
  { name: "file.pdf", size: 1024, type: "application/pdf" },
]);

// 验证文件
const validation = handler.validateFile("/path/to/file", {
  maxSize: 10 * 1024 * 1024, // 10MB
  allowedExtensions: [".pdf", ".doc", ".docx"],
  blockedExtensions: [".exe", ".bat"],
});

// 获取文件信息
const info = handler.getFileInfo("/path/to/file");

// 统计
const stats = handler.getStats();
handler.resetStats();

// 清理
handler.cleanup({ completedOnly: true });
```

**下载状态：**
`pending`, `in_progress`, `completed`, `cancelled`, `failed`, `paused`

**文件分类：**
`document`, `image`, `video`, `audio`, `archive`, `code`, `executable`, `other`

### IPC 接口

```javascript
// 下载操作
await window.api.invoke("browser:file:download", targetId, url, options);
await window.api.invoke("browser:file:cancelDownload", downloadId);
const download = await window.api.invoke(
  "browser:file:getDownload",
  downloadId,
);
const list = await window.api.invoke("browser:file:listDownloads", filter);

// 上传
await window.api.invoke("browser:file:recordUpload", targetId, selector, files);
const uploads = await window.api.invoke("browser:file:getUploads", filter);

// 验证和信息
const valid = await window.api.invoke("browser:file:validate", path, rules);
const info = await window.api.invoke("browser:file:info", path);

// 配置
await window.api.invoke("browser:file:setDownloadDir", dir);
const stats = await window.api.invoke("browser:file:stats");
```

---

## 通知管理 (NotificationManager)

自动化事件通知系统，支持系统通知、页面 Toast、模板和静默时段。

```javascript
const {
  getNotificationManager,
  NotificationLevel,
  NotificationType,
} = require("./actions");

const notifier = getNotificationManager({
  enableSystemNotifications: true,
  enableSound: false,
  defaultTimeout: 5000,
});

// 发送通知
const result = notifier.notify({
  title: "任务完成",
  body: "自动化任务已成功完成",
  level: NotificationLevel.SUCCESS,
  icon: "check",
});

// 使用模板
notifier.notifyFromTemplate("automation:completed", {
  body: "购物车已添加商品",
});

// 注册自定义模板
notifier.registerTemplate("custom:alert", {
  title: "自定义警告",
  level: NotificationLevel.WARNING,
  sound: true,
});

// 管理通知
notifier.dismiss(notificationId);
notifier.dismissAll();
notifier.markAsRead(notificationId);
notifier.markAllAsRead();

// 设置静默时段 (22:00 - 08:00)
notifier.setQuietHours(22, 8);
notifier.clearQuietHours();

// 历史和统计
const history = notifier.getHistory({ level: NotificationLevel.ERROR });
const unread = notifier.getUnreadCount();
const stats = notifier.getStats();

// 清理
notifier.clearHistory();
notifier.resetStats();
```

**通知级别：**

- `info` - 信息
- `success` - 成功
- `warning` - 警告
- `error` - 错误
- `critical` - 严重

**内置模板：**

- `automation:started` - 自动化开始
- `automation:completed` - 自动化完成
- `automation:failed` - 自动化失败
- `download:completed` - 下载完成
- `download:failed` - 下载失败
- `error:recovered` - 错误已恢复
- `policy:violation` - 策略违规
- `session:timeout` - 会话超时

### IPC 接口

```javascript
// 通知操作
await window.api.invoke("browser:notification:notify", options);
await window.api.invoke("browser:notification:fromTemplate", template, data);
await window.api.invoke("browser:notification:dismiss", id);
await window.api.invoke("browser:notification:dismissAll");

// 已读状态
await window.api.invoke("browser:notification:markRead", id);
await window.api.invoke("browser:notification:markAllRead");

// 查询
const history = await window.api.invoke("browser:notification:history", filter);
const count = await window.api.invoke("browser:notification:unreadCount");

// 模板
const templates = await window.api.invoke("browser:notification:templates");
await window.api.invoke(
  "browser:notification:registerTemplate",
  name,
  template,
);

// 静默时段
await window.api.invoke("browser:notification:setQuietHours", start, end);

// 统计
const stats = await window.api.invoke("browser:notification:stats");
```

---

## 文件结构

```
src/main/browser/actions/
├── index.js                   # 模块导出
├── scroll-action.js           # 滚动操作
├── keyboard-action.js         # 键盘操作
├── upload-action.js           # 上传操作
├── multi-tab-action.js        # 多标签页操作
├── coordinate-action.js       # 坐标级操作 ⭐
├── vision-action.js           # Vision AI ⭐
├── network-interceptor.js     # 网络拦截 ⭐
├── desktop-action.js          # 桌面操作 ⭐
├── audit-logger.js            # 审计日志 ⭐
├── screen-recorder.js         # 屏幕录制 ⭐
├── action-replay.js           # 操作回放 ⭐
├── safe-mode.js               # 安全模式 ⭐
├── workflow-engine.js         # 工作流引擎 ⭐
├── element-highlighter.js     # 元素高亮 ⭐
├── template-actions.js        # 模板操作 ⭐
├── computer-use-metrics.js    # 性能指标 ⭐
├── smart-element-detector.js  # 智能检测 ⭐
├── error-recovery-manager.js  # 错误恢复 ⭐
├── context-memory.js          # 上下文记忆 ⭐
├── automation-policy.js       # 自动化策略 ⭐
├── screen-analyzer.js         # 屏幕分析 ⭐
├── action-suggestion.js       # 操作建议 ⭐
├── clipboard-manager.js       # 剪贴板管理 ⭐
├── file-handler.js            # 文件处理 ⭐
└── notification-manager.js    # 通知管理 ⭐
```

## 总结

ChainlessChain 的 Computer Use 能力包含 24 个核心模块，提供了比 Claude Computer Use 更完整的功能集：

| 模块                 | 功能       | IPC 处理器 |
| -------------------- | ---------- | ---------- |
| CoordinateAction     | 像素级操作 | 8          |
| VisionAction         | 视觉 AI    | 6          |
| NetworkInterceptor   | 网络拦截   | 8          |
| DesktopAction        | 桌面操作   | 5          |
| AuditLogger          | 审计日志   | 7          |
| ScreenRecorder       | 屏幕录制   | 9          |
| ActionReplay         | 操作回放   | 10         |
| SafeMode             | 安全模式   | 8          |
| WorkflowEngine       | 工作流     | 11         |
| ElementHighlighter   | 元素高亮   | 6          |
| TemplateActions      | 模板操作   | 7          |
| ComputerUseMetrics   | 性能指标   | 9          |
| SmartElementDetector | 智能检测   | 5          |
| ErrorRecoveryManager | 错误恢复   | 5          |
| ContextMemory        | 上下文记忆 | 13         |
| AutomationPolicy     | 自动化策略 | 10         |
| ScreenAnalyzer       | 屏幕分析   | 6          |
| ActionSuggestion     | 操作建议   | 9          |
| ClipboardManager     | 剪贴板管理 | 10         |
| FileHandler          | 文件处理   | 11         |
| NotificationManager  | 通知管理   | 12         |

**总计：150+ IPC 处理器，覆盖完整的计算机自动化能力。**
