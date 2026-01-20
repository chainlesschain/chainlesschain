import Foundation
import CoreCommon

/// 项目 RAG 管理器
/// 负责项目文件的向量索引和语义搜索
/// Reference: desktop-app-vue/src/main/project/project-rag-ipc.js
@MainActor
class ProjectRAGManager: ObservableObject {
    // MARK: - Singleton

    static let shared = ProjectRAGManager()

    // MARK: - Dependencies

    private let llmManager = LLMManager.shared
    private let vectorStore = VectorStoreRepository.shared
    private let logger = Logger.shared

    // MARK: - Published Properties

    @Published var isIndexing = false
    @Published var indexProgress: Double = 0
    @Published var indexedProjects: Set<String> = []
    @Published var error: String?

    // MARK: - Constants

    private let chunkSize = 500      // Characters per chunk
    private let chunkOverlap = 50    // Overlap between chunks
    private let maxChunksPerFile = 100
    private let embeddingDimension = 384

    // MARK: - Types

    /// 项目索引信息
    struct ProjectIndexInfo {
        let projectId: String
        let totalFiles: Int
        let indexedFiles: Int
        let totalChunks: Int
        let lastIndexedAt: Date
        let indexSize: Int  // bytes
    }

    /// RAG 查询结果
    struct RAGQueryResult: Identifiable {
        let id = UUID().uuidString
        let projectId: String
        let filePath: String
        let content: String
        let score: Float
        let chunkIndex: Int
        let metadata: [String: String]
    }

    /// 文件块
    struct FileChunk {
        let projectId: String
        let filePath: String
        let content: String
        let chunkIndex: Int
        let startOffset: Int
        let endOffset: Int
    }

    private init() {}

    // MARK: - Index Management

    /// 索引项目文件
    /// Reference: desktop-app-vue/src/main/project/project-rag-ipc.js (project:indexFiles)
    func indexProjectFiles(
        projectId: String,
        onProgress: ((Double, String) -> Void)? = nil
    ) async throws -> ProjectIndexInfo {
        isIndexing = true
        indexProgress = 0
        error = nil

        defer {
            isIndexing = false
            indexProgress = 1.0
        }

        logger.info("[ProjectRAG] Starting index for project: \(projectId)", category: "RAG")

        // Get project files
        guard let files = try? ProjectRepository.shared.getProjectFiles(projectId: projectId) else {
            throw ProjectRAGError.noFilesFound
        }

        let textFiles = files.filter { isTextFile($0.name) }
        guard !textFiles.isEmpty else {
            throw ProjectRAGError.noTextFiles
        }

        var totalChunks = 0
        var indexedFiles = 0

        // Process each file
        for (fileIndex, file) in textFiles.enumerated() {
            // Update progress
            let progress = Double(fileIndex) / Double(textFiles.count)
            indexProgress = progress
            onProgress?(progress, file.name)

            do {
                // Read file content
                guard let content = file.content, !content.isEmpty else {
                    continue
                }

                // Split into chunks
                let chunks = splitIntoChunks(
                    content: content,
                    projectId: projectId,
                    filePath: file.path
                )

                // Generate embeddings and store
                for chunk in chunks {
                    let embedding = try await generateEmbedding(for: chunk.content)

                    let vectorId = "\(projectId)_\(file.id)_\(chunk.chunkIndex)"
                    let metadata: [String: String] = [
                        "projectId": projectId,
                        "filePath": chunk.filePath,
                        "chunkIndex": String(chunk.chunkIndex),
                        "startOffset": String(chunk.startOffset),
                        "endOffset": String(chunk.endOffset)
                    ]

                    try vectorStore.saveVector(
                        id: vectorId,
                        vector: embedding,
                        content: chunk.content,
                        metadata: metadata
                    )

                    totalChunks += 1
                }

                indexedFiles += 1

            } catch {
                logger.error("[ProjectRAG] Failed to index file: \(file.name)", error: error, category: "RAG")
            }
        }

        // Mark project as indexed
        indexedProjects.insert(projectId)

        let indexInfo = ProjectIndexInfo(
            projectId: projectId,
            totalFiles: textFiles.count,
            indexedFiles: indexedFiles,
            totalChunks: totalChunks,
            lastIndexedAt: Date(),
            indexSize: totalChunks * embeddingDimension * 4  // 4 bytes per float
        )

        logger.info("[ProjectRAG] Index completed: \(indexedFiles)/\(textFiles.count) files, \(totalChunks) chunks", category: "RAG")

        return indexInfo
    }

