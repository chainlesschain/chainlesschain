import Foundation

/// 磁盘 / 分区信息。
public struct StorageDiskInfo: Sendable, Equatable {
    public let name: String
    public let mountPoint: String?
    public let totalBytes: Int64
    public let usedBytes: Int64
    public let freeBytes: Int64
    public let filesystem: String?
    public let type: String?       // ssd / hdd / removable
    public let usagePercent: Double

    public init(name: String, mountPoint: String? = nil,
                totalBytes: Int64, usedBytes: Int64, freeBytes: Int64,
                filesystem: String? = nil, type: String? = nil, usagePercent: Double) {
        self.name = name; self.mountPoint = mountPoint
        self.totalBytes = totalBytes; self.usedBytes = usedBytes; self.freeBytes = freeBytes
        self.filesystem = filesystem; self.type = type; self.usagePercent = usagePercent
    }

    internal static func from(_ d: [String: Any]) -> StorageDiskInfo {
        let total = (d["totalBytes"] as? Int64) ?? Int64(d["totalBytes"] as? Int ?? 0)
        let used = (d["usedBytes"] as? Int64) ?? Int64(d["usedBytes"] as? Int ?? 0)
        let free = (d["freeBytes"] as? Int64) ?? Int64(d["freeBytes"] as? Int ?? 0)
        return StorageDiskInfo(
            name: (d["name"] as? String) ?? "",
            mountPoint: d["mountPoint"] as? String,
            totalBytes: total, usedBytes: used, freeBytes: free,
            filesystem: d["filesystem"] as? String,
            type: d["type"] as? String,
            usagePercent: (d["usagePercent"] as? Double) ?? 0.0
        )
    }
}

public struct DisksListResponse: Sendable, Equatable {
    public let success: Bool
    public let disks: [StorageDiskInfo]

    public init(success: Bool, disks: [StorageDiskInfo]) {
        self.success = success; self.disks = disks
    }

    public static func decode(_ json: String) throws -> DisksListResponse {
        let d = try parseDict(json)
        let arr = (d["disks"] as? [[String: Any]]) ?? []
        return DisksListResponse(
            success: (d["success"] as? Bool) ?? false,
            disks: arr.map { StorageDiskInfo.from($0) }
        )
    }
}

public struct PartitionsListResponse: Sendable, Equatable {
    public let success: Bool
    public let partitions: [StorageDiskInfo]

    public init(success: Bool, partitions: [StorageDiskInfo]) {
        self.success = success; self.partitions = partitions
    }

    public static func decode(_ json: String) throws -> PartitionsListResponse {
        let d = try parseDict(json)
        let arr = (d["partitions"] as? [[String: Any]]) ?? []
        return PartitionsListResponse(
            success: (d["success"] as? Bool) ?? false,
            partitions: arr.map { StorageDiskInfo.from($0) }
        )
    }
}

/// `storage.getUsage` 响应（特定路径使用情况）。
public struct StorageUsageResponse: Sendable, Equatable {
    public let success: Bool
    public let path: String
    public let totalBytes: Int64
    public let usedBytes: Int64
    public let freeBytes: Int64
    public let usagePercent: Double

    public init(success: Bool, path: String, totalBytes: Int64, usedBytes: Int64,
                freeBytes: Int64, usagePercent: Double) {
        self.success = success; self.path = path
        self.totalBytes = totalBytes; self.usedBytes = usedBytes; self.freeBytes = freeBytes
        self.usagePercent = usagePercent
    }

    public static func decode(_ json: String) throws -> StorageUsageResponse {
        let d = try parseDict(json)
        let total = (d["totalBytes"] as? Int64) ?? Int64(d["totalBytes"] as? Int ?? 0)
        let used = (d["usedBytes"] as? Int64) ?? Int64(d["usedBytes"] as? Int ?? 0)
        let free = (d["freeBytes"] as? Int64) ?? Int64(d["freeBytes"] as? Int ?? 0)
        return StorageUsageResponse(
            success: (d["success"] as? Bool) ?? false,
            path: (d["path"] as? String) ?? "",
            totalBytes: total, usedBytes: used, freeBytes: free,
            usagePercent: (d["usagePercent"] as? Double) ?? 0.0
        )
    }
}

/// `storage.getFolderSize` 响应。
public struct FolderSizeResponse: Sendable, Equatable {
    public let success: Bool
    public let path: String
    public let totalBytes: Int64
    public let fileCount: Int
    public let directoryCount: Int

    public init(success: Bool, path: String, totalBytes: Int64,
                fileCount: Int, directoryCount: Int) {
        self.success = success; self.path = path; self.totalBytes = totalBytes
        self.fileCount = fileCount; self.directoryCount = directoryCount
    }

    public static func decode(_ json: String) throws -> FolderSizeResponse {
        let d = try parseDict(json)
        let total = (d["totalBytes"] as? Int64) ?? Int64(d["totalBytes"] as? Int ?? 0)
        return FolderSizeResponse(
            success: (d["success"] as? Bool) ?? false,
            path: (d["path"] as? String) ?? "",
            totalBytes: total,
            fileCount: (d["fileCount"] as? Int) ?? 0,
            directoryCount: (d["directoryCount"] as? Int) ?? 0
        )
    }
}

/// 大文件 / 近期文件项。
public struct LargeFileEntry: Sendable, Equatable {
    public let path: String
    public let sizeBytes: Int64
    public let modifiedAt: String?

    public init(path: String, sizeBytes: Int64, modifiedAt: String? = nil) {
        self.path = path; self.sizeBytes = sizeBytes; self.modifiedAt = modifiedAt
    }

