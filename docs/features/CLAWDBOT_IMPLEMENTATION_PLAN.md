# Clawdbot 学习与实施计划

**创建日期**: 2026-01-27
**目标**: 借鉴 clawdbot 的架构和功能，增强 ChainlessChain 的 AI 助手能力

---

## 一、Clawdbot 项目概述

### 1.1 项目定位
- **官网**: https://clawd.bot
- **GitHub**: https://github.com/clawdbot/clawdbot
- **Star 数**: 44,000+
- **开源协议**: MIT
- **开发者**: Peter Steinberger (奥地利)

### 1.2 核心特性
- **本地优先**: 数据以 Markdown 文件存储（类似 Obsidian）
- **多渠道集成**: WhatsApp、Telegram、Slack、Discord、Signal、iMessage、Teams 等
- **隐私保护**: 本地运行，用户完全控制数据
- **语音支持**: macOS/iOS/Android 永久语音唤醒（ElevenLabs）
- **可视化工作空间**: Agent 驱动的 Canvas UI（基于 A2UI）
- **浏览器自动化**: 网页抓取、表单填写、数据提取
- **文件操作**: 读写文件、执行 Shell 命令和脚本
- **设备集成**: macOS 菜单栏应用 + iOS/Android 移动节点

### 1.3 技术栈
- **运行时**: Node.js ≥22
- **语言**: TypeScript
- **包管理器**: npm/pnpm/bun
- **UI 框架**: React
- **浏览器自动化**: Chrome/Chromium (CDP)
- **AI 模型**: Anthropic (Claude) + OpenAI
- **通信协议**: WebSocket (Gateway 控制平面)

---

## 二、架构分析

### 2.1 Gateway 架构模式

```
┌──────────────────────────────────────────────────────────┐
│                    Gateway (localhost:18789)              │
│  ┌────────────────────────────────────────────────────┐  │
│  │  WebSocket Control Plane                           │  │
│  │  - Channel Connections                             │  │
│  │  - Session Management                              │  │
│  │  - Tool Execution                                  │  │
│  │  - Client Communications                           │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
         ↑          ↑           ↑            ↑
         │          │           │            │
    ┌────┘    ┌─────┘     ┌─────┘      ┌─────┘
    │         │           │            │
┌───┴───┐ ┌──┴──┐  ┌─────┴─────┐ ┌────┴────┐
│  CLI  │ │ Web │  │  macOS    │ │ Mobile  │
│ Tools │ │  UI │  │  Menu Bar │ │  Node   │
└───────┘ └─────┘  └───────────┘ └─────────┘
```

**关键设计原则**:
- **单点控制**: 所有客户端通过 WebSocket 连接到 Gateway
- **统一抽象**: 多平台消息通道统一为标准接口
- **会话隔离**: DM 共享 main 会话，群组独立会话
- **工作空间路由**: 支持多用户/多 Agent 部署

### 2.2 Agent 系统

**核心 Agent**: Pi（编程助手，RPC 模式）

**多 Agent 路由**:
- 工作空间级别隔离
- 每个 Agent 独立会话
- 不同 Provider 账户映射到专用 Agent

### 2.3 内存与会话管理

- **存储格式**: Markdown 文件（类似 Obsidian Vault）
- **会话策略**:
  - DM: 默认折叠到 "main" 会话
  - Group: 独立会话
  - 支持按发送者隔离会话

### 2.4 工具系统

- **Slash Commands**: 快捷命令触发
- **Skills**: 可配置的技能模块
- **Streaming**: 块流式 + Telegram 草稿流式

---

## 三、与 ChainlessChain 的对比

