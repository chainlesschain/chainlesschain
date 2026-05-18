# iOS Phase 6.3 + 6.4 — knowledge / ai 桌面 debt 评估 & 协作策略

> **状态**：合并 design doc v0.1（2026-05-18）。覆盖 Phase 6.3 (knowledge skill) + Phase 6.4 (ai 余 method) 两个共享 "iOS 写了但桌面端没 wire" 桌面 debt 困境的 skill。**包含 Phase 5 AI Chat 重大审计发现** — 详 §2.2.
>
> **依赖**：Phase 6 Plan §1.3 + §7 Trap T10 (A 策略：iOS 只 impl 桌面已支持子集); Phase 5 AI Chat skill (`iOS_Phase_5_AI_Chat_Skill.md`); Coverage doc §1.4 (knowledge 7% / ai 7% match)。
>
> **关联**：`iOS_Phase_6_6_Desktop_Skill.md` + `iOS_Phase_6_7_Extension_Skill.md` (前两次 "桌面 debt" 审计实为误判 — Trap T2/T4 都不是真 debt)；本次 **审计后 debt 是真的**，无法靠架构修正绕过。

---

## 1. 共同背景 & 任务

### 1.1 与 Phase 6.6/6.7 的关键差别

前两次审计 (Phase 6.6 desktop + 6.7 extension) 的 "桌面 debt 大" 警告都是 **误判** — 实际架构通过 sub-dispatch (6.6) 或 proxy (6.7) 让 iOS 走 DC RPC 同模式，**桌面真实 debt = 0**。

**Phase 6.3 / 6.4 不一样**：本次审计发现 desktop handler 的 case set 严格 ⊂ Android invoke set，**没有 sub-dispatch / 没有 proxy** — 缺失的 method 桌面端真的需要新写 handler 代码才能支持。

### 1.2 §7 Trap T10 + 2026-05-18 决策

Plan §9 已决策 T10 = **A 策略**：iOS 只 impl 桌面已支持 method，留桌面 debt 给 Phase 7+ backlog (13 周完成 iOS 主线 vs 19 周 B 策略含桌面协作)。

本 doc 重新审视：knowledge + ai 是 T10 最大债主 (46 + 42 = 88 method)。**A 策略对这 2 skill 意味着什么**？详 §3。

---

## 2. 审计发现

### 2.1 knowledge: 9 wired vs 55 Android

**桌面 `knowledge-handler.js` 真实 case set (9):**
- createNote / updateNote / deleteNote / searchNotes / getTags
- getNoteById (vs Android `getNote`)
- getNotesByTag / getFavorites / syncNote (桌面 unique)

**Android typed wrapper (55 method):**
- 9 直接对应桌面 (其中 `getNote` ↔ `getNoteById` 名称分化)
- **46 桌面缺**: folders (getFolders/createFolder/deleteFolder/renameFolder/moveFolder/exportFolder) / tags (createTag/deleteTag/renameTag/mergeTags/addTagsToNote/removeTagsFromNote) / templates (getTemplates/getTemplate/saveAsTemplate/createFromTemplate) / versions (getNoteHistory/getNoteVersion/restoreNoteVersion/compareVersions) / archive (archiveNote/restoreNote/getArchivedNotes/getTrash/emptyTrash) / star+pin (starNote/getStarredNotes/pinNote/getPinnedNotes/getRecentlyEdited/getRecentlyViewed) / attachments (addAttachment/getAttachments/deleteAttachment/downloadAttachment) / links (linkNotes/unlinkNotes/getBacklinks/getOutgoingLinks/getKnowledgeGraph) / import-export (importNote/importFromFile/exportNote/exportNotes) / search (advancedSearch/semanticSearch + 简单 search alias)

**真实用户场景 vs 桌面缺 method 分组**:

| 用户场景 | Method 数 | 桌面 debt 优先级 |
|---|---:|---|
| 文件夹管理 (folders) | 6 | 🔴 高 — 用户用笔记必需 |
| 标签管理 (tags 增删改) | 6 | 🟡 中 — 桌面已支持 getTags, 仅缺 CRUD |
| 模板 (templates) | 4 | 🟢 低 — niche |
| 版本管理 (versions) | 4 | 🟢 低 — niche |
| 归档 / 回收站 | 5 | 🟢 低 |
| 收藏 / 置顶 / 最近 | 6 | 🟡 中 — 桌面已有 getFavorites |
| 附件 (attachments) | 4 | 🟢 低 — mobile 用例少 |
| 笔记关联 (links / 知识图谱) | 5 | 🟢 低 — 桌面 feature, mobile 用得少 |
| 导入 / 导出 | 4 | 🟡 中 — 用户偶用 |
| 高级搜索 (semantic / advanced) | 2 | 🟡 中 — 但 ChainlessChain RAG 已有 ragSearch |

