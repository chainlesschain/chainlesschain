# 技术栈

ChainlessChain 采用现代化的技术栈，确保系统的性能、安全性和可维护性。

## PC端技术栈

### 核心框架

#### Electron + Vue 3
```json
{
  "electron": "39.2.6",
  "vue": "^3.4",
  "typescript": "^5.9.3"
}
```

**选择理由**:
- 跨平台支持 (Windows, macOS, Linux)
- 活跃的社区和丰富的生态
- 原生API访问能力
- 热更新支持
- Vue 3 Composition API提供更好的代码组织

### UI框架

#### Ant Design Vue 4.1
```bash
npm install ant-design-vue@4.1
```

**特性**:
- 企业级UI设计语言
- 丰富的组件库 (80+ 组件)
- TypeScript完整支持
- 主题定制能力
- 国际化支持

### 状态管理

#### Pinia (51 TypeScript Stores)
```typescript
import { defineStore } from 'pinia'

export const useKnowledgeStore = defineStore('knowledge', {
  state: () => ({
    items: [] as Knowledge[]
  }),
  actions: {
    async addKnowledge(item: Knowledge) {
      this.items.push(item)
    }
  }
})
```

**优势**:
- Vue 3官方推荐状态管理方案
- TypeScript完美支持
- 模块化设计
- DevTools集成
- 轻量级 (1KB gzipped)

### 数据库

#### SQLite + SQLCipher (AES-256)
```javascript
const sqlite3 = require('better-sqlite3')

const db = sqlite3('data/chainlesschain.db')

// 设置加密密钥 (AES-256)
db.pragma('key = "x\'...\'"')
db.pragma('cipher_page_size = 4096')
```

**特性**:
- AES-256-CBC加密
- 44+张数据库表
- 零配置，嵌入式部署
- 同步API，高性能
- 完整事务支持

### Git操作

#### isomorphic-git
```typescript
import git from 'isomorphic-git'
import fs from 'fs'

await git.commit({
  fs,
  dir: '/path/to/repo',
  message: 'Add new knowledge',
  author: {
    name: 'User',
    email: 'user@example.com'
  }
})
```

**优势**:
- 纯JavaScript实现
- 跨平台
- 支持加密Git操作
- 轻量级

### 加密库

#### node-forge + U盾SDK
```typescript
import forge from 'node-forge'

// RSA加密示例
const publicKey = forge.pki.publicKeyFromPem(pem)
const encrypted = publicKey.encrypt(data, 'RSA-OAEP')
```

**功能**:
- RSA/AES加密解密
- 数字签名验证
- 证书处理
- 哈希计算

## 移动端技术栈

### Android

#### Kotlin + Jetpack Compose
```kotlin
@Composable
fun KnowledgeList(items: List<Knowledge>) {
    LazyColumn {
        items(items) { knowledge ->
            KnowledgeCard(knowledge)
        }
    }
}
```

**技术栈**:
- **语言**: Kotlin
- **UI**: Jetpack Compose
- **架构**: MVVM + Clean Architecture
- **依赖注入**: Hilt / Koin
- **网络**: Ktor Client
- **数据库**: Room + SQLCipher for Android

#### 核心库

| 功能 | 库 | 版本 |
|------|-----|------|
| UI框架 | Jetpack Compose | 1.5+ |
| 导航 | Navigation Compose | 2.7+ |
| 数据库 | Room + SQLCipher | 2.6+ / 4.5+ |
| 网络 | Ktor Client | 2.3+ |
| JSON | Kotlinx Serialization | 1.6+ |
| 图片 | Coil | 2.5+ |
| Git | JGit | 6.7+ |
| 加密 | BouncyCastle | 1.77+ |
| SIMKey | OMAPI | - |

### iOS

#### Swift + SwiftUI
```swift
struct KnowledgeList: View {
    @State var knowledge: [Knowledge] = []

    var body: some View {
        List(knowledge) { item in
            KnowledgeRow(knowledge: item)
        }
    }
}
```

**技术栈**:
- **语言**: Swift
- **UI**: SwiftUI
- **架构**: MVVM + Combine
- **数据库**: Core Data + SQLCipher
- **网络**: Alamofire
- **Git**: ObjectiveGit (libgit2)

#### 核心库

| 功能 | 库 | 版本 |
|------|-----|------|
| UI框架 | SwiftUI | iOS 15+ |
| 数据库 | Core Data + SQLCipher | - |
| 网络 | Alamofire | 5.8+ |
| JSON | Codable (原生) | - |
| 图片 | Kingfisher | 7.10+ |
| Git | ObjectiveGit | 0.19+ |
| 加密 | CryptoKit | iOS 13+ |

## AI服务技术栈

### LLM推理引擎