| 维度                 | Clawdbot                          | ChainlessChain (当前)            |
| -------------------- | --------------------------------- | -------------------------------- |
| **架构**             | Gateway + WebSocket 控制平面      | Electron Main Process + IPC      |
| **多渠道支持**       | ✅ 10+ 消息平台                   | ❌ 仅桌面应用                    |
| **语音支持**         | ✅ 永久唤醒 (macOS/iOS/Android)   | ❌ 无                            |
| **浏览器自动化**     | ✅ CDP                            | ❌ 无                            |
| **移动端集成**       | ✅ iOS/Android 节点               | ⚠️ Android 10% 完成              |
| **内存存储**         | Markdown 文件                     | SQLite + SQLCipher               |
| **AI 模型**          | Anthropic + OpenAI                | ✅ 14+ 云端 LLM + Ollama         |
| **多 Agent 系统**    | ✅ 工作空间路由                   | ✅ Multi-Agent (v0.24.0)         |
| **隐私保护**         | ✅ 本地优先                       | ✅ 本地优先 + U-Key 硬件加密     |
| **P2P 网络**         | ❌ 无                             | ✅ libp2p + Signal Protocol      |
| **DID 身份**         | ❌ 无                             | ✅ DID-based                     |
| **RAG 检索**         | ⚠️ 基础                           | ✅ 高级 RAG + Reranker           |
| **MCP 集成**         | ❌ 无                             | ✅ POC v0.1.0                    |
| **SessionManager**   | ⚠️ 基础会话管理                   | ✅ 智能压缩 (30-40% token 节省) |
| **ErrorMonitor**     | ❌ 无                             | ✅ AI 诊断 + 自动修复            |
| **LLM 性能面板**     | ❌ 无                             | ✅ Token/成本追踪 + 可视化       |
| **U-Key 硬件安全**   | ❌ 无                             | ✅ SIMKey/U-Key (Windows)        |
| **去中心化交易**     | ❌ 无                             | ✅ 数字资产管理 + 智能合约       |
| **社交论坛**         | ❌ 无                             | ✅ DID 社交 + P2P 加密消息       |

---

## 四、可借鉴的核心特性

### 4.1 高优先级（3-4周）

#### ✅ **多渠道消息集成**
- **目标**: 支持 WhatsApp、Telegram、Discord、Slack
- **实现路径**:
  1. 创建统一消息通道抽象层 (`src/main/channels/`)
  2. 集成现有库:
     - WhatsApp: `@whiskeysockets/baileys`
     - Telegram: `grammy`
     - Discord: `discord.js`
     - Slack: `@slack/bolt`
  3. 实现消息路由到 AI Agent
  4. 支持双向消息同步

**技术要点**:
```typescript
// desktop-app-vue/src/main/channels/channel-manager.ts
interface IChannelAdapter {
  connect(): Promise<void>
  disconnect(): Promise<void>
  sendMessage(chatId: string, message: string): Promise<void>
  onMessage(handler: MessageHandler): void
}

class ChannelManager {
  private adapters: Map<ChannelType, IChannelAdapter>

  registerChannel(type: ChannelType, adapter: IChannelAdapter): void
  routeToAgent(message: IncomingMessage): Promise<AgentResponse>
}
```

#### ✅ **Gateway WebSocket 架构**
- **目标**: 替代 Electron IPC，支持远程客户端连接
- **实现路径**:
  1. 在 Main Process 启动 WebSocket 服务器 (port: 18789)
  2. 实现控制平面协议:
     - 会话管理
     - 工具执行
     - 客户端注册
  3. 迁移现有 IPC 通道到 WebSocket
  4. 支持外部客户端（CLI、Web UI、移动端）

**技术要点**:
```typescript
// desktop-app-vue/src/main/gateway/websocket-server.ts
import { WebSocketServer } from 'ws'

class Gateway {
  private wss: WebSocketServer
  private sessions: Map<string, Session>

  start(port: number): void
  handleConnection(client: WebSocket): void
  routeMessage(msg: GatewayMessage): Promise<GatewayResponse>
}
```

#### ✅ **语音唤醒与交互**
- **目标**: macOS/Windows 永久语音唤醒
- **实现路径**:
  1. 集成 `@picovoice/porcupine-node` (唤醒词检测)
  2. 集成 `@picovoice/leopard-node` (语音转文字)
  3. 集成 ElevenLabs API (文字转语音)
  4. 实现唤醒词触发 → STT → Agent → TTS 流程

