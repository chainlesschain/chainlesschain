# Computer Use 能力指南

> 版本: v0.33.0 | 状态: ✅ 已实现

ChainlessChain 实现了类似 Claude Computer Use 的电脑操作能力，支持浏览器自动化和桌面级操作。

## 概述

### 与 Claude Computer Use 对比

| 能力 | Claude Computer Use | ChainlessChain | 备注 |
|------|-------------------|----------------|------|
| 屏幕截图 | ✅ | ✅ | 支持浏览器和桌面级 |
| 坐标点击 | ✅ | ✅ | 像素级精确控制 |
| 键盘输入 | ✅ | ✅ | 支持快捷键组合 |
| 鼠标拖拽 | ✅ | ✅ | 平滑拖拽 |
| 视觉理解 | ✅ Claude Vision | ✅ 多模型支持 | Claude/GPT-4V/LLaVA |
| 元素定位 | ✅ | ✅ 6层降级 | 更稳定 |
| Shadow DOM | ❌ | ✅ | 独有优势 |
| 网络拦截 | ❌ | ✅ | 独有优势 |
| 工作流引擎 | ❌ | ✅ | 独有优势 |
| 录制回放 | ❌ | ✅ | 独有优势 |
| 安全模式 | ❌ | ✅ | 权限控制和限制 |
| 审计日志 | ❌ | ✅ | 操作追踪和合规 |
| 元素高亮 | ❌ | ✅ | 可视化调试 |
| 模板操作 | ❌ | ✅ | 常用任务快速执行 |
| 性能指标 | ❌ | ✅ | 统计和分析 |
| 桌面操作 | ✅ | ✅ | 需要 robotjs |

## 核心模块

### 1. 坐标级操作 (CoordinateAction)

像素级精确控制鼠标和触控操作。

```javascript
const { CoordinateAction, MouseButton, GestureType } = require('./actions');

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
  { x: 300, y: 100 }
]);
```

### 2. Vision AI 操作 (VisionAction)

集成视觉 AI 能力，支持视觉元素定位和页面理解。

```javascript
const { VisionAction, VisionModel } = require('./actions');

const visionAction = new VisionAction(browserEngine, llmService);

// 分析页面
const analysis = await visionAction.analyze(targetId, '这个页面的主要功能是什么？');

// 定位元素（视觉方式）
const location = await visionAction.locateElement(targetId, '红色的登录按钮');
// 返回: { found: true, confidence: 0.95, element: { x, y, width, height } }

// 视觉引导点击（找到并点击）
await visionAction.visualClick(targetId, '搜索图标');

// 描述页面
const description = await visionAction.describePage(targetId);

// 与基线截图对比
const comparison = await visionAction.compareWithBaseline(targetId, baselineBase64);

// 执行多步视觉任务
const taskResult = await visionAction.executeVisualTask(
  targetId,
  '在搜索框中输入"人工智能"并点击搜索按钮'
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
const { NetworkInterceptor, NetworkCondition, InterceptType } = require('./actions');

const interceptor = new NetworkInterceptor(browserEngine);

// 启用拦截
await interceptor.enableInterception(targetId);

// 添加拦截规则
interceptor.addRule({
  urlPattern: '**/api/users',
  type: InterceptType.MOCK,
  response: {
    status: 200,
    body: JSON.stringify({ users: [] })
  }
});

// 模拟 API 响应
interceptor.mockAPI('**/api/login', {
  status: 200,
  body: { success: true, token: 'mock-token' }
});

// 阻止特定资源
interceptor.blockResourceTypes(targetId, ['image', 'media']);

// 设置网络条件（模拟慢速网络）
await interceptor.setNetworkCondition(targetId, NetworkCondition.SLOW_3G);

// 等待特定请求
const request = await interceptor.waitForRequest(targetId, '/api/submit');

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
const { DesktopAction, SpecialKey, Modifier } = require('./actions');

const desktop = new DesktopAction();

// 获取屏幕信息
const screenInfo = desktop.getScreenInfo();

// 截取桌面屏幕
const capture = await desktop.captureScreen({ displayId: 0 });

// 桌面点击
await desktop.click(500, 300);
await desktop.click(500, 300, { button: 'right' });
await desktop.click(500, 300, { double: true });

// 平滑移动鼠标
await desktop.moveMouse(800, 400, { smooth: true });

// 拖拽
await desktop.drag(100, 100, 500, 500);

// 输入文本
await desktop.typeText('Hello World');
await desktop.typeText('你好世界', { useClipboard: true }); // 中文使用剪贴板

// 按键
await desktop.pressKey('enter');
await desktop.pressKey('c', ['control']); // Ctrl+C
await desktop.executeShortcut('Ctrl+Shift+S');

// 剪贴板操作
desktop.setClipboard('复制的文本', 'text');
const clipboardContent = desktop.getClipboard('text');

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
const { ComputerUseAgent, ActionType } = require('./computer-use-agent');

// 创建并初始化
const agent = new ComputerUseAgent();
await agent.initialize();

// 打开页面
await agent.openTab('https://example.com');

// 执行操作
await agent.execute({ type: ActionType.CLICK, x: 500, y: 300 });
await agent.execute({ type: ActionType.TYPE, text: 'Hello' });
await agent.execute({ type: ActionType.KEY, key: 'Enter' });
await agent.execute({ type: ActionType.SCROLL, deltaY: 300 });

// 视觉操作
await agent.execute({
  type: ActionType.VISION_CLICK,
  description: '提交按钮'
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
await window.api.invoke('browser:action:coordinate', targetId, {
  action: 'click',
  x: 500,
  y: 300
});
```