    /// RAG 查询
    /// Reference: desktop-app-vue/src/main/project/project-rag-ipc.js (project:ragQuery)
    func query(
        projectId: String,
        query: String,
        topK: Int = 5,
        minScore: Float = 0.3
    ) async throws -> [RAGQueryResult] {
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return []
        }

        logger.info("[ProjectRAG] Query: \(query.prefix(50))... for project: \(projectId)", category: "RAG")

        // Generate query embedding
        let queryEmbedding = try await generateEmbedding(for: query)

        // Search in vector store
        let searchResults = try vectorStore.searchSimilar(
            query: queryEmbedding,
            topK: topK * 2,  // Get more results to filter
            filter: { metadata in
                metadata["projectId"] == projectId
            }
        )

        // Convert to RAG results
        var results: [RAGQueryResult] = []

        for (vector, score) in searchResults {
            guard score >= minScore else { continue }

            let result = RAGQueryResult(
                projectId: vector.metadata["projectId"] ?? projectId,
                filePath: vector.metadata["filePath"] ?? "",
                content: vector.content,
                score: score,
                chunkIndex: Int(vector.metadata["chunkIndex"] ?? "0") ?? 0,
                metadata: vector.metadata
            )
            results.append(result)

            if results.count >= topK {
                break
            }
        }

        logger.info("[ProjectRAG] Query returned \(results.count) results", category: "RAG")

