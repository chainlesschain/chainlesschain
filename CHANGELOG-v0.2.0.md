# Changelog — v0.2.0

> Standalone changelog for the v0.2.0 release, generated 2026-05-29 from grafted history.
> This entry covers the first tagged release in project history. To splice into the main
> `CHANGELOG.md`, insert between the existing v0.16.0 (2025-12-20) and v0.18.0 (2026-01-05) entries.

## [v0.2.0] - 2026-01-01 — feat(packaging): 添加完整的打包系统和多种部署方案

> **First tagged release.** 31 days from project inception (2025-12-01 "first commit"), 602 commits
> total, 271 feature commits across 50+ scopes. Tag commit `06860faab` shipped the full packaging
> system; the rest of v0.2.0 represents the substrate that made it shippable.

### Added

#### 🏗 Foundations (2025-12-01 → 2025-12-18, pre-scope era)

- Community forum core (`3ca15ecbe`)
- Admin backend (`0b59c83c7`)
- API service layer (`708530da4`)
- Database seed data (`c7d54751c`)
- Image upload + OCR (`f1722d016`)
- Prompt template library (`5f04ee63f`)
- Browser web-clipping extension (`a3d17e38e`)

#### 🌐 Decentralized Social — P2P / Crypto (2025-12-19)

- **Signal protocol E2E encrypted messaging** (`41279bb5e`)
- P2P multi-device support — core (`f2cfcd714`)
- Device sync — offline message queue + state sync (`adc26e748`)
- Friend management subsystem (`06f244728`) + P2P friend-request protocol (`82763f691`)
- Dynamics (动态) publishing (`bdd42b280`)
- Social UI integration — chat + notifications (`15fbcfe65`, `ef7b245c2`)

#### 💱 Decentralized Trading — Phase 3 (2025-12-19)

- **Module 1** — digital asset management (`7b510c4b7`)
- **Module 2** — trading marketplace (`093d5bf1a`)
- **Module 3** — smart contract engine + frontend (`7ca51eeeb`, `d52dba49e`)
- **Modules 4-6** — knowledge paywall, credit scoring, reviews (`2a316bdd9`, `81d5ab8e8`)
- Cross-chain bridge + on-chain deployment (`1ada44ddb`)
- Complete wallet management (`62db4e138`)
- Transaction list component (`37027db1b`)
- IPC extension + test deployment — Phase 8-9 (`a32d70626`)

#### 📱 Mobile (uni-app, 2025-12-19 → 2025-12-31)

- **Kicked off uni-app, deleted native Android project** (`c64d5d241`)
- Week 1-2 DID/identity system (`88466e2f4`)
- Week 3-4 social basics (`b6800fa88`)
- Week 5-6 AI integration (`7f10aa380`)
- Knowledge module (`5c226b9b8`)
- AI chat + settings module (`89282b312`)
- Volcano engine LLM support (`452cc9903`)
- Social dynamics page (`40426725b`)
- Friend message functionality (`a7fd10495`)
- Trading module — market / orders / assets (`084f5430f`)
- Dark theme system (`0a4b10301`, `69db028c0`)
- Cloud sync + data backup (`9d44f730f`)
- Knowledge tags + favorites (`27ac9fcc6`)
- Knowledge sharing (`551202824`)
- Statistics + analytics (`cd28da9c0`)
- AI-enhanced editor (`2f09aa0e5`)
- Folder management (`5f5fd299d`, `fc11577dd`, `4b7cb102c`)
- Tab bar + home page redesign (`670274172`)
- AI extended features (`d6094f1c7`)
- Knowledge import/export (`208c2fd15`)
- Full speech-input optimization (`35fda1b71`)
- RAG vector retrieval + auto-sync (`b6e8e0c23`)
- Social UI optimization (`83651f3aa`)

#### 🤖 AI Engine & LLM (2025-12-21 → 2025-12-31)

