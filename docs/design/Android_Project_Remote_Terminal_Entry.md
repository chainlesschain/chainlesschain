# Android 项目管理 — 远程终端入口 + 项目文件操作 + Git 感知（Project ↔ PC Bridge）

> **状态**：设计完成，impl 未启（2026-05-17 起草，v2 扩展文件 + Git 感知）
>
> **依赖**：(1) Phase 3d desktop ↔ Android v1.1 双向 sync 已落（memory `phase_3d_mobile_sync_landing.md`）；(2) Android Plan A.1 远程终端 WebRTC DC + xterm.js 已落地真机验证（commit `c47cbc649` Xiaomi 24115RA8EC）；(3) `terminal.create(cwd=)` 协议已支持（`TerminalRpcClient.kt:202,210`）；(4) `ProjectEntity.rootPath` 字段已存在（`core-database`）；(5) **`FileCommands.kt` 1116 LOC 已提供 upload/download/listDirectory 全套 method**（memory `android_remote_file_skill_traps.md` 已收口）；(6) `FileTransferScreen.kt` 1129 LOC 既有 UI 可复用
>
> **对齐版本**：v5.0.3.58 (Android in-app auto-update 已收口) → 目标版本 v5.0.3.59 或 v5.0.4.x
>
> **关联文档**：`Android_Remote_Terminal_Plan_A1.md`（终端基座）、`Android_重新定位_设计文档.md`（Android 端整体定位）、`phase_3d_mobile_sync_landing.md`（sync 协议）；用户洞察：手机端缺 CLI 必须借 PC 完成任务，项目管理是天然锚点
>
> **影响模块**：`core-database` (entity migration) / `feature-project` (sync + UI + VM) / `app/remote/terminal` (cwd hand-off) / `app/navigation` (新路由)

---

## 1. 背景

### 1.1 三个观察驱动这个设计

**观察 1：项目管理模块投资和真实使用错位**
`feature-project/` 78 个 Kotlin 文件 ~30,680 行主代码，但其中 `FileEditorScreen` (671) / `GitStatusDialog` (570) / `GitHistoryScreen` (459) / `EnhancedCodeEditor` + `SyntaxHighlightedEditor` + `CodeCompletionEngine` 共 ~3,000 行 "手机 IDE 子集"，在 V2 对话式 UX (`ProjectDetailScreenV2.kt` 836) 下进不到。App 实际 wire 的是 `app/.../presentation/screens/` 下另起一套（详见现状分析）。

**观察 2：Android 端缺 CLI 是结构性的**
桌面有 `cc` CLI（144 commands），Android 端没有，也不该有 —— `cc` 依赖 Node.js / Electron / Ollama / Qdrant / Postgres，移动端跑不动。但用户在外面想做 `git rebase` / `npm install` / `cc skill` / `cc workflow run` 类工作时，没有出口。

**观察 3：基础设施全齐**
- `ProjectEntity.rootPath` 字段已存在（sync 协议字段 `root_path` 镜像）
- Phase 3d sync v1.1 双向同步 PC ↔ Android 项目元数据（含 rootPath）
- `TerminalRpcClient.create(cwd: String?)` 本来就接受 cwd 参数（`terminal/TerminalRpcClient.kt:202,210`）
- `RemoteDesktopScreen` 真机 E2E 已通

**所以这不是新造，是接通**：项目记 "来源 PC peerId" + 详情页加按钮调 `terminal.create(cwd = project.pcRootPath, mobileDid = sourcePeerId)`。

### 1.2 核心场景闭环（v2 明确）

**主轴 = 双向文件流转，git 选配不堵塞：**

```
1. PC 终端跑 `cc workflow run xxx` / `npm install` / 任意 CLI 任务
   → 文件改变（生成 / 修改 / 删除）
   → 手机端 ProjectDetailScreenV2 显示 "可拉新文件" 提示
   → 用户 tap → 自动 incremental sync 拉回手机 → 本地可浏览/备份
   
2. 手机端编辑了某个文件（笔记、配置）
   → 用户 tap "推送到 PC" → 增量 upload
   → PC 端项目目录看到改动
   
3. 项目目录恰好是 git 仓库 → chip 显 "main · 3 changed" 让用户知道有未提交改动
   不是 git 仓库 → chip 不显 → 完全不影响 1 和 2 的流转
```

**关键原则**：git **只是状态指示**，不是 sync 通道。**P2P 双向 sync 是底层 truth**，git chip 只是给重度 git 用户的额外信号，**永远不堵塞** 非 git 用户的核心路径。

### 1.3 这个设计把项目管理升级成 "工作集中枢"

| 当前 | 期望 |
|---|---|
| 项目 = 手机本地 Room DB 孤岛 | 项目 = 跨 PC + 手机的工作集锚点 |
| 浏览本地 cache → 不能做事 | 浏览本地 cache + 一键跳 PC 终端去做 |
| AI chat 不知道项目是哪台 PC 的 | AI chat 可感知 PC peerId，可建议跳终端 |
| Editor/Git/CodeCompletion 暗码 ~3k 行 | 这套可以 deprecate，去 PC 上做 |

---

## 2. 目标 & 非目标

### 2.1 目标 (in scope)

| # | 项 | 验收 |
|---|---|---|
| G1 | `ProjectEntity` 增加 `sourcePeerId` + `pcRootPath` 字段 | Room AutoMigration 升级版本号；既有项目 nullable 兼容；DAO 查询通过 |
| G2 | Sync 协议双向 carry `source_peer_id` + `pc_root_path` | `ProjectSyncWalker` 写 / `ProjectSyncApplierImpl` 读 roundtrip 单测过；桌面端 walker 对称改 |
| G3 | `ProjectDetailScreenV2` 顶栏增加 "终端" 按钮（三态显隐） | LOCAL 隐藏 / FROM_PC + online 高亮 / FROM_PC + offline 置灰 |
| G4 | 点击 "终端" 跳 `RemoteDesktopScreen` 携带 cwd + peerId | xterm.js 启动后 `pwd` 输出 = `project.pcRootPath` |
| G5 | `RemoteDesktopScreen` 支持 cwd 初始参数 | 启动时调 `terminal.create(cwd=...)` 而非 default home |
| G6 | 离线态有清晰反馈 | 按钮置灰 + 文案 "PC 不在线"；点击不崩 |
| G7 | 单测 ≥ 15 (entity migration / sync roundtrip / VM button-state / navigation) | 已有测试套件 green |
| G8 | 真机 E2E：桌面建项目 → sync 到 Android → 点终端 → pwd 验证 cwd | reproducer 见 §8.3 |
| G9 | **项目 detail 增加 "上传文件" 入口** —— 手机本地 → 当前项目 PC 目录 | tap 入口 → SAF picker → 进度条 → PC 上看到该文件 |
| G10 | **项目 detail 增加 "下载文件" 入口** —— PC 项目目录 → 手机 Downloads | tap 入口 → 项目内文件列表 → 选文件 → MediaStore.Downloads 收到 |
| G11 | **项目 detail 显示 "上次同步" 状态 chip** —— sync 元数据时间 | chip 显示 "PC 同步: 2 分钟前"；点击触发 incremental pull |
| G12 | **Git 感知（仅显示，不写入，可选不堵塞）** —— 项目根为 git 仓库时 detail 显 `git status` 摘要 chip | chip 显 "main · 3 changed"；点击展开列表；按钮 "在终端打开" 跳终端预填 `git status`；**非 git 项目不影响任何其它功能** |
| G13 | **PC 端文件改动自动 detect** —— **桌面 file watcher debounce 5s 周期 emit**（与 terminal session lifecycle 解耦），long-running build 期间 Android 也能实时看到改动；非 build 场景 session 结束自然不再有新事件 | 桌面 file watcher → debounce 5s → emit `project.filesChanged` event 含 path 列表 → Android detail 页显 banner 含 "立即同步" / "稍后" 按钮；session 结束**不**额外触发（避免与 watcher 重复） |
| G14 | **手机端 → PC 推送** —— 用户在手机编辑/导入文件后 tap "推送到 PC" → 增量上传至项目根 | 上传完成 PC 项目目录可见；冲突时（同 path 桌面更新）走 last-write-wins + 显冲突提示 |
| G15 | **RemoteProjectBrowser — Android 主动从 PC 选择性拉项目** (Sub-phase 10) | Android `ProjectScreen` 入口 → 列 PC 项目 → tap 拉取 → 元数据 + 文件落本地 |
| G16 | **PC web-shell placeholder 入口** (Sub-phase 10 — v0.1 仅占位) | web-panel "远程项目" 菜单标 "(v0.2)"，v0.2 落 PC→Android 反向真功能 |

### 2.2 非目标 (defer)

- **项目 scope 内终端历史持久化** —— 用 `RemoteDesktopScreen` 现有 session 模型；离开 detail 页后 session 不保留（v0.2 加 "返回继续上次"）
- **项目内多 PC 切换** —— v0.1 假设 1 项目 = 1 PC 来源；用户配多 PC 时按 sourcePeerId 路由，不弹设备选择
- **手机端跑 `cc` 子集** —— 明确不做，借 PC 即可
- **终端命令模板/预设** —— v0.2 ("快捷命令" sheet：cc workflow run / git status / npm test 等一键插入)
- **跨设备 terminal session resume** —— PC 上跑了 30 分钟的 build，切手机继续看 stdout v0.3
- **Project ↔ Terminal 双向唤起** —— 终端里 `cd` 出项目目录后回跳 detail 是反 UX，不做
- **本地 SAF 项目接 Termux 终端** —— LOCAL 类项目按钮直接隐藏，不引入 Termux 依赖
- **Git 作为项目 sync 传输** ❌ —— 明确否决（详见 OQ-6）。**不**引入 JGit 依赖、**不**让 git 替代 Phase 3d P2P sync、**不**做 Android 端 commit/push/pull/merge。Android 端 Git 角色仅限"读 PC 端 git 状态 + 跳终端给 PC 跑命令"
- **Android 端 git 写操作** —— 任何会改 PC repo 状态的 git 命令（commit/push/pull/rebase/merge）都在 PC 终端跑，Android UI 不暴露按钮
- **多 git remote 管理** —— 不做，全部交给 PC 用户用桌面/IDE 处理
- **顶层独立 "Files" tab** —— 用户提的"Android 和 PC 都加文件功能"，决策：**已存在的入口足够**（Android `feature-file-browser/` 已是顶层模块；PC V5/V6 已有 FileBrowser）。本设计**不**新建顶层 Files tab，**复用既有**作 deep-link 目标。新建顶层 Files 留 v0.3 后单独 design doc 评估

---

## 3. Open Questions

### OQ-1：按钮入口位置

**A**：`ProjectDetailScreenV2` 顶栏 TopBar 右侧 icon（与 folder icon 并列），terminal icon
**B**：`ProjectScreen` 列表项右侧添加 quick action chip "终端"，从列表直接跳
**C**：双入口（A + B）

**推荐 A**。理由：(1) 顶栏空间足够（现仅 folder icon），terminal 是 detail scope 操作，列表层暴露过早；(2) 列表 quick action 增加列表渲染负担 + 多状态 chip 视觉噪音；(3) 用户进入 detail 后浏览文件 → 决定 "我要做事" → 跳终端，是更自然的 user journey；(4) v0.2 加 "快捷命令" sheet 时入口仍是 detail，B 提前 commit 会增加返工。