### Vision AI 操作
```javascript
await window.api.invoke('browser:action:vision', targetId, {
  task: 'analyze',
  prompt: '描述这个页面'
});

// 视觉点击
await window.api.invoke('browser:visualClick', targetId, '红色按钮');
```

### 网络拦截
```javascript
await window.api.invoke('browser:network', targetId, {
  action: 'enable'
});

await window.api.invoke('browser:network', targetId, {
  action: 'mockAPI',
  urlPattern: '**/api/test',
  response: { status: 200, body: { data: 'mocked' } }
});
```

### 桌面操作
```javascript
// 截图
await window.api.invoke('browser:desktop:capture');

// 点击
await window.api.invoke('browser:desktop:click', 500, 300);

// 输入
await window.api.invoke('browser:desktop:type', 'Hello');

// 按键
await window.api.invoke('browser:desktop:key', 'enter', ['control']);
```

## 使用场景

### 1. 自动化测试
```javascript
// 端到端测试
await agent.openTab('https://app.example.com/login');
await agent.execute({ type: 'vision_click', description: '用户名输入框' });
await agent.execute({ type: 'type', text: 'testuser' });
await agent.execute({ type: 'vision_click', description: '密码输入框' });
await agent.execute({ type: 'type', text: 'password123' });
await agent.execute({ type: 'vision_click', description: '登录按钮' });
```

### 2. RPA 流程自动化
```javascript
// 自动填写表单
await agent.executeTask('填写联系表单：姓名张三，邮箱test@example.com，提交表单');
```

### 3. 网页数据采集
```javascript
// 启用网络拦截，获取 API 响应
await interceptor.enableInterception(targetId);
const response = await interceptor.waitForResponse(targetId, '/api/products');
console.log(response.body);
```

### 4. 视觉回归测试
```javascript
// 对比页面变化
const comparison = await visionAction.compareWithBaseline(targetId, baselineScreenshot);
if (comparison.similarity < 95) {
  console.log('检测到视觉变化:', comparison.changes);
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

| 工具名 | 描述 | 参数 |
|--------|------|-----|
| `browser_click` | 坐标点击 | x, y, button, clickCount |
| `visual_click` | 视觉点击 | description |
| `browser_type` | 键盘输入 | text |
| `browser_key` | 按键操作 | key, modifiers |
| `browser_scroll` | 滚动 | direction, amount |
| `browser_screenshot` | 截图 | fullPage |
| `analyze_page` | 页面分析 | prompt |
| `browser_navigate` | 导航 | url |
| `browser_wait` | 等待 | duration, selector |
| `desktop_screenshot` | 桌面截图 | displayId |
| `desktop_click` | 桌面点击 | x, y, button, double |
| `desktop_type` | 桌面输入 | text |

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
const { getAuditLogger, OperationType, RiskLevel } = require('./actions');

const auditLogger = getAuditLogger();

// 手动记录操作
await auditLogger.log({
  type: OperationType.MOUSE_CLICK,
  action: 'click',
  params: { x: 100, y: 200 },
  success: true,
  duration: 50,
  targetId: 'tab_123',
  url: 'https://example.com'
});

// 使用包装器自动记录
const wrappedClick = auditLogger.wrap(OperationType.MOUSE_CLICK, async (params) => {
  // 执行点击操作
  return { success: true };
});
await wrappedClick({ x: 100, y: 200 });

// 查询日志
const recentLogs = auditLogger.query({ limit: 50 });
const highRisk = auditLogger.getHighRiskOperations();
const failures = auditLogger.getFailedOperations();

// 导出
const jsonExport = auditLogger.export('json');
const csvExport = auditLogger.export('csv');

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
await window.api.invoke('browser:audit:log', operationData);

// 查询日志
const logs = await window.api.invoke('browser:audit:query', { type: 'mouse_click', limit: 50 });

// 获取统计
const stats = await window.api.invoke('browser:audit:stats');

// 获取高风险操作
const highRisk = await window.api.invoke('browser:audit:highRisk', 50);

// 导出
const data = await window.api.invoke('browser:audit:export', 'json', { limit: 100 });
```

