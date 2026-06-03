import Foundation
import Combine

/// 单 session 终端会话 ViewModel — Phase 2.5。
///
/// 镜像 Android `TerminalSessionViewModel`（设计 doc §6 Phase 2.5）：
/// - 进入 session view 时订阅 `terminalRpc.stdoutEvents/exitEvents`，过滤
///   仅本 sessionId 的事件，emit 进 `pendingStdout/pendingExit` @Published
///   字段；TerminalWebView 通过 SwiftUI binding 自动 flush 进 xterm.js
/// - xterm.js 端 onUserInput / onResize / onReady 通过 callbacks 触发
///   `terminalRpc.stdin/resize`
/// - close() 调 `terminalRpc.close` + cancel subscriber tasks
///
/// **位置**：CoreP2P 模块（同 Phase 1.3+1.5+2.4 placement pattern）。
///
/// **v0.1 单 session 限制**（与 Android v0.1 一致）：同一时刻仅一个
/// SessionVM 订阅 stdoutEvents 流。AsyncStream 单消费者语义；多 VM 并存
/// 会切分事件给不同 VM。Phase 2 v0.2 再上多 session 并发 UI。
@MainActor
public final class TerminalSessionViewModel: ObservableObject {

    public let pcPeerId: String
    public let sessionId: String
    public let shell: String

    /// 待 flush 到 xterm.js 的 stdout chunk 队列。TerminalWebView SwiftUI
    /// binding 在 updateUIView 内 evaluateJavaScript("window.cc.write(...)")
    /// 后清空。
    @Published public var pendingStdout: [String] = []
    /// 待 flush 的 exit 事件。flush 后 View 清成 nil。
    @Published public var pendingExit: ExitEvent?

    @Published public private(set) var lastError: String?
    /// xterm.js onReady 回调后置 true（cols/rows 已定）。
    @Published public private(set) var isReady: Bool = false
    /// 桌面 PTY 已 exit（exit event 收到）。UI 可以 disable stdin 输入。
    @Published public private(set) var hasExited: Bool = false

    private let terminalRpc: TerminalRpcClient
    private let currentDIDProvider: () -> String?

    private var stdoutTask: Task<Void, Never>?
    private var exitTask: Task<Void, Never>?

    public init(
        pcPeerId: String,
        sessionId: String,
        shell: String,
        terminalRpc: TerminalRpcClient,
        currentDIDProvider: @escaping () -> String?
    ) {
        self.pcPeerId = pcPeerId
        self.sessionId = sessionId
        self.shell = shell
        self.terminalRpc = terminalRpc
        self.currentDIDProvider = currentDIDProvider
    }

    deinit {
        stdoutTask?.cancel()
        exitTask?.cancel()
    }

    /// View onAppear 调用一次。idempotent — 已订阅则跳过重订。
    public func onAppear() async {
        if stdoutTask == nil {
            subscribeStdout()
        }
        if exitTask == nil {
            subscribeExit()
        }
    }

    /// xterm.js 第一次成功 `fit()` 时通过 bridge 投来 `{type:"onReady", cols, rows}`，
    /// View 转给本方法。同步推首次 resize 给桌面 PTY。
    public func onReady(cols: Int, rows: Int) async {
        isReady = true
        await pushResize(cols: cols, rows: rows, isInitial: true)
    }

    /// xterm.js host size 变化时投 `{type:"onResize", cols, rows}`，View 转给本方法。
    public func onResize(cols: Int, rows: Int) async {
        await pushResize(cols: cols, rows: rows, isInitial: false)
    }

    /// xterm.js onData → bridge 投 `{type:"onUserInput", data}`，View 转给本方法。
    public func onStdin(data: String) async {
        if hasExited { return }
        let did = currentDIDProvider()
        do {
            try await terminalRpc.stdin(
                pcPeerId: pcPeerId,
                sessionId: sessionId,
                data: data,
                mobileDid: did
            )
        } catch {
            lastError = "发送输入失败：\((error as NSError).localizedDescription)"
        }
    }

    /// 用户主动关闭。idempotent — 已 exit 也可调（桌面 PTY 已 close 时返 ok）。
    public func close() async {
        let did = currentDIDProvider()
        try? await terminalRpc.close(
            pcPeerId: pcPeerId,
            sessionId: sessionId,
            mobileDid: did
        )
        stdoutTask?.cancel()
        exitTask?.cancel()
        stdoutTask = nil
        exitTask = nil
    }

    /// View 已经把 pendingStdout flush 到 xterm.js 后调本方法清空队列。
    public func clearPendingStdout() {
        pendingStdout.removeAll()
    }

    /// View 已经把 pendingExit 写到 xterm.js (yellow banner) 后调本方法清空。
    public func clearPendingExit() {
        pendingExit = nil
    }

    // MARK: - Private

    private func subscribeStdout() {
        let stream = terminalRpc.stdoutEvents
        let myId = sessionId
        stdoutTask = Task { [weak self] in
            for await event in stream {
                guard event.sessionId == myId else { continue }  // 过滤其它 session 事件
                guard let self = self else { return }
                await MainActor.run {
                    self.pendingStdout.append(event.data)
                }
            }
        }
    }

    private func subscribeExit() {
        let stream = terminalRpc.exitEvents
        let myId = sessionId
        exitTask = Task { [weak self] in
            for await event in stream {
                guard event.sessionId == myId else { continue }
                guard let self = self else { return }
                await MainActor.run {
                    self.pendingExit = event
                    self.hasExited = true
                }
            }
        }
    }

    private func pushResize(cols: Int, rows: Int, isInitial: Bool) async {
        guard cols > 0, rows > 0 else { return }
        let did = currentDIDProvider()
        do {
            try await terminalRpc.resize(
                pcPeerId: pcPeerId,
                sessionId: sessionId,
                cols: cols,
                rows: rows,
                mobileDid: did
            )
        } catch {
            // resize 失败不致命（terminal 仍 work，只是 PTY 行宽对不上）—
            // 仅 isInitial 时报 lastError，避免频繁 IME 弹收时 UI 噪音
            if isInitial {
                lastError = "终端尺寸同步失败：\((error as NSError).localizedDescription)"
            }
        }
    }
}