### OQ-2：cwd 字段双语义解决方式

**A**：`rootPath` 字段保留双语义（SAF URI 或 PC path），加 `source` 枚举字段区分
**B**：`rootPath` 拆 `safRootUri` + `pcRootPath` 两个字段
**C**：`rootPath` 留作 SAF（本地），新加独立 `pcRootPath` 字段

**推荐 C**。理由：(1) 既有 sync 协议 `root_path` 一直在 PC ↔ 桌面 间传 PC 路径，不变；(2) Android 端 SAF tree URI 写到 `rootPath` 是 Android 独有的（commit `#21 P4`），不污染 sync 协议；(3) 加 `pcRootPath` 字段 nullable，sync applier 从 `root_path` 写入它，本地新建项目不写；(4) `source` 枚举可由 `pcRootPath != null ? FROM_PC : LOCAL` 推导，不必单独存。

### OQ-3：sourcePeerId 来源

**A**：sync 协议加 `source_peer_id` 字段，桌面端 walker 写自己的 peerId
**B**：Android 端 sync applier 收到项目时记录 "当前连接的 PC peerId" 作 source
**C**：用户在 Android 端手动选 "项目来源 PC"

**推荐 A**。理由：(1) Source of truth 在桌面端 —— 桌面 walker 知道自己的 peerId 最权威；(2) B 在多 PC 场景下错位：用户同步项目 A 是从 PC1 拉的，但当时连的是 PC2 → source 错记 PC2；(3) C UX 累赘，用户应该零感知；(4) Phase 3d sync envelope schema 已有 extension 点，加字段成本低。

### OQ-4：FROM_PC 但 PC 离线时按钮行为

**A**：置灰按钮 + tooltip "PC 不在线"
**B**：可点击 → 进 RemoteDesktopScreen 但显 "等待 PC 上线" loading 态
**C**：隐藏按钮

**推荐 A**。理由：(1) 用户期望看到按钮存在（功能可发现性），但不要让他点了空转；(2) B 的 "等待" 态在移动场景下意义不大 —— 用户不会一直挂着等 PC，UX 噪音；(3) C 隐藏会让用户以为功能丢了；(4) 置灰 + 文案是 Android Material Design 标准模式，与 `RemoteConnectionManager` online state 流即时绑定。

### OQ-5：终端 session 是否归属项目

**A**：每次进入新建 session，离开 detail 关闭
**B**：项目级 persistent session（detail 进出之间 session 保留）
**C**：全局 session pool，按 (peerId, cwd) hash 复用

**推荐 A**。理由：(1) v0.1 lean —— session 持久化引入 lifecycle 复杂度（detail → list → other tab → 回 detail 是否复用？）；(2) PC 端 PTY 资源不浪费 —— 一个 session = 一个 bash/zsh 进程，用户跑完命令应该主动关；(3) B 在多项目频繁切换场景下 session 累积，PC 端资源压力；(4) v0.2 加 "保留 session" toggle 时按 C 升级（按 sessionId 复用，无 toggle 走 A）。

### OQ-6：Git 作为项目 sync 机制？

**A**：Git 作为**项目 sync 传输**替代 Phase 3d P2P sync —— 项目本身是 git repo，phone clone 一份；改动通过 git push/pull 流转
**B**：保留 Phase 3d P2P 作 metadata sync；项目若 IS git repo，UI 显示 git 状态 chip + 跳终端跑命令（git 不进 Android）
**C**：双轨 —— P2P sync metadata + 用户可选 "用 git 同步代码"（双开关）
**D**：完全不引入 git 感知

**推荐 B**。理由：

1. **不是所有项目都是 git 项目**。`ProjectEntity.type` 枚举里 DOCUMENT / DATA / DESIGN / RESEARCH / OTHER 占大头，git 对这些场景反而是负担。
2. **JGit 在 Android 上是地雷**。~3MB JAR、需要文件系统直读权限、大 repo (>500MB) 性能不可接受、SSH key/PAT 在 Android 上 secure storage 复杂。memory `android_native_vendor_strategy.md` 已踩过 native lib vendoring 的 Windows schannel 雷，再叠 JGit 风险倍增。
3. **冲突解决在手机上是反 UX**。git merge conflict 三栏对比在 5.5 寸屏不可用；用户最终会"切回 PC 解"，相当于完整 git 客户端被"半天劝退"。
4. **Phase 3d P2P sync 是正确架构**。memory 已验证 v1.1 desktop ↔ Android 双向 sync，覆盖 metadata + 文件清单。文件内容传输走 `FileCommands` upload/download chunked 通道更细粒度，比 git pack 更适合移动网络。
5. **既有 `GitManager.kt` 637 LOC 是暗码**（feature-project Editor/Git/Completion 群组的一部分，未 wire 到 V2 UX）。把它升格成核心 sync 机制要重新设计 + 全套测试，工作量与"砍掉"完全不对等。
6. **方案 B 给 git 项目正确的位置**：项目根为 git 仓库时，detail 显 chip `main · 3 changed`（只读，调 PC 端 `git status --porcelain` 拿回结果）；用户想 commit/push 直接跳终端，PC 上原生 git CLI 一应俱全。

**显式决策**：本文档**否决** A / C / D，**采纳 B**。下文 G12 + Sub-phase 8 都按 B 设计。

### OQ-7：文件上传/下载 UI 复用 vs 新建

**A**：项目 detail 新建 `ProjectFileTransferScreen` —— 项目 scope 专用 UI
**B**：复用 `app/remote/ui/file/FileTransferScreen.kt` 1129 LOC —— 项目 detail 跳转时 deep-link 携带 `initialRemotePath = project.pcRootPath`，UI 自动锁定该目录
**C**：双轨 —— 项目内做轻量 widget (传/下进度 inline)，深度操作跳 FileTransferScreen

**推荐 B**。理由：(1) `FileTransferScreen` 1129 LOC 是 v5.0.3.x 已收口的生产级 UI，含 chunked transfer / pause/resume / 进度条 / 失败重试，重写一遍是浪费；(2) deep-link 模式与 Sub-phase 5 终端 cwd hand-off 同模式一致，技术栈复用；(3) FileTransferScreen 既有 `RemoteCommandClient.invoke` 池与本设计的 sourcePeerId 路由天然兼容 —— 只需新加 `initialRemotePath` 参数 + 进入时锁定该路径；(4) 后续 v0.2 加 "项目文件浏览器" 时可继续在 FileTransferScreen 上加分屏，不必改架构。

---

## 4. 架构

### 4.1 数据模型 diff

**`ProjectEntity` (core-database)**

```kotlin
@Entity(tableName = "projects")
data class ProjectEntity(
    @PrimaryKey val id: String,
    val name: String,
    val description: String? = null,
    val type: String = ProjectType.OTHER,
    val status: String = ProjectStatus.ACTIVE,
    val userId: String,
    val rootPath: String? = null,             // 既有：SAF tree URI (本地) 或 legacy 字段
    // ... 既有字段
    
    // NEW (Phase v0.1)
    val pcRootPath: String? = null,           // PC 文件系统路径，FROM_PC 项目才有
    val sourcePeerId: String? = null,         // 同步来源 PC peerId
    val lastTerminalCwd: String? = null,      // v0.2: 上次终端最终 cwd（用户可能 cd 出去）—— v0.1 仅占位
)
```

**衍生：**
```kotlin
enum class ProjectSource { LOCAL, FROM_PC }

val ProjectEntity.source: ProjectSource
    get() = if (pcRootPath != null && sourcePeerId != null) ProjectSource.FROM_PC else ProjectSource.LOCAL
```

**Room AutoMigration**：版本号 +1，3 个 nullable column 加 `ALTER TABLE` 自动应用，老项目字段全 null = LOCAL（兼容）。

### 4.2 Sync 协议 diff

**桌面 `ProjectSyncWalker` 写入**（参考 `ProjectSyncWalker.kt:110` 既有 root_path）：
```js
{
  id, name, ..., root_path,
  source_peer_id: P2P.localPeerId(),   // NEW: 桌面端自填
  pc_root_path: project.rootPath,      // NEW: 同 root_path 在桌面侧
}
```

**Android `ProjectSyncApplierImpl` 读入**（参考 `ProjectSyncApplierImpl.kt:117`）：
```kotlin
val sourcePeerId = obj.stringOrNull("source_peer_id") ?: existing?.sourcePeerId
val pcRootPath = obj.stringOrNull("pc_root_path") ?: obj.stringOrNull("root_path") ?: existing?.pcRootPath
// rootPath 字段保持现有逻辑（SAF URI 兜底），不写 pc_root_path
ProjectEntity(
    ...,
    rootPath = rootPath,           // 既有 SAF URI 路径（如果 Android 端有）
    pcRootPath = pcRootPath,       // NEW: PC 路径
    sourcePeerId = sourcePeerId,   // NEW
)
```

**Android → 桌面方向**：Android 端 walker 不写 `source_peer_id` / `pc_root_path`（Android 没这两个值），桌面 applier 收到时保留桌面自己原值 —— 这条单向也要在 applier 单测 cover。

### 4.3 UI 数据流

```
ProjectDetailScreenV2 (open)
  → ProjectViewModel.loadProjectDetail(projectId)
    → ProjectRepository.getProject(projectId)
      → ProjectDao → ProjectEntity
    ← projectDetailState = Success(project)
  → 派生 source = if(pcRootPath != null) FROM_PC else LOCAL
  → 派生 isOnline = RemoteConnectionManager.connectedPeers[sourcePeerId]?.online ?: false
  → TopBar terminal button:
    - source == LOCAL → 隐藏
    - source == FROM_PC && !isOnline → 置灰
    - source == FROM_PC && isOnline → 高亮

User tap "终端" button
  → navController.navigate(Screen.RemoteDesktop.createRoute(
      peerId = project.sourcePeerId!!,
      cwd = project.pcRootPath!!  // URL-encoded
    ))
  → RemoteDesktopScreen launch with args
    → RemoteDesktopViewModel.openTerminal(peerId, cwd)
      → TerminalRpcClient.create(pcPeerId = peerId, cwd = cwd)
        → DC fast path or signaling fallback (既有)
          → 桌面端 terminal handler spawn PTY at cwd
            → returns sessionId
      → xterm.js attach session
        → user 输入 `pwd` → stdout = "/Users/x/projects/foo"
```

### 4.4 NavGraph diff

```kotlin
// 新路由（携 cwd 参数）
object Screen {
    // ... 既有
    object RemoteDesktopWithCwd : Screen("remote-desktop/{peerId}/{cwd}") {
        fun createRoute(peerId: String, cwd: String) =
            "remote-desktop/$peerId/${Uri.encode(cwd)}"
    }
}

// NavGraph.kt 加 composable
composable(
    route = Screen.RemoteDesktopWithCwd.route,
    arguments = listOf(
        navArgument("peerId") { type = NavType.StringType },
        navArgument("cwd") { type = NavType.StringType },
    ),
) { backStackEntry ->
    val peerId = backStackEntry.arguments?.getString("peerId") ?: return@composable
    val cwdEncoded = backStackEntry.arguments?.getString("cwd") ?: ""
    val cwd = Uri.decode(cwdEncoded).takeIf { it.isNotBlank() }
    RemoteDesktopScreen(
        initialPeerId = peerId,
        initialCwd = cwd,
        onNavigateBack = { navController.popBackStack() },
    )
}
```

