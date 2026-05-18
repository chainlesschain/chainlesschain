import Foundation
import CoreP2P

/// 远程操控 DI container — Phase 2.4 (基础) → Phase 3.3 (扩展 framework + skill)。
///
/// 单例模式：v0.1 同时只支持一台已配对桌面的远程操控会话（与 Android Plan A.1
/// v0.1 一致）。切换桌面前必须先 `disconnect()`。
///
/// **职责**：
/// 1. 从 [PairingDependencies] 接力构造 RemoteWebRTCClient + RemoteCommandClient
///    + TerminalRpcClient + RemoteSkillRegistry + OfflineCommandQueue + OfflineQueueDrainer
///    + 4 个 Phase 3 typed skill commands (clipboard / file / screenshot / systemInfo)
/// 2. 起 forwarding task：订阅 `pairingDeps.signalClient.forwardedMessages`
///    路由 answer / ice-candidate / chainlesschain:* 给 RemoteWebRTCClient
///
/// **Phase 3.3 关键架构变化**：
/// - `commandClient` 是 `webRTCClient.inboundMessages` 的**唯一订阅者**（避免
///   AsyncStream 单消费者切分事件）
/// - `terminalRpc` 改用 `commandClient.events` 流（仅 chainlesschain:event 类型）
/// - 4 个 skill commands 共享 `commandClient.invoke` 池
public final class RemoteDependencies: ObservableObject {
    // Phase 2 既有
    public let webRTCClient: RemoteWebRTCClient
    public let terminalRpc: TerminalRpcClient
    public let featureFlags: PlanA1FeatureFlags

    // Phase 3.1 新增（framework core）
    public let commandClient: RemoteCommandClient
    public let skillRegistry: RemoteSkillRegistry

    // Phase 3.2 新增（offline queue）
    public let offlineQueue: OfflineCommandQueue
    public let offlineDrainer: OfflineQueueDrainer

    // Phase 3.3 新增（typed skill: clipboard）
    public let clipboard: ClipboardCommands

    // Phase 3.4 新增（typed skill: file browse + read text）
    public let file: FileCommands

    // Phase 3.5 新增（typed skill: screenshot + system info）
    public let screenshot: ScreenshotCommands
    public let systemInfo: SystemInfoCommands

    // Phase 4.4 新增（typed skill: notification）
    public let notification: NotificationCommands
    public let notificationDispatcher: NotificationEventDispatcher

    // Phase 5.6 新增（typed skill: AI chat — 远程 LLM 对话 + 流式响应 + 对话管理）
    public let aiChat: AIChatCommands
    public let aiChatDispatcher: AIChatEventDispatcher

    // Phase 6.1B1 第 1 批 100% wired skill（typed RPC，无 push event 子流）
    public let input: InputCommands
    public let display: DisplayCommands
    public let application: ApplicationCommands
    public let security: SecurityCommands
    public let userBrowser: UserBrowserCommands

    // Phase 6.1B3 红档桌面已支持子集 batch（D ⊂ A，iOS impl 桌面已支持 method）
    public let power: PowerCommands
    public let process: ProcessCommands
    public let network: NetworkCommands
    public let storage: StorageCommands
    public let device: DeviceCommands
    // sysinfo 既有 Phase 3.5 SystemInfoCommands，扩展 10 个 sysinfo.X method 已落 inline

    // Phase 6.2 主屏 batch 1（media + browser — 桌面 case ⊂ Android invoke）
    public let media: MediaCommands
    public let browser: BrowserCommands

    // Phase 6.5 红档子集 batch 2（workflow + system + history）
    public let workflow: WorkflowCommands
    public let system: SystemCommands
    public let history: HistoryCommands

    // Phase 6.6.1 远程桌面 typed wrapper（7 outer + 5 sendInput sub-type）
    public let desktop: DesktopCommands

    // Phase 6.6.2 虚拟光标 actor (OQ-4 A: iOS 端维护绝对坐标 + 边界 clamp，
    // touch drag → applyDelta → 发 sendInput mouse_move)
    public let desktopVirtualCursor: DesktopVirtualCursor

    // Phase 6.6.3 frame 流式拉取 actor (OQ-1 A pull-based + OQ-2 B in-flight=1 +
    // OQ-7 A drop-old cap=1 + Trap D6 退避 + maxConsecutiveErrors=5 fatal)
    public let desktopFrameStreamer: DesktopFrameStreamer

    private let pairingDeps: PairingDependencies
    private var forwardingTask: Task<Void, Never>?
    private var eventFanOutTask: Task<Void, Never>?

