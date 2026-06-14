# Android REMOTE Commands Inventory

> **版本**: v0.1 (M1 现状梳理, 2026-05-11) | **关联**: [Android 重新定位设计文档 v0.2](./Android_重新定位_设计文档.md) §ADR-5 / M4 / §8.3
>
> 为 RemoteSkillRegistry (M4) 提供消费源：23 个 `android-app/.../remote/commands/*Commands.kt` 的 fun 计数、命名空间、桌面对端 handler 映射、风险分类。**M1 只做 file-level 盘点；method-level 元数据（参数 / 返回类型 / 是否需审批）由 M4 RemoteSkillRegistry 实现期 per-file 深读时补全。**

## 概览

| 维度 | 数量 | 备注 |
|---|---|---|
| Android *Commands.kt 文件数 | **23** | 全在 `android-app/app/src/main/java/com/chainlesschain/android/remote/commands/` |
| 总 `fun` 声明数 | **795** | 含 public RPC + private 辅助 + companion init |
| 总 `suspend fun` 声明数 | **789** | RPC 入口 proxy（Kotlin 协程 / I/O 上下文必 suspend） |
| 桌面对端 handler 文件数 | **24** | 在 `desktop-app-vue/src/main/remote/handlers/` |
| 桌面 browser-extension 子系统 | **+4 handlers** | 在 `desktop-app-vue/src/main/remote/browser-extension/handlers/` |
| Android command → desktop handler 直接命名匹配 | **22 / 23** | 唯一例外：ExtensionCommands.kt → browser-extension/ 子系统而非单文件 |

> 仅 WorkflowCommands.kt 的 19 funs 里 13 是 suspend / 6 是非 suspend（model class methods）。其它 22 文件的所有 `fun` 都是 `suspend fun`。

## File-by-file 清单（按 fun 数降序）