`RemoteDesktopScreen` 既有 signature 没 `initialCwd` —— 加可选参数（默认 null = 当前行为），不破坏既有调用方（`NavGraph.kt:747` 全局远程操控 tab 入口）。

### 4.5 文件 ops 数据流（G9-G10）

#### 4.5.1 上传 (手机 → PC 项目目录)

```
ProjectDetailScreenV2 → tap "上传文件"
  → terminalButtonState.Enabled 为前提（同三态门）
  → SAF picker (ActivityResultContracts.OpenDocument)
    → 用户选手机本地文件 → URI 返回
  → navController.navigate(Screen.FileTransfer.uploadRoute(
      peerId = project.sourcePeerId,
      remotePath = project.pcRootPath,    // 项目根目录作上传目标
      sourceUri = uri.toString()
    ))
  → FileTransferScreen with mode=UPLOAD
    → FileTransferViewModel.startUpload(peerId, remotePath, sourceUri)
      → FileCommands.requestUpload(...) 既有协议
        → chunked upload (既有 chunkSize 默认 256KB)
          → 桌面端 file handler 写入 pcRootPath/<filename>
      → 进度更新 → UI 进度条
```

#### 4.5.2 下载 (PC 项目目录 → 手机 Downloads)

```
ProjectDetailScreenV2 → tap "下载文件"
  → navController.navigate(Screen.FileTransfer.browseRoute(
      peerId = project.sourcePeerId,
      remotePath = project.pcRootPath   // 锁定从项目根浏览
    ))
  → FileTransferScreen with mode=BROWSE
    → FileCommands.listDirectory(path = pcRootPath)
      → 远程目录树渲染（与既有 UI 一致）
    → 用户选文件 → tap 下载
      → FileCommands.requestDownload(...)
        → chunked download
        → 写入 MediaStore.Downloads（memory `android_remote_file_skill_traps.md` 决策）
      → 进度更新 + 完成通知
```

#### 4.5.3 同步状态 chip (G11)

```
ProjectDetailScreenV2 顶部
  → 显示 chip: "PC 同步: <relative time from project.lastSyncedAt>"
  → 三态：
    - lastSyncedAt < 60s: 绿色 "已同步"
    - lastSyncedAt < 1h: 灰色 "X 分钟前"
    - lastSyncedAt > 1h or null: 黄色 "超过 1 小时" + tap → triggerIncrementalSync()
  → triggerIncrementalSync() 调既有 Phase 3d sync engine 拉项目 incremental delta
```

**关键复用**：`FileTransferScreen` (1129 LOC) + `FileCommands` (1116 LOC) + `FileTransferRepository` (497 LOC) 一行未改 —— 仅加 navigation 参数 `mode` + `initialRemotePath` + `initialSourceUri`。

### 4.6 Git 感知架构（G12，OQ-6 决策 B）

#### 4.6.1 数据来源（只读）

**好消息**：`ProjectEntity` 既有字段已含 git 元数据：
```kotlin
val gitEnabled: Boolean = false,
val gitRemoteUrl: String? = null,
val gitBranch: String? = null,
val lastCommitHash: String? = null,
val uncommittedChanges: Int = 0,
```
这 5 个字段当前是暗码（GitManager 没 wire），但 schema 已就位，Sub-phase 8 直接**复用**——桌面端 sync walker 把 simple-git status 结果写进这几个字段，Android 端 chip 从 ProjectEntity 读，无需引入新字段。

桌面端 `mobile-bridge` 添加 method **`git.status(repoPath)`**（独立 cheap RPC，不走 PTY 子进程）：

```js
// 桌面端 mobile-bridge / file handler 加 method
git.status({ repoPath }) → {
  isGitRepo: boolean,         // false 时下面字段全 null
  branch: string | null,      // "main"
  ahead: number,              // ahead origin commits
  behind: number,             // behind origin
  changed: number,            // working tree dirty file count
  staged: number,             // staged file count
  conflicts: number,          // merge conflict 数
  lastCommit: { sha: string, message: string, time: number } | null
}
```

实现 = 桌面端 `simple-git` 包 `status()` 调用，纯 JS lookup，不走 PTY 子进程开销。响应 < 100ms（小 repo）/ 500ms（500+ files repo）。

#### 4.6.2 Android 端调用

```
ProjectDetailScreenV2 加载时
  → terminalButtonState.Enabled 时 fire-and-forget
    → GitCommands.status(peerId, repoPath = project.pcRootPath)
      → commandClient.invoke("git.status", params)
        → 桌面端 simple-git → 返 GitStatus
      → 失败 (isGitRepo=false 或 method 不存在) → silently treat as "非 git 项目"
  → @Published gitStatus: GitStatus? in ProjectViewModel
  → UI:
    - gitStatus == null → 不显 git chip
    - gitStatus.isGitRepo == false → 不显
    - isGitRepo == true → 显 chip: "<branch> · X changed" (若 conflicts > 0 显红色)
      → tap chip → 展开 sheet 显 ahead/behind/staged/lastCommit
      → sheet 底部按钮 "在终端打开" → navController.navigate(RemoteDesktopWithCwd + 预填 "git status")
```

**显式不做**：commit / push / pull / merge / rebase / stash 全部 UI 按钮一律**没有**。用户想动 git，进终端 PC 上跑。chip 是**纯展示** + 跳终端，零 mutation API。

#### 4.6.3 兼容性

- 桌面端 v5.0.3.59 之前的 mobile-bridge 没 `git.status` method → Android 调用收到 method-not-found error → UI silently 不显 chip
- 桌面端有 method 但项目不是 git 仓库 → `isGitRepo: false` → UI silently 不显
- 桌面端 git 命令失败（损坏的 .git 目录）→ 返 `{ error: "..." }` → UI 不显 chip，仅 log

无版本 gate 必要 —— 老版本桌面端只是看不到 chip，零 break。

---

## 5. Module / 文件 placement

```
android-app/
├── core-database/src/main/java/.../entity/
│   └── ProjectEntity.kt                       # MODIFIED: +3 fields
├── core-database/src/main/java/.../migrations/
│   └── Migration_N_to_N+1.kt                  # NEW (or @AutoMigration spec)
├── feature-project/src/main/java/.../
│   ├── data/sync/
│   │   └── ProjectSyncApplierImpl.kt          # MODIFIED: 读 source_peer_id + pc_root_path
│   ├── sync/
│   │   └── ProjectSyncWalker.kt               # MODIFIED: Android → PC 不写新字段（仅文档化）
│   ├── model/
│   │   └── ProjectModels.kt                   # MODIFIED: ProjectWithStats + ProjectSource enum
│   ├── repository/
│   │   └── ProjectRepository.kt               # MODIFIED: getProjectsWithStats 携 source 派生
│   └── viewmodel/
│       └── ProjectViewModel.kt                # MODIFIED: terminalButtonState StateFlow
├── app/src/main/java/.../presentation/screens/
│   └── ProjectDetailScreenV2.kt               # MODIFIED: TopBar 加 terminal IconButton
├── app/src/main/java/.../remote/ui/desktop/
│   ├── RemoteDesktopScreen.kt                 # MODIFIED: initialPeerId + initialCwd 参数
│   └── RemoteDesktopViewModel.kt              # MODIFIED: openTerminalWithCwd(peerId, cwd)
├── app/src/main/java/.../navigation/
│   └── NavGraph.kt                             # MODIFIED: +RemoteDesktopWithCwd + FileTransferWithMode composables
├── app/src/main/java/.../remote/ui/file/
│   └── FileTransferScreen.kt                  # MODIFIED: +mode + initialRemotePath + initialSourceUri 参数
├── app/src/main/java/.../remote/commands/
│   └── GitCommands.kt                          # NEW: 1 method (status), ~80 LOC
└── feature-project/src/main/java/.../model/
    └── GitStatus.kt                            # NEW: Codable model, ~40 LOC

# 桌面端
desktop-app-vue/src/main/sync/
└── ProjectSyncWalker.js (or .ts)              # MODIFIED: 写 source_peer_id + pc_root_path
desktop-app-vue/src/main/mobile-bridge/handlers/
└── git-handler.js                              # NEW: git.status method (simple-git wrapper, ~60 LOC)
```

**零新建模块**。所有改动落在既有模块内；2 个新文件均轻量（< 100 LOC）。

---

## 6. Sub-phases

### 6.0 Sub-phase 0 — 同步协议正向兼容预检（~1h）

**目的**：阻止"新字段把老桌面 applier 整个 payload 拒掉"事故。新增 `source_peer_id` + `pc_root_path` 字段对**老桌面 v5.0.3.58 及更早**必须是 silently-ignored，不能让 Android → 桌面方向的同步因为新字段就报 schema 错误整体 reject。

**Scope**：
- 读 `desktop-app-vue/src/main/sync/ProjectSyncApplier.{js,ts}` —— 验证它处理 unknown JSON fields 时是 `{...known, ...ignored}` 模式还是 strict-schema 模式
- 读对称的 `feature-project/data/sync/ProjectSyncApplierImpl.kt` —— 已知 117 行用 `obj.stringOrNull("...")` 是 forward-compat（key 不存在返 null），不报错；Android applier 已 safe
- **若桌面 applier 是 strict-schema** → 先发 v5.0.3.58.1 hotfix 把 applier 改 lenient（仅 prep release，无功能改动），AllUsers 升级后再发 v5.0.3.59 真功能
- **若桌面 applier 已 lenient** → 跳过 hotfix，直接进 Sub-phase 1

**验收**：
- 跑既有 `ProjectSyncIntegrationTest`（如有），或新加一个 "unknown field tolerance" 测试：构造一份含未来字段的 payload 喂桌面 applier，验证不抛异常 + 已知字段正确写入
- 跑既有 Phase 3d sync E2E 不回归

**单测 target**：≥ 2
- 桌面 applier: 含 unknown field "future_dummy_v99" 的 payload → 不抛 + 已知字段写入
- Android applier: 含 unknown field 的 payload → 同上

**预估时间**：1h（如果桌面 applier 已 lenient）/ 4h（如果需要 hotfix release）

**实际预检结果（2026-05-17 完成）**：
- ✅ Android `ProjectSyncApplierImpl.kt:48` 显式 `Json { ignoreUnknownKeys = true }` —— 完全 lenient
- ✅ 桌面 `mobile-bridge-sync.js:_applyProject` 用 `JSON.parse + 显式按 key 取` —— 未知字段 silently 忽略，**不需要 hotfix release**
- ⚠️ **新发现**：桌面 `projects` 表 schema 缺 `source_peer_id` / `pc_root_path` 列（Sub-phase 2 加 schema migration）
- ⚠️ **新发现**：桌面 `_applyProject` 是 `INSERT OR REPLACE` 全字段覆盖 —— Android 推送不含新字段时**会清掉**桌面已有的 source_peer_id/pc_root_path 值；需在 Sub-phase 2 改成字段级 merge（先 SELECT existing 再合并，或用 SQL UPSERT + COALESCE）

