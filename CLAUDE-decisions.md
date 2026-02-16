# ChainlessChain 架构决策记录 (ADR)

> 记录项目中重要的架构决策及其背景，帮助理解"为什么这样做"
>
> **格式**: Architecture Decision Record (ADR)
> **最后更新**: 2026-02-16

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

## ADR-009: Android 端使用 BouncyCastle 实现 secp256k1 椭圆曲线操作

**状态**: 已采纳

**背景**:
Android 端 `WalletCoreAdapter.kt` 需要实现 ECDSA 签名和公钥推导，用于以太坊交易签名和地址生成。需要选择可靠的密码学库来执行 secp256k1 椭圆曲线运算。

**决策**:
使用已有依赖 BouncyCastle (`org.bouncycastle:bcprov-jdk15on:1.70`) 实现全部 secp256k1 操作，包括公钥推导、ECDSA 签名、Recovery ID 计算。

**理由**:

1. **零新增依赖**: BouncyCastle 已在项目 Gradle 中声明，无需引入新库
2. **纯 Java 实现**: 无需 JNI/NDK 编译，避免多架构 `.so` 文件管理
3. **完整 API**: `CustomNamedCurves`、`ECDSASigner`、`FixedPointCombMultiplier` 覆盖所有需求
4. **安全**: `HMacDSAKCalculator(SHA256Digest())` 实现 RFC 6979 确定性签名，防止 k 值重用攻击

**替代方案**:

- **web3j**: 以太坊专用库，但会引入大量不必要的依赖（ABI编码、RPC客户端等）
- **spongycastle**: BouncyCastle 的 Android 分支，但项目已用标准 BouncyCastle
- **Native C (libsecp256k1)**: 性能最优但需 NDK 交叉编译，维护成本高
- **WalletConnect/TrustWallet Core**: 依赖第三方 SDK，不够灵活

**技术细节**:

```kotlin
// 公钥推导 - EC 点乘
val curveParams = CustomNamedCurves.getByName("secp256k1")
val pointQ = FixedPointCombMultiplier().multiply(curveParams.g, privateKeyNum)
val publicKey = pointQ.getEncoded(false) // 65 bytes uncompressed

// ECDSA 签名 - RFC 6979 确定性 k 值
val signer = ECDSASigner(HMacDSAKCalculator(SHA256Digest()))
signer.init(true, ECPrivateKeyParameters(privateKeyNum, domainParams))
val components = signer.generateSignature(hash) // [r, s]

// EIP-2 s 值规范化（防止交易延展性攻击）
val halfN = curveParams.n.shiftRight(1)
if (s > halfN) s = curveParams.n - s
```

**后果**:

- BouncyCastle 纯 Java 实现比 native C 慢约 5-10x，但对钱包签名场景足够
- 需要手动实现 Recovery ID 计算（遍历 0/1 恢复公钥比对）
- BIP32 非硬化派生需要使用压缩公钥（33 字节），需额外提供 `privateKeyToCompressedPublicKey()`

---

## ADR-010: Android 端自研 RLP 编码器

**状态**: 已采纳

**背景**:
以太坊交易需要 RLP (Recursive Length Prefix) 序列化后才能签名和广播。Android 端 `TransactionManager.kt` 的 `buildRawTransaction()` 需要 RLP 编码能力。

**决策**:
自研轻量级 `RLPEncoder.kt` 工具类，实现完整的 RLP 编码规范。

**理由**:

1. **零依赖**: 避免引入 web3j (~20MB) 仅为使用其 RLP 编码
2. **规范简单**: RLP 编码规范仅 ~150 行代码即可完整实现
3. **完全可控**: 支持 Legacy (type 0) 和 EIP-1559 (type 2) 两种交易格式
4. **类型安全**: Kotlin 泛型 + sealed class 提供编译时类型检查

**替代方案**:

