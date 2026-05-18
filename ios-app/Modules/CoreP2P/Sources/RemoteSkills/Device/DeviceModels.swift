import Foundation

/// 设备管理通用响应 — `{success, deviceId?, message?}`。
public struct DeviceActionResponse: Sendable, Equatable {
    public let success: Bool
    public let deviceId: String?
    public let message: String?

    public init(success: Bool, deviceId: String? = nil, message: String? = nil) {
        self.success = success; self.deviceId = deviceId; self.message = message
    }

    public static func decode(_ json: String) throws -> DeviceActionResponse {
        let d = try parseDict(json)
        return DeviceActionResponse(
            success: (d["success"] as? Bool) ?? false,
            deviceId: d["deviceId"] as? String,
            message: d["message"] as? String
        )
    }
}

/// `device.register` 响应。
public struct DeviceRegisterResponse: Sendable, Equatable {
    public let success: Bool
    public let deviceId: String
    public let registeredAt: String?
    public let message: String?

    public init(success: Bool, deviceId: String, registeredAt: String? = nil, message: String? = nil) {
        self.success = success; self.deviceId = deviceId
        self.registeredAt = registeredAt; self.message = message
    }

    public static func decode(_ json: String) throws -> DeviceRegisterResponse {
        let d = try parseDict(json)
        return DeviceRegisterResponse(
            success: (d["success"] as? Bool) ?? false,
            deviceId: (d["deviceId"] as? String) ?? "",
            registeredAt: d["registeredAt"] as? String,
            message: d["message"] as? String
        )
    }
}

/// `device.setPermission` / `updateDevice` 响应。
public struct DevicePermissionResponse: Sendable, Equatable {
    public let success: Bool
    public let deviceId: String
    public let permission: String?  // read / write / admin
    public let message: String?

    public init(success: Bool, deviceId: String, permission: String? = nil, message: String? = nil) {
        self.success = success; self.deviceId = deviceId
        self.permission = permission; self.message = message
    }

    public static func decode(_ json: String) throws -> DevicePermissionResponse {
        let d = try parseDict(json)
        return DevicePermissionResponse(
            success: (d["success"] as? Bool) ?? false,
            deviceId: (d["deviceId"] as? String) ?? "",
            permission: d["permission"] as? String,
            message: d["message"] as? String
        )
    }
}
