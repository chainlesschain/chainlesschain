# iOS Phase 3 — 远程操控 Framework + 4 Skill (Clipboard / File / Screenshot / SystemInfo)

> **状态**：Phase 3.1-3.5 落地（Phase 3.6 commit 标记，2026-05-15）— RemoteCommandClient + RemoteSkillRegistry (23 SeedRegistry entries) + OfflineCommandQueue + 4 typed skill commands + RemoteOperateView 5-tab shell + 4 skill UI 全套 + DI wiring；**~264 unit tests across 20+ suites**。**未跑**：Phase 3.7 真机 E2E (Mac+iPhone 在场再做，4 个 skill 各跑一次)。
>
> **依赖**：iOS Phase 1.1-1.6 + Phase 2.1-2.5 已落 (`c30b415a8` + `7613ea710`)；TerminalRpcClient.invoke 已是通用 RPC 雏形；signaling + DC fallback 链路稳定
> **对齐版本**：Android `app/src/main/java/.../remote/` 全套 framework（registry/ + offline/ + commands/ 部分 + ui/RemoteOperateScreen.kt），约 ~50K LOC 总；本 Phase 3 port **framework + 4 skills**，~3500 LOC；其余 19 个 commands 留 Phase 4+ 按需 unlock
> **关联文档**：`docs/design/iOS_Phase_2_Remote_Terminal.md`、`docs/design/iOS_Phase_1_Pairing_Flow_B.md`、Android 端 `docs/design/Android_REMOTE_commands_inventory.md`、memory `ios_remote_terminal_phase2.md` / `ios_remote_operate_phase3.md`（Phase 3 实施 9 trap）

---

## 1. 背景

iOS Phase 1 (桌面配对) + Phase 2 (远程终端) 让 iPhone 能 1 跳直连桌面跑 shell 命令。**Phase 3 把"远程"能力从单一 terminal 推广到通用 RPC framework**：

- iOS 端可以 `client.invoke("clipboard.get", params)` / `"file.list"` / `"screen.capture"` 等等
- 桌面端已有 23 个 `XCommands` handler 处理这些（Android 端早就在用，iOS 现在追平）
- 离线时命令进 queue，连上恢复后自动 drain
- `RemoteSkillRegistry` 跟踪桌面支持哪些 skill，UI 可分组渲染

### 1.1 iOS 已就位 vs 需新建

✅ **已就位**（Phase 2 落地）：
- `TerminalRpcClient.invoke(pcPeerId:, method:, params:, mobileDid:)` — 已是通用 generic RPC 雏形，wire 协议 (chainlesschain:command:request/response/event) 与 Android `RemoteCommandClient` 完全一致
- `RemoteWebRTCClient` + DC/signaling 双路径 + LRU dedup（Phase 2.2）
- `RemoteDependencies` DI container + signaling-forward router

❌ **缺**：
- `RemoteCommandClient`：**抽出** TerminalRpcClient.invoke 成独立 class，让多个 skill 共用同一 invoke 池 + LRU dedup（不是每个 skill 独立 client）
- `RemoteSkillRegistry`：跟踪桌面支持的 skill list；UI 用它做"未启用"灰显 / "需 ApprovalUI" gate
- `OfflineCommandQueue`：UserDefaults JSON 持久化 pending 命令，连上恢复后 drain
- `SkillMetadata` + `SeedRegistry`：23 个 skill 的元数据（namespace / displayName / risk / category），UI 分组用
- `ClipboardCommands` / `FileCommands` / `ScreenshotCommands` / `SystemInfoCommands`：4 个 typed wrapper（Phase 3 demo 4 个，其余 19 个 留 Phase 4+）
- `RemoteOperateView`：替换 PairedDevicesListView 直接进 TerminalListView 的路径，**新建多 tab shell**（terminal + clipboard + file + screenshot + system）

## 2. 目标 & 非目标

### 目标 (Phase 3 in scope)

| # | 项 | 验收 |
|---|---|---|
| G1 | 通用 `RemoteCommandClient.invoke(method:, params:)` 可调任意桌面 RPC | 单测 ≥ 8 + 真机调 1 个非 terminal method 跑通 |
| G2 | RemoteSkillRegistry 23 entries 加载 from SeedRegistry，UI 分组渲染 | 进 RemoteOperateView 看到 Terminal/Clipboard/File/Screenshot/System 5 tab 显示，每个含 risk badge |
| G3 | OfflineCommandQueue：pending 命令 UserDefaults 持久化 + 连上自动 drain | 单测 ≥ 10（含 retry / status 流转 / capacity 上限）+ 真机 disconnect → reconnect 验自动 drain |
| G4 | Clipboard skill：iPhone 读/写桌面剪贴板（text only，v0.1） | 真机：桌面复制文字 → iPhone 显示；iPhone 输入 → 桌面剪贴板更新 |
| G5 | File skill：列文件夹 + 读文件内容（text only，v0.1） | 真机：iPhone 浏览桌面 `~/Documents` 列表，单击 .txt 看内容 |
| G6 | Screenshot skill：触发桌面截屏 → iPhone 收图显示 | 真机：tap "截屏" → iPhone 弹 screenshot preview，可保存到相册 |
| G7 | SystemInfo skill：CPU/内存/磁盘/网络基础指标 | 真机：进 system tab 看 4 项数字实时更新（5s polling） |
| G8 | RemoteOperateView 5 tab segmented + 进每个 skill 触发对应 ViewModel | UI test：tap 5 个 tab 各跳一次都不崩 + 关闭 → 进下个 tab 状态干净 |