### 2.2 ai: 10 wired vs 52 Android **+ Phase 5 重大发现**

**桌面 `ai-handler.js` 真实 case set (10):**
- chat / controlAgent / getConversations / getModels / ragSearch
- list / restart / start / status / stop (agent 控制 — 已有 controlAgent 替代？)

**Android typed wrapper (52 method):**
- 4 直接对应桌面：chat / getConversations / getModels / ragSearch
- 6 桌面有但 Android 不暴露：list / restart / start / status / stop / controlAgent (agent 控制)
- **42 桌面缺**: chatStream / getStreamChunk / cancelStream / chatWithTools / submitToolResult / createConversation / deleteConversation / getConversation / getMessages / regenerateResponse / editAndRegenerate / deleteMessage / clearConversation / renameConversation / archiveConversation / exportConversation / generateImage / editImage / imageVariation / generateEmbedding / generateEmbeddings / computeSimilarity / analyzeImage / analyzeSentiment / extractEntities / extractKeywords / summarize / translate / explainCode / generateCode / reviewCode / textToSpeech / transcribeAudio / listVoices / listAgents / ocrImage / ragAddDocument / ragAddDocuments / ragCreateCollection / ragDeleteCollection / ragDeleteDocument / ragListCollections / getQuota / getUsageStats / getPromptTemplate / listPromptTemplates / createPromptTemplate / usePromptTemplate

#### 🚨 Phase 5 AI Chat 严重 wire 不完整

**iOS Phase 5 AIChatCommands 9 method 中只 2 个真桌面有对应 case：**

| iOS Phase 5 method | 桌面 case 存在? | 真机调用结果 (推测) |
|---|---|---|
| `ai.chat` | ✅ | 工作 |
| `ai.getConversations` | ✅ | 工作 |
| `ai.chatStream` | ❌ | **"Unknown action"** |
| `ai.getStreamChunk` | ❌ | **"Unknown action"** |
| `ai.cancelStream` | ❌ | **"Unknown action"** |
| `ai.getConversation` | ❌ | **"Unknown action"** |
| `ai.createConversation` | ❌ | **"Unknown action"** |
| `ai.deleteConversation` | ❌ | **"Unknown action"** |
| `ai.getMessages` | ❌ | **"Unknown action"** |

CLAUDE.local.md 记 "Phase 5.8 真实 bug 已通过静态审计修，单测从 41 → 45" — **但单测都用 mock RemoteCommandClient，从未真打桌面 ai-handler.js**。Phase 5.7 真机 E2E 没跑（pending Mac+iPhone+真桌面），所以这 7 个 "Unknown action" 永远没被发现。

**严重程度**：用户进入 AI Chat tab 后**主要交互 (chatStream / 创建/删除对话) 全部 fail**。只能调 chat (单次同步) + getConversations (拉历史列表)。

#### 用户场景 vs ai 桌面 debt

| 用户场景 | Method | 桌面 debt 优先级 |
|---|---|---|
| **流式聊天 (Phase 5 核心 UX!)** | chatStream / getStreamChunk / cancelStream | 🔴🔴 **极高 — Phase 5 已 land UI 但桌面不响应** |
| **对话 CRUD (Phase 5)** | createConversation / deleteConversation / getConversation / getMessages | 🔴 高 — Phase 5 UI 已用 |
| 多模态生成 | generateImage / editImage / imageVariation / textToSpeech / transcribeAudio | 🟡 中 |
| RAG knowledge ops | ragAddDocument / ragCreateCollection / ragListCollections | 🟡 中 — 已有 ragSearch |
| Embedding | generateEmbedding / computeSimilarity | 🟢 低 |
| 代码生成 / 分析 | generateCode / explainCode / reviewCode | 🟢 低 — 用户走 chat 也能做 |
| Prompt templates | listPromptTemplates / createPromptTemplate / usePromptTemplate | 🟢 低 |
| OCR / 翻译 / 摘要 | ocrImage / translate / summarize | 🟢 低 |
| Quota / 用量 | getQuota / getUsageStats | 🟢 低 |

