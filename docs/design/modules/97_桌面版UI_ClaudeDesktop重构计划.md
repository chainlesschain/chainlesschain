# 97 · 桌面版 UI ClaudeDesktop 重构计划（P7）

> 在 v6 Shell P0–P6 完成的基础上，把桌面版外观重塑为 "**Claude Desktop 主骨架 + Web Panel 信息密度 + 四颗固化去中心化入口**"，强化桌面版与 CLI 版的定位分离。

---

## 文档信息

| 项 | 内容 |
|---|---|
| 文档类型 | 实施计划（Implementation Plan） |
| 父设计文档 | [`docs/design/桌面版UI重构_设计文档.md`](../桌面版UI重构_设计文档.md) §8 P7 |
| 模块 | `desktop-app-vue/src/renderer/shell-preview/` |
| 适用版本 | v5.0.2.34 → v6.0 |
| 状态 | 已落地（Preview / 可访问 `/v6-preview`） |
| 最近更新 | 2026-04-20 |

### 交付状态（2026-04-20）

- ✅ 主题层：`src/renderer/shell-preview/themes.css`（4 套 `--cc-preview-*` token）+ `src/renderer/stores/theme-preview.ts`（Pinia，localStorage 持久化）
- ✅ 子组件：`ConversationList.vue` / `DecentralEntries.vue` / `ArtifactDrawer.vue`
- ✅ 主壳：`AppShellPreview.vue`（左栏会话 + 底部 4 颗入口 + 中区气泡 + 右抽屉 artifact + 主题切换）
- ✅ 路由：`/v6-preview`（与 `/v2` 并行，不替换既有壳）
- ✅ 单测：11 条主题 store + 8 条 slash-dispatch = 19 条全部通过
- ✅ P8 已落地：4 颗去中心化入口点击后在右抽屉嵌入轻量 preview widget（`shell-preview/widgets/{P2p,Trade,Social,UKey}PreviewWidget.vue`），每颗 widget 含概览卡 + 2–3 个 `router.push` 按钮跳转到既有 `/main/*` 完整页；widget 注册表 `shell-preview/widgets/index.ts` 单测 5 例全过
- ✅ P9a 已落地：新增 `src/renderer/stores/conversation-preview.ts`，会话 + 消息持久化到 `localStorage`（key `cc.preview.conversations`，带 `version: 1` schema 标识）；重启壳自动 `restore()` 恢复上次会话列表与选中项；`AppShellPreview.vue` 所有会话读写均走 store；13 条 store 单测全部通过
- ✅ P9b 已落地：新增 `src/renderer/shell-preview/services/llm-preview-bridge.ts`，`sendDraft()` 把会话历史 + 当前用户输入通过 `window.electronAPI.llm.chat({ messages, enableRAG:false, enableCache:false, ... })` 调真 LLM（火山引擎 / Ollama），返回后追加 assistant 气泡；`isAvailable()` 先查 `llm:check-status`，不可用时走友好兜底文案；store 新增 `isGenerating` 标志 → 发送按钮 loading + 气泡列表渲染三点打字指示器；19 条 bridge 单测 + 2 条 store 新测用例全过（58 条 preview 壳测试）

## 1. 背景与目标

### 1.1 桌面版与 CLI 版的定位分离

| 维度 | CLI 版 (`packages/cli`) | 桌面版 v6 (`desktop-app-vue`) |
|---|---|---|
| 用户 | 开发者 / 运维 / CI 脚本 | **个人办公 · 个人事务管理** |
| 入口 | 终端命令 (`cc ...`) | GUI 对话壳 |
| 数据 | 本地文件 / 远程 API | **本地加密盘 + 硬件 U-Key** |
| 特色 | 技能包 / 编排 / 自动化 | **个人隐私保护 + 去中心化协作/交易/社交 + 硬件级安全** |
| UI 风格 | 命令行 | **Claude Desktop 式极简对话壳** |

### 1.2 为什么还要 P7

P6 完成时，桌面壳具备了完整的插件平台能力，但外观仍是 Ant Design 默认卡片 + 当前 `/v2` 是三区固定布局，存在两个问题：

