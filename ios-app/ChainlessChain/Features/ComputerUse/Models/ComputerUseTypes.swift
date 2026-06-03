//
//  ComputerUseTypes.swift
//  ChainlessChain
//
//  Computer Use v0.33.0 - Core type definitions
//  Adapted from: desktop-app-vue/src/main/browser/computer-use-agent.js
//

import Foundation

// MARK: - Action Types

/// All supported Computer Use action types
public enum CUActionType: String, Codable, CaseIterable {
    // Browser coordinate actions
    case click = "click"
    case doubleClick = "double_click"
    case longPress = "long_press"
    case type = "type"
    case key = "key"
    case scroll = "scroll"
    case navigate = "navigate"
    case wait = "wait"
    case screenshot = "screenshot"

    // Vision-based actions
    case visionClick = "vision_click"
    case visionAnalyze = "vision_analyze"
    case visionLocate = "vision_locate"
    case visionDescribe = "vision_describe"

    // Mobile-specific actions
    case appScreenshot = "app_screenshot"
    case deviceInfo = "device_info"
    case haptic = "haptic"

    // Gesture actions
    case swipe = "swipe"
    case pinch = "pinch"
    case drag = "drag"

    // Network actions
    case interceptNetwork = "intercept_network"
    case mockResponse = "mock_response"

    public var displayName: String {
        switch self {
        case .click: return "点击"
        case .doubleClick: return "双击"
        case .longPress: return "长按"
        case .type: return "输入文本"
        case .key: return "按键"
        case .scroll: return "滚动"
        case .navigate: return "导航"
        case .wait: return "等待"
        case .screenshot: return "截图"
        case .visionClick: return "视觉点击"
        case .visionAnalyze: return "视觉分析"
        case .visionLocate: return "视觉定位"
        case .visionDescribe: return "页面描述"
        case .appScreenshot: return "应用截图"
        case .deviceInfo: return "设备信息"
        case .haptic: return "触觉反馈"
        case .swipe: return "滑动"
        case .pinch: return "捏合"
        case .drag: return "拖拽"
        case .interceptNetwork: return "网络拦截"
        case .mockResponse: return "模拟响应"
        }
    }

    /// Action category for permission checking
    public var category: CUActionCategory {
        switch self {
        case .screenshot, .appScreenshot, .deviceInfo, .visionAnalyze, .visionDescribe, .visionLocate:
            return .readonly
        case .navigate:
            return .navigation
        case .type, .key:
            return .input
        case .click, .doubleClick, .longPress, .swipe, .pinch, .drag, .visionClick:
            return .click
        case .scroll, .wait:
            return .readonly
        case .haptic:
            return .mobile
        case .interceptNetwork, .mockResponse:
            return .network
        }
    }
}

// MARK: - Operation Mode

/// Operation mode for Computer Use agent
public enum CUOperationMode: String, Codable {
    case browser = "BROWSER"     // WKWebView-only operations
    case mobile = "MOBILE"       // App-level operations (screenshots, device info)
    case auto = "AUTO"           // Auto-detect based on action type

    public var displayName: String {
        switch self {
        case .browser: return "浏览器模式"
        case .mobile: return "移动端模式"
        case .auto: return "自动模式"
        }
    }
}

// MARK: - Action Category

/// Categories for permission grouping
public enum CUActionCategory: String, Codable, CaseIterable {
    case readonly = "readonly"
    case navigation = "navigation"
    case input = "input"
    case click = "click"
    case mobile = "mobile"
    case network = "network"
    case system = "system"

    public var displayName: String {
        switch self {
        case .readonly: return "只读操作"
        case .navigation: return "导航操作"
        case .input: return "输入操作"
        case .click: return "点击操作"
        case .mobile: return "移动端操作"
        case .network: return "网络操作"
        case .system: return "系统操作"
        }
    }
}

// MARK: - Gesture Type

/// Gesture types for coordinate actions
public enum CUGestureType: String, Codable, CaseIterable {
    case swipeUp = "SWIPE_UP"
    case swipeDown = "SWIPE_DOWN"
    case swipeLeft = "SWIPE_LEFT"
    case swipeRight = "SWIPE_RIGHT"
    case pinchIn = "PINCH_IN"
    case pinchOut = "PINCH_OUT"

