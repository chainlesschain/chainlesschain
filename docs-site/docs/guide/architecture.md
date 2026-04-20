# 系统架构

## 整体架构

ChainlessChain 采用分层架构设计，确保系统的安全性、可扩展性和可维护性。

## 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户层                                     │
├──────────────────────┬──────────────────────┬───────────────────┤
│   移动端 (Android/iOS)│      PC端 (Win/Mac)  │   Web端 (可选)    │
│   - 移动APP           │      - 桌面应用       │   - 浏览器访问     │
│   - SIMKey认证        │      - U盾认证        │   - 轻量级界面     │
└──────────────────────┴──────────────────────┴───────────────────┘
                               ↕
┌─────────────────────────────────────────────────────────────────┐
│                     业务逻辑层                                    │
├───────────────────┬────────────────────┬────────────────────────┤
│  知识库管理模块    │   去中心化社交模块  │  交易辅助模块          │
│  - 知识存储        │   - P2P通信        │  - 智能合约           │
│  - 向量检索        │   - 身份验证       │  - 信任评分           │
│  - AI问答          │   - 内容分享       │  - 交易协商           │
└───────────────────┴────────────────────┴────────────────────────┘
                               ↕
┌─────────────────────────────────────────────────────────────────┐
│                     数据层                                        │
├──────────────────┬─────────────────────┬────────────────────────┤
│  本地存储         │   分布式存储         │   AI模型层             │
│  - SQLCipher DB  │   - Git仓库          │   - 思维模型(LLM)     │
│  - 文件系统       │   - IPFS(可选)       │   - 问答模型(RAG)     │
│  - 向量数据库     │   - P2P节点          │   - 嵌入模型(Embedding)│
└──────────────────┴─────────────────────┴────────────────────────┘
                               ↕
┌─────────────────────────────────────────────────────────────────┐
│                     安全层                                        │
├──────────────────────────────┬──────────────────────────────────┤
│       U盾 (PC端)              │        SIMKey (移动端)           │
│  - 私钥存储                    │   - 私钥存储                     │
│  - 数字签名                    │   - 数字签名                     │
│  - 身份认证                    │   - SIM卡安全芯片                │
│  - 数据加密密钥                │   - 移动运营商支持               │
└──────────────────────────────┴──────────────────────────────────┘
```

## 核心模块

### 1. 用户层

用户层提供多端访问支持，满足不同场景下的使用需求：

- **PC端 (桌面应用)**
  - 基于 Electron 框架开发
  - 完整功能支持，适合知识管理和内容创作
  - U盾硬件加密，安全性最高

- **移动端 (Android/iOS)**
  - 原生应用开发
  - SIMKey集成，随身携带
  - 移动场景优化

- **Web端 (可选)**
  - 轻量级浏览器访问
  - 基础功能支持
  - 无需安装客户端

### 2. 业务逻辑层

#### 知识库管理模块
- **知识采集**: 多渠道内容输入（手动、导入、网页剪藏）
- **智能处理**: 自动解析、向量化、知识图谱构建
- **AI问答**: RAG技术支持的智能检索和问答
- **版本控制**: Git-based版本管理，完整历史追溯

#### 去中心化社交模块
- **DID身份**: 基于W3C DID标准的去中心化身份
- **P2P通信**: libp2p实现的点对点网络
- **端到端加密**: Signal协议保障通信安全
- **内容分发**: IPFS分布式存储公开内容

#### 交易辅助模块
- **智能匹配**: AI驱动的需求供给匹配
- **智能合约**: 区块链托管，保障交易安全
- **信誉系统**: 去中心化评价体系
- **争议仲裁**: 社区仲裁员机制

### 3. 数据层

#### 本地存储
- **SQLCipher数据库**: AES-256加密的SQLite数据库
  - 存储结构化数据（知识元数据、联系人、交易记录）
  - 硬件密钥保护，防止数据泄露

- **文件系统**: 存储原始文件和多媒体资源
  - 支持大文件存储
  - 透明加密保护

- **向量数据库**: 支持语义检索
  - PC端: Qdrant / ChromaDB
  - 移动端: ChromaDB-Lite

#### 分布式存储
- **Git仓库**: 版本控制和跨设备同步
  - 增量同步，节省带宽
  - 冲突解决机制
  - 加密传输和存储

- **IPFS (可选)**: 公开内容的永久存储
  - 内容寻址，防篡改
  - 去中心化，高可用

#### AI模型层
- **LLM (大语言模型)**: 思维和推理
  - PC端: LLaMA3-70B / Qwen2-7B
  - 移动端: MiniCPM-2B / Gemma-2B
  - 云端: OpenAI GPT-4 / Claude (可选)

- **RAG (检索增强生成)**: 知识库问答
  - 向量检索
  - 上下文注入
  - 答案生成

- **Embedding模型**: 文本向量化
  - bge-large-zh-v1.5 (PC)
  - bge-small-zh-v1.5 (移动)

### 4. 安全层

#### U盾 (PC端)
- **硬件安全芯片**: 私钥永不导出
- **PIN码保护**: 多次错误锁定
- **密钥层次结构**:
  - 主密钥 (Master Key)
  - 设备签名密钥
  - 设备加密密钥
  - 数据库加密密钥
  - 备份加密密钥

#### SIMKey (移动端)
- **SIM卡安全芯片**: 利用现有硬件
- **运营商背书**: 实名制SIM卡
- **始终在线**: 随身携带，便捷使用
- **OMAPI接口**: Android标准API

## 数据流

### 知识添加流程

```
用户输入内容
    ↓
