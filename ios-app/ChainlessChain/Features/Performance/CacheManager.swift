import Foundation
import Combine
import CoreCommon

// MARK: - Cache Entry

/// 缓存条目
public struct CacheEntry<T> {
    public let value: T
    public let createdAt: Date
    public let expiresAt: Date?
    public var lastAccessedAt: Date
    public var accessCount: Int

    public init(value: T, ttl: TimeInterval? = nil) {
        self.value = value
        self.createdAt = Date()
        self.expiresAt = ttl.map { Date().addingTimeInterval($0) }
        self.lastAccessedAt = Date()
        self.accessCount = 1
    }

    public var isExpired: Bool {
        guard let expiresAt = expiresAt else { return false }
        return Date() > expiresAt
    }
}

// MARK: - Cache Statistics

/// 缓存统计
public struct CacheStatistics {
    public var hitCount: Int = 0
    public var missCount: Int = 0
    public var evictionCount: Int = 0
    public var currentSize: Int = 0
    public var maxSize: Int = 0

    public var hitRate: Double {
        let total = hitCount + missCount
        return total > 0 ? Double(hitCount) / Double(total) : 0
    }

    public var utilizationRate: Double {
        return maxSize > 0 ? Double(currentSize) / Double(maxSize) : 0
    }
}

// MARK: - Cache Policy

/// 缓存淘汰策略
public enum CacheEvictionPolicy {
    case lru       // 最近最少使用
    case lfu       // 最不经常使用
    case fifo      // 先进先出
    case ttl       // 基于过期时间
}

// MARK: - LRU Cache

/// LRU缓存实现
public class LRUCache<Key: Hashable, Value> {

    // MARK: - Node

    private class Node {
        let key: Key
        var entry: CacheEntry<Value>
        var prev: Node?
        var next: Node?

        init(key: Key, entry: CacheEntry<Value>) {
            self.key = key
            self.entry = entry
        }
    }

    // MARK: - Properties

    private var cache: [Key: Node] = [:]
    private var head: Node?
    private var tail: Node?
    private let maxSize: Int
    private let defaultTTL: TimeInterval?
    private let lock = NSLock()

    public private(set) var statistics = CacheStatistics()

    // MARK: - Initialization

    public init(maxSize: Int = 100, defaultTTL: TimeInterval? = nil) {
        self.maxSize = maxSize
        self.defaultTTL = defaultTTL
        self.statistics.maxSize = maxSize
    }

    // MARK: - Public Methods

    /// 获取缓存值
    public func get(_ key: Key) -> Value? {
        lock.lock()
        defer { lock.unlock() }

        guard let node = cache[key] else {
            statistics.missCount += 1
            return nil
        }

        // 检查过期
        if node.entry.isExpired {
            removeNode(node)
            cache.removeValue(forKey: key)
            statistics.missCount += 1
            statistics.evictionCount += 1
            return nil
        }

        // 更新访问信息
        node.entry.lastAccessedAt = Date()
        node.entry.accessCount += 1

        // 移动到头部
        moveToHead(node)

        statistics.hitCount += 1
        return node.entry.value
    }

    /// 设置缓存值
    public func set(_ key: Key, value: Value, ttl: TimeInterval? = nil) {
        lock.lock()
        defer { lock.unlock() }

        let entry = CacheEntry(value: value, ttl: ttl ?? defaultTTL)

        if let existingNode = cache[key] {
            existingNode.entry = entry
            moveToHead(existingNode)
        } else {
            let newNode = Node(key: key, entry: entry)
            cache[key] = newNode
            addToHead(newNode)

            statistics.currentSize = cache.count

            // 超出容量时淘汰
            while cache.count > maxSize {
                evictLRU()
            }
        }
    }

    /// 删除缓存值
    public func remove(_ key: Key) {
        lock.lock()
        defer { lock.unlock() }

        if let node = cache[key] {
            removeNode(node)
            cache.removeValue(forKey: key)
            statistics.currentSize = cache.count
        }
    }

    /// 清空缓存
    public func clear() {
        lock.lock()
        defer { lock.unlock() }

        cache.removeAll()
        head = nil
        tail = nil
        statistics.currentSize = 0
    }