### 6.1 Sub-phase 1 — Entity + Migration (~2h)

**Scope**：
- `ProjectEntity.kt` 增加 3 个 nullable 字段
- `ProjectDao.kt` 既有查询不动（select * 自动 carry 新字段）；增加 `getProjectsBySourcePeer(peerId: String): Flow<List<ProjectEntity>>` 备 v0.2 多 PC 视图用
- Room version bump + `@AutoMigration` spec
- 单测：DAO smoke (insert + read 新字段 roundtrip) + migration test (老 DB schema → 新 schema, 老项目字段全 null)

**单测 target**：≥ 3
- ProjectDaoTest: insert with pcRootPath → read 回 same value
- ProjectDaoTest: insert without pcRootPath → read 回 null
- MigrationTest: v(N) → v(N+1) AutoMigration 不丢数据

### 6.2 Sub-phase 2 — Sync Protocol (~3h)

**Scope**：
- 桌面 `ProjectSyncWalker.js` 写 `source_peer_id` + `pc_root_path`
- Android `ProjectSyncApplierImpl.kt` 读 `source_peer_id` + `pc_root_path`，写入 entity
- Android `ProjectSyncWalker.kt` 文档化：不写新字段（Android 没值）
- 桌面 applier 对称改：收到 Android payload 无 source_peer_id 时保留自己原值
- **PC 端项目删除生命周期**（详见 trap 7.14）：Android applier 收到 `status=DELETED` 的 FROM_PC 项目时**不联级删本地**，而是标 `metadata.orphan=true` JSON 字段 + 保留 pcRootPath（作 audit）；ProjectDetailScreenV2 检测 orphan tag 显 banner "PC 已删除此项目" + 按钮 "本地归档"（status→ARCHIVED）
- 集成测试：双向 sync roundtrip（桌面建项目 → Android 收到含 source_peer_id；Android 改项目名 → 桌面收到 source_peer_id 仍存自己原值；桌面删项目 → Android 标 orphan 不删）

**单测 target**：≥ 5
- ProjectSyncApplierTest: parse source_peer_id ✓
- ProjectSyncApplierTest: parse pc_root_path (fallback to root_path) ✓
- ProjectSyncApplierTest: missing source_peer_id 保留 existing 值
- ProjectSyncWalkerTest (Desktop): writes source_peer_id from P2P.localPeerId()
- ProjectSyncApplierTest: status=DELETED 的 FROM_PC 项目 → 本地 entity status 不变 + metadata.orphan=true 写入

### 6.3 Sub-phase 3 — ProjectViewModel + State (~3h)

**Scope**：
- `ProjectViewModel.kt` 增加 `terminalButtonState: StateFlow<TerminalButtonState>`
  ```kotlin
  sealed class TerminalButtonState {
      object Loading : TerminalButtonState()          // 冷启动 peer 列表未首次枚举完
      object Hidden : TerminalButtonState()           // LOCAL
      object Disabled : TerminalButtonState()         // FROM_PC + offline
      data class Enabled(val peerId: String, val cwd: String) : TerminalButtonState()
  }
  ```
- combine: projectDetailState + RemoteConnectionManager.onlinePeers flow → derive state
- 注入 `RemoteConnectionManager`（既有 Hilt 单例）
- **冷启动 UX**：`RemoteConnectionManager.hasEnumeratedPeers: StateFlow<Boolean>` 在 P2P 首次枚举完成前为 false；此时 terminalButtonState emit Loading，UI 显占位 spinner 而非"按钮闪烁"。Loading → Hidden/Disabled/Enabled 的过渡用 `AnimatedContent` 让首帧不抖。
- **同模式应用**：uploadButtonState / downloadButtonState / gitChipState 全部走相同四态，复用一个 `projectActionsState: ProjectActionsState` sealed wrapper（详见审查 #7，§6.3 末尾合并）

**单测 target**：≥ 6 (用 MockK + Turbine)
- 冷启动 hasEnumeratedPeers=false → Loading
- 枚举完成 hasEnumeratedPeers=true + LOCAL 项目 → Hidden
- FROM_PC + peer offline → Disabled
- FROM_PC + peer online → Enabled(peerId, cwd)
- peer 上线状态变 → 重新 emit Enabled
- pcRootPath 为空字符串 (空路径) → Disabled (防御性)

### 6.4 Sub-phase 4 — ProjectDetailScreenV2 UI (~3h)

**Scope**：
- `ProjectDetailTopBar` 加 terminal IconButton（Icons.Default.Terminal 或自定义 vector）
- 三态绑定 `terminalButtonState`：
  - Hidden → not rendered (条件 composable)
  - Disabled → IconButton enabled=false + tooltip "PC 不在线"
  - Enabled → IconButton enabled=true + onClick → navigate
- 国际化：strings.xml 加 `R.string.project_terminal_offline` "PC 不在线"
- 同步 res/values-zh-rCN

**单测 target**：≥ 3 (UI test with Compose testing)
- Hidden 态 button not in semantics tree
- Disabled 态 button visible but onClick disabled
- Enabled 态 click → navController.navigate called with correct route

### 6.5 Sub-phase 5 — RemoteDesktopScreen cwd hand-off (~2h)

**Scope**：
- `RemoteDesktopScreen` 加 `initialCwd: String? = null` 参数
- `RemoteDesktopViewModel` 启动时若 initialCwd != null → 调 `terminalRpcClient.create(pcPeerId, cwd = initialCwd)`（既有 method 已支持）
- xterm.js 容器载入后 attach 该 session
- 状态条显示 "PC: <peerName> · cwd: <短显示>"（cwd 太长尾部省略）

**单测 target**：≥ 3
- ViewModel openTerminalWithCwd → TerminalRpcClient.create 调用参数 cwd 正确
- initialCwd = null → 调用默认 create (没 cwd)
- create 失败 → state.error 显示

### 6.6 Sub-phase 6 — NavGraph + 终端 E2E + memory + commit (~2h)

**Scope**：
- `NavGraph.kt` 加 RemoteDesktopWithCwd composable
- `Screen.kt` 加 RemoteDesktopWithCwd route
- 真机 E2E §8.3 场景 1-6（终端核心路径）
- memory `~/.claude/projects/.../memory/android_project_remote_terminal_entry.md` 写实施 traps
- commit `feat(mobile): Android 项目管理 → 远程终端入口（cwd hand-off + 三态显隐）`

### 6.7 Sub-phase 7 — 文件上传/下载 deep-link (~4h)

**Scope**：
- `FileTransferScreen.kt` 加可选参数 `mode: FileTransferMode? = null` + `initialRemotePath: String? = null` + `initialSourceUri: String? = null`
- `FileTransferMode` enum：`UPLOAD` / `BROWSE` / `BROWSE_DEFAULT`（保留既有 UX 入口）
- 启动时若 mode != null → 进入指定模式，UI lock 在 initialRemotePath
- `ProjectDetailScreenV2` TopBar 增加两个 icon：上传 (`Icons.Default.CloudUpload`) + 下载/浏览 (`Icons.Default.Folder`)
- 同三态门：LOCAL 隐藏 / FROM_PC offline 置灰 / FROM_PC online 高亮
- 上传按钮 onClick → SAF picker (OpenDocument) → 拿 URI → navigate FileTransferScreen(mode=UPLOAD, ...)
- 下载按钮 onClick → navigate FileTransferScreen(mode=BROWSE, ...)
- `NavGraph.kt` 加 FileTransferWithMode composable，参数 URL-encode
- 上传完成时项目内 lastSyncedAt 不动（这是 PC → Android sync 字段，不被上传影响）；可选 emit `FileUploaded` event 提示 UI 刷新文件 cache

**单测 target**：≥ 4
- FileTransferViewModel: UPLOAD mode + initialSourceUri → requestUpload 调用正确
- FileTransferViewModel: BROWSE mode + initialRemotePath → listDirectory 锁定路径
- ProjectDetailScreenV2 UI test: 上传按钮三态 (Hidden/Disabled/Enabled)
- ProjectDetailScreenV2 UI test: tap 上传 → SAF picker launch (verify via Espresso intent)

### 6.8 Sub-phase 8 — Git 感知 chip (~3h)

**Scope**：
- 桌面端新建 `mobile-bridge/handlers/git-handler.js` —— `git.status({repoPath})` method 用 `simple-git` (既有 dep)
- 桌面端 mobile-bridge router 注册 git.status method
- Android 端 `GitCommands.kt` (`app/remote/commands/`) — 1 method status，~80 LOC
- Android `GitStatus.kt` Codable model (`feature-project/model/`)
- `ProjectViewModel` 增加 `gitStatus: StateFlow<GitStatus?>` —— terminalButtonState.Enabled 后 fire-and-forget 调一次 `git.status`
- `ProjectDetailScreenV2` 增加 git chip composable —— 三态显隐：null → 不显 / isGitRepo=false → 不显 / true → 显 chip
- chip tap → expand sheet 显完整 status + 按钮 "在终端打开 git status"
- sheet "在终端打开" → navController.navigate(RemoteDesktopWithCwd) + 预填命令 (RemoteDesktopScreen 加可选 `prefillCommand` 参数, 默认 null)
- 桌面端单测：git.status 在 git 仓库 / 非 git 仓库 / 损坏 .git 三种 case
- Android 单测：method not found → 不显 chip；返 isGitRepo=false → 不显；返 true → @Published 更新

**单测 target**：≥ 6
- 桌面端 git-handler.test.js × 3 (正常 repo / 非 git 目录 / 损坏 .git)
- Android GitCommandsTest × 1 (parse response)
- ProjectViewModel × 2 (method-not-found silently → gitStatus null / 正常返回 → @Published)

### 6.9 Sub-phase 9 — 完整 E2E + 收口 + 三站文档 + commit (~3h)

**Scope**：
- 真机 E2E §8.3 全部 12 场景跑通
- memory 文件加 4-5 个实施 traps（forward-looking §7 部分实战收口）
- CLAUDE.local.md Recently Completed 加 entry
- CHANGELOG.md + docs-site/docs/changelog.md 同步（参考 memory `release_changelog_inventory.md`）
- docs-website-v2/src/pages/mobile.astro 加一行（结果导向，不讲过程）
- 桌面端 v5.0.3.59 release 流程
- commit `feat(mobile): Android 项目管理 v0.1 — 远程终端入口 + 文件 ops + Git 感知`

### 6.10 Sub-phase 10 — 选择性项目浏览-拉取（选项 C 单向：PC → Android，~8h）

**目的**：补 Phase 3d 全量 auto-sync 之外的"选择性拉单个项目"入口，解决用户两个真痛点：(a) PC 有 50 个项目我只想要 3 个；(b) Phase 3d cursor 推进前的历史项目永远拉不到。

**Scope (v0.1 选项 C — 单向)**：
- ✅ Android 端：从 PC 端浏览 + 拉取选定项目（**v0.1 重点**）
- ⏸ PC 端：反向拉 Android 项目（v0.2 follow-up；v0.1 仅 placeholder UI）

#### 6.10.1 Method 协议

**`project.list`** —— 双向支持，v0.1 仅 Android → PC 实际使用

