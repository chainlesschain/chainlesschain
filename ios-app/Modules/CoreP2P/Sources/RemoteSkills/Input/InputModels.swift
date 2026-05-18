import Foundation

/// 鼠标按钮类型 — Phase 6.1B1 input skill。
public enum MouseButton: String, Codable, Sendable, Equatable {
    case left
    case right
    case middle
}

/// 鼠标滚动方向 — Phase 6.1B1。
public enum ScrollDirection: String, Codable, Sendable, Equatable {
    case up
    case down
    case left
    case right
}

/// 修饰键 — Phase 6.1B1 (sendKeyCombo).
///
/// 桌面 `input-handler.js` 接受：ctrl / alt / shift / meta / win / cmd / super。
/// iOS 端按 platform-agnostic 列：cmd ≈ meta (mac) ≈ win (win)。
public enum KeyModifier: String, Codable, Sendable, Equatable {
    case ctrl
    case alt
    case shift
    case meta
    case cmd  // mac alias for meta
    case win  // windows alias for meta
}

/// `input.sendKeyPress` 响应 — `{success, key, message}`.
public struct KeyPressResponse: Sendable, Equatable {
    public let success: Bool
    public let key: String
    public let message: String

    public init(success: Bool, key: String, message: String) {
        self.success = success
        self.key = key
        self.message = message
    }

    public static func decode(_ json: String) throws -> KeyPressResponse {
        let dict = try parseDict(json)
        return KeyPressResponse(
            success: (dict["success"] as? Bool) ?? false,
            key: (dict["key"] as? String) ?? "",
            message: (dict["message"] as? String) ?? ""
        )
    }
}

/// `input.sendKeyCombo` 响应。
public struct KeyComboResponse: Sendable, Equatable {
    public let success: Bool
    public let modifiers: [String]
    public let key: String
    public let message: String

    public init(success: Bool, modifiers: [String], key: String, message: String) {
        self.success = success
        self.modifiers = modifiers
        self.key = key
        self.message = message
    }

    public static func decode(_ json: String) throws -> KeyComboResponse {
        let dict = try parseDict(json)
        return KeyComboResponse(
            success: (dict["success"] as? Bool) ?? false,
            modifiers: (dict["modifiers"] as? [String]) ?? [],
            key: (dict["key"] as? String) ?? "",
            message: (dict["message"] as? String) ?? ""
        )
    }
}

/// `input.typeText` 响应。
public struct TypeTextResponse: Sendable, Equatable {
    public let success: Bool
    public let length: Int
    public let delay: Int
    public let message: String

    public init(success: Bool, length: Int, delay: Int, message: String) {
        self.success = success
        self.length = length
        self.delay = delay
        self.message = message
    }

    public static func decode(_ json: String) throws -> TypeTextResponse {
        let dict = try parseDict(json)
        return TypeTextResponse(
            success: (dict["success"] as? Bool) ?? false,
            length: (dict["length"] as? Int) ?? 0,
            delay: (dict["delay"] as? Int) ?? 0,
            message: (dict["message"] as? String) ?? ""
        )
    }
}

/// `input.mouseMove` 响应。
public struct MouseMoveResponse: Sendable, Equatable {
    public let success: Bool
    public let x: Int
    public let y: Int
    public let relative: Bool
    public let message: String

    public init(success: Bool, x: Int, y: Int, relative: Bool, message: String) {
        self.success = success
        self.x = x
        self.y = y
        self.relative = relative
        self.message = message
    }

    public static func decode(_ json: String) throws -> MouseMoveResponse {
        let dict = try parseDict(json)
        return MouseMoveResponse(
            success: (dict["success"] as? Bool) ?? false,
            x: (dict["x"] as? Int) ?? 0,
            y: (dict["y"] as? Int) ?? 0,
            relative: (dict["relative"] as? Bool) ?? false,
            message: (dict["message"] as? String) ?? ""
        )
    }
}

/// `input.mouseClick` / `mouseDoubleClick` 响应。
public struct MouseClickResponse: Sendable, Equatable {
    public let success: Bool
    public let button: String
    public let x: Int?
    public let y: Int?
    public let message: String