### 非目标 (defer 到 Phase 4+)

- **其余 19 个 commands wrapper**（AI / Browser / Display / Input / Knowledge / Media / Network / Notification / Power / Process / Security / Storage / System / UserBrowser / Workflow / History / Application / Desktop / Device / Extension）→ Phase 4+ 按需逐个 unlock
- **Marketplace M0 真验签**（`ManifestSignatureVerifier` 真实现 Ed25519/SLH-DSA hybrid）→ Marketplace 上线后跟进；Phase 3 用 NoOpVerifier 兜底
- **桌面端 push 主动下发 registry update** → Phase 3 仅用 SeedRegistry 兜底（与 Android v1.2/v1.3 stage 一致）
- **clipboard 监视模式**（`clipboard.watch` 实时推 stdout-style 流）→ v0.2；v0.1 仅 get/set 一次性
- **file 写 / 删除 / 上传**（PUT / DELETE / POST 类操作）→ v0.2；v0.1 read-only browse + view text
- **screenshot 区域选择 + OCR**（已在 Plan B 范畴）
- **system 实时 graph chart**（v0.1 仅数字 polling，非 LineChart）

## 3. 架构

### 3.1 数据流

**Skill 调用流**（happy path，DC ready）：
```
iOS                                                    Desktop
RemoteOperateView (Clipboard tab)
  ↓
ClipboardViewModel.copyFromDesktop()
  ↓ await clipboardCommands.get()
ClipboardCommands.get()
  ↓ remoteCommandClient.invoke("clipboard.get", {type:"text"})
RemoteCommandClient.invoke()
  ├─ DC ready? → webRTCClient.sendMessage(envelope)  ──► Desktop mobile-bridge
  └─ DC fail → signalingGate.sendAck                    handleMobileCommand
                                                        ClipboardHandler.get()
                                                        sendToMobile(response)
  ◄─────── inboundMessages: chainlesschain:command:response ──── DC 回应
  ↓
pendingResponses[reqId].resume(.success(resultJson))
  ↓
ClipboardCommands.get() decode → return Result<ClipboardContent>
```

**Offline queue 流**：
```
iOS in-flight: webRTCClient.connectionState == .ready ?
                                                    ┌── true ──► invoke 直接走（同上）
                                                    │
                                                    └── false ─► OfflineCommandQueue.enqueue
                                                                     ↓ UserDefaults persist
                                                                 status = "pending"
                                                                     ↓ on reconnect
                                                                 drain():
                                                                   for pending in pendingList {
                                                                     status = "sending"
                                                                     try invoke()
                                                                     on success → delete
                                                                     on fail → status = "failed", retries++
                                                                   }
```

### 3.2 wire 协议（沿用 Phase 2，所有 skill 共用）

**Outbound** (iOS → Desktop, DC 或 signaling)：
```json
{
  "type": "chainlesschain:command:request",
  "payload": {
    "id": "<uuid>",
    "method": "clipboard.get | file.list | screen.capture | system.info | terminal.* | ...",
    "params": { ... },
    "auth": { "mobileDid": "did:cc:..." }
  }
}
```

**Inbound** (Desktop → iOS)：
```json
{
  "type": "chainlesschain:command:response",
  "payload": {
    "id": "<matching uuid>",
    "result": { ... } | "error": "..."
  }
}
```

**关键**：与 Phase 2 terminal 完全相同的 wire 协议；只是 method 名字 / params shape 因 skill 而异。

### 3.3 Method 列表（Phase 3 v0.1 范围）

| Skill | Method | Params | Result |
|-------|--------|--------|--------|
| Terminal (Phase 2) | `terminal.create/list/stdin/resize/close/history` | 见 Phase 2 doc §3.3 | 见 Phase 2 |
| **Clipboard** | `clipboard.get` | `{type: "text"}` | `{content, type, timestamp}` |
| | `clipboard.set` | `{type: "text", content}` | `{ok}` |
| **File** | `file.list` | `{path}` | `{entries: [{name, isDir, size, mtime}]}` |
| | `file.read` | `{path, encoding?}` | `{content, encoding}` |
| **Screenshot** | `screen.capture` | `{displayId?: 0}` | `{imageBase64, width, height, format: "png"}` |
| **SystemInfo** | `system.info` | `{}` | `{cpu, memory, disk, network, uptime}` |

字段与 Android `*Commands.kt` 1:1，wire-compatible。

## 4. 模块拆分

