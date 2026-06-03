import Foundation

/// 远程桌面 typed RPC wrapper — Phase 6.6.1 (sub-phase 1 of 6)。
///
/// 镜像 Android `app/src/main/java/.../remote/commands/DesktopCommands.kt` 桌面已支持
/// **7 outer method + 5 sendInput sub-type** （Coverage doc §3.1 ✅ 已解决；
/// Phase 6.6 doc §1.3 详）：
/// - 桌面 outer 7: startSession / stopSession / getFrame / sendInput /
///   getDisplays / switchDisplay / getStats
/// - sendInput 内层 5 sub-type: mouse_move / mouse_click / mouse_scroll /
///   key_press / key_type
/// - Android 51 invoke 中 44 个 (adjustQuality / 窗口 CRUD / annotations /
///   OCR / recordings 等) **桌面返 Unknown action**，不在 Phase 6.6 v0.1 scope
///
/// **Trap D5（Phase 6.6 doc §7.2）**：iOS 顶层 helper 不暴露 `desktop.mouseMove`
/// 路径 — 5 个鼠键 helper 全部走 `desktop.sendInput` + type sub-dispatch，与
/// Android 现行模式一致。直调 `desktop.mouseMove` 桌面会 throw "Unknown action"。
///
/// **wire 协议**（与桌面 `remote-desktop-handler.js` + Android `DesktopCommands.kt`
/// 100% 兼容）：
/// - 7 outer：见上
/// - sendInput data shape：
///   - mouse_move: `{x, y}` (绝对坐标 — iOS DesktopVirtualCursor 转，Trap D3 doc Phase 6.6 §4.3)
///   - mouse_click: `{button: "left"|"right"|"middle", double: bool}`
///   - mouse_scroll: `{dx, dy}` (dy<0 向下)
///   - key_press: `{key, modifiers: ["ctrl"|"alt"|"shift"|"meta"]}`
///   - key_type: `{text}`
public actor DesktopCommands {

    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) {
        self.client = client
    }

    // MARK: - Session lifecycle

    /// 启动远程桌面会话。返 sessionId 用于后续 getFrame / sendInput / stopSession。
    public func startSession(
        pcPeerId: String,
        displayId: Int? = nil,
        quality: Int = 80,
        maxFps: Int = 30,
        mobileDid: String? = nil
    ) async throws -> DesktopSessionInfo {
        guard quality >= 1 && quality <= 100 else {
            throw RemoteSkillError.invalidArgument("desktop.startSession: quality 1-100")
        }
        guard maxFps > 0 && maxFps <= 60 else {
            throw RemoteSkillError.invalidArgument("desktop.startSession: maxFps 1-60")
        }
        var params: [String: Any] = ["quality": quality, "maxFps": maxFps]
        if let d = displayId { params["displayId"] = d }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "desktop.startSession",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, DesktopSessionInfo.decode)
    }

    public func stopSession(
        pcPeerId: String,
        sessionId: String,
        mobileDid: String? = nil
    ) async throws -> DesktopStopSessionResponse {
        guard !sessionId.isEmpty else {
            throw RemoteSkillError.invalidArgument("desktop.stopSession: sessionId empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "desktop.stopSession",
            params: ["sessionId": sessionId],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, DesktopStopSessionResponse.decode)
    }

    // MARK: - Frame

    /// Pull-based getFrame (OQ-1 A v0.1)。桌面 server-side 节流 1000/maxFps ms，
    /// 超频会 throw "Frame rate limit exceeded" — 由 DesktopFrameStreamer 处理退避
    /// (Trap D6)。
    public func getFrame(
        pcPeerId: String,
        sessionId: String,
        displayId: Int? = nil,
        mobileDid: String? = nil
    ) async throws -> DesktopFrameResponse {
        guard !sessionId.isEmpty else {
            throw RemoteSkillError.invalidArgument("desktop.getFrame: sessionId empty")
        }
        var params: [String: Any] = ["sessionId": sessionId]
        if let d = displayId { params["displayId"] = d }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "desktop.getFrame",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, DesktopFrameResponse.decode)
    }

    // MARK: - Displays

    public func getDisplays(
        pcPeerId: String,
        sessionId: String,
        mobileDid: String? = nil
    ) async throws -> DesktopDisplaysResponse {
        guard !sessionId.isEmpty else {
            throw RemoteSkillError.invalidArgument("desktop.getDisplays: sessionId empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "desktop.getDisplays",
            params: ["sessionId": sessionId],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, DesktopDisplaysResponse.decode)
    }

    public func switchDisplay(
        pcPeerId: String,
        sessionId: String,
        displayId: Int,
        mobileDid: String? = nil
    ) async throws -> DesktopSwitchDisplayResponse {
        guard !sessionId.isEmpty else {
            throw RemoteSkillError.invalidArgument("desktop.switchDisplay: sessionId empty")
        }
        guard displayId >= 0 else {
            throw RemoteSkillError.invalidArgument("desktop.switchDisplay: displayId must be ≥ 0")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "desktop.switchDisplay",
            params: ["sessionId": sessionId, "displayId": displayId],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, DesktopSwitchDisplayResponse.decode)
    }

    public func getStats(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> DesktopStatsResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "desktop.getStats",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, DesktopStatsResponse.decode)
    }

    // MARK: - sendInput 5 sub-type typed helpers
    //
    // 全部 route to desktop.sendInput + type sub-dispatch (Trap D5)。

    /// 鼠标移动（绝对坐标）。iOS 端调 DesktopVirtualCursor 转出绝对值再传。
    public func mouseMove(
        pcPeerId: String,
        sessionId: String,
        x: Int,
        y: Int,
        mobileDid: String? = nil
    ) async throws -> DesktopInputResponse {
        guard !sessionId.isEmpty else {
            throw RemoteSkillError.invalidArgument("desktop.mouseMove: sessionId empty")
        }
        return try await sendInput(
            pcPeerId: pcPeerId, sessionId: sessionId,
            type: "mouse_move", data: ["x": x, "y": y],
            mobileDid: mobileDid
        )
    }

    /// 鼠标点击（左/中/右；可双击）。
    public func mouseClick(
        pcPeerId: String,
        sessionId: String,
        button: DesktopMouseButton = .left,
        double: Bool = false,
        mobileDid: String? = nil
    ) async throws -> DesktopInputResponse {
        guard !sessionId.isEmpty else {
            throw RemoteSkillError.invalidArgument("desktop.mouseClick: sessionId empty")
        }
        return try await sendInput(
            pcPeerId: pcPeerId, sessionId: sessionId,
            type: "mouse_click",
            data: ["button": button.rawValue, "double": double],
            mobileDid: mobileDid
        )
    }

    /// 鼠标双击便捷方法。
    public func mouseDoubleClick(
        pcPeerId: String,
        sessionId: String,
        button: DesktopMouseButton = .left,
        mobileDid: String? = nil
    ) async throws -> DesktopInputResponse {
        try await mouseClick(
            pcPeerId: pcPeerId, sessionId: sessionId,
            button: button, double: true, mobileDid: mobileDid
        )
    }

    /// 鼠标滚动（dy<0 = 向下滚动；dx 一般 0）。
    public func mouseScroll(
        pcPeerId: String,
        sessionId: String,
        dx: Int = 0,
        dy: Int,
        mobileDid: String? = nil
    ) async throws -> DesktopInputResponse {
        guard !sessionId.isEmpty else {
            throw RemoteSkillError.invalidArgument("desktop.mouseScroll: sessionId empty")
        }
        return try await sendInput(
            pcPeerId: pcPeerId, sessionId: sessionId,
            type: "mouse_scroll", data: ["dx": dx, "dy": dy],
            mobileDid: mobileDid
        )
    }

    /// 按键（可含 modifiers — 跨平台 abstract 名 ctrl/alt/shift/meta，桌面端转
    /// robot.keyTap 对应字符串）。
    public func keyPress(
        pcPeerId: String,
        sessionId: String,
        key: String,
        modifiers: [DesktopKeyModifier] = [],
        mobileDid: String? = nil
    ) async throws -> DesktopInputResponse {
        guard !sessionId.isEmpty else {
            throw RemoteSkillError.invalidArgument("desktop.keyPress: sessionId empty")
        }
        guard !key.isEmpty else {
            throw RemoteSkillError.invalidArgument("desktop.keyPress: key empty")
        }
        return try await sendInput(
            pcPeerId: pcPeerId, sessionId: sessionId,
            type: "key_press",
            data: ["key": key, "modifiers": modifiers.map { $0.rawValue }],
            mobileDid: mobileDid
        )
    }

    /// 输入文本（每字符触发 keyDown+keyUp；桌面 robotjs.typeString）。
    public func keyType(
        pcPeerId: String,
        sessionId: String,
        text: String,
        mobileDid: String? = nil
    ) async throws -> DesktopInputResponse {
        guard !sessionId.isEmpty else {
            throw RemoteSkillError.invalidArgument("desktop.keyType: sessionId empty")
        }
        guard !text.isEmpty else {
            throw RemoteSkillError.invalidArgument("desktop.keyType: text empty")
        }
        return try await sendInput(
            pcPeerId: pcPeerId, sessionId: sessionId,
            type: "key_type", data: ["text": text],
            mobileDid: mobileDid
        )
    }

    // MARK: - 内部 sendInput 通用调用

    /// 通用 sendInput dispatch — 5 typed helper 都 route 到这里。caller 也可直
    /// 用 (传任意 type/data) 但通常应该走 typed helper 保类型安全。
    public func sendInput(
        pcPeerId: String,
        sessionId: String,
        type: String,
        data: [String: Any],
        mobileDid: String? = nil
    ) async throws -> DesktopInputResponse {
        guard !sessionId.isEmpty else {
            throw RemoteSkillError.invalidArgument("desktop.sendInput: sessionId empty")
        }
        guard !type.isEmpty else {
            throw RemoteSkillError.invalidArgument("desktop.sendInput: type empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "desktop.sendInput",
            params: ["sessionId": sessionId, "type": type, "data": data],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, DesktopInputResponse.decode)
    }

    private static func decode<T>(
        _ resp: TerminalRpcResponse,
        _ decoder: (String) throws -> T
    ) throws -> T {
        switch resp {
        case .success(_, let resultJson):  return try decoder(resultJson)
        case .failure(let reqId, let msg): throw RemoteSkillError.remoteError(reqId: reqId, message: msg)
        }
    }
}
