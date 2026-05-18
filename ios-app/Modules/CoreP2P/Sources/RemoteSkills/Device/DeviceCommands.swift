import Foundation

/// 设备管理 typed RPC wrapper — Phase 6.1B3。
///
/// 镜像 Android `app/src/main/java/.../remote/commands/DeviceCommands.kt` ∩ 桌面
/// `device-manager-handler.js` 4 method 交集（Coverage doc §1.4：A=12 D=16 ✓=4 33%）。
///
/// **特殊**：device 是唯一桌面 case (D=16) > Android invoke (A=12) 的 namespace。
/// 桌面有 12 个 Android 没暴露的 method（approve/assignGroup/connect/createGroup/discover/
/// getActivityLogs/getById/getStatus/list/reject/removeDevice/setTrusted）—— 这些可能是
/// 桌面 device-manager UI 用的内部 method，不打算暴露给 mobile。iOS 跟 Android 走 4 method 交集。
///
/// **wire 协议**（与桌面 `device-manager-handler.js` 对齐）：
/// - `device.register` — 注册新设备 (mutating)
/// - `device.disconnect` — 断开设备连接 (mutating)
/// - `device.setPermission` — 设置设备权限 (mutating; admin)
/// - `device.updateDevice` — 更新设备元数据 (mutating)
public actor DeviceCommands {

    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) {
        self.client = client
    }

    /// 注册新设备（mutating）。
    public func register(
        pcPeerId: String,
        deviceName: String,
        deviceType: String? = nil,
        publicKey: String? = nil,
        mobileDid: String? = nil
    ) async throws -> DeviceRegisterResponse {
        guard !deviceName.isEmpty else {
            throw RemoteSkillError.invalidArgument("device.register: deviceName empty")
        }
        var params: [String: Any] = ["deviceName": deviceName]
        if let t = deviceType { params["deviceType"] = t }
        if let k = publicKey { params["publicKey"] = k }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "device.register",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, DeviceRegisterResponse.decode)
    }

    /// 断开指定设备连接（mutating）。
    public func disconnect(
        pcPeerId: String,
        deviceId: String,
        mobileDid: String? = nil
    ) async throws -> DeviceActionResponse {
        guard !deviceId.isEmpty else {
            throw RemoteSkillError.invalidArgument("device.disconnect: deviceId empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "device.disconnect",
            params: ["deviceId": deviceId],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, DeviceActionResponse.decode)
    }

    /// 设置设备权限（mutating; admin only — 桌面端应配 ApprovalGate）。
    public func setPermission(
        pcPeerId: String,
        deviceId: String,
        permission: String,
        mobileDid: String? = nil
    ) async throws -> DevicePermissionResponse {
        guard !deviceId.isEmpty else {
            throw RemoteSkillError.invalidArgument("device.setPermission: deviceId empty")
        }
        let validPerms = ["read", "write", "admin", "none"]
        guard validPerms.contains(permission) else {
            let joined = validPerms.joined(separator: "/")
            throw RemoteSkillError.invalidArgument(
                "device.setPermission: permission must be one of \(joined)"
            )
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "device.setPermission",
            params: ["deviceId": deviceId, "permission": permission],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, DevicePermissionResponse.decode)
    }

    /// 更新设备元数据（mutating）。metadata 简化为 String:String map（足够日常用 — 复杂
    /// 嵌套对象走 metadataJson 直接传 JSON 字符串）。
    public func updateDevice(
        pcPeerId: String,
        deviceId: String,
        deviceName: String? = nil,
        metadata: [String: String]? = nil,
        metadataJson: String? = nil,
        mobileDid: String? = nil
    ) async throws -> DeviceActionResponse {
        guard !deviceId.isEmpty else {
            throw RemoteSkillError.invalidArgument("device.updateDevice: deviceId empty")
        }
        var params: [String: Any] = ["deviceId": deviceId]
        if let n = deviceName { params["deviceName"] = n }
        if let m = metadata { params["metadata"] = m }
        if let j = metadataJson { params["metadataJson"] = j }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "device.updateDevice",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, DeviceActionResponse.decode)
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