U盾/SIMKey解锁认证
    ↓
内容解析与向量化
    ↓
写入SQLCipher数据库
    ↓
文件保存到本地目录
    ↓
Git commit (本地提交)
    ↓
Git push到加密远程仓库
    ↓
向量数据库索引更新
    ↓
通知其他设备同步
```

### AI问答流程

```
用户提问
    ↓
查询向量化
    ↓
向量检索相关知识 (Top-K)
    ↓
构建提示词 (系统提示 + 检索内容 + 问题)
    ↓
调用本地/云端LLM生成答案
    ↓
返回答案并记录对话历史
    ↓
(可选) 保存有价值对话为新知识
```

### P2P通信流程

```
用户A发送消息给用户B
    ↓
从本地获取B的公钥
    ↓
使用Signal协议加密消息
    ↓
检测B的在线状态
    ↓
[在线] → 直接P2P发送
[离线] → 存储到中继节点
    ↓
B上线后拉取离线消息
    ↓
B使用私钥解密消息
```

## 同步机制

### Git-based同步

ChainlessChain 采用 Git 作为核心同步机制，具有以下优势：

- **去中心化**: 无需中央服务器
- **版本控制**: 完整历史记录
- **冲突解决**: 成熟的merge算法
- **增量同步**: 只传输变化部分
- **加密友好**: 支持git-crypt透明加密

### 同步策略

- **自动同步**: 后台定期检查更新
- **手动同步**: 用户主动触发
- **冲突处理**: 智能合并或用户手动选择
- **离线优先**: 本地操作优先，有网络时同步

## 安全机制

### 加密方案

- **存储加密 (Data at Rest)**
  - SQLCipher: AES-256-CBC
  - 文件: AES-256-GCM
  - Git仓库: git-crypt

- **传输加密 (Data in Transit)**
  - TLS 1.3
  - Signal协议 (端到端加密)

- **密钥管理**
  - 硬件密钥 (U盾/SIMKey)
  - HKDF-SHA256 派生子密钥
  - 助记词备份 (BIP39)

### 身份认证

- **DID (去中心化标识符)**
  - 格式: `did:chainlesschain:<pubkey_hash>`
  - 符合W3C DID标准
  - 可验证凭证 (Verifiable Credentials)

- **多因素认证**
  - 硬件密钥 (必选)
  - PIN码 / 生物识别
  - 设备绑定

## 扩展性设计

### 插件系统
- 支持第三方扩展
- 沙箱隔离
- 权限控制

### API开放
- REST API
- WebSocket实时通信
- SDK支持多语言

### 模块化架构
- 核心模块独立
- 按需加载
- 易于维护和升级

## 性能优化

### 缓存策略
- 本地缓存热数据
- 向量索引加速检索
- LRU淘汰策略

### 并发处理
- 主线程UI响应
- Worker线程处理计算
- 异步I/O操作

### 资源管理
- 懒加载
- 内存池
- 连接池

## 容错设计

### 数据备份
- Git版本历史
- 定期自动备份
- 多地容灾

### 故障恢复
- 本地数据优先
- 降级策略
- 自动重连

### 监控告警
- 本地日志
- 错误追踪
- 性能监控


## 附录：规范章节补全（v5.0.2.34）

> 为对齐项目用户文档标准结构，下列章节补齐若干未在正文中单独列出的视角。已在正文覆盖的章节在此段仅作简述并标注 `见上文` 指引。

### 1. 概述

ChainlessChain 采用"三端 + 双后端 + P2P 网络"的分层架构：桌面（Electron + Vue3）、CLI（Node.js + Commander）、Android（Jetpack Compose）在前端并列；Java Spring Boot（业务）+ Python FastAPI（AI）在后端并列；P2P 层贯穿所有端点，走 libp2p + WebRTC + Signal Protocol。

### 2. 核心特性

- 分层解耦：Main / Renderer 严格 IPC 边界
- 51 个 Pinia stores 按业务域切分
- IPC Domain Split：按领域分离 handler（AI / Security / Notes / Social / Trading / Enterprise）
- DI Container：主进程依赖注入，利于测试
- 插件热加载 + ed25519 签名校验

### 3. 系统架构

见上文正文详细层级图与数据流图。

### 4. 系统定位

架构目标：**本地优先 + 硬件安全 + 可扩展平台**。既是个人第二大脑，也是企业可整包交付的 Electron 框架。

### 5. 核心功能

| 层 | 核心责任 |
|---|---|
| Desktop Main | IPC 网关、插件系统、安全（U-Key / DID）、企业覆盖链 |
| Desktop Renderer | 51 Pinia stores、Shell 骨架、Artifact 面板 |
| CLI | 109 命令（单进程 / Skill / MCP 桥）|
| Java Backend | RBAC / SSO / 合规审计 / 项目管理 |
| Python AI | Ollama 推理、Qdrant 向量、RAG |
| Android | 28 Skills（12 Kotlin + 8 文档 + 8 REMOTE）|

### 6. 技术架构

见 [技术栈](/guide/tech-stack)。关键选型：Electron 39.2.6 + Vue 3.4 + TypeScript 5.9.3 + Pinia 2.1.7 + Spring Boot 3.1.11 + Java 17 + FastAPI + PostgreSQL 16 + Redis 7 + Qdrant。

### 7. 系统特点

- **IPC Domain Split**：原单体 ipc-handlers.js 按域拆分为多个 handler 文件
- **51 Pinia stores**：每个域一个 store，431+ 专项测试
- **主渲双语法**：主进程 CommonJS，渲染器 ES6，通过 contextBridge 桥接
- **P2P 无中心**：libp2p DHT + WebRTC mesh + Signal Protocol E2E
- **多级缓存**：内存 LRU → Redis → 磁盘 → 远程

### 8. 应用场景

- 本地个人 AI 工作站（单机 + Ollama + SQLite/SQLCipher）
- 小团队去中心化协作（DID + libp2p mesh）
- 企业桌面分发（MDM + `.ccprofile` + 审计 sink 替换）
- 移动端协同（Android Skill + 桌面端 DID 双向同步）

### 9. 竞品对比

| 架构维度 | ChainlessChain | Electron 通用框架 | LangChain + UI |
|---|---|---|---|
| IPC 分层 | ✅ Domain Split | ⚠️ 手工 | ❌ Web only |
| 硬件密钥 | ✅ U-Key 集成 | ❌ | ❌ |
| DI Container | ✅ 主进程原生 | ❌ | ⚠️ 部分 |
| 51 stores 切分 | ✅ 按业务域 | ⚠️ | ⚠️ |
| 三端共享 DID | ✅ | ❌ | ❌ |

### 10. 配置参考

```
.chainlesschain/config.json        # 主配置
desktop-app-vue/src/main/config/   # unified-config-manager.js
.env                               # 环境变量（OLLAMA_HOST / QDRANT_HOST / DB_HOST）
```

### 11. 性能指标

- 冷启动：≈ 2.4s
- IPC 单次往返：< 5ms（renderer ↔ main）
- Pinia store commit：< 1ms（热路径）
- P2P 连接建立：< 500ms（mDNS + DHT）

### 12. 测试覆盖

- **14,800+** 测试（累计）
- **431** Pinia store 专项测试（12 文件）
- **220+** V2 治理表面对应 ≈ **5,984** V2 测试（iter16–iter28）
- IPC 合同测试：见 `tests/integration/plugin-extension-points.integration.test.js`

### 13. 安全考虑

- IPC 白名单：`ipc-validator.js` 校验每个通道
- 渲染器隔离：`contextIsolation: true` + `sandbox: true`（可插件上下文解除）
- U-Key 硬件根信任
- DID 私钥仅存硬件密钥内
- 所有外部数据流经 `chain-gateway` 插件可审计

### 14. 故障排除

- **IPC 报 "channel not allowed"**：检查 `ipc-validator.js` 白名单
- **Pinia store 状态不同步**：确认 `persistedState` 配置 + 重启应用
- **插件未加载**：`PluginManager.listPlugins()` + 查看主进程日志
- **Ollama / Qdrant 连不上**：`docker-compose ps`

### 15. 关键文件

```
desktop-app-vue/src/main/
  ipc/                    # IPC Domain Split handlers
  plugin-system/          # 插件管理
  config/unified-config-manager.js
  utils/ipc-validator.js
desktop-app-vue/src/renderer/
  stores/                 # 51 Pinia stores
  shell/                  # v6 Shell 骨架
  router/index.ts
```

### 16. 使用示例

```bash
# 渲染器打开调试
cd desktop-app-vue && npm run dev
# → DevTools 中观察 Pinia stores

# 单元测试主进程 IPC
cd desktop-app-vue && npx vitest run tests/unit/main/
```

### 17. 相关文档

- [技术栈](/guide/tech-stack)
- [快速开始](/guide/getting-started)
- [桌面版 V6 对话壳](/guide/desktop-v6-shell)
- [合规与威胁情报](/guide/compliance-threat-intel)
- [去中心化社交协议](/guide/social-protocols)
- [系统设计主文档](/design/)