| #  | File                       | Funs | Suspend | Lines | Namespace 前缀           | 桌面对端 handler                                        | 主功能                                              | 风险分类      |
|----|----------------------------|------|---------|-------|--------------------------|---------------------------------------------------------|-----------------------------------------------------|---------------|
| 1  | ExtensionCommands.kt       |   95 |      95 | 1617  | `extension.*`            | `browser-extension/` 子系统（4 handlers + server）       | Chrome 扩展：tab/cookie/storage/script 注入          | mutating + privileged |
| 2  | DesktopCommands.kt         |   70 |      70 | 1269  | `desktop.*`              | `remote-desktop-handler.js`                              | 远控桌面：鼠键 / 窗口 / 剪贴板 / screen frame        | mutating + privileged |
| 3  | MediaCommands.kt           |   61 |      61 | 1130  | `media.*`                | `media-handler.js`                                       | 媒体控制：音量 / 播放 / 录制 / 截屏                  | mutating      |
| 4  | KnowledgeCommands.kt       |   55 |      55 | 1309  | `knowledge.*`            | `knowledge-handler.js`                                   | 知识库 / RAG / 笔记 CRUD                             | mutating      |
| 5  | NetworkCommands.kt         |   53 |      53 | 1398  | `network.*`              | `network-handler.js`                                     | 网络状态 / 接口 / DNS / 代理                          | safe + privileged |
| 6  | AICommands.kt              |   53 |      53 | 1501  | `ai.*`                   | `ai-handler.js` + `ai-handler-enhanced.js`               | LLM 对话 / RAG / agent / 多模态 / TTS / ASR           | mutating + privileged |
| 7  | SystemCommands.kt          |   49 |      49 | 1117  | `system.*`               | `system-handler.js` + `system-handler-enhanced.js`       | 系统操作：shutdown / restart / lock / sleep / env     | mutating + privileged |
| 8  | FileCommands.kt            |   45 |      45 | 1116  | `file.*`                 | `file-transfer-handler.js`                               | 文件 CRUD + 分块上传下载 + 校验                       | mutating + privileged |
| 9  | SystemInfoCommands.kt      |   42 |      42 | 1129  | `system.info.*`          | `system-info-handler.js`                                 | 只读系统信息：CPU / GPU / OS / BIOS                  | safe          |
| 10 | StorageCommands.kt         |   41 |      41 | 1179  | `storage.*`              | `storage-handler.js`                                     | 磁盘信息 + 分区 + smart 监测                          | safe + mutating |
| 11 | BrowserCommands.kt         |   40 |      40 |  896  | `browser.*`              | `browser-handler.js`                                     | Electron 内嵌 puppeteer-like 自动化                  | mutating      |
| 12 | PowerCommands.kt           |   34 |      34 |  694  | `power.*`                | `power-handler.js`                                       | 电源 / 电池 / 散热 / 模式切换                         | mutating + privileged |
| 13 | ProcessCommands.kt         |   30 |      30 |  754  | `process.*`              | `process-handler.js`                                     | 进程列表 / 启停 / 资源占用                            | mutating + privileged |
| 14 | InputCommands.kt           |   24 |      24 |  327  | `input.*`                | `input-handler.js`                                       | 键鼠模拟 / 输入语言 / IME                             | mutating      |
| 15 | WorkflowCommands.kt        |   19 |      13 |  566  | `workflow.*`             | `workflow-handler.js`                                    | 桌面 Workflow run / status / 步骤回调                | privileged    |
| 16 | UserBrowserCommands.kt     |   18 |      18 |  420  | `userBrowser.*`          | `user-browser-handler.js`                                | 用户系统浏览器（Chrome/Edge）控制                     | mutating      |
| 17 | DeviceCommands.kt          |   12 |      12 |  315  | `device.*`               | `device-manager-handler.js`                              | 已配对设备 / pairing / 撤销                          | privileged    |
| 18 | NotificationCommands.kt    |   11 |      11 |  343  | `notification.*`         | `notification-handler.js`                                | 桌面通知发起 / 撤销 / 历史                            | mutating      |
| 19 | DisplayCommands.kt         |   11 |      11 |  298  | `display.*`              | `display-handler.js`                                     | 多屏 / 分辨率 / 亮度 / 截屏                          | safe + mutating |
| 20 | ClipboardCommands.kt       |    9 |       9 |  229  | `clipboard.*`            | `clipboard-handler.js`                                   | 剪贴板读写 + 历史 + sync                              | mutating      |
| 21 | SecurityCommands.kt        |    8 |       8 |  195  | `security.*`             | `security-handler.js`                                    | DID 验签 / 设备指纹 / 权限查询                        | privileged    |
| 22 | ApplicationCommands.kt     |    8 |       8 |  244  | `app.*`                  | `application-handler.js`                                 | 桌面已装 app 列表 / launch / focus                    | mutating      |
| 23 | HistoryCommands.kt         |    7 |       7 |  214  | `history.*`              | `command-history-handler.js`                             | RPC 调用历史 / 审计 / 撤销                            | safe          |
| **共**| **23 文件**             |**795**|**789** | 17560 |                          | **24 handlers + browser-extension/ 子系统**              |                                                     |               |

## 风险分类定义（用于 ADR-3 三道闸映射）

| 风险标签       | 说明                                                                            | 桌面侧策略默认建议                                  |
|----------------|---------------------------------------------------------------------------------|-----------------------------------------------------|
| `safe`         | 只读 / 查询类（system info / network status / history 读）                       | 白名单默认 ✅ 允许；只需 Ed25519 签名               |
| `mutating`     | 改桌面状态但局部可逆（文件写、剪贴板设、媒体音量、通知发起）                       | 白名单需 opt-in；签名必备                            |
| `privileged`   | 高敏 / 不可逆 / 系统级（shutdown / process kill / cookie 注入 / 大额支付 / 配对） | 白名单 opt-in + ApprovalUI 强审批 + StrongBox 签名   |

> 同一文件可有多种风险（如 StorageCommands 既有 `safe` 的 `getDiskInfo` 也有 `mutating` 的 `formatDrive`）。M4 实现期需 per-method 标，目前仅给文件级风险包络。

## 桌面对端映射特殊情况

### ExtensionCommands.kt（95 funs，最大单文件）

不映射 `handlers/extension-handler.js`（不存在），而是 `desktop-app-vue/src/main/remote/browser-extension/` 整个子系统：

```
remote/browser-extension/
├── background.js / content.js / popup.js / manifest.json   # Chrome 扩展本体
├── handlers/
│   ├── index.js / tabs.js / bookmarks.js / history.js       # 命令分发
└── （由 remote/browser-extension-server.js 启 WebSocket server）
```