**技术要点**:
```typescript
// desktop-app-vue/src/main/voice/voice-assistant.ts
class VoiceAssistant {
  private porcupine: Porcupine  // 唤醒词检测
  private leopard: Leopard      // STT
  private elevenLabs: ElevenLabsClient  // TTS

  startListening(): void
  onWakeWordDetected(callback: () => void): void
  transcribe(audioBuffer: Buffer): Promise<string>
  synthesize(text: string): Promise<Buffer>
}
```

### 4.2 中优先级（5-6周）

#### ⚠️ **Canvas 可视化工作空间**
- **目标**: Agent 驱动的交互式 UI
- **实现路径**:
  1. 基于 Vue3 实现 Canvas 组件
  2. 集成 A2UI 概念（Agent-to-UI）
  3. 支持 Agent 动态生成/控制 UI 元素
  4. 实现白板协作功能

#### ⚠️ **浏览器自动化**
- **目标**: 网页抓取、表单填写、数据提取
- **实现路径**:
  1. 集成 Puppeteer/Playwright
  2. 实现 CDP (Chrome DevTools Protocol) 工具
  3. 提供 Agent 可调用的浏览器操作 API

#### ⚠️ **移动节点增强**
- **目标**: Android/iOS 作为 Gateway 节点
- **实现路径**:
  1. 移动端连接 Gateway WebSocket
  2. 暴露摄像头、屏幕录制、位置服务
  3. 实现 Canvas UI 渲染

### 4.3 低优先级（7-8周）

#### 🔹 **Markdown 内存存储**
- **评估**: ChainlessChain 已有 SQLite + SQLCipher，暂不迁移
- **可选**: 提供 Markdown 导出功能

#### 🔹 **Webhook & Cron 自动化**
- **目标**: 定时任务 + 外部事件触发
- **实现路径**:
  1. 集成 `node-cron`
  2. 实现 Webhook 服务器
  3. 支持 Agent 订阅事件

---

## 五、实施路线图

### Phase 1: 基础架构改造（Week 1-2）

**目标**: 建立 Gateway 架构基础

- [ ] 创建 WebSocket Gateway 服务器
- [ ] 定义控制平面协议
- [ ] 迁移核心 IPC 通道到 WebSocket
- [ ] 实现会话管理器
- [ ] 编写单元测试

**验收标准**:
- Gateway 稳定运行在 localhost:18789
- 现有 Renderer 通过 WebSocket 通信正常
- 支持外部 CLI 客户端连接

### Phase 2: 多渠道集成（Week 3-4）

**目标**: 实现 2-3 个主流消息平台支持

- [ ] 设计统一消息通道接口
- [ ] 实现 Telegram Adapter (grammy)
- [ ] 实现 Discord Adapter (discord.js)
- [ ] 实现 WhatsApp Adapter (Baileys) - 可选
- [ ] 消息路由到现有 AI Agent
- [ ] 双向消息同步测试

**验收标准**:
- 用户可通过 Telegram/Discord 与 AI 对话
- 消息历史保存到 SQLite
- 支持富文本/图片/文件传输

### Phase 3: 语音交互（Week 5-6）

**目标**: 实现语音唤醒和语音对话

- [ ] 集成 Porcupine 唤醒词检测
- [ ] 集成 Leopard STT
- [ ] 集成 ElevenLabs TTS
- [ ] 实现语音交互流程
- [ ] macOS/Windows 后台常驻
- [ ] 唤醒词自定义配置

**验收标准**:
- 说出唤醒词后自动开始语音对话
- 语音转文字准确率 > 90%
- TTS 响应延迟 < 1s

### Phase 4: 高级特性（Week 7-8）

**目标**: Canvas 工作空间 + 浏览器自动化

- [ ] 实现 Canvas Vue 组件
- [ ] Agent-to-UI 协议设计
- [ ] 集成 Puppeteer
- [ ] 实现网页抓取工具
- [ ] 实现表单自动化工具
- [ ] 移动端节点连接测试

**验收标准**:
- Agent 可动态生成 Canvas UI
- 可自动化登录网站并提取数据
- 移动端可通过 Gateway 连接