### 4.1 重构 + 新增 `Modules/CoreP2P/Sources/RemoteTerminal/`（Phase 2 已有目录扩展）

```
Modules/CoreP2P/Sources/RemoteTerminal/  (扩展)
├── (Phase 2 既有 13 个文件保留 — TerminalRpcClient / RemoteWebRTCClient 等)
└── 新增（Phase 3）:
    ├── RemoteCommandClient.swift            ← 从 TerminalRpcClient.invoke 抽出
    ├── RemoteCommandClientProtocol.swift     ← protocol 让 skill commands depend on it
    └── (Phase 3 重构) TerminalRpcClient.swift  ← 改用 RemoteCommandClient 的 invoke
```

**改名考虑**：`RemoteTerminal/` 子目录已包含 Terminal-specific + 通用 WebRTC + 通用 Signaling 边界文件。Phase 3 把它视为 "RemoteCore" 仍合理（不重命名目录，避免 git history noise）。Phase 4+ 若加更多 skill 真扩散到目录混乱，再 refactor 到 `Modules/CoreP2P/Sources/RemoteCore/`。

### 4.2 新建 `Modules/CoreP2P/Sources/RemoteSkills/`

```
Modules/CoreP2P/Sources/RemoteSkills/
├── Registry/
│   ├── RemoteSkillRegistry.swift        actor，跟踪 skills + initialize from disk/seed
│   ├── SkillMetadata.swift              Codable struct (namespace/displayName/category/risk)
│   ├── SkillRiskTag.swift               enum (Safe/Caution/Privileged)
│   ├── SeedRegistry.swift               硬编码 23 entries（与 Android SeedRegistry 1:1）
│   ├── RegistryStore.swift              UserDefaults JSON 持久化
│   └── ManifestSignatureVerifier.swift  protocol + NoOpManifestVerifier
├── Offline/
│   ├── OfflineCommandQueue.swift        actor + UserDefaults JSON
│   ├── OfflineCommandEntity.swift       Codable struct (status: pending/sending/failed)
│   └── OfflineQueueDrainer.swift        监听 webRTC.dataChannelReady 触发 drain
├── Clipboard/
│   ├── ClipboardCommands.swift          typed wrapper { get / set }
│   └── ClipboardModels.swift            ClipboardContent / ClipboardContentType
├── File/
│   ├── FileCommands.swift               typed wrapper { list / read }
│   └── FileModels.swift                 FileEntry / FileContent
├── Screenshot/
│   ├── ScreenshotCommands.swift         typed wrapper { capture }
│   └── ScreenshotModels.swift           ScreenCaptureResult (imageBase64 → UIImage 在 Features)
├── SystemInfo/
│   ├── SystemInfoCommands.swift         typed wrapper { info }
│   └── SystemInfoModels.swift           SystemInfo / CpuInfo / MemoryInfo etc.
└── ViewModels/                          (Phase 3 各 skill ViewModel — CoreP2P 同 Phase 1+2 placement)
    ├── ClipboardViewModel.swift
    ├── FileBrowserViewModel.swift
    ├── ScreenshotViewModel.swift
    └── SystemInfoViewModel.swift
```

### 4.3 新建 `ChainlessChain/Features/RemoteOperate/`（替换 RemoteTerminal/ 入口）

```
Features/RemoteOperate/
├── Views/
│   ├── RemoteOperateView.swift          5 tab shell (Terminal / Clipboard / File / Screenshot / System)
│   ├── ClipboardView.swift              text 读/写 + paste from iOS / copy to iOS
│   ├── FileBrowserView.swift            列表 + path 面包屑 + tap 看 text
│   ├── ScreenshotView.swift             tap "截屏" 按钮 → 显图 → 保存到相册
│   ├── SystemInfoView.swift             4 cards (CPU/Mem/Disk/Net) + 5s polling refresh
│   └── SkillTabPickerView.swift         segmented control + risk badge (绿 Safe / 黄 Caution / 红 Privileged)
└── (复用 Features/RemoteTerminal/Views/TerminalListView.swift 作为第一个 tab)
```

### 4.4 `RemoteDependencies` 扩展（Phase 2 既有）

```swift
public final class RemoteDependencies: ObservableObject {
    public let webRTCClient: RemoteWebRTCClient
    // Phase 3 新增（all built from terminalRpc 共享底层）：
    public let commandClient: RemoteCommandClient            // 共享 invoke 池
    public let skillRegistry: RemoteSkillRegistry
    public let offlineQueue: OfflineCommandQueue
    public let clipboard: ClipboardCommands
    public let file: FileCommands
    public let screenshot: ScreenshotCommands
    public let systemInfo: SystemInfoCommands
    // Phase 2 既有：
    public let terminalRpc: TerminalRpcClient
    public let featureFlags: PlanA1FeatureFlags
}
```

### 4.5 PairedDevicesListView 入口改 RemoteOperateView

Phase 2.4 NavigationLink target 从 `TerminalListView` 改 `RemoteOperateView`；TerminalListView 成为后者第一个 tab。**用户感知零损失**——进入桌面默认仍在 Terminal tab。

