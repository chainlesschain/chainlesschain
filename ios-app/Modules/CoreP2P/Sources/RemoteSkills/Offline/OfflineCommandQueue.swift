import Foundation

/// 离线命令队列 — Phase 3.2。
///
/// **场景**：dataChannel 不通 / 桌面 offline 时，skill 调用方先把请求 enqueue
/// 到本队列；网络恢复 (`dataChannelReady` false→true edge) 时
/// `OfflineQueueDrainer` 触发 [drain] 把 pending 命令逐条 invoke。
///
/// **持久层**：UserDefaults JSON（OQ-2 决策；与 Phase 1 PairedDesktopsStore 同
/// 模式）。每次 mutation 后整数组重序列化 + 同步写盘 → 崩溃恢复 entity 不丢。
///
/// **容量上限**：100 entities。enqueue 满时**丢最老的 pending**（与 design doc
/// §5.3 决策一致；Android Room 表无 bound 但 iOS UserDefaults 性能不允许无限）。
///
/// **重试**：每条 entity 失败一次 `retries++`，到 `maxRetries=3` 后不再 drain
/// （留 failed 状态等用户手动 clear）。
///
/// **线程**：actor 串行化所有访问；与 Phase 1 PairedDesktopsStore 同模式。
public actor OfflineCommandQueue {

    public static let defaultCapacity = 100
    public static let defaultMaxRetries = 3
    public static let defaultUserDefaultsKey = "offline_command_queue"

    private let userDefaults: UserDefaults
    private let key: String
    private let capacity: Int
    private let maxRetries: Int

    private var entities: [OfflineCommandEntity] = []

    public init(
        userDefaults: UserDefaults = .standard,
        key: String = defaultUserDefaultsKey,
        capacity: Int = defaultCapacity,
        maxRetries: Int = defaultMaxRetries
    ) {
        self.userDefaults = userDefaults
        self.key = key
        self.capacity = max(1, capacity)
        self.maxRetries = max(0, maxRetries)
        self.entities = Self.loadFromDefaults(userDefaults: userDefaults, key: key)
        // 崩溃恢复迁移：sending → pending（中断的 drain 重试）
        if entities.contains(where: { $0.status == .sending }) {
            entities = entities.map { e in
                e.status == .sending ? e.with(status: .pending) : e
            }
            persist()
        }
    }

    // MARK: - Public API

    /// 入队一条新命令。容量满时**丢最老的 pending**（已 failed 不丢，等用户处理）。
    /// 返回 entity id。
    @discardableResult
    public func enqueue(
        method: String,
        paramsJson: String,
        mobileDid: String?
    ) async -> String {
        let entity = OfflineCommandEntity(
            id: UUID().uuidString,
            method: method,
            paramsJson: paramsJson,
            mobileDid: mobileDid,
            timestamp: Int64(Date().timeIntervalSince1970 * 1000)
        )
        if entities.count >= capacity {
            evictOldestPending()
        }
        entities.append(entity)
        persist()
        return entity.id
    }

    /// 触发 drain：遍历 pending 命令逐条 invoke。
    /// - Parameters:
    ///   - client: 通用 RPC 客户端（Phase 3.1 RemoteCommandClient）
    ///   - pcPeerId: 目标桌面 peer-id
    /// - Returns: (succeeded, failed) 计数 tuple
    @discardableResult
    public func drain(client: RemoteCommandClient, pcPeerId: String) async -> (succeeded: Int, failed: Int) {
        var succeeded = 0
        var failed = 0
        // 取 snapshot：drain 中不允许并发 enqueue 引入新 entity 的同时 drain（actor 串行化保证）
        let drainable = entities.filter { e in
            (e.status == .pending) || (e.status == .failed && e.retries < maxRetries)
        }
        for entity in drainable {
            // transit pending/failed → sending
            updateEntity(id: entity.id) { $0.with(status: .sending) }
            persist()

            // parse params back to dict
            let params: [String: Any]
            if let data = entity.paramsJson.data(using: .utf8),
               let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                params = dict
            } else {
                params = [:]
            }

            do {
                let response = try await client.invoke(
                    pcPeerId: pcPeerId,
                    method: entity.method,
                    params: params,
                    mobileDid: entity.mobileDid
                )
                switch response {
                case .success:
                    remove(id: entity.id)
                    succeeded += 1
                case .failure(_, let msg):
                    updateEntity(id: entity.id) {
                        $0.with(status: .failed, retries: $0.retries + 1, errorMessage: .some(msg))
                    }
                    failed += 1
                }
            } catch {
                updateEntity(id: entity.id) {
                    $0.with(
                        status: .failed,
                        retries: $0.retries + 1,
                        errorMessage: .some((error as NSError).localizedDescription)
                    )
                }
                failed += 1
            }
            persist()
        }
        return (succeeded, failed)
    }

    /// 当前所有 entities snapshot（按 enqueue 顺序）。UI 用。
    public func all() -> [OfflineCommandEntity] {
        entities
    }

    public func pendingCount() -> Int {
        entities.filter { $0.status == .pending }.count
    }

    public func failedCount() -> Int {
        entities.filter { $0.status == .failed }.count
    }

    public func totalCount() -> Int {
        entities.count
    }

    /// 删除 timestamp 早于阈值的 failed entities。UI 「清理失败队列」按钮用。
    public func clearOldFailed(olderThanMs: Int64) {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let cutoff = now - olderThanMs
        let before = entities.count
        entities.removeAll { $0.status == .failed && $0.timestamp < cutoff }
        if entities.count != before {
            persist()
        }
    }

    /// 全清（测试或 reset 时用）。
    public func clear() {
        entities.removeAll()
        userDefaults.removeObject(forKey: key)
    }

    /// 删除指定 entity（用户在 UI 手动删某条用）。
    public func remove(id: String) {
        let before = entities.count
        entities.removeAll { $0.id == id }
        if entities.count != before {
            persist()
        }
    }

    // MARK: - Private

    private func updateEntity(id: String, transform: (OfflineCommandEntity) -> OfflineCommandEntity) {
        if let idx = entities.firstIndex(where: { $0.id == id }) {
            entities[idx] = transform(entities[idx])
        }
    }

    private func evictOldestPending() {
        // 找最老的 pending 删；若无 pending 则 evict 最老 failed
        if let oldestPendingIdx = entities.firstIndex(where: { $0.status == .pending }) {
            entities.remove(at: oldestPendingIdx)
        } else if let oldestFailedIdx = entities.firstIndex(where: { $0.status == .failed }) {
            // 容量满且全是 failed — 极端情况；让 enqueue 还是能进
            entities.remove(at: oldestFailedIdx)
        } else if !entities.isEmpty {
            // 全 sending（理论不应该，drain 串行化）— 兜底
            entities.removeFirst()
        }
    }

    private func persist() {
        do {
            let data = try JSONEncoder().encode(entities)
            userDefaults.set(data, forKey: key)
        } catch {
            // best-effort — 下次 init 会从空起
        }
    }

    private static func loadFromDefaults(userDefaults: UserDefaults, key: String) -> [OfflineCommandEntity] {
        guard let data = userDefaults.data(forKey: key),
              let decoded = try? JSONDecoder().decode([OfflineCommandEntity].self, from: data) else {
            return []
        }
        return decoded
    }
}
