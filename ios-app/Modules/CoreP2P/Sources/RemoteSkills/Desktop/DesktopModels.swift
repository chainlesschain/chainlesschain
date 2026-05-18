import Foundation

/// 鼠标按钮 — Phase 6.6 desktop.sendInput(mouse_click).
public enum DesktopMouseButton: String, Sendable, Equatable {
    case left
    case right
    case middle
}

/// 键修饰键 — Phase 6.6 desktop.sendInput(key_press). 跨平台 abstract 名，
/// 桌面端按 process.platform 转 robot.keyTap 对应字符串 (macOS "command" /
/// Windows "control")。详见 Phase 6.6 doc Trap D7。
public enum DesktopKeyModifier: String, Sendable, Equatable {
    case ctrl
    case alt
    case shift
    case meta       // macOS Cmd / Windows Win — abstract 名
}

/// `desktop.startSession` 响应。
public struct DesktopSessionInfo: Sendable, Equatable {
    public let success: Bool
    public let sessionId: String
    public let displayId: Int
    public let quality: Int
    public let maxFps: Int
    public let captureInterval: Int     // ms; 桌面 server-side 节流 = 1000/maxFps
    public let width: Int
    public let height: Int

    public init(success: Bool, sessionId: String, displayId: Int,
                quality: Int, maxFps: Int, captureInterval: Int,
                width: Int, height: Int) {
        self.success = success; self.sessionId = sessionId; self.displayId = displayId
        self.quality = quality; self.maxFps = maxFps
        self.captureInterval = captureInterval; self.width = width; self.height = height
    }

    public static func decode(_ json: String) throws -> DesktopSessionInfo {
        let d = try parseDict(json)
        return DesktopSessionInfo(
            success: (d["success"] as? Bool) ?? false,
            sessionId: (d["sessionId"] as? String) ?? "",
            displayId: (d["displayId"] as? Int) ?? 0,
            quality: (d["quality"] as? Int) ?? 80,
            maxFps: (d["maxFps"] as? Int) ?? 30,
            captureInterval: (d["captureInterval"] as? Int) ?? 33,
            width: (d["width"] as? Int) ?? 0,
            height: (d["height"] as? Int) ?? 0
        )
    }
}

/// `desktop.stopSession` 响应。
public struct DesktopStopSessionResponse: Sendable, Equatable {
    public let success: Bool
    public let sessionId: String
    public let message: String

    public init(success: Bool, sessionId: String, message: String) {
        self.success = success; self.sessionId = sessionId; self.message = message
    }

    public static func decode(_ json: String) throws -> DesktopStopSessionResponse {
        let d = try parseDict(json)
        return DesktopStopSessionResponse(
            success: (d["success"] as? Bool) ?? false,
            sessionId: (d["sessionId"] as? String) ?? "",
            message: (d["message"] as? String) ?? ""
        )
    }
}

/// `desktop.getFrame` 响应（含 base64 JPEG/PNG data）。
public struct DesktopFrameResponse: Sendable, Equatable {
    public let success: Bool
    public let data: String              // base64 JPEG/PNG
    public let format: String            // jpeg / png
    public let width: Int
    public let height: Int
    public let size: Int                 // 编码后字节数
    public let captureTimeMs: Int?
    public let encodeTimeMs: Int?

    public init(success: Bool, data: String, format: String,
                width: Int, height: Int, size: Int,
                captureTimeMs: Int? = nil, encodeTimeMs: Int? = nil) {
        self.success = success; self.data = data; self.format = format
        self.width = width; self.height = height; self.size = size
        self.captureTimeMs = captureTimeMs; self.encodeTimeMs = encodeTimeMs
    }

    public static func decode(_ json: String) throws -> DesktopFrameResponse {
        let d = try parseDict(json)
        return DesktopFrameResponse(
            success: (d["success"] as? Bool) ?? false,
            data: (d["data"] as? String) ?? "",
            format: (d["format"] as? String) ?? "jpeg",
            width: (d["width"] as? Int) ?? 0,
            height: (d["height"] as? Int) ?? 0,
            size: (d["size"] as? Int) ?? 0,
            captureTimeMs: d["captureTime"] as? Int,
            encodeTimeMs: d["encodeTime"] as? Int
        )
    }
}

/// `desktop.sendInput` 响应（统一格式）。
public struct DesktopInputResponse: Sendable, Equatable {
    public let success: Bool

