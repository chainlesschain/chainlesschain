# 浏览器扩展 API 实施规划

## 概述

本文档列出了 ChainlessChain 浏览器扩展可新增的浏览器 API 项目。当前实现（第 25 阶段已完成）覆盖主要浏览器 API 的 400+ 项操作。

## 实施状态汇总

### 已完成阶段（第 1–25 阶段）

| 阶段  | 分类           | 操作数 | 状态      |
| ----- | -------------- | ------ | --------- |
| 1–10  | 核心 API       | ~120   | ✅ 已完成 |
| 11–15 | DOM 与事件     | ~80    | ✅ 已完成 |
| 16–19 | 存储与网络     | ~60    | ✅ 已完成 |
| 20–21 | Web API 与系统 | ~45    | ✅ 已完成 |
| 22    | WebRTC 与组件  | ~35    | ✅ 已完成 |
| 23    | 现代 Web API   | ~56    | ✅ 已完成 |
| 24    | 硬件与媒体     | ~51    | ✅ 已完成 |
| 25    | 检测与实用工具 | ~47    | ✅ 已完成 |

**合计：已实现 400+ 项操作**

---

## 后续阶段待实现 API

### 第 26 阶段：性能与分析 API（约 30 项操作）

**Performance Observer API（扩展）**

- `createPerformanceObserver` — 创建性能观察器
- `observePerformanceEntries` — 观察指定类型的条目
- `getPerformanceMarks` — 获取性能标记
- `getPerformanceMeasures` — 获取性能测量值
- `clearPerformanceMarks` — 清除标记
- `clearPerformanceMeasures` — 清除测量值

**User Timing API**

- `createPerformanceMark` — 创建命名标记
- `createPerformanceMeasure` — 在标记之间创建测量
- `getResourceTimings` — 获取资源加载计时
- `getNavigationTiming` — 获取页面导航计时数据

**Long Tasks API**

- `observeLongTasks` — 观察长任务
- `getLongTaskEntries` — 获取长任务条目

**Element Timing API**

- `observeElementTiming` — 观察元素渲染时机
- `markElementForTiming` — 标记元素以供观察

**Layout Instability API（CLS）**

- `observeLayoutShifts` — 观察布局偏移事件
- `getLayoutShiftScore` — 获取累积布局偏移分值

**权限级别**：NORMAL 至 PUBLIC

---

### 第 27 阶段：实验性与新兴 API（约 35 项操作）

**Eyedropper API**

- `openEyedropper` — 打开颜色拾取器
- `isEyedropperSupported` — 检查是否支持

**Screen Capture API（增强）**

- `getDisplayMedia` — 捕获屏幕/窗口
- `selectDisplay` — 选择要捕获的显示器
- `stopScreenCapture` — 停止捕获

**File Handling API**

- `registerFileHandler` — 注册为文件处理程序
- `unregisterFileHandler` — 注销处理程序
- `getFileHandlerState` — 获取注册状态

**Web Share Target API**

- `registerShareTarget` — 注册为分享目标
- `getShareData` — 获取分享数据

**Contact Picker API**

- `selectContacts` — 打开联系人选择器
- `getContactProperties` — 获取可用属性

**Content Index API**

- `addToContentIndex` — 将内容添加到离线索引
- `removeFromContentIndex` — 从索引中移除
- `getContentIndexItems` — 列出已索引项目

**Periodic Background Sync API**

- `registerPeriodicSync` — 注册定期同步
- `unregisterPeriodicSync` — 注销同步
- `getPeriodicSyncTags` — 获取已注册的标签

**App Badging API（扩展）**

- `setAppBadge` — 设置应用角标
- `clearAppBadge` — 清除角标
- `setClientBadge` — 设置客户端角标

**权限级别**：NORMAL 至 ADMIN

---

### 第 28 阶段：安全与隐私 API（约 25 项操作）

**Credential Management API（扩展）**

- `createCredential` — 创建新凭证
- `getCredentials` — 获取已存储凭证
- `preventSilentAccess` — 阻止静默凭证访问

**WebAuthn API**

- `createPublicKeyCredential` — 创建 WebAuthn 凭证
- `getPublicKeyCredential` — 获取 WebAuthn 凭证
- `isUserVerifyingPlatformAuthenticatorAvailable` — 检查 UVPA 可用性

**Trusted Types API**

- `createTrustedTypePolicy` — 创建受信任类型策略
- `isTrustedTypesSupported` — 检查是否支持
- `getTrustedTypePolicies` — 获取策略列表

**Content Security Policy API**

- `getSecurityPolicyViolations` — 获取 CSP 违规记录
- `observeCSPViolations` — 观察违规事件

**子资源完整性（SRI）**

- `validateResourceIntegrity` — 验证 SRI
- `generateIntegrityHash` — 生成 SRI 哈希值

**权限级别**：ADMIN 至 ROOT

---

### 第 29 阶段：图形与渲染 API（约 40 项操作）

**WebGPU API**

- `getGPUAdapter` — 获取 GPU 适配器
- `requestGPUDevice` — 请求 GPU 设备
- `createGPUBuffer` — 创建 GPU 缓冲区
- `createGPUTexture` — 创建纹理
- `createGPUShaderModule` — 创建着色器模块
- `createGPURenderPipeline` — 创建渲染管线
- `createGPUComputePipeline` — 创建计算管线
- `submitGPUCommands` — 提交命令缓冲区
- `isWebGPUSupported` — 检查是否支持

**WebGL2 扩展**

- `getWebGL2Extensions` — 获取 WebGL2 扩展列表
- `createWebGL2Context` — 创建 WebGL2 上下文
- `compileWebGLShader` — 编译着色器
- `linkWebGLProgram` — 链接程序

