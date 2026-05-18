import Foundation
import WebKit
import CoreP2P

/// JS → Swift 桥接处理器 — Phase 2.3。
///
/// 由 `TerminalWebView` 在 WKWebView 创建时 register 到
/// `WKUserContentController` 的名字 `"terminalBridge"`。xterm-shell.html
/// 的 polyfill 把 `TerminalBridge.onReady/onResize/onUserInput` 调用统一
/// 序列化成 `{type, ...}` 通过 `window.webkit.messageHandlers.terminalBridge.
/// postMessage(...)` 投到本类。
///
/// **线程**：`WKScriptMessageHandler` 回调默认 main thread。本类把 message
/// parse + dispatch 到 closures，让 `TerminalSessionViewModel` (Phase 2.5) 在
/// `@MainActor` 内消费。
final class TerminalBridge: NSObject, WKScriptMessageHandler {
    typealias OnReady = @MainActor (Int /*cols*/, Int /*rows*/) -> Void
    typealias OnResize = @MainActor (Int /*cols*/, Int /*rows*/) -> Void
    typealias OnUserInput = @MainActor (String /*data*/) -> Void

    private let onReady: OnReady?
    private let onResize: OnResize?
    private let onUserInput: OnUserInput?

    init(
        onReady: OnReady? = nil,
        onResize: OnResize? = nil,
        onUserInput: OnUserInput? = nil
    ) {
        self.onReady = onReady
        self.onResize = onResize
        self.onUserInput = onUserInput
    }

    // MARK: WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "terminalBridge",
              let body = message.body as? [String: Any] else { return }
        guard let parsed = TerminalBridgeMessage.parse(body) else {
            // 静默忽略未知字段（与 xterm-shell.html JS 端 try/catch 容忍 unknown 一致）
            return
        }
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            switch parsed {
            case .onReady(let cols, let rows):
                self.onReady?(cols, rows)
            case .onResize(let cols, let rows):
                self.onResize?(cols, rows)
            case .onUserInput(let data):
                self.onUserInput?(data)
            }
        }
    }
}