    public init(success: Bool) {
        self.success = success
    }

    public static func decode(_ json: String) throws -> DesktopInputResponse {
        let d = try parseDict(json)
        return DesktopInputResponse(
            success: (d["success"] as? Bool) ?? false
        )
    }
}

/// `desktop.getDisplays` 响应。`displays` 是 session-specific 简化版（区别于
/// `display.getDisplays` 全字段版 — 后者含 bounds/workArea/scaleFactor 等完整）。
public struct DesktopDisplayInfo: Sendable, Equatable {
    public let id: Int
    public let primary: Bool
    public let width: Int
    public let height: Int

    public init(id: Int, primary: Bool, width: Int, height: Int) {
        self.id = id; self.primary = primary
        self.width = width; self.height = height
    }

    internal static func from(_ d: [String: Any]) -> DesktopDisplayInfo {
        return DesktopDisplayInfo(
            id: (d["id"] as? Int) ?? 0,
            primary: (d["primary"] as? Bool) ?? false,
            width: (d["width"] as? Int) ?? 0,
            height: (d["height"] as? Int) ?? 0
        )
    }
}

public struct DesktopDisplaysResponse: Sendable, Equatable {
    public let success: Bool
    public let displays: [DesktopDisplayInfo]

    public init(success: Bool, displays: [DesktopDisplayInfo]) {
        self.success = success; self.displays = displays
    }

    public static func decode(_ json: String) throws -> DesktopDisplaysResponse {
        let d = try parseDict(json)
        let arr = (d["displays"] as? [[String: Any]]) ?? []
        return DesktopDisplaysResponse(
            success: (d["success"] as? Bool) ?? false,
            displays: arr.map { DesktopDisplayInfo.from($0) }
        )
    }
}

/// `desktop.switchDisplay` 响应。
public struct DesktopSwitchDisplayResponse: Sendable, Equatable {
    public let success: Bool
    public let sessionId: String
    public let displayId: Int
    public let message: String?

    public init(success: Bool, sessionId: String, displayId: Int, message: String? = nil) {
        self.success = success; self.sessionId = sessionId
        self.displayId = displayId; self.message = message
    }

    public static func decode(_ json: String) throws -> DesktopSwitchDisplayResponse {
        let d = try parseDict(json)
        return DesktopSwitchDisplayResponse(
            success: (d["success"] as? Bool) ?? false,
            sessionId: (d["sessionId"] as? String) ?? "",
            displayId: (d["displayId"] as? Int) ?? 0,
            message: d["message"] as? String
        )
    }
}

/// `desktop.getStats` 响应（远程桌面会话统计）。
public struct DesktopStatsResponse: Sendable, Equatable {
    public let success: Bool
    public let totalFrames: Int
    public let totalBytes: Int64
    public let avgFrameSize: Int
    public let avgCaptureTimeMs: Int
    public let avgEncodeTimeMs: Int
    public let activeSessions: Int

    public init(success: Bool, totalFrames: Int, totalBytes: Int64,
                avgFrameSize: Int, avgCaptureTimeMs: Int,
                avgEncodeTimeMs: Int, activeSessions: Int) {
        self.success = success
        self.totalFrames = totalFrames; self.totalBytes = totalBytes
        self.avgFrameSize = avgFrameSize
        self.avgCaptureTimeMs = avgCaptureTimeMs; self.avgEncodeTimeMs = avgEncodeTimeMs
        self.activeSessions = activeSessions
    }

    public static func decode(_ json: String) throws -> DesktopStatsResponse {
        let d = try parseDict(json)
        let totalBytes: Int64
        if let n = d["totalBytes"] as? Int64 { totalBytes = n }
        else if let n = d["totalBytes"] as? Int { totalBytes = Int64(n) }
        else { totalBytes = 0 }
        return DesktopStatsResponse(
            success: (d["success"] as? Bool) ?? false,
            totalFrames: (d["totalFrames"] as? Int) ?? 0,
            totalBytes: totalBytes,
            avgFrameSize: (d["avgFrameSize"] as? Int) ?? 0,
            avgCaptureTimeMs: (d["avgCaptureTime"] as? Int) ?? 0,
            avgEncodeTimeMs: (d["avgEncodeTime"] as? Int) ?? 0,
            activeSessions: (d["activeSessions"] as? Int) ?? 0
        )
    }
}