ExtensionCommands 走 WebSocket → 桌面 server → Chrome 扩展，**与一般 handlers/ 不同链路**。M4 RemoteSkillRegistry 注册元数据需多带一个 `transport: "extension-ws" | "handler-rpc"` 字段做路由区分。

### Browser 三件套（BrowserCommands / UserBrowserCommands / ExtensionCommands）

```
| Android Commands           | Desktop                              | 形态                                                |
|----------------------------|--------------------------------------|-----------------------------------------------------|
| BrowserCommands (40)       | browser-handler.js                   | Electron 内嵌 puppeteer-like 自动化                  |
| UserBrowserCommands (18)   | user-browser-handler.js              | 控制用户系统浏览器（Chrome/Edge native messaging）   |
| ExtensionCommands (95)     | browser-extension/ 子系统            | Chrome 扩展，独立 WebSocket 通道                     |
```

三个命名空间（`browser.*` / `userBrowser.*` / `extension.*`）必须保持显式区分，不能合并到 `browser.*` 单一命名空间——M4 registry 元数据需要 `target` 字段标识。

### AI / System 各有 enhanced 版

桌面 `handlers/` 下有两对带 `-enhanced.js` 后缀：
- `ai-handler.js` + `ai-handler-enhanced.js`
- `system-handler.js` + `system-handler-enhanced.js`

需 grep 确认 Android `ai.*` / `system.*` 调到哪一版（普通版/enhanced 版），避免双注册重复或 silent 调老版本。**未在 M1 范围验证；标记为 M4 必查项**。

## M4 RemoteSkillRegistry 设计前必决项（findings）

> 这些是 M1 现状梳理引出来的、M4 实现前必须拍板的设计点。每条对应一个具体决策。

### F1 — 注册粒度：file 级 vs method 级

- **选 file 级**（23 个注册项）：粒度粗，桌面 mobileBridge.exposeRemoteSkills 只需列 `"extension.*"` / `"ai.*"` 即可放行整组；UI 也可按 file 折叠
- **选 method 级**（789 个注册项）：粒度细，每个 method 单独白名单 + 单独 ApprovalUI 配置；但 789 配置项不可维护
- **建议**：双层。**白名单层 file 级 + 通配符**（`extension.*` 放行整组 / `extension.deleteCookie` 单 method 黑名单可禁个别）；**ApprovalUI 层 method 级**（用 risk tag 自动派生默认审批策略，per-method override 罕用）。

### F2 — Extension 通道与 handlers/ 通道的 transport 区分

ExtensionCommands 走的不是 `command-router.js` → `handlers/*` 链路，而是 WebSocket → Chrome 扩展。RemoteSkillRegistry 元数据需 `transport: "handler-rpc" | "extension-ws"`，否则 Android client 不知道往哪个 RPC 发包。

### F3 — Browser 三命名空间必须保留

`browser.*` / `userBrowser.*` / `extension.*` 看似可合并但语义完全不同（Electron 内嵌 / 用户系统浏览器 / Chrome 扩展三种 transport）。RemoteSkillRegistry 不要试图统一到 `browser.*`。

### F4 — AI / System enhanced 版本路由

未在 M1 验证 Android `ai.chat` 命中 `ai-handler.js` 还是 `ai-handler-enhanced.js`。两者并存说明可能：(a) enhanced 是替代品但未删老版（→ M4 应 deprecation + alias）；(b) 两者负责不同 method（→ M4 注册元数据需精确到 method 而非 file）。**M4 第一步必查**。

### F5 — Risk tag 单文件多 risk 的处理

23 文件中至少 8 个混合 risk（如 SystemCommands 含 `getEnv`(safe) + `shutdown`(privileged)）。M4 不能仅用文件名做风险分类，必须 per-method 标。建议在 Kotlin 端 *Commands.kt 里加 `@RiskLevel` 注解，Registry 拉取时一并下发桌面。

### F6 — 7 个文件总 fun 数 ≥ 50（厚重 commands）

```
Extension 95 / Desktop 70 / Media 61 / Knowledge 55 / Network 53 / AI 53 / System 49
```

这 7 个文件占 426 / 789 ≈ **54% 的 RPC 表面**。M4 实现建议 **per-file iterative**：先把这 7 个厚重 commands 的元数据写齐，再处理剩余 16 个轻量文件——避免一次性 789 method spec 难以 review。