    public var displayName: String {
        switch self {
        case .swipeUp: return "上滑"
        case .swipeDown: return "下滑"
        case .swipeLeft: return "左滑"
        case .swipeRight: return "右滑"
        case .pinchIn: return "缩小"
        case .pinchOut: return "放大"
        }
    }
}

// MARK: - Safety Level

/// Safety levels for SafeMode
public enum CUSafetyLevel: String, Codable, CaseIterable, Comparable {
    case unrestricted = "UNRESTRICTED"
    case normal = "NORMAL"
    case cautious = "CAUTIOUS"
    case strict = "STRICT"
    case readonly = "READONLY"

    public var displayName: String {
        switch self {
        case .unrestricted: return "无限制"
        case .normal: return "标准"
        case .cautious: return "谨慎"
        case .strict: return "严格"
        case .readonly: return "只读"
        }
    }

    private var order: Int {
        switch self {
        case .unrestricted: return 0
        case .normal: return 1
        case .cautious: return 2
        case .strict: return 3
        case .readonly: return 4
        }
    }

    public static func < (lhs: CUSafetyLevel, rhs: CUSafetyLevel) -> Bool {
        lhs.order < rhs.order
    }
}

// MARK: - Risk Level

/// Risk assessment levels for audit logging
public enum CURiskLevel: String, Codable, CaseIterable {
    case low = "LOW"
    case medium = "MEDIUM"
    case high = "HIGH"
    case critical = "CRITICAL"

    public var displayName: String {
        switch self {
        case .low: return "低风险"
        case .medium: return "中风险"
        case .high: return "高风险"
        case .critical: return "严重风险"
        }
    }
}

// MARK: - Recording State

/// State of screen recording
public enum CURecordingState: String, Codable {
    case idle = "IDLE"
    case recording = "RECORDING"
    case paused = "PAUSED"
    case stopped = "STOPPED"
}

// MARK: - Replay State

/// State of action replay
public enum CUReplayState: String, Codable {
    case idle = "IDLE"
    case playing = "PLAYING"
    case paused = "PAUSED"
    case stepping = "STEPPING"
    case completed = "COMPLETED"
    case error = "ERROR"
}

// MARK: - Replay Mode

/// Playback speed mode
public enum CUReplayMode: String, Codable {
    case normal = "NORMAL"
    case fast = "FAST"
    case slow = "SLOW"
    case stepByStep = "STEP_BY_STEP"
    case instant = "INSTANT"

    public var speedMultiplier: Double {
        switch self {
        case .normal: return 1.0
        case .fast: return 2.0
        case .slow: return 0.5
        case .stepByStep: return 1.0
        case .instant: return 0.0
        }
    }
}

// MARK: - Workflow Step Type

/// Types of workflow steps
public enum CUWorkflowStepType: String, Codable {
    case action = "action"
    case condition = "condition"
    case loop = "loop"
    case wait = "wait"
    case parallel = "parallel"
    case subWorkflow = "subWorkflow"
    case script = "script"
}

// MARK: - Workflow State

/// State of a workflow execution
public enum CUWorkflowState: String, Codable {
    case idle = "IDLE"
    case running = "RUNNING"
    case paused = "PAUSED"
    case completed = "COMPLETED"
    case failed = "FAILED"
    case cancelled = "CANCELLED"
}

// MARK: - Haptic Type

/// Haptic feedback types for MobileAction
public enum CUHapticType: String, Codable {
    case light = "light"
    case medium = "medium"
    case heavy = "heavy"
    case success = "success"
    case warning = "warning"
    case error = "error"
    case selection = "selection"
}

// MARK: - Point

/// A 2D coordinate point
public struct CUPoint: Codable, Equatable {
    public let x: Double
    public let y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

// MARK: - Region

/// A rectangular region for safe mode restrictions
public struct CURegion: Codable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }

    public func contains(point: CUPoint) -> Bool {
        return point.x >= x && point.x <= x + width &&
               point.y >= y && point.y <= y + height
    }
}