#### Ollama
```bash
# 安装Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# 拉取模型
ollama pull qwen2:7b
ollama pull llama3:8b

# API调用
curl http://localhost:11434/api/generate -d '{
  "model": "qwen2:7b",
  "prompt": "解释量子计算"
}'
```

**支持的模型**:
- Qwen2 (7B, 14B, 72B)
- LLaMA3 (8B, 70B)
- Mistral (7B)
- Phi-3 (3.8B, mini)

### 向量数据库

#### Qdrant
```python
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams

client = QdrantClient("localhost", port=6333)

client.create_collection(
    collection_name="knowledge_base",
    vectors_config=VectorParams(size=768, distance=Distance.COSINE)
)
```

**特性**:
- 高性能向量检索
- 支持过滤条件
- 分布式部署
- REST API

#### ChromaDB (可选)
```python
import chromadb

chroma_client = chromadb.Client()
collection = chroma_client.create_collection("knowledge")

collection.add(
    embeddings=[[1.1, 2.3, 3.2], ...],
    documents=["doc1", "doc2", ...],
    ids=["id1", "id2", ...]
)
```

**优势**:
- 嵌入式部署
- 简单易用
- 适合移动端

### Embedding模型

#### bge系列
```python
from sentence_transformers import SentenceTransformer

# PC端 - 大模型，高精度
model = SentenceTransformer('BAAI/bge-large-zh-v1.5')
embeddings = model.encode(['文本1', '文本2'])

# 移动端 - 小模型，快速
model_mobile = SentenceTransformer('BAAI/bge-small-zh-v1.5')
```

**模型对比**:

| 模型 | 维度 | 大小 | 场景 |
|------|------|------|------|
| bge-large-zh-v1.5 | 1024 | 1.3GB | PC端 |
| bge-base-zh-v1.5 | 768 | 400MB | 通用 |
| bge-small-zh-v1.5 | 512 | 95MB | 移动端 |

### RAG框架

#### AnythingLLM / QAnything
```yaml
# docker-compose.yml
services:
  anythingllm:
    image: mintplexlabs/anythingllm:latest
    ports:
      - "3001:3001"
    environment:
      - LLM_PROVIDER=ollama
      - OLLAMA_BASE_URL=http://ollama:11434
      - VECTOR_DB=qdrant
```

**功能**:
- 文档解析
- 向量化
- 检索
- 答案生成
- 对话历史管理

## P2P网络技术栈

### libp2p
```typescript
import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { mplex } from '@libp2p/mplex'

const node = await createLibp2p({
  transports: [tcp()],
  connectionEncryption: [noise()],
  streamMuxers: [mplex()]
})
```

**模块**:
- **传输层**: TCP, WebRTC, WebSocket
- **加密**: Noise Protocol
- **多路复用**: mplex, yamux
- **发现**: mDNS, DHT
- **NAT穿透**: AutoNAT, STUN, TURN

### Signal协议

#### libsignal
```typescript
import { SignalProtocolStore, SessionBuilder } from '@signalapp/libsignal-client'

// 建立加密会话
const sessionBuilder = new SessionBuilder(
  store,
  recipientAddress
)
await sessionBuilder.processPreKey(preKeyBundle)
```

**特性**:
- 端到端加密
- 前向安全 (Forward Secrecy)
- 双棘轮算法 (Double Ratchet)
- 异步通信支持

### IPFS (可选)

#### js-ipfs
```typescript
import { create } from 'ipfs-core'

const ipfs = await create()
const { cid } = await ipfs.add('Hello IPFS!')
console.log(cid.toString())
```

**用途**:
- 公开内容分布式存储
- 内容寻址
- 永久存储

## 区块链技术栈

### 智能合约

#### Solidity + Hardhat
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract EscrowContract {
    address public buyer;
    address public seller;
    uint256 public amount;

    constructor(address _seller) payable {
        buyer = msg.sender;
        seller = _seller;
        amount = msg.value;
    }

    function release() public {
        require(msg.sender == buyer, "Only buyer can release");
        payable(seller).transfer(amount);
    }
}
```

**工具链**:
- **开发框架**: Hardhat
- **测试**: Waffle, Chai
- **部署**: Hardhat Deploy
- **验证**: Etherscan Plugin

### 区块链交互

#### Ethers.js v6
```typescript
import { ethers } from 'ethers'

const provider = new ethers.JsonRpcProvider('https://...')
const wallet = new ethers.Wallet(privateKey, provider)

const contract = new ethers.Contract(
  contractAddress,
  abi,
  wallet
)

await contract.release()
```

**功能**:
- 钱包管理
- 合约调用
- 事件监听
- ENS支持

### 支持的区块链

| 区块链 | 用途 | 手续费 |
|--------|------|--------|
| Ethereum | 主网，高价值交易 | 高 |
| Polygon | 低成本交易 | 低 |
| BSC | 备选方案 | 中 |

## 后端服务 (可选)

### 中继服务器

#### Rust + Actix-web
```rust
use actix_web::{web, App, HttpServer, Responder};