## 屏幕录制 (ScreenRecorder)

录制浏览器页面或桌面操作，生成截图序列。

```javascript
const { getScreenRecorder, RecordingState, RecordingMode } = require('./actions');

const recorder = getScreenRecorder(browserEngine, {
  fps: 2,           // 每秒帧数
  quality: 80,      // JPEG 质量
  maxDuration: 300000  // 最大录制时长 5分钟
});

// 开始录制（浏览器页面）
const { recordingId } = await recorder.startRecording('tab_123');

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
const result = await window.api.invoke('browser:recording:start', targetId, options);

// 暂停/恢复/停止
await window.api.invoke('browser:recording:pause');
await window.api.invoke('browser:recording:resume');
const result = await window.api.invoke('browser:recording:stop');

// 获取状态
const status = await window.api.invoke('browser:recording:status');

// 列出录制
const recordings = await window.api.invoke('browser:recording:list');

// 获取录制详情
const recording = await window.api.invoke('browser:recording:get', recordingId);

// 删除录制
await window.api.invoke('browser:recording:delete', recordingId);

// 导出 GIF 数据
const gifData = await window.api.invoke('browser:recording:exportGif', recordingId);

// 获取单帧
const frame = await window.api.invoke('browser:recording:frame', recordingId, 0);
```

## 操作回放 (ActionReplay)

回放录制的操作序列，支持变速、单步、断点调试。

```javascript
const { getActionReplay, ReplayState, ReplayMode } = require('./actions');

const replay = getActionReplay(browserEngine);

// 加载操作序列
replay.load([
  { type: 'click', x: 100, y: 200, delay: 500 },
  { type: 'type', text: 'hello world', delay: 100 },
  { type: 'key', key: 'Enter' },
  { type: 'wait', duration: 1000 },
  { type: 'screenshot' }
], { targetId: 'tab_123' });

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
await window.api.invoke('browser:replay:load', actions, options);

// 播放/暂停/恢复/停止
await window.api.invoke('browser:replay:play', { speed: 2.0 });
await window.api.invoke('browser:replay:pause');
await window.api.invoke('browser:replay:resume');
await window.api.invoke('browser:replay:stop');

// 单步执行
await window.api.invoke('browser:replay:step');

// 获取状态
const status = await window.api.invoke('browser:replay:status');
```

## 安全模式 (SafeMode)

提供操作权限控制和限制，防止敏感操作。

```javascript
const { getSafeMode, SafetyLevel, ActionCategory } = require('./actions');

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
const permission = await safeMode.checkPermission('click', { x: 100, y: 200 }, {
  url: 'https://example.com'
});
if (permission.allowed) {
  if (permission.requiresConfirmation) {
    // 请求用户确认
    const confirmed = await safeMode.requestConfirmation('click', params, context);
  }
}

// 阻止特定操作
safeMode.blockAction('desktopClick');
safeMode.unblockAction('desktopClick');

// 阻止特定 URL
safeMode.blockUrl('*://blocked-site.com/*');

// 添加受限区域（不允许点击）
safeMode.addRestrictedRegion({
  name: 'protected-area',
  x: 0, y: 0,
  width: 200, height: 100
});

// 速率限制
safeMode.updateConfig({
  rateLimit: {
    enabled: true,
    maxOperationsPerMinute: 30,
    maxOperationsPerHour: 500
  }
});

// 包装操作（自动权限检查）
const safeClick = safeMode.wrap(clickFunction, 'click');
await safeClick({ x: 100, y: 200 });
```

### IPC 接口
```javascript
// 检查权限
const result = await window.api.invoke('browser:safeMode:checkPermission', 'click', params, context);

// 设置安全级别
await window.api.invoke('browser:safeMode:setLevel', 'cautious');

// 启用/禁用
await window.api.invoke('browser:safeMode:setEnabled', true);

// 获取/更新配置
const config = await window.api.invoke('browser:safeMode:getConfig');
await window.api.invoke('browser:safeMode:updateConfig', { desktopAllowed: true });

// 响应确认请求
await window.api.invoke('browser:safeMode:respond', confirmationId, true);
```