```typescript
// Request
{
  method: "project.list",
  params: {
    userId: string,            // 必须匹配；不同 userId 拒
    includeFileCount?: boolean,  // 默认 false；true 时 list 慢但带 fileCount/totalSize
    includeAlreadyPulled?: boolean, // 默认 false：Android 调用时桌面端不知道 Android 已有什么，需 Android 端 client-side 去重
    limit?: number,            // 默认 100；上限 500
    offset?: number,           // 默认 0
  }
}

// Response
{
  projects: [
    {
      id: string,
      name: string,
      description: string | null,
      type: string,
      status: string,            // active / completed / archived (不含 deleted)
      rootPath: string,          // PC 文件系统路径
      sourcePeerId: string,      // 该项目所在 PC 的 peerId（= 当前 RPC 端 localPeerId）
      fileCount: number | null,  // includeFileCount=false 时为 null
      totalSize: number | null,
      tags: string | null,       // JSON 字符串
      createdAt: number,
      updatedAt: number,
    },
    ...
  ],
  total: number,                 // 全部数（用于 pagination）
  hasMore: boolean,
}
```

**`project.pullSingle`** —— Android → PC 单项目拉取（v0.1 重点）

```typescript
// Request
{
  method: "project.pullSingle",
  params: {
    projectId: string,
    includeFileList?: boolean,  // 默认 true：返文件清单（不含内容）；false 仅元数据
  }
}

// Response
{
  project: { /* 同 list 单条 + 完整 metadata JSON */ },
  files: [                       // includeFileList=true 时填
    {
      id: string,
      path: string,              // 相对 rootPath
      size: number,
      hash: string | null,       // SHA-256 hex；用于 client 端 dedup
      mimeType: string | null,
      updatedAt: number,
    },
    ...
  ],
}
```

**错误码**：
- `PROJECT_NOT_FOUND` — 项目 ID 不存在或已 deleted
- `PERMISSION_DENIED` — userId 不匹配
- `RATE_LIMITED` — list 调用 > 10/min（防扫库）

#### 6.10.2 桌面端实现

`mobile-bridge` 注册两个新 handler：
- `desktop-app-vue/src/main/sync/mobile-bridge-sync.js` 或 `mobile-bridge.js` 加 `handleProjectList` + `handleProjectPullSingle`
- 复用既有 dbManager 走 SQL；用 v1.3 walker 同款 SELECT，加 limit/offset
- 文件清单走 `project_files` 表（既存）

**双 WS gateway 注册**（关键：memory `feedback_cross_shell_feature_pattern.md`）：
- `desktop-app-vue/src/main/web-server/ws-handlers.js` 注册 `project.list` / `project.pullSingle` 走 desktop 内嵌 WS
- `packages/cli/src/web/ws-handler.js` 同步注册 `cc ui` WS gateway
- 同份 web-panel SPA 在 desktop 和 cc ui 下都能调通

#### 6.10.3 Android 端实现

**新文件**：
```
android-app/app/src/main/java/com/chainlesschain/android/remote/commands/
└── ProjectCommands.kt                  # NEW: list + pullSingle wrapper (~100 LOC)

android-app/feature-project/src/main/java/com/chainlesschain/android/feature/project/
├── ui/
│   └── RemoteProjectBrowserScreen.kt   # NEW: ~250 LOC
├── viewmodel/
│   └── RemoteProjectBrowserViewModel.kt # NEW: ~200 LOC
└── model/
    └── RemoteProjectItem.kt             # NEW: Codable ~30 LOC
```

**UX 流**：
1. `ProjectScreen` 列表 TopBar 加 icon button "浏览 PC 项目"（仅当有 paired PC 在线时显）
2. → tap → `RemoteProjectBrowserScreen`（NavGraph 新 route，可选 `?peerId=` 多 PC 时弹设备选择 sheet）
3. ViewModel 启动调 `commandClient.invoke("project.list", {userId, limit=100})`
4. 列表渲染：项目 row 显 name / type chip / fileCount + size + updatedAt 相对时间
5. 客户端 client-side 去重：`projectDao.getProjectIds().intersect(remoteIds)` → 已存项目显灰色 + "已在本地" badge；未拉项目显蓝色 + "拉取" 按钮
6. tap "拉取" → 调 `project.pullSingle` → 拉到元数据 + 文件清单
7. 本地 applier 走 v1.3 saveFromSync 写 ProjectEntity（source=FROM_PC，sourcePeerId 填）
8. 文件清单进入 download 队列（复用 Sub-phase 7 FileTransferRepository chunked download）
9. Browser 进度 chip 显 "拉取中: X/Y 文件"
10. 完成 toast + 用户可选 "返回项目列表" / "继续浏览"

#### 6.10.4 PC web-shell 端实现（placeholder for v0.1，对称 UI 留位）

**v0.1**：PC web-panel 加 placeholder 入口，**不实际拉项目**（反向拉 v0.2 才做）。理由：
- v0.1 重点是 PC→Android（用户最痛场景）
- PC 端 UI 入口先就位 = 用户看到"未来对称"信号，避免功能不发现
- 实际 `project.list` 接口在 v0.1 已就位，PC 端 web-panel 调对端 Android 时同样能 list — 只是 Android 端 walker 不暴露大量项目（mobile rarely is project source）

**新增/改文件**（web-panel）：
```
web-panel/src/pages/
└── RemoteProjects.vue          # 或 RemoteProjects.html 视既有 SPA 风格 (~150 LOC)
```

**入口接通**：
- web-panel sidebar/menu "远程项目"
- v0.1 只支持反向（手机端拉 PC 项目）→ web-panel 显文案 "请在手机端浏览 PC 项目"（教学性 placeholder）
- v0.2 落 PC→Android 反向后，此页变成"浏览手机项目"实际列表

**WS 调用同上**：通过 `ws.executeJson("project.list", {...})` 调 mobile-bridge handler，但 v0.1 因方向限制返空列表 + reason 提示。

#### 6.10.5 Schema diff

**ProjectEntity 新加 1 字段（可选，简化处理）**：

```kotlin
// 已在 §4.1 Patch 4 提过 metadata.orphan，subscriptionMode 暂不加；
// v0.1 用 metadata JSON 加 "pullMode":"manual" 标记从 Browser 拉来的项目
// metadata: {"pullMode":"manual","pulledAt":<timestamp>}
```

**理由**：v0.1 不引新列，纯靠 metadata JSON 扩展。v0.2 若需要更复杂的 subscription state 再引 `subscriptionMode: String` 列。

#### 6.10.6 单测 target ≥ 8

| 模块 | 测试 | 目标 |
|---|---|---|
| 桌面 mobile-bridge-sync | handleProjectList: limit/offset/total | ≥ 2 |
| 桌面 mobile-bridge-sync | handleProjectPullSingle: file list / not found / permission denied | ≥ 3 |
| Android ProjectCommands | parse list response / parse pullSingle response | ≥ 2 |
| Android RemoteProjectBrowserViewModel | client-side dedup logic | ≥ 1 |

#### 6.10.7 真机 E2E ≥ 5 场景（追加到 §8.3）

| # | 场景 | 验收 |
|---|---|---|
| 20 | Android 进 RemoteProjectBrowserScreen → 显桌面 ≥ 1 项目 | list 调用 < 500ms |
| 21 | 已 Phase 3d 同步过的项目显 "已在本地" 灰色 | client-side dedup 工作 |
| 22 | 未拉项目 tap "拉取" → 元数据落本地 → 项目列表可见 | 跳回项目列表，新项目排在最上 |
| 23 | 拉取过程网络断 → 重连后续传 | FileTransferRepository checkpoint 复用 |
| 24 | userId 不匹配 → list 返 PERMISSION_DENIED | UI 显错误 banner |

#### 6.10.8 关联 Sub-phase 4 / 7

- Sub-phase 4 ProjectDetailScreenV2 终端按钮逻辑 = source==FROM_PC → 走逻辑；v0.1 Browser 拉到的项目 source=FROM_PC，直接复用终端按钮（零额外工作）
- Sub-phase 7 FileTransfer deep-link 在拉取过程被复用：拉项目时 ViewModel 自动 navigate FileTransferScreen 模式 BROWSE 锁定 pcRootPath，进度统一在那

**预估时间**：~8h（happy path） × 1.5 = ~12h；不阻 v5.0.3.59 主切片，作 v5.0.3.62 一起出或 v5.0.3.63 独立 patch。

---

**总工作量估**：**~36-48h ≈ 5-6 天**（happy path 24h × 1.5-2x 现实倍数）

- Happy path: 15h 终端 MVP + 10h 文件/Git/收口 = ~24h（机械实施时间）
- **现实倍数 1.5-2x** 计入 CI 迭代（vue-tsc / kotlin / robolectric / detekt 滚轮）+ code review 来回 + 真机 E2E 暴露框架 bug（memory `android_remote_terminal_plan_a_diagnosis.md` 前车之鉴：简单 feature → 首测 4 个 critical bug）

**最小可发布切片**：Sub-phase 1-6 (~22h 含倍数) = "终端入口" alone 可发 v5.0.3.59；Sub-phase 7-8 作 v5.0.3.60+ patch 跟进，**不强求一次发完**——用户反馈决定优先级。

---

## 7. 实施 Traps（forward-looking — 14 + Sub-phase 10 加 8 = 22 个）

### 7.1 SAF tree URI 误传 cwd

**Why**：`ProjectEntity.rootPath` 既存 SAF URI（手机端 SAF picker 选）也存 PC path（legacy 字段，Phase 3d 之前没分流）。若误读 rootPath 当 cwd 传给 `terminal.create`，桌面端会收到 `content://com.android.externalstorage.documents/tree/...` 当 cwd，PTY 启动报错或落到 `$HOME`。

**Risk**：高 —— 既有用户的 LOCAL 项目 rootPath 是 SAF URI；FROM_PC 项目 pcRootPath 才是 PC path。逻辑混淆会让按钮点击导致 cryptic 错误。

**Fix**：严格按 §4.1 派生：`source = pcRootPath != null && sourcePeerId != null ? FROM_PC : LOCAL`。LOCAL 项目按钮 Hidden，根本不读 rootPath。Sub-phase 3 单测显式 cover "rootPath 是 SAF URI + pcRootPath 是 null" 场景 → Hidden。

### 7.2 sourcePeerId 与当前连接 PC 不匹配

**Why**：用户当前可能连着 PC2，但项目是从 PC1 sync 来的（sourcePeerId = PC1）。terminal.create 必须 route 到 PC1，不能因 PC2 在线就误用 PC2。

**Risk**：跨设备误操作 —— 用户期望"在 PC1 的项目目录开终端"，结果在 PC2 上 `pwd` 显示别的目录（或目录不存在，PTY 启动失败）。

**Fix**：terminalButtonState.Enabled 只在 **specific** `sourcePeerId` online 时 emit；PC2 在线但 PC1 离线 → Disabled。`RemoteConnectionManager.isPeerOnline(peerId)` 精确查询而不是 `hasAnyOnline()`。Sub-phase 3 单测加 "两 PC 在线，sourcePeerId 是其中一个" case。

### 7.3 PC 路径分隔符 Windows vs Unix