---

## 六、技术实施细节

### 6.1 目录结构设计

```
desktop-app-vue/src/main/
├── gateway/
│   ├── websocket-server.ts       # WebSocket 服务器
│   ├── control-plane.ts          # 控制平面协议
│   ├── session-manager.ts        # 会话管理
│   └── client-registry.ts        # 客户端注册表
├── channels/
│   ├── channel-manager.ts        # 通道管理器
│   ├── interfaces.ts             # 统一接口定义
│   ├── adapters/
│   │   ├── telegram.ts           # Telegram 适配器
│   │   ├── discord.ts            # Discord 适配器
│   │   ├── whatsapp.ts           # WhatsApp 适配器
│   │   └── slack.ts              # Slack 适配器
│   └── message-router.ts         # 消息路由
├── voice/
│   ├── voice-assistant.ts        # 语音助手主类
│   ├── wake-word-detector.ts    # 唤醒词检测
│   ├── stt-engine.ts             # 语音转文字
│   └── tts-engine.ts             # 文字转语音
├── canvas/
│   ├── canvas-manager.ts         # Canvas 管理器
│   └── a2ui-protocol.ts          # Agent-to-UI 协议
└── automation/
    ├── browser-controller.ts     # 浏览器控制器
    ├── web-scraper.ts            # 网页抓取
    └── form-filler.ts            # 表单填写
```

### 6.2 依赖包清单

```json
{
  "dependencies": {
    // Gateway & WebSocket
    "ws": "^8.16.0",

    // 消息通道
    "grammy": "^1.19.2",
    "discord.js": "^14.14.1",
    "@whiskeysockets/baileys": "^6.5.0",
    "@slack/bolt": "^3.17.1",

    // 语音
    "@picovoice/porcupine-node": "^3.0.0",
    "@picovoice/leopard-node": "^2.0.0",
    "elevenlabs-node": "^1.1.0",

    // 浏览器自动化
    "puppeteer": "^21.9.0",
    "playwright": "^1.41.0",

    // 任务调度
    "node-cron": "^3.0.3"
  }
}
```

### 6.3 配置管理

在 `.chainlesschain/config.json` 中新增配置：

```json
{
  "gateway": {
    "port": 18789,
    "host": "127.0.0.1",
    "ssl": false
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "YOUR_BOT_TOKEN"
    },
    "discord": {
      "enabled": true,
      "botToken": "YOUR_BOT_TOKEN"
    },
    "whatsapp": {
      "enabled": false
    }
  },
  "voice": {
    "enabled": true,
    "wakeWord": "hey lobster",
    "sttProvider": "leopard",
    "ttsProvider": "elevenlabs",
    "elevenLabsApiKey": "YOUR_API_KEY"
  },
  "canvas": {
    "enabled": true
  },
  "automation": {
    "browserPath": "/path/to/chrome",
    "headless": true
  }
}
```

---

## 七、风险评估与缓解

| 风险                         | 影响 | 概率 | 缓解措施                                       |
| ---------------------------- | ---- | ---- | ---------------------------------------------- |
| **WebSocket 性能瓶颈**       | 高   | 中   | 使用 `uWebSockets.js` 替代 `ws`，压力测试     |
| **消息平台 API 变更**        | 中   | 高   | 抽象层隔离，定期更新依赖                       |
| **语音识别准确率不足**       | 中   | 中   | 多引擎备选（Whisper, Azure Speech）            |
| **浏览器自动化被检测**       | 低   | 中   | 使用 Stealth 插件，模拟真人操作                |
| **跨平台兼容性问题**         | 高   | 中   | 充分测试 Windows/macOS/Linux                   |
| **与现有架构冲突**           | 高   | 低   | 渐进式迁移，保持向后兼容                       |
| **第三方服务依赖（TTS/STT）** | 中   | 低   | 提供本地 Ollama 备用方案（如 Whisper）         |

---

## 八、成功指标