**OffscreenCanvas API**

- `createOffscreenCanvas` — 创建离屏画布
- `transferToOffscreenCanvas` — 转移到离屏画布
- `getOffscreenContext` — 获取离屏上下文

**ImageBitmap API**

- `createImageBitmap` — 创建图像位图
- `transferImageBitmap` — 转移位图
- `closeImageBitmap` — 关闭/释放位图

**权限级别**：NORMAL 至 ADMIN

---

### 第 30 阶段：通信与消息传递 API（约 25 项操作）

**MessageChannel API**

- `createMessageChannel` — 创建消息通道
- `postMessageToPort` — 向端口发送消息
- `closeMessagePort` — 关闭端口

**MessagePort API**

- `startMessagePort` — 启动端口
- `closeMessagePort` — 关闭端口

**CompressionStream API（扩展）**

- `createCompressionStream` — 创建压缩流
- `createDecompressionStream` — 创建解压缩流
- `pipeCompression` — 通过压缩流传输数据

**TransformStream API**

- `createTransformStream` — 创建转换流
- `chainTransformStreams` — 串联多个转换流

**ReadableStream API（扩展）**

- `createReadableStream` — 创建可读流
- `readFromStream` — 从流中读取数据
- `cancelStream` — 取消流
- `pipeToWritable` — 导向可写流

**WritableStream API**

- `createWritableStream` — 创建可写流
- `writeToStream` — 向流写入数据
- `closeWritableStream` — 关闭流

**权限级别**：NORMAL

---

### 第 31 阶段：设备与硬件 API（约 35 项操作）

**Generic Sensor API**

- `getAccelerometer` — 获取加速度计数据
- `getGyroscope` — 获取陀螺仪数据
- `getMagnetometer` — 获取磁力计数据
- `getAmbientLightSensor` — 获取环境光传感器数据

**Geolocation API（增强）**

- `getCurrentPosition` — 获取当前位置
- `watchPosition` — 监听位置变化
- `clearWatch` — 清除位置监听
- `getGeolocationPermission` — 获取权限状态

**DeviceOrientation API**

- `getDeviceOrientation` — 获取设备方向
- `watchDeviceOrientation` — 监听方向变化
- `getDeviceMotion` — 获取运动数据

**Battery Status API（扩展）**

- `getBatteryManager` — 获取电池管理器
- `watchBatteryStatus` — 监听电池状态变化

**Network Information API（扩展）**

- `getNetworkType` — 获取网络类型
- `getEffectiveType` — 获取有效连接类型
- `watchNetworkChanges` — 监听网络变化
- `getDownlinkMax` — 获取最大下行速率

**Vibration API**

- `vibrate` — 触发振动
- `cancelVibration` — 取消振动

**权限级别**：NORMAL 至 ADMIN

---

### 第 32 阶段：无障碍与国际化（约 20 项操作）

**Selection API（扩展）**

- `getSelection` — 获取文本选区
- `setSelection` — 设置选区范围
- `collapseSelection` — 折叠选区
- `extendSelection` — 扩展选区

**Range API**

- `createRange` — 创建范围
- `setRangeStart` — 设置起始位置
- `setRangeEnd` — 设置结束位置
- `surroundContents` — 用元素包围内容

**Intl API**

- `formatNumber` — 格式化数字
- `formatDate` — 格式化日期
- `formatRelativeTime` — 格式化相对时间
- `listFormat` — 格式化列表
- `pluralRules` — 获取复数规则
- `segmentText` — 文本分段

**权限级别**：PUBLIC 至 NORMAL

---

## 实施指南

### 每个新阶段的操作步骤

1. **修改 background.js**
   - 在 `handleCommand` switch 中添加命令处理器
   - 使用 `chrome.scripting.executeScript` 实现功能函数

2. **修改 browser-extension-server.js**
   - 在 `ExtensionBrowserHandler.handle` 中添加路由分支

3. **修改 permission-gate.js**
   - 为每项操作配置相应权限级别

4. **添加单元测试**
   - 在 browser-extension-server.test.js 中测试路由逻辑

5. **更新文档**
   - 更新本规划文档
   - 如有必要更新 CLAUDE.md

### 安全注意事项

- **PUBLIC**：只读、非敏感操作
- **NORMAL**：标准浏览器操作
- **ADMIN**：敏感数据访问、硬件控制
- **ROOT**：系统级操作、凭证管理

---

## 优先级建议

### 高优先级（优先实施）

1. 第 26 阶段 — 性能 API（调试辅助，实用性高）
2. 第 29 阶段 — 图形 API（WebGPU 正成为新标准）

### 中优先级

3. 第 31 阶段 — 设备 API（移动优先特性）
4. 第 27 阶段 — 实验性 API（面向未来）

### 较低优先级

5. 第 28 阶段 — 安全 API（专项用途）
6. 第 30 阶段 — 通信 API（高级模式）
7. 第 32 阶段 — 无障碍/国际化（细分场景）

---

## 工作量估算

每个阶段大约需要：

- 开发：2–4 小时
- 测试：1–2 小时
- 文档：30 分钟

**剩余总量：7 个阶段约 210 项操作**

---

## 参考资料

- [MDN Web APIs](https://developer.mozilla.org/zh-CN/docs/Web/API)
- [Chrome Platform Status](https://chromestatus.com/)
- [Can I Use](https://caniuse.com/)
- [Web.dev](https://web.dev/)

---

_最后更新：2026-02-28_
_当前版本：第 25 阶段已完成_