    /// pcPeerId provider — v0.1 单 active 桌面 from PairedDesktopsStore.devices.first.
    /// Phase 4+ 改 user-explicit selection 时这里得改。
    public var currentPcPeerIdProvider: @Sendable () async -> String? {
        let store = pairingDeps.pairedDesktopsStore
        return { await store.devices().first?.pcPeerId }
    }

    @MainActor
    public init(pairingDeps: PairingDependencies) {
        self.pairingDeps = pairingDeps
        self.featureFlags = PlanA1FeatureFlags()

        let transport: WebRTCPeerConnectionTransport = GoogleWebRTCPeerConnectionTransport()
        let pairingStore = pairingDeps.pairedDesktopsStore

        let webRTC = RemoteWebRTCClient(
            signalingGate: pairingDeps.signalingGate,
            messageBus: pairingDeps.messageBus,
            transport: transport,
            iceServersProvider: { pcPeerId in
                let devices = await pairingStore.devices()
                return devices.first(where: { $0.pcPeerId == pcPeerId })?.iceServersJson
            }
        )
        self.webRTCClient = webRTC

        // Phase 3.1: commandClient 是 inboundMessages 的唯一订阅者
        let flags = self.featureFlags
        let cmdClient = RemoteCommandClient(
            dataChannelSender: { text in
                try await webRTC.sendMessage(text)
            },
            signalingSender: { [weak pairingGate = pairingDeps.signalingGate] pcPeerId, envelopeJson in
                guard let gate = pairingGate else {
                    throw TerminalRpcError.allTransportsFailed(lastError: "signalingGate deallocated")
                }
                guard let data = envelopeJson.data(using: .utf8),
                      let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    throw TerminalRpcError.malformedResult(reqId: "", detail: "envelope not JSON")
                }
                try await gate.sendAck(toPeerId: pcPeerId, ackPayload: dict)
            },
            isDataChannelReady: { await webRTC.currentState == .ready },
            inboundMessages: webRTC.inboundMessages,
            featureFlags: flags
        )
        self.commandClient = cmdClient

        // Phase 4.4 → Phase 5.6 — events fan-out：cmdClient.events 是单消费者
        // AsyncStream，terminalRpc + notificationDispatcher + aiChatDispatcher 三订
        // 阅会切分事件 → 单一 fan-out task 消费 cmdClient.events，yield 到三子流
        // 分别给 terminal / notification / aiChat。
        // (Phase 3.3 trap 同模式：单消费者 AsyncStream 解；当只有 1 订阅者时 fan-out
        //  task 透传无副作用)
        // Phase 5.6 aiChat 子流 buffer 512（vs terminal/notification 256）— chat
        // stream chunk 涌得快（token 间隔 50-200ms），更大 buffer 减少丢 chunk 概率
        // (LRU 在 dispatcher 兜底重复)。
        var termLocal: AsyncStream<String>.Continuation!
        let terminalEventsStream = AsyncStream<String>(bufferingPolicy: .bufferingNewest(256)) { c in termLocal = c }
        let terminalEventsContinuation = termLocal!
        var notiLocal: AsyncStream<String>.Continuation!
        let notificationEventsStream = AsyncStream<String>(bufferingPolicy: .bufferingNewest(256)) { c in notiLocal = c }
        let notificationEventsContinuation = notiLocal!
        var aiLocal: AsyncStream<String>.Continuation!
        let aiChatEventsStream = AsyncStream<String>(bufferingPolicy: .bufferingNewest(512)) { c in aiLocal = c }
        let aiChatEventsContinuation = aiLocal!

        // Phase 3.3 refactor: terminalRpc 改用 commandClient.events 流（Phase 4.4
        // 起改用 fan-out 后的 terminalEventsStream，语义不变）
        self.terminalRpc = TerminalRpcClient(
            commandClient: cmdClient,
            eventStream: terminalEventsStream
        )

        // Phase 3.1: SkillRegistry
        self.skillRegistry = RemoteSkillRegistry(store: RegistryStore())

        // Phase 3.2: OfflineQueue + Drainer
        let queue = OfflineCommandQueue()
        self.offlineQueue = queue
        self.offlineDrainer = OfflineQueueDrainer(
            queue: queue,
            commandClient: cmdClient,
            pcPeerIdProvider: { await pairingStore.devices().first?.pcPeerId },
            dataChannelReadyStream: webRTC.dataChannelReady
        )

        // Phase 3.3: ClipboardCommands
        self.clipboard = ClipboardCommands(client: cmdClient)

        // Phase 3.4: FileCommands
        self.file = FileCommands(client: cmdClient)

        // Phase 3.5: ScreenshotCommands + SystemInfoCommands
        self.screenshot = ScreenshotCommands(client: cmdClient)
        self.systemInfo = SystemInfoCommands(client: cmdClient)