### F7 — WorkflowCommands 有 6 个 非 suspend fun

唯一一个非全 suspend 的 *Commands.kt。grep 表明这 6 个是 model class 的 `toJson` / `fromJson` / `validate` 类辅助。**不是 RPC 入口**，M4 register 时跳过 non-suspend。或者改为 `companion object`，避免混淆。

### F8 — 当前 23 *Commands.kt 与 18 个 `remote/ui/` 子模块不一对一

Android 端有些 commands 没有对应 UI（如 NetworkCommands 53 funs，但 `remote/ui/network/` 只有 NetworkInfoScreen.kt），有些 UI 没有对应 commands（如 `remote/ui/connection/` 没有 ConnectionCommands.kt）。M4 注册时**只注册 *Commands.kt 暴露的方法**，UI 子模块独立按 widget 注册（不在本 inventory 范围）。

### F9 — `device.pair` + `device.register` 反向流？

DeviceCommands 含 `pair` 和 `register`，看起来是 Android → Desktop 注册自己；但 ADR-6 反向 RPC 的 `sign.request` 应该来自桌面发起到 Android，Android 在 SignAsService（L1 模块）侧暴露。M4 注册元数据需 `direction: "android→desktop" | "desktop→android" | "bidirectional"`，并明确 DeviceCommands.pair/register 的方向。

### F10 — 桌面 mobileBridge.exposeRemoteSkills 默认配置建议

基于本 inventory 风险分类，v1.0 默认建议（设计文档 §配置参考 抽样）：

```jsonc
"exposeRemoteSkills": [
  // safe 默认开
  "system.info.*", "network.get*", "history.*", "display.get*", "storage.getDiskInfo",
  // mutating 选择性开（与桌面用户预期一致的）
  "clipboard.*", "knowledge.*", "notification.*", "media.getVolume", "media.setVolume",
  // privileged 默认不开（用户在 Settings → Mobile Bridge 显式启用）
  // "system.shutdown", "process.kill", "extension.setCookie" 默认禁
  // cowork / workflow 单开
  "cowork.*", "workflow.run", "workflow.status",
  // 反向 RPC L1
  "sign.request"
]
```

**默认黑名单**（用户即便点开也建议保留二次审批）：`system.shutdown`、`system.restart`、`process.kill`、`extension.setCookie`、`extension.executeScript`、`file.delete`、`file.writeFile`（任意路径写）、`device.revoke`。

## 不在本 inventory 范围（M4 必做）

- 每个 method 的精确参数名 / 类型 / 默认值
- 每个 method 的返回值结构
- 每个 method 是否流式（Server-Sent / WebSocket subscribe）
- 每个 method 的超时 / 重试策略
- 每个 method 在桌面 handlers/ 里的实际函数名
- 每个 method 的实际 risk tag（per-method，非 file-level）
- Android `remote/ui/` 18 子模块的 widget 注册（独立轨道）

## M4 D1 method-level 元数据收敛进度（2026-05-11 v0.2）

M4 D1 commit `6e49270fd` 落地 method-level 数据结构 + 部分 seed。状态对照：

| Namespace | File-level 已落 | Method-level seed 数 | 备注 |
|---|---|---|---|
| `ai` | ✅ | **10** | chat/chatStream/getModels/getConversations/deleteConversation/ragSearch/ocrImage/transcribeAudio/textToSpeech/controlAgent — 含 4 个 riskOverride（Safe 降级 getModels/ragSearch 等，Privileged 提级 deleteConversation）+ 2 个 requiresApprovalOverride |
| `knowledge` | ✅ | **10** | createNote/updateNote/deleteNote/getNote/searchNotes/listFolders/createFolder/listTags/createTag/exportNote — 含 4 个 riskOverride（Safe 降级 getNote/searchNotes/listFolders/listTags；Privileged 提级 deleteNote） |
| 其他 21 namespace | ✅ | 0 | `methods = emptyList()`，通过 [桌面 mobile-skill-whitelist.js → Android updateFromRemote] 动态下发。M4 D2 桌面侧已落地 `d6b3926fa`，可生效。 |