**Why**：桌面端 walker 直接 `project.rootPath` 写 source_peer_id，Windows 上是 `C:\Users\x\projects\foo`，Unix 是 `/home/x/projects/foo`。`terminal.create(cwd=...)` 在 Windows PTY (PowerShell) 接受 `C:\...`，在 Unix bash 接受 `/...`，但跨 OS sync 后值不可移植。

**Risk**：低（v0.1 假设 sync 来源 PC 就是目标终端 PC，路径分隔符天然一致），但要在 trap doc 里点明 v0.2 多 PC 重新指向时的隐患。

**Fix**：v0.1 不处理；trap 文档化。v0.2 加 "项目重新绑定 PC" UX 时引入路径转换 layer 或要求用户重选 cwd。

### 7.4 cwd 含空格 / 中文 / 特殊字符

**Why**：用户项目可能叫 `D:\我的项目\new feature`，URL-encode 后塞 navigation arg，再 decode 给 PTY。任何一环 encoding 错就 cwd 解析失败。

**Risk**：中 —— 国内用户中文路径极常见；空格在所有 OS 都合法。

**Fix**：`Screen.RemoteDesktopWithCwd.createRoute` 强制 `Uri.encode(cwd)`；receiver `Uri.decode`。PTY 端 `terminal.create` 既有协议透传 string，桌面端 spawn 子进程时用 array-form (不要 shell.exec("cd " + cwd + " && ..."))。Sub-phase 5 单测加中文 cwd + 空格 cwd case。

### 7.5 PC 上 cwd 目录已被删

**Why**：用户在桌面端把项目目录搬走或删了，Android sync 的 pcRootPath 还指向旧位置。`terminal.create(cwd=...)` 在 PTY 端 chdir 失败。

**Risk**：中 —— 桌面端项目搬迁是合理操作，sync 元数据更新滞后。

**Fix**：桌面端 `terminal.create` handler 检测 cwd 不存在时 fallback to `$HOME` 并返回 warning：`{sessionId, cwd: actualCwd, warning: "originalCwd not found, fell back to home"}`。Android `RemoteDesktopScreen` 收到 warning 显黄色 banner "原项目目录不存在，已切到 home"。

### 7.6 离线建项目 → 上线后 sync → sourcePeerId 仍 null

**Why**：用户先在桌面建项目（先 commit 入桌面 DB），然后桌面才上线 sync 到 Android。若桌面端 walker 在项目 commit 时记 source_peer_id，可能 P2P 还没启动 → walker 拿不到 localPeerId → 写 null。

**Risk**：中 —— sync 时 walker 才读 source_peer_id，但用户立即编辑项目又触发增量 sync，可能 race。

**Fix**：桌面端 `ProjectSyncWalker` 在每次 sync emit 时 lazy 调 `P2P.localPeerId()`（不在 commit 时存）。若 P2P 未启动 walker emit 直接 skip 这个项目（不带 source_peer_id 同步出去会污染 applier）。Phase 3d 既有 walker 已有 P2P 启动 gate，复用。

### 7.7 多 user 项目 sync 跨用户污染

**Why**：桌面端可能多个用户登录（userId 不同），项目 walker 当前按 userId 过滤。若 sourcePeerId 取的是 P2P localPeerId（设备级），不区分 userId —— 用户切换后 sync 出的项目 sourcePeerId 仍是同一 peerId。

**Risk**：低 —— Android 端 ProjectEntity 已按 userId 隔离，新增字段不改变隔离逻辑。但要文档化 sourcePeerId 是设备级，不是用户级。

**Fix**：sourcePeerId 文档化为"PC 设备标识"（设备一辈子一个 peerId），不含 user 语义。Android 端 terminalButtonState 派生时只查 peer 是否在线，不查 user 是否 match —— 因为同一 PC 设备无论谁登录都能 host PTY。

### 7.8 RemoteDesktopScreen 既有调用方 backward compat

**Why**：`NavGraph.kt:747` 既有 `RemoteDesktopScreen(onNavigateBack = ...)` 全局远程操控入口；新加 `initialPeerId` + `initialCwd` 参数时若 required → 破坏既有调用。

**Risk**：低（compile error 会立即暴露），但容易在 Sub-phase 5 重构时漏改一个调用方。

**Fix**：新参数全 nullable 默认 null。null 时 RemoteDesktopScreen 走既有 UX（让用户从配对 PC 列表选）；非 null 时直接跳到选定 peer + cwd。Sub-phase 5 PR 中显式列出既有调用方 grep 结果，证明无破坏。

### 7.9 双向 sync 冲突（手机和 PC 同时改同一文件）

**Why**：用户在手机端编辑 `notes.md`，PC 同时在终端 `echo "x" >> notes.md`。双方都改了，触发 sync 时冲突。

**Risk**：高 —— 真实使用场景频繁出现，特别是文档/笔记类项目。

**Fix**：v0.1 走 **last-write-wins + 冲突备份**：
- Android applier 检测 remote mtime > local mtime 且 local hash != cached_remote_hash → 判定冲突
- 把 local 版本备份成 `<file>.local-conflict-<timestamp>` 同目录保留
- 用本地最新版本覆盖（用户最近改的）
- UI 显黄色 banner "检测到冲突，本地版本已备份为 xxx.local-conflict-yyy"
- 用户可自行 diff / merge / 删备份
- v0.2 加 git 项目专属冲突解决（自动 `git stash` + sync + `git stash pop`）

### 7.10 PC 端文件改动事件 push 频率 + 触发源单一化

**Why**：用户跑 `npm install` 可能改 10000+ 文件（node_modules），event 列表巨大；用户编辑一个文件可能频繁 save → event 风暴。另外存在**触发源歧义**：terminal session 结束 vs file watcher 周期 vs 任意 mtime 变化 —— 多源混用会让相同改动重复 emit。

**Risk**：中 —— event 列表大小爆炸或 push 过频导致 DC 拥塞 / UI 频繁 banner 闪 / 重复同步 / 用户困惑 "我什么都没干怎么又弹了"。

**Fix**：**触发源单一化 = file watcher 周期 debounce 5s** —— 这是唯一来源：
- 桌面端用 `chokidar` (or 同类 watcher，既有 dep)，watch `project.rootPath` 递归，debounce 5s 聚合 → emit 一个事件
- 单 event payload 仅含 path 列表前 100 项 + `truncated: true` + `total: N`（UI 显示 "PC 有 N 个文件改动，含 path1 / path2 / ..."）
- node_modules / .git / build / dist / target / .next 等目录默认 ignore（用户可改 `.chainlesschain/sync-ignore`，参考 .gitignore 语法）
- Android 端 banner 多次触发 → 合并到最新一条（不堆叠）
- **明确不做**：terminal session close 时**不**额外触发（与 watcher 完全解耦）；long-running 30 min build 期间 watcher 自然按 5s 周期持续 emit，session 结束没新文件改 watcher 自然静默 —— 与 session lifecycle 零绑定，更可预测
- watcher 进程独立于 PTY 进程；watcher start = 项目 sync 启用时；watcher stop = 项目 sync 停用 / 桌面端退出

### 7.11 git.status 在大 repo 上慢

**Why**：`simple-git` `status()` 在 50k+ 文件的 monorepo 上耗时 2-5s。Sub-phase 8 fire-and-forget 调用阻塞 chip 渲染。

**Risk**：低-中 —— 大多数项目 < 5000 文件 100ms 内返回；monorepo 用户少数但存在。

**Fix**：
- `git.status` 调用 timeout 1500ms，超时返 `{ isGitRepo: true, slow: true }` —— UI 显 chip "git 仓库（status 超时）"，tap 展开 sheet 给 "在终端跑 git status 看完整结果" 按钮
- 桌面端 git.status 后台 5min cache 同 repo path 结果，连续调用走 cache（user 离开 detail 又回来不重复跑）
- v0.2 评估 `git status --porcelain --no-optional-locks` 是否更快

### 7.12 G14 手机端推送时项目目录不可写

**Why**：用户手机端改了文件想推 PC，但 PC 端目录可能正被 IDE 锁（Windows `node_modules` 删不掉典型）/ 权限不足 / 磁盘满。

**Risk**：中 —— 用户期望"推上去就完事"，结果失败时分不清是网络还是 PC 侧问题。

**Fix**：桌面端 file handler 写入前 try-write 一个 `.cc-sync-probe` 临时文件验证可写 → 失败立即返 `WRITE_PERMISSION_DENIED` / `DISK_FULL` 具体错误码 → Android UI 显具体提示 "PC 项目目录不可写：被其它程序锁定？请检查"。临时探针文件 1KB 内立删，不污染项目目录。

### 7.13 PC 项目被删除 → Android 端 orphan 状态

**Why**：用户在桌面端把项目搬走或归类整理时删了项目（status → DELETED 同步到 Android）。但 Android 端可能还有本地编辑/备份，不应该被联级删。trap 7.5 只覆盖 cwd 目录被删（部分情况），不覆盖项目本身被删的 lifecycle。

**Risk**：高 —— 触发场景常见（桌面端常规清理）。若联级删，用户在手机上的编辑全丢；若什么都不做，用户对着一个永远连不上的 orphan 项目困惑。

**Fix**：Android applier 收 status=DELETED 的 FROM_PC 项目：
- 本地 `ProjectEntity.status` **不改**（不变 ARCHIVED 也不变 DELETED）
- 本地 `ProjectEntity.metadata` JSON 加 `{ "orphan": true, "orphanedAt": <timestamp> }`
- ProjectDetailScreenV2 渲染检测 `metadata.orphan==true` → 显黄色 banner "PC 已删除此项目；本地仍可访问"
- banner 含两按钮：(a) "本地归档" → status=ARCHIVED + 移除 orphan tag (b) "彻底删除" → 软删除 status=DELETED + 删本地 cache
- terminalButtonState 在 orphan 状态强制 Disabled（即使 sourcePeerId 在线，PC 上目录已没意义）
- Sub-phase 2 加 1 单测 covering 此 case

### 7.14 terminal session 死后不清理

**Why**：用户跳进终端，跑了几个命令，按返回键回 detail —— Android 不会触发 `terminal.close`。PC 端 PTY 进程一直驻留消耗资源。

**Risk**：中 —— 单 session ~5MB 内存 + 1 个 fd，频繁切项目堆积。

**Fix**：`RemoteDesktopScreen` 的 `DisposableEffect` onDispose 调 `terminalRpcClient.close(sessionId)`。OQ-5 选 A "session 不持久化" 的逻辑闭环必须在这里落实。若 v0.2 改 OQ-5 选 B 持久化，再去掉这个 close。

### 7.14 RemoteProjectBrowser — userId 不匹配的多账号场景

**Why**：用户在 Android 端登录账号 A，PC 上登录账号 B（不同 userId）。`project.list` 严格校验 userId 匹配 → 永远返空列表 + 用户困惑 "桌面明明有项目"。

**Risk**：中 —— 多设备多账号常见。

**Fix**：list response 返 `{ projects: [], reason: "USER_MISMATCH", remoteUserId: "<masked>" }`；Browser UI 显具体提示 "桌面端登录账号与手机不一致；请切换账号" + 跳设置入口。**不**返 PERMISSION_DENIED（那是 user_id null/empty 的真异常）。

### 7.15 RemoteProjectBrowser — 拉取大项目（>500 文件）UX