        // Phase 4.4: NotificationCommands + EventDispatcher
        // dispatcher 的 PushTarget 在 @MainActor 启动 Task 内 set（避免 init 时
        // 跨 isolation 调用 PushNotificationManager.shared）— Phase 4.4 v0.1 暂用
        // nil 占位，启动 Task 内 attach。
        self.notification = NotificationCommands(client: cmdClient)
        self.notificationDispatcher = NotificationEventDispatcher(
            eventStream: notificationEventsStream,
            pushTarget: nil
        )

        // Phase 5.6: AIChatCommands + EventDispatcher (远程 LLM 对话 streaming)
        self.aiChat = AIChatCommands(client: cmdClient)
        self.aiChatDispatcher = AIChatEventDispatcher(
            eventStream: aiChatEventsStream
        )

        // Phase 6.1B1: 第 1 批 5 个 100% wired skill（Coverage doc §1.4：
        // input/display/userBrowser/security/app 均为 A=D=✓ 完全对齐）
        // - input (10 method): 远程键鼠输入
        // - display (11 method): 显示器信息 / 亮度 / 截屏 / 窗口列表
        // - application (8 method, namespace=`app`): 应用列表 / 启停 / 聚焦
        // - security (8 method): 锁屏 / 防火墙 / AV / 加密 / 更新 状态
        // - userBrowser (18 method): CDP 直连 Chrome/Edge/Brave 控浏览器
        self.input = InputCommands(client: cmdClient)
        self.display = DisplayCommands(client: cmdClient)
        self.application = ApplicationCommands(client: cmdClient)
        self.security = SecurityCommands(client: cmdClient)
        self.userBrowser = UserBrowserCommands(client: cmdClient)

        // Phase 6.1B3: 红档桌面已支持子集 (Coverage doc §1.4)
        // - power (10/34): 关机/重启/睡眠/休眠/锁屏/注销/定时
        // - process (6/30): list/get/search/kill/start/getResources
        // - network (11/53): status/interfaces/DNS/publicIP/wifi/bandwidth/speed/ping/resolve/traceroute/connections
        // - storage (10/41): disks/partitions/usage/folderSize/largeFiles/recentFiles/stats/driveHealth/cleanup/emptyTrash
        // - device (4/12 intersection): register/disconnect/setPermission/updateDevice
        self.power = PowerCommands(client: cmdClient)
        self.process = ProcessCommands(client: cmdClient)
        self.network = NetworkCommands(client: cmdClient)
        self.storage = StorageCommands(client: cmdClient)
        self.device = DeviceCommands(client: cmdClient)

        // Phase 6.2: 主屏 batch 1 (media + browser, 桌面 case ⊂ Android invoke)
        // - media (10/55 method): 音量 / 静音 / 设备 / 播放控制 / 提示音
        // - browser (12/33 method): 内置 chromium 引擎自动化 (Playwright/Puppeteer)
        self.media = MediaCommands(client: cmdClient)
        self.browser = BrowserCommands(client: cmdClient)

        // Phase 6.5: 红档子集 batch 2 (workflow + system + history)
        // - workflow (10/13 method): CRUD + 执行 + 取消 + 历史 + 当前 running
        // - system (5/49 method): execCommand / getInfo / getStatus / notify / screenshot
        //   (namespace `system` 与 `sysinfo` 是 2 个不同 handler)
        // - history (8/7 method 名称分化): 跟桌面 case 名为 ground truth
        self.workflow = WorkflowCommands(client: cmdClient)
        self.system = SystemCommands(client: cmdClient)
        self.history = HistoryCommands(client: cmdClient)

        // Phase 6.6.1: DesktopCommands actor (7 outer + 5 sendInput sub-type via
        // typed helper; Trap D5 — typed helper 全部 route to desktop.sendInput
        // 不暴露顶层伪 method desktop.mouseMove 路径，与 Android 现行模式一致)
        self.desktop = DesktopCommands(client: cmdClient)

        // Phase 6.6.2: DesktopVirtualCursor (OQ-4 A — startSession 后调
        // display.getDisplays + display.getCursorPosition 初始化 screen + reset)
        self.desktopVirtualCursor = DesktopVirtualCursor()

        // Phase 6.6.3: DesktopFrameStreamer (OQ-1 A pull loop)
        // 通过 closure 注入 desktop.getFrame — 解耦 actor 测试时可 mock
        let desktopCmds = self.desktop
        self.desktopFrameStreamer = DesktopFrameStreamer(
            getFrameFn: { [weak desktopCmds, pairingStore] sessionId in
                guard let pcPeerId = await pairingStore.devices().first?.pcPeerId else {
                    throw RemoteSkillError.transportFailed("no paired desktop for frame stream")
                }
                guard let cmds = desktopCmds else {
                    throw RemoteSkillError.transportFailed("DesktopCommands deallocated")
                }
                return try await cmds.getFrame(pcPeerId: pcPeerId, sessionId: sessionId)
            },
            backoffMs: 50,
            maxConsecutiveErrors: 5
        )