### 8.1 功能指标
- [ ] 支持至少 3 个消息平台（Telegram/Discord/WhatsApp）
- [ ] 语音唤醒成功率 > 95%
- [ ] 语音转文字准确率 > 90%
- [ ] Gateway 并发连接数 > 100
- [ ] 消息路由延迟 < 200ms

### 8.2 性能指标
- [ ] Gateway 内存占用 < 500MB
- [ ] WebSocket 连接建立时间 < 100ms
- [ ] 消息吞吐量 > 1000 msg/s
- [ ] CPU 占用率（空闲） < 5%

### 8.3 用户体验指标
- [ ] 首次配置时间 < 5 分钟
- [ ] 语音对话响应时间 < 2s
- [ ] 消息同步延迟 < 500ms
- [ ] 跨平台一致性体验

---

## 九、参考资源

### 9.1 官方文档
- [Clawdbot 官网](https://clawd.bot/)
- [Clawdbot GitHub](https://github.com/clawdbot/clawdbot)
- [Clawdbot 文档](https://docs.clawd.bot/)

### 9.2 技术文档
- [grammY (Telegram Bot Framework)](https://grammy.dev/)
- [Discord.js Guide](https://discordjs.guide/)
- [Baileys (WhatsApp)](https://github.com/WhiskeySockets/Baileys)
- [Picovoice (Wake Word)](https://picovoice.ai/)
- [ElevenLabs (TTS)](https://elevenlabs.io/)
- [Puppeteer](https://pptr.dev/)

### 9.3 ChainlessChain 相关文档
- `docs/features/SESSION_MANAGER.md` - 会话管理
- `docs/features/MCP_USER_GUIDE.md` - MCP 集成
- `docs/MANUS_OPTIMIZATION_GUIDE.md` - Manus 优化
- `.chainlesschain/rules.md` - 编码规范

---

## 十、后续优化方向

### 10.1 企业版功能
- **多租户支持**: 工作空间级别隔离
- **权限管理**: RBAC 角色权限控制
- **审计日志**: 所有操作可追溯
- **SLA 监控**: 服务可用性监控

### 10.2 社区版功能
- **插件市场**: 第三方插件生态
- **主题定制**: UI 主题商店
- **预设模板**: 常用场景模板库
- **国际化**: 多语言支持

### 10.3 技术演进
- **边缘计算**: 本地模型推理优化
- **联邦学习**: 分布式模型训练
- **量子加密**: 后量子密码学
- **Web3 集成**: 与现有 DID/P2P 系统深度融合

---

## 总结

Clawdbot 的核心价值在于：
1. **Gateway 架构** - 统一控制平面，支持多客户端
2. **多渠道抽象** - 消息平台无关化
3. **本地优先** - 隐私保护与数据主权
4. **语音交互** - 永久唤醒，自然对话
5. **可视化工作空间** - Agent 驱动的 UI

ChainlessChain 应优先借鉴前三点，结合现有的 U-Key 安全、DID 身份、P2P 网络优势，打造更强大的去中心化个人 AI 管理系统。

**预计总工时**: 8 周（2 个月）
**资源需求**: 1-2 名全栈工程师
**预算**: 第三方 API 服务费用（ElevenLabs、Picovoice 等）约 $100/月

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：Clawdbot 学习与实施计划。

### 2. 核心特性
见正文要点 / 特性 / 范围章节。

### 3. 系统架构
见正文架构 / 设计章节（或项目根 docs/design/ 系统设计主文档）。

### 4. 系统定位
见正文定位 / 背景章节。

### 5. 核心功能
见正文功能 / 内容章节。

### 6. 技术架构
见正文技术 / 实现章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数 / 环境章节。

### 11. 性能指标
见正文性能 / 指标章节（如有）。

### 12. 测试覆盖
见正文测试 / 验证章节（如有）。

### 13. 安全考虑
见正文安全 / 权限章节（如适用）。

### 14. 故障排除
见正文故障 / 已知限制 / 常见问题章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文命令 / 操作 / API 示例。

### 17. 相关文档
见正文相关链接；项目根 docs/design/ 系统设计主文档与对应模块文档。