- **Phase 1: core AI engine** (`a6a7a1016`)
- **project-service backend** Phase 1 (`aef4c43d8`)
- Cloud-compute deployment for multi-LLM providers (`286908898`)
- 7 → 14 cloud LLM providers (`b99f0d455`) — Doubao, Volcano, Anthropic Claude (`0c07a6e33`), domestic providers (`27219fb78`)
- Cloud deployment tools + cost calculator (`a263150ed`)
- Anthropic Claude API support + LLM config enhancement (`0c07a6e33`)
- Streaming generation + AI task decomposition (`d6fd3b344`)
- Project RAG integration (`63668c252`)
- Cloud LLM default + intelligent fallback (`4e84279dd`)
- LLM manager singleton (`289590942`)
- 5 advanced RAG techniques (`ca43d5739`, `e3ffe2309`)
- Text splitters (`ad3d2ffb8`)
- Query rewriter (`ae0f29ea5`)
- Domain-specific AI toolset (`1dcee3f99`)
- AI scheduling system (`6d62e5b1d`)
- Real tool implementations Phase 1-8 (`3a75a944c`, `f470d61ef`, `185a6e19c`, `77aae50cb`, `48a01044b`, `6d62e5b1d`, `655e98d78`, `6332921a3`)
- AI-driven Git conflict resolver (`01494bc76`)

#### 📂 Project Management (2025-12-21 → 2025-12-27)

- **Phase 1-3 core** (`663ac6eef`)
- **Phase 4-5 UI** (`f98e84b05`)
- **Phase 6-7** detail / templates (`590097a30`)
- **Phase 8-9** completion (`4783d43f7`)
- AI engine integration + refactor (`66b25f218`)
- Streaming project creation (`3f22718ef`, `46f28ff6b`)
- Project import/export + 100% test pass (`688d22c00`, `c2b74bdb1`)
- Project automation + collab editing + multimedia (`20b0ac680`)
- Project v1.0.0 full feature set + AI engine enhancement (`6ee6eb942`)
- File scanning + UI optimization (`3cc74246a`)
- Enhanced file management + document type recognition (`edb3bf74d`)
- Project categories (`6ada4a333`, `7b54ec5d8`)
- VSCode-level file copy/paste (`524bef4d3`)
- Project paths fix + plugin system + knowledge graph (`6c6c1d8e5`)
- Project recovery (within `48a01044b`)

#### 📝 Editor + File Tree (2025-12-22)

- **Monaco Editor** replacing simple textarea (`45a58a829`)
- ChatPanel — project-level AI assistant (`16f653de5`)
- Conversation persistence + IPC interface (`e9c55d3b5`)
- PreviewManager (`184997c20`) + PreviewPanel (`d212614d6`)
- Git status display in FileTree (`0760da9c6`, `8a0c405c0`)
- Enhanced Git operations + file-sync integration (`0470dae56`)
- FileSyncManager — core monitoring (`03bd20a6b`)
- Virtual-scroll FileTree (`c187db710`)
- File cache + comprehensive fix tools (`6f900da60`)

#### 🔄 Sync Subsystem (2025-12-22 → 2025-12-26)

- Multi-device sync — layered (`a0f5fa48e`, `90f8e4d78`, `455144acb`)
- **Optimistic locking + exponential-backoff retry** (`2c4c43c0c`)
- Concurrent sync + P0 full test coverage (`8d987cdae`)
- Soft-delete + P1 fixes + Git AI UI integration (`f214e4c9a`)
- Required-field validation + invalid-record filtering (`4c97be538`)
- DB multi-device sync + soft delete (`f2ecabf9d`)
- Multi-device sync init fixes (`b757523a0`)
- P2P sync engine (within `48a01044b`)

#### 🎨 Engines & Editors (2025-12-25)

- **data-engine v2** — Excel support + security fixes (`3acedce43`)
- **code-engine v2.0.0** — full rebuild (`3f9812eb1`)
- Enhanced code block + Python execution panel (`fd9ad7c31`)
- Excel + Word dedicated engines (`4d0483bfb`)
- **Markdown → PPT** engine (`2618f2367`)
- PPT editor + project UI optimization (`085563b18`)
- PPT generation + PDF export + template engine + project statistics (`fc9adf409`)
- Web IDE pages + components (`8b17156c5`, `c2777b87c`)
- Rich text editor (`8b17156c5`)
- 100% test pass rate + PPT engine fallback optimization (`d317f11a5`)