## 工作流引擎 (WorkflowEngine)

定义和执行多步骤自动化工作流，支持条件、循环、并行。

```javascript
const { getWorkflowEngine, StepType } = require('./actions');

const engine = getWorkflowEngine(browserEngine);

// 创建工作流
engine.createWorkflow({
  id: 'login-workflow',
  name: '自动登录流程',
  variables: {
    username: 'test@example.com',
    password: 'secret'
  },
  steps: [
    // 导航到登录页
    {
      type: StepType.ACTION,
      name: '打开登录页',
      action: { type: 'navigate', url: 'https://example.com/login' }
    },
    // 输入用户名
    {
      type: StepType.ACTION,
      name: '输入用户名',
      action: { type: 'type', text: '${username}' }
    },
    // 条件分支
    {
      type: StepType.CONDITION,
      name: '检查验证码',
      condition: { left: '${hasCaptcha}', operator: '==', right: true },
      then: [
        { type: StepType.WAIT, duration: 30000 }  // 等待手动输入验证码
      ],
      else: []
    },
    // 循环
    {
      type: StepType.LOOP,
      name: '重试登录',
      loopType: 'times',
      times: 3,
      steps: [
        { type: StepType.ACTION, action: { type: 'click', x: 200, y: 300 } }
      ]
    }
  ],
  onError: 'continue'  // 或 'stop'
});

// 执行工作流
const result = await engine.execute('login-workflow', {
  targetId: 'tab_123',
  variables: { hasCaptcha: false }
});

// 暂停/恢复/取消
engine.pause();
engine.resume();
engine.cancel();

// 保存/加载工作流
await engine.saveWorkflow('login-workflow');
await engine.loadWorkflow('login-workflow');

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
await window.api.invoke('browser:workflow:create', definition);

// 执行工作流
await window.api.invoke('browser:workflow:execute', workflowId, options);

// 暂停/恢复/取消
await window.api.invoke('browser:workflow:pause');
await window.api.invoke('browser:workflow:resume');
await window.api.invoke('browser:workflow:cancel');

// 管理工作流
const workflows = await window.api.invoke('browser:workflow:list');
const workflow = await window.api.invoke('browser:workflow:get', workflowId);
await window.api.invoke('browser:workflow:delete', workflowId);

// 持久化
await window.api.invoke('browser:workflow:save', workflowId);
await window.api.invoke('browser:workflow:load', workflowId);
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
const { getElementHighlighter, HighlightStyle } = require('./actions');

const highlighter = getElementHighlighter(browserEngine);

// 按坐标高亮
await highlighter.highlightBounds('tab1', {
  x: 100, y: 100, width: 200, height: 50
}, {
  style: HighlightStyle.SUCCESS,
  duration: 3000,
  label: '目标按钮'
});

// 按 CSS 选择器高亮
await highlighter.highlightSelector('tab1', '#submit-btn', {
  style: HighlightStyle.INFO
});

// 按元素引用高亮
await highlighter.highlightRef('tab1', 'button[1]');

// 显示点击位置
await highlighter.showClickHighlight('tab1', 150, 200, {
  radius: 20,
  color: 'rgba(255, 0, 0, 0.5)'
});

// 绘制路径（用于展示操作轨迹）
await highlighter.drawPath('tab1', [
  { x: 100, y: 100 },
  { x: 200, y: 150 },
  { x: 300, y: 100 }
], {
  lineWidth: 2,
  lineColor: 'blue'
});

// 显示标注
await highlighter.showAnnotation('tab1', '点击这里', { x: 150, y: 200 }, {
  arrowDirection: 'down',
  backgroundColor: '#333',
  textColor: '#fff'
});

// 清除高亮
await highlighter.clearHighlights('tab1');

// 获取当前高亮列表
const highlights = highlighter.getActiveHighlights('tab1');
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
await window.api.invoke('browser:highlight:bounds', targetId, bounds, options);

// 按选择器高亮
await window.api.invoke('browser:highlight:selector', targetId, selector, options);

// 按引用高亮
await window.api.invoke('browser:highlight:ref', targetId, ref, options);

// 点击高亮
await window.api.invoke('browser:highlight:click', targetId, x, y, options);

// 绘制路径
await window.api.invoke('browser:highlight:path', targetId, points, options);

// 标注
await window.api.invoke('browser:highlight:annotate', targetId, text, position, options);

// 清除高亮
await window.api.invoke('browser:highlight:clear', targetId);

// 获取活动高亮
const highlights = await window.api.invoke('browser:highlight:list', targetId);
```

## 模板操作 (TemplateActions)

