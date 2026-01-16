# ChainlessChain 架构决策记录 (ADR)

> 记录项目中重要的架构决策及其背景，帮助理解"为什么这样做"
>
> **格式**: Architecture Decision Record (ADR)
> **最后更新**: 2026-01-16

---

## ADR-001: 选择 Electron + Vue3 作为桌面应用框架

**状态**: 已采纳

**背景**:
需要构建跨平台桌面应用，支持 Windows/macOS/Linux，需要访问本地文件系统、SQLite 数据库和硬件设备（U-Key）。

**决策**:
采用 Electron 39.x + Vue 3.4 + Vite 构建桌面应用。

**理由**:

1. **跨平台**: 一套代码支持三大平台
2. **生态成熟**: npm 生态丰富，可复用大量 Web 技术
3. **硬件访问**: Node.js 原生模块支持 FFI 调用
4. **性能够用**: 知识库管理场景对性能要求不极端

**替代方案**:

- Tauri: 更轻量但 Rust 学习曲线陡峭
- Qt: C++ 开发效率低
- Flutter Desktop: 生态不够成熟

**后果**:

- 安装包较大（~150MB）
- 内存占用较高（~300MB）
- 需要注意 IPC 通信性能

---

## ADR-002: 使用 SQLite + SQLCipher 作为本地数据库

**状态**: 已采纳

**背景**:
需要本地存储用户知识库、聊天记录、DID 身份等敏感数据，要求加密存储且支持离线使用。

**决策**:
采用 SQLite 3 + SQLCipher (AES-256) 作为本地数据库。

**理由**:

1. **零配置**: 无需安装数据库服务
2. **加密**: SQLCipher 提供透明加密
3. **可靠**: SQLite 是最广泛使用的嵌入式数据库
4. **跨平台**: 所有平台支持一致

**技术细节**:

```javascript
// 使用 better-sqlite3-multiple-ciphers
const Database = require("better-sqlite3-multiple-ciphers");
const db = new Database(dbPath);
db.pragma(`key = '${encryptionKey}'`);
```

**后果**:

- 单写锁限制并发（通过 WAL 模式缓解）
- 大数据量时性能下降（分库分表策略）
- 需要处理 SQLITE_BUSY 错误

---

## ADR-003: 采用 Signal Protocol 实现 E2E 加密

**状态**: 已采纳

**背景**:
P2P 消息传输需要端到端加密，确保只有通信双方能读取消息内容。

**决策**:
采用 Signal Protocol（Double Ratchet 算法）实现消息加密。

**理由**:

1. **业界标准**: WhatsApp、Signal 等使用同样算法
2. **前向保密**: 即使密钥泄露也无法解密历史消息
3. **开源实现**: `@privacyresearch/libsignal-protocol-typescript`
4. **离线支持**: Pre-Key 机制支持离线消息

**实现**:

```javascript
// 使用 @privacyresearch/libsignal-protocol-typescript
import {
  SignalProtocolAddress,
  SessionBuilder,
} from "@privacyresearch/libsignal-protocol-typescript";

const session = await SessionBuilder.build(recipientAddress, preKeyBundle);
const ciphertext = await session.encrypt(plaintext);
```

**后果**:

- 实现复杂度高
- 需要管理 Pre-Key、Identity Key 等
- 多设备同步需要额外处理

---

## ADR-004: 本地优先的 LLM 策略

**状态**: 已采纳

**背景**:
用户关注数据隐私，不希望个人知识库数据发送到云端。同时需要控制 API 调用成本。

**决策**:
默认使用本地 Ollama 模型，仅在复杂任务时调用云端 API。

**理由**:

1. **隐私保护**: 敏感数据不出本地
2. **成本控制**: 本地推理免费
3. **离线可用**: 不依赖网络
4. **灵活性**: 支持 14+ 云端提供商作为备选

**模型选择策略**:
| 任务类型 | 推荐模型 | 原因 |
|---------|---------|------|
| 简单问答 | Ollama qwen2:7b | 免费、快速 |
| 知识检索 | Ollama llama3:8b | 推理能力强 |
| 复杂分析 | 云端 doubao-seed-1.6-pro | 更大上下文 |
| 代码生成 | 云端 claude-3-sonnet | 代码质量高 |

**后果**:

- 需要用户安装 Ollama 和下载模型
- 本地推理速度取决于硬件
- 复杂任务可能需要云端支持

---

## ADR-005: 使用 libp2p 构建 P2P 网络

**状态**: 已采纳

**背景**:
去中心化社交需要点对点通信能力，不依赖中心服务器。

**决策**:
采用 libp2p 3.x 构建 P2P 网络层。

**理由**:

1. **模块化**: 可按需选择传输、发现、加密协议
2. **成熟**: IPFS、Filecoin 使用同样框架
3. **NAT穿透**: 支持多种穿透技术
4. **JavaScript**: 与 Electron 完美集成

**实现架构**:

```
应用层: 消息/文件/社交
        ↓
加密层: Signal Protocol
        ↓
传输层: libp2p (WebSocket + WebRTC)
        ↓
发现层: mDNS + DHT + Signaling Server
```

**后果**:

- 需要信令服务器辅助 NAT 穿透
- 网络复杂度高
- 调试困难

---

## ADR-006: 统一配置目录 `.chainlesschain/`

**状态**: 已采纳

**背景**:
配置文件分散在多个位置（userData、项目根目录、环境变量），难以管理。

**决策**:
借鉴 OpenClaude 最佳实践，创建统一的 `.chainlesschain/` 配置目录。

**目录结构**:

```
.chainlesschain/
├── config.json              # 核心配置
├── rules.md                 # 编码规则
├── memory/                  # 会话数据
│   ├── sessions/
│   ├── preferences/
│   └── learned-patterns/
├── logs/                    # 日志
├── cache/                   # 缓存
└── checkpoints/             # 备份
```

**理由**:

1. **集中管理**: 所有配置一目了然
2. **版本控制**: 部分文件可纳入 Git
3. **迁移方便**: 复制目录即可迁移配置
4. **最佳实践**: 借鉴 OpenClaude 经验

**后果**:

- 需要迁移现有配置
- 需要更新配置读取逻辑
- 文档需要更新

---

## ADR-007: MCP 集成采用渐进式策略

**状态**: 已采纳

**背景**:
Model Context Protocol (MCP) 可扩展 AI 能力，但引入外部工具有安全风险。

**决策**:
采用渐进式 MCP 集成策略，从 POC 开始逐步扩展。

**阶段规划**:

1. **Phase 1 (POC)**: Filesystem、SQLite、Git 服务器
2. **Phase 2**: HTTP+SSE 传输、更多服务器
3. **Phase 3**: 自定义服务器 SDK、社区仓库

**安全策略**:

- 服务器白名单
- 路径访问限制
- 高风险操作用户确认
- 审计日志

**后果**:

- 初期功能有限
- 需要维护安全策略
- 需要用户教育

---

## ADR-008: 错误处理采用 AI 辅助诊断

**状态**: 已采纳

**背景**:
用户遇到错误时难以理解和解决，需要更智能的错误处理。

**决策**:
在 ErrorMonitor 中集成本地 LLM 进行错误诊断。

**实现**:

```javascript
// 使用本地 Ollama 分析错误
const diagnosis = await llmManager.chat(
  [
    { role: "system", content: "你是一个 JavaScript 错误诊断专家..." },
    { role: "user", content: `分析以下错误: ${error.message}` },
  ],
  { provider: "ollama", model: "qwen2:7b" },
);
```

**理由**:

1. **免费**: 使用本地模型无 API 成本
2. **智能**: 提供根因分析和修复建议
3. **隐私**: 错误信息不发送到云端
4. **学习**: 可从历史错误中学习

**后果**:

- 诊断延迟 2-5 秒
- 依赖 Ollama 服务
- 诊断质量取决于模型

---

## 添加新的 ADR

当做出重要架构决策时，请按以下格式添加：

```markdown
## ADR-XXX: [决策标题]

**状态**: 提议中 / 已采纳 / 已废弃 / 已替代

**背景**:
[描述决策的背景和问题]

**决策**:
[描述做出的决策]

**理由**:
[列出选择该方案的理由]

**替代方案**:
[列出考虑过的其他方案]

**后果**:
[描述该决策的正面和负面影响]
```

---

**维护者**: 架构师 / 技术负责人
**更新周期**: 每次重大架构决策后更新