## 5. 关键组件设计

### 5.1 `RemoteCommandClient` (新抽象)

```swift
public protocol RemoteCommandClientProtocol: Sendable {
    func invoke(
        pcPeerId: String,
        method: String,
        params: [String: Any],
        mobileDid: String?
    ) async throws -> TerminalRpcResponse
}

public actor RemoteCommandClient: RemoteCommandClientProtocol {
    // 与 Phase 2 TerminalRpcClient.invoke 一模一样的 closures + LRU + pending pool
    // TerminalRpcClient 改成 wrapper：所有 6 method wrapper 内部调 self.commandClient.invoke
}
```

**重构 TerminalRpcClient**：
```swift
public actor TerminalRpcClient {
    private let commandClient: RemoteCommandClient
    private let stdoutContinuation: AsyncStream<StdoutEvent>.Continuation
    // ... stdout/exit subscription on inboundMessages 不变 ...

    public init(commandClient: RemoteCommandClient, ...) { ... }

    public func create(pcPeerId:, shell:) async throws -> CreatedSession {
        let resp = try await commandClient.invoke(pcPeerId: pcPeerId, method: "terminal.create", ...)
        return try TerminalRpcEnvelope.decodeCreatedSession(...)
    }
    // ... 其余 5 method 同样改 commandClient.invoke ...
}
```

**Why 不让 4 个 skill commands 直接 inject `TerminalRpcClient`**：concept-wise wrong（Clipboard 跟 Terminal 没关系）；改名 `RemoteCommandClient` 让职责清晰。

### 5.2 `RemoteSkillRegistry` (actor)

```swift
public actor RemoteSkillRegistry {
    private(set) var skills: [SkillMetadata] = []
    private(set) var byNamespace: [String: SkillMetadata] = [:]
    private var manifestVerifier: ManifestSignatureVerifier = NoOpManifestVerifier()

    public func initialize() async -> Source {
        // 1. 试 disk load (RegistryStore.load)
        // 2. 失败/空 → SeedRegistry.SKILLS
        // 3. replaceAll + persist
    }

    public func updateFromRemote(_ skills: [SkillMetadata]) async throws {
        // Phase 3 v0.1 暂不 enforce signature；NoOpVerifier 直接 accept
        // 验签 logic 已 wired forward-compat（与 Android #21 A.3 AI-3 同模式）
    }

    public func listByCategory() -> [String: [SkillMetadata]] { ... }
    public func listByRisk(_ risk: SkillRiskTag) -> [SkillMetadata] { ... }
    public func requiresApproval(namespace: String, method: String? = nil) -> Bool { ... }
}
```

`SkillMetadata` 字段与 Android `SkillMetadata.kt` (186 LOC) 完全对齐：namespace + displayName + description + category + risk + requiresApproval + transport + iosSourceFile + methodCount + optional [methods]。Phase 3 把 Android `androidSourceFile` 字段改成 `nativeSourceFile` 通用化（iOS / Android 同份 metadata 复用，源代码字段仅指向各自 native 实现）。

`SeedRegistry`：23 个 entries 的硬编码 list（与 Android `SeedRegistry.kt` 393 LOC 1:1 翻译）。

### 5.3 `OfflineCommandQueue` (actor)

```swift
public actor OfflineCommandQueue {
    public enum Status: String, Codable { case pending, sending, failed }

    private var entities: [OfflineCommandEntity] = []
    private let userDefaults: UserDefaults
    private let key = "offline_commands"
    private let maxCapacity = 100  // 与 Android Room 表无 bound 不同；iOS UserDefaults 大 dict 性能差，限 100
    private let maxRetries = 3

    public func enqueue(method: String, params: [String: Any], mobileDid: String?) async {
        guard entities.count < maxCapacity else { return /* drop oldest? log warn */ }
        let entity = OfflineCommandEntity(
            id: UUID().uuidString,
            method: method,
            params: paramsJson,
            authJson: ...,
            timestamp: Int64(Date().timeIntervalSince1970 * 1000),
            status: .pending,
            retries: 0,
            errorMessage: nil
        )
        entities.append(entity)
        persist()
    }

    /// 由 OfflineQueueDrainer 在 webRTC.dataChannelReady 转 true 时调
    public func drain(client: RemoteCommandClient, pcPeerId: String) async {
        let pending = entities.filter { $0.status == .pending && $0.retries < maxRetries }
        for entity in pending {
            updateStatus(entity.id, .sending)
            do {
                _ = try await client.invoke(
                    pcPeerId: pcPeerId,
                    method: entity.method,
                    params: parseJson(entity.paramsJson),
                    mobileDid: parseAuthDid(entity.authJson)
                )
                remove(entity.id)
            } catch {
                updateStatus(entity.id, .failed, errorMessage: error.localizedDescription, incrementRetries: true)
            }
        }
        persist()
    }

    public func count() -> Int { entities.count }
    public func pendingCount() -> Int { entities.filter { $0.status == .pending }.count }
    public func clearOldFailed(olderThanMs: Int64) { ... }
}
```