async fn relay_message(data: web::Json<Message>) -> impl Responder {
    // 中继消息逻辑
    "OK"
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    HttpServer::new(|| {
        App::new()
            .route("/relay", web::post().to(relay_message))
    })
    .bind("0.0.0.0:8080")?
    .run()
    .await
}
```

**技术栈**:
- **语言**: Rust
- **框架**: Actix-web
- **数据库**: PostgreSQL
- **缓存**: Redis
- **消息队列**: RabbitMQ

### 引导节点

#### Go + libp2p
```go
package main

import (
    "github.com/libp2p/go-libp2p"
    dht "github.com/libp2p/go-libp2p-kad-dht"
)

func main() {
    host, _ := libp2p.New()
    kdht, _ := dht.New(ctx, host)
    kdht.Bootstrap(ctx)
}
```

**功能**:
- DHT引导
- 节点发现
- NAT穿透协助

## 核心技术统计

### 代码规模 (v1.1.0-alpha)

| 指标       | 数值     |
| ---------- | -------- |
| 代码总行数 | 343,000+ |
| Vue组件数  | 379+     |
| IPC处理器  | 498+     |
| 测试用例   | 3,150+   |
| 内置技能   | 95       |
| 数据库表   | 44+      |
| Pinia Store| 51 (TypeScript) |

## 开发工具

### 代码质量

- **Linter**: ESLint + Prettier
- **类型检查**: TypeScript 5.9.3
- **测试**: Vitest (3,150+ 用例)
- **E2E测试**: Playwright + Electron

### 构建工具

- **PC端**: Electron Forge / Builder
- **移动端**: Gradle (Android), Xcode (iOS)
- **前端**: Vite 5.x (HMR, 快速构建)

### CI/CD

```yaml
# .github/workflows/build.yml
name: Build and Test

on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm test
      - run: npm run build
```

### 文档工具

- **API文档**: TypeDoc
- **用户文档**: VitePress (本站)
- **架构图**: Mermaid

## 性能监控

### Sentry
```typescript
import * as Sentry from "@sentry/electron"

Sentry.init({
  dsn: "https://...",
  integrations: [
    new Sentry.BrowserTracing(),
  ],
})
```

**功能**:
- 错误追踪
- 性能监控
- 用户反馈

## 总结

ChainlessChain 的技术栈选型遵循以下原则：

1. **安全第一**: 硬件加密、端到端加密、开源可审计
2. **性能优秀**: 本地优先、异步处理、缓存优化
3. **跨平台**: 一次开发，多端运行
4. **开发效率**: 成熟框架、丰富生态、易于维护
5. **用户体验**: 流畅交互、响应迅速、界面美观

所有技术选型都经过充分验证，确保系统的稳定性和可靠性。


## 附录：规范章节补全（v5.0.2.34）

> 为对齐项目用户文档标准结构，下列章节补齐若干未在正文中单独列出的视角。已在正文覆盖的章节在此段仅作简述并标注 `见上文` 指引。

### 1. 概述

ChainlessChain 技术栈横跨桌面（Electron / Vue / TypeScript）、后端（Java / Python）、移动端（Kotlin / Jetpack Compose）、P2P（libp2p / WebRTC / Signal Protocol）与数据层（PostgreSQL / Redis / Qdrant）。本附录以视角清单形式补齐标准章节。

### 2. 核心特性

- 前端：Electron 39.2.6、Vue 3.4、TypeScript 5.9.3、Pinia 2.1.7、Ant Design Vue 4.1
- 后端：Spring Boot 3.1.11 + Java 17、Python FastAPI + Uvicorn
- AI：Ollama（本地推理）+ Qdrant（向量库）+ BM25 / TF-IDF（`natural` 库）
- 数据：PostgreSQL 16、Redis 7、SQLCipher（AES-256 本地库）
- P2P：libp2p、WebRTC、Signal Protocol 双棘轮
- 移动端：Android + Kotlin + Jetpack Compose

### 3. 系统架构

见 [系统架构](/guide/architecture)。技术选型与架构分层一一对应：Main/CJS ↔ Renderer/ES6 / Java/Spring ↔ Python/FastAPI ↔ P2P/libp2p。

### 4. 系统定位

技术栈定位：**成熟 + 本地优先 + 跨端一致**。前端选择 Electron + Vue 是为了桌面体验与社区生态；后端 Java + Python 双栈分别对应 "业务确定性" 与 "AI 快速迭代"；Android 用 Kotlin + Compose 与桌面 TypeScript 并列保持现代化。

### 5. 核心功能

| 领域 | 主要库 |
|---|---|
| UI 框架 | Vue 3.4、Ant Design Vue 4.1 |
| 状态管理 | Pinia 2.1.7（51 stores）|
| 桌面壳 | Electron 39.2.6 |
| 类型系统 | TypeScript 5.9.3 |
| 测试 | Vitest、Playwright（E2E） |
| HTTP 后端 | Spring Boot 3.1.11、FastAPI |
| AI 推理 | Ollama、Transformers.js |
| 向量检索 | Qdrant |
| 关系型 DB | PostgreSQL 16 |
| 缓存 | Redis 7 |
| 本地加密 DB | SQLCipher（AES-256）|
| P2P | libp2p、WebRTC、Signal Protocol |
| Android | Kotlin、Jetpack Compose |

### 6. 技术架构

见上文正文。补充：CLI 使用 Node.js + Commander + Zod；Skill 系统基于主进程 DI Container 注入依赖。

### 7. 系统特点

- **版本集中管理**：`package.json` / `pom.xml` / `requirements.txt` 统一锁版本
- **双语法桥接**：主进程 CJS 与渲染器 ES6 通过 contextBridge
- **渐进式类型化**：渲染器几乎全 TS，主进程以 JS + JSDoc 为主
- **现代化 Android**：Jetpack Compose + MVVM，与桌面协议对齐

### 8. 应用场景

- 企业桌面：Electron + Spring Boot + 内网 Ollama
- 个人桌面：Electron + 本地 Ollama + SQLite/SQLCipher
- 边缘推理：FastAPI + Qdrant（独立容器部署）
- 移动办公：Android + DID + P2P

### 9. 竞品对比

| 技术维度 | ChainlessChain | Tauri 系 | Flutter 系 |
|---|---|---|---|
| 桌面运行时 | Electron 39（成熟生态）| Rust WebView | Skia |
| 前端类型 | TypeScript + Vue | 灵活 | Dart |
| 后端组合 | Java + Python 双栈 | 通常单栈 | 通常单栈 |
| 向量库 | Qdrant | 需自集成 | 需自集成 |
| 本地加密 DB | SQLCipher | SQLite (待插件) | SQLite (待插件) |

### 10. 配置参考

```bash
# Node（桌面 + CLI）
node -v   # ≥ 20 LTS