**Why**：用户在桌面建了一个 monorepo 5000+ 文件，tap "拉取" 后 file list response 5000 项，FileTransferRepository 队列瞬间塞 5000 项 chunked download → 几分钟到几十分钟。

**Risk**：中 —— Browser 拉项目期间用户切走 / 切回，UX 不清晰。

**Fix**：
- `project.pullSingle` 返 `{ filesCount: 5234, filesPreview: [...top 50] }`（不是全清单）
- Browser 显 "项目含 5234 文件 (~1.2GB)，预计拉取 8 分钟，确认？" → 用户主动确认才进队列
- 拉取过程在通知栏显持久 progress notification（用户切走也能看进度）
- 完成 toast；可在通知里 tap 跳回 Browser

### 7.16 RemoteProjectBrowser — Phase 3d 已 sync 过的 client-side dedup

**Why**：Browser 列表用 `getProjectIds()` ∩ `remoteIds` 判已存。但 ProjectDao 默认 select 含 deleted=true / orphan tag 的项目 → 误判已存 → 用户拉不到。

**Risk**：中 —— 用户曾归档的项目想重拉时被误判。

**Fix**：Browser dedup query 用 `projectDao.getActiveProjectIds(userId)` 显式排除 deleted + orphan-tagged + ARCHIVED。"已在本地" badge 仅在真活跃项目显；ARCHIVED 项目显 "曾拉取过（已归档）" 灰色 tag + tap 触发 "重拉并恢复" 流。

### 7.17 RemoteProjectBrowser rate-limit + 扫库防御

**Why**：恶意 / 错误代码 spam `project.list` 可拉桌面所有项目元数据。虽是配对 trust 边界内，但仍是 information leak 路径。

**Risk**：低-中 —— 主要是 paranoid coding，正常用户不触发。

**Fix**：桌面端 handler token-bucket 限流：单 sourcePeerId 10/min；超限返 `RATE_LIMITED`，Android UI 显 "操作过于频繁，请稍后重试"。配置可在 settings disable（开发测试场景）。

### 7.18 PC web-shell placeholder 误导用户

**Why**：v0.1 PC web-panel 加 "远程项目" 入口但实际反向拉不工作（v0.2 才做）。用户点了发现空页 / 不可用，体验差。

**Risk**：高（UX 层面）—— 用户预期不一致。

**Fix**：v0.1 placeholder 必须**显式标 "即将上线"**：菜单项加 "(v0.2)" 后缀 + 灰色 + tooltip "PC 端浏览手机项目功能将在下个版本提供"。不要做"空状态 UI 看起来像真功能但拉不到"。或干脆 v0.1 不显该菜单项 — 待 v0.2 真功能 ready 再 reveal（更保守选项）。

### 7.19 RemoteProjectBrowser 在离线态的 UX

**Why**：用户进 Browser 但所有配对 PC 都 offline → list 调用 timeout → 空白页 + 错误 banner。

**Risk**：中 —— 频繁发生（弱网环境）。

**Fix**：Browser 进入时先检查 RemoteConnectionManager.connectedPeers，无在线 PC 时直接显空状态页 "没有在线的 PC 设备" + 引导 "查看配对设备" 跳 pairing 入口；不发起 list 调用避免无意义 timeout。

### 7.20 拉取过程项目元数据 vs 文件清单的 atomicity

**Why**：pullSingle 拉到元数据但文件下载中途失败（用户 kill app / 网络断）。下次进 ProjectDetail 看到项目存在但文件列表空，困惑。

**Risk**：中 —— 半成品项目状态。

**Fix**：ProjectEntity 加 metadata.pullState："metadata_only" / "partial" / "complete"。
- 元数据落地后 = "metadata_only"
- 文件 download 中 = "partial"
- 全部完成 = "complete"

ProjectDetailScreenV2 检测非 complete 状态显黄色 banner "项目拉取未完成（X/Y 文件）" + button "继续拉取" + "放弃并删除"。pullState 不需要 DB 新列，存 metadata JSON 里。

### 7.21 web-shell 双 WS gateway 注册顺序的 race

**Why**：`project.list` 必须双 WS gateway 注册（desktop 内嵌 ws-server + cc ui packages/cli ws-handler）。若先 release CLI 包但 desktop 还没新版本，cc ui 调 list 时 desktop handler 不存在 → method-not-found。

**Risk**：高 —— 跨包 release 节奏不一致是历史频繁雷（memory `desktop_web_shell_strategy.md`、`feedback_cross_shell_feature_pattern.md`）。

**Fix**：
- 桌面端 release 必须先于 CLI bump (cc ui)
- web-panel SPA 调 list 时检测 method-not-found error → 显 "桌面端版本过低，请升级桌面应用" 提示而不是技术错误
- desktop-app-vue 和 packages/cli 的 method registry 用版本号 marker：response header 加 `x-mobile-bridge-version: v1.3` 让 web-panel 检测能力

---

## 8. Test Strategy

### 8.1 单测 ≥ 28 across modules

| 模块 | 测试文件 | 目标数 |
|---|---|---|
| core-database | `ProjectDaoTest.kt` (new fields roundtrip + DAO query) | ≥ 3 |
| core-database | `MigrationTest.kt` (v(N) → v(N+1)) | ≥ 1 |
| feature-project | `ProjectSyncApplierTest.kt` (source_peer_id + pc_root_path parse) | ≥ 4 |
| feature-project | `ProjectSyncWalkerTest.kt` (Desktop walker writes new fields) | ≥ 2 |
| feature-project | `ProjectViewModelTest.kt` (terminalButtonState 三态 + state changes) | ≥ 5 |
| app | `ProjectDetailScreenV2Test.kt` (UI test 三态) | ≥ 3 |
| app | `RemoteDesktopViewModelTest.kt` (initialCwd + prefillCommand 参数路径) | ≥ 3 |
| app | `FileTransferViewModelTest.kt` (mode + initialRemotePath + initialSourceUri) | ≥ 4 |
| app | `ProjectDetailScreenV2Test.kt` (上传/下载按钮三态 + Git chip 三态) | ≥ 4 (扩展) |
| app | `GitCommandsTest.kt` (status parse / method-not-found / isGitRepo=false) | ≥ 3 |
| desktop | `git-handler.test.js` (simple-git status × git repo / 非 git / 损坏 .git / 大 repo timeout) | ≥ 4 |
| feature-project | `ProjectSyncConflictTest.kt` (last-write-wins + 冲突备份命名) | ≥ 3 |

### 8.2 集成测试 ≥ 2

- `ProjectSyncIntegrationTest` — 桌面建项目 (mock walker) → emit → Android applier 收 → entity 持新字段 → terminalButtonState Enabled
- `NavGraphRemoteDesktopTest` — Detail 页 button click → navController.navigate(RemoteDesktopWithCwd) → RemoteDesktopScreen receives correct args

### 8.3 真机 E2E (Mac/Win 桌面 + Android 手机)

**前置**：v5.0.3.58 desktop + Android Phase A.1 远程终端已通；设备已配对；signaling/TURN 已部署。

| # | 场景 | 验收 |
|---|---|---|
| 1 | 桌面建项目 `~/projects/test-prj`，sync 到 Android | Android 项目列表显示该项目 |
| 2 | 进 Android 项目 detail → 看到 "终端" 按钮（高亮） | TopBar terminal icon 可见 + enabled |
| 3 | 点 "终端" → xterm.js 载入 → `pwd` 输出 | `pwd` = `/Users/x/projects/test-prj`（或 Windows 等价） |
| 4 | 在终端跑 `git status` → 看到桌面项目真实 git 输出 | stdout 流式显示正确 |
| 5 | 桌面端 kill PC 进程（模拟离线） | Android 项目 detail 终端按钮 ≤ 3s 内变灰 |
| 6 | 桌面恢复 → 按钮重新高亮 | ≤ 3s 内 enabled |
| 7 | 桌面建项目 `D:\我的项目\测试 项目`（中文+空格） → sync → Android 点终端 | xterm `pwd` 正确显示该路径 |
| 8 | 桌面删除项目目录 → Android 点终端 | banner 显 "原目录不存在，已切到 home" + xterm `pwd` 显 home |
| 9 | Android 端建 LOCAL 项目（SAF picker） | 项目 detail TopBar 无终端按钮 |
| 10 | 跑了几条命令后 Android 按返回键 | 桌面端 PTY 进程退出（用 `ps` 验证） |
| 11 | Android tap 上传 → SAF picker 选手机本地文件 → 上传 | 文件出现在 PC 项目根目录；进度条 100% 完成 |
| 12 | Android tap 下载 → 浏览项目文件列表 → 选文件 → 下载 | 文件出现在 Android `Downloads/`（MediaStore.Downloads 验证） |
| 13 | PC 终端跑 `echo hi > new.txt` → 桌面端 watcher debounce 5s 后 emit | Android detail 页 ≤ 10s 显示 banner "PC 有 1 个文件改动，立即同步？" |
| 14 | 该 banner tap "立即同步" | new.txt 入项目本地 cache，ProjectFilesScreen 可见 |
| 15 | PC 项目根含 `.git/` → detail 显 git chip | chip 文案如 "main · 3 changed"；tap 展开 sheet |
| 16 | git chip sheet tap "在终端打开" | 跳 RemoteDesktopScreen + xterm 预填 `git status` 命令（敲 enter 即跑） |
| 17 | PC 项目根**不**是 git 仓库 | detail 无 git chip；不影响其它按钮 |
| 18 | 同时双端改同一文件 → sync | 本地版本备份成 `<file>.local-conflict-<timestamp>`；banner 提示 |
| 19 | 桌面端老版本 (v5.0.3.58) 不含 git.status method | Android 不显 git chip（silently 无报错） |

**reproducer**：iOS Phase 2.7 / Android W3.7 同等规格，需 Mac+iPhone+真桌面 在场。Win dev box 单设备不可验。

---

## 9. Rollout 计划

### 9.1 版本切片（含 1.5-2x 现实倍数）

- **v5.0.3.59** — Sub-phase 0 (sync 兼容性 prep，§9.4) + Sub-phase 1-6 (终端 MVP)；真机 E2E §8.3 场景 1-10；预估 ~22h
- **v5.0.3.60** — Sub-phase 7 (文件上传/下载 deep-link)；真机 E2E 场景 11-12；预估 ~6h
- **v5.0.3.61** — Sub-phase 8 (Git 感知 chip + 桌面 git-handler)；真机 E2E 场景 15-17、19；预估 ~5h
- **v5.0.3.62** — Sub-phase 9 (G13 文件改动 banner + G14 推送 + 收口 + 三站文档)；真机 E2E 场景 13-14、18；预估 ~5h
- **v5.0.3.63** — Sub-phase 10 (RemoteProjectBrowser PC→Android 选择性拉 + PC web-shell placeholder)；真机 E2E 场景 20-24；预估 ~12h
- **v5.0.3.64 (buffer)** — 留作真机 E2E 反馈 + bug fix 兜底；不立项强发
- **v0.2 follow-up** — OQ-5 改持久化 session + git 项目专属冲突解决 (`git stash` 自动) + 多 PC 切换 UX + biometric gate 默认开 + **Sub-phase 10 反向 PC←Android 真功能（撕掉 PC web-shell placeholder）**
- **v0.3 follow-up** — 跨设备 terminal session resume + 快捷命令模板 + 评估顶层 Files tab

