import Foundation

/// 桌面截屏返回 — Phase 3.5。
///
/// 与桌面 `desktop-app-vue/.../handlers/display-handler.js` 字段对齐
/// （`display.screenshot` 返 base64 PNG）。
public struct ScreenCaptureResult: Sendable, Equatable {
    public let imageBase64: String   // base64 编码的 PNG
    public let width: Int
    public let height: Int
    public let format: String        // 通常 "png"，未来可能 "jpeg"
    public let timestamp: Int64?     // epoch ms (桌面端可选返)

    public init(imageBase64: String, width: Int, height: Int, format: String, timestamp: Int64? = nil) {
        self.imageBase64 = imageBase64
        self.width = width
        self.height = height
        self.format = format
        self.timestamp = timestamp
    }

    public static func decode(_ json: String) throws -> ScreenCaptureResult {
        guard let data = json.data(using: .utf8),
              let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RemoteSkillError.malformedResult("display.screenshot: invalid JSON")
        }
        guard let imageBase64 = dict["imageBase64"] as? String, !imageBase64.isEmpty else {
            throw RemoteSkillError.malformedResult("display.screenshot: missing imageBase64")
        }
        let width = (dict["width"] as? Int) ?? Int(dict["width"] as? Int64 ?? 0)
        let height = (dict["height"] as? Int) ?? Int(dict["height"] as? Int64 ?? 0)
        let format = (dict["format"] as? String) ?? "png"
        let ts = (dict["timestamp"] as? Int64) ?? Int64(dict["timestamp"] as? Int ?? 0)
        return ScreenCaptureResult(
            imageBase64: imageBase64, width: width, height: height,
            format: format, timestamp: ts > 0 ? ts : nil
        )
    }

    /// 估算 base64 解码后字节数（base64 = 4 chars per 3 bytes，所以 raw = base64.length * 3 / 4）。
    public var estimatedDecodedBytes: Int {
        imageBase64.count * 3 / 4
    }
}