**OfflineQueueDrainer**：subscribe `webRTCClient.dataChannelReady`；false → true 时调 `queue.drain(client:, pcPeerId:)`。

### 5.4 4 个 typed Skill commands

样例 `ClipboardCommands`：
```swift
public actor ClipboardCommands {
    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) { self.client = client }

    public func get(
        pcPeerId: String,
        type: ClipboardContentType = .text,
        mobileDid: String? = nil
    ) async throws -> ClipboardContent {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "clipboard.get",
            params: ["type": type.rawValue],
            mobileDid: mobileDid
        )
        switch resp {
        case .success(_, let json):
            return try ClipboardContent.decode(json)
        case .failure(let reqId, let msg):
            throw RemoteSkillError.remoteError(reqId: reqId, message: msg)
        }
    }

    public func set(...) async throws -> Bool { ... }
}

public enum ClipboardContentType: String, Sendable { case text, html, image }
public struct ClipboardContent: Sendable, Equatable {
    public let content: String
    public let type: ClipboardContentType
    public let timestamp: Int64
}
```

Same pattern for `FileCommands`、`ScreenshotCommands`、`SystemInfoCommands`，typed result decode each.

### 5.5 RemoteOperateView shell

```swift
struct RemoteOperateView: View {
    let pcPeerId: String
    let deviceName: String
    @State private var selectedSkill: SkillTab = .terminal

    enum SkillTab: String, CaseIterable {
        case terminal, clipboard, file, screenshot, system
        var label: String { ... }
        var icon: String { ... }
    }

    var body: some View {
        VStack(spacing: 0) {
            SkillTabPickerView(selected: $selectedSkill)  // segmented + risk badge
            Group {
                switch selectedSkill {
                case .terminal:    TerminalListView(pcPeerId: pcPeerId, deviceName: deviceName)
                case .clipboard:   ClipboardView(pcPeerId: pcPeerId)
                case .file:        FileBrowserView(pcPeerId: pcPeerId)
                case .screenshot:  ScreenshotView(pcPeerId: pcPeerId)
                case .system:      SystemInfoView(pcPeerId: pcPeerId)
                }
            }
        }
        .navigationTitle(deviceName)
    }
}
```

## 6. Phase 3.x 落地节奏

| Sub-phase | 范围 | 验收 | 估时 |
|-----------|------|------|------|
| **3.1** RemoteCommandClient + Registry + SeedRegistry + RegistryStore | 抽 commandClient + 23 SkillMetadata seed + UserDefaults persist + ManifestSignatureVerifier protocol | 单测 ≥ 12 (commandClient invoke 复用 Phase 2 测试 + 4 registry 测试 + persist round-trip) | 1.5 day |
| **3.2** OfflineCommandQueue + OfflineQueueDrainer | actor + UserDefaults JSON + status enum + retry + capacity limit + drainer 监听 dataChannelReady | 单测 ≥ 10 (enqueue / drain happy / drain partial fail / capacity reject / persist round-trip / drainer 触发) | 1.0 day |
| **3.3** ClipboardCommands + ClipboardView + 入口接通 | typed wrapper + SwiftUI view (paste from iOS / copy to iOS) + RemoteOperateView shell + tab picker + entry refactor | 单测 ≥ 6 + 模拟器手动验：tap clipboard tab + 模拟桌面响应 | 1.5 day |
| **3.4** FileCommands + FileBrowserView | list + read text + 面包屑 + 文件 icon (folder/text/binary) | 单测 ≥ 8 + 模拟器手动验 | 1.5 day |
| **3.5** ScreenshotCommands + ScreenshotView + SystemInfoCommands + SystemInfoView | 截屏 base64 → UIImage + 4 cards system info + 5s polling | 单测 ≥ 6 + 模拟器手动验 | 1.5 day |
| **3.6** Refactor TerminalRpcClient to use commandClient + 收口 (memory + commit + close issue) | TerminalRpcClient invoke() 内部改调 commandClient.invoke()；测试不破 | 既有 163 测试全绿 + Phase 3 新测试 ≥ 50 累计 | 1.0 day |

**总计 ~8 day** 聚焦工作（用户给的 ~10 day budget 内）。

## 7. iOS 特有 traps（实施时必看）

延续 Phase 1+2 模式：

### 7.1 `RemoteCommandClient` 抽出后，TerminalRpcClient 测试可能要重写

Phase 2 `TerminalRpcClientTests` 通过 closures inject sender/inbound 测试 invoke 行为。Phase 3.6 重构后 `TerminalRpcClient` 委托给 `RemoteCommandClient`，原测试可能：
- (a) 仍能 work（如果 closures 注入路径不变） — 推荐
- (b) 部分 invoke-related 测试迁移到新 RemoteCommandClientTests，TerminalRpcClient 留 6 method wrapper + stdout/exit dedup 测试

策略 (a) 优先；不行再 (b)。Phase 3.6 实施时确认。

### 7.2 SeedRegistry 23 entries 翻译易错