#### 🧰 Skill-Tool System (2025-12-29 — major day)

- **Core engine** (`7d1c82862`)
- Advanced features + docs (`4c5620a7e`)
- **Frontend UI 100% integration** (`29d8b6707`)
- 4 advanced features: shortcuts / dark mode / history / i18n (`a9c1c1662`)
- Error boundary + doc-viewer enhancement (`9140bed6e`)
- Error handling + wallet creation (`320444540`)
- Short-term optimization roundup (`f00b885fb`)
- ChatSkillBridge (`379662e63`)
- Phase 5-10 batches of skill extensions (`c512e91a5`, `fe4d297bd`, `c82ec3b53`, `e38a93e47`, `0905ba0bd`, `f4955435d`)
- Skill execution + IPC retry mechanism (`f878eb53d`)
- Enhanced built-in skills + tools (`eb8c655ef`)
- Skill-tool DB tables (`2c44a55f4`)

#### 🏢 Enterprise (2025-12-30 → 2025-12-31)

- **Enterprise tech design** (`843fa9dae`)
- **Decentralized org architecture** + extended skills (`fe4d297bd`)
- Org settings + test coverage (`069ab89cc`)
- **DID P2P invitations** + Phase 10-11 tool extensions + full test coverage (`0905ba0bd`)
- High-frequency engine tests + permission system + video templates (`c1c664371`)
- Permission control + content template extensions (`68b9cc260`)
- Role management + social media templates + voice tests (`6c11dfcce`)
- Collaboration system + org management (`9bdfb9602`)
- Org management UI + routes (`1fe68222c`)
- Enterprise DB migration (`b18fe4250`)
- Data isolation + DB check tools (`7efc1cdc5`)
- Org management + extended template library (`b71dbea84`)
- Enterprise test suite (`8cfa1e983`)
- Org knowledge base (`ec6d89e55`)
- **Phase 1 workspace + task management** (`862bcb6b3`)

#### 📚 Templates (2025-12-27 → 2025-12-31)

- Education / life / podcast templates + UI component optimization (`b3c1ed67a`)
- 10 project templates + 4-column project layout (`b892e7ffc`)
- 3 professional templates + classification filter optimization (`79fbe7b0b`)
- Handlebars helper extensions (`4bf81fc75`)
- **30 video content templates** (`d0a8610b1`)
- **18 AI templates** + build process optimization (`e61325980`)
- **27 more AI templates → 100% category coverage** (`0bf35d625`)
- Food / tutorial / travel video templates (`100cf9364`)
- Color-grading / effects templates + doc-generator tests (`c3eb0c642`)
- Legal docs / marketing / video content templates (`b54fe6df4`)
- Education / health / time-management templates (`9c396c1d3`)
- Data-cleaning template + config-manager tests (`21ca11dd3`)
- Jupyter project template (`03f48aa98`)
- Cooking / education / travel domain templates (`cef40ae39`)
- Gaming / music / photography templates + format fixes (`0452fddb3`)
- Career-development template (`addbbc4a6`)
- 13 professional templates + system health check report (`15cc7a121`)
- Template category + tag i18n (`cf844a8f9`)
- Enhanced template management + AI engine + project UI (`cb976151f`)

#### 🔐 Security (2025-12-28 → 2025-12-29)

- **U-Key drivers**: FeiTian / WatchData / simulation mode (`4f65c42d4`)
- U-Key brand support: 华大 / 天地融 (`d8c0fe384`)
- **SQLCipher AES-256** encrypted database (`9c0f5f7d6`)
- DB access refactor + enhanced encryption (`e0684b587`)
- Dev-mode DB password skip (`6db5f1366`)
- Identity management + initial setup module (`bc27c66b2`)
- DB switch event listener + auto-refresh (`6c8dc1dcb`)