        return results
    }

    /// 增强查询（带上下文构建）
    func enhancedQuery(
        projectId: String,
        query: String,
        topK: Int = 5
    ) async throws -> (results: [RAGQueryResult], context: String) {
        let results = try await self.query(projectId: projectId, query: query, topK: topK)

        // Build context string
        var context = ""
        if !results.isEmpty {
            context = "以下是与查询相关的项目文件内容:\n\n"

            for (index, result) in results.enumerated() {
                context += "【参考资料 \(index + 1)】\n"
                context += "文件: \(result.filePath)\n"
                context += "相关度: \(String(format: "%.2f", result.score * 100))%\n"
                context += "内容:\n\(result.content)\n\n"
            }
        }

        return (results, context)
    }

    /// 更新文件索引
    /// Reference: desktop-app-vue/src/main/project/project-rag-ipc.js (project:updateFileIndex)
    func updateFileIndex(
        projectId: String,
        filePath: String,
        content: String
    ) async throws {
        logger.info("[ProjectRAG] Updating index for file: \(filePath)", category: "RAG")

        // Delete existing chunks for this file
        try deleteFileChunks(projectId: projectId, filePath: filePath)

        // Get file ID (if exists)
        let files = try? ProjectRepository.shared.getProjectFiles(projectId: projectId)
        let fileId = files?.first(where: { $0.path == filePath })?.id ?? UUID().uuidString

        // Split into chunks and index
        let chunks = splitIntoChunks(content: content, projectId: projectId, filePath: filePath)

        for chunk in chunks {
            let embedding = try await generateEmbedding(for: chunk.content)

            let vectorId = "\(projectId)_\(fileId)_\(chunk.chunkIndex)"
            let metadata: [String: String] = [
                "projectId": projectId,
                "filePath": chunk.filePath,
                "chunkIndex": String(chunk.chunkIndex),
                "startOffset": String(chunk.startOffset),
                "endOffset": String(chunk.endOffset)
            ]

            try vectorStore.saveVector(
                id: vectorId,
                vector: embedding,
                content: chunk.content,
                metadata: metadata
            )
        }

        logger.info("[ProjectRAG] File index updated: \(filePath), \(chunks.count) chunks", category: "RAG")
    }

    /// 删除项目索引
    /// Reference: desktop-app-vue/src/main/project/project-rag-ipc.js (project:deleteIndex)
    func deleteProjectIndex(projectId: String) throws {
        logger.info("[ProjectRAG] Deleting index for project: \(projectId)", category: "RAG")

        try vectorStore.deleteVectors(filter: { metadata in
            metadata["projectId"] == projectId
        })

        indexedProjects.remove(projectId)

        logger.info("[ProjectRAG] Project index deleted: \(projectId)", category: "RAG")
    }

    /// 获取索引统计
    /// Reference: desktop-app-vue/src/main/project/project-rag-ipc.js (project:getIndexStats)
    func getIndexStats(projectId: String) -> ProjectIndexInfo? {
        guard indexedProjects.contains(projectId) else {
            return nil
        }

        let chunks = vectorStore.getVectors(filter: { metadata in
            metadata["projectId"] == projectId
        })

        let filePaths = Set(chunks.compactMap { $0.metadata["filePath"] })

        return ProjectIndexInfo(
            projectId: projectId,
            totalFiles: filePaths.count,
            indexedFiles: filePaths.count,
            totalChunks: chunks.count,
            lastIndexedAt: Date(),
            indexSize: chunks.count * embeddingDimension * 4
        )
    }

    /// 检查项目是否已索引
    func isProjectIndexed(_ projectId: String) -> Bool {
        return indexedProjects.contains(projectId)
    }

    /// 刷新项目索引
    func refreshIndex(projectId: String) async throws -> ProjectIndexInfo {
        // Delete existing index
        try deleteProjectIndex(projectId: projectId)

        // Re-index
        return try await indexProjectFiles(projectId: projectId)
    }

    // MARK: - Private Helpers

    private func splitIntoChunks(content: String, projectId: String, filePath: String) -> [FileChunk] {
        var chunks: [FileChunk] = []
        var currentIndex = content.startIndex
        var chunkIndex = 0

        while currentIndex < content.endIndex && chunkIndex < maxChunksPerFile {
            let startOffset = content.distance(from: content.startIndex, to: currentIndex)

            // Calculate end index for this chunk
            let endDistance = min(chunkSize, content.distance(from: currentIndex, to: content.endIndex))
            var endIndex = content.index(currentIndex, offsetBy: endDistance)

            // Try to end at a sentence or paragraph boundary
            if endIndex < content.endIndex {
                let searchRange = currentIndex..<endIndex
                if let periodRange = content.range(of: "。", options: .backwards, range: searchRange) {
                    endIndex = content.index(after: periodRange.upperBound)
                } else if let newlineRange = content.range(of: "\n", options: .backwards, range: searchRange) {
                    endIndex = newlineRange.upperBound
                }
            }

            let chunkContent = String(content[currentIndex..<endIndex])
            let endOffset = content.distance(from: content.startIndex, to: endIndex)

            if !chunkContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                chunks.append(FileChunk(
                    projectId: projectId,
                    filePath: filePath,
                    content: chunkContent,
                    chunkIndex: chunkIndex,
                    startOffset: startOffset,
                    endOffset: endOffset
                ))
                chunkIndex += 1
            }

            // Move to next chunk with overlap
            if endIndex < content.endIndex {
                let overlapOffset = max(0, endDistance - chunkOverlap)
                currentIndex = content.index(currentIndex, offsetBy: overlapOffset, limitedBy: content.endIndex) ?? content.endIndex
            } else {
                break
            }
        }

        return chunks
    }

    private func generateEmbedding(for text: String) async throws -> [Float] {
        // Use LLM manager to generate embeddings
        let result = try await llmManager.generateEmbedding(text: text)

        guard let embedding = result["embedding"] as? [Float], !embedding.isEmpty else {
            // Fallback: generate simple TF-IDF-like embedding
            return generateSimpleEmbedding(for: text)
        }

        return embedding
    }

    private func generateSimpleEmbedding(for text: String) -> [Float] {
        // Simple hash-based embedding as fallback
        var embedding = [Float](repeating: 0, count: embeddingDimension)

        let words = text.lowercased().components(separatedBy: .whitespacesAndNewlines)
        for word in words where !word.isEmpty {
            let hash = word.hashValue
            let index = abs(hash) % embeddingDimension
            embedding[index] += 1.0
        }

        // Normalize
        let magnitude = sqrt(embedding.reduce(0) { $0 + $1 * $1 })
        if magnitude > 0 {
            embedding = embedding.map { $0 / magnitude }
        }

        return embedding
    }

    private func deleteFileChunks(projectId: String, filePath: String) throws {
        try vectorStore.deleteVectors(filter: { metadata in
            metadata["projectId"] == projectId && metadata["filePath"] == filePath
        })
    }

    private func isTextFile(_ fileName: String) -> Bool {
        let textExtensions = [
            "txt", "md", "markdown",
            "swift", "kt", "java", "js", "ts", "jsx", "tsx",
            "py", "rb", "go", "rs", "c", "cpp", "h", "hpp",
            "html", "css", "scss", "sass", "less",
            "json", "yaml", "yml", "xml", "toml",
            "sql", "sh", "bash", "zsh",
            "vue", "svelte"
        ]

        let ext = (fileName as NSString).pathExtension.lowercased()
        return textExtensions.contains(ext)
    }
}