# Java（后端）
java -version   # 17

# Python（AI）
python -V   # 3.10+

# Docker（Ollama / Qdrant / Postgres / Redis）
docker-compose up -d
```

### 11. 性能指标

- Electron 冷启动：≈ 2.4s
- Vue 首屏渲染：< 500ms
- Spring Boot 冷启动：≈ 6–10s
- FastAPI 冷启动：< 2s
- Qdrant 向量检索（1M 规模）：< 50ms

### 12. 测试覆盖

- 累计 **14,800+** 测试
- 前端 Vitest + jsdom
- 后端 JUnit 5 + PyTest
- 移动端 JUnit + Espresso
- V2 规范层 **220+** 治理表面（iter16–iter28）

### 13. 安全考虑

- 依赖扫描：`npm audit`、`pip audit`、`mvn dependency-check`
- 锁版本：`package-lock.json` / `requirements.txt` / `pom.xml`
- 运行时：Electron sandbox + contextIsolation
- 加密：SQLCipher AES-256 + Signal Protocol + ed25519

### 14. 故障排除

- **Electron 原生模块编译失败**：`npm rebuild`；Windows 需 VS Build Tools
- **Vue 热更新卡住**：`.vite` 缓存删除重启
- **Java 版本不匹配**：`JAVA_HOME` 指向 17
- **Python 依赖冲突**：建议 `venv` 隔离

### 15. 关键文件

```
desktop-app-vue/package.json           # Electron + Vue + TS 版本
packages/cli/package.json              # CLI + Commander + Vitest
backend/project-service/pom.xml        # Spring Boot + Java 17
backend/ai-service/requirements.txt    # FastAPI + Ollama + Qdrant
mobile-app/build.gradle.kts            # Kotlin + Compose
```

### 16. 使用示例

```bash
# 桌面版开发
cd desktop-app-vue && npm install && npm run dev

# CLI
cd packages/cli && npm install && npx cc --help

# 后端
cd backend/project-service && ./mvnw spring-boot:run
cd backend/ai-service && uvicorn app.main:app --reload

# 移动端
cd mobile-app && ./gradlew assembleDebug
```

### 17. 相关文档

- [系统架构](/guide/architecture)
- [快速开始](/guide/getting-started)
- [桌面版 V6 对话壳](/guide/desktop-v6-shell)
- [合规与威胁情报](/guide/compliance-threat-intel)
- [去中心化社交协议](/guide/social-protocols)
- [系统设计主文档](/design/)
