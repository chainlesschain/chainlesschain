import Foundation

/// 显示器边界矩形 — 嵌套于 DisplayInfo.bounds / workArea。
public struct DisplayBounds: Sendable, Equatable {
    public let x: Int
    public let y: Int
    public let width: Int
    public let height: Int

    public init(x: Int, y: Int, width: Int, height: Int) {
        self.x = x; self.y = y; self.width = width; self.height = height
    }

    internal static func from(_ dict: [String: Any]?) -> DisplayBounds? {
        guard let d = dict else { return nil }
        return DisplayBounds(
            x: (d["x"] as? Int) ?? 0,
            y: (d["y"] as? Int) ?? 0,
            width: (d["width"] as? Int) ?? 0,
            height: (d["height"] as? Int) ?? 0
        )
    }
}

/// 显示器物理像素尺寸。
public struct DisplaySize: Sendable, Equatable {
    public let width: Int
    public let height: Int

    public init(width: Int, height: Int) {
        self.width = width; self.height = height
    }
}

/// 单个显示器完整信息。
public struct DisplayInfo: Sendable, Equatable {
    public let id: Int
    public let label: String
    public let bounds: DisplayBounds?
    public let workArea: DisplayBounds?
    public let size: DisplaySize?
    public let scaleFactor: Double
    public let rotation: Int
    public let colorDepth: Int?
    public let isInternal: Bool?

    public init(
        id: Int, label: String,
        bounds: DisplayBounds? = nil, workArea: DisplayBounds? = nil,
        size: DisplaySize? = nil, scaleFactor: Double = 1.0, rotation: Int = 0,
        colorDepth: Int? = nil, isInternal: Bool? = nil
    ) {
        self.id = id; self.label = label
        self.bounds = bounds; self.workArea = workArea
        self.size = size; self.scaleFactor = scaleFactor; self.rotation = rotation
        self.colorDepth = colorDepth; self.isInternal = isInternal
    }

    internal static func from(_ dict: [String: Any]) -> DisplayInfo {
        let sizeDict = dict["size"] as? [String: Any] ?? [:]
        let size = DisplaySize(
            width: (sizeDict["width"] as? Int) ?? 0,
            height: (sizeDict["height"] as? Int) ?? 0
        )
        return DisplayInfo(
            id: (dict["id"] as? Int) ?? 0,
            label: (dict["label"] as? String) ?? "",
            bounds: DisplayBounds.from(dict["bounds"] as? [String: Any]),
            workArea: DisplayBounds.from(dict["workArea"] as? [String: Any]),
            size: size,
            scaleFactor: (dict["scaleFactor"] as? Double) ?? 1.0,
            rotation: (dict["rotation"] as? Int) ?? 0,
            colorDepth: dict["colorDepth"] as? Int,
            isInternal: dict["internal"] as? Bool
        )
    }
}

/// `display.getDisplays` 响应。
public struct DisplaysListResponse: Sendable, Equatable {
    public let success: Bool
    public let displays: [DisplayInfo]
    public let total: Int

    public init(success: Bool, displays: [DisplayInfo], total: Int) {
        self.success = success; self.displays = displays; self.total = total
    }

    public static func decode(_ json: String) throws -> DisplaysListResponse {
        let dict = try parseDict(json)
        let arr = (dict["displays"] as? [[String: Any]]) ?? []
        return DisplaysListResponse(
            success: (dict["success"] as? Bool) ?? false,
            displays: arr.map { DisplayInfo.from($0) },
            total: (dict["total"] as? Int) ?? arr.count
        )
    }
}

/// `display.getPrimary` 响应。
public struct PrimaryDisplayResponse: Sendable, Equatable {
    public let success: Bool
    public let display: DisplayInfo?

    public init(success: Bool, display: DisplayInfo?) {
        self.success = success; self.display = display
    }

    public static func decode(_ json: String) throws -> PrimaryDisplayResponse {
        let dict = try parseDict(json)
        let d = dict["display"] as? [String: Any]
        return PrimaryDisplayResponse(
            success: (dict["success"] as? Bool) ?? false,
            display: d.map { DisplayInfo.from($0) }
        )
    }
}

/// `display.getResolution` 响应。
public struct ResolutionResponse: Sendable, Equatable {
    public let success: Bool
    public let width: Int
    public let height: Int
    public let scaleFactor: Double
    public let effectiveWidth: Int
    public let effectiveHeight: Int
    public let aspectRatio: String
    public let displayId: Int

    public init(success: Bool, width: Int, height: Int, scaleFactor: Double,
                effectiveWidth: Int, effectiveHeight: Int, aspectRatio: String, displayId: Int) {
        self.success = success; self.width = width; self.height = height
        self.scaleFactor = scaleFactor
        self.effectiveWidth = effectiveWidth; self.effectiveHeight = effectiveHeight
        self.aspectRatio = aspectRatio; self.displayId = displayId
    }