        // 起 events fan-out task — 单一消费 cmdClient.events，分发到 terminal +
        // notification + aiChat 三子流（避 AsyncStream 单消费者切分 bug）。
        // Phase 5.6: 加第 3 子流 aiChat (chat.delta/end/error 事件路由)。
        self.eventFanOutTask = Task {
            for await raw in cmdClient.events {
                terminalEventsContinuation.yield(raw)
                notificationEventsContinuation.yield(raw)
                aiChatEventsContinuation.yield(raw)
            }
            terminalEventsContinuation.finish()
            notificationEventsContinuation.finish()
            aiChatEventsContinuation.finish()
        }

        // 起 forwarding task — SignalClient.forwardedMessages → 路由到 webRTC
        let signalClient = pairingDeps.signalClient
        self.forwardingTask = Task { [weak webRTC] in
            let stream = signalClient.forwardedMessages
            for await raw in stream {
                guard let webRTC = webRTC else { return }
                await Self.routeForwardedToWebRTC(raw: raw, client: webRTC)
            }
        }

        // 启动 commandClient + terminalRpc + offlineDrainer + notification/aiChat dispatchers
        let dispatcher = self.notificationDispatcher
        let aiDispatcher = self.aiChatDispatcher
        Task {
            await cmdClient.start()
            await self.terminalRpc.start()
            self.offlineDrainer.start()
            _ = await self.skillRegistry.initialize()
            // Phase 4.4/5.6 — dispatchers 启动需 @MainActor (它们是 @MainActor class);
            // notification: attach PushNotificationManager.shared 后 start
            // aiChat: 无外部 push target，直接 start
            await MainActor.run {
                dispatcher.attach(pushTarget: PushNotificationManager.shared)
                dispatcher.start()
                aiDispatcher.start()
            }
        }
    }

    deinit {
        forwardingTask?.cancel()
        eventFanOutTask?.cancel()
        offlineDrainer.stop()
    }

    /// 解析 forwarded 帧 + 路由到 RemoteWebRTCClient 的对应 handler。
    ///
    /// **路由规则**：
    /// - `payload.type == "answer"` → `handleAnswerFromSignaling`（PC 5 步握手第 5 步）
    /// - `payload.type == "ice-candidate"` → `handleRemoteIceCandidate`（trickle ICE）
    /// - `payload.type` 以 `chainlesschain:` 开头 → `emitInboundFromSignaling`
    ///   （fallback 路径下 stdout/exit/response 会从 signaling 来）
    private static func routeForwardedToWebRTC(raw: String, client: RemoteWebRTCClient) async {
        guard let data = raw.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data),
              let dict = root as? [String: Any],
              let payload = dict["payload"] as? [String: Any],
              let type = payload["type"] as? String else {
            return
        }
        switch type {
        case "answer":
            let sdp: String?
            if let nested = payload["answer"] as? [String: Any] {
                sdp = nested["sdp"] as? String
            } else {
                sdp = payload["sdp"] as? String
            }
            guard let answerSdp = sdp, !answerSdp.isEmpty else { return }
            await client.handleAnswerFromSignaling(SdpDescription(type: .answer, sdp: answerSdp))
        case "ice-candidate":
            let cSdp: String?
            let cMid: String?
            let cLine: Int?
            if let candObj = payload["candidate"] as? [String: Any] {
                cSdp = candObj["candidate"] as? String
                cMid = candObj["sdpMid"] as? String
                cLine = (candObj["sdpMLineIndex"] as? Int) ?? Int(candObj["sdpMLineIndex"] as? Int64 ?? 0)
            } else {
                cSdp = payload["candidate"] as? String
                cMid = payload["sdpMid"] as? String
                cLine = (payload["sdpMLineIndex"] as? Int) ?? 0
            }
            guard let sdp = cSdp, let mid = cMid, let line = cLine, !sdp.isEmpty else { return }
            try? await client.handleRemoteIceCandidate(
                OutboundIceCandidate(sdp: sdp, sdpMid: mid, sdpMLineIndex: Int32(line))
            )
        default:
            if type.hasPrefix("chainlesschain:") {
                let inner: [String: Any] = ["type": type, "payload": payload["payload"] ?? [:]]
                if let innerData = try? JSONSerialization.data(withJSONObject: inner),
                   let innerStr = String(data: innerData, encoding: .utf8) {
                    await client.emitInboundFromSignaling(innerStr)
                }
            }
        }
    }
}