Android `SeedRegistry.kt` 393 LOC 是手写 23 个 SkillMetadata literals；iOS port 同样手写 23 个 + UnitTest 对照 Android 文件做 namespace + displayName + risk 字段一致性检查。

**修法**：写 iOS SeedRegistry 时**严格逐行对照 Android 文件**，commit msg 标 `mirrors android-app/.../SeedRegistry.kt @<commit>`。Phase 3.1 单测加 `testSeedHasAllAndroidNamespaces` 写死预期 23 namespaces 列表。

### 7.3 OfflineCommandQueue UserDefaults 大 list 性能

iOS UserDefaults 不适合存大 dict / array — `set(_:forKey:)` 内部全量序列化 → 写盘。capacity = 100 + 平均每 entity ~500 bytes ≈ 50KB，每次 enqueue 50KB 序列化～ 1ms 以内 OK。

但**注意**：每次 enqueue 后 immediately persist 是必须的（崩溃恢复），不能 batch。Phase 3.2 单测对 1000 次 enqueue 的总耗时设 1s budget 验证。

### 7.4 Screenshot base64 → UIImage：内存 spike

桌面端 1080p screenshot ~2MB PNG = base64 ~2.7MB string。iOS 端 `Data(base64Encoded:)` + `UIImage(data:)` 短期内会有 ~5-10MB 内存 spike（base64 decode + PNG decompress + UIImage backing）。iOS app 内存 budget 通常 ~500MB，单张 OK 但**高频截屏 + 不及时释放**会 OOM。

**修法**：`ScreenshotViewModel` 收图后立即释放 base64 string；`@Published var capturedImage: UIImage?` 替换上张前显式 `= nil`；`autoreleasepool` 包 base64 decode 块。

### 7.5 File path 编码 — Windows backslash vs Unix slash

