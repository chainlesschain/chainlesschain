import Foundation

/// 已安装应用元数据。
public struct InstalledApp: Sendable, Equatable {
    public let name: String
    public let publisher: String?
    public let version: String?
    public let installPath: String?
    public let size: Int64?
    public let installDate: String?

    public init(name: String, publisher: String? = nil, version: String? = nil,
                installPath: String? = nil, size: Int64? = nil, installDate: String? = nil) {
        self.name = name; self.publisher = publisher; self.version = version
        self.installPath = installPath; self.size = size; self.installDate = installDate
    }

    internal static func from(_ d: [String: Any]) -> InstalledApp {
        let size: Int64?
        if let n = d["size"] as? Int64 { size = n }
        else if let n = d["size"] as? Int { size = Int64(n) }
        else { size = nil }
        return InstalledApp(
            name: (d["name"] as? String) ?? "",
            publisher: d["publisher"] as? String,
            version: d["version"] as? String,
            installPath: d["installPath"] as? String,
            size: size,
            installDate: d["installDate"] as? String
        )
    }
}

/// 运行中应用元数据。
public struct RunningApp: Sendable, Equatable {
    public let name: String
    public let pid: Int?
    public let title: String?
    public let cpu: Double?
    public let memory: Int64?

    public init(name: String, pid: Int? = nil, title: String? = nil,
                cpu: Double? = nil, memory: Int64? = nil) {
        self.name = name; self.pid = pid; self.title = title; self.cpu = cpu; self.memory = memory
    }

    internal static func from(_ d: [String: Any]) -> RunningApp {
        let mem: Int64?
        if let n = d["memory"] as? Int64 { mem = n }
        else if let n = d["memory"] as? Int { mem = Int64(n) }
        else { mem = nil }
        return RunningApp(
            name: (d["name"] as? String) ?? "",
            pid: d["pid"] as? Int,
            title: d["title"] as? String,
            cpu: d["cpu"] as? Double,
            memory: mem
        )
    }
}

/// `app.listInstalled` 响应。
public struct InstalledAppsResponse: Sendable, Equatable {
    public let success: Bool
    public let apps: [InstalledApp]
    public let total: Int
    public let returned: Int

    public init(success: Bool, apps: [InstalledApp], total: Int, returned: Int) {
        self.success = success; self.apps = apps; self.total = total; self.returned = returned
    }

    public static func decode(_ json: String) throws -> InstalledAppsResponse {
        let d = try parseDict(json)
        let arr = (d["apps"] as? [[String: Any]]) ?? []
        return InstalledAppsResponse(
            success: (d["success"] as? Bool) ?? false,
            apps: arr.map { InstalledApp.from($0) },
            total: (d["total"] as? Int) ?? arr.count,
            returned: (d["returned"] as? Int) ?? arr.count
        )
    }
}

/// `app.listRunning` 响应。
public struct RunningAppsResponse: Sendable, Equatable {
    public let success: Bool
    public let apps: [RunningApp]
    public let total: Int
    public let returned: Int

    public init(success: Bool, apps: [RunningApp], total: Int, returned: Int) {
        self.success = success; self.apps = apps; self.total = total; self.returned = returned
    }

    public static func decode(_ json: String) throws -> RunningAppsResponse {
        let d = try parseDict(json)
        let arr = (d["apps"] as? [[String: Any]]) ?? []
        return RunningAppsResponse(
            success: (d["success"] as? Bool) ?? false,
            apps: arr.map { RunningApp.from($0) },
            total: (d["total"] as? Int) ?? arr.count,
            returned: (d["returned"] as? Int) ?? arr.count
        )
    }
}

/// `app.getInfo` 响应（应用详情）。
public struct AppInfoResponse: Sendable, Equatable {
    public let success: Bool
    public let name: String?
    public let publisher: String?
    public let version: String?
    public let installPath: String?
    public let bundleId: String?
    public let message: String?

    public init(success: Bool, name: String? = nil, publisher: String? = nil,
                version: String? = nil, installPath: String? = nil,
                bundleId: String? = nil, message: String? = nil) {
        self.success = success; self.name = name; self.publisher = publisher
        self.version = version; self.installPath = installPath
        self.bundleId = bundleId; self.message = message
    }

