# P2P语音/视频通话 - 验证和测试指南

## ✅ 代码集成验证

### 1. 文件完整性检查

所有核心文件已成功创建：

#### 后端文件 (Main Process)
- ✅ `src/main/p2p/voice-video-manager.js` (19KB)
- ✅ `src/main/p2p/voice-video-ipc.js` (6.9KB)
- ✅ `src/main/p2p/p2p-enhanced-manager.js` (16KB - 已更新)
- ✅ `src/main/p2p/p2p-enhanced-ipc.js` (15KB - 已更新)
- ✅ `src/main/index.js` (已添加初始化代码)

#### 前端文件 (Renderer Process)
- ✅ `src/renderer/components/call/CallNotification.vue` (6.5KB)
- ✅ `src/renderer/components/call/CallWindow.vue` (17KB)
- ✅ `src/renderer/composables/useP2PCall.js` (8.3KB)

#### 测试文件
- ✅ `tests/unit/p2p/voice-video-manager.test.js`
- ✅ `tests/unit/p2p/voice-video-ipc.test.js`
- ✅ `tests/unit/p2p/p2p-enhanced-voice-video.test.js`

#### 文档文件
- ✅ `docs/P2P_VOICE_VIDEO_IMPLEMENTATION.md`
- ✅ `docs/P2P_VOICE_VIDEO_COMPLETION_SUMMARY.md`
- ✅ `docs/P2P_VOICE_VIDEO_README.md`
- ✅ `docs/user-guide/voice-video-calls.md`
- ✅ `docs/developer-guide/voice-video-development.md`

### 2. 代码集成点验证

#### ✅ 主进程初始化
```javascript
// src/main/index.js:1842
await this.initializeP2PEnhancedManager();

// src/main/index.js:1853
async initializeP2PEnhancedManager() {
  // P2P增强管理器初始化代码
}
```

#### ✅ P2P增强管理器集成
- VoiceVideoManager已集成到P2PEnhancedManager
- 所有公共API已添加
- 事件转发已配置

#### ✅ IPC处理器注册
- 9个IPC通道已注册
- 10个事件通道已配置
- 事件转发到渲染进程已实现

## 🧪 测试执行指南

### 方法1: 运行所有P2P测试

```bash
cd desktop-app-vue

# 运行所有P2P相关测试
npm test -- p2p

# 或使用vitest直接运行
npx vitest run tests/unit/p2p
```

### 方法2: 运行特定测试

```bash
# 只运行语音/视频管理器测试
npm test -- voice-video-manager

# 只运行IPC测试
npm test -- voice-video-ipc

# 只运行集成测试
npm test -- p2p-enhanced-voice-video
```

### 方法3: 交互式测试

```bash
# 启动测试监视模式
npm run test:watch

# 在UI中查看测试
npm run test:ui
```

### 方法4: 生成覆盖率报告

```bash
# 生成测试覆盖率报告
npm test -- --coverage tests/unit/p2p

# 查看覆盖率报告
open coverage/index.html
```

## 🚀 应用启动测试

### 开发模式启动

```bash
cd desktop-app-vue

# 方法1: 使用npm脚本
npm run dev

# 方法2: 从根目录启动
cd ..
npm run dev:desktop-vue
```

### 预期启动日志

启动时应该看到以下日志：

```
[Main] 初始化移动端桥接...
[Main] ✅ 移动端桥接初始化成功
[Main] 初始化P2P增强管理器...
[P2PEnhanced] 初始化增强管理器...
[P2PEnhanced] ✅ 增强管理器初始化完成
[P2PEnhancedIPC] 注册IPC处理器...
[P2PEnhancedIPC] ✅ IPC处理器注册完成
[Main] ✅ P2P增强管理器初始化成功（包含语音/视频功能）
```

### 启动问题排查

如果启动失败，检查：

1. **依赖安装**
   ```bash
   npm install
   ```

2. **构建主进程**
   ```bash
   npm run build:main
   ```

3. **清理缓存**
   ```bash
   rm -rf node_modules/.vite
   npm run dev
   ```

## 🔍 功能验证清单

### 1. 基础功能验证

#### ✅ P2P网络连接
- [ ] P2P节点成功启动
- [ ] 能够连接到其他节点
- [ ] NAT穿透正常工作

#### ✅ 语音通话
- [ ] 能够发起语音通话
- [ ] 能够接听语音通话
- [ ] 能够拒绝语音通话
- [ ] 能够结束语音通话
- [ ] 音频清晰无杂音

#### ✅ 视频通话
- [ ] 能够发起视频通话
- [ ] 能够接听视频通话
- [ ] 本地视频正常显示
- [ ] 远程视频正常显示
- [ ] 视频流畅无卡顿

### 2. 通话控制验证

#### ✅ 静音功能
- [ ] 能够切换静音
- [ ] 静音状态正确显示
- [ ] 对方能感知静音状态

#### ✅ 视频开关
- [ ] 能够开启/关闭视频
- [ ] 视频状态正确显示
- [ ] 对方能看到视频变化

#### ✅ 通话质量
- [ ] 质量指示器正常显示
- [ ] 质量统计数据准确
- [ ] 网络波动时有提示

### 3. 设备管理验证

