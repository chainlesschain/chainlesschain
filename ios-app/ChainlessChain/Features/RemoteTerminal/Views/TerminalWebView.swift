import SwiftUI
import WebKit
import CoreP2P

/// xterm.js terminal SwiftUI view — Phase 2.3。
///
/// **布局优先参考已真机验证的 Android 端**（memory `feedback_ios_ui_mirrors_validated_android.md`
/// + `android_webview_xterm_resize_observer.md`）：
/// `android-app/app/src/main/java/.../remote/terminal/ui/TerminalWebView.kt`
/// （Plan A.1 v5.0.3.53-fix11 真机收口）。
///
/// **iOS 特化**（design doc §7.3）：
/// - WKWebView 默认 fill superview（不像 Android `AndroidView` 默认 wrap_content
///   会 0×0 死锁）→ 不需要 LayoutParams.MATCH_PARENT 强制
/// - `scrollView.contentInsetAdjustmentBehavior = .never` 关掉 safe area
///   自动 inset，否则 xterm.fit() 算错可视区
/// - `keyboardDisplayRequiresUserAction = false` 让 textarea focus 不需点击
/// - 软键盘弹起 iOS 自动 inset textarea → 触发 ResizeObserver → xterm.fit() 自动响应
///
/// **桥接**：xterm-shell.html 内 polyfill 检测到 iOS 时把 `TerminalBridge.onXxx`
/// 转成 `window.webkit.messageHandlers.terminalBridge.postMessage(...)`，
/// 通过本 view 注入的 [TerminalBridge] 实例 dispatch 到 SwiftUI ViewModel。
///
/// **stdout 写入**：`writeStdout(_:)` 经 `evaluateJavaScript("window.cc.write(...)")`
/// 把 desktop PTY 的 stdout 灌进 xterm.js terminal。多次调用累积显示。
struct TerminalWebView: UIViewRepresentable {
    let onReady: (Int, Int) -> Void
    let onResize: (Int, Int) -> Void
    let onUserInput: (String) -> Void
    /// SwiftUI binding — caller (SessionViewModel) 在收到 stdout 时往这里塞文本，
    /// updateUIView 检测到变更自动 evaluateJavaScript 写进 xterm。
    @Binding var pendingStdout: [String]
    /// SwiftUI binding — exit 事件 payload。**Phase 2.5 改用 ExitEvent struct**
    /// （非 tuple，便于 Equatable + 与 TerminalRpcClient.exitEvents 直接对接）。
    /// flush 后 SessionVM 会 clearPendingExit() 置 nil。
    @Binding var pendingExit: ExitEvent?

    func makeUIView(context: Context) -> WKWebView {
        let bridge = TerminalBridge(
            onReady: { cols, rows in onReady(cols, rows) },
            onResize: { cols, rows in onResize(cols, rows) },
            onUserInput: { data in onUserInput(data) }
        )
        context.coordinator.bridge = bridge

        let userContentController = WKUserContentController()
        userContentController.add(bridge, name: "terminalBridge")

        let config = WKWebViewConfiguration()
        config.userContentController = userContentController
        config.allowsInlineMediaPlayback = true
        // iOS WKWebView 默认 textarea focus 需用户手势触发；关掉这个让 xterm 启动即接收 IME。
        // (Property only available on iOS 14+ via mediaTypesRequiringUserActionForPlayback;
        //  for input element focus we use defaultWebpagePreferences.)
        let prefs = WKWebpagePreferences()
        if #available(iOS 14, *) {
            prefs.allowsContentJavaScript = true
            config.defaultWebpagePreferences = prefs
        }

        let webView = WKWebView(frame: .zero, configuration: config)
        // 关 safe area 自动 inset — 否则 xterm.fit() 算错可视区
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.scrollView.isScrollEnabled = false  // xterm 自己接管滚动
        webView.isOpaque = true
        webView.backgroundColor = UIColor(red: 0x1e/255.0, green: 0x1e/255.0, blue: 0x1e/255.0, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor

        // 加载 bundled xterm-shell.html
        if let htmlUrl = Bundle.main.url(forResource: "xterm-shell", withExtension: "html"),
           let bundleDir = htmlUrl.deletingLastPathComponent() as URL? {
            webView.loadFileURL(htmlUrl, allowingReadAccessTo: bundleDir)
        } else {
            // bundle 资源没找到 — 显示提示而非崩溃
            let html = """
            <html><body style="background:#1e1e1e;color:#fff;font-family:monospace;padding:24px">
            <h3>Terminal bundle missing</h3>
            <p>xterm-shell.html / xterm.js / addon-fit.js / xterm.css 未在 app bundle 内找到。<br>
            请确认 ios-app/ChainlessChain/Features/RemoteTerminal/Bundle/ 已加入 Xcode app target Resources。</p>
            </body></html>
            """
            webView.loadHTMLString(html, baseURL: nil)
        }

        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // 每次 SwiftUI updateUIView 时 flush pendingStdout 队列到 JS
        if !pendingStdout.isEmpty {
            let snapshot = pendingStdout
            DispatchQueue.main.async {
                pendingStdout.removeAll()
            }
            for chunk in snapshot {
                let escaped = jsStringLiteral(chunk)
                webView.evaluateJavaScript("if (window.cc) window.cc.write(\(escaped));", completionHandler: nil)
            }
        }
        // exit 事件 — 写入终端尾部黄色提示
        if let exit = pendingExit {
            let payload = "{ exitCode: \(exit.exitCode.map(String.init) ?? "null"), signal: \(exit.signal.map { "'\(escapeForJsSingleQuoted($0))'" } ?? "null") }"
            webView.evaluateJavaScript("if (window.cc) window.cc.onExit(\(payload));", completionHandler: nil)
            DispatchQueue.main.async {
                pendingExit = nil
            }
        }
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        // SwiftUI 调本方法在 view 卸载前。手动移除 script handler 防 retain cycle —
        // WKUserContentController.add(_:name:) 强引用 handler 直到显式 remove。
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "terminalBridge")
        coordinator.bridge = nil
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        // strong-ref bridge 防止 WKUserContentController 弱引用导致 dealloc
        var bridge: TerminalBridge?
    }

    // MARK: - JS string escaping

    /// JSON-style 安全编码字符串字面量，用于 `evaluateJavaScript("window.cc.write(\"...\")")`。
    private func jsStringLiteral(_ s: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [s], options: []),
              let json = String(data: data, encoding: .utf8) else {
            return "\"\""  // 极少数 fallback
        }
        // json = "[\"escaped string\"]" — 取掉首尾 [] 拿单元素
        let trimmed = json.dropFirst().dropLast()
        return String(trimmed)
    }

    /// 单引号 string literal 简易转义（只用于 onExit 的 signal 字段，文本固定 ASCII）。
    private func escapeForJsSingleQuoted(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
    }
}
