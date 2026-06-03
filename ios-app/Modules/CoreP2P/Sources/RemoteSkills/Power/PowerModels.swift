import Foundation

/// 电源操作通用响应 — `{success, action, message, ...}`。
public struct PowerActionResponse: Sendable, Equatable {
    public let success: Bool
    public let action: String
    public let message: String
    public let delay: Int?
    public let requiresConfirmation: Bool
    public let confirmId: String?

    public init(success: Bool, action: String, message: String,
                delay: Int? = nil, requiresConfirmation: Bool = false, confirmId: String? = nil) {
        self.success = success; self.action = action; self.message = message
        self.delay = delay; self.requiresConfirmation = requiresConfirmation; self.confirmId = confirmId
    }

    public static func decode(_ json: String) throws -> PowerActionResponse {
        let d = try parseDict(json)
        return PowerActionResponse(
            success: (d["success"] as? Bool) ?? false,
            action: (d["action"] as? String) ?? "",
            message: (d["message"] as? String) ?? "",
            delay: d["delay"] as? Int,
            requiresConfirmation: (d["requiresConfirmation"] as? Bool) ?? false,
            confirmId: d["confirmId"] as? String
        )
    }
}

/// `power.scheduleShutdown` 响应（含 taskId + scheduledTime ISO 字符串）。
public struct ScheduledTaskResponse: Sendable, Equatable {
    public let success: Bool
    public let taskId: String
    public let action: String
    public let scheduledTime: String
    public let message: String

    public init(success: Bool, taskId: String, action: String,
                scheduledTime: String, message: String) {
        self.success = success; self.taskId = taskId; self.action = action
        self.scheduledTime = scheduledTime; self.message = message
    }

    public static func decode(_ json: String) throws -> ScheduledTaskResponse {
        let d = try parseDict(json)
        return ScheduledTaskResponse(
            success: (d["success"] as? Bool) ?? false,
            taskId: (d["taskId"] as? String) ?? "",
            action: (d["action"] as? String) ?? "",
            scheduledTime: (d["scheduledTime"] as? String) ?? "",
            message: (d["message"] as? String) ?? ""
        )
    }
}

public struct PowerScheduledTask: Sendable, Equatable {
    public let taskId: String
    public let action: String
    public let scheduledTime: String

    public init(taskId: String, action: String, scheduledTime: String) {
        self.taskId = taskId; self.action = action; self.scheduledTime = scheduledTime
    }
}

/// `power.getSchedule` 响应。
public struct PowerScheduleListResponse: Sendable, Equatable {
    public let success: Bool
    public let tasks: [PowerScheduledTask]
    public let total: Int

    public init(success: Bool, tasks: [PowerScheduledTask], total: Int) {
        self.success = success; self.tasks = tasks; self.total = total
    }

    public static func decode(_ json: String) throws -> PowerScheduleListResponse {
        let d = try parseDict(json)
        let arr = (d["tasks"] as? [[String: Any]]) ?? []
        return PowerScheduleListResponse(
            success: (d["success"] as? Bool) ?? false,
            tasks: arr.map {
                PowerScheduledTask(
                    taskId: ($0["taskId"] as? String) ?? "",
                    action: ($0["action"] as? String) ?? "",
                    scheduledTime: ($0["scheduledTime"] as? String) ?? ""
                )
            },
            total: (d["total"] as? Int) ?? arr.count
        )
    }
}

/// `power.cancelSchedule` 响应。
public struct CancelScheduleResponse: Sendable, Equatable {
    public let success: Bool
    public let taskId: String
    public let message: String

    public init(success: Bool, taskId: String, message: String) {
        self.success = success; self.taskId = taskId; self.message = message
    }

    public static func decode(_ json: String) throws -> CancelScheduleResponse {
        let d = try parseDict(json)
        return CancelScheduleResponse(
            success: (d["success"] as? Bool) ?? false,
            taskId: (d["taskId"] as? String) ?? "",
            message: (d["message"] as? String) ?? ""
        )
    }
}