// MARK: - Errors

enum ProjectRAGError: LocalizedError {
    case noFilesFound
    case noTextFiles
    case embeddingFailed
    case indexFailed(String)

    var errorDescription: String? {
        switch self {
        case .noFilesFound:
            return "项目中没有找到文件"
        case .noTextFiles:
            return "项目中没有可索引的文本文件"
        case .embeddingFailed:
            return "生成向量嵌入失败"
        case .indexFailed(let message):
            return "索引失败: \(message)"
        }
    }
}

// MARK: - VectorStoreRepository Extensions

extension VectorStoreRepository {
    /// 根据过滤条件搜索相似向量
    func searchSimilar(
        query: [Float],
        topK: Int,
        filter: ((Dictionary<String, String>) -> Bool)? = nil
    ) throws -> [(VectorEntity, Float)] {
        var results: [(VectorEntity, Float)] = []

        let allVectors = getAllVectors()

        for vector in allVectors {
            // Apply filter if provided
            if let filter = filter, !filter(vector.metadata) {
                continue
            }

            // Calculate cosine similarity
            let similarity = cosineSimilarity(query, vector.vector)
            results.append((vector, similarity))
        }

        // Sort by similarity descending
        results.sort { $0.1 > $1.1 }

        return Array(results.prefix(topK))
    }

    /// 根据过滤条件获取向量
    func getVectors(filter: @escaping (Dictionary<String, String>) -> Bool) -> [VectorEntity] {
        return getAllVectors().filter { filter($0.metadata) }
    }

    /// 根据过滤条件删除向量
    func deleteVectors(filter: @escaping (Dictionary<String, String>) -> Bool) throws {
        let vectorsToDelete = getVectors(filter: filter)
        for vector in vectorsToDelete {
            try deleteVector(id: vector.id)
        }
    }

    private func cosineSimilarity(_ a: [Float], _ b: [Float]) -> Float {
        guard a.count == b.count, !a.isEmpty else { return 0 }

        var dotProduct: Float = 0
        var normA: Float = 0
        var normB: Float = 0

        for i in 0..<a.count {
            dotProduct += a[i] * b[i]
            normA += a[i] * a[i]
            normB += b[i] * b[i]
        }

        let denominator = sqrt(normA) * sqrt(normB)
        return denominator > 0 ? dotProduct / denominator : 0
    }
}
