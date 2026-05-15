import Foundation

/// 剪贴板内容类型 — Phase 3.3。
///
/// 与桌面 `desktop-app-vue/src/main/.../handlers/clipboard-handler.js` 字段对齐。
/// **v0.1 仅 `text` 端到端接通**；html / image 留 v0.2。
public enum ClipboardContentType: String, Codable, Sendable, Equatable {
    case text
    case html
    case image
}

/// 剪贴板内容 — Phase 3.3。
///
/// `clipboard.get` 返。content 字段对 image 是 base64 编码字符串（v0.2 才用）；
/// 对 text/html 是原文。
public struct ClipboardContent: Codable, Sendable, Equatable {
    public let content: String
    public let type: ClipboardContentType
    public let timestamp: Int64?  // epoch ms (桌面端可选返)

    public init(content: String, type: ClipboardContentType, timestamp: Int64? = nil) {
        self.content = content
        self.type = type
        self.timestamp = timestamp
    }

    /// 从 result JSON 字符串解码。失败 throw。
    public static func decode(_ json: String) throws -> ClipboardContent {
        guard let data = json.data(using: .utf8) else {
            throw RemoteSkillError.malformedResult("clipboard content: invalid utf8")
        }
        // 接受桌面端返 type 缺省（默认 text）+ timestamp 缺省（nil）
        let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        guard let content = dict["content"] as? String else {
            throw RemoteSkillError.malformedResult("clipboard content: missing 'content' field")
        }
        let typeStr = (dict["type"] as? String) ?? "text"
        let type = ClipboardContentType(rawValue: typeStr) ?? .text
        let ts = (dict["timestamp"] as? Int64) ?? Int64(dict["timestamp"] as? Int ?? 0)
        return ClipboardContent(content: content, type: type, timestamp: ts > 0 ? ts : nil)
    }
}

/// `clipboard.set` 响应 — 简单 ok 状态。
public struct ClipboardSetResponse: Sendable, Equatable {
    public let ok: Bool
    public let bytesWritten: Int?

    public init(ok: Bool, bytesWritten: Int? = nil) {
        self.ok = ok
        self.bytesWritten = bytesWritten
    }

    public static func decode(_ json: String) throws -> ClipboardSetResponse {
        guard let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return ClipboardSetResponse(ok: false)
        }
        let ok = (dict["ok"] as? Bool) ?? false
        let bytes = (dict["bytesWritten"] as? Int) ?? Int(dict["bytesWritten"] as? Int64 ?? 0)
        return ClipboardSetResponse(ok: ok, bytesWritten: bytes > 0 ? bytes : nil)
    }
}