提供预定义的常用操作模板，快速执行常见自动化任务。

```javascript
const { getTemplateActions, TemplateCategory } = require('./actions');

const templates = getTemplateActions(browserEngine);

// 列出所有模板
const allTemplates = templates.listTemplates();

// 按分类列出
const formTemplates = templates.listTemplates(TemplateCategory.FORM);

// 获取模板详情
const template = templates.getTemplate('form:fill');

// 执行表单填充模板
await templates.executeTemplate('tab1', 'form:fill', {
  fields: [
    { selector: '#name', value: '张三' },
    { selector: '#email', value: 'test@example.com' },
    { selector: '#phone', value: '13812345678' }
  ]
});

// 执行登录模板
await templates.executeTemplate('tab1', 'auth:login', {
  usernameSelector: '#username',
  passwordSelector: '#password',
  submitSelector: '#login-btn',
  username: 'user@example.com',
  password: 'secret'
});

// 执行搜索模板
await templates.executeTemplate('tab1', 'search:query', {
  searchInputSelector: '#search',
  submitSelector: '#search-btn',
  query: '人工智能'
});

// 执行截图模板
await templates.executeTemplate('tab1', 'utility:screenshot', {
  outputPath: '/tmp/screenshot.png',
  fullPage: true
});

// 执行数据提取模板
const data = await templates.executeTemplate('tab1', 'data:extract', {
  selector: '.product-item',
  fields: {
    title: '.title',
    price: '.price',
    link: { selector: 'a', attr: 'href' }
  }
});

// 注册自定义模板
templates.registerTemplate({
  id: 'custom:checkout',
  name: '结账流程',
  category: TemplateCategory.FORM,
  description: '自动完成购物车结账',
  params: [
    { name: 'address', type: 'string', required: true },
    { name: 'paymentMethod', type: 'string', required: true }
  ],
  execute: async (page, params) => {
    // 自定义逻辑
    return { success: true };
  }
});

// 验证参数
const validation = templates.validateParams('form:fill', {
  fields: [{ selector: '#name', value: 'test' }]
});

// 注销模板
templates.unregisterTemplate('custom:checkout');
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
const templates = await window.api.invoke('browser:template:list', category);

// 获取模板详情
const template = await window.api.invoke('browser:template:get', templateId);

// 执行模板
const result = await window.api.invoke('browser:template:execute', targetId, templateId, params);

// 注册自定义模板
await window.api.invoke('browser:template:register', templateDefinition);

// 注销模板
await window.api.invoke('browser:template:unregister', templateId);

// 验证参数
const validation = await window.api.invoke('browser:template:validate', templateId, params);

// 获取分类列表
const categories = await window.api.invoke('browser:template:categories');
```

## 性能指标 (ComputerUseMetrics)

收集和分析 Computer Use 操作的性能数据和统计信息。

```javascript
const { getComputerUseMetrics, TimeRange, MetricType } = require('./actions');

const metrics = getComputerUseMetrics();

// 记录操作
metrics.recordOperation({
  type: 'click',
  targetId: 'tab1',
  x: 100,
  y: 200,
  success: true,
  duration: 50,
  sessionId: 'session_123'
});

// 获取会话统计
const sessionStats = metrics.getSessionStats('session_123');
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
const timeSeries = metrics.getTimeSeries('operations', TimeRange.DAY, 'hour');
// 返回: [{ timestamp, count, avgDuration }, ...]

// 获取总体摘要
const summary = metrics.getSummary();
console.log(`总操作数: ${summary.totalOperations}`);
console.log(`总会话数: ${summary.totalSessions}`);
console.log(`成功率: ${summary.successRate}`);

// 导出数据
const jsonData = metrics.export('json', { timeRange: TimeRange.WEEK });
const csvData = metrics.export('csv');

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
await window.api.invoke('browser:metrics:record', operationData);

// 获取会话统计
const stats = await window.api.invoke('browser:metrics:sessionStats', sessionId);

// 获取类型统计
const typeStats = await window.api.invoke('browser:metrics:typeStats', 'day');

// 获取错误统计
const errorStats = await window.api.invoke('browser:metrics:errorStats', 'week');

// 获取性能指标
const perf = await window.api.invoke('browser:metrics:performance', 'day');

// 获取时间序列
const series = await window.api.invoke('browser:metrics:timeSeries', 'operations', 'day', 'hour');

// 获取总体摘要
const summary = await window.api.invoke('browser:metrics:summary');

// 导出数据
const data = await window.api.invoke('browser:metrics:export', 'json', options);

// 重置统计
await window.api.invoke('browser:metrics:reset', true);
```
