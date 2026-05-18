import Foundation

/// `system.execCommand` 响应（shell 命令执行结果）。
public struct ExecCommandResponse: Sendable, Equatable {
    public let success: Bool
    public let exitCode: Int
    public let stdout: String
    public let stderr: String
    public let durationMs: Int?
    public let timedOut: Bool

    public init(success: Bool, exitCode: Int, stdout: String, stderr: String,
                durationMs: Int? = nil, timedOut: Bool = false) {
        self.success = success; self.exitCode = exitCode
        self.stdout = stdout; self.stderr = stderr
        self.durationMs = durationMs; self.timedOut = timedOut
    }

    public static func decode(_ json: String) throws -> ExecCommandResponse {
        let d = try parseDict(json)
        return ExecCommandResponse(
            success: (d["success"] as? Bool) ?? false,
            exitCode: (d["exitCode"] as? Int) ?? -1,
            stdout: (d["stdout"] as? String) ?? "",
            stderr: (d["stderr"] as? String) ?? "",
            durationMs: d["durationMs"] as? Int,
            timedOut: (d["timedOut"] as? Bool) ?? false
        )
    }
}

/// `system.getInfo` 响应（系统简要信息）。注意区别于 `sysinfo.getOS` 详细版。
public struct SystemBriefInfoResponse: Sendable, Equatable {
    public let success: Bool
    public let platform: String
    public let arch: String?
    public let hostname: String?
    public let uptime: Int64?

    public init(success: Bool, platform: String, arch: String? = nil,
                hostname: String? = nil, uptime: Int64? = nil) {
        self.success = success; self.platform = platform
        self.arch = arch; self.hostname = hostname; self.uptime = uptime
    }

    public static func decode(_ json: String) throws -> SystemBriefInfoResponse {
        let d = try parseDict(json)
        let info = (d["info"] as? [String: Any]) ?? d
        let up: Int64?
        if let n = info["uptime"] as? Int64 { up = n }
        else if let n = info["uptime"] as? Int { up = Int64(n) }
        else { up = nil }
        return SystemBriefInfoResponse(
            success: (d["success"] as? Bool) ?? false,
            platform: (info["platform"] as? String) ?? "",
            arch: info["arch"] as? String,
            hostname: info["hostname"] as? String,
            uptime: up
        )
    }
}

/// `system.getStatus` 响应（CPU/内存/磁盘 实时百分比）。
public struct SystemStatusResponse: Sendable, Equatable {
    public let success: Bool
    public let cpuPercent: Double
    public let memoryPercent: Double
    public let diskPercent: Double?

    public init(success: Bool, cpuPercent: Double, memoryPercent: Double,
                diskPercent: Double? = nil) {
        self.success = success; self.cpuPercent = cpuPercent
        self.memoryPercent = memoryPercent; self.diskPercent = diskPercent
    }

    public static func decode(_ json: String) throws -> SystemStatusResponse {
        let d = try parseDict(json)
        return SystemStatusResponse(
            success: (d["success"] as? Bool) ?? false,
            cpuPercent: (d["cpuPercent"] as? Double) ?? 0.0,
            memoryPercent: (d["memoryPercent"] as? Double) ?? 0.0,
            diskPercent: d["diskPercent"] as? Double
        )
    }
}

/// `system.notify` 响应（在桌面端弹通知）。
public struct SystemNotifyResponse: Sendable, Equatable {
    public let success: Bool
    public let notificationId: String?
    public let message: String

    public init(success: Bool, notificationId: String? = nil, message: String) {
        self.success = success; self.notificationId = notificationId; self.message = message
    }

    public static func decode(_ json: String) throws -> SystemNotifyResponse {
        let d = try parseDict(json)
        return SystemNotifyResponse(
            success: (d["success"] as? Bool) ?? false,
            notificationId: d["notificationId"] as? String,
            message: (d["message"] as? String) ?? ""
        )
    }
}

/// `system.screenshot` 响应（注意桌面有 3 个 screenshot：system / display / userBrowser；
/// 此为 system 简化版）。
public struct SystemScreenshotResponse: Sendable, Equatable {
    public let success: Bool
    public let data: String?
    public let path: String?
    public let format: String
    public let size: Int

    public init(success: Bool, data: String? = nil, path: String? = nil,
                format: String = "png", size: Int = 0) {
        self.success = success; self.data = data; self.path = path
        self.format = format; self.size = size
    }

    public static func decode(_ json: String) throws -> SystemScreenshotResponse {
        let d = try parseDict(json)
        return SystemScreenshotResponse(
            success: (d["success"] as? Bool) ?? false,
            data: d["data"] as? String,
            path: d["path"] as? String,
            format: (d["format"] as? String) ?? "png",
            size: (d["size"] as? Int) ?? 0
        )
    }
}