    /// 清理过期条目
    public func cleanupExpired() {
        lock.lock()
        defer { lock.unlock() }

        var expiredKeys: [Key] = []

        for (key, node) in cache {
            if node.entry.isExpired {
                expiredKeys.append(key)
            }
        }

        for key in expiredKeys {
            if let node = cache[key] {
                removeNode(node)
                cache.removeValue(forKey: key)
                statistics.evictionCount += 1
            }
        }

        statistics.currentSize = cache.count
    }

    /// 是否包含键
    public func contains(_ key: Key) -> Bool {
        lock.lock()
        defer { lock.unlock() }

        guard let node = cache[key] else { return false }
        return !node.entry.isExpired
    }

    /// 当前缓存大小
    public var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return cache.count
    }

    /// 所有键
    public var keys: [Key] {
        lock.lock()
        defer { lock.unlock() }
        return Array(cache.keys)
    }

    // MARK: - Private Methods

    private func addToHead(_ node: Node) {
        node.prev = nil
        node.next = head
        head?.prev = node
        head = node

        if tail == nil {
            tail = node
        }
    }

    private func removeNode(_ node: Node) {
        node.prev?.next = node.next
        node.next?.prev = node.prev

        if head === node {
            head = node.next
        }

        if tail === node {
            tail = node.prev
        }
    }

    private func moveToHead(_ node: Node) {
        removeNode(node)
        addToHead(node)
    }

    private func evictLRU() {
        guard let tailNode = tail else { return }

        removeNode(tailNode)
        cache.removeValue(forKey: tailNode.key)
        statistics.evictionCount += 1
        statistics.currentSize = cache.count
    }
}

// MARK: - Disk Cache

/// 磁盘缓存
public class DiskCache {

    // MARK: - Properties

    private let cacheDirectory: URL
    private let maxSize: Int64
    private let fileManager = FileManager.default
    private let lock = NSLock()
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public private(set) var statistics = CacheStatistics()

    // MARK: - Initialization

    public init(name: String, maxSizeMB: Int = 100) throws {
        let cacheDir = fileManager.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        self.cacheDirectory = cacheDir.appendingPathComponent("chainlesschain/\(name)", isDirectory: true)
        self.maxSize = Int64(maxSizeMB) * 1024 * 1024

        // 创建目录
        try fileManager.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)