    public static func decode(_ json: String) throws -> AppInfoResponse {
        let d = try parseDict(json)
        let app = (d["app"] as? [String: Any]) ?? [:]
        return AppInfoResponse(
            success: (d["success"] as? Bool) ?? false,
            name: app["name"] as? String,
            publisher: app["publisher"] as? String,
            version: app["version"] as? String,
            installPath: app["installPath"] as? String,
            bundleId: app["bundleId"] as? String,
            message: d["message"] as? String
        )
    }
}

/// `app.launch` 响应。
public struct LaunchAppResponse: Sendable, Equatable {
    public let success: Bool
    public let name: String
    public let message: String

    public init(success: Bool, name: String, message: String) {
        self.success = success; self.name = name; self.message = message
    }

    public static func decode(_ json: String) throws -> LaunchAppResponse {
        let d = try parseDict(json)
        return LaunchAppResponse(
            success: (d["success"] as? Bool) ?? false,
            name: (d["name"] as? String) ?? "",
            message: (d["message"] as? String) ?? ""
        )
    }
}

/// `app.close` 响应。
public struct CloseAppResponse: Sendable, Equatable {
    public let success: Bool
    public let name: String?
    public let pid: Int?
    public let force: Bool
    public let message: String

    public init(success: Bool, name: String? = nil, pid: Int? = nil, force: Bool, message: String) {
        self.success = success; self.name = name; self.pid = pid
        self.force = force; self.message = message
    }

    public static func decode(_ json: String) throws -> CloseAppResponse {
        let d = try parseDict(json)
        return CloseAppResponse(
            success: (d["success"] as? Bool) ?? false,
            name: d["name"] as? String,
            pid: d["pid"] as? Int,
            force: (d["force"] as? Bool) ?? false,
            message: (d["message"] as? String) ?? ""
        )
    }
}

/// `app.focus` 响应。
public struct FocusAppResponse: Sendable, Equatable {
    public let success: Bool
    public let name: String?
    public let pid: Int?
    public let message: String

    public init(success: Bool, name: String? = nil, pid: Int? = nil, message: String) {
        self.success = success; self.name = name; self.pid = pid; self.message = message
    }

    public static func decode(_ json: String) throws -> FocusAppResponse {
        let d = try parseDict(json)
        return FocusAppResponse(
            success: (d["success"] as? Bool) ?? false,
            name: d["name"] as? String,
            pid: d["pid"] as? Int,
            message: (d["message"] as? String) ?? ""
        )
    }
}

/// `app.search` 响应。
public struct SearchAppsResponse: Sendable, Equatable {
    public let success: Bool
    public let query: String
    public let apps: [InstalledApp]
    public let total: Int

    public init(success: Bool, query: String, apps: [InstalledApp], total: Int) {
        self.success = success; self.query = query; self.apps = apps; self.total = total
    }

    public static func decode(_ json: String) throws -> SearchAppsResponse {
        let d = try parseDict(json)
        let arr = (d["apps"] as? [[String: Any]]) ?? []
        return SearchAppsResponse(
            success: (d["success"] as? Bool) ?? false,
            query: (d["query"] as? String) ?? "",
            apps: arr.map { InstalledApp.from($0) },
            total: (d["total"] as? Int) ?? arr.count
        )
    }
}

/// `app.getRecent` 响应。
public struct RecentAppsResponse: Sendable, Equatable {
    public let success: Bool
    public let apps: [RecentApp]
    public let total: Int
    public let error: String?

    public init(success: Bool, apps: [RecentApp], total: Int, error: String? = nil) {
        self.success = success; self.apps = apps; self.total = total; self.error = error
    }

    public static func decode(_ json: String) throws -> RecentAppsResponse {
        let d = try parseDict(json)
        let arr = (d["apps"] as? [[String: Any]]) ?? []
        return RecentAppsResponse(
            success: (d["success"] as? Bool) ?? false,
            apps: arr.map {
                RecentApp(name: ($0["name"] as? String) ?? "", path: $0["path"] as? String)
            },
            total: (d["total"] as? Int) ?? arr.count,
            error: d["error"] as? String
        )
    }
}

public struct RecentApp: Sendable, Equatable {
    public let name: String
    public let path: String?

    public init(name: String, path: String? = nil) {
        self.name = name; self.path = path
    }
}
