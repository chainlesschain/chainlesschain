import Foundation

/// `security.lockWorkstation` 响应。
public struct LockResponse: Sendable, Equatable {
    public let success: Bool
    public let message: String

    public init(success: Bool, message: String) {
        self.success = success; self.message = message
    }

    public static func decode(_ json: String) throws -> LockResponse {
        let d = try parseDict(json)
        return LockResponse(
            success: (d["success"] as? Bool) ?? false,
            message: (d["message"] as? String) ?? ""
        )
    }
}

/// 安全状态摘要 — 嵌套于 SecurityStatusResponse。
public struct SecuritySummary: Sendable, Equatable {
    public let firewallEnabled: Bool?
    public let antivirusInstalled: Bool?
    public let encryptionEnabled: Bool?
    public let pendingUpdates: Int?
    public let platform: String

    public init(firewallEnabled: Bool? = nil, antivirusInstalled: Bool? = nil,
                encryptionEnabled: Bool? = nil, pendingUpdates: Int? = nil,
                platform: String) {
        self.firewallEnabled = firewallEnabled
        self.antivirusInstalled = antivirusInstalled
        self.encryptionEnabled = encryptionEnabled
        self.pendingUpdates = pendingUpdates
        self.platform = platform
    }
}

/// `security.getStatus` 响应（摘要 4 字段）。
public struct SecurityStatusResponse: Sendable, Equatable {
    public let success: Bool
    public let security: SecuritySummary

    public init(success: Bool, security: SecuritySummary) {
        self.success = success; self.security = security
    }

    public static func decode(_ json: String) throws -> SecurityStatusResponse {
        let d = try parseDict(json)
        let s = (d["security"] as? [String: Any]) ?? [:]
        return SecurityStatusResponse(
            success: (d["success"] as? Bool) ?? false,
            security: SecuritySummary(
                firewallEnabled: s["firewallEnabled"] as? Bool,
                antivirusInstalled: s["antivirusInstalled"] as? Bool,
                encryptionEnabled: s["encryptionEnabled"] as? Bool,
                pendingUpdates: s["pendingUpdates"] as? Int,
                platform: (s["platform"] as? String) ?? ""
            )
        )
    }
}

public struct ActiveUser: Sendable, Equatable {
    public let username: String
    public let domain: String?
    public let terminal: String?
    public let loginTime: String?
    public let logonType: String?

    public init(username: String, domain: String? = nil, terminal: String? = nil,
                loginTime: String? = nil, logonType: String? = nil) {
        self.username = username; self.domain = domain
        self.terminal = terminal; self.loginTime = loginTime; self.logonType = logonType
    }

    internal static func from(_ d: [String: Any]) -> ActiveUser {
        return ActiveUser(
            username: (d["username"] as? String) ?? "",
            domain: d["domain"] as? String,
            terminal: d["terminal"] as? String,
            loginTime: d["loginTime"] as? String,
            logonType: d["logonType"] as? String
        )
    }
}

/// `security.getActiveUsers` 响应。
public struct ActiveUsersResponse: Sendable, Equatable {
    public let success: Bool
    public let users: [ActiveUser]
    public let count: Int
    public let currentUser: String

    public init(success: Bool, users: [ActiveUser], count: Int, currentUser: String) {
        self.success = success; self.users = users
        self.count = count; self.currentUser = currentUser
    }

    public static func decode(_ json: String) throws -> ActiveUsersResponse {
        let d = try parseDict(json)
        let arr = (d["users"] as? [[String: Any]]) ?? []
        return ActiveUsersResponse(
            success: (d["success"] as? Bool) ?? false,
            users: arr.map { ActiveUser.from($0) },
            count: (d["count"] as? Int) ?? arr.count,
            currentUser: (d["currentUser"] as? String) ?? ""
        )
    }
}

public struct LoginRecord: Sendable, Equatable {
    public let username: String?
    public let terminal: String?
    public let time: String?
    public let type: String?
    public let details: String?

    public init(username: String? = nil, terminal: String? = nil,
                time: String? = nil, type: String? = nil, details: String? = nil) {
        self.username = username; self.terminal = terminal
        self.time = time; self.type = type; self.details = details
    }
}

/// `security.getLoginHistory` 响应。
public struct LoginHistoryResponse: Sendable, Equatable {
    public let success: Bool
    public let history: [LoginRecord]
    public let count: Int

    public init(success: Bool, history: [LoginRecord], count: Int) {
        self.success = success; self.history = history; self.count = count
    }

    public static func decode(_ json: String) throws -> LoginHistoryResponse {
        let d = try parseDict(json)
        let arr = (d["history"] as? [[String: Any]]) ?? []
        return LoginHistoryResponse(
            success: (d["success"] as? Bool) ?? false,
            history: arr.map {
                LoginRecord(
                    username: $0["username"] as? String,
                    terminal: $0["terminal"] as? String,
                    time: $0["time"] as? String,
                    type: $0["type"] as? String,
                    details: $0["details"] as? String
                )
            },
            count: (d["count"] as? Int) ?? arr.count
        )
    }
}

