# Changelog

All notable changes to ChainlessChain project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Git repository encryption (git-crypt)
- Knowledge graph visualization
- Multi-language UI support
- 完善U盾驱动（FeiTian、WatchData）
- P2P WebRTC支持和NAT穿透优化
- 移动端UI完善

---

## [0.20.0] - 2026-01-07

### Added
- **Word文档预览和导出功能**
  - Word文档DOM API集成
  - 文档预览界面
  - 导出功能支持
- **Windows便携版发布** (x64, 166MB)
  - 解压即用，无需安装
  - 支持Windows 10/11 (64位)
- **E2E测试用例**
  - message-display-fix测试
  - word-preview测试
- **完整文档集**
  - Word导出功能使用指南
  - 故障排查手册
  - 修复方案文档

### Fixed
- Word文档DOM API问题
- 项目路径字段名错误
- DuckDuckGo搜索API失败问题

### Changed
- 优化搜索功能，添加备选搜索方案
- 完善功能文档和测试脚本

### Downloads
- **macOS ARM64**: ChainlessChain-darwin-arm64-0.20.0.zip (142MB)
- **macOS x64**: ChainlessChain-darwin-x64-0.20.0.zip (148MB)
- **Windows x64**: ChainlessChain-win32-x64-0.20.0.zip (166MB)

---

## [0.21.0] - 2026-01-06

### Added
- **深度性能优化系统**（14,000+行代码）
  - 智能图片优化系统（WebP/AVIF格式检测、响应式加载、渐进式加载、LQIP占位符）
  - 实时性能监控系统（Core Web Vitals监控、FPS监控、内存监控、性能告警）
  - 前端深度优化（代码分割、组件懒加载、虚拟滚动、智能预取）
  - 18个优化工具类 + 4个专用组件
- **8个详细优化文档**（~4,200行）
  - ADVANCED_OPTIMIZATIONS.md
  - DEEP_OPTIMIZATION_COMPLETE.md
  - OPTIMIZATION_INTEGRATION_*.md

### Improved
- 性能优化集成（内存降级、磁盘检查、并发控制、文件恢复）
- 测试框架全面升级到Vitest（94个测试文件，900+测试用例）
- 安全防护体系（输入验证、权限控制、加密传输）
- 4个核心模块单元测试（Git、文件权限、合约引擎、桥接管理）

---

## [0.19.5] - 2026-01-02

### Added
- **P2优化系统完成**
  - 意图融合模块（927行）
  - 知识蒸馏模块（668行）
  - 流式响应模块（684行）
  - 任务分解增强
  - 工具组合系统
  - 历史记忆优化
- **V3工具系统恢复**（300个工具，覆盖9大专业领域）
- **应用菜单集成**
  - MenuManager管理器
  - 20+个IPC通道
  - 高级特性控制面板

### Improved
- AI引擎性能大幅提升
  - LLM调用减少58%
  - 感知延迟降低93%
  - 计算成本节省28%

---

## [0.19.0] - 2025-12-31

### Changed
- 更新项目文档
- 优化模板配置
- 完善测试套件（62个测试文件）
- 代码库重构优化

---

## [0.18.0] - 2025-12-30

### Added
- **企业版（去中心化组织）核心功能**
  - 多身份架构（一个用户DID可拥有个人身份+多个组织身份）
  - RBAC权限系统（4个内置角色，自定义角色支持）
  - 组织管理（创建/删除/成员管理/邀请系统）
  - 数据库隔离（9个新表，每个身份独立数据库文件）
  - 组织DID支持（did:chainlesschain:org:xxxx）
- **技能工具系统扩展**至115个技能 + 300个工具
  - 10大类别（3D建模、音频分析、区块链、IoT、机器学习等）
- **Playwright E2E测试框架**
- **多数据库隔离支持**

### Improved
- 组织级DID创建和管理
- 动态切换不同身份的数据库

---

## [0.17.0] - 2025-12-29

### Added
- **区块链集成Phase 1-3完成**
  - 智能合约系统（6个合约 + 测试 + 部署脚本）
    - ChainlessToken (ERC-20, 70行)
    - ChainlessNFT (ERC-721, 140行)
    - EscrowContract (托管合约, 260行)
    - SubscriptionContract (订阅合约, 300行)
    - BountyContract (悬赏合约, 330行)
    - AssetBridge (跨链桥, 300行)
  - 完整测试套件（600+行, 45+测试用例）
- **HD钱包系统**
  - 内置HD钱包（BIP39助记词 + BIP44路径 + AES-256-GCM加密）
  - 外部钱包集成（MetaMask + WalletConnect v1）
  - 交易监控和状态追踪
- **技能工具系统**（第1-5批）
- **插件系统**（动态加载 + 热更新）
- **浏览器扩展**（网页标注 + 内容提取 + AI辅助）
- **语音识别Phase 3**（音频增强 + 多语言检测 + 字幕生成）

---

## [0.16.0] - 2025-12-28