    public static func decode(_ json: String) throws -> ResolutionResponse {
        let dict = try parseDict(json)
        let res = (dict["resolution"] as? [String: Any]) ?? [:]
        return ResolutionResponse(
            success: (dict["success"] as? Bool) ?? false,
            width: (res["width"] as? Int) ?? 0,
            height: (res["height"] as? Int) ?? 0,
            scaleFactor: (res["scaleFactor"] as? Double) ?? 1.0,
            effectiveWidth: (res["effectiveWidth"] as? Int) ?? 0,
            effectiveHeight: (res["effectiveHeight"] as? Int) ?? 0,
            aspectRatio: (res["aspectRatio"] as? String) ?? "",
            displayId: (dict["displayId"] as? Int) ?? 0
        )
    }
}

/// `display.getBrightness` 响应。
public struct BrightnessResponse: Sendable, Equatable {
    public let success: Bool
    public let brightness: Int?
    public let level: Int?
    public let platform: String?
    public let error: String?

    public init(success: Bool, brightness: Int? = nil, level: Int? = nil,
                platform: String? = nil, error: String? = nil) {
        self.success = success; self.brightness = brightness; self.level = level
        self.platform = platform; self.error = error
    }

    public static func decode(_ json: String) throws -> BrightnessResponse {
        let d = try parseDict(json)
        return BrightnessResponse(
            success: (d["success"] as? Bool) ?? false,
            brightness: d["brightness"] as? Int,
            level: d["level"] as? Int,
            platform: d["platform"] as? String,
            error: d["error"] as? String
        )
    }
}

/// `display.setBrightness` 响应。
public struct SetBrightnessResponse: Sendable, Equatable {
    public let success: Bool
    public let brightness: Int?
    public let message: String

    public init(success: Bool, brightness: Int? = nil, message: String) {
        self.success = success; self.brightness = brightness; self.message = message
    }

    public static func decode(_ json: String) throws -> SetBrightnessResponse {
        let d = try parseDict(json)
        return SetBrightnessResponse(
            success: (d["success"] as? Bool) ?? false,
            brightness: d["brightness"] as? Int,
            message: (d["message"] as? String) ?? ""
        )
    }
}

/// `display.getScaling` 响应。
public struct ScalingResponse: Sendable, Equatable {
    public let success: Bool
    public let factor: Double
    public let percentage: Int
    public let displayId: Int

    public init(success: Bool, factor: Double, percentage: Int, displayId: Int) {
        self.success = success; self.factor = factor
        self.percentage = percentage; self.displayId = displayId
    }

    public static func decode(_ json: String) throws -> ScalingResponse {
        let d = try parseDict(json)
        let s = (d["scaling"] as? [String: Any]) ?? [:]
        return ScalingResponse(
            success: (d["success"] as? Bool) ?? false,
            factor: (s["factor"] as? Double) ?? 1.0,
            percentage: (s["percentage"] as? Int) ?? 100,
            displayId: (d["displayId"] as? Int) ?? 0
        )
    }
}

/// `display.getRefreshRate` 响应。
public struct RefreshRateResponse: Sendable, Equatable {
    public let success: Bool
    public let refreshRate: Int?
    public let unit: String
    public let error: String?

    public init(success: Bool, refreshRate: Int? = nil, unit: String = "Hz", error: String? = nil) {
        self.success = success; self.refreshRate = refreshRate; self.unit = unit; self.error = error
    }

    public static func decode(_ json: String) throws -> RefreshRateResponse {
        let d = try parseDict(json)
        return RefreshRateResponse(
            success: (d["success"] as? Bool) ?? false,
            refreshRate: d["refreshRate"] as? Int,
            unit: (d["unit"] as? String) ?? "Hz",
            error: d["error"] as? String
        )
    }
}

/// `display.getColorDepth` 响应。
public struct ColorDepthResponse: Sendable, Equatable {
    public let success: Bool
    public let colorDepth: Int
    public let bitsPerPixel: Int
    public let displayId: Int

    public init(success: Bool, colorDepth: Int, bitsPerPixel: Int, displayId: Int) {
        self.success = success; self.colorDepth = colorDepth
        self.bitsPerPixel = bitsPerPixel; self.displayId = displayId
    }

    public static func decode(_ json: String) throws -> ColorDepthResponse {
        let d = try parseDict(json)
        return ColorDepthResponse(
            success: (d["success"] as? Bool) ?? false,
            colorDepth: (d["colorDepth"] as? Int) ?? 24,
            bitsPerPixel: (d["bitsPerPixel"] as? Int) ?? 32,
            displayId: (d["displayId"] as? Int) ?? 0
        )
    }
}

/// `display.getWindowList` 响应。
public struct WindowListResponse: Sendable, Equatable {
    public let success: Bool
    public let windows: [WindowInfo]
    public let total: Int

