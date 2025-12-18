# Changelog

All notable changes to ChainlessChain project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- P2P end-to-end encryption using Signal protocol
- Voice input functionality
- Browser extension for web clipping
- Git repository encryption (git-crypt)
- Knowledge graph visualization
- Multi-language UI support

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
