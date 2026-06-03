# ClaudeBox 学习 · 工具卡 + TodoWrite 面板落地方案

> 作用域：`desktop-app-vue` V6 preview shell（`/v6-preview`）
> 参考对象：ClaudeBox（截图来源：`C:/Users/longfa/Documents/xwechat_files/wxid_bn30f955o7c522_9640/temp/RWTemp/2026-04/9e20f478899dc29eb19741386f9343c8/457f9910c4788344f475f796114191ac.jpg`）
> 目标版本：v5.0.2.43
> 起草日期：2026-04-22

---

## 0. 背景与关键发现

对比 ClaudeBox 截图与当前 `shell-preview/` 目录，发现数据模型 **已经** 在 `desktop-app-vue/src/renderer/stores/conversation-preview.ts` 中就位：

- `PreviewActionItem`（`done | running | pending`）= 工具调用卡
- `PreviewTaskStep` = TodoWrite 进度项
- `runtimeStatus.progress` = composer 左侧 6% 指示
- `files` = 右侧文件树
- `promptLabel` = 主区顶部 user 气泡里那条 `/dm-dashboard ...`

`seedConversations()` 内的 `demoConversation` 就是 **按这张截图反推的种子**：`List current directory` / `TodoWrite` / `Create test project directory structure` / `Write .../test/package.json` / `Tasks 1/5`，甚至 `progress = 6` 都对上了。

**问题在 `AppShellPreview.vue` 没渲染这些字段**，只渲染了 `messages`。因此本方案 **只改视图层**，不改 store、不改 bridge。

---

## 1. 范围与非目标

### 做

- 新增 `ToolInvocationCard.vue`，把已有的 `actionItems` 渲染为 Claude Code 风格的内嵌卡片
- 新增 `TaskProgressPanel.vue`，把已有的 `taskSteps` 渲染为 composer 上方的可折叠进度面板
- 回显 `promptLabel` 为主区的首条 user 气泡（当消息列表里还没有 user 消息时）
- 对前两个新组件补单元测试

### 不做（留到后续 commit）

- 不改 store schema
- 不动 `llm-preview-bridge`，不做真实 stream 的 `tool_use` block 解析
- 不加 `kind` 字段到 `PreviewActionItem`（先用 label 前缀推断图标）
- 不做项目轨（ProjectRail）、右抽屉文件树、composer chip 栏、状态栏 —— 都不在本落地范围

---

## 2. 新增组件

### 2.1 `shell-preview/components/ToolInvocationCard.vue`（~90 行）

```ts
// Props
interface Props {
  item: PreviewActionItem // { id, label, detail?, status }
}
// 无 emits（点击展开详情放到后续）
```

视觉要点（对齐截图）：

- 圆角 8px / 1px 边框 `--cc-preview-border-color` / 背景 `--cc-preview-bg-elevated`
- 左侧 chevron `>` + kind icon（按 label 前缀推断，见下方映射表）
- 中间 label 单行 `text-overflow: ellipsis`
- 右侧 meta chip（从 `detail` 抽取 `/\d+ lines?/`，抽不到则渲染 `detail` 原文）
- 最右状态 icon：`done → 绿 ✓` / `running → 橙色 spinner` / `pending → 灰空心圆`
- 高度 32px，卡间距 8px

**label → icon 推断（组件内部工具函数）**：

| 前缀正则 | 图标 | 示例 |
|---|---|---|
| `/^TodoWrite\b/i` | ☑ | `TodoWrite` |
| `/^Write\b/i` | 📝 | `Write .../test/package.json` |
| `/^Edit\b/i` | ✏ | `Edit src/foo.ts` |
| `/^Read\b/i` | 📖 | `Read README.md` |
| `/^Bash\b\|^List\b/i` | `>_` | `List current directory` |
| 默认 | `>_` | — |

### 2.2 `shell-preview/components/TaskProgressPanel.vue`（~120 行）

```ts
interface Props {
  steps: PreviewTaskStep[]
  collapsed?: boolean // 默认 false
}
interface Emits {
  (e: 'update:collapsed', v: boolean): void
}
```

视觉要点：

- 折叠头：`▼ Tasks {done}/{total}` + 水平进度条（宽 120px，高 4px，填充色 `--cc-preview-accent`）
- 展开项：
  - `done` → 绿 ✓ + 删除线 + `--cc-preview-text-secondary` 文字
  - `running` → 橙色 ○（`#f59e0b`）+ 加粗橙色文字
  - `pending` → 灰空心圆 + `--cc-preview-text-secondary`
- `detail` 次级字号（12px）灰色挂在每项下
- 背景 `--cc-preview-bg-base`，上分隔线 `--cc-preview-border-subtle`
- `max-height: 200px; overflow-y: auto`

进度计算：

```ts
const done = computed(() => props.steps.filter(s => s.status === 'done').length)
const total = computed(() => props.steps.length)
const percent = computed(() => (total.value ? (done.value / total.value) * 100 : 0))
```

---

## 3. `AppShellPreview.vue` 改动点

### 3.1 在 `<section class="cc-preview-shell__stream">` 内，`cc-preview-bubbles` 之后追加工具卡组

```vue
<div
  v-if="activeConversation?.actionItems?.length"
  class="cc-preview-shell__actions"
>
  <ToolInvocationCard
    v-for="item in activeConversation.actionItems"
    :key="item.id"
    :item="item"
  />
</div>
```