#### ✅ 设备选择
- [ ] 能够列出所有音频设备
- [ ] 能够列出所有视频设备
- [ ] 能够切换麦克风
- [ ] 能够切换扬声器
- [ ] 能够切换摄像头

#### ✅ 设备权限
- [ ] 首次使用时请求权限
- [ ] 权限被拒绝时有提示
- [ ] 能够引导用户授权

### 4. UI/UX验证

#### ✅ 来电通知
- [ ] 来电通知正确显示
- [ ] 铃声正常播放
- [ ] 来电者信息正确显示
- [ ] 接听/拒绝按钮正常工作

#### ✅ 通话窗口
- [ ] 通话窗口正确显示
- [ ] 视频画面正常渲染
- [ ] 控制按钮正常工作
- [ ] 设置面板正常打开

#### ✅ 状态显示
- [ ] 连接状态正确显示
- [ ] 通话时长正确计时
- [ ] 质量指示器实时更新

### 5. 错误处理验证

#### ✅ 网络错误
- [ ] 网络断开时有提示
- [ ] 能够自动重连
- [ ] 重连失败时正确处理

#### ✅ 设备错误
- [ ] 设备不可用时有提示
- [ ] 设备被占用时有提示
- [ ] 能够切换到其他设备

#### ✅ 通话错误
- [ ] 对方忙时有提示
- [ ] 对方拒绝时有提示
- [ ] 超时未接听时有提示

## 📊 性能测试

### 1. 资源占用测试

```bash
# 启动应用后，使用系统监视器检查：
# - CPU占用率应 < 20%
# - 内存占用应 < 100MB
# - 网络带宽：
#   - 语音通话: ~100Kbps
#   - 视频通话(720p): ~1Mbps
#   - 视频通话(1080p): ~2Mbps
```

### 2. 延迟测试

使用Chrome DevTools或Wireshark测试：
- 音频延迟应 < 150ms
- 视频延迟应 < 300ms
- 呼叫建立时间应 < 3秒

### 3. 稳定性测试

- [ ] 长时间通话（30分钟+）无崩溃
- [ ] 多次通话切换无内存泄漏
- [ ] 网络波动时能正常恢复

## 🌐 网络质量测试

### 测试场景

1. **良好网络**
   - 有线连接
   - 带宽充足
   - 延迟 < 50ms

2. **一般网络**
   - WiFi连接
   - 带宽一般
   - 延迟 50-150ms

3. **较差网络**
   - 移动网络
   - 带宽受限
   - 延迟 > 150ms

### 验证点

- [ ] 良好网络下通话质量优秀
- [ ] 一般网络下通话基本正常
- [ ] 较差网络下有质量提示
- [ ] 网络切换时能自动适应

## 🔧 调试工具

### 1. 启用详细日志

```bash
# 设置环境变量
export DEBUG=p2p:*,webrtc:*

# 启动应用
npm run dev
```

### 2. Chrome DevTools

```javascript
// 在渲染进程中打开DevTools
// 查看Console、Network、Performance标签
```

### 3. 查看WebRTC统计

```javascript
// 在通话过程中，在DevTools Console中执行：
// chrome://webrtc-internals
```

### 4. 查看应用日志

```bash
# macOS
tail -f ~/Library/Logs/chainlesschain-desktop-vue/main.log

# Windows
type %APPDATA%\chainlesschain-desktop-vue\logs\main.log

# Linux
tail -f ~/.config/chainlesschain-desktop-vue/logs/main.log
```

## 📝 测试报告模板

### 测试环境

- **操作系统**:
- **应用版本**: v0.17.0
- **测试日期**:
- **测试人员**:

### 测试结果

| 功能模块 | 测试项 | 结果 | 备注 |
|---------|--------|------|------|
| 语音通话 | 发起通话 | ✅/❌ | |
| 语音通话 | 接听通话 | ✅/❌ | |
| 视频通话 | 发起通话 | ✅/❌ | |
| 视频通话 | 接听通话 | ✅/❌ | |
| 通话控制 | 静音功能 | ✅/❌ | |
| 通话控制 | 视频开关 | ✅/❌ | |
| 设备管理 | 设备选择 | ✅/❌ | |
| 质量监控 | 质量显示 | ✅/❌ | |

### 发现的问题

1.
2.
3.

### 改进建议

1.
2.
3.

## 🎯 验证通过标准

### 必须通过的测试

- ✅ 所有单元测试通过
- ✅ 应用能够正常启动
- ✅ 能够发起和接听通话
- ✅ 音视频质量良好
- ✅ 无明显bug或崩溃

### 可选的增强测试

- ⭐ 性能测试达标
- ⭐ 网络质量测试通过
- ⭐ 长时间稳定性测试通过
- ⭐ 多设备兼容性测试通过

## 📞 支持和反馈

如果在测试过程中遇到问题：

1. **查看日志**
   - 检查控制台输出
   - 查看应用日志文件

2. **查阅文档**
   - 用户指南: `docs/user-guide/voice-video-calls.md`
   - 开发指南: `docs/developer-guide/voice-video-development.md`

3. **提交Issue**
   - GitHub: https://github.com/chainlesschain/chainlesschain/issues
   - 附上日志和截图

4. **联系支持**
   - Email: support@chainlesschain.com

---

**测试版本**: v0.17.0
**文档更新**: 2026-01-11
**状态**: ✅ 准备就绪