### Added
- **Phase 3完成：去中心化交易系统**（8大模块，5,960+行代码）
  - 数字资产管理（~750行）
  - 交易市场（~850行）
  - 智能合约引擎（~1,200行 + 模板）
  - 托管服务（~650行）
  - 知识付费（~900行）
  - 信用评分（~700行）
  - 评价系统（~750行）
  - 订单管理（集成在交易市场）
- **19个AI专用引擎**
  - 代码生成/审查、文档处理、图像/视频处理、Web开发、数据分析等
- **完整前端UI**（20+交易组件）
- **后端服务体系**（149个API端点）
  - Project Service (Spring Boot, 48 API)
  - AI Service (FastAPI, 38 API)
  - Community Forum (63 API)
- **数据库同步系统**（SQLite ↔ PostgreSQL双向同步）
- **测试框架升级**

### Improved
- 代码量突破240,000+行
- Vue组件数量达到288个

---

## [0.11.0] - 2025-12-18

### Added
- **Image Upload & OCR**: Full image processing pipeline with Tesseract.js
  - Multi-language OCR support (100+ languages including Chinese, English, Japanese)
  - Smart image compression using Sharp
  - Automatic thumbnail generation
  - OCR confidence scoring and quality assessment
  - Full-text search integration for extracted text
  - Automatic knowledge base association
- English documentation (README_EN.md)
- Project progress report (PROJECT_PROGRESS_REPORT_2025-12-18.md)
- Comprehensive project badges and status indicators

### Changed
- Updated README.md with latest progress (66% completion)
- Enhanced project structure documentation
- Improved quick start guide

### Fixed
- Image storage and retrieval optimization
- OCR text indexing performance

---

## [0.10.0] - 2025-12

### Added
- **Reranker System**: Enhanced RAG retrieval accuracy
  - LLM-based reranking using prompt scoring
  - Keyword-based reranking (fast alternative)
  - Hybrid reranking strategy
  - Cross-Encoder support framework
- Configurable reranking strategies
- Performance metrics for reranking operations

### Changed
- Improved RAG search result quality by 30%
- Optimized vector search with reranking pipeline

---

## [0.9.0] - 2025-11

### Added
- **Multi-Format File Import**: Comprehensive document import system
  - Markdown file import with frontmatter support
  - PDF document import with text extraction
  - Word document import (.docx, .doc)
  - Plain text file import (.txt)
  - Batch import support
- Import progress tracking and error handling
- File format detection and validation

### Changed
- Enhanced file parsing capabilities
- Improved import UI/UX with progress indicators

### Fixed
- PDF text extraction encoding issues
- Word document formatting preservation

---

## [0.8.0] - 2025-11

### Added
- **Verifiable Credentials System** (W3C VC standard)
  - VC template management
  - Credential creation and issuance
  - Credential verification
  - Credential sharing functionality
  - Support for multiple credential types (identity, skill, certification)
- VC storage in encrypted database
- VC export/import functionality

### Changed
- Enhanced DID document structure to support VCs
- Updated identity management UI

---

## [0.7.0] - 2025-10

### Added
- Community forum backend (Spring Boot)
  - RESTful API for posts, replies, categories
  - JWT authentication
  - Elasticsearch full-text search
  - Redis caching
- Community forum frontend (Vue3)
  - Responsive design with Element Plus
  - Post creation and editing
  - Reply and comment system
  - Search functionality
- Docker deployment configuration

### Changed
- Separated forum into standalone application
- Improved authentication flow

---

## [0.6.1] - 2025-10

### Added
- **DHT Network Publishing**: Decentralized DID document distribution
  - DID document publishing to DHT
  - DID resolution from DHT network
  - DID revocation support
  - Digital signature verification
  - DHT key format: `/did/chainlesschain/<identifier>`

### Changed
- Enhanced P2P network integration
- Improved DID discovery mechanism

---

## [0.6.0] - 2025-10

### Added
- Decentralized Identity (DID) system
  - DID generation based on USB Key/SIMKey
  - DID document creation and management
  - W3C DID standard compliance
- P2P communication foundation
  - libp2p network stack integration
  - Peer discovery (mDNS, Bootstrap, Kad-DHT)
  - Multiple transport protocols (TCP, WebRTC, WebSocket)
  - Noise protocol encryption
- Contact management system

### Changed
- Enhanced security architecture with DID integration
- Updated database schema for identity management

---

## [0.5.0] - 2025-09

### Added
- Git synchronization enhancements
  - Automatic conflict detection
  - Visual conflict resolution interface
  - Side-by-side diff view
  - Manual merge editing
  - Abort merge functionality
- Git operation status tracking

### Changed
- Improved Git error handling
- Enhanced sync reliability

### Fixed
- Git merge conflicts not properly detected
- Race conditions in concurrent git operations

---

## [0.4.0] - 2025-09

