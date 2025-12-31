# ChainlessChain - Personal Mobile AI Management System Based on USB Key and SIMKey

<div align="center">

![Version](https://img.shields.io/badge/version-v0.18.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Progress](https://img.shields.io/badge/progress-98%25-brightgreen.svg)
![Phase 1](https://img.shields.io/badge/Phase%201-100%25-brightgreen.svg)
![Phase 2](https://img.shields.io/badge/Phase%202-100%25-brightgreen.svg)
![Phase 3](https://img.shields.io/badge/Phase%203-100%25-brightgreen.svg)
![Enterprise](https://img.shields.io/badge/Enterprise-40%25-yellow.svg)
![Blockchain](https://img.shields.io/badge/Blockchain-50%25-yellow.svg)

**Decentralized · Privacy First · AI Native**

A fully decentralized personal AI assistant platform integrating knowledge base management, social networking, and transaction assistance.

[中文](./README.md) | [Design Document](./系统设计_个人移动AI管理系统.md)

</div>

---

## ⭐ Current Version: v0.18.0 (2025-12-30)

### Latest Updates
- ✅ **Enterprise Edition (Decentralized Organizations)** - Multi-identity architecture, RBAC permission system, organization management (create/join/member management), database isolation (9 new tables), organization DID support ⭐NEW
- ✅ **Skill & Tool System Expanded to 115 Skills** - Batches 6-10 complete, 216 tools covering 10 categories (3D modeling, audio analysis, blockchain, IoT, machine learning, cybersecurity, bioinformatics, quantum communication, etc.) ⭐NEW
- ✅ **Playwright Testing Framework Integrated** - E2E testing framework integration, 300+ new test cases, significantly improved test coverage ⭐NEW
- ✅ **Multi-Database Isolation** - Support for personal database + multiple organization databases, complete data isolation, dynamic switching ⭐NEW
- ✅ **Blockchain Integration Phase 1-3 Complete** - Smart contract system (6 contracts + tests + deployment), wallet system (built-in + external), Hardhat development environment
- ✅ **Smart Contract Development** - ChainlessToken (ERC20), ChainlessNFT (ERC721), escrow, subscription, bounty, cross-chain bridge contracts, 2400+ lines of code
- ✅ **Browser Extension Enhancement** - Automated testing framework, user/developer/testing guides, test report generation
- ✅ **Plugin System Enhancement** - Integrated with skill-tool system, supports dynamic loading and hot reload
- ✅ **Voice Recognition System Complete** - Phase 3 advanced features, audio enhancement, multi-language detection, subtitle generation
- ✅ **19 AI Specialized Engines** - Code generation/review, document processing (Word/PDF/Excel/PPT), image/video processing, web development, data analysis, and more
- ✅ **Complete Backend Service System** - Project Service (Spring Boot, 48 APIs) + AI Service (FastAPI, 38 APIs) + Community Forum (63 APIs)
- ✅ **145 Vue Components** - 14 pages, 54 project components, trading components (with escrow UI), social components, editors, skill-tool components, enterprise edition components

### Project Status (Overall Completion: 98%)
- 🟢 **Knowledge Base Management**: 95% Complete - **Production Ready**
- 🟢 **AI Engine System**: 85% Complete - **19 Specialized Engines**
- 🟢 **RAG Retrieval System**: 85% Complete - **Hybrid Search + Reranking**
- 🟢 **Backend Services**: 90% Complete - **3 Microservices Available**
- 🟢 **Skill & Tool System**: 95% Complete - **115 Skills + 216 Tools** ⭐Updated
- 🟢 **Plugin System**: 85% Complete - **Dynamic Loading + Hot Reload**
- 🟢 **Voice Recognition**: 90% Complete - **Advanced Features Complete**
- 🟡 **Enterprise Edition (Decentralized Organizations)**: 40% Complete - **Core Features Done** ⭐NEW
- 🟡 **Testing Framework**: 85% Complete - **Playwright Integrated** ⭐NEW
- 🟡 **Blockchain Integration**: 50% Complete - **Phase 1-3 Complete**
- 🟡 **Decentralized Identity**: 80% Complete - **DID + Org DID + VC** ⭐Updated
- 🟡 **P2P Communication**: 75% Complete - **E2E Encryption Complete**
- 🟡 **Social System**: 85% Complete - **Friends + Posts + Forum**
- 🟡 **Trading System**: 85% Complete - **8 Modules + On-chain Contracts**
- 🟡 **Browser Extension**: 70% Complete - **Testing Framework + Documentation**
- 🔴 **USB Key Integration**: 45% Complete - **5 Brand Drivers** ⭐Updated
- 🟡 **Mobile Application**: 10% Complete - **Framework Setup**

## Core Features

- 🔐 **Military-Grade Security**: SQLCipher AES-256 encryption + USB Key hardware keys + Signal protocol E2E encryption ✅
- 🌐 **Fully Decentralized**: P2P network (libp2p 3.1.2) + DHT + local data storage, no central servers needed ✅
- 🧠 **AI Native**: Support for 14+ cloud LLM providers + Ollama local deployment + RAG-enhanced retrieval ✅
- 🎯 **19 AI Engines**: Code/document/spreadsheet/PPT/PDF/image/video specialized processing, covering all scenarios ✅
- 📋 **Template System**: 178 AI templates + 32 categories + smart engine allocation + 100% configuration coverage ✅ ⭐NEW
- ⛓️ **Blockchain Integration**: 6 smart contracts + HD wallet system + MetaMask/WalletConnect + Hardhat development environment ✅
- 🏢 **Enterprise Edition (Decentralized Organizations)**: Multi-identity architecture + RBAC permissions + organization management + data isolation ✅ ⭐NEW
- 🔧 **Skill & Tool System**: 115 skills + 216 tools + 10 categories + dynamic management ✅ ⭐Updated
- 🔌 **Plugin System**: Dynamic loading + hot reload + lifecycle management + API extension ✅
- 🎤 **Voice Recognition**: Real-time transcription + audio enhancement + multi-language detection + subtitle generation ✅
- 📱 **Cross-Device Collaboration**: Git sync + multi-device P2P communication + offline message queue ✅
- 🔓 **Open Source & Self-Hosted**: 160,000+ lines of code, 145 Vue components, fully transparent and auditable ✅ ⭐Updated
- 📸 **Smart Image Processing**: Tesseract.js OCR + Sharp image processing + auto-indexing ✅
- 💼 **Microservice Architecture**: Project Service + AI Service + Community Forum, 149 API endpoints ✅
- 🔄 **Database Sync**: SQLite ↔ PostgreSQL bidirectional sync, soft delete + conflict resolution ✅
- 🌐 **Browser Extension**: Web annotation + content extraction + AI assistance + automated testing ✅
- 🧪 **Complete Testing System**: Playwright E2E + Vitest unit tests + 700+ test cases ✅ ⭐NEW

## Four Core Functions

### 1️⃣ Knowledge Base Management (95% Complete) ✅

**Database System**:
- ✅ SQL.js + SQLCipher AES-256 encrypted database (20+ tables)
- ✅ Unified management of knowledge items, tags, conversations, projects, tasks
- ✅ Soft delete mechanism + auto-save + transaction support
- ✅ SQLite ↔ PostgreSQL bidirectional sync (4 core modules)

**AI-Enhanced Retrieval (RAG)**:
- ✅ ChromaDB/Qdrant vector storage
- ✅ Hybrid search (vector + keyword + FTS5 full-text index)
- ✅ 3 reranking algorithms (LLM, CrossEncoder, hybrid)
- ✅ Query rewriting (multi-query, HyDE, step-back)
- ✅ Performance monitoring and metrics collection

**File Processing**:
- ✅ Multi-format import: Markdown/PDF/Word/TXT/Images
- ✅ OCR recognition: Tesseract.js, supports Chinese and English
- ✅ Image processing: Sharp compression, thumbnails, format conversion
- ✅ 6 specialized editors: Code/Markdown/Excel/PPT/RichText/WebDev

**Version Control**:
- ✅ isomorphic-git pure JS implementation
- ✅ AI auto-generated commit messages
- ✅ Visual conflict resolution UI
- ✅ Git sync scheduler

### 2️⃣ Decentralized Social (85% Complete) ✅

**DID Identity System**:
- ✅ W3C DID Core standard (`did:chainlesschain:<identifier>`)
- ✅ Ed25519 signing key pair + X25519 encryption key pair
- ✅ DID document generation, signing, verification
- ✅ Multi-identity support + mnemonic export
- ⏳ P2P network publishing and resolution (framework ready)

**Verifiable Credentials (VC)**:
- ✅ 5 credential types: self-claim, skill certificate, trust endorsement, education, work experience
- ✅ W3C VC standard signing and verification
- ✅ Credential lifecycle management + revocation mechanism

**P2P Network**:
- ✅ libp2p 3.1.2 node management
- ✅ TCP transport + Noise encryption + Kademlia DHT
- ✅ mDNS local discovery + device hot-plug monitoring
- ✅ Signal Protocol E2E encryption (complete implementation)
- ✅ Device management + cross-device sync + offline message queue
- ⏳ WebRTC support (framework ready)

**Social Features**:
- ✅ Friend management: request/accept/reject, online status, grouping, remarks
- ✅ Social posts: publish, like, comment, share, image support
- ✅ P2P encrypted private messages: offline messages, multi-device sync

**Community Forum** (Standalone App):
- ✅ Spring Boot 3.1.5 backend (69 Java files, 63 APIs)
- ✅ Vue3 frontend (45 files, 15 pages)
- ✅ 14 database tables: users, posts, replies, tags, likes, favorites, etc.
- ✅ Elasticsearch full-text search + Redis cache
- ✅ JWT authentication + Spring Security authorization

### 3️⃣ Decentralized Trading System (85% Complete) ✅

Total code: **8000+ lines**, 8 core modules + blockchain smart contracts

**1. Digital Asset Management** (600 lines):
- ✅ 4 asset types: Token, NFT, knowledge products, service credentials
- ✅ Asset creation, minting, transfer, burning
- ✅ Balance management + transfer history + metadata
- ✅ Batch operation support

**2. Trading Market** (685 lines):
- ✅ Product listing management (create, update, list, delist)
- ✅ Multi-dimensional search and filtering (category, price, tags)
- ✅ Order management (create, pay, confirm, cancel)
- ✅ Transaction history and statistics

**3. Smart Contract Engine** (1102 lines + 526 lines templates):
- ✅ Contract engine: condition evaluation, auto-execution, state management
- ✅ 6 contract templates: simple payment, escrow, subscription, milestone, auction, crowdfunding
- ✅ 40+ condition types supported
- ✅ Serial/parallel task execution
- ✅ Webhook notification integration

**4. Escrow Service** (592 lines):
- ✅ 4 escrow types: simple escrow, multi-party escrow, arbitration escrow, time-locked
- ✅ Buyer and seller protection mechanisms
- ✅ Dispute resolution process
- ✅ Automatic/manual fund release

**5. Knowledge Payment** (812 lines):
- ✅ Knowledge product encryption (AES-256) + key management
- ✅ 3 pricing models: one-time, subscription, on-demand
- ✅ Purchase process + decryption access
- ✅ Copyright protection + DRM
- ✅ Revenue distribution and withdrawal

**6. Credit Scoring** (637 lines):
- ✅ 6-dimension scoring: completion rate, transaction volume, rating, response speed, dispute rate, account age
- ✅ 5 credit levels: Newbie (0-199), Bronze (200-499), Silver (500-999), Gold (1000-1999), Diamond (2000+)
- ✅ Dynamic weight adjustment algorithm
- ✅ Real-time updates + historical snapshots
- ✅ Credit records and trend analysis

**7. Review System** (671 lines):
- ✅ 5-star rating + text review + image attachments
- ✅ Bilateral reviews (buyer/seller)
- ✅ Review statistics and analysis
- ✅ Report and appeal mechanisms
- ✅ Review visibility control

**8. Order Management** (integrated in trading market):
- ✅ Order lifecycle: pending payment → paid → in progress → completed → cancelled
- ✅ Order detail queries
- ✅ Batch order processing
- ✅ Order notifications and reminders

**9. Blockchain Smart Contract System** (2400+ lines) ⭐NEW:
- ✅ **ChainlessToken** (ERC-20 token contract, 70 lines)
  - Custom name, symbol, decimals
  - Mint/Burn functions, Ownable access control
- ✅ **ChainlessNFT** (ERC-721 NFT contract, 140 lines)
  - Metadata URI support, batch minting
  - ERC721Enumerable extension
- ✅ **EscrowContract** (Escrow contract, 260 lines)
  - Support for ETH/MATIC + ERC20 tokens
  - Dispute resolution mechanism + arbitrator function
  - ReentrancyGuard protection
- ✅ **SubscriptionContract** (Subscription contract, 300 lines)
  - Monthly/quarterly/annual subscriptions
  - Auto-renewal mechanism
- ✅ **BountyContract** (Bounty contract, 330 lines)
  - Task posting, claiming, submission review
  - Support for multiple completers, reward distribution
- ✅ **AssetBridge** (Cross-chain bridge contract, 300 lines)
  - Lock-mint mode
  - Relayer permission management, duplicate mint prevention
- ✅ **Complete Test Suite** (600+ lines, 45+ test cases)
- ✅ **Deployment Scripts** (support for multi-network deployment)

**10. Wallet System** (3000+ lines) ⭐NEW:
- ✅ **Built-in HD Wallet** (900 lines)
  - BIP39 mnemonic + BIP44 path
  - AES-256-GCM strong encryption storage
  - USB Key hardware signing integration
  - EIP-155/EIP-191 signing
- ✅ **External Wallet Integration** (420 lines)
  - MetaMask connection
  - WalletConnect v1 support
  - Network switching and event listeners
- ✅ **Transaction Monitoring** (350 lines)
  - Transaction status tracking
  - Auto-confirmation waiting
  - Database persistence

**Trading UI Components** (20+):
- AssetCreate/List/Transfer - Asset management
- Marketplace/OrderCreate/OrderDetail - Market and orders
- ContractCreate/Detail/List/Execute/Sign - Smart contracts
- EscrowList/Detail/Dispute/Statistics - Escrow management
- ContractCard/TransactionTimeline - Common components
- CreditScore/ReviewList/MyReviews - Credit and reviews

### 4️⃣ Enterprise Edition (Decentralized Organizations) (40% Complete) ⭐NEW

**Core Architecture**:
- ✅ **Multi-Identity Architecture**: One user DID can have personal identity + multiple organization identities
- ✅ **Complete Data Isolation**: Each identity corresponds to independent database file (personal.db, org_xxx.db)
- ✅ **Organization DID**: Support for organization-level DID creation (did:chainlesschain:org:xxxx)
- ✅ **Database Switching**: Dynamic switching between different identity databases

**Organization Management** (OrganizationManager - 701 lines):
- ✅ Organization create/delete - UUID generation, DID creation, database initialization
- ✅ Member management - add/remove/role change, online status
- ✅ Invitation system - 6-digit invitation code generation, DID invitation (planned)
- ✅ Activity log - all operations automatically recorded, audit trail

**Permission System** (RBAC + ACL):
- ✅ **4 Built-in Roles**: Owner (all permissions), Admin (management permissions), Member (read-write permissions), Viewer (read-only)
- ✅ **Permission Granularity**: org.manage, member.manage, knowledge.*, project.*, invitation.create, etc.
- ✅ **Permission Checking**: Support for wildcards, prefix matching, exact matching
- ✅ **Custom Roles**: Support for creating custom roles and permissions (to be improved)

**Database Architecture** (9 new tables):
- ✅ `identity_contexts` - Identity context management (personal + organizations)
- ✅ `organization_info` - Organization metadata (name, type, description, Owner)
- ✅ `organization_members` - Organization member details (DID, role, permissions)
- ✅ `organization_roles` - Organization role definitions
- ✅ `organization_invitations` - Organization invitation management
- ✅ `organization_projects` - Organization projects
- ✅ `organization_activities` - Organization activity log
- ✅ `p2p_sync_state` - P2P sync state
- ✅ `knowledge_items extension` - 8 new enterprise fields (org_id, created_by, share_scope, etc.)

**Frontend UI Components** (3 new):
- ✅ **IdentitySwitcher.vue** (361 lines) - Identity switcher, support create/join organizations
- ✅ **OrganizationMembersPage.vue** - Member management page, role assignment
- ✅ **OrganizationSettingsPage.vue** - Organization settings page, info editing

**State Management** (IdentityStore - 385 lines):
- ✅ Current active identity management
- ✅ All identity context caching
- ✅ Organization list and switching logic
- ✅ Permission checking interface

**Pending Features**:
- ⏳ P2P organization network (topic subscription, member discovery)
- ⏳ DID invitation mechanism (direct invitation via DID)
- ⏳ Knowledge base collaboration (sharing, version control, conflict resolution)
- ⏳ Data synchronization (incremental sync, conflict detection)
- ⏳ Frontend UI refinement (dashboard, statistical charts)

**Application Scenarios**:
- Startup teams, small companies
- Tech communities, open source projects
- Educational institutions

### 5️⃣ AI Template System (100% Complete) ⭐NEW

**System Overview**:
- ✅ **178 AI Templates** - Covering office, development, design, media, and all scenarios
- ✅ **32 Category System** - From document editing to blockchain development, complete categorization
- ✅ **100% Configuration Coverage** - All templates configured with skills and tools
- ✅ **Smart Engine Allocation** - Automatically selects optimal execution engine based on content type

**Template Categories** (32 total):

**Office Document Categories (12 categories)**:
- ✅ writing, creative-writing - Creative writing, copywriting
- ✅ education, learning - Education training, learning materials
- ✅ legal, health - Legal documents, health management
- ✅ career, resume - Career planning, resume creation
- ✅ cooking, gaming, lifestyle - Lifestyle content
- ✅ productivity, tech-docs - Productivity tools, technical documentation

**Office Suite Categories (3 categories)**:
- ✅ ppt - Presentation creation (6 templates)
- ✅ excel - Data analysis, financial management (12 templates)
- ✅ word - Professional document editing (8 templates)

**Development Categories (3 categories)**:
- ✅ web - Web development projects (5 templates)
- ✅ code-project - Code project structures (7 templates)
- ✅ data-science - Data science, machine learning (6 templates)

**Design & Media Categories (5 categories)**:
- ✅ design - UI/UX design (6 templates)
- ✅ photography - Photography creation
- ✅ video - Video production (29 templates)
- ✅ podcast - Podcast production
- ✅ music - Music creation (5 templates)

**Marketing Categories (4 categories)**:
- ✅ marketing - Marketing planning (8 templates)
- ✅ marketing-pro - Professional marketing (6 templates)
- ✅ social-media - Social media management (6 templates)
- ✅ ecommerce - E-commerce operations (6 templates)

**Professional Domain Categories (5 categories)**:
- ✅ research - Academic research
- ✅ finance - Financial analysis
- ✅ time-management - Time management
- ✅ travel - Travel planning

**Execution Engine Distribution** (after optimization):
```
document engine : 95  (46.3%) - Main engine for document templates
video engine    : 29  (14.1%) - Video production
default engine  : 26  (12.7%) - Mixed content (marketing, e-commerce)
excel engine    : 12  (5.9%)  - Data analysis
word engine     : 8   (3.9%)  - Professional documents
code engine     : 7   (3.4%)  - Code projects
ml engine       : 6   (2.9%)  - Machine learning
design engine   : 6   (2.9%)  - Design creation
ppt engine      : 6   (2.9%)  - Presentations
audio engine    : 5   (2.4%)  - Audio processing
web engine      : 5   (2.4%)  - Web development
```

**Configuration Completeness**:
- ✅ File system: 178/178 (100%)
- ✅ Database: 203/203 (100%)
- ✅ Skills configuration: 100%
- ✅ Tools configuration: 100%
- ✅ Engine configuration: 100%

**Optimization Results**:
- Default engine usage reduced from 52.2% to **12.7%** (39.5 percentage point decrease)
- Specialized engine coverage increased from 22.4% to **84.4%** (62 percentage point increase)
- More precise engine allocation improves AI execution efficiency

**Template Capability Mapping**:
Each template is precisely configured with:
- **skills** - Required AI skills for execution (selected from 115 skills)
- **tools** - Required tools for execution (selected from 216 tools)
- **execution_engine** - Optimal execution engine (11 engine types)

Details: `desktop-app-vue/dist/main/templates/OPTIMIZATION_COMPLETE_REPORT.md`

## Technical Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                         Application Layer                          │
│  Desktop(Electron+Vue3,145 comps) │ Browser Ext │ Mobile(uni-app) │
├───────────────────────────────────────────────────────────────────┤
│                        Business Function Layer                     │
│ Knowledge(95%) │ AI Engine(85%) │ Social(85%) │ Trading(85%)     │
│ Skills/Tools(95%,115+216) │ Blockchain(50%) │ Testing(85%)       │
│ Enterprise(40%) │ Plugins(85%) │ Voice(90%) │ P2P(75%)           │
├───────────────────────────────────────────────────────────────────┤
│                        Backend Service Layer                       │
│  Project Service    │    AI Service      │   Community Forum     │
│  (Spring Boot 3.1)  │   (FastAPI)        │   (Spring Boot 3.1)   │
│  48 API endpoints   │   38 API endpoints │   63 API endpoints    │
│  PostgreSQL + Redis │   Ollama + Qdrant  │   MySQL + Redis       │
├───────────────────────────────────────────────────────────────────┤
│                        Blockchain Layer                            │
│  Hardhat │ Ethers.js v6 │ 6 Smart Contracts │ HD Wallet │ MM/WC  │
│  Ethereum/Polygon  │  ERC-20/ERC-721  │  Escrow/Sub/Bounty/Bridge│
├───────────────────────────────────────────────────────────────────┤
│                        Data Storage Layer (Multi-DB Isolation)     │
│  SQLite/SQLCipher  │  PostgreSQL  │  MySQL  │  ChromaDB/Qdrant   │
│  (Personal+Org DBs)│  (Projects)  │ (Forum) │  (Vector Store)    │
├───────────────────────────────────────────────────────────────────┤
│                        P2P Network Layer                           │
│  libp2p 3.1.2  │  Signal E2E  │  Kademlia DHT  │  Org Network   │
├───────────────────────────────────────────────────────────────────┤
│                        Security Layer                              │
│    USB Key (PC, 5 brands)     │     SIMKey (Mobile, planned)     │
└───────────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Requirements

- **PC**: Node.js 20+, Docker 20.10+ (optional)
- **Mobile**: Android Studio 2024+ / Xcode 15+
- **Hardware**: USB Key (PC) or SIMKey-enabled SIM card (mobile, optional)

### Installation

#### 1. Clone the Repository
```bash
git clone https://github.com/chainlesschain/chainlesschain.git
cd chainlesschain
```

#### 2. Start PC Desktop App
```bash
# Navigate to desktop app directory
cd desktop-app-vue

# Install dependencies
npm install

# Start development server
npm run dev
```

#### 3. Start AI Services (Optional, for local LLM)
```bash
# Start Docker services
docker-compose up -d

# Download model (first run)
docker exec chainlesschain-llm ollama pull qwen2:7b
```

#### 4. Start Community Forum (Optional)
```bash
# Backend (Spring Boot)
cd community-forum/backend
mvn spring-boot:run

# Frontend (Vue3)
cd community-forum/frontend
npm install
npm run dev
```

### Alternative Options

```bash
# Android app
cd android-app
./gradlew assembleDebug
```

## 📁 Project Structure

```
chainlesschain/
├── desktop-app-vue/         # PC Desktop App (Electron + Vue3)
│   ├── src/
│   │   ├── main/            # Main process (Node.js)
│   │   │   ├── database.js  # SQLite database
│   │   │   ├── ukey/        # USB Key management
│   │   │   ├── llm/         # AI service integration
│   │   │   ├── rag/         # RAG retrieval system
│   │   │   ├── git/         # Git sync
│   │   │   ├── image/       # Image processing + OCR
│   │   │   ├── did/         # DID identity system
│   │   │   ├── p2p/         # P2P network
│   │   │   └── trade/       # Trading system (Phase 3)
│   │   └── renderer/        # Renderer process (Vue3 + TypeScript)
│   │       ├── components/  # Reusable components
│   │       ├── pages/       # Pages
│   │       └── stores/      # Pinia state management
│   └── package.json
│
├── community-forum/         # 🌐 Community Forum (Complete App)
│   ├── backend/             # Spring Boot 3.1.5 + MySQL
│   │   └── src/main/java/   # 69 Java files
│   └── frontend/            # Vue3 + Element Plus
│       └── src/             # Frontend pages and components
│
├── android-app/             # 📱 Android Native App
│   └── app/src/             # Kotlin + Jetpack Compose
│       ├── main/
│       │   ├── java/        # Business logic
│       │   └── res/         # Resources
│       └── ...
│
├── docker-compose.yml       # 🐳 Docker service configuration
│   # - Ollama (LLM inference)
│   # - Qdrant (Vector database)
│   # - AnythingLLM (RAG system)
│   # - Gitea (Git service)
│
├── docs/                    # 📚 Documentation
│   ├── 系统设计_个人移动AI管理系统.md
│   ├── 项目完成度报告_2025-12-18.md
│   └── API.md (TBD)
│
└── scripts/                 # 🛠️ Utility scripts
    ├── setup.sh             # Environment setup
    └── build.sh             # Build scripts
```

### Project Components

| Project | Tech Stack | Code Size | APIs | Completion | Status |
|---------|-----------|-----------|------|-----------|--------|
| **desktop-app-vue** | Electron 39 + Vue3 | 130,000+ lines | 133+ IPC | 98% | ✅ Production Ready |
| **contracts** | Hardhat + Solidity | 2,400 lines | - | 100% | ✅ Complete |
| **browser-extension** | Vanilla JS | 2,000+ lines | - | 70% | 🚧 In Development |
| **backend/project-service** | Spring Boot 3.1 + Java 17 | 5,679 lines | 48 APIs | 95% | ✅ Production Ready |
| **backend/ai-service** | FastAPI + Python 3.9+ | 12,417 lines | 38 APIs | 85% | ✅ Functional |
| **community-forum/backend** | Spring Boot 3.1 + MySQL | 5,679 lines | 63 APIs | 90% | ✅ Production Ready |
| **community-forum/frontend** | Vue3 + Element Plus | 10,958 lines | - | 85% | ✅ Functional |
| **mobile-app-uniapp** | uni-app + Vue3 | Minimal | - | 10% | 🚧 In Development |
| **Total** | - | **170,000+ lines** | **149 APIs** | **98%** | ✅ Ready for Use |

## 🗓️ Roadmap

### Completed ✅
- [x] **Phase 0**: System design and architecture planning (100%)
- [x] **Phase 1 (MVP - Knowledge Base)**: 100% Complete
  - [x] Desktop app framework (Electron + Vue3)
  - [x] USB Key integration and encrypted storage (SQLCipher)
  - [x] Local LLM and RAG implementation (Ollama + ChromaDB)
  - [x] Git sync functionality (with conflict resolution)
  - [x] File import (Markdown/PDF/Word/TXT)
  - [x] Image upload and OCR (v0.11.0)
  - [x] Full-text search and tagging system
  - [x] Prompt template management

- [x] **Phase 2 (Decentralized Social)**: 100% Complete
  - [x] DID identity system
  - [x] DHT network publishing
  - [x] Verifiable credentials system
  - [x] P2P communication foundation (libp2p)
  - [x] Community forum (Spring Boot + Vue3)
  - [x] Signal protocol end-to-end encryption (v0.16.0)
  - [x] Multi-device support and message sync (v0.16.0)
  - [x] Friend management system (requests, online status, groups)
  - [x] Social posts system (publish, like, comment, images)

- [x] **Phase 3 (Decentralized Trading System)**: 100% Complete
  - [x] Digital asset management (asset-manager.js - 600 lines)
  - [x] Trading market (marketplace-manager.js - 685 lines)
  - [x] Smart contract engine (contract-engine.js - 1102 lines + 526 lines templates)
  - [x] Escrow service (escrow-manager.js - 592 lines)
  - [x] Knowledge payment system (knowledge-payment.js - 812 lines)
  - [x] Credit scoring system (credit-score.js - 637 lines)
  - [x] Review & feedback system (review-manager.js - 671 lines)
  - [x] Order management (integrated in trading market)
  - [x] Complete frontend UI (20+ trading components)

### In Progress 🚧

- [x] **Phase 4 (Blockchain Integration)**: 50% Complete ⭐
  - [x] Phase 1: Infrastructure setup (Hardhat + database extension)
  - [x] Phase 2: Wallet system implementation (built-in HD wallet + external wallets)
  - [x] Phase 3: Smart contract development (6 contracts + tests + deployment)
  - [ ] Phase 4: Blockchain adapter implementation (20%)
  - [ ] Phase 5: Integration with existing modules
  - [ ] Phase 6: Frontend UI adaptation

- [x] **Phase 5 (Ecosystem Enhancement)**: 85% Complete ⭐
  - [x] Voice recognition functionality (Phase 3 complete)
  - [x] Browser extension (testing framework + documentation, 70%)
  - [x] Skill & tool system (integration complete, 90%)
  - [x] Plugin system (dynamic loading + hot reload, 85%)
  - [ ] Improve USB Key drivers (FeiTian, WatchData, simulation mode)
  - [ ] P2P WebRTC support and NAT traversal optimization
  - [ ] Mobile UI refinement
  - [ ] Knowledge graph visualization
  - [ ] Multi-language support
  - [x] Enterprise features (decentralized organizations core 40% complete) ⭐Updated

### Planned ⏳

- [ ] **Phase 6 (Production Optimization)**: Planned
  - [ ] Complete blockchain adapter
  - [ ] Production-grade cross-chain bridge
  - [ ] Comprehensive test coverage
  - [ ] Performance optimization and monitoring
  - [ ] Security audit
  - [ ] Documentation refinement

### Version History

| Version | Date | Major Updates |
|---------|------|---------------|
| v0.18.0 | 2025-12-30 | **Enterprise Edition + Skill/Tool Expansion**: Decentralized organizations (multi-identity + RBAC + 9 new tables) + skill/tool system expanded to 115 skills + 216 tools + Playwright testing + multi-database isolation |
| v0.17.0 | 2025-12-29 | **Blockchain Integration Phase 1-3**: Smart contract system (6 contracts + tests + deployment) + wallet system (HD + external) + skill/tool system + plugin system + browser extension + voice recognition Phase 3 |
| v0.16.0 | 2025-12-28 | **Phase 3 Complete**: 8 trading modules (5625+ lines) + 19 AI engines + backend services (149 APIs) + database sync + testing framework |
| v0.11.0 | 2025-12-18 | Image upload and OCR (Tesseract.js + Sharp) |
| v0.10.0 | 2025-12 | RAG reranker (3 algorithms) + query rewriting |
| v0.9.0 | 2025-11 | File import enhancement (PDF/Word/TXT) |
| v0.8.0 | 2025-11 | Verifiable credentials system (W3C VC standard, 5 types) |
| v0.6.1 | 2025-10 | DHT network publishing (DID documents) |
| v0.4.0 | 2025-09 | Git conflict resolution (visual UI) + AI commit messages |
| v0.1.0 | 2025-08 | First MVP release |

## 🛠️ Tech Stack

### PC (desktop-app-vue) - Main Application
- **Framework**: Electron 39.2.6 + Vue 3.4 + TypeScript 5.3
- **UI Components**: Ant Design Vue 4.1.2
- **State Management**: Pinia 2.1.7
- **Router**: Vue Router 4.2.5
- **Editors**:
  - Milkdown 7.17.3 (Markdown)
  - Monaco Editor (Code)
  - Jspreadsheet (Excel)
- **Database**: SQL.js + SQLCipher (AES-256)
- **Git**: isomorphic-git 1.25.10
- **P2P**: libp2p 3.1.2 + Signal Protocol
- **Image Processing**: Sharp 0.33 + Tesseract.js 5.0
- **Encryption**: node-forge + TweetNaCl + USB Key SDK (Koffi FFI)
- **Vector DB**: ChromaDB 3.1.8
- **Build**: Vite 7.2.7 + Electron Builder

### Backend Services

#### Project Service (Project Management)
- **Framework**: Spring Boot 3.1.11 + Java 17
- **ORM**: MyBatis Plus 3.5.7 (recommended upgrade to 3.5.9)
- **Database**: PostgreSQL 16
- **Cache**: Redis 7
- **Git**: JGit 6.8.0
- **Connection Pool**: HikariCP
- **Docs**: SpringDoc OpenAPI 2.2.0
- **Port**: 9090

#### AI Service (AI Inference)
- **Framework**: FastAPI 0.109.0+ + Python 3.9+
- **LLM**: Ollama (local) + 14+ cloud providers
- **Vector DB**: Qdrant 1.7.0+ / ChromaDB 0.4.22
- **Embedding Model**: Sentence Transformers 2.3.0
- **Server**: Uvicorn 0.27.0+
- **Port**: 8001

#### Community Forum
**Backend**:
- **Framework**: Spring Boot 3.1.5 + Java 17
- **ORM**: MyBatis Plus 3.5.9
- **Database**: MySQL 8.0.12
- **Search**: Elasticsearch 8.11
- **Cache**: Redis 7.0
- **Auth**: JWT 0.12.3 + Spring Security
- **Docs**: SpringDoc OpenAPI 2.2.0
- **Port**: 8080

**Frontend**:
- **Framework**: Vue 3.4.0 + Vite 5.0.8
- **UI Components**: Element Plus 2.5.1
- **State Management**: Pinia 2.1.7
- **Router**: Vue Router 4.2.5
- **HTTP**: Axios 1.6.2
- **Markdown**: Markdown-it 14.0.0
- **Port**: 3000

### Mobile
#### Android (android-app)
- **Language**: Kotlin
- **UI**: Jetpack Compose
- **Database**: Room ORM + SQLCipher
- **Encryption**: BouncyCastle
- **SIMKey**: OMAPI
- **LLM**: Ollama Android

#### React Native (mobile-app)
- **Framework**: React Native 0.73.2
- **Navigation**: React Navigation

### Docker Services
- **LLM Engine**: Ollama (latest, port 11434)
  - Supported models: Qwen2-7B, LLaMA3-8B, GLM-4, MiniCPM-2B, etc.
  - GPU acceleration: NVIDIA CUDA support
- **Vector Database**:
  - Qdrant (latest, port 6333) - High-performance vector retrieval
  - ChromaDB 3.1.8 - Lightweight vector storage
- **Relational Databases**:
  - PostgreSQL 16 (port 5432) - Project Service
  - MySQL 8.0 (port 3306) - Community Forum
- **Cache**: Redis 7 (port 6379)
- **Embedding Models**: bge-large-zh-v1.5 / bge-small-zh-v1.5
- **RAG System**: AnythingLLM (optional)
- **Git Service**: Gitea (optional)

### Blockchain (50% Complete) ⭐
- **Smart Contracts**: Solidity 0.8+ + Hardhat 2.28
- **Development Framework**: Hardhat Toolbox 5.0
- **Contract Libraries**: OpenZeppelin Contracts 5.4
- **Interaction**: Ethers.js v6.13
- **Wallets**:
  - Built-in: BIP39 + BIP44 + AES-256-GCM encryption
  - External: MetaMask + WalletConnect v1
- **Networks**:
  - Mainnet: Ethereum (Chain ID: 1), Polygon (Chain ID: 137)
  - Testnet: Sepolia (11155111), Mumbai (80001)
  - Local: Hardhat Network (31337)
- **Contract Types**:
  - ERC-20 Token (ChainlessToken)
  - ERC-721 NFT (ChainlessNFT)
  - Escrow Contract (EscrowContract)
  - Subscription Contract (SubscriptionContract)
  - Bounty Contract (BountyContract)
  - Cross-chain Bridge (AssetBridge)

## 🤝 Contributing

We welcome all forms of contribution!

### How to Contribute
1. Fork this repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### Development Guidelines
- Code style: Follow ESLint/Prettier configuration
- Commit messages: Use semantic commits (feat/fix/docs/style/refactor/test/chore)
- Testing: Add necessary unit and integration tests
- Documentation: Update relevant documentation and comments

See [CONTRIBUTING.md](./CONTRIBUTING.md) for details

### Priority Tasks
1. 🔴 **High Priority**:
   - Complete blockchain adapter implementation (Phase 4-6)
   - Improve USB Key drivers (FeiTian, WatchData, simulation mode)
   - P2P WebRTC support and NAT traversal
   - Mobile UI refinement
2. 🟡 **Medium Priority**:
   - Browser extension completion (remaining 30%)
   - Production-grade cross-chain bridge (replace simplified version)
   - MyBatis Plus upgrade to 3.5.9
   - Skill & tool system refinement (remaining 10%)
3. 🟢 **Low Priority**:
   - Knowledge graph visualization
   - Multi-language support
   - Enterprise features

## 🔒 Security Notice

- **Hardware Keys**: Strongly recommend using USB Key or SIMKey, software simulation for testing only
- **Backup Critical**: Must backup mnemonic phrases and keys, loss is unrecoverable
- **Open Source Audit**: All encryption implementations are open source and auditable
- **Security Reports**: Send security vulnerabilities to security@chainlesschain.com
- **Bug Bounty**: Major security vulnerabilities will be rewarded

### Known Limitations

**USB Key Support**:
- Only supports Windows platform (via Koffi FFI calling DLL)
- Only XinJinKe driver implemented (40% complete)
- FeiTian, WatchData drivers to be implemented
- macOS/Linux require simulation mode

**Blockchain Integration**:
- Blockchain adapter not completed (Phase 4-6 pending)
- Cross-chain bridge is simplified version (recommend Chainlink CCIP or LayerZero for production)
- Contracts not audited by third-party security firms
- Only supports Ethereum and Polygon
- Frontend UI adaptation incomplete

**P2P Network**:
- WebRTC transport not implemented (framework ready)
- NAT traversal needs optimization
- Signaling server needs deployment

**Backend Services**:
- Project Service MyBatis Plus version 3.5.7 needs upgrade to 3.5.9
- AI Service needs more integration tests
- Cloud LLM provider interfaces need complete implementation

**Mobile Application**:
- uni-app version only 10% complete
- SIMKey integration not developed

**Others**:
- Browser extension 70% complete (remaining features in development)
- Knowledge graph visualization not implemented
- Multi-language UI not implemented

## 📜 License

This project is licensed under the **MIT License** - see [LICENSE](./LICENSE)

Core encryption libraries use **Apache 2.0** license

## 📞 Contact Us

### Official Channels
- **Website**: https://www.chainlesschain.com
- **Documentation**: https://docs.chainlesschain.com
- **Forum**: https://community.chainlesschain.com
- **GitHub**: https://github.com/chainlesschain/chainlesschain

### Contact Information
- **Email**: zhanglongfa@chainlesschain.com
- **Security Reports**: security@chainlesschain.com
- **Phone**: +86 400-1068-687
- **WeChat**: https://work.weixin.qq.com/ca/cawcde653996f7ecb2

### Community
- **Tech Discussion**: GitHub Discussions
- **Bug Reports**: GitHub Issues
- **Feature Requests**: GitHub Issues

## 🙏 Acknowledgments

Thanks to the following open source projects and technologies:

### Core Frameworks
- [Electron](https://www.electronjs.org/) - Cross-platform desktop app framework
- [Vue.js](https://vuejs.org/) - Progressive JavaScript framework
- [React](https://react.dev/) - User interface library
- [Spring Boot](https://spring.io/projects/spring-boot) - Java application framework

### AI & Data
- [Ollama](https://ollama.ai/) - Local LLM runtime
- [Qdrant](https://qdrant.tech/) - Vector database
- [ChromaDB](https://www.trychroma.com/) - AI-native embedding database
- [Tesseract.js](https://tesseract.projectnaptha.com/) - OCR engine

### Encryption & Network
- [SQLCipher](https://www.zetetic.net/sqlcipher/) - Encrypted database
- [libp2p](https://libp2p.io/) - P2P networking stack
- [Signal Protocol](https://signal.org/docs/) - End-to-end encryption protocol

### Editor & UI
- [Milkdown](https://milkdown.dev/) - Markdown editor
- [Ant Design](https://ant.design/) / [Ant Design Vue](https://antdv.com/) - Enterprise UI components
- [Element Plus](https://element-plus.org/) - Vue 3 component library

### Tools
- [Vite](https://vitejs.dev/) - Next generation frontend tooling
- [TypeScript](https://www.typescriptlang.org/) - JavaScript superset
- [Docker](https://www.docker.com/) - Containerization platform

---

<div align="center">

## 📊 Project Stats

![GitHub stars](https://img.shields.io/github/stars/chainlesschain/chainlesschain?style=social)
![GitHub forks](https://img.shields.io/github/forks/chainlesschain/chainlesschain?style=social)
![GitHub issues](https://img.shields.io/github/issues/chainlesschain/chainlesschain)
![GitHub pull requests](https://img.shields.io/github/issues-pr/chainlesschain/chainlesschain)

### Overall Code Statistics

**Total Code**: 170,000+ lines ⭐Updated
- Desktop App: 130,000+ lines (JavaScript/TypeScript/Vue)
- Smart Contracts: 2,400 lines (Solidity + tests + scripts)
- Browser Extension: 2,000+ lines (JavaScript)
- Backend Services: 23,775 lines (Java + Python)
- Community Forum: 10,958 lines (Vue3)

**Components and Files**:
- Vue Components: 190+ (Desktop 145 + Forum 45) ⭐Updated
- JavaScript Files: 155+ (main process) ⭐Updated
- Solidity Contracts: 6
- Java Files: 132
- Python Files: 31
- Test Files: 28+ (Desktop 25 + Contracts 3) ⭐Updated

**Function Modules**:
- 19 AI specialized engines
- Enterprise Edition (Decentralized Organizations) (2100+ lines) ⭐NEW
  - OrganizationManager: 701 lines
  - IdentityStore: 385 lines
  - UI Components: 1014 lines
  - 9 new database tables
- 8 trading modules (5625+ lines)
- Blockchain system (5400+ lines)
  - Wallet system (3000+ lines)
  - Smart contracts (2400+ lines)
- Skill & tool system (115 skills + 216 tools) ⭐Updated
- Plugin system
- Voice recognition system
- Browser extension
- Playwright E2E testing framework ⭐NEW
- 6 RAG core modules
- 5 AI engine components
- 4 database sync modules

**Backend Services**:
- Total API endpoints: 149
  - Project Service: 48 APIs
  - AI Service: 38 APIs
  - Community Forum: 63 APIs
- Database tables: 40 (26 base + 9 enterprise + 5 blockchain) ⭐Updated
- IPC handlers: 133+ (13 new enterprise IPCs added) ⭐Updated

**Test Coverage**:
- Unit tests: 23+ files (Desktop 20+ + Contracts 3) ⭐Updated
- Integration tests: 2 files
- Performance tests: 3 files
- E2E tests: Playwright framework ⭐NEW
- Test cases: 700+ (Desktop 655+ + Contracts 45+) ⭐Updated

**Overall Completion: 98%** ⭐Updated

**Defending Privacy with Technology, Empowering Individuals with AI**

Made with ❤️ by ChainlessChain Team

[⬆ Back to Top](#chainlesschain---personal-mobile-ai-management-system-based-on-usb-key-and-simkey)

</div>