### 9.2 风险控制

- **回滚**：所有改动可纯 revert（entity migration 不写入 destructive 操作 —— nullable 字段 ALTER 安全）。
- **降级**：feature flag `EnableProjectTerminalEntry = true` 默认开；若发现 sync 兼容性问题，单 flag flip 隐藏按钮，sync 字段不影响其它逻辑。
- **灰度**：Android in-app auto-update v5.0.3.58 已收口 —— 用户能收到 update 提示并能装上；旧版本用户继续用，新字段 sync 兼容（applier 老版本 silently ignore 不认识的字段）。

### 9.3 配套文档更新

- `CLAUDE.local.md` Recently Completed 加 entry
- `CHANGELOG.md` + `docs-site/docs/changelog.md` 同步（参考 memory `release_changelog_inventory.md`）
- `docs-website-v2/src/pages/mobile.astro` 加 "项目 + 远程终端" 一行（营销页只讲结果，不讲过程 —— 参考 memory `feedback_official_site_results_only.md`）
- `docs/design/Android_重新定位_设计文档.md` 若有 "Android 端没 CLI" 章节，加 cross-link 到本文档

---

## 10. 收益预期（与现状对比）

| 指标 | 现状 | 目标 |
|---|---|---|
| 项目管理模块用户路径完整性 | 仅本地浏览，无法做事 | 浏览 + 一键跳 PC 做事 |
| `feature-project/` 暗码可清理量 | 0 (Editor/Git/Completion 占着不删) | ~3,000 行可 deprecate（v0.2 跟进） |
| 用户场景覆盖：移动端 CLI 任务 | 必须打开 RemoteDesktop tab → 手输 cd | detail 一键直达，cwd 就位 |
| Android 端"为什么没 CLI"FAQ | 高频疑问 | 不再是问题（借 PC 即可） |
| ProjectViewModel god-class 拆分动力 | 低（功能少不需要拆） | 中（terminalButtonState 加入催 P1 拆分） |

---

## 11. 关联 Memory & ADR

- memory `phase_3d_mobile_sync_landing.md` — sync 基础协议
- memory `android_remote_terminal_plan_a_diagnosis.md` — Plan A 真机诊断
- memory `feedback_currentpeerid_target_vs_self_trap.md` — WebRTCClient peerId trap
- memory `feedback_cross_shell_feature_pattern.md` — 跨壳 feature 模式（本设计 Android-only，桌面端仅 sync walker 改动）
- ADR：若 Phase v0.2 加 OQ-5 持久化 session，需新建 ADR 评估 PTY 资源/session lifecycle/多 user 隔离

---

## 12. Sub-phase 5-6 v2 + Sub-phase 10 v2 (2026-05-18 commit `09bd0ec0f`)

承接 `3319febc4` Sub-phase 5-6 fix 真机反馈："弹补填对话框但找不到同名 PC 项目" + "项目文件同步没做"两条阻塞，两个 sub-phase 各演进一档。

### 12.1 Sub-phase 5-6 v2 — LOCAL 项目终端入口改为 PC 项目 picker

**旧路径**（v1，`3319febc4`）：手输 PC 路径 dialog，自动预填同名项目。同名不命中时用户必须在手机上敲 Windows 长路径 → 阻塞。

**新路径**（v2，`09bd0ec0f`）：

```
                 LOCAL 项目 tap Terminal icon (无 pcRootPath)
                              ↓
                  AlertDialog 打开 → 并发触发两条流：
                              ↓
            ┌─────────────────┴──────────────────┐
            ↓                                    ↓
  listPcProjects(pcPeerId)             findPcProjectPathByName(pcPeerId, name)
  调 project.list (limit=200)          ← 同名匹配，仅高亮提示
  返 PcProjectChoice 列表
            ↓
  Picker LazyColumn 显示：
   - 同名匹配的项目排顶部 + "同名" 标
   - 每行 显示 name + pcRootPath
   - tap row → 保存 pcRootPath + 跳终端
            ↓
  列表为空（桌面所有项目都没 rootPath）→
   自动展开 "自定义路径" 折叠区 + error hint
            ↓
  "自定义路径" 折叠区作 fallback（保留原手输路径流）
```

**触点**：
- `RemoteContextViewModel.kt:34-71` 新 `listPcProjects(pcPeerId): List<PcProjectChoice>` 调 project.list 过滤掉无路径 dead row
- `ProjectDetailScreenV2.kt:106-348` AlertDialog 全重写（picker + 自定义路径折叠区 + 同名高亮）

**OQ-5-6-v2 决策**：
| 选项 | 决策 | 理由 |
|---|---|---|
| 路径输入方式 | **A=PC 项目 picker (tap 选)** | 移动端键盘输 Windows 路径太难；picker 单 tap 完成 |
| 同名匹配 | **A=作建议高亮（不强制）** | 用户场景 LOCAL 项目名 ≠ PC 项目名常见；不能 hard match |
| 兜底 | **A=保留自定义路径输入** | PC 端无对应项目时仍要让用户开终端 |
| 列表为空时 UX | **A=auto 展开自定义路径 + 错误提示** | 减少额外 tap |

### 12.2 Sub-phase 10 v2 — 全量项目内容拉取（pullSingle + getFile 循环）

**旧路径**（v1，`504bd6dde` Sub-phase 7）：
- `pullSingle` 拉项目 metadata + 文件清单（不含内容）
- 文件内容 "由 caller 跳 FileTransferScreen 拉" — 实际从未接通
- 用户痛点：拉取 "完成" 后离线打开项目 → 文件列表显示 0 文件，看不到任何内容

**新路径**（v2，`09bd0ec0f`）：

```
RemoteProjectBrowserVM.pullProject(projectId)
    ↓
pullSingle(projectId) → ProjectPullSingleResponse (含 files: List<RemoteProjectFile>)
    ↓
insertProject(metadata) → ProjectEntity 落 Room
    ↓
循环 forEachIndexed { idx, file →
    _pullProgress.value = PullProgress(idx, files.size, file.path)
    val full = projectCommands.getFile(file.id)  // RPC: project.getFile
    val safe = if (full.content > 1MB) null else full.content  // 防 OOM
    projectDao.insertFile(remoteFileToEntity(file, projectId, full, safe))
}
    ↓
更新 metadata.pullState = "files_downloaded"（v1 是 "metadata_only"）
    ↓
_pullProgress.value = null
```

**关键决策**：
- **单文件失败 continue**：getFile 抛/返 null 时 log warn 不阻塞后续（用户已有 2/3 内容好过 0/3）
- **>1MB content skip 写占位 row**：写 size + hash 但 content=null，让 ProjectDetailScreenV2 至少看到文件名 + 能后续单独拉
- **parentId=null v0.1**：不重建 folder 树，all files 走 path 字符串显示。ProjectViewModel.buildFileTree 用 path 做 prefix tree 渲染，flat 列表也能用
- **PullProgress StateFlow**：currentIdx + total + 当前文件名 → UI 显 LinearProgressIndicator + "下载文件 N/M: <path>"

**触点**：
- `RemoteProjectBrowserViewModel.kt:96-160,170-207` pullProject 加 files 循环 + remoteFileToEntity 转换
- `RemoteProjectBrowserScreen.kt:91-135,180-200` row 下方加进度条 + 当前文件名行
- 桌面侧 `project.getFile` (已 `504bd6dde` 落地) 无改动 — 直接复用既有 RPC

### 12.3 真机 E2E 8 场景矩阵（v2 收口）

新增 3 场景验证 v2 + 5 场景验回归：

| # | 场景 | 期望表现 |
|---|---|---|
| 1 | **LOCAL 项目 tap 终端，picker 显示 PC 项目列表** | 列表加载 ≤2s；项目按 updated_at desc 排序；同名项目顶部 + "同名" 标 |
| 2 | **picker tap row → 跳终端** | 跳转 ≤300ms；自动开 pwsh session 落选中项目的 pcRootPath；Terminal 首行 prompt 显示该目录 |
| 3 | **桌面项目全部 root_path=null → picker 显错误** | "桌面没有可用项目（缺 rootPath）" + 自动展开自定义路径输入 |
| 4 | **自定义路径输入 fallback 仍可用** | 折叠区展开 → 输 `C:\code\test` → tap "使用此路径" → 同 v1 行为：保存 + push 桌面 + 跳终端 |
| 5 | **FROM_PC 项目 tap 终端（有 pcRootPath）→ 不弹 dialog 直跳** | 跳过 picker dialog；直接跳 TerminalList(initialCwd=pcRootPath)；自动开 session |
| 6 | **拉取 PC 项目（10 文件，每个 < 50KB）** | 进度条逐文件刷新；progress text "下载文件 N/10"；完成后 row 显 "已在本地" badge |
| 7 | **拉取含 >1MB 文件** | 大文件 row 写入 Room 但 content=null；列表仍可见文件名 + size；其他文件正常 |
| 8 | **拉取过程中单文件 getFile 失败** | log warn；继续后续文件；最终 ok 文件数 = total - 失败数；row 仍 marked 已在本地 |

### 12.4 测试覆盖（单元 + 集成）

| 文件 | 测试数 | 覆盖 |
|---|---|---|
| `RemoteContextViewModelTest.kt` | 16 | listPcProjects 解析/过滤/异常；findPcProjectPathByName 命中/落空；pushPcRootPathToDesktop ok=true/false/exception |
| `RemoteProjectBrowserViewModelTest.kt` | 7 | pullProject happy path（3 文件 inserts）/ 单文件 failure continue / exception continue / >1MB skip / 空 files 不调 getFile / pullingId lifecycle / 并发调用 ignore |
| `mobile-bridge-sync.test.js` (project handlers) | 15 (+6 新) | handleProjectList 用 userId 忽略 + sourcePeerId/pcRootPath derived + 分页 + deleted excluded + rate-limit；handleProjectPullSingle 4 场景；**handleProjectUpdatePath 6 场景**（MISSING_PROJECT_ID/UPDATE OK/COALESCE root_path/PROJECT_NOT_FOUND/空串归 null/rate-limit） |
| `project-management-handler.test.js` (file CRUD) | 33 (+9 新) | createFile/createFolder/writeFile/deleteFile 全覆盖；getFile 多一条 "Android Room insert 契约" |
| `project-handlers.test.js` (web-shell) | 7 | 10 topic dispatch（之前 stale 6）+ pre-bootstrap + userId fallback |
| **合计** | **78 新通过** | 单元 + 集成全绿 |

### 12.5 还剩什么

- **真机 E2E §12.3 8 场景**：需要 Mac/Win PC + Android 双机配对环境，dev box 无法独验
- **桌面端 web-shell 创建项目 rootPath 默认 null 是根因之一**：picker v2 让 dead row 不显示但根本应在 PC 端 `project.init` 时让用户填 rootPath；本 commit 不修，留 v0.3 跟进
- **PC→Android 反向 push（Android 改动自动 sync 回 PC）**：v0.1 单向；v0.2 接 Phase 3d sync push 完整链路

---

**Status legend**：☐ 未开始 ☒ 进行中 ✓ 已完成