- **web3j RLP**: 功能完整但引入过多无关依赖
- **kethereum**: 轻量但社区不够活跃
- **手写字节拼接**: 不使用独立类，直接在 TransactionManager 中拼接，但可复用性差

**实现**:

```kotlin
// RLP 编码规则
// 单字节 [0x00, 0x7f]: 直接编码
// 短字符串 (0-55 bytes): 0x80+len || data
// 长字符串 (>55 bytes): 0xb7+lenOfLen || len || data
// 短列表 (payload 0-55 bytes): 0xc0+len || items
// 长列表 (payload >55 bytes): 0xf7+lenOfLen || len || items

object RLPEncoder {
    fun encodeBytes(data: ByteArray): ByteArray
    fun encodeBigInteger(value: BigInteger): ByteArray
    fun encodeList(items: List<ByteArray>): ByteArray
}
```

**后果**:

- 需要自行维护和测试 RLP 编码正确性
- 仅实现编码（encode），未实现解码（decode），如需解析链上数据需后续扩展
- 交易构建需区分 Legacy 和 EIP-1559 格式，EIP-1559 需要 `0x02` 类型前缀

---

## ADR-011: Ethereum Keystore V3 JSON 自研解密

**状态**: 已采纳

**背景**:
用户需要导入以太坊 Keystore V3 JSON 文件恢复钱包，`WalletManager.kt` 中 `ImportType.KEYSTORE` 分支未实现。Keystore V3 是以太坊标准的私钥加密存储格式。

**决策**:
使用标准库 + BouncyCastle 自研 Keystore V3 解密，支持 scrypt 和 pbkdf2 两种 KDF。

**理由**:

1. **标准明确**: EIP-55 / Keystore V3 规范清晰，实现无歧义
2. **安全关键**: 私钥解密属于安全敏感操作，自研可完全控制流程
3. **已有依赖**: AES-128-CTR（Java标准库）、scrypt（BouncyCastle）、keccak256（MessageDigest）均已可用
4. **格式兼容**: 兼容 MetaMask、Geth、MyEtherWallet 等主流工具导出的 Keystore

**实现流程**:

```
Keystore JSON → 解析 crypto 字段
    ↓
KDF 派生密钥:
  - scrypt: SCrypt.generate(password, salt, n, r, p, dkLen)
  - pbkdf2: PBKDF2WithHmacSHA256(password, salt, iterations, dkLen)
    ↓
MAC 验证: keccak256(derivedKey[16:32] + ciphertext) == mac
    ↓
AES-128-CTR 解密: decrypt(ciphertext, derivedKey[0:16], iv)
    ↓
得到 32 字节私钥
```

**替代方案**:

- **web3j Keystore**: 提供完整的 `WalletUtils.loadCredentials()`，但引入整个 web3j
- **仅支持 scrypt**: 简化实现但不兼容 pbkdf2 格式的 Keystore

**后果**:

- 需要处理多种 KDF 参数组合
- scrypt 计算在移动设备上可能需要 1-3 秒（n=262144 时）
- MAC 验证确保密码正确性，避免用错误密码解密出垃圾数据

---

## ADR-012: Android AI 适配器工厂模式支持自定义端点

**状态**: 已采纳

**背景**:
Android 端 AI 模块使用工厂模式创建 LLM 适配器，但 `CUSTOM` 提供商缺少 `baseURL` 配置支持，导致用户无法连接 OpenAI 兼容的自定义端点（如 vLLM、LocalAI、Azure OpenAI 等）。

**决策**:
在 `AIModule.kt` 的 `CUSTOM` 分支中从 `LLMConfiguration.custom.baseURL` 读取自定义端点，传入 `OpenAIAdapter(apiKey, baseURL)` 构造函数。

**理由**:

1. **用户需求**: 企业用户常用私有部署的 OpenAI 兼容服务
2. **最小改动**: 仅需修改工厂方法中一个分支
3. **向后兼容**: baseURL 为空时默认回退到 `https://api.openai.com/v1`
4. **一致性**: 与桌面端 (Electron) 的 CUSTOM provider 行为保持一致

