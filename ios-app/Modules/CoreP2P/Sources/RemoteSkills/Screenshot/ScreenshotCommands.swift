import Foundation

/// 桌面截屏 typed RPC wrapper — Phase 3.5 v0.1。
///
/// **v0.1 范围**：单帧截屏 (整个桌面屏幕)。多屏 / 区域选择 / OCR 留 v0.2+。
///
/// **wire 协议**（与桌面 `display-handler.js` 对齐）：
/// - `display.screenshot` params: `{displayId?: 0, format?: "png"}` →
///   `{imageBase64, width, height, format, timestamp?}`
public actor ScreenshotCommands {

    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) {
        self.client = client
    }

    /// 截当前桌面屏幕。`displayId` 0 = 主屏（v0.1 默认；多屏选择留 v0.2）。
    public func capture(
        pcPeerId: String,
        displayId: Int = 0,
        mobileDid: String? = nil
    ) async throws -> ScreenCaptureResult {
        let response = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "display.screenshot",
            params: [
                "displayId": displayId,
                "format": "png"
            ],
            mobileDid: mobileDid
        )
        switch response {
        case .success(_, let resultJson):
            return try ScreenCaptureResult.decode(resultJson)
        case .failure(let reqId, let msg):
            throw RemoteSkillError.remoteError(reqId: reqId, message: msg)
        }
    }
}