    internal static func from(_ d: [String: Any]) -> LargeFileEntry {
        let size = (d["sizeBytes"] as? Int64) ?? Int64(d["sizeBytes"] as? Int ?? 0)
        return LargeFileEntry(
            path: (d["path"] as? String) ?? "",
            sizeBytes: size,
            modifiedAt: d["modifiedAt"] as? String
        )
    }
}

public struct LargeFilesResponse: Sendable, Equatable {
    public let success: Bool
    public let files: [LargeFileEntry]
    public let total: Int

    public init(success: Bool, files: [LargeFileEntry], total: Int) {
        self.success = success; self.files = files; self.total = total
    }

    public static func decode(_ json: String) throws -> LargeFilesResponse {
        let d = try parseDict(json)
        let arr = (d["files"] as? [[String: Any]]) ?? []
        return LargeFilesResponse(
            success: (d["success"] as? Bool) ?? false,
            files: arr.map { LargeFileEntry.from($0) },
            total: (d["total"] as? Int) ?? arr.count
        )
    }
}

public struct RecentFilesResponse: Sendable, Equatable {
    public let success: Bool
    public let files: [LargeFileEntry]
    public let total: Int

    public init(success: Bool, files: [LargeFileEntry], total: Int) {
        self.success = success; self.files = files; self.total = total
    }

    public static func decode(_ json: String) throws -> RecentFilesResponse {
        let d = try parseDict(json)
        let arr = (d["files"] as? [[String: Any]]) ?? []
        return RecentFilesResponse(
            success: (d["success"] as? Bool) ?? false,
            files: arr.map { LargeFileEntry.from($0) },
            total: (d["total"] as? Int) ?? arr.count
        )
    }
}

/// `storage.getStats` 响应（汇总统计）。
public struct StorageStatsResponse: Sendable, Equatable {
    public let success: Bool
    public let totalDisks: Int
    public let totalBytes: Int64
    public let usedBytes: Int64
    public let freeBytes: Int64

    public init(success: Bool, totalDisks: Int, totalBytes: Int64,
                usedBytes: Int64, freeBytes: Int64) {
        self.success = success; self.totalDisks = totalDisks
        self.totalBytes = totalBytes; self.usedBytes = usedBytes; self.freeBytes = freeBytes
    }

    public static func decode(_ json: String) throws -> StorageStatsResponse {
        let d = try parseDict(json)
        let total = (d["totalBytes"] as? Int64) ?? Int64(d["totalBytes"] as? Int ?? 0)
        let used = (d["usedBytes"] as? Int64) ?? Int64(d["usedBytes"] as? Int ?? 0)
        let free = (d["freeBytes"] as? Int64) ?? Int64(d["freeBytes"] as? Int ?? 0)
        return StorageStatsResponse(
            success: (d["success"] as? Bool) ?? false,
            totalDisks: (d["totalDisks"] as? Int) ?? 0,
            totalBytes: total, usedBytes: used, freeBytes: free
        )
    }
}

/// `storage.getDriveHealth` 响应（SMART 数据简化版）。
public struct DriveHealthResponse: Sendable, Equatable {
    public let success: Bool
    public let drive: String
    public let healthy: Bool?
    public let temperature: Int?
    public let powerOnHours: Int?
    public let error: String?

    public init(success: Bool, drive: String, healthy: Bool? = nil,
                temperature: Int? = nil, powerOnHours: Int? = nil, error: String? = nil) {
        self.success = success; self.drive = drive
        self.healthy = healthy; self.temperature = temperature
        self.powerOnHours = powerOnHours; self.error = error
    }

    public static func decode(_ json: String) throws -> DriveHealthResponse {
        let d = try parseDict(json)
        return DriveHealthResponse(
            success: (d["success"] as? Bool) ?? false,
            drive: (d["drive"] as? String) ?? "",
            healthy: d["healthy"] as? Bool,
            temperature: d["temperature"] as? Int,
            powerOnHours: d["powerOnHours"] as? Int,
            error: d["error"] as? String
        )
    }
}

/// `storage.cleanup` 响应（清理结果）。
public struct CleanupResponse: Sendable, Equatable {
    public let success: Bool
    public let bytesFreed: Int64
    public let itemsRemoved: Int
    public let message: String

    public init(success: Bool, bytesFreed: Int64, itemsRemoved: Int, message: String) {
        self.success = success; self.bytesFreed = bytesFreed
        self.itemsRemoved = itemsRemoved; self.message = message
    }

    public static func decode(_ json: String) throws -> CleanupResponse {
        let d = try parseDict(json)
        let bytes = (d["bytesFreed"] as? Int64) ?? Int64(d["bytesFreed"] as? Int ?? 0)
        return CleanupResponse(
            success: (d["success"] as? Bool) ?? false,
            bytesFreed: bytes,
            itemsRemoved: (d["itemsRemoved"] as? Int) ?? 0,
            message: (d["message"] as? String) ?? ""
        )
    }
}

/// `storage.emptyTrash` 响应。
public struct EmptyTrashResponse: Sendable, Equatable {
    public let success: Bool
    public let bytesFreed: Int64
    public let itemsRemoved: Int

    public init(success: Bool, bytesFreed: Int64, itemsRemoved: Int) {
        self.success = success; self.bytesFreed = bytesFreed; self.itemsRemoved = itemsRemoved
    }

    public static func decode(_ json: String) throws -> EmptyTrashResponse {
        let d = try parseDict(json)
        let bytes = (d["bytesFreed"] as? Int64) ?? Int64(d["bytesFreed"] as? Int ?? 0)
        return EmptyTrashResponse(
            success: (d["success"] as? Bool) ?? false,
            bytesFreed: bytes,
            itemsRemoved: (d["itemsRemoved"] as? Int) ?? 0
        )
    }
}
