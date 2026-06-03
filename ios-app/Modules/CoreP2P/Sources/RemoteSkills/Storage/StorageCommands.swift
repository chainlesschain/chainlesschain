import Foundation

/// 存储管理 typed RPC wrapper — Phase 6.1B3。
///
/// 镜像 Android `app/src/main/java/.../remote/commands/StorageCommands.kt` 桌面已支持 10 method 子集
/// （桌面 case ⊂ Android 41 method invoke；Android 多 31 method 缺桌面 impl 留 Phase 7+ debt
///  — 含 SMART 详细 / encryption / quota / 重复文件分析 / 索引等）。
///
/// **wire 协议**（与桌面 `storage-handler.js` 对齐）：
/// - `storage.getDisks` / `getPartitions` — 列盘 / 分区
/// - `storage.getUsage` — 路径级使用量
/// - `storage.getFolderSize` — 文件夹递归大小
/// - `storage.getLargeFiles` / `getRecentFiles` — Top 大文件 / 最近修改
/// - `storage.getStats` — 全盘汇总
/// - `storage.getDriveHealth` — SMART 简化数据
/// - `storage.cleanup` / `emptyTrash` — 清理操作（mutating; 高危）
public actor StorageCommands {

    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) {
        self.client = client
    }

    public func getDisks(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> DisksListResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "storage.getDisks",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, DisksListResponse.decode)
    }

    public func getPartitions(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> PartitionsListResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "storage.getPartitions",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, PartitionsListResponse.decode)
    }

    /// 路径级使用情况。
    public func getUsage(
        pcPeerId: String,
        path: String,
        mobileDid: String? = nil
    ) async throws -> StorageUsageResponse {
        guard !path.isEmpty else {
            throw RemoteSkillError.invalidArgument("storage.getUsage: path empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "storage.getUsage",
            params: ["path": path],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, StorageUsageResponse.decode)
    }

    /// 文件夹递归大小（包含 fileCount / directoryCount）。
    public func getFolderSize(
        pcPeerId: String,
        path: String,
        mobileDid: String? = nil
    ) async throws -> FolderSizeResponse {
        guard !path.isEmpty else {
            throw RemoteSkillError.invalidArgument("storage.getFolderSize: path empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "storage.getFolderSize",
            params: ["path": path],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, FolderSizeResponse.decode)
    }

    /// Top N 大文件。
    public func getLargeFiles(
        pcPeerId: String,
        path: String? = nil,
        limit: Int = 50,
        minSizeBytes: Int64? = nil,
        mobileDid: String? = nil
    ) async throws -> LargeFilesResponse {
        guard limit > 0 else {
            throw RemoteSkillError.invalidArgument("storage.getLargeFiles: limit must be > 0")
        }
        var params: [String: Any] = ["limit": limit]
        if let p = path { params["path"] = p }
        if let m = minSizeBytes { params["minSizeBytes"] = m }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "storage.getLargeFiles",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, LargeFilesResponse.decode)
    }

    /// 最近修改文件列表。
    public func getRecentFiles(
        pcPeerId: String,
        path: String? = nil,
        limit: Int = 50,
        sinceDaysAgo: Int? = nil,
        mobileDid: String? = nil
    ) async throws -> RecentFilesResponse {
        guard limit > 0 else {
            throw RemoteSkillError.invalidArgument("storage.getRecentFiles: limit must be > 0")
        }
        var params: [String: Any] = ["limit": limit]
        if let p = path { params["path"] = p }
        if let s = sinceDaysAgo { params["sinceDaysAgo"] = s }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "storage.getRecentFiles",
            params: params,
            mobileDid: mobileDid
        )
        return try Self.decode(resp, RecentFilesResponse.decode)
    }

    /// 全盘汇总统计。
    public func getStats(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> StorageStatsResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "storage.getStats",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, StorageStatsResponse.decode)
    }

    /// SMART 健康简化数据（drive name 必传）。
    public func getDriveHealth(
        pcPeerId: String,
        drive: String,
        mobileDid: String? = nil
    ) async throws -> DriveHealthResponse {
        guard !drive.isEmpty else {
            throw RemoteSkillError.invalidArgument("storage.getDriveHealth: drive empty")
        }
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "storage.getDriveHealth",
            params: ["drive": drive],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, DriveHealthResponse.decode)
    }

    /// 清理操作（mutating; 高危——可能删用户文件）。
    public func cleanup(
        pcPeerId: String,
        categories: [String] = [],  // cache / logs / temp / browser
        dryRun: Bool = true,
        mobileDid: String? = nil
    ) async throws -> CleanupResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "storage.cleanup",
            params: ["categories": categories, "dryRun": dryRun],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, CleanupResponse.decode)
    }

    /// 清空回收站（mutating; 高危）。
    public func emptyTrash(
        pcPeerId: String,
        mobileDid: String? = nil
    ) async throws -> EmptyTrashResponse {
        let resp = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "storage.emptyTrash",
            params: [:],
            mobileDid: mobileDid
        )
        return try Self.decode(resp, EmptyTrashResponse.decode)
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