**Seed 选择动机**：knowledge / ai 是 KB / AI 工作流的两大核心命名空间，多种 risk 混杂（CRUD 各异），适合演示 method-level override 机制。其他 21 个 namespace 当前 file-level Risk 一致性较高，由桌面下发即可。

## §8.3 Alias 兼容窗口（2026-05-11 v0.2）

`SkillMetadata.aliases: List<String>` + `RemoteSkillRegistry.aliasIndex` 提供 1 版兼容窗口。

**用法**：当某 namespace 改名（如 `browser.extension` → `extension`），把旧名加入 `aliases`：

```kotlin
SkillMetadata(
    namespace = "extension",
    displayName = "Chrome 扩展",
    // ...
    aliases = listOf("browser.extension"),  // 旧名 1 版兼容
)
```

**生效路径**：`registry.get("browser.extension")` 返回 canonical entry；`requiresApproval(alias)` / `listMethods(alias)` / `getMethod(alias, ...)` / `riskForMethod(alias, ...)` 等所有 accessor 自动 resolve。`updateFromRemote` 重建 aliasIndex 以使桌面下发更新生效。

**不变量**：
- alias 不能等于 namespace 本身（`require` 校验）
- alias 不能为空白字符串
- 多个 namespace 用同一 alias 时，最后 register 的覆盖先前的（无显式冲突报错；调用方应保证 alias 全局唯一）

## 变更记录

- 2026-05-11 v0.2：M4 D1 method-level 元数据状态（ai + knowledge 共 20 method seed） + §8.3 alias 兼容窗口落地说明（commit f5...）。
- 2026-05-11 v0.1：M1 现状梳理初稿。精确 fun 计数验证（795/789）、桌面 24 handlers + browser-extension/ 子系统映射、9 项 M4 设计前必决项。Method-level 元数据延后到 M4。

## 附录：规范章节补全（v5.0.3.108）

> 本文为清单 / inventory 文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文清单。

### 1. 概述

见正文头部。Android REMOTE Commands Inventory（M1 现状梳理）为 RemoteSkillRegistry（M4）提供消费源：23 个 `*Commands.kt` 的 fun 计数、命名空间、桌面对端 handler 映射、风险分类。

### 2. 核心特性

23 命令文件 file-level 盘点；fun 计数；命名空间 + 桌面 handler 映射；风险三分类（用于 ADR-3 三道闸）。

### 3. 系统架构

`android-app/.../remote/commands/*Commands.kt` → 桌面对端 handler（24 handlers + browser-extension 子系统）。

### 4. 系统定位

Android REMOTE 能力的**命令清单 / M4 RemoteSkillRegistry 消费源**。

### 5. 核心功能

见正文：File-by-file 清单（按 fun 数降序）、风险分类定义、桌面映射特殊情况、M4 设计前必决项。

### 6. 技术架构

23 `*Commands.kt`；alias 兼容窗口（§8.3）；method-level 元数据延后 M4。

### 7. 系统特点

M1 只做 file-level 盘点；method-level（参数 / 返回 / 是否需审批）由 M4 per-file 深读补全。

### 8. 应用场景

M4 RemoteSkillRegistry 设计输入；风险闸映射。

### 9. 竞品对比

文件级 vs 方法级元数据粒度（见正文「不在本 inventory 范围」）。

### 10. 配置参考

alias 全局唯一约束（见正文 §8.3：多 namespace 同 alias 后注册覆盖）。

### 11. 性能指标

—（清单文档，无性能维度）；fun 计数 795/789 见正文。

### 12. 测试覆盖

精确 fun 计数验证（795/789）；M4 D1 method-level seed（ai+knowledge 20 method）。

### 13. 安全考虑

风险三分类（Safe / Mutating / Privileged）用于 ADR-3 三道闸；privileged 命令需审批（M4）。

### 14. 故障排除

alias 冲突（无显式报错，后注册覆盖）→ 保证 alias 全局唯一（见正文 §8.3）。

### 15. 关键文件

`android-app/.../remote/commands/*Commands.kt`（23）；桌面 24 handlers；`SeedRegistry.kt`（M4）。

### 16. 使用示例

见正文 File-by-file 清单与桌面映射表。

### 17. 相关文档

见正文头部关联：`Android_重新定位_设计文档.md` §ADR-5 / M4 / §8.3。
