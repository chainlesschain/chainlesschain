import Foundation

/// 离线命令队列单条记录 — Phase 3.2。
///
/// 与 Android `OfflineCommandEntity` (Room `@Entity`) 字段对齐，但 iOS 用
/// UserDefaults JSON 而非 SQLite（OQ-2 决策；数据量预期 < 100 条）。
///
/// **持久化语义**：每次 `OfflineCommandQueue.enqueue/drain/clear` 后整个
/// `[OfflineCommandEntity]` 数组重新序列化写 UserDefaults。崩溃恢复保证 enqueue
/// 之后的 entity 不丢（`set(_:forKey:)` 同步 flush）。
public struct OfflineCommandEntity: Codable, Sendable, Equatable, Identifiable {
    public enum Status: String, Codable, Sendable, Equatable {
        /// 等待 dataChannelReady → drainer 触发 → invoke。
        case pending
        /// drain 进行中（drain 内 transit；崩溃恢复时若残留 sending 状态视为
        /// pending 重试 — 在 OfflineCommandQueue.init 内做迁移）。
        case sending
        /// invoke 失败（含网络 / desktop 端 error 响应）。retries 自增。
        /// retries >= maxRetries 时不再重试，等待用户手动 clearOldFailed 或
        /// app 重启 reset。
        case failed
    }

    public let id: String           // UUID
    public let method: String       // e.g. "clipboard.set"
    public let paramsJson: String   // encoded once on enqueue
    public let mobileDid: String?   // 调 invoke 时传给 commandClient
    public let timestamp: Int64     // epoch ms (enqueue 时刻)
    public let status: Status
    public let retries: Int
    public let errorMessage: String?

    public init(
        id: String,
        method: String,
        paramsJson: String,
        mobileDid: String?,
        timestamp: Int64,
        status: Status = .pending,
        retries: Int = 0,
        errorMessage: String? = nil
    ) {
        self.id = id
        self.method = method
        self.paramsJson = paramsJson
        self.mobileDid = mobileDid
        self.timestamp = timestamp
        self.status = status
        self.retries = retries
        self.errorMessage = errorMessage
    }

    /// 复制并替换字段 — actor 内 mutate 用。
    public func with(
        status: Status? = nil,
        retries: Int? = nil,
        errorMessage: String?? = nil
    ) -> OfflineCommandEntity {
        OfflineCommandEntity(
            id: id,
            method: method,
            paramsJson: paramsJson,
            mobileDid: mobileDid,
            timestamp: timestamp,
            status: status ?? self.status,
            retries: retries ?? self.retries,
            errorMessage: errorMessage ?? self.errorMessage
        )
    }
}