---

## 3. Open Questions — 策略选择

### OQ-3.1：Phase 6.4 紧急处理 Phase 5 已 land 但 7 method 桌面缺

**问题**：Phase 5 iOS UI 已 ship (Phase 5.1-5.6 commits)，用户进 AI Chat 体验**严重残缺** (chatStream 不工作就没流式响应)。

**A**：**桌面端紧急扩** ai-handler.js — 加 7 method case (chatStream/getStreamChunk/cancelStream/createConversation/deleteConversation/getConversation/getMessages) — **桌面工作量 ~3-5 天**

**B**：iOS Phase 5 UI 改 downgrade 模式 — 只用 chat (非流式) + getConversations 列表，禁用流式 / CRUD — UX 严重退化但当前可用

**C**：**接受 Phase 5 当前残缺**，留桌面 debt — 真机 E2E (Phase 6.0) 发现后再说

**推荐 A**。理由：Phase 5 iOS UI 已 ship 真机不工作 = 现存重大 bug，必须修。即使坚持 T10 A 策略 (iOS 不实施新 method)，对 Phase 5 既有 method 桌面端应补完整 — 不是 "新桌面 debt"，是 **修 Phase 5 既有 UI 的桌面端 bug**。**6.4 实施前 prerequisite**。

### OQ-3.2：knowledge skill 整体策略

**A**：A 策略 (T10 默认) — iOS 只 wrap 桌面已支持 9 method，跳过 46 缺失 method
- 优点：iOS 1-2 天 land，0 桌面协作
- 缺点：用户失去文件夹 / 标签管理 / 导出等核心笔记 feature

**B**：桌面协作 high-priority 子集 — 加桌面 10 method (folders 6 + tags 3 + 导出 1) ≈ 桌面 ~3-5 天 + iOS 2-3 天
- 优点：用户核心场景齐
- 缺点：桌面端协作工作

**C**：完整 hybrid — 桌面加 30 method (folder + tags + 收藏/置顶 + 版本 + 导出) ≈ 桌面 ~7-10 天 + iOS 5-7 天
- 优点：基本完整对齐 Android
- 缺点：周期长

**推荐 B**。理由：文件夹是笔记基本盘 ("无文件夹分类"对 mobile 笔记用户是 dealbreaker)；标签 + 导出是高频；版本/归档/附件等 niche 留 Phase 7+。

### OQ-3.3：ai skill 余 method (排除 Phase 5 已 land 的 9)

**A**：A 策略 — iOS 只 wrap 桌面已支持的 4 method (chat 已在 Phase 5，getConversations/getModels/ragSearch + controlAgent)
- 优点：iOS 0-1 天 land
- 缺点：用户失去多模态 / embedding / agent listing 等

**B**：桌面协作高价值子集 — 加桌面 8 method (generateImage + textToSpeech + transcribeAudio + ocrImage + listAgents + ragAddDocument + ragListCollections + summarize) ≈ 桌面 ~5-7 天 + iOS 3-4 天
- 优点：用户能用图片生成 / 语音 / OCR
- 缺点：桌面端工作

**C**：完整 hybrid — 桌面加 25 method ≈ 桌面 ~14 天 + iOS 7 天
- 优点：与 Android 几近齐
- 缺点：超出 Phase 6 范围

**推荐 B**。理由：generateImage / textToSpeech 是 AI 主流 feature；listAgents 是 Cowork Multi-Agent 入口；ocrImage 移动场景高频 (拍照识字)。

---

## 4. 推荐综合 — 修 Phase 5 紧急 bug + 选择性桌面协作

### 4.1 立即行动 (Phase 6.4 紧急 prerequisite)

**Action 1 (桌面端 must-do, ~3-5 天)**: 修 Phase 5 AIChat 7 个 "Unknown action" — 加桌面 ai-handler.js 7 method case:
- `chatStream` / `getStreamChunk` / `cancelStream` (流式聊天 — Phase 5 核心 UX)
- `createConversation` / `deleteConversation` / `getConversation` / `getMessages` (对话 CRUD)

**Action 2 (Phase 6.0 真机 E2E 包含)**: 验证 Phase 5 AIChat 8 method 全工作 (Action 1 完成后)

### 4.2 Phase 6.3 knowledge (B 策略)

