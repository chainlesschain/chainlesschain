import Foundation

/// 显示器信息 typed RPC wrapper — Phase 6.1B1。
///
/// 镜像 Android `app/src/main/java/.../remote/commands/DisplayCommands.kt`。
/// 11 method 全 wired，桌面 `display-handler.js` 与 Android Commands 100% 名称对齐
/// （Coverage doc §1.4：A=11 D=11 ✓=11）。
///
/// **wire 协议**（与桌面 `display-handler.js` 对齐）：
/// - `display.getDisplays` / `display.getPrimary` / `display.getWindowList` —
///   只读 list 端点
/// - `display.getResolution` / `display.getScaling` / `display.getColorDepth` —
///   按 displayId 查询（默认 0 = 主屏）
/// - `display.getBrightness` / `display.setBrightness` — 亮度查询/调整
/// - `display.getRefreshRate` — 屏幕刷新率
/// - `display.getCursorPosition` — 含 displayId + inWorkArea（vs `input.getCursorPosition`
///   只返 x/y）
/// - `display.screenshot` — 截屏（与 Phase 3.5 ScreenshotCommands 入口重叠，
///   但 Display skill 走完整 4 参数表 displayId/format/quality/savePath）
public actor DisplayCommands {

    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) {
        self.client = client
    }

    /// 获取所有显示器列表（只读）。
    public func getDisplays(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> DisplaysListResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "display.getDisplays",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, DisplaysListResponse.decode)
    }

    /// 获取主显示器信息（只读）。
    public func getPrimary(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> PrimaryDisplayResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "display.getPrimary",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, PrimaryDisplayResponse.decode)
    }

    /// 获取分辨率（默认主屏）。
    public func getResolution(
        pcPeerId: String,
        displayId: Int? = nil,
        mobileDid: String? = nil
    ) async throws -> ResolutionResponse {
        var params: [String: Any] = [:]
        if let id = displayId { params["displayId"] = id }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "display.getResolution",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, ResolutionResponse.decode)
    }

    /// 获取屏幕亮度（仅笔记本 / 部分显示器支持，否则返 error）。
    public func getBrightness(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> BrightnessResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "display.getBrightness",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, BrightnessResponse.decode)
    }

    /// 设置屏幕亮度（0-100）。
    public func setBrightness(
        pcPeerId: String,
        brightness: Int,
        mobileDid: String? = nil
    ) async throws -> SetBrightnessResponse {
        guard brightness >= 0 && brightness <= 100 else {
            throw RemoteSkillError.invalidArgument("display.setBrightness: brightness must be 0-100")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "display.setBrightness",
            params: ["brightness": brightness],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, SetBrightnessResponse.decode)
    }

    /// 获取缩放比例（HiDPI 1.0 / 1.25 / 1.5 / 2.0 等）。
    public func getScaling(
        pcPeerId: String,
        displayId: Int? = nil,
        mobileDid: String? = nil
    ) async throws -> ScalingResponse {
        var params: [String: Any] = [:]
        if let id = displayId { params["displayId"] = id }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "display.getScaling",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, ScalingResponse.decode)
    }

    /// 获取屏幕刷新率（Hz）。
    public func getRefreshRate(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> RefreshRateResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "display.getRefreshRate",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, RefreshRateResponse.decode)
    }

    /// 获取色深（24/30 bits 等）。
    public func getColorDepth(
        pcPeerId: String,
        displayId: Int? = nil,
        mobileDid: String? = nil
    ) async throws -> ColorDepthResponse {
        var params: [String: Any] = [:]
        if let id = displayId { params["displayId"] = id }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "display.getColorDepth",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, ColorDepthResponse.decode)
    }

    /// 截屏（完整参数集；Phase 3.5 ScreenshotCommands 是简化入口）。
    ///
    /// - Parameters:
    ///   - displayId: 显示器 ID，nil = 主屏
    ///   - format: `png` / `jpeg`
    ///   - quality: JPEG 质量 1-100（仅 jpeg 有意义）
    ///   - savePath: 桌面路径；nil = 返 base64 data 字段
    public func screenshot(
        pcPeerId: String,
        displayId: Int? = nil,
        format: String = "png",
        quality: Int = 90,
        savePath: String? = nil,
        mobileDid: String? = nil
    ) async throws -> DisplayScreenshotResponse {
        guard quality >= 1 && quality <= 100 else {
            throw RemoteSkillError.invalidArgument("display.screenshot: quality must be 1-100")
        }
        guard format == "png" || format == "jpeg" || format == "jpg" else {
            throw RemoteSkillError.invalidArgument("display.screenshot: format must be png/jpeg")
        }
        var params: [String: Any] = ["format": format, "quality": quality]
        if let id = displayId { params["displayId"] = id }
        if let p = savePath { params["savePath"] = p }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "display.screenshot",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, DisplayScreenshotResponse.decode)
    }

    /// 获取桌面窗口列表。
    public func getWindowList(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> WindowListResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "display.getWindowList",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, WindowListResponse.decode)
    }

    /// 获取鼠标位置（含 displayId + inWorkArea；vs `input.getCursorPosition` 简化版）。
    public func getCursorPosition(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> DisplayCursorPositionResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "display.getCursorPosition",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, DisplayCursorPositionResponse.decode)
    }

    // MARK: - 内部

    private static func decode<T>(
        _ resp: TerminalRpcResponse,
        _ decoder: (String) throws -> T
    ) throws -> T {
        switch resp {
        case .success(_, let resultJson):
            return try decoder(resultJson)
        case .failure(let reqId, let msg):
            throw RemoteSkillError.remoteError(reqId: reqId, message: msg)
        }
    }
}