        Logger.shared.info("[DiskCache] 初始化: \(cacheDirectory.path)")
    }

    // MARK: - Public Methods

    /// 获取缓存数据
    public func get<T: Codable>(_ key: String, type: T.Type) -> T? {
        lock.lock()
        defer { lock.unlock() }

        let fileURL = fileURL(for: key)

        guard fileManager.fileExists(atPath: fileURL.path) else {
            statistics.missCount += 1
            return nil
        }

        do {
            // 检查元数据
            let metaURL = metaFileURL(for: key)
            if fileManager.fileExists(atPath: metaURL.path) {
                let metaData = try Data(contentsOf: metaURL)
                let meta = try decoder.decode(CacheMeta.self, from: metaData)

                if let expiresAt = meta.expiresAt, Date() > expiresAt {
                    // 已过期
                    try? fileManager.removeItem(at: fileURL)
                    try? fileManager.removeItem(at: metaURL)
                    statistics.missCount += 1
                    statistics.evictionCount += 1
                    return nil
                }
            }

            let data = try Data(contentsOf: fileURL)
            let value = try decoder.decode(type, from: data)

            statistics.hitCount += 1
            return value

        } catch {
            Logger.shared.error("[DiskCache] 读取失败: \(error)")
            statistics.missCount += 1
            return nil
        }
    }

    /// 设置缓存数据
    public func set<T: Codable>(_ key: String, value: T, ttl: TimeInterval? = nil) {
        lock.lock()
        defer { lock.unlock() }

        let fileURL = fileURL(for: key)
        let metaURL = metaFileURL(for: key)

        do {
            let data = try encoder.encode(value)
            try data.write(to: fileURL)

            // 写入元数据
            let meta = CacheMeta(
                key: key,
                size: Int64(data.count),
                createdAt: Date(),
                expiresAt: ttl.map { Date().addingTimeInterval($0) }
            )
            let metaData = try encoder.encode(meta)
            try metaData.write(to: metaURL)

            // 检查总大小
            enforceMaxSize()

        } catch {
            Logger.shared.error("[DiskCache] 写入失败: \(error)")
        }
    }

    /// 删除缓存
    public func remove(_ key: String) {
        lock.lock()
        defer { lock.unlock() }

        let fileURL = fileURL(for: key)
        let metaURL = metaFileURL(for: key)

        try? fileManager.removeItem(at: fileURL)
        try? fileManager.removeItem(at: metaURL)
    }

    /// 清空缓存
    public func clear() {
        lock.lock()
        defer { lock.unlock() }

        try? fileManager.removeItem(at: cacheDirectory)
        try? fileManager.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)

        statistics.currentSize = 0
    }

    /// 清理过期缓存
    public func cleanupExpired() {
        lock.lock()
        defer { lock.unlock() }

        guard let contents = try? fileManager.contentsOfDirectory(
            at: cacheDirectory,
            includingPropertiesForKeys: nil
        ) else { return }

        for fileURL in contents where fileURL.pathExtension == "meta" {
            do {
                let data = try Data(contentsOf: fileURL)
                let meta = try decoder.decode(CacheMeta.self, from: data)

                if let expiresAt = meta.expiresAt, Date() > expiresAt {
                    let dataURL = self.fileURL(for: meta.key)
                    try? fileManager.removeItem(at: dataURL)
                    try? fileManager.removeItem(at: fileURL)
                    statistics.evictionCount += 1
                }
            } catch {
                // 忽略错误
            }
        }
    }

    /// 获取缓存大小
    public func totalSize() -> Int64 {
        guard let contents = try? fileManager.contentsOfDirectory(
            at: cacheDirectory,
            includingPropertiesForKeys: [.fileSizeKey]
        ) else { return 0 }

        var total: Int64 = 0

        for fileURL in contents {
            if let size = try? fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize {
                total += Int64(size)
            }
        }

        return total
    }

    // MARK: - Private Methods

    private func fileURL(for key: String) -> URL {
        let safeKey = key.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? key
        return cacheDirectory.appendingPathComponent(safeKey).appendingPathExtension("cache")
    }

    private func metaFileURL(for key: String) -> URL {
        let safeKey = key.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? key
        return cacheDirectory.appendingPathComponent(safeKey).appendingPathExtension("meta")
    }

    private func enforceMaxSize() {
        let currentSize = totalSize()

        guard currentSize > maxSize else {
            statistics.currentSize = Int(currentSize)
            return
        }

        // 按访问时间排序，删除最旧的
        guard let contents = try? fileManager.contentsOfDirectory(
            at: cacheDirectory,
            includingPropertiesForKeys: [.contentAccessDateKey, .fileSizeKey]
        ) else { return }

        let sorted = contents.compactMap { url -> (URL, Date, Int64)? in
            guard url.pathExtension == "cache" else { return nil }
            let values = try? url.resourceValues(forKeys: [.contentAccessDateKey, .fileSizeKey])
            let date = values?.contentAccessDate ?? Date.distantPast
            let size = Int64(values?.fileSize ?? 0)
            return (url, date, size)
        }.sorted { $0.1 < $1.1 }

        var freedSpace: Int64 = 0
        let targetFree = currentSize - maxSize + (maxSize / 10) // 额外释放10%

        for (url, _, size) in sorted {
            if freedSpace >= targetFree { break }

            let key = url.deletingPathExtension().lastPathComponent
            try? fileManager.removeItem(at: url)
            try? fileManager.removeItem(at: metaFileURL(for: key))

            freedSpace += size
            statistics.evictionCount += 1
        }

        statistics.currentSize = Int(totalSize())
    }
}

/// 缓存元数据
private struct CacheMeta: Codable {
    let key: String
    let size: Int64
    let createdAt: Date
    let expiresAt: Date?
}

// MARK: - Cache Manager

/// 统一缓存管理器
@MainActor
public class CacheManager: ObservableObject {

    // MARK: - Singleton

    public static let shared = CacheManager()

    // MARK: - Caches

    /// 内存缓存
    public let memoryCache: LRUCache<String, Any>

    /// 磁盘缓存
    public let diskCache: DiskCache?

    /// 图片缓存
    public let imageCache: LRUCache<String, Data>

    /// 嵌入向量缓存
    public let embeddingCache: LRUCache<String, [Float]>

    // MARK: - Properties

    @Published public private(set) var totalMemoryCacheSize: Int = 0
    @Published public private(set) var totalDiskCacheSize: Int64 = 0

    private var cleanupTimer: Timer?

    // MARK: - Initialization