> 顺序权衡：先消息气泡、再所有工具卡 —— 信息密度足够，实现最简。真实 stream 接入后再按时间戳交错（属于 commit B 的事）。

### 3.2 在 `<footer class="cc-preview-shell__composer">` **之前** 插入任务面板

```vue
<TaskProgressPanel
  v-if="activeConversation?.taskSteps?.length"
  :steps="activeConversation.taskSteps"
  v-model:collapsed="tasksCollapsed"
/>
```

新增 ref：`const tasksCollapsed = ref(false)`

### 3.3 `cc-preview-bubbles` 最前面回显 promptLabel

```vue
<div
  v-if="activeConversation.promptLabel && !hasUserMessage"
  class="cc-preview-bubble cc-preview-bubble--user"
>
  <div class="cc-preview-bubble__body">{{ activeConversation.promptLabel }}</div>
</div>
```

`hasUserMessage` = `messages.some(m => m.role === 'user')`（避免与真实 user 消息重复）。

### 3.4 顺手修 stream 左右 padding

当前 `.cc-preview-shell__stream { padding: 24px 20%; }` 把内容宽度压到 60%，卡片会很挤。
改为 `padding: 24px; max-width: 820px; margin: 0 auto` 或 `padding: 24px 48px` —— 二选一，视觉跟截图更接近。

---

## 4. 测试

### 4.1 `shell-preview/components/__tests__/ToolInvocationCard.test.ts`（~50 行）

- 三状态（done/running/pending）各自挂上对应 class
- label 前缀映射到正确 icon：`TodoWrite` → ☑、`Write` → 📝、`Read` → 📖、默认 → `>_`
- `detail` 匹配 `/\d+ lines?/` 时显示 meta chip，否则显示 detail 原文
- label 过长时触发 ellipsis（容器有 `text-overflow: ellipsis` 样式即可，不对渲染文本断言）

### 4.2 `shell-preview/components/__tests__/TaskProgressPanel.test.ts`（~60 行）

- `done=2, total=7` 时进度条 width ≈ 28.6%
- `collapsed=true` 时只渲染折叠头，不渲染列表
- 点击折叠头 emit `update:collapsed`
- `done` 项目有删除线 class、`running` 项目有 active class
- 空 steps 数组时组件 **不** 渲染（靠外层 v-if 守护 + 组件内再兜底）

### 4.3 AppShellPreview 不新增快照

现有 store 测试 + bridge 测试覆盖行为层。如果今后 `@vue/test-utils` 已在依赖里可以加 smoke：切换到 `demo04` 后，DOM 里至少 1 个 `ToolInvocationCard` + 1 个 `TaskProgressPanel`。本轮不加。

---

## 5. 验证步骤

```bash
cd desktop-app-vue
npx vitest run src/renderer/shell-preview/components/__tests__/
npx vitest run src/renderer/stores/__tests__/conversation-preview.test.ts
npm run dev
# 浏览 /v6-preview，默认会话 demo04 应显示：
#   - 1 条 user 气泡（/dm-dashboard ...）
#   - 1 条 assistant 气泡（"先看看当前目录状况"）
#   - 4 个工具卡（List / TodoWrite / Create test project / Write package.json ...）
#   - 底部 Tasks 1/5 面板
```

---

## 6. 风险与权衡

1. **数据是静态 seed，不是真实 stream**。本 commit 只验证视觉和组件 API；真实接入需在 `llm-preview-bridge` 从 queryStream 结果拆 tool_use block，再写入 `actionItems`/`taskSteps`，归属 commit B。
2. **label → icon 字符串推断**是妥协，后续应在 `PreviewActionItem` 加 `kind` 字段。本轮加会连带改 store normalize + 种子 + 现有单测，范围会溢出。
3. **现有 `conversation-preview.test.ts` 的某些断言可能已与 store 脱节**（测试期望 1 条种子 + title `欢迎使用 v6 预览`，但 store 现在 seed 3 条）。本方案执行前先 `npx vitest run conversation-preview.test.ts`，若是红的 **先反馈再决定**，不擅自动手修。
4. **滚动区 padding 调整** 从 `20%` 改成 `24px` 会影响所有 preview 主题 —— 若有主题外观被这个比例撑着的，需要一并确认（实测 4 个主题都是纯 token，问题不大）。

---

## 7. 产出物

| 文件 | 类型 | 预估行数 |
|---|---|---|
| `shell-preview/components/ToolInvocationCard.vue` | 新增 | ~90 |
| `shell-preview/components/TaskProgressPanel.vue` | 新增 | ~120 |
| `shell-preview/components/__tests__/ToolInvocationCard.test.ts` | 新增 | ~50 |
| `shell-preview/components/__tests__/TaskProgressPanel.test.ts` | 新增 | ~60 |
| `shell-preview/AppShellPreview.vue` | 修改 | +25 / −2 |

**建议 commit 信息**：
`feat(desktop-preview): render tool invocation cards and task progress panel`

---

## 8. 后续路线（非本轮范围，仅作上下文）

- **commit B** — 让 `llm-preview-bridge` 把真实 stream 的 `tool_use` block 投喂到 `actionItems`/`taskSteps`
- **commit C** — 给 `PreviewActionItem` 加 `kind` 字段，组件切到读 kind
- **commit D** — 项目轨（`ProjectRail.vue`）+ `ShellProject` 维度
- **commit E** — 右抽屉并列 tab：文件树 + artifact 预览
- **commit F** — composer chip 栏（progress / model / skills / tools / terminal）