**后果**:

- 支持所有 OpenAI API 兼容的自托管服务
- 需要用户在 AI 设置界面填写 baseURL 字段
- 错误处理改为友好的中文提示而非 `requireNotNull` 崩溃

---

## 添加新的 ADR

## ADR-013: 统一工具注册表聚合三大工具系统

**状态**: 已采纳

**背景**:
ChainlessChain 拥有三套独立的工具系统：FunctionCaller (60+ 内置工具)、MCP (8 个社区服务器)、Skills (15 个内置技能)。各系统独立管理，AI 引擎无法统一发现、搜索和使用所有工具。Context Engineering 的技能分组序列化也只覆盖了部分工具。

**决策**:
创建 UnifiedToolRegistry 作为三大工具系统的聚合层，提供统一的工具发现、搜索和元数据查询接口。每个工具都关联 Agent Skills 元数据 (instructions, examples, tags)。

**理由**:

1. **统一视图**: AI 引擎只需查询一个注册表即可获取所有可用工具
2. **自动映射**: ToolSkillMapper 为未被 SKILL.md 覆盖的工具提供默认分组
3. **动态扩展**: MCPSkillGenerator 在 MCP 服务器连接时自动生成技能
4. **标准化**: Agent Skills 开放标准 (13 扩展字段) 为每个工具提供 instructions 和 examples

**替代方案**:

- **方案 A: 直接修改各系统添加统一接口** — 侵入性强，耦合度高
- **方案 B: 在 Context Engineering 中硬编码所有工具映射** — 不可扩展，维护成本高
- **方案 C: 使用数据库存储工具注册信息** — 过度设计，增加数据库依赖

**后果**:

- (+) AI 可以按技能分组浏览所有工具，提升工具选择准确性
- (+) 新增 MCP 服务器自动获得技能元数据，无需手动配置
- (+) Agent Skills 标准使技能定义可移植
- (-) 额外的抽象层增加约 900 行代码 (UnifiedToolRegistry 529 + ToolSkillMapper 198 + MCPSkillGenerator 108)
- (-) 工具名称标准化 (kebab-case ↔ snake_case) 需要确保一致性

---

## ADR-014: 采用 Markdown (SKILL.md) 定义技能而非 JSON/YAML

**状态**: 已采纳

**背景**:
需要一种可读、可扩展的技能定义格式，支持 AI 提示词 (可能很长且包含格式化文本)、门控检查、参数定义等结构化和非结构化内容。

**决策**:
采用 Markdown + YAML frontmatter (SKILL.md) 作为技能定义格式，使用 SkillMdParser 解析。结构化数据放在 YAML frontmatter，非结构化内容 (提示词、指南) 放在 Markdown sections。

**理由**:

1. **人类可读**: Markdown 是开发者最熟悉的格式，无需专用编辑器
2. **混合内容**: YAML frontmatter 适合元数据，Markdown body 适合长文本 (提示词)
3. **Git 友好**: 纯文本格式，diff 清晰，合并冲突容易解决
4. **Agent Skills 兼容**: 13 个扩展字段自然映射到 YAML frontmatter + Markdown sections
5. **四层覆盖**: 同名 SKILL.md 在高优先级层自动覆盖低优先级层

**替代方案**:

- **JSON**: 结构化好但不适合长文本提示词，缺乏注释支持
- **YAML**: 缩进敏感，长文本多行字符串语法容易出错
- **TypeScript/JS**: 运行时安全风险，过度灵活

**后果**:

- (+) 用户可以用任何文本编辑器创建/编辑技能
- (+) 社区可以轻松分享技能定义
- (-) 需要 YAML 解析 (gray-matter) + Markdown section 解析的双重逻辑
- (-) 简易 YAML 后备解析器不支持完整 YAML 规范

---

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