1. **视觉上不够"对话优先"** — Ant Design 默认的卡片阴影 / 分割线 / 表格感让它看起来像管理后台，和 Claude Desktop 的留白 + 气泡对比，桌面用户心智负担重。
2. **差异化能力被埋没** — 去中心化身份 / P2P / 钱包 / ZKP 这些桌面版独有的卖点散落在 97 个旧页里，入口不固定。

### 1.3 目标

1. **外观对齐 Claude Desktop**：极简留白、气泡对话、Artifact 从右滑入（非固定占位）。
2. **左栏改为"Space 分组的会话历史"**：和 Claude Desktop 一致；Space 切换通过顶部下拉或折叠组实现。
3. **左栏底部固化 4 颗"去中心化"入口**：P2P 协作 / 去中心化交易 / 去中心化社交 / U-Key 安全；永远可见，不藏进设置。
4. **移植 Web Panel 的 4 主题**：dark / light / blue / green 通过 CSS 变量切换，持久化到 localStorage。
5. **不替换任何现网入口** — 只上线新路由 `/v6-preview`；`/v2` (v6 Shell) 和 `/` (旧 dashboard) 继续并存。
6. **复用 P6 所有插件能力** — 扩展点注册表 / slash-dispatch / widget-registry 不重写。

## 2. 范围

### 2.1 纳入

- 新增 `src/renderer/shell-preview/` 目录，独立骨架
- 新建 Pinia store `stores/theme-preview.ts` 承载 4 主题 + localStorage 持久化
- 新增路由 `/v6-preview` → `AppShellPreview.vue`
- 单元测试：`tests/unit/renderer/shell-preview/*.test.ts`

### 2.2 不纳入

- 不动 `src/renderer/shell/*.vue` 的 P0–P6 实现（保持 `/v2` 不变）
- 不动 97 个旧页面（P7 只搭外观壳，功能迁移留到 P8+）
- 不做 MDM / Profile 的企业联调回归（P3–P5 已覆盖）
- 不做真正的会话历史持久化（P7 只拉既有 `conversations` store 的数据渲染）

## 3. UI 布局

```
┌────────────────────────────── /v6-preview ──────────────────────────────┐
│ ┌──────────────┬──────────────────────────────┬────────────────────┐  │
│ │              │                              │                    │  │
│ │ Space 选择   │         [Claude Desktop      │   [ArtifactDrawer  │  │
│ │  ▼ 个人空间  │          式留白 + 气泡]      │    从右侧按需滑入] │  │
│ │              │                              │                    │  │
│ │ ─ 今天       │                              │  默认收起          │  │
│ │   · 对话标题1│   ┌──────────────────────┐  │                    │  │
│ │   · 对话标题2│   │ Composer (/ @ 发送)  │  │                    │  │
│ │ ─ 昨天       │   └──────────────────────┘  │                    │  │
│ │   · ...      │                              │                    │  │
│ │ ─ 本周       │                              │                    │  │
│ │                                                                   │  │
│ │ ┌────────────┐                                                    │  │
│ │ │ 去中心化   │ ← 固化 4 颗入口（永远可见）                       │  │
│ │ │ 🔗 P2P 协作│                                                    │  │
│ │ │ 💱 去中心交│                                                    │  │
│ │ │ 🌐 去中社交│                                                    │  │
│ │ │ 🔐 U-Key   │                                                    │  │
│ │ └────────────┘                                                    │  │
│ │                                                                   │  │
│ │ 主题切换 | 设置                                                   │  │
│ └──────────────┴──────────────────────────────┴────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.1 左栏（ConversationList）

| 区块 | 内容 |
|---|---|
| 顶部 | Space 切换下拉（复用 `shell/ShellSidebar.vue` 的 Space 拉取逻辑） |
| 中部 | 按"今天 / 昨天 / 本周 / 更早"分组的对话标题列表（从既有 `stores/conversations` 拉） |
| 下部 | **4 颗去中心化入口** — P2P / Trade / Social / U-Key 固化按钮 |
| 底部 | 主题切换 + 设置 |

收起时 → 56px，仅显示 Space 图标 + 4 颗去中心化图标。

### 3.2 中区（Conversation + Composer）

- **留白第一**：容器最大宽 760px 居中；气泡使用圆角 12px + 无阴影
- **气泡样式**：用户消息右对齐（`var(--bubble-user-bg)`），AI 消息左对齐（透明底 + 仅正文）
- **Composer**：复用 `shell/ShellComposer.vue`（`/` 命令 + `@` 引用 + Enter 发送），外观重绘为单行无边框输入，焦点时底部微高亮
- **无卡片阴影** — 通过 CSS override `.ant-card { box-shadow: none !important; }`

### 3.3 右区（ArtifactDrawer）

- 默认收起
- 由 Artifact 事件或 `/` 命令触发时从右滑入（宽 480px，可拖拽调 320–720px）
- 复用 `shell/ArtifactPanel.vue` 的内容渲染，只重绘容器（改用 `a-drawer` placement="right"）

### 3.4 底栏（可选，与 Claude Desktop 一致默认不显示）

- 默认隐藏
- 在 AdminConsole → 调试开启后显示现有 `ShellStatusBar.vue`（U-Key / DID / P2P / LLM / Cost）

## 4. 4 主题（CSS 变量 + store）

### 4.1 主题 Token

| Token | dark | light | blue | green |
|---|---|---|---|---|
| `--bg-base` | `#0d0d0d` | `#ffffff` | `#0f1f3d` | `#0c1f14` |
| `--bg-elevated` | `#1a1a1a` | `#f7f7f8` | `#18294d` | `#142d1f` |
| `--text-primary` | `#ececf1` | `#202123` | `#e5efff` | `#d8f0df` |
| `--text-secondary` | `#a0a0a6` | `#6e6e80` | `#8fa8d0` | `#8cc09a` |
| `--accent` | `#d77757` | `#d77757` | `#5aa0ff` | `#4ec97e` |
| `--bubble-user-bg` | `#2f2f2f` | `#f0f0f5` | `#1e3a6e` | `#1a4d2a` |
| `--border-subtle` | `#2a2a2a` | `#e5e5ea` | `#233a6a` | `#1e3a2a` |
| `--sidebar-bg` | `#171717` | `#f9f9fa` | `#0c1a36` | `#0a1a11` |

