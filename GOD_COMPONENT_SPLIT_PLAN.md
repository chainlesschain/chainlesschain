# God Component 切分路线图

> 日期：2026-04-22
> 对应审计：`AUDIT_2026-04-22.md` §1 超大文件
> 关联模式：`CLAUDE.local.md` — `SystemSettings.vue` 3444→1070（6 次 pane 抽离，-69%）、`MainLayout.vue` 3203→1943（6 次抽离，-39%）、`DIDManagement.vue` 1390→543（3 次抽离，-61%）

这俩文件占全仓库 20%+ 的代码体量，拆分收益巨大但必须小步：一次 PR 只抽一个子模块。

---

## 🔴 `desktop-app-vue/src/main/remote/browser-extension/background.js` · 15,509 行

**角色**：浏览器扩展 ↔ 桌面端的 WebSocket 桥接 + 命令 dispatcher。扩展里跑着 Chromium API 的 listTabs / captureScreenshot / executeScript 等 ~150+ 命令。

**现状结构**（已有 `// ==================== <Section> ====================` 分节，便于切分）：

| 位置 | 节名 | 推测行数 | 建议模块 |
|---|---|---|---|
| 1-50 | 连接管理 | ~50 | 保留 `background.js` |
| 51-173 | `connect` / `scheduleReconnect` / `disconnect` / `sendMessage` | ~125 | `transport.js` |
| 174-223 | `handleMessage` | ~50 | 保留 |
| 224-1742 | `executeCommand` dispatcher + ~120 命令分支 | ~1520 | 按下面分节表单拆成独立 handler 文件 |
| 1743-1808 | Tab Operations | ~65 | `handlers/tabs.js` |
| 1809-1865 | Page Operations | ~55 | `handlers/page.js`（与第二段 Page Ops 合并） |
| 1866-1891 | Bookmarks | ~25 | `handlers/bookmarks.js` |
| 1892-1913 | History | ~20 | `handlers/history.js` |
| 1914-1953 | Clipboard | ~40 | `handlers/clipboard.js` |
| 1954-2015 | Cookies | ~60 | `handlers/cookies.js` |
| 2016-2102 | Downloads | ~85 | `handlers/downloads.js` |
| 2103-2222 | Windows | ~120 | `handlers/windows.js` |
| 2223-2317 | Storage | ~95 | `handlers/storage.js` |
| 2318-2609 | Element Interactions | ~290 | `handlers/elements.js` |
| 2610-2767 | Page Operations (2) | ~155 | 并入 `handlers/page.js` |
| 2768-2805 | Browsing Data | ~40 | `handlers/browsing-data.js` |
| 2806-2957 | Network Interception | ~150 | `handlers/network.js` |
| 2958-3035 | Console Capture | ~75 | `handlers/console.js` |
| 3036-3217 | IndexedDB | ~180 | `handlers/indexeddb.js` |
| 3218-3332 | Performance | ~110 | `handlers/performance.js` |
| 3333-3379 | CSS Injection | ~45 | `handlers/css.js` |
| 3380-3459 | Accessibility | ~80 | `handlers/accessibility.js` |
| 3460-3494 | Frame Management | ~35 | `handlers/frames.js` |
| 3495-3507 | Notifications | ~15 | `handlers/notifications.js` |
| 3508-3646 | **Phase 17 WebSocket Debugging** | ~140 | `handlers/phase17/websocket-debug.js` |
| 3647-3773 | Phase 17 Service Worker | ~125 | `handlers/phase17/service-worker.js` |
| 3774-3900 | Phase 17 Cache Storage | ~125 | `handlers/phase17/cache.js` |
| 3901-4030 | Phase 17 Security Info | ~130 | `handlers/phase17/security.js` |
| 4031-4181 | Phase 17 Animation Control | ~150 | `handlers/phase17/animation.js` |
| 4182-4433 | Phase 17 Layout Inspection | ~250 | `handlers/phase17/layout.js` |
| 4434-4580 | Phase 17 Coverage Analysis | ~145 | `handlers/phase17/coverage.js` |
| 4581-4719 | Phase 17 Memory Profiling | ~140 | `handlers/phase17/memory.js` |
| 4720-4825 | Phase 18 DOM Mutation Observer | ~105 | `handlers/phase18/mutation-observer.js` |
| 4826-... | Phase 18 Event Listener Inspector + 剩余节 | ~10,600 | 按同模式继续 |

**核心重构动作**：

1. 把 `executeCommand(method, params)` 中的长 switch/dispatch 改成注册表驱动：
   ```js
   // handlers/index.js
   import { tabsHandlers } from './tabs';
   import { pageHandlers } from './page';
   export const handlerRegistry = { ...tabsHandlers, ...pageHandlers, ... };

   // background.js
   async function executeCommand(method, params) {
     const handler = handlerRegistry[method];
     if (!handler) throw new Error(`unknown method: ${method}`);
     return handler(params);
   }
   ```
2. 每个 `handlers/*.js` 导出一个命名的对象：`export const tabsHandlers = { 'tabs.list': listTabs, 'tabs.get': getTab, ... };`
3. 扩展里的共享工具（`sendMessage` / 全局状态）通过 `context` 参数传给 handler，避免 handler 文件 import background.js 造成环。

