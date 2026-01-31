import Foundation

/// 向量
public struct Vector: Codable {
    public let id: String
    public let values: [Float]
    public let metadata: [String: String]

    public init(id: String, values: [Float], metadata: [String: String] = [:]) {
        self.id = id
        self.values = values
        self.metadata = metadata
    }

    /// 计算与另一个向量的余弦相似度
    public func cosineSimilarity(with other: Vector) -> Float {
        guard values.count == other.values.count else { return 0 }

        let dotProduct = zip(values, other.values).map(*).reduce(0, +)
        let magnitudeA = sqrt(values.map { $0 * $0 }.reduce(0, +))
        let magnitudeB = sqrt(other.values.map { $0 * $0 }.reduce(0, +))

        guard magnitudeA > 0, magnitudeB > 0 else { return 0 }

        return dotProduct / (magnitudeA * magnitudeB)
    }
}

/// 搜索结果
public struct VectorSearchResult {
    public let id: String
    public let score: Float
    public let metadata: [String: String]

    public init(id: String, score: Float, metadata: [String: String]) {
        self.id = id
        self.score = score
        self.metadata = metadata
    }
}

/// 向量存储协议
public protocol VectorStore {
    /// 插入向量
    func insert(vector: Vector) async throws

    /// 批量插入
    func insertBatch(vectors: [Vector]) async throws

    /// 搜索相似向量
    func search(query: Vector, topK: Int, threshold: Float?) async throws -> [VectorSearchResult]

    /// 删除向量
    func delete(id: String) async throws

    /// 清空存储
    func clear() async throws

    /// 获取向量数量
    func count() async throws -> Int
}

/// 内存向量存储（简单实现）
public class InMemoryVectorStore: VectorStore {
    private var vectors: [String: Vector] = [:]
    private let queue = DispatchQueue(label: "com.chainlesschain.vectorstore", attributes: .concurrent)

    public init() {}

    public func insert(vector: Vector) async throws {
        await withCheckedContinuation { continuation in
            queue.async(flags: .barrier) {
                self.vectors[vector.id] = vector
                continuation.resume()
            }
        }
    }

    public func insertBatch(vectors: [Vector]) async throws {
        await withCheckedContinuation { continuation in
            queue.async(flags: .barrier) {
                for vector in vectors {
                    self.vectors[vector.id] = vector
                }
                continuation.resume()
            }
        }
    }

    public func search(query: Vector, topK: Int, threshold: Float? = nil) async throws -> [VectorSearchResult] {
        return await withCheckedContinuation { continuation in
            queue.async {
                var results: [(id: String, score: Float, metadata: [String: String])] = []

                for (id, vector) in self.vectors {
                    let similarity = query.cosineSimilarity(with: vector)

                    if let minThreshold = threshold, similarity < minThreshold {
                        continue
                    }

                    results.append((id: id, score: similarity, metadata: vector.metadata))
                }

                // 按相似度排序并取topK
                results.sort { $0.score > $1.score }
                let topResults = Array(results.prefix(topK))

                let searchResults = topResults.map {
                    VectorSearchResult(id: $0.id, score: $0.score, metadata: $0.metadata)
                }

                continuation.resume(returning: searchResults)
            }
        }
    }

    public func delete(id: String) async throws {
        await withCheckedContinuation { continuation in
            queue.async(flags: .barrier) {
                self.vectors.removeValue(forKey: id)
                continuation.resume()
            }
        }
    }

    public func clear() async throws {
        await withCheckedContinuation { continuation in
            queue.async(flags: .barrier) {
                self.vectors.removeAll()
                continuation.resume()
            }
        }
    }

    public func count() async throws -> Int {
        return await withCheckedContinuation { continuation in
            queue.async {
                continuation.resume(returning: self.vectors.count)
            }
        }
    }
}

/// 持久化向量存储（基于文件）
public class PersistentVectorStore: VectorStore {
    private let storage: InMemoryVectorStore
    private let fileURL: URL
    private let queue = DispatchQueue(label: "com.chainlesschain.vectorstore.persistent")

    public init(fileURL: URL) {
        self.fileURL = fileURL
        self.storage = InMemoryVectorStore()
        loadFromDisk()
    }

    public func insert(vector: Vector) async throws {
        try await storage.insert(vector: vector)
        try await saveToDisk()
    }

    public func insertBatch(vectors: [Vector]) async throws {
        try await storage.insertBatch(vectors: vectors)
        try await saveToDisk()
    }

    public func search(query: Vector, topK: Int, threshold: Float? = nil) async throws -> [VectorSearchResult] {
        return try await storage.search(query: query, topK: topK, threshold: threshold)
    }

    public func delete(id: String) async throws {
        try await storage.delete(id: id)
        try await saveToDisk()
    }

    public func clear() async throws {
        try await storage.clear()
        try await saveToDisk()
    }

    public func count() async throws -> Int {
        return try await storage.count()
    }

    // MARK: - 持久化

    private func saveToDisk() async throws {
        // TODO: 实现向量数据的持久化
        // 可以使用JSON、SQLite或自定义二进制格式
    }

    private func loadFromDisk() {
        // TODO: 从磁盘加载向量数据
    }
}

/// 向量存储管理器
public class VectorStoreManager {
    public static let shared = VectorStoreManager()

    private var stores: [String: VectorStore] = [:]
    private let defaultStoreName = "default"

    private init() {
        // 创建默认存储
        stores[defaultStoreName] = InMemoryVectorStore()
    }

    /// 获取存储
    public func getStore(name: String = "default") -> VectorStore {
        return stores[name] ?? stores[defaultStoreName]!
    }

    /// 创建新存储
    public func createStore(name: String, persistent: Bool = false) {
        if persistent {
            let fileURL = FileManager.default
                .urls(for: .documentDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("\(name).vectors")
            stores[name] = PersistentVectorStore(fileURL: fileURL)
        } else {
            stores[name] = InMemoryVectorStore()
        }
    }

    /// 删除存储
    public func deleteStore(name: String) {
        stores.removeValue(forKey: name)
    }
}
