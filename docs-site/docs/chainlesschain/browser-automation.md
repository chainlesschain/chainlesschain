# 浏览器自动化系统

> **版本: v0.29.0+ | 95%+元素定位准确率 | <200ms截图对比**

浏览器自动化系统提供完整的网页自动化能力，包括智能元素定位、操作录制回放、AI诊断等功能。

## 概述

浏览器自动化系统是 ChainlessChain 的网页自动化引擎，基于 Puppeteer API 构建。系统提供六级策略智能元素定位（95%+ 准确率）、操作录制与多格式脚本导出、基线截图对比诊断，以及 AI 驱动的定位失败自动诊断与修复重试能力。

## 核心特性

- 🌐 **Puppeteer 兼容引擎**: 基于 Puppeteer API 的浏览器控制引擎，支持导航、截图、脚本执行
- 🎯 **多策略元素定位**: 6 级定位策略（ID → 测试ID → CSS → XPath → 文本 → 视觉），95%+ 准确率
- 📸 **截图对比诊断**: 基线截图对比和变更检测，<200ms 完成 1080p 页面对比
- 🎬 **操作录制回放**: 录制用户操作并导出为 JS/JSON/Puppeteer 脚本，支持变速回放
- 🔧 **AI 智能诊断**: 元素定位失败时自动诊断原因并建议新选择器，支持自动修复重试

## 系统架构

```
浏览器自动化系统
├── BrowserEngine (~300行)      # 核心自动化引擎
├── ElementLocator (~450行)     # 多策略元素定位
├── SnapshotEngine (~280行)     # 截图对比和诊断
├── RecordingEngine (~250行)    # 用户操作录制
└── SmartDiagnostics (~350行)   # AI诊断和自动修复
```

## BrowserEngine 核心引擎

Puppeteer API 兼容的浏览器控制引擎。

### 初始化

```javascript
// 启动浏览器
const browser = await BrowserEngine.launch({
  headless: false,
  defaultViewport: { width: 1920, height: 1080 },
});

// 创建新页面
const page = await browser.newPage();

// 导航
await page.goto("https://example.com");
```

### 页面操作

```javascript
// 点击
await page.click("#submit-btn");

// 输入
await page.type("#search", "keyword");

// 选择下拉框
await page.select("#country", "CN");

// 等待元素
await page.waitForSelector(".loaded");

// 截图
await page.screenshot({ path: "screenshot.png" });

// 获取内容
const html = await page.content();
const title = await page.title();
```

---

## ElementLocator 元素定位

多策略智能元素定位，95%+准确率。

### 定位策略

| 策略      | 优先级 | 说明                  |
| --------- | ------ | --------------------- |
| ID选择器  | 1      | `#element-id`         |
| 测试ID    | 2      | `[data-testid="..."]` |
| CSS选择器 | 3      | 任意CSS选择器         |
| XPath     | 4      | 复杂路径定位          |
| 文本内容  | 5      | 根据文本匹配          |
| 视觉定位  | 6      | AI视觉识别            |

### 使用示例

```javascript
// 自动选择最佳策略
const element = await ElementLocator.find(page, {
  selector: "#btn",
  text: "提交",
  fallback: true, // 启用降级策略
});

// 指定策略
const element = await ElementLocator.findByText(page, "登录");
const element = await ElementLocator.findByXPath(
  page,
  '//button[@type="submit"]',
);

// 视觉定位
const element = await ElementLocator.findByVision(page, {
  description: "蓝色的登录按钮",
});
```

### Shadow DOM 支持

```javascript
// 穿透Shadow DOM
const element = await ElementLocator.findInShadow(page, {
  host: "custom-element",
  selector: ".inner-button",
});
```

---

## SnapshotEngine 截图对比

页面状态对比和变更检测。

### 截图对比

```javascript
// 截取基线
await SnapshotEngine.captureBaseline(page, "login-page");

// 对比当前状态
const diff = await SnapshotEngine.compare(page, "login-page", {
  threshold: 0.1, // 10%差异阈值
});

if (diff.changed) {
  console.log("页面发生变化:", diff.percentage);
  console.log("差异区域:", diff.regions);
}
```

### 元素状态检测

```javascript
// 检测元素可见性变化
const visible = await SnapshotEngine.isVisible(page, "#modal");

// 检测内容变化
const changed = await SnapshotEngine.contentChanged(page, ".data-table");
```

---

## RecordingEngine 操作录制

录制用户操作并生成可回放的脚本。

### 开始录制

```javascript
// 开始录制
await RecordingEngine.start(page, {
  name: "login-flow",
  captureScreenshots: true,
});

// 用户执行操作...

// 停止录制
const recording = await RecordingEngine.stop();
console.log("录制了", recording.actions.length, "个操作");
```

### 回放录制

```javascript
// 加载录制
const recording = await RecordingEngine.load("login-flow");

// 回放
await RecordingEngine.replay(page, recording, {
  speed: 1.0, // 回放速度
  pauseOnError: true,
});
```

### 导出脚本

```javascript
// 导出为JavaScript
const script = await RecordingEngine.exportToJS(recording);

// 导出为JSON
const json = await RecordingEngine.exportToJSON(recording);

// 导出为Puppeteer脚本
const puppeteer = await RecordingEngine.exportToPuppeteer(recording);
```

---

## SmartDiagnostics AI诊断

AI驱动的问题诊断和自动修复。

### 诊断问题

```javascript
// 元素定位失败时自动诊断
try {
  await page.click("#old-selector");
} catch (error) {
  const diagnosis = await SmartDiagnostics.diagnose(page, error, {
    selector: "#old-selector",
  });

  console.log("问题:", diagnosis.issue);
  console.log("建议:", diagnosis.suggestions);
  console.log("新选择器:", diagnosis.newSelector);
}
```

