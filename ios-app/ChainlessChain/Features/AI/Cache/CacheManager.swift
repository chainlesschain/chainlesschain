import Foundation

/// 缓存项
private struct CacheItem<T> {
    let value: T
    let timestamp: Date
    let expirationInterval: TimeInterval

    var isExpired: Bool {
        return Date().timeIntervalSince(timestamp) > expirationInterval
    }
}

/// 缓存策略
public enum CachePolicy {
    case noCache                    // 不缓存
    case cacheForever              // 永久缓存
    case cacheFor(TimeInterval)    // 缓存指定时间
    case cacheUntilMemoryWarning   // 缓存直到内存警告
}

/// LRU缓存实现
public class LRUCache<Key: Hashable, Value> {
    private class Node {
        let key: Key
        var value: Value
        var prev: Node?
        var next: Node?

        init(key: Key, value: Value) {
            self.key = key
            self.value = value
        }
    }

    private let capacity: Int
    private var cache: [Key: Node] = [:]
    private var head: Node?
    private var tail: Node?
    private let lock = NSLock()

    public init(capacity: Int) {
        self.capacity = capacity
    }

    public func get(_ key: Key) -> Value? {
        lock.lock()
        defer { lock.unlock() }

        guard let node = cache[key] else {
            return nil
        }

        moveToHead(node)
        return node.value
    }

    public func set(_ key: Key, value: Value) {
        lock.lock()
        defer { lock.unlock() }

        if let node = cache[key] {
            node.value = value
            moveToHead(node)
        } else {
            let newNode = Node(key: key, value: value)
            cache[key] = newNode
            addToHead(newNode)

            if cache.count > capacity {
                if let tailNode = removeTail() {
                    cache.removeValue(forKey: tailNode.key)
                }
            }
        }
    }

    public func remove(_ key: Key) {
        lock.lock()
        defer { lock.unlock() }

        if let node = cache[key] {
            removeNode(node)
            cache.removeValue(forKey: key)
        }
    }

    public func clear() {
        lock.lock()
        defer { lock.unlock() }

        cache.removeAll()
        head = nil
        tail = nil
    }

    private func addToHead(_ node: Node) {
        node.next = head
        node.prev = nil

        if let head = head {
            head.prev = node
        }

        head = node

        if tail == nil {
            tail = node
        }
    }

    private func removeNode(_ node: Node) {
        if let prev = node.prev {
            prev.next = node.next
        } else {
            head = node.next
        }

        if let next = node.next {
            next.prev = node.prev
        } else {
            tail = node.prev
        }
    }

    private func moveToHead(_ node: Node) {
        removeNode(node)
        addToHead(node)
    }

    private func removeTail() -> Node? {
        guard let tailNode = tail else {
            return nil
        }

        removeNode(tailNode)
        return tailNode
    }
}

/// 缓存管理器
public class CacheManager {
    public static let shared = CacheManager()

    // LLM响应缓存
    private let llmCache = LRUCache<String, String>(capacity: 100)

    // 引擎结果缓存
    private let engineCache = LRUCache<String, Any>(capacity: 50)

    // 向量嵌入缓存
    private let embeddingCache = LRUCache<String, [Float]>(capacity: 200)

    // 过期时间缓存
    private var expirationCache: [String: CacheItem<Any>] = [:]
    private let expirationQueue = DispatchQueue(label: "com.chainlesschain.cache.expiration")

    private init() {
        setupMemoryWarningObserver()
    }

    // MARK: - LLM缓存

    /// 缓存LLM响应
    public func cacheLLMResponse(_ response: String, for prompt: String) {
        let cacheKey = generateCacheKey(prompt)
        llmCache.set(cacheKey, value: response)
    }

    /// 获取缓存的LLM响应
    public func getCachedLLMResponse(for prompt: String) -> String? {
        let cacheKey = generateCacheKey(prompt)
        return llmCache.get(cacheKey)
    }

    // MARK: - 引擎结果缓存

    /// 缓存引擎结果
    public func cacheEngineResult<T>(_ result: T, for key: String, policy: CachePolicy = .cacheFor(300)) {
        switch policy {
        case .noCache:
            return

        case .cacheForever:
            engineCache.set(key, value: result as Any)

        case .cacheFor(let interval):
            let item = CacheItem(value: result as Any, timestamp: Date(), expirationInterval: interval)
            expirationQueue.async {
                self.expirationCache[key] = item
            }

        case .cacheUntilMemoryWarning:
            engineCache.set(key, value: result as Any)
        }
    }

    /// 获取缓存的引擎结果
    public func getCachedEngineResult<T>(for key: String) -> T? {
        // 先检查过期缓存
        if let item = expirationCache[key] {
            if item.isExpired {
                expirationQueue.async {
                    self.expirationCache.removeValue(forKey: key)
                }
                return nil
            }
            return item.value as? T
        }

        // 检查LRU缓存
        return engineCache.get(key) as? T
    }

    // MARK: - 向量嵌入缓存

    /// 缓存向量嵌入
    public func cacheEmbedding(_ embedding: [Float], for text: String) {
        let cacheKey = generateCacheKey(text)
        embeddingCache.set(cacheKey, value: embedding)
    }

    /// 获取缓存的向量嵌入
    public func getCachedEmbedding(for text: String) -> [Float]? {
        let cacheKey = generateCacheKey(text)
        return embeddingCache.get(cacheKey)
    }

    // MARK: - 缓存管理

    /// 清空所有缓存
    public func clearAll() {
        llmCache.clear()
        engineCache.clear()
        embeddingCache.clear()
        expirationQueue.async {
            self.expirationCache.removeAll()
        }
        Logger.shared.info("已清空所有缓存")
    }

    /// 清空特定类型的缓存
    public func clearCache(type: CacheType) {
        switch type {
        case .llm:
            llmCache.clear()
        case .engine:
            engineCache.clear()
        case .embedding:
            embeddingCache.clear()
        }
        Logger.shared.info("已清空\(type)缓存")
    }

    /// 获取缓存统计信息
    public func getStatistics() -> [String: Any] {
        return [
            "llmCacheSize": "~100 items (LRU)",
            "engineCacheSize": "~50 items (LRU)",
            "embeddingCacheSize": "~200 items (LRU)",
            "expirationCacheSize": expirationCache.count
        ]
    }

    // MARK: - 辅助方法

    private func generateCacheKey(_ input: String) -> String {
        // 使用哈希作为缓存键
        return String(input.hashValue)
    }

    private func setupMemoryWarningObserver() {
        NotificationCenter.default.addObserver(
            forName: UIApplication.didReceiveMemoryWarningNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.handleMemoryWarning()
        }
    }

    private func handleMemoryWarning() {
        Logger.shared.warning("收到内存警告，清空缓存")
        clearAll()
    }
}

/// 缓存类型
public enum CacheType {
    case llm
    case engine
    case embedding
}