    public init(success: Bool, button: String, x: Int? = nil, y: Int? = nil, message: String) {
        self.success = success
        self.button = button
        self.x = x
        self.y = y
        self.message = message
    }

    public static func decode(_ json: String) throws -> MouseClickResponse {
        let dict = try parseDict(json)
        return MouseClickResponse(
            success: (dict["success"] as? Bool) ?? false,
            button: (dict["button"] as? String) ?? "left",
            x: dict["x"] as? Int,
            y: dict["y"] as? Int,
            message: (dict["message"] as? String) ?? ""
        )
    }
}

/// `input.mouseDrag` 响应。
public struct MouseDragResponse: Sendable, Equatable {
    public let success: Bool
    public let startX: Int
    public let startY: Int
    public let endX: Int
    public let endY: Int
    public let message: String

    public init(success: Bool, startX: Int, startY: Int, endX: Int, endY: Int, message: String) {
        self.success = success
        self.startX = startX
        self.startY = startY
        self.endX = endX
        self.endY = endY
        self.message = message
    }

    public static func decode(_ json: String) throws -> MouseDragResponse {
        let dict = try parseDict(json)
        return MouseDragResponse(
            success: (dict["success"] as? Bool) ?? false,
            startX: (dict["startX"] as? Int) ?? 0,
            startY: (dict["startY"] as? Int) ?? 0,
            endX: (dict["endX"] as? Int) ?? 0,
            endY: (dict["endY"] as? Int) ?? 0,
            message: (dict["message"] as? String) ?? ""
        )
    }
}

/// `input.mouseScroll` 响应。
public struct MouseScrollResponse: Sendable, Equatable {
    public let success: Bool
    public let direction: String
    public let amount: Int
    public let message: String

    public init(success: Bool, direction: String, amount: Int, message: String) {
        self.success = success
        self.direction = direction
        self.amount = amount
        self.message = message
    }

    public static func decode(_ json: String) throws -> MouseScrollResponse {
        let dict = try parseDict(json)
        return MouseScrollResponse(
            success: (dict["success"] as? Bool) ?? false,
            direction: (dict["direction"] as? String) ?? "down",
            amount: (dict["amount"] as? Int) ?? 0,
            message: (dict["message"] as? String) ?? ""
        )
    }
}

/// `input.getCursorPosition` 响应 — `{success, x, y}`.
public struct CursorPositionResponse: Sendable, Equatable {
    public let success: Bool
    public let x: Int
    public let y: Int

    public init(success: Bool, x: Int, y: Int) {
        self.success = success
        self.x = x
        self.y = y
    }

    public static func decode(_ json: String) throws -> CursorPositionResponse {
        let dict = try parseDict(json)
        return CursorPositionResponse(
            success: (dict["success"] as? Bool) ?? false,
            x: (dict["x"] as? Int) ?? 0,
            y: (dict["y"] as? Int) ?? 0
        )
    }
}

/// `input.getKeyboardLayout` 响应 — `{success, layout, platform, error?}`.
public struct KeyboardLayoutResponse: Sendable, Equatable {
    public let success: Bool
    public let layout: String
    public let platform: String
    public let error: String?

    public init(success: Bool, layout: String, platform: String, error: String? = nil) {
        self.success = success
        self.layout = layout
        self.platform = platform
        self.error = error
    }

    public static func decode(_ json: String) throws -> KeyboardLayoutResponse {
        let dict = try parseDict(json)
        return KeyboardLayoutResponse(
            success: (dict["success"] as? Bool) ?? false,
            layout: (dict["layout"] as? String) ?? "",
            platform: (dict["platform"] as? String) ?? "",
            error: dict["error"] as? String
        )
    }
}

/// 共享 JSON dict 解析 — 失败 throw `malformedResult`。
internal func parseDict(_ json: String) throws -> [String: Any] {
    guard let data = json.data(using: .utf8),
          let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw RemoteSkillError.malformedResult("input response: invalid json or not object")
    }
    return dict
}