### 4.2 store 契约

```typescript
// src/renderer/stores/theme-preview.ts
export const useThemePreviewStore = defineStore("theme-preview", {
  state: () => ({
    active: "dark" as "dark" | "light" | "blue" | "green",
  }),
  actions: {
    apply(theme) {
      this.active = theme;
      document.documentElement.dataset.themePreview = theme;
      localStorage.setItem("cc.theme-preview", theme);
    },
    restore() {
      const saved = localStorage.getItem("cc.theme-preview");
      if (saved) this.apply(saved);
    },
  },
});
```

CSS 通过 `[data-theme-preview="dark"] { --bg-base: ... }` 切换。

### 4.3 与 P5 `design-tokens.css` 的关系

P5 已有 `shell/design-tokens.css`，P7 的 `shell-preview/themes.css` **不替换它**，而是定义一组独立 token（`--cc-preview-*` 前缀），仅在 `/v6-preview` 路由下生效。避免影响 `/v2`。

## 5. 四颗固化去中心化入口

| 入口 | 图标 | 点击行为 | 底层调用 |
|---|---|---|---|
| **P2P 协作** | `TeamOutlined` | Composer 预填 `/p2p` + 右侧抽屉开 P2P sessions artifact | `dispatchSlash("builtin:openP2P", ...)` |
| **去中心化交易** | `SwapOutlined` | 抽屉开钱包 + 交易签名 artifact | `dispatchSlash("builtin:openTrade", ...)` |
| **去中心化社交** | `GlobalOutlined` | 抽屉开 Nostr / Matrix / ActivityPub 社交 artifact | `dispatchSlash("builtin:openSocial", ...)` |
| **U-Key 安全** | `SafetyCertificateOutlined` | 抽屉开 U-Key 状态 + DID + 凭证 artifact | `dispatchSlash("builtin:openUKey", ...)` |

> 注册机制复用 P6 的 `slash-dispatch.ts`，P7 新增 4 个 `builtin:open*` handler。

## 6. 实施步骤