**验收**：
- 扩展侧集成测试（如存在）全绿
- 扩展 ↔ 桌面端 WS 协议无新增消息、无字段格式变化
- manifest.json 的 `background.service_worker` / `background.scripts` 指向不变
- 扩展包大小变化 < 5%（浏览器扩展体积对加载速度敏感）

**PR 顺序建议**（每个 PR 独立，便于回滚）：

1. **PR-1** 引入 registry + 抽 Tab/Bookmark/History 三个小节（~150 行出 background.js）
2. **PR-2** 抽 Cookies/Clipboard/Downloads/Windows/Storage（~400 行出）
3. **PR-3** 抽 Elements/Page/BrowsingData/Network/Console（~800 行出）
4. **PR-4** 抽 IndexedDB/Performance/CSS/A11y/Frames/Notifications（~500 行出）
5. **PR-5** 抽 Phase 17 全部 8 节（~1200 行出）到 `handlers/phase17/`
6. **PR-6** 抽 Phase 18 剩余节到 `handlers/phase18/`
7. **PR-7** 抽 剩余 ~10k 行的未分节代码（先加 `// ====` 分节，再按节抽）

每 PR 行数控制 < 2k、跨越单个 manifest 版本 tag、独立 smoke test 通过方可合。

---

## 🟡 `desktop-app-vue/src/renderer/pages/AIChatPage.vue` · 5,558 行

**角色**：主 AI 对话页，包含常规聊天 + Coding Agent 模式 + Worktree 隔离 + Harness 任务跟踪 4 个子系统。

**现状结构**（已从 grep 中识别的关键块）：

| 子系统 | 标志性 ref / 函数 | 建议出口 |
|---|---|---|
| 1. 基础对话 | `conversations` / `activeConversationId` / `messages` / `isThinking` / `savingConversation` | 留在父组件（父的职责） |
| 2. Coding Agent 模式 | `agentMode` / `codingAgentSessionMap` / `agentMessageByRequestId` / `processedCodingAgentEventIds` / `codingAgentStore` | `composables/useCodingAgent.ts`（~400 行） |
| 3. Worktree 隔离 | `worktreeIsolationEnabled` / `worktreeReviewVisible` / `worktreeMergeSubmitting` / `selectedWorktreePreview` / `worktreePreviewLoading` / `worktreeAutomationLoadingKey` / `worktreeMergePreviewDelta` / `worktreeDeltaFilter` | `components/chat/WorktreeReviewDrawer.vue` + `composables/useWorktreeIsolation.ts`（~350 行） |
| 4. Harness 任务抽屉 | `harnessTaskDrawerVisible` / `harnessTaskHistoryLimit` / `harnessTaskStatusFilter` / `harnessTaskSearchQuery` / `harnessTaskPage` / `harnessUiStateByConversation` | `components/chat/HarnessTaskDrawer.vue`（~300 行） |
| 5. 消息渲染 | (template 大头) | 现有 `components/chat/UserAssistantMessage.vue` 已在；考虑引入 `components/chat/MessageList.vue` 容器 |

**切分顺序建议**（与 SystemSettings 抽 pane 的节奏一致）：

1. **PR-1** Harness 任务抽屉 → `components/chat/HarnessTaskDrawer.vue`
   - 最独立（有自己的 drawer visibility + status filter + search + pagination）
   - 预计 AIChatPage.vue 减 ~300 行，子组件 ~350 行
   - 用 `defineModel('open')` + emits('task-selected') 做 I/O

2. **PR-2** Worktree 审查抽屉 → `components/chat/WorktreeReviewDrawer.vue` + `composables/useWorktreeIsolation.ts`
   - 抽屉 UI（~200 行）+ 对应的 preview/merge/filter 状态 composable（~150 行）
   - 预计 AIChatPage.vue 减 ~400 行

3. **PR-3** Coding Agent session 状态 → `composables/useCodingAgent.ts`
   - 纯逻辑（session map / event dedup set / request-id message map），无 UI
   - 预计 AIChatPage.vue 减 ~500 行

4. **PR-4** 消息列表容器 → `components/chat/MessageList.vue`
   - 消化 template 里最大的一段，搭配 v-for + virtualization
   - 预计 AIChatPage.vue 减 ~800-1200 行（template 部分）

**单 PR 验收清单**：

- `npm run build:renderer` 无 TS 错误
- `npx vitest run src/renderer/stores/__tests__/` 600/600 绿（与 CLAUDE.local.md 基线一致）
- 手动验证：常规对话 / Agent 模式 / Worktree 开关 / Harness drawer 打开/关闭 / 消息滚动

**预期最终行数**：5558 → ~2800（-50%），与已完成的 SystemSettings 同量级。

---

## 为什么不在本次 audit 工作内直接拆

AUDIT_2026-04-22.md 这一轮（commit 6e58ad93c..4ede1f418）聚焦**低风险、广覆盖**的修复：IPC 测试空白、XSS、依赖风险披露、helper 抽取、CI、文档。单次会话拆 21k 行代码违反小步提交原则，会让回归排查失控。

每个 PR 在正常迭代周期里推，比在审计周集中改更安全。

---

*Helper、文档、CI 已落地；God Component 拆分由团队按上面 PR 序列推进。*