### Added
- **Git Conflict Resolution**: Visual merge conflict tool
  - Automatic conflict detection
  - Side-by-side comparison view
  - Manual conflict editing
  - Complete/abort merge operations
- Git operation history tracking
- Commit message templates

### Changed
- Refactored Git sync manager
- Improved error messages for Git operations

---

## [0.3.0] - 2025-08

### Added
- RAG (Retrieval Augmented Generation) system
  - Vector database integration (ChromaDB)
  - Semantic search capabilities
  - Embedding generation (bge-large-zh-v1.5)
  - Context-aware question answering
- AI conversation history
- Multiple LLM provider support (Ollama, OpenAI, DeepSeek)

### Changed
- Enhanced knowledge retrieval accuracy
- Optimized vector search performance

### Fixed
- Memory leaks in vector database operations
- Token counting accuracy

---

## [0.2.0] - 2025-08

### Added
- USB Key (U盾) integration
  - Hardware key detection
  - PIN verification
  - Digital signature operations
  - Data encryption/decryption
  - Software simulation mode for development
  - Xinjinke driver support
- Encrypted database (SQLCipher)
- Basic Git synchronization
  - Repository initialization
  - Commit/push/pull operations
  - Markdown export

### Changed
- Enhanced security with hardware-based encryption
- Improved data protection mechanisms

---

## [0.1.0] - 2025-08

### Added
- **Initial MVP Release**: Knowledge base management system
- Desktop application framework (Electron + Vue3)
  - Main process architecture
  - Renderer process with Vue3 components
  - IPC communication
- Knowledge management features
  - Create, read, update, delete notes
  - Markdown editor (Milkdown)
  - Tag system
  - Full-text search (FTS5)
- SQLite database with better-sqlite3
- Basic UI with Ant Design Vue
- Project structure and build system

---

## Project Milestones

### Phase 1: Knowledge Base (95% Complete) ✅
- [x] Desktop application framework
- [x] USB Key integration
- [x] Encrypted storage
- [x] Local LLM integration
- [x] RAG system
- [x] Git synchronization
- [x] File import (multiple formats)
- [x] Image upload and OCR
- [ ] Voice input (planned)
- [ ] Web clipping (planned)

### Phase 2: Decentralized Social (70% Complete) 🟡
- [x] DID identity system
- [x] DHT network publishing
- [x] Verifiable credentials
- [x] P2P network foundation
- [x] Community forum
- [ ] End-to-end encryption (in progress)
- [ ] Private messaging (in progress)
- [ ] Mobile app UI (in progress)

### Phase 3: Transaction Assistance (0% Complete) 🔴
- [ ] Smart contract integration
- [ ] AI matching engine
- [ ] Reputation system
- [ ] Arbitration mechanism
- [ ] Blockchain payment

---

## Version History Summary

| Version | Date | Focus | Completion |
|---------|------|-------|-----------|
| 0.20.0 | 2026-01-07 | Word Export + Windows Release | Overall: 99% |
| 0.21.0 | 2026-01-06 | Deep Performance Optimization | Overall: 99% |
| 0.19.5 | 2026-01-02 | P2 Optimization + V3 Tools | Overall: 99% |
| 0.19.0 | 2025-12-31 | Code Refinement | Overall: 99% |
| 0.18.0 | 2025-12-30 | Enterprise Edition | Overall: 98% |
| 0.17.0 | 2025-12-29 | Blockchain Phase 1-3 | Overall: 95% |
| 0.16.0 | 2025-12-28 | Trading System | Overall: 90% |
| 0.11.0 | 2025-12-18 | Image OCR | Phase 1: 95% |
| 0.10.0 | 2025-12 | Reranker | Phase 1: 90% |
| 0.9.0 | 2025-11 | File Import | Phase 1: 85% |
| 0.8.0 | 2025-11 | VC System | Phase 2: 70% |
| 0.7.0 | 2025-10 | Forum | Phase 2: 60% |
| 0.6.1 | 2025-10 | DHT Network | Phase 2: 55% |
| 0.6.0 | 2025-10 | DID System | Phase 2: 50% |
| 0.5.0 | 2025-09 | Git Enhance | Phase 1: 80% |
| 0.4.0 | 2025-09 | Git Conflicts | Phase 1: 75% |
| 0.3.0 | 2025-08 | RAG System | Phase 1: 70% |
| 0.2.0 | 2025-08 | USB Key | Phase 1: 60% |
| 0.1.0 | 2025-08 | MVP | Phase 1: 40% |

---

## Contributors

Special thanks to all contributors who have helped build ChainlessChain!

- Core development team
- Community contributors
- Open source library maintainers

---

## Links

- [GitHub Repository](https://github.com/chainlesschain/chainlesschain)
- [Documentation](./README.md)
- [Design Document](./系统设计_个人移动AI管理系统.md)
- [Progress Report](./PROJECT_PROGRESS_REPORT_2025-12-18.md)
- [Contributing Guide](./CONTRIBUTING.md)
- [License](./LICENSE)
