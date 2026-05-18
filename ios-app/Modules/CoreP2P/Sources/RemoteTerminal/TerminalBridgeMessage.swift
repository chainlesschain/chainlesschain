import Foundation

/// JS → Swift 桥接消息 — Phase 2.3。
///
/// xterm-shell.html 内 `TerminalBridge` polyfill 把 `onReady/onResize/onUserInput`
/// 调用统一序列化成 `{type: "...", ...}` 经 WKScriptMessageHandler 投递到 Swift
/// 端。本枚举做强类型解码 + 字段校验。
///
/// **位置**：放在 CoreP2P 而非 Features，让 SwiftPM 单测能 round-trip 验
/// 字段对齐 xterm-shell.html。Phase 2.4+ 的 SessionViewModel 把 .onUserInput
/// 路由到 `TerminalRpcClient.stdin()`、.onResize 路由到 `.resize()`。
public enum TerminalBridgeMessage: Sendable, Equatable {
    /// xterm.fit() 第一次成功时（host size > 0），cols/rows 是真实值。
    case onReady(cols: Int, rows: Int)
    /// host size 变化（iOS 屏幕旋转 / 软键盘 inset / Android AndroidView layout pass）
    /// 触发 fit() 后，新 cols/rows 与上次不同时 emit。
    case onResize(cols: Int, rows: Int)
    /// 用户敲键 / 软键盘工具栏 sendKey — data 是要发给 desktop PTY 的原始字符
    /// （UTF-8 string）。
    case onUserInput(data: String)

    /// 从 JS 投来的字典 (`WKScriptMessage.body as? [String: Any]`) 解码。
    /// 字段缺失或类型错返 nil（caller 静默丢弃）。
    public static func parse(_ body: [String: Any]) -> TerminalBridgeMessage? {
        guard let type = body["type"] as? String else { return nil }
        switch type {
        case "onReady":
            guard let cols = intField(body["cols"]),
                  let rows = intField(body["rows"]) else { return nil }
            return .onReady(cols: cols, rows: rows)
        case "onResize":
            guard let cols = intField(body["cols"]),
                  let rows = intField(body["rows"]) else { return nil }
            return .onResize(cols: cols, rows: rows)
        case "onUserInput":
            guard let data = body["data"] as? String else { return nil }
            return .onUserInput(data: data)
        default:
            return nil
        }
    }

    private static func intField(_ raw: Any?) -> Int? {
        if let n = raw as? Int { return n }
        if let n = raw as? Int64 { return Int(n) }
        if let d = raw as? Double { return Int(d) }
        if let s = raw as? String { return Int(s) }
        return nil
    }
}