    private init() {
        // 内存缓存：最多1000条，5分钟过期
        self.memoryCache = LRUCache(maxSize: 1000, defaultTTL: 300)

        // 磁盘缓存：最大100MB
        self.diskCache = try? DiskCache(name: "general", maxSizeMB: 100)

        // 图片缓存：最多200张，10分钟过期
        self.imageCache = LRUCache(maxSize: 200, defaultTTL: 600)

        // 嵌入向量缓存：最多500个，30分钟过期
        self.embeddingCache = LRUCache(maxSize: 500, defaultTTL: 1800)

        // 启动定期清理
        startCleanupTimer()

        Logger.shared.info("[CacheManager] 已初始化")
    }

    // MARK: - Public Methods

    /// 获取缓存
    public func get<T>(_ key: String) -> T? {
        // 先查内存
        if let value = memoryCache.get(key) as? T {
            return value
        }

        // 再查磁盘
        if let diskCache = diskCache,
           T.self is Codable.Type,
           let value = diskCache.get(key, type: AnyCodableWrapper<T>.self)?.value {
            // 回填内存
            memoryCache.set(key, value: value)
            return value
        }

        return nil
    }

    /// 设置缓存
    public func set<T>(_ key: String, value: T, ttl: TimeInterval? = nil, persist: Bool = false) {
        memoryCache.set(key, value: value, ttl: ttl)

        if persist, let diskCache = diskCache, let codableValue = value as? Codable {
            let wrapper = AnyCodableWrapper(value: codableValue)
            diskCache.set(key, value: wrapper, ttl: ttl)
        }
    }

    /// 删除缓存
    public func remove(_ key: String) {
        memoryCache.remove(key)
        diskCache?.remove(key)
    }

    /// 清空所有缓存
    public func clearAll() {
        memoryCache.clear()
        imageCache.clear()
        embeddingCache.clear()
        diskCache?.clear()

        Logger.shared.info("[CacheManager] 已清空所有缓存")
    }

    /// 清理过期缓存
    public func cleanupExpired() {
        memoryCache.cleanupExpired()
        imageCache.cleanupExpired()
        embeddingCache.cleanupExpired()
        diskCache?.cleanupExpired()

        updateStats()
    }

    /// 预热缓存
    public func warmUp(keys: [String], loader: (String) async -> Any?) async {
        for key in keys {
            if memoryCache.contains(key) { continue }

            if let value = await loader(key) {
                memoryCache.set(key, value: value)
            }
        }

        Logger.shared.info("[CacheManager] 缓存预热完成: \(keys.count) 个键")
    }

    /// 获取统计信息
    public func getStatistics() -> [String: CacheStatistics] {
        return [
            "memory": memoryCache.statistics,
            "image": imageCache.statistics,
            "embedding": embeddingCache.statistics,
            "disk": diskCache?.statistics ?? CacheStatistics()
        ]
    }

    // MARK: - Private Methods

    private func startCleanupTimer() {
        // 每5分钟清理一次
        cleanupTimer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.cleanupExpired()
            }
        }
    }

    private func updateStats() {
        totalMemoryCacheSize = memoryCache.count + imageCache.count + embeddingCache.count
        totalDiskCacheSize = diskCache?.totalSize() ?? 0
    }

    deinit {
        cleanupTimer?.invalidate()
    }
}

// MARK: - Wrapper for Any Codable

private struct AnyCodableWrapper<T>: Codable {
    let value: T

    init(value: T) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let codable = T.self as? Codable.Type {
            value = try codable.init(from: decoder) as! T
        } else {
            throw DecodingError.typeMismatch(T.self, DecodingError.Context(
                codingPath: decoder.codingPath,
                debugDescription: "Type is not Codable"
            ))
        }
    }

    func encode(to encoder: Encoder) throws {
        if let codable = value as? Codable {
            try codable.encode(to: encoder)
        }
    }
}

// MARK: - Memory Warning Handler

extension CacheManager {

    /// 处理内存警告
    public func handleMemoryWarning() {
        Logger.shared.warning("[CacheManager] 收到内存警告，正在清理...")

        // 清理50%的内存缓存
        let keysToRemove = memoryCache.keys.prefix(memoryCache.count / 2)
        for key in keysToRemove {
            memoryCache.remove(key)
        }

        // 清空图片缓存
        imageCache.clear()

        // 保留嵌入缓存（计算成本高）

        Logger.shared.info("[CacheManager] 内存清理完成")
    }
}