**桌面端 (~3-5 天)**: 加 knowledge-handler.js 10 method:
- folders 6: getFolders / createFolder / deleteFolder / renameFolder / moveFolder / exportFolder
- tags 3: createTag / deleteTag / renameTag (getTags 已有)
- 导出 1: exportNote

**iOS 端 (~2-3 天)**: KnowledgeCommands actor wrap 19 method (9 已支持 + 10 新):
- 已支持: createNote / updateNote / deleteNote / searchNotes / getTags / getNoteById / getNotesByTag / getFavorites / syncNote
- 新: getFolders / createFolder / deleteFolder / renameFolder / moveFolder / exportFolder / createTag / deleteTag / renameTag / exportNote

**UI**: KnowledgeView (新 14 主屏 tab "知识库") — 文件夹树 + 笔记列表 + 标签 chip + 导出按钮

### 4.3 Phase 6.4 ai 余 (B 策略)

**桌面端 (~5-7 天)**: 加 ai-handler.js 8 method:
- 多模态: generateImage / textToSpeech / transcribeAudio / ocrImage
- Agent: listAgents
- RAG: ragAddDocument / ragListCollections
- 工具: summarize

**iOS 端 (~3-4 天)**: AIExtendedCommands actor wrap 8 method + UI (AIChat tab 内扩展 panel)

### 4.4 总估时

| 阶段 | 桌面端 | iOS 端 | 累计 |
|---|---:|---:|---:|
| Action 1: Phase 5 修 7 method | 3-5 天 | 0 | 3-5 天 |
| Phase 6.3 knowledge | 3-5 天 | 2-3 天 | 5-8 天 |
| Phase 6.4 ai 余 | 5-7 天 | 3-4 天 | 8-11 天 |
| **小计 (并行)** | 11-17 天 | 5-7 天 | **16-22 天 ≈ 3-4 周** |

(假设桌面端 + iOS 端可并行；iOS 等桌面端 method 上线后再 wrap)

---

## 5. 决策记录

| 日期 | OQ | 决策 | 决策人 | 备注 |
|---|---|---|---|---|
| 2026-05-18 | OQ-3.1 修 Phase 5 残缺 | 待定（推荐 A 桌面端紧急扩 7 method）| — | Phase 6.0 E2E 前必修 |
| 2026-05-18 | OQ-3.2 knowledge 策略 | 待定（推荐 B 桌面 +10 method / iOS 19 method）| — | folders/tags/导出 高价值 |
| 2026-05-18 | OQ-3.3 ai 余策略 | 待定（推荐 B 桌面 +8 method / iOS 8 method）| — | 多模态 / agent / RAG |

---

## 6. 与 T10 "A 策略" 决策的关系

Plan §9 T10 = "A 策略 (iOS 只 impl 桌面已支持子集，桌面 debt 留 Phase 7+ backlog)"。本 doc 推荐 **修正 T10**:

- **T10 维持**: Phase 6.1B3 红档子集 batch 2 (power/process/network/storage/device/sysinfo) + Phase 6.5 (workflow/system/history) — 这些 namespace 桌面已有功能完整，缺的是 niche method
- **T10 例外 (Phase 6.3 + 6.4)**: knowledge + ai 桌面 9-10 已支持是**核心功能子集**，缺 46-42 是**用户基本盘** — 严格 A 策略让 iOS 笔记/AI 残缺到不可用
- **Action 1 不属 T10 调整**: 修 Phase 5 已 ship UI 的桌面 bug 是债务清理，非新 debt

---

## 7. 关联

- `iOS_对标_Android_Phase_6_Plan.md` §1.3 表 (knowledge 7% / ai 7%) + §7 Trap T10 (A 策略 — 本 doc 推荐为 6.3+6.4 调整为 B)
- `iOS_Phase_5_AI_Chat_Skill.md` (Phase 5 设计, 实施 commit `dd9a44a45` 等)
- `iOS_Phase_6_6_Desktop_Skill.md` (Trap T2 误判模式参考)
- `iOS_Phase_6_7_Extension_Skill.md` (Trap T4 误判模式参考)
- `Desktop_Mobile_Bridge_Namespace_Coverage.md` §1.4 (knowledge / ai 真实数据)
- 桌面端: `desktop-app-vue/src/main/remote/handlers/knowledge-handler.js` (9 case) / `ai-handler.js` (10 case) — **本 doc Action 1+2+3 触发 case 扩展**
- Android: `KnowledgeCommands.kt` (55 invoke) / `AICommands.kt` (52 invoke)
