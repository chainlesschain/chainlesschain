import Foundation

/// 远程键鼠输入 typed RPC wrapper — Phase 6.1B1。
///
/// 镜像 Android `app/src/main/java/.../remote/commands/InputCommands.kt`。
/// 10 method 全 wired，桌面 `input-handler.js` 与 Android Commands 100% 名称对齐
/// （Coverage doc §1.4 数据：A=10 D=10 ✓=10）。
///
/// **wire 协议**（与桌面 `input-handler.js` 对齐）：
/// - `input.sendKeyPress` params: `{key}` → `{success, key, message}`
/// - `input.sendKeyCombo` params: `{key, modifiers:[]}` → `{success, modifiers, key, message}`
/// - `input.typeText` params: `{text, delay}` → `{success, length, delay, message}`
/// - `input.mouseMove` params: `{x, y, relative}` → `{success, x, y, relative, message}`
/// - `input.mouseClick` / `mouseDoubleClick` params: `{button, x?, y?}` → `{success, button, x?, y?, message}`
/// - `input.mouseDrag` params: `{startX, startY, endX, endY, button}` → drag response
/// - `input.mouseScroll` params: `{direction, amount}` → scroll response
/// - `input.getCursorPosition` params: `{}` → `{success, x, y}`
/// - `input.getKeyboardLayout` params: `{}` → `{success, layout, platform, error?}`
public actor InputCommands {

    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) {
        self.client = client
    }

    // MARK: - 键盘

    /// 发送单个按键（如 enter / tab / escape / f1-f12 / a-z / 0-9）。
    public func sendKeyPress(
        pcPeerId: String,
        key: String,
        mobileDid: String? = nil
    ) async throws -> KeyPressResponse {
        guard !key.isEmpty else {
            throw RemoteSkillError.invalidArgument("input.sendKeyPress: key empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "input.sendKeyPress",
            params: ["key": key],
            mobileDid: mobileDid
        )
        return try Self.decodeOrThrow(resp, KeyPressResponse.decode)
    }

    /// 发送组合键（如 Ctrl+C → key="c", modifiers=[.ctrl]）。
    public func sendKeyCombo(
        pcPeerId: String,
        key: String,
        modifiers: [KeyModifier] = [],
        mobileDid: String? = nil
    ) async throws -> KeyComboResponse {
        guard !key.isEmpty else {
            throw RemoteSkillError.invalidArgument("input.sendKeyCombo: key empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "input.sendKeyCombo",
            params: [
                "key": key,
                "modifiers": modifiers.map { $0.rawValue }
            ],
            mobileDid: mobileDid
        )
        return try Self.decodeOrThrow(resp, KeyComboResponse.decode)
    }

    /// 输入文本（字符间延迟可调，默认 50ms）。
    public func typeText(
        pcPeerId: String,
        text: String,
        delay: Int = 50,
        mobileDid: String? = nil
    ) async throws -> TypeTextResponse {
        guard !text.isEmpty else {
            throw RemoteSkillError.invalidArgument("input.typeText: text empty")
        }
        guard delay >= 0 else {
            throw RemoteSkillError.invalidArgument("input.typeText: delay must be ≥ 0")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "input.typeText",
            params: ["text": text, "delay": delay],
            mobileDid: mobileDid
        )
        return try Self.decodeOrThrow(resp, TypeTextResponse.decode)
    }

    // MARK: - 鼠标

    /// 移动鼠标（相对 / 绝对）。
    public func mouseMove(
        pcPeerId: String,
        x: Int,
        y: Int,
        relative: Bool = false,
        mobileDid: String? = nil
    ) async throws -> MouseMoveResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "input.mouseMove",
            params: ["x": x, "y": y, "relative": relative],
            mobileDid: mobileDid
        )
        return try Self.decodeOrThrow(resp, MouseMoveResponse.decode)
    }

    /// 鼠标点击（可选 x/y — 如提供先移动）。
    public func mouseClick(
        pcPeerId: String,
        button: MouseButton = .left,
        x: Int? = nil,
        y: Int? = nil,
        mobileDid: String? = nil
    ) async throws -> MouseClickResponse {
        var params: [String: Any] = ["button": button.rawValue]
        if let x = x { params["x"] = x }
        if let y = y { params["y"] = y }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "input.mouseClick",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decodeOrThrow(resp, MouseClickResponse.decode)
    }

    /// 鼠标双击。
    public func mouseDoubleClick(
        pcPeerId: String,
        button: MouseButton = .left,
        x: Int? = nil,
        y: Int? = nil,
        mobileDid: String? = nil
    ) async throws -> MouseClickResponse {
        var params: [String: Any] = ["button": button.rawValue]
        if let x = x { params["x"] = x }
        if let y = y { params["y"] = y }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "input.mouseDoubleClick",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decodeOrThrow(resp, MouseClickResponse.decode)
    }

    /// 鼠标拖拽（startX/Y → endX/Y）。桌面端标 ADMIN 权限。
    public func mouseDrag(
        pcPeerId: String,
        startX: Int,
        startY: Int,
        endX: Int,
        endY: Int,
        button: MouseButton = .left,
        mobileDid: String? = nil
    ) async throws -> MouseDragResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "input.mouseDrag",
            params: [
                "startX": startX, "startY": startY,
                "endX": endX, "endY": endY,
                "button": button.rawValue
            ],
            mobileDid: mobileDid
        )
        return try Self.decodeOrThrow(resp, MouseDragResponse.decode)
    }

    /// 鼠标滚动。
    public func mouseScroll(
        pcPeerId: String,
        direction: ScrollDirection = .down,
        amount: Int = 3,
        mobileDid: String? = nil
    ) async throws -> MouseScrollResponse {
        guard amount > 0 else {
            throw RemoteSkillError.invalidArgument("input.mouseScroll: amount must be > 0")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "input.mouseScroll",
            params: ["direction": direction.rawValue, "amount": amount],
            mobileDid: mobileDid
        )
        return try Self.decodeOrThrow(resp, MouseScrollResponse.decode)
    }

    // MARK: - 查询

    /// 获取当前鼠标位置（只读）。
    public func getCursorPosition(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> CursorPositionResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "input.getCursorPosition",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decodeOrThrow(resp, CursorPositionResponse.decode)
    }

    /// 获取键盘布局（如 US / GB / DE）+ 平台信息（只读）。
    public func getKeyboardLayout(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> KeyboardLayoutResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "input.getKeyboardLayout",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decodeOrThrow(resp, KeyboardLayoutResponse.decode)
    }

    // MARK: - 便捷快捷键

    /// Ctrl+C 复制。
    public func copy(pcPeerId: String, mobileDid: String? = nil) async throws -> KeyComboResponse {
        try await sendKeyCombo(pcPeerId: pcPeerId, key: "c", modifiers: [.ctrl], mobileDid: mobileDid)
    }

    /// Ctrl+V 粘贴。
    public func paste(pcPeerId: String, mobileDid: String? = nil) async throws -> KeyComboResponse {
        try await sendKeyCombo(pcPeerId: pcPeerId, key: "v", modifiers: [.ctrl], mobileDid: mobileDid)
    }

    /// Ctrl+Z 撤销。
    public func undo(pcPeerId: String, mobileDid: String? = nil) async throws -> KeyComboResponse {
        try await sendKeyCombo(pcPeerId: pcPeerId, key: "z", modifiers: [.ctrl], mobileDid: mobileDid)
    }

    /// Ctrl+A 全选。
    public func selectAll(pcPeerId: String, mobileDid: String? = nil) async throws -> KeyComboResponse {
        try await sendKeyCombo(pcPeerId: pcPeerId, key: "a", modifiers: [.ctrl], mobileDid: mobileDid)
    }

    /// Ctrl+S 保存。
    public func save(pcPeerId: String, mobileDid: String? = nil) async throws -> KeyComboResponse {
        try await sendKeyCombo(pcPeerId: pcPeerId, key: "s", modifiers: [.ctrl], mobileDid: mobileDid)
    }

    // MARK: - 内部

    private static func decodeOrThrow<T>(
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