#### 🎤 Speech (2025-12-29 → 2025-12-31)

- Phase 3 advanced: audio enhancement / multilang detection / subtitles (`04bfb36b5`)
- Full speech-input optimization (`35fda1b71`)
- Realtime speech input wired into main UI (`0a6960d13`)

#### 🌍 i18n (2025-12-28 → 2026-01-01)

- **Full i18n system** (`e62ce4a33`)
- Top-bar language switcher (`93d0eb3d7`)
- Template category + tag Chinese translations (`791f0de96`, `d20c84ec8`)

#### 📦 Packaging (2025-12-31 → 2026-01-01) — culminates in v0.2.0

- Windows production packaging + backend service management (`083aa10eb`)
- Built-in data import + packaging toolset (`cb2b16199`)
- **Cross-platform shell scripts** + dependency optimization (`bd321a5dc`)
- **Windows installer + auto-update** (`a425f62e1`)
- 🏷️ **`06860faab` — v0.2.0: full packaging system + multi-deployment** (16 files, +5518 / -8)

#### Other Highlights

- Web IDE components + editor docs (`c2777b87c`)
- Knowledge version history schema (`6cd7eff0a`)
- Knowledge version history full subsystem (`f5d5d552c`, `96faca4ab`)
- Browser extension AI assistance + skill-tool system (`f6fce0fab`, `77f0b823c`)
- Web annotation editor (`c98c6de90`)
- Blockchain smart contracts + transaction escrow (`60522e0af`)
- Cross-chain bridge contract integration (`693854078`)
- WebRTC transport error handling + Node.js compat (`0025657f3`)
- Voice recognition + blockchain + P2P NAT traversal (`39e6c49ed`)
- Video import + management (`a9a81c8b7`)
- Video skill-tool DB migrations + real-implementation extensions (`250baf48e`)
- System tray + config management (`5df9171f5`)
- Backend test framework + Git manager optimization (`948a5e162`)
- Backend service client (`5b628e6ee`)
- Backend API + voice input + multimedia editor (`31635ff01`)
- Anthropic Claude API + LLM config enhancement (`0c07a6e33`)
- LLM quick-setup connection test (`875bf3f10`)
- Connection test for LLMSettings + SystemSettings (`f2165a3b3`)
- Project-service RAG index + code-assistant client methods (`79004a85b`)
- Git repo init UI check + confirm dialog (`b6b98a080`)
- ProjectDetailPage security + perf optimization (`cb6e4bd39`, `ed33c93a6`)
- Domain-specific AI toolset (`1dcee3f99`)
- Website redesign — home page (`cea70e53a`)
- Docs website updates (`4f6c6b20e`, `d8e7de24d`)
- Network diagnostics + screen recording (`655e98d78`)

### Stats

- **31 days** from day-0 to v0.2.0 (2025-12-01 → 2026-01-01)
- **602 commits** total, **271 with `feat` prefix** spanning 50+ scopes
- Biggest scopes by commit count: `templates` (13), `enterprise` (11), `sync` (8), `skill-tool` (8), `ui` (7), `project` (7)
- December split: 583 commits in 2025-12, 19 in 2026-01

### Notable

- Project went straight from "first commit" to v0.2.0 — there is no v0.1.x lineage in git
- Pre-orphan history (the 4046 commits between 2025-12-01 and 2026-05-17 v5.0.3.63) was disconnected from `main` until 2026-05-28 when restored via `git replace --graft`
- All SHAs above are reachable from current `main` only thanks to the graft (`refs/replace/e2612b2f1...`); without it, `git log main` stops at 2026-05-18

---

## Links

- Tag: [`v0.2.0`](https://github.com/chainlesschain/chainlesschain/releases/tag/v0.2.0) → commit `06860faab`
- Day-0 commit: `93d52d9ac` (2025-12-01 10:57:47 +0800 — "first commit")
- Project: [chainlesschain/chainlesschain](https://github.com/chainlesschain/chainlesschain)