    public init(success: Bool, windows: [WindowInfo], total: Int) {
        self.success = success; self.windows = windows; self.total = total
    }

    public static func decode(_ json: String) throws -> WindowListResponse {
        let d = try parseDict(json)
        let arr = (d["windows"] as? [[String: Any]]) ?? []
        return WindowListResponse(
            success: (d["success"] as? Bool) ?? false,
            windows: arr.map { WindowInfo.from($0) },
            total: (d["total"] as? Int) ?? arr.count
        )
    }
}

public struct WindowInfo: Sendable, Equatable {
    public let id: String
    public let title: String?
    public let processName: String?
    public let processId: Int?
    public let bounds: DisplayBounds?
    public let visible: Bool?
    public let focused: Bool?

    public init(id: String, title: String? = nil, processName: String? = nil,
                processId: Int? = nil, bounds: DisplayBounds? = nil,
                visible: Bool? = nil, focused: Bool? = nil) {
        self.id = id; self.title = title; self.processName = processName
        self.processId = processId; self.bounds = bounds
        self.visible = visible; self.focused = focused
    }

    internal static func from(_ dict: [String: Any]) -> WindowInfo {
        // bounds may be either nested {x,y,w,h} or flat x/y/width/height
        let bounds: DisplayBounds?
        if let nested = dict["bounds"] as? [String: Any] {
            bounds = DisplayBounds.from(nested)
        } else if dict["x"] != nil && dict["y"] != nil {
            bounds = DisplayBounds(
                x: (dict["x"] as? Int) ?? 0,
                y: (dict["y"] as? Int) ?? 0,
                width: (dict["width"] as? Int) ?? 0,
                height: (dict["height"] as? Int) ?? 0
            )
        } else { bounds = nil }
        return WindowInfo(
            id: (dict["id"] as? String) ?? "",
            title: dict["title"] as? String,
            processName: dict["processName"] as? String,
            processId: dict["processId"] as? Int,
            bounds: bounds,
            visible: dict["visible"] as? Bool,
            focused: dict["focused"] as? Bool
        )
    }
}

/// `display.getCursorPosition` 响应。注意与 `input.getCursorPosition` 同方法名
/// 但 schema 不同：display 版含 displayId + inWorkArea，input 版只有 x/y。
public struct DisplayCursorPositionResponse: Sendable, Equatable {
    public let success: Bool
    public let x: Int
    public let y: Int
    public let displayId: Int
    public let inWorkArea: Bool

    public init(success: Bool, x: Int, y: Int, displayId: Int, inWorkArea: Bool) {
        self.success = success; self.x = x; self.y = y
        self.displayId = displayId; self.inWorkArea = inWorkArea
    }

    public static func decode(_ json: String) throws -> DisplayCursorPositionResponse {
        let d = try parseDict(json)
        let c = (d["cursor"] as? [String: Any]) ?? [:]
        return DisplayCursorPositionResponse(
            success: (d["success"] as? Bool) ?? false,
            x: (c["x"] as? Int) ?? 0,
            y: (c["y"] as? Int) ?? 0,
            displayId: (d["displayId"] as? Int) ?? 0,
            inWorkArea: (d["inWorkArea"] as? Bool) ?? false
        )
    }
}

/// `display.screenshot` 响应（与 Phase 3.5 `ScreenshotCommands` 用的桌面 method 相同，
/// 但 Display skill 走完整参数表 displayId/format/quality/savePath）。
public struct DisplayScreenshotResponse: Sendable, Equatable {
    public let success: Bool
    public let saved: Bool
    public let path: String?
    public let data: String?  // base64 if not saved
    public let dataUrl: String?
    public let size: Int
    public let format: String
    public let width: Int
    public let height: Int

    public init(success: Bool, saved: Bool, path: String? = nil, data: String? = nil,
                dataUrl: String? = nil, size: Int = 0, format: String = "png",
                width: Int = 0, height: Int = 0) {
        self.success = success; self.saved = saved; self.path = path; self.data = data
        self.dataUrl = dataUrl; self.size = size; self.format = format
        self.width = width; self.height = height
    }

    public static func decode(_ json: String) throws -> DisplayScreenshotResponse {
        let d = try parseDict(json)
        let dims = (d["dimensions"] as? [String: Any]) ?? [:]
        return DisplayScreenshotResponse(
            success: (d["success"] as? Bool) ?? false,
            saved: (d["saved"] as? Bool) ?? false,
            path: d["path"] as? String,
            data: d["data"] as? String,
            dataUrl: d["dataUrl"] as? String,
            size: (d["size"] as? Int) ?? 0,
            format: (d["format"] as? String) ?? "png",
            width: (dims["width"] as? Int) ?? 0,
            height: (dims["height"] as? Int) ?? 0
        )
    }
}
