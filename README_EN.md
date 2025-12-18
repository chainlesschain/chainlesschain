# ChainlessChain - Personal Mobile AI Management System Based on USB Key and SIMKey

<div align="center">

![Version](https://img.shields.io/badge/version-v0.11.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Progress](https://img.shields.io/badge/progress-66%25-yellow.svg)
![Phase 1](https://img.shields.io/badge/Phase%201-95%25-brightgreen.svg)
![Phase 2](https://img.shields.io/badge/Phase%202-70%25-yellow.svg)
![Phase 3](https://img.shields.io/badge/Phase%203-0%25-red.svg)

**Decentralized · Privacy First · AI Native**

A fully decentralized personal AI assistant platform integrating knowledge base management, social networking, and transaction assistance.

[中文](./README.md) | [Design Document](./系统设计_个人移动AI管理系统.md) | [Progress Report](./PROJECT_PROGRESS_REPORT_2025-12-18.md)

</div>

---

## ⭐ Current Version: v0.11.0 (2025-12-18)

### Latest Updates
- ✅ **Image Upload & OCR** - Multi-language OCR recognition with automatic full-text indexing
- ✅ **Reranker** - Enhanced RAG retrieval accuracy
- ✅ **Git Conflict Resolution** - Visual merge conflict resolution tool
- ✅ **Verifiable Credentials System** - W3C standard VC implementation

### Project Status
- 🟢 **Knowledge Base**: 95% Complete - **Production Ready**
- 🟢 **AI Services**: 98% Complete - **Fully Functional**
- 🟡 **Decentralized Identity**: 95% Complete - **Foundation Ready**
- 🟡 **P2P Communication**: 60% Complete - **In Development**
- 🔴 **Transaction Features**: 0% Complete - **Planned**

## Core Features

- 🔐 **Military-Grade Security**: Hardware-level encryption with USB Key/SIMKey ✅
- 🌐 **Fully Decentralized**: Data stored on user devices, no third-party cloud services ✅
- 🧠 **AI Native**: Local LLM (Ollama/Qwen2) preserving privacy while enjoying AI capabilities ✅
- 📱 **Cross-Device Sync**: Seamless synchronization between PC and mobile via Git ✅
- 🔓 **Open Source**: Transparent code, complete data ownership ✅
- 📸 **Smart Image Processing**: OCR recognition + auto-indexing, images become searchable text ✅ (v0.11.0)

## Three Core Functions

### 1️⃣ Knowledge Base Management (95% Complete) ✅
- ✅ **Personal Second Brain**: Unified management of notes, documents, and conversation history
- ✅ **AI-Enhanced Retrieval**: RAG technology, semantic search, intelligent Q&A
- ✅ **Multi-Format Import**: Markdown/PDF/Word/TXT/Images
- ✅ **OCR Recognition**: Text extraction from images, 100+ languages supported
- ✅ **Version Control**: Git-based sync with complete history and visual conflict resolution
- ✅ **Encrypted Storage**: SQLCipher AES-256 encryption
- ✅ **Full-Text Search**: FTS5 indexing with millisecond response

### 2️⃣ Decentralized Social (70% Complete) 🟡
- ✅ **Self-Sovereign Identity**: Based on W3C DID standard
- ✅ **Verifiable Credentials**: VC template system, skill certification
- ✅ **DHT Network**: DID document publishing and resolution
- ✅ **P2P Communication**: libp2p network layer
- ✅ **Community Forum**: Complete Spring Boot backend + Vue3 frontend
- 🚧 **End-to-End Encryption**: Signal protocol integration in progress
- 🚧 **Private Messaging**: P2P messaging system in development

### 3️⃣ Decentralized Transaction (0% Complete) 🔴
- ⏳ **AI Matching**: Intelligent recommendation and risk assessment (Planned)
- ⏳ **Smart Contracts**: Blockchain escrow, secure and trustworthy (Planned)
- ⏳ **Reputation System**: Decentralized reviews, anti-fraud (Planned)
- ⏳ **Arbitration Mechanism**: Community arbitrators, fair and just (Planned)

## Technical Architecture

```
┌─────────────────────────────────────────────────────────┐
│  PC (Electron)  │  Mobile (Android/iOS)  │    Web      │
├─────────────────────────────────────────────────────────┤
│   Knowledge Base  │  Decentralized Social  │  Trading   │
├─────────────────────────────────────────────────────────┤
│  SQLCipher  │  Git Repo  │  Vector DB  │  LLM/RAG    │
├─────────────────────────────────────────────────────────┤
│      USB Key (PC)         │      SIMKey (Mobile)        │
└─────────────────────────────────────────────────────────┘
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

#### 2. Start PC Desktop App (Recommended: desktop-app-vue)
```bash
# Navigate to Vue desktop app directory
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
# React desktop app
cd desktop-app
npm install
npm run dev

# Android app
cd android-app
./gradlew assembleDebug

# React Native mobile app
cd mobile-app
npm install
npm run android  # or npm run ios
```

## 📁 Project Structure

```
chainlesschain/
├── desktop-app-vue/         # ⭐ PC Desktop App (Electron + Vue3) - Recommended
│   ├── src/
│   │   ├── main/            # Main process (Node.js)
│   │   │   ├── database.js  # SQLite database
│   │   │   ├── ukey/        # USB Key management
│   │   │   ├── llm/         # AI service integration
│   │   │   ├── rag/         # RAG retrieval system
│   │   │   ├── git/         # Git sync
│   │   │   ├── image/       # Image processing + OCR
│   │   │   ├── did/         # DID identity system
│   │   │   └── p2p/         # P2P network
│   │   └── renderer/        # Renderer process (Vue3 + TypeScript)
│   │       ├── components/  # Reusable components
│   │       ├── pages/       # Pages
│   │       └── stores/      # Pinia state management
│   └── package.json
│
├── desktop-app/             # PC Desktop App (Electron + React)
│   └── src/                 # React version, basic features
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
├── mobile-app/              # 📱 React Native App
│   ├── android/             # Android platform
│   ├── ios/                 # iOS platform
│   └── src/                 # Cross-platform code
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

| Project | Tech Stack | Progress | Status | Rating |
|---------|-----------|----------|--------|--------|
| **desktop-app-vue** | Electron + Vue3 | 95% | ✅ Production Ready | ⭐⭐⭐⭐⭐ |
| desktop-app | Electron + React | 60% | 🟡 Basic Features | ⭐⭐⭐ |
| community-forum | Spring Boot + Vue3 | 80% | ✅ Available | ⭐⭐⭐⭐ |
| android-app | Kotlin Native | 60% | 🟡 Architecture Done | ⭐⭐⭐ |
| mobile-app | React Native | 30% | 🟡 In Development | ⭐⭐ |

## 🗓️ Roadmap

### Completed ✅
- [x] **Phase 0**: System design and architecture planning (100%)
- [x] **Phase 1 (MVP - Knowledge Base)**: 95% Complete
  - [x] Desktop app framework (Electron + Vue3)
  - [x] USB Key integration and encrypted storage (SQLCipher)
  - [x] Local LLM and RAG implementation (Ollama + ChromaDB)
  - [x] Git sync functionality (with conflict resolution)
  - [x] File import (Markdown/PDF/Word/TXT)
  - [x] Image upload and OCR (v0.11.0)
  - [x] Full-text search and tagging system

### In Progress 🚧
- [x] **Phase 2 (Decentralized Social)**: 70% Complete
  - [x] DID identity system
  - [x] DHT network publishing
  - [x] Verifiable credentials system
  - [x] P2P communication foundation (libp2p)
  - [x] Community forum (Spring Boot + Vue3)
  - [ ] Signal protocol end-to-end encryption (in development)
  - [ ] Mobile UI refinement (in development)

### Planned ⏳
- [ ] **Phase 3 (Transaction Assistance)**: 0% Complete
  - [ ] Smart contract integration (Solidity + Ethers.js)
  - [ ] AI matching engine
  - [ ] Reputation and arbitration system
  - [ ] Blockchain payment

- [ ] **Phase 4 (Ecosystem Enhancement)**: Planned
  - [ ] Browser extension (web clipping)
  - [ ] Voice input functionality
  - [ ] Plugin system
  - [ ] Multi-language support
  - [ ] Enterprise features

### Version History

| Version | Date | Major Updates |
|---------|------|---------------|
| v0.11.0 | 2025-12-18 | Image upload and OCR |
| v0.10.0 | 2025-12 | Reranker |
| v0.9.0 | 2025-11 | File import enhancement |
| v0.8.0 | 2025-11 | Verifiable credentials |
| v0.6.1 | 2025-10 | DHT network publishing |
| v0.4.0 | 2025-09 | Git conflict resolution |
| v0.1.0 | 2025-08 | First MVP release |

## 🛠️ Tech Stack

### PC (desktop-app-vue) ⭐
- **Framework**: Electron 39.2.6 + Vue 3.4 + TypeScript
- **UI Components**: Ant Design Vue 4.1
- **State Management**: Pinia 2.1.7
- **Router**: Vue Router 4.2.5
- **Editor**: Milkdown 7.17.3
- **Database**: SQLite (better-sqlite3 12.5) + SQLCipher
- **Git**: isomorphic-git
- **P2P**: libp2p 3.1.2
- **Image Processing**: Sharp + Tesseract.js
- **Encryption**: node-forge + USB Key SDK (Xinjinke)
- **Build**: Vite 7.2.7 + Electron Builder

### Community Forum (community-forum)
#### Backend
- **Framework**: Spring Boot 3.1.5
- **ORM**: MyBatis Plus 3.5.9
- **Database**: MySQL 8.0
- **Search**: Elasticsearch 8.11
- **Cache**: Redis 7.0
- **Auth**: JWT + Spring Security
- **Docs**: Swagger 2.2.0

#### Frontend
- **Framework**: Vue 3.4 + Vite 5.0
- **UI Components**: Element Plus 2.5
- **State Management**: Pinia 2.1
- **Router**: Vue Router 4.2

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

### AI Services (Docker)
- **LLM Engine**: Ollama (latest)
  - Supported models: Qwen2-7B, LLaMA3-8B, MiniCPM-2B
- **Vector Database**:
  - Qdrant (latest) - High performance
  - ChromaDB 3.1.8 - Lightweight
- **RAG System**: AnythingLLM (optional)
- **Embedding**: bge-large-zh-v1.5 / bge-small-zh-v1.5
- **Git Service**: Gitea (optional)

### Blockchain (Planned)
- **Smart Contracts**: Solidity + Hardhat
- **Interaction**: Ethers.js v6
- **Network**: Ethereum / Polygon

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
1. 🔴 **High Priority**: P2P end-to-end encryption, Voice input
2. 🟡 **Medium Priority**: Mobile UI refinement, Git encryption
3. 🟢 **Low Priority**: Browser extension, Knowledge graph visualization

## 🔒 Security Notice

- **Hardware Keys**: Strongly recommend using USB Key or SIMKey, software simulation for testing only
- **Backup Critical**: Must backup mnemonic phrases and keys, loss is unrecoverable
- **Open Source Audit**: All encryption implementations are open source and auditable
- **Security Reports**: Send security vulnerabilities to security@chainlesschain.com
- **Bug Bounty**: Major security vulnerabilities will be rewarded

### Known Limitations
- USB Key currently only supports Windows (macOS/Linux TBD)
- P2P messaging lacks end-to-end encryption
- Transaction features not yet developed

## 📜 License

This project is licensed under the **MIT License** - see [LICENSE](./LICENSE)

Core encryption libraries use **Apache 2.0** license

## 📞 Contact Us

### Official Channels
- **Website**: https://www.chainlesschain.com (Planned)
- **Documentation**: https://docs.chainlesschain.com (Planned)
- **Forum**: https://community.chainlesschain.com (Planned)
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

**Defending Privacy with Technology, Empowering Individuals with AI**

Made with ❤️ by ChainlessChain Team

[⬆ Back to Top](#chainlesschain---personal-mobile-ai-management-system-based-on-usb-key-and-simkey)

</div>