iOS `FileBrowserView` 显示 path 时，Windows 桌面返 `C:\Users\xx\Documents` 与 Unix `/home/xx` 不同。面包屑解析 separator 必须**用桌面 platform 字段（Phase 1 PairedDesktop.platform）决定**：
- `win32` → split by `\` 或 `/`（Windows 容忍 mixed）
- `darwin` / `linux` → split by `/`

**修法**：`FileBrowserViewModel` init 时拿 `pairedDesktop.platform`，构造 path utility 闭包按 platform 选 separator。

### 7.6 Combine 单消费者 stream 的 Phase 3 影响

Phase 2.5 已记 trap：AsyncStream 单消费者。Phase 3 多 skill 同时活跃时（用户在 RemoteOperateView 切 tab），各 ViewModel 都试图 subscribe 同一 inboundMessages 流 → 切分事件给不同 VM。

**修法**：Phase 3 v0.1 仍保持单 active VM 假设（用户切 tab 时旧 VM 主动 cancel 订阅，新 VM 起订）；**OR** 早做 Phase 2.5 trap #2 提到的 Combine 多播 refactor。Phase 3.1 实施时决定。

### 7.7 同 Phase 1+2 已记 trap 持续生效

复用 Phase 1+2 的 inner-struct StateObject pattern / actor+Combine .receive(on: .main) / iOS 15 NavigationLink isActive / UI mirror Android 等约束。详见 memory `ios_qr_pairing_three_flows.md` + `ios_remote_terminal_phase2.md`。

## 8. 测试策略

### 8.1 单元测试目标 ≥ 50 (Phase 3 累计)

| 文件 | tests | 重点 |
|------|-------|------|
| `RemoteCommandClientTests.swift` | ≥ 8 | 抽出后行为 1:1 等价 Phase 2 TerminalRpcClient.invoke 测试 |
| `RemoteSkillRegistryTests.swift` | ≥ 8 | initialize disk/seed / updateFromRemote / listByCategory / listByRisk / requiresApproval / NoOpVerifier accept |
| `SeedRegistryTests.swift` | ≥ 4 | 23 entries 数量 / namespace 唯一 / risk 分布合理 / category 全集 |
| `OfflineCommandQueueTests.swift` | ≥ 10 | enqueue / drain happy / drain partial fail + retry / capacity reject / persist round-trip / clearOldFailed / pendingCount |
| `OfflineQueueDrainerTests.swift` | ≥ 4 | dataChannelReady false→true 触发 drain / 重复 ready 不重复 drain |
| `ClipboardCommandsTests.swift` | ≥ 4 | get/set encode/decode round-trip / error path |
| `FileCommandsTests.swift` | ≥ 6 | list 解 entries 数组 / read text / read binary base64 |
| `ScreenshotCommandsTests.swift` | ≥ 3 | capture decode base64 / 错误 path |
| `SystemInfoCommandsTests.swift` | ≥ 3 | info decode 4 sub-fields |
| `ClipboardViewModelTests.swift` | ≥ 4 | copyFromDesktop / pasteToDesktop / lastError |
| 其它 ViewModel tests (File/Screenshot/SystemInfo) | ≥ 12 | 类似 |

**累计 ≥ 66**，目标 ≥ 50 留余量。

### 8.2 集成测试

`RemoteCommandIntegrationTests.swift` 用 fake stack（FakeWebRTCClient + FakeSignalingGate）模拟全链：iOS invoke → 入站响应 → 解码 → 检查典型 case。

### 8.3 真机 E2E（Phase 3.7 — 与 Phase 2.7 合并跑）

桌面端 4 skill handler 已有（Android 已用，iOS 同 wire 协议），无桌面 follow-up 需要。iOS 真机测：
- Clipboard 双向（iPhone ↔ macOS Clipboard）
- File 浏览 `~/Documents` + 看 README.md
- Screenshot 一次截图保存到相册
- SystemInfo 4 cards 数字非 0

## 9. 风险 & open questions

| 风险 | 影响 | 缓解 |
|------|------|------|
| RemoteCommandClient 抽出 break Phase 2 既有 163 测试 | 高 | Phase 3.6 重构时**先**跑全套 Phase 2 测试 baseline，逐文件 refactor 不批量 |
| SeedRegistry 23 entries 字段对错 | 中 — 单点错可能让某 skill UI 显示错误 risk | Phase 3.1 单测加严 namespace 列表硬编码对比 |
| Screenshot 内存 spike 在 iPhone 8 / 老设备 OOM | 中 | autoreleasepool + 立即 release ；测试在低端设备验 |
| File API 桌面端**未必**已 ship | 低 — Android 已用证明桌面端有 | Phase 3.4 实施前 grep 桌面 `desktop-app-vue/src/main/.../handlers/file-handler.js` 确认 |
| OfflineQueueDrainer 与 Phase 2 webRTC.dataChannelReady stream 单消费者冲突 | 中 | Phase 3.2 与 TerminalListViewModel 用同 stream — 必须做 §7.6 决定（v0.1 单订 vs Combine 多播） |
| 4 skill UI 体验差（首版功能 minimal） | 低 — Phase 3 是 framework 验证，UI 精修在 Phase 4+ | UI 文案明确"v0.1"；用户预期管理 |

### 决策记录（2026-05-15 锁定）

| # | 决策 | 理由 |
|---|------|------|
| **OQ-1** Skill ViewModel placement | **CoreP2P** (延续 Phase 1+2) | 同 SwiftPM testability 约束（Features 不可 import）。放 `Modules/CoreP2P/Sources/RemoteSkills/ViewModels/`。 |
| **OQ-2** Screenshot 保存策略 | **显式 "保存到相册" 按钮** | iOS HIG 强调 user explicit consent；自动保存会让用户惊讶 + 触发 Photos permission prompt 时序混乱。 |
| **OQ-3** SystemInfo polling 间隔 | **5s** (与 Android 对齐) | 用户感知接近实时；CPU/网络 5s 抓 1 次桌面端 ~10ms 开销可忽略；省电平衡。 |
| **OQ-4** File 路径根 | **桌面 home dir** (Win = `%USERPROFILE%`，*nix = `$HOME`) | v0.1 不让用户配置根目录；桌面端 `file-handler.js` 默认就是 home，省一次 config 步骤。Phase 4+ 加用户自定义 root。 |
| **OQ-5** Combine 多播 refactor | **不做**（保持 v0.1 单 active VM 假设） | RemoteOperateView segmented 切 tab 时旧 VM 显式 cancel 订阅，新 VM 起订；架构干净。Phase 4+ 真同时多 VM 需要时再 refactor。 |

## 10. 不在范围（明确 defer）

- **其余 19 commands wrapper** → Phase 4+ 按需 unlock，每个独立 mini design doc
- **桌面端 push 主动下发 registry update** → 等 Marketplace M0
- **Marketplace 真验签** → 等 Marketplace M0
- **Skill UI 精修**（Clipboard 监视模式 / File 写删除上传 / Screenshot 区域选择 / SystemInfo Chart） → v0.2+
- **远程屏幕 (RDP / VNC 类)** → 不在 framework 范畴，未来 Plan B
- **iOS WatchOS skill** → 不在路线图

---

## 附录 A — 关键文件指针

桌面端（已稳定，**禁止改字段名**）：
- handlers: `desktop-app-vue/src/main/p2p/desktop-mobile/handlers/{clipboard,file,screen,system-info}-handler.js`
- mobile-bridge: `desktop-app-vue/src/main/p2p/mobile-bridge.js`（sendToMobile 已优先 DC）

Android 端（移植参考，**逐文件比照**）：
- `android-app/app/src/main/java/.../remote/registry/{RemoteSkillRegistry,SeedRegistry,SkillMetadata,RegistryStore,ManifestSignatureVerifier}.kt`
- `android-app/app/src/main/java/.../remote/offline/OfflineCommandQueue.kt`
- `android-app/app/src/main/java/.../remote/commands/{Clipboard,File,Display,SystemInfo}Commands.kt` (4/23 个 Phase 3 范围)
- `android-app/app/src/main/java/.../remote/client/RemoteCommandClient.kt` (Phase 3.1 移植蓝本)
- `android-app/app/src/main/java/.../remote/ui/RemoteOperateScreen.kt` (272 LOC tab shell)
- 全套 23 commands inventory: `docs/design/Android_REMOTE_commands_inventory.md`

memory（强烈建议读完再开工）：
- `ios_remote_terminal_phase2.md` — Phase 2 实施 9 trap，Phase 3 大量 pattern 沿用
- `ios_qr_pairing_three_flows.md` — Phase 1 实施 6 trap
- `feedback_ios_ui_mirrors_validated_android.md` — UI 优先抄 Android 验证版

## 附录 B — 文档同步 follow-up

本文件英文名。两个 sync 脚本 ROOT_FILE_MAP 已知 trap (memory `docs_site_sync_unmapped_fallthrough.md`)。提交时同步：
- `docs-site/scripts/sync-design-docs.js` ROOT_FILE_MAP 加 `'iOS_Phase_3_Remote_Operate_Framework.md': 'mobile/ios/phase-3-remote-operate.md'`
- `docs-site-design/scripts/sync-docs.js` 加同样 entry
- 跑两个 sync 脚本验文档站可见

## 附录 C — 与 Phase 1 / 2 关系

```
Phase 1 (✅ c30b415a8 + a411b1887)
  └─ 桌面配对三流 + PairedDesktopsStore
       │
       └──→ Phase 2 (✅ 7613ea710)
              └─ 远程桌面终端 (TerminalRpcClient.invoke 通用 RPC 雏形)
                   │
                   └──→ Phase 3 (本文)
                          └─ 远程操控 framework (RemoteCommandClient 抽出)
                              + 4 skill (Clipboard / File / Screenshot / SystemInfo)
                              + RemoteOperateView 5 tab shell
                                   │
                                   └──→ Phase 4+ (defer)
                                          └─ 其余 19 commands 按需 unlock
                                              + Marketplace M0 真验签
                                              + skill UI 精修