### 自动修复

```javascript
// 尝试自动修复并重试
const result = await SmartDiagnostics.autoFix(
  page,
  async () => {
    await page.click("#dynamic-btn");
  },
  {
    maxRetries: 3,
    waitBetweenRetries: 1000,
  },
);
```

### 健康检查

```javascript
// 页面健康检查
const health = await SmartDiagnostics.checkHealth(page);

console.log("加载状态:", health.loaded);
console.log("错误数:", health.errors.length);
console.log("性能分数:", health.performance);
console.log("可访问性:", health.accessibility);
```

---

## 工作流示例

### 自动化登录

```javascript
async function automateLogin(page, credentials) {
  // 导航到登录页
  await page.goto("https://example.com/login");

  // 智能定位输入框
  const usernameInput = await ElementLocator.find(page, {
    selector: "#username",
    text: "用户名",
    type: "input",
  });

  const passwordInput = await ElementLocator.find(page, {
    selector: "#password",
    type: "password",
  });

  // 输入凭据
  await usernameInput.type(credentials.username);
  await passwordInput.type(credentials.password);

  // 点击登录
  await page.click('[type="submit"]');

  // 等待登录完成
  await page.waitForNavigation();

  // 验证登录成功
  const loggedIn = await SnapshotEngine.isVisible(page, ".user-avatar");
  return loggedIn;
}
```

### 数据采集

```javascript
async function scrapeProducts(page) {
  await page.goto("https://example.com/products");

  const products = await page.evaluate(() => {
    return Array.from(document.querySelectorAll(".product-card")).map(
      (card) => ({
        title: card.querySelector(".title")?.textContent,
        price: card.querySelector(".price")?.textContent,
        image: card.querySelector("img")?.src,
      }),
    );
  });

  return products;
}
```

---

## 性能指标

| 操作       | 响应时间 | 说明       |
| ---------- | -------- | ---------- |
| 元素定位   | <50ms    | 单策略     |
| 多策略定位 | <200ms   | 带降级     |
| 截图对比   | <200ms   | 1080p      |
| 录制操作   | <10ms    | 单个操作   |
| AI诊断     | <500ms   | 含建议生成 |

---

## 下一步

- [Computer Use](/chainlesschain/computer-use) - 桌面级自动化
- [浏览器插件](/chainlesschain/browser-extension) - 浏览器扩展
- [远程控制](/chainlesschain/remote-control) - 完整远程控制

## 关键文件

| 文件 | 说明 |
| --- | --- |
| `desktop-app-vue/src/main/browser/browser-engine.js` | 核心浏览器自动化引擎 |
| `desktop-app-vue/src/main/browser/element-locator.js` | 多策略元素定位器 |
| `desktop-app-vue/src/main/browser/snapshot-engine.js` | 截图对比和变更检测 |
| `desktop-app-vue/src/main/browser/recording-engine.js` | 操作录制与回放 |
| `desktop-app-vue/src/main/browser/smart-diagnostics.js` | AI 诊断与自动修复 |

## 故障排查

### 浏览器启动失败

**现象**: `BrowserEngine.launch()` 抛出异常或超时。

**排查步骤**:

1. 确认 Chromium/Chrome 已正确安装，路径可被 Puppeteer 检测到
2. 检查端口是否被占用：`netstat -an | findstr 9222`
3. 尝试以 `headless: true` 模式启动，排除显示驱动问题
4. 查看日志中 `[BrowserEngine]` 前缀的错误信息

### 元素定位失败

**现象**: `ElementLocator.find()` 返回 null 或超时。

**排查步骤**:

1. 使用 `SmartDiagnostics.diagnose()` 获取失败原因和建议选择器
2. 检查目标元素是否在 iframe 或 Shadow DOM 中
3. 确认页面已完全加载（使用 `page.waitForSelector` 或 `page.waitForNavigation`）
4. 尝试降低定位策略优先级，启用视觉定位作为兜底方案

### 截图对比误报

**现象**: `SnapshotEngine.compare()` 报告差异但页面实际未变化。

**排查步骤**:

1. 调高 `threshold` 参数（如 0.15）以容忍微小渲染差异
2. 排除动态内容区域（广告、时间戳）的影响
3. 确保截图分辨率与基线一致（`defaultViewport` 配置）

## 安全考虑

1. **凭据保护**: 自动化脚本中不要硬编码用户名密码，使用环境变量或加密配置文件
2. **操作隔离**: 自动化浏览器实例使用独立的用户数据目录，避免影响日常浏览数据
3. **Cookie 管理**: 自动化结束后及时清理 Cookie 和 Session，防止会话泄露
4. **网站合规**: 遵守目标网站的 robots.txt 和使用条款，避免触发反爬机制
5. **速率控制**: 合理设置操作间隔和请求频率，避免对目标服务器造成过大压力
6. **脚本审计**: 录制导出的脚本在执行前应人工审查，确认不包含敏感操作
7. **数据脱敏**: 截图和录制内容可能包含敏感信息，存储前进行脱敏处理
8. **沙箱运行**: 建议在隔离环境中运行自动化任务，防止恶意网页影响主系统

## 相关文档

- [Computer Use](/chainlesschain/computer-use) - 桌面级自动化操作
- [浏览器插件](/chainlesschain/browser-extension) - 浏览器扩展集成
- [远程控制](/chainlesschain/remote-control) - 完整远程控制系统

---

**智能自动化，解放重复工作** 🤖