| 步 | 交付 | 依赖 |
|---|---|---|
| S1 | 探路：读 web-panel `theme.js`、找 router entry | — |
| S2 | 新建 `shell-preview/themes.css` + `stores/theme-preview.ts` | S1 |
| S3 | `ConversationList.vue`（Space 下拉 + 对话历史分组 + 4 固化入口） | S1 |
| S4 | `DecentralEntries.vue`（4 按钮 + dispatchSlash） | P6 分发器 |
| S5 | `ArtifactDrawer.vue`（`a-drawer` placement="right" 包裹 ArtifactPanel） | — |
| S6 | `AppShellPreview.vue`（组装 + Composer 集成 + 留白 CSS） | S2–S5 |
| S7 | 路由 `/v6-preview` → AppShellPreview（`router/index.ts`） | S6 |
| S8 | 在 `slash-dispatch` 注册 4 个 `builtin:open*` handler（占位实现：toast "Coming in P8"） | S4 |
| S9 | 单元测试 3 个文件：`ConversationList.test.ts`（3 例）+ `DecentralEntries.test.ts`（4 例）+ `theme-preview.test.ts`（4 例） | S2–S4 |
| S10 | 更新文档：父设计文档 P7 行 + 本计划文件 + docs-site 用户指南加一段 "预览路由 /v6-preview" | S6 |

## 7. 验证

### 7.1 单元测试（目标 ≥ 11 例全绿）

- `ConversationList` 能按"今天 / 昨天 / 本周 / 更早"分组渲染
- `DecentralEntries` 点击 4 颗按钮分别触发 `dispatchSlash("builtin:openP2P" / openTrade / openSocial / openUKey)`
- `theme-preview` store `apply("blue")` 后 `document.documentElement.dataset.themePreview === "blue"` 且 localStorage 持久化

### 7.2 视觉冒烟（人工）

- 打开 `/v6-preview` — 看到左栏 + 中区留白 + 右侧默认无抽屉
- 点"去中心化社交" — 右侧 drawer 滑入，toast 提示
- 切主题 "blue" — 整页 CSS 变量生效，刷新仍然是 blue

### 7.3 回归

- `/v2` 不变 — 运行一次 `tests/unit/renderer/shell/*.test.ts` 全绿
- `/` 旧 dashboard 不变 — Electron 启动正常

## 8. 风险

| 风险 | 缓解 |
|---|---|
| Ant Design 默认样式太重，很难彻底"留白化" | 只在 `.v6-preview` 范围用 `:deep(.ant-*) { ... }` 覆盖；不污染全局 |
| 4 颗固化入口的目标页还在旧路由，点进去视觉跳跃 | P7 只连 handler 到 toast；P8 再连到真实抽屉内容 |
| 主题切换与 P5 `theme-applier.ts` 冲突 | `shell-preview/themes.css` 用独立前缀 `--cc-preview-*` + 仅在 `data-theme-preview` 选择器下生效 |
| 会话历史拉取慢 | 首屏只拉最近 30 条；滚动加载更多 |

## 9. 交付清单

**代码**

- `src/renderer/shell-preview/AppShellPreview.vue`
- `src/renderer/shell-preview/ConversationList.vue`
- `src/renderer/shell-preview/DecentralEntries.vue`
- `src/renderer/shell-preview/ArtifactDrawer.vue`
- `src/renderer/shell-preview/themes.css`
- `src/renderer/stores/theme-preview.ts`
- `src/renderer/router/index.ts`（追加 `/v6-preview` 路由）

**测试**

- `tests/unit/renderer/shell-preview/ConversationList.test.ts`
- `tests/unit/renderer/shell-preview/DecentralEntries.test.ts`
- `tests/unit/renderer/shell-preview/theme-preview.test.ts`

**文档**

- `docs/design/桌面版UI重构_设计文档.md` §8 P7 行 + §8.1 映射表
- `docs/design/modules/97_桌面版UI_ClaudeDesktop重构计划.md`（本文件）
- `docs-site/docs/guide/desktop-v6-shell.md` 追加 "预览路由 `/v6-preview`" 段

## 10. 与后续阶段的衔接

- **P8（预留）**：把 4 颗固化入口的 handler 从 toast 升级到真实 Artifact 渲染（接到 `p2p` / `wallet` / `social-manager` / `ukey` 主进程）
- **P9（预留）**：把 97 旧页按 "个人办公 / 去中心化 / 企业" 三组归并或删除
- **P10（预留）**：主路由从 `/` 切到 `/v6-preview`，正式发 v6.0