```

Phase 3 落地后 iOS 端用户体验：扫描配对 → 进 Settings → 桌面配对 → 已配对桌面 → 进 RemoteOperateView → segmented control 切 5 tab（Terminal | Clipboard | File | Screenshot | System），每个 tab 都能跑通 happy path。

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述

见正文「1. 背景」。iOS Phase 3 远程操控 Framework + 4 typed skill（Clipboard / File / Screenshot / SystemInfo）：RemoteCommandClient + RemoteSkillRegistry（23 SeedRegistry）+ OfflineCommandQueue + 5-tab shell，~264 unit tests。

### 2. 核心特性

通用 RemoteCommandClient（单 invoke 池）；4 typed skill；OfflineCommandQueue + drainer；5-tab RemoteOperateView。

### 3. 系统架构

见正文「3. 架构」+「5. 关键组件设计」；RemoteCommandClient 从 Phase 2 抽出，DC/signaling 双路径。

### 4. 系统定位

iOS 端**远程操控框架 + 4 skill**（Phase 3）。

### 5. 核心功能

见正文「4. 模块拆分」：Clipboard / File / Screenshot / SystemInfo（各 typed wire 协议）。

### 6. 技术架构

RemoteCommandClient（DC 优先 + LRU dedup + continuation timeout 清理）；RemoteSkillRegistry 23 SeedRegistry；NoOpManifestVerifier（Marketplace M0 seam）。

### 7. 系统特点

单消费者 inboundMessages（收口 commandClient）；offline queue 崩溃恢复（sending→pending）。

### 8. 应用场景

iPhone 远程操控桌面：剪贴板 / 文件浏览 / 截屏 / 系统信息。

### 9. 竞品对比

镜像 Android 23 SeedRegistry（methodCount 795）。

### 10. 配置参考

RemoteSkillRegistry 白名单（文件 + 方法双粒度）；risk tag（Safe/Mutating/Privileged）。

### 11. 性能指标

DC 直连低延迟（见 `iOS_Phase_6_0_RealDevice_E2E_Plan.md` 段 C）。

### 12. 测试覆盖

~264 unit tests across 20+ suites；真机 E2E Phase 3.7 待跑（4 skill 各一次）。

### 13. 安全考虑

skill 白名单 + risk tag；截屏 PHPhotoLibrary 显式 prompt；走配对信任。

### 14. 故障排除

Clipboard skill timeout（单消费者 fan-out 真因）/ 截屏保存失败（照片权限）→ 见 `iOS_Phase_6_0_RealDevice_E2E_Plan.md` 段 C。

### 15. 关键文件

`Modules/CoreP2P/RemoteSkills/`（RemoteCommandClient / Registry / OfflineQueue / 4 skill）；`Features/RemoteOperate/`。

### 16. 使用示例

见正文末用户体验（5-tab RemoteOperateView 切换）。

### 17. 相关文档

`iOS_Phase_2_Remote_Terminal.md`、`iOS_Phase_4_Notification_Skill.md`、`iOS_Phase_5_AI_Chat_Skill.md`。