public struct FirewallProfile: Sendable, Equatable {
    public let name: String
    public let enabled: Bool

    public init(name: String, enabled: Bool) {
        self.name = name; self.enabled = enabled
    }
}

/// `security.getFirewallStatus` 响应。
public struct FirewallStatusResponse: Sendable, Equatable {
    public let success: Bool
    public let enabled: Bool?
    public let type: String?
    public let profiles: [FirewallProfile]
    public let ruleCount: Int?
    public let error: String?

    public init(success: Bool, enabled: Bool? = nil, type: String? = nil,
                profiles: [FirewallProfile] = [], ruleCount: Int? = nil, error: String? = nil) {
        self.success = success; self.enabled = enabled; self.type = type
        self.profiles = profiles; self.ruleCount = ruleCount; self.error = error
    }

    public static func decode(_ json: String) throws -> FirewallStatusResponse {
        let d = try parseDict(json)
        let arr = (d["profiles"] as? [[String: Any]]) ?? []
        return FirewallStatusResponse(
            success: (d["success"] as? Bool) ?? false,
            enabled: d["enabled"] as? Bool,
            type: d["type"] as? String,
            profiles: arr.map {
                FirewallProfile(
                    name: ($0["name"] as? String) ?? "",
                    enabled: ($0["enabled"] as? Bool) ?? false
                )
            },
            ruleCount: d["ruleCount"] as? Int,
            error: d["error"] as? String
        )
    }
}

public struct AntivirusProduct: Sendable, Equatable {
    public let name: String
    public let state: Int?
    public let builtin: Bool?

    public init(name: String, state: Int? = nil, builtin: Bool? = nil) {
        self.name = name; self.state = state; self.builtin = builtin
    }
}

/// `security.getAntivirusStatus` 响应。
public struct AntivirusStatusResponse: Sendable, Equatable {
    public let success: Bool
    public let installed: Bool?
    public let products: [AntivirusProduct]
    public let error: String?

    public init(success: Bool, installed: Bool? = nil, products: [AntivirusProduct] = [], error: String? = nil) {
        self.success = success; self.installed = installed
        self.products = products; self.error = error
    }

    public static func decode(_ json: String) throws -> AntivirusStatusResponse {
        let d = try parseDict(json)
        let arr = (d["products"] as? [[String: Any]]) ?? []
        return AntivirusStatusResponse(
            success: (d["success"] as? Bool) ?? false,
            installed: d["installed"] as? Bool,
            products: arr.map {
                AntivirusProduct(
                    name: ($0["name"] as? String) ?? "",
                    state: $0["state"] as? Int,
                    builtin: $0["builtin"] as? Bool
                )
            },
            error: d["error"] as? String
        )
    }
}

/// `security.getEncryptionStatus` 响应。
public struct EncryptionStatusResponse: Sendable, Equatable {
    public let success: Bool
    public let enabled: Bool?
    public let type: String?
    public let percentage: Int?
    public let algorithm: String?
    public let driveName: String?
    public let error: String?

    public init(success: Bool, enabled: Bool? = nil, type: String? = nil,
                percentage: Int? = nil, algorithm: String? = nil,
                driveName: String? = nil, error: String? = nil) {
        self.success = success; self.enabled = enabled; self.type = type
        self.percentage = percentage; self.algorithm = algorithm
        self.driveName = driveName; self.error = error
    }

    public static func decode(_ json: String) throws -> EncryptionStatusResponse {
        let d = try parseDict(json)
        return EncryptionStatusResponse(
            success: (d["success"] as? Bool) ?? false,
            enabled: d["enabled"] as? Bool,
            type: d["type"] as? String,
            percentage: d["percentage"] as? Int,
            algorithm: d["algorithm"] as? String,
            driveName: d["driveName"] as? String,
            error: d["error"] as? String
        )
    }
}

public struct PendingUpdate: Sendable, Equatable {
    public let title: String
    public let kb: String?

    public init(title: String, kb: String? = nil) {
        self.title = title; self.kb = kb
    }
}

/// `security.getUpdates` 响应。
public struct UpdatesStatusResponse: Sendable, Equatable {
    public let success: Bool
    public let pendingCount: Int?
    public let updates: [PendingUpdate]
    public let error: String?

    public init(success: Bool, pendingCount: Int? = nil, updates: [PendingUpdate] = [], error: String? = nil) {
        self.success = success; self.pendingCount = pendingCount
        self.updates = updates; self.error = error
    }

    public static func decode(_ json: String) throws -> UpdatesStatusResponse {
        let d = try parseDict(json)
        let arr = (d["updates"] as? [[String: Any]]) ?? []
        return UpdatesStatusResponse(
            success: (d["success"] as? Bool) ?? false,
            pendingCount: d["pendingCount"] as? Int,
            updates: arr.map {
                PendingUpdate(
                    title: ($0["title"] as? String) ?? "",
                    kb: $0["kb"] as? String
                )
            },
            error: d["error"] as? String
        )
    }
}
