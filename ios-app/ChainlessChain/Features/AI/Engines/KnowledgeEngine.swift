import Foundation

/// 知识引擎
///
/// 负责知识库管理、RAG检索、问答等任务
/// 参考：PC端 desktop-app-vue/src/main/ai-engine/engines/knowledge-engine.js
public class KnowledgeEngine: BaseAIEngine {

    public static let shared = KnowledgeEngine()

    // 检索策略
    public enum RetrievalStrategy: String {
        case semantic = "semantic"      // 语义检索
        case keyword = "keyword"        // 关键词检索
        case hybrid = "hybrid"          // 混合检索
        case rerank = "rerank"         // 重排序
    }

    // 知识类型
    public enum KnowledgeType: String {
        case note = "note"              // 笔记
        case document = "document"      // 文档
        case conversation = "conversation" // 对话
        case web = "web"               // 网页
        case code = "code"             // 代码
        case media = "media"           // 媒体
    }

    private init() {
        super.init(
            type: .knowledge,
            name: "知识引擎",
            description: "处理知识库管理、RAG检索、问答等任务"
        )
    }

    public override var capabilities: [AIEngineCapability] {
        return [
            AIEngineCapability(
                id: "knowledge_search",
                name: "知识搜索",
                description: "在知识库中搜索相关内容"
            ),
            AIEngineCapability(
                id: "semantic_search",
                name: "语义搜索",
                description: "基于语义理解的智能搜索"
            ),
            AIEngineCapability(
                id: "qa",
                name: "问答",
                description: "基于知识库回答问题"
            ),
            AIEngineCapability(
                id: "knowledge_add",
                name: "知识添加",
                description: "添加新知识到知识库"
            ),
            AIEngineCapability(
                id: "knowledge_update",
                name: "知识更新",
                description: "更新知识库内容"
            ),
            AIEngineCapability(
                id: "knowledge_delete",
                name: "知识删除",
                description: "从知识库删除知识"
            ),
            AIEngineCapability(
                id: "summarize",
                name: "知识摘要",
                description: "生成知识摘要和要点"
            ),
            AIEngineCapability(
                id: "tag_generation",
                name: "标签生成",
                description: "自动生成知识标签"
            ),
            AIEngineCapability(
                id: "relation_extract",
                name: "关系提取",
                description: "提取知识间的关联关系"
            ),
            AIEngineCapability(
                id: "knowledge_graph",
                name: "知识图谱",
                description: "构建和查询知识图谱"
            )
        ]
    }

    // MARK: - 初始化

    public override func initialize() async throws {
        try await super.initialize()

        // 初始化RAG系统
        Logger.shared.info("知识引擎初始化完成")
    }

    // MARK: - 任务执行

    public override func execute(task: String, parameters: [String: Any]) async throws -> Any {
        guard status != .initializing else {
            throw AIEngineError.notInitialized
        }

        status = .running
        defer { status = .idle }

        Logger.shared.info("知识引擎执行任务: \(task)")

        // 根据任务类型执行不同操作
        switch task {
        case "search":
            return try await searchKnowledge(parameters: parameters)

        case "semantic_search":
            return try await semanticSearch(parameters: parameters)

        case "qa":
            return try await answerQuestion(parameters: parameters)

        case "add":
            return try await addKnowledge(parameters: parameters)

        case "update":
            return try await updateKnowledge(parameters: parameters)

        case "delete":
            return try await deleteKnowledge(parameters: parameters)

        case "summarize":
            return try await summarizeKnowledge(parameters: parameters)

        case "generate_tags":
            return try await generateTags(parameters: parameters)

        case "extract_relations":
            return try await extractRelations(parameters: parameters)

        case "recommend":
            return try await recommendKnowledge(parameters: parameters)

        default:
            throw AIEngineError.capabilityNotSupported(task)
        }
    }

    // MARK: - 知识搜索

    /// 搜索知识库
    private func searchKnowledge(parameters: [String: Any]) async throws -> [String: Any] {
        guard let query = parameters["query"] as? String else {
            throw AIEngineError.invalidParameters("缺少query参数")
        }

        let limit = parameters["limit"] as? Int ?? 10
        let strategy = RetrievalStrategy(rawValue: parameters["strategy"] as? String ?? "hybrid") ?? .hybrid
        let knowledgeTypes = parameters["types"] as? [String]

        // 根据策略执行搜索
        var results: [[String: Any]] = []

        switch strategy {
        case .keyword:
            results = try await keywordSearch(query: query, limit: limit, types: knowledgeTypes)

        case .semantic:
            results = try await performSemanticSearch(query: query, limit: limit, types: knowledgeTypes)

        case .hybrid:
            // 混合搜索：结合关键词和语义
            let keywordResults = try await keywordSearch(query: query, limit: limit / 2, types: knowledgeTypes)
            let semanticResults = try await performSemanticSearch(query: query, limit: limit / 2, types: knowledgeTypes)
            results = mergeResults(keywordResults, semanticResults)

        case .rerank:
            // 先获取更多结果，然后重排序
            let initialResults = try await performSemanticSearch(query: query, limit: limit * 3, types: knowledgeTypes)
            results = try await rerankResults(query: query, results: initialResults, limit: limit)
        }

        return [
            "results": results,
            "count": results.count,
            "query": query,
            "strategy": strategy.rawValue
        ]
    }

    /// 关键词搜索
    private func keywordSearch(query: String, limit: Int, types: [String]?) async throws -> [[String: Any]] {
        // 简单的关键词匹配实现
        // 实际应用中需要集成全文搜索引擎（如SQLite FTS5）

        let keywords = query.lowercased().components(separatedBy: .whitespaces)

        // 模拟搜索结果
        return [
            [
                "id": "1",
                "title": "搜索结果1",
                "content": "包含关键词的内容...",
                "type": "note",
                "score": 0.8,
                "matchedKeywords": keywords
            ]
        ]
    }

    /// 语义搜索
    private func semanticSearch(parameters: [String: Any]) async throws -> [String: Any] {
        guard let query = parameters["query"] as? String else {
            throw AIEngineError.invalidParameters("缺少query参数")
        }

        let limit = parameters["limit"] as? Int ?? 10
        let threshold = parameters["threshold"] as? Double ?? 0.7
        let types = parameters["types"] as? [String]

        let results = try await performSemanticSearch(
            query: query,
            limit: limit,
            types: types,
            threshold: threshold
        )

        return [
            "results": results,
            "count": results.count,
            "query": query,
            "threshold": threshold
        ]
    }

    /// 执行语义搜索
    private func performSemanticSearch(
        query: String,
        limit: Int,
        types: [String]?,
        threshold: Double = 0.7
    ) async throws -> [[String: Any]] {
        // TODO: 集成向量数据库（Qdrant或本地向量存储）
        // 1. 使用Embedding模型将查询转换为向量
        // 2. 在向量数据库中搜索相似向量
        // 3. 返回匹配的知识条目

        // 模拟语义搜索结果
        return [
            [
                "id": "semantic_1",
                "title": "语义相关内容",
                "content": "这是与查询语义相关的内容...",
                "type": "note",
                "similarity": 0.92,
                "embedding": [] as [Double]
            ]
        ]
    }

    // MARK: - 问答

    /// 回答问题
    private func answerQuestion(parameters: [String: Any]) async throws -> [String: Any] {
        guard let question = parameters["question"] as? String else {
            throw AIEngineError.invalidParameters("缺少question参数")
        }

        let maxContext = parameters["maxContext"] as? Int ?? 3
        let includeSource = parameters["includeSource"] as? Bool ?? true

        // 1. 检索相关知识
        let searchResults = try await performSemanticSearch(
            query: question,
            limit: maxContext,
            types: nil
        )

        // 2. 构建上下文
        let context = searchResults.map { result -> String in
            let title = result["title"] as? String ?? ""
            let content = result["content"] as? String ?? ""
            return "\(title)\n\(content)"
        }.joined(separator: "\n\n---\n\n")

        // 3. 使用LLM生成答案
        let prompt = """
        请基于以下知识库内容回答问题：

        问题：\(question)

        知识库内容：
        \(context)

        要求：
        1. 基于提供的知识回答，不要编造信息
        2. 如果知识库中没有相关信息，请明确说明
        3. 引用具体的知识来源
        4. 回答要准确、简洁、有条理
        """

        let answer = try await generateWithLLM(
            prompt: prompt,
            systemPrompt: "你是一个知识问答助手，擅长基于知识库准确回答用户问题。"
        )

        var result: [String: Any] = [
            "question": question,
            "answer": answer,
            "contextCount": searchResults.count
        ]

        if includeSource {
            result["sources"] = searchResults.map { result in
                [
                    "id": result["id"] ?? "",
                    "title": result["title"] ?? "",
                    "similarity": result["similarity"] ?? 0.0
                ]
            }
        }

        return result
    }

    // MARK: - 知识管理

    /// 添加知识
    private func addKnowledge(parameters: [String: Any]) async throws -> [String: Any] {
        guard let content = parameters["content"] as? String else {
            throw AIEngineError.invalidParameters("缺少content参数")
        }

        let title = parameters["title"] as? String ?? ""
        let type = KnowledgeType(rawValue: parameters["type"] as? String ?? "note") ?? .note
        let tags = parameters["tags"] as? [String] ?? []

        // 自动生成摘要和标签（如果没有提供）
        var generatedTags = tags
        if generatedTags.isEmpty {
            generatedTags = try await autoGenerateTags(content: content)
        }

        let summary = try await autoGenerateSummary(content: content)

        // TODO: 实际存储到数据库
        // 1. 生成向量嵌入
        // 2. 存储到SQLite
        // 3. 存储向量到向量数据库

        let knowledgeId = UUID().uuidString

        return [
            "id": knowledgeId,
            "title": title,
            "type": type.rawValue,
            "tags": generatedTags,
            "summary": summary,
            "created": Date().timeIntervalSince1970,
            "success": true
        ]
    }

    /// 更新知识
    private func updateKnowledge(parameters: [String: Any]) async throws -> [String: Any] {
        guard let knowledgeId = parameters["id"] as? String else {
            throw AIEngineError.invalidParameters("缺少id参数")
        }

        var updates: [String: Any] = [:]

        if let content = parameters["content"] as? String {
            updates["content"] = content
            // 重新生成向量嵌入
        }

        if let title = parameters["title"] as? String {
            updates["title"] = title
        }

        if let tags = parameters["tags"] as? [String] {
            updates["tags"] = tags
        }

        // TODO: 更新数据库

        return [
            "id": knowledgeId,
            "updated": updates,
            "timestamp": Date().timeIntervalSince1970,
            "success": true
        ]
    }

    /// 删除知识
    private func deleteKnowledge(parameters: [String: Any]) async throws -> [String: Any] {
        guard let knowledgeId = parameters["id"] as? String else {
            throw AIEngineError.invalidParameters("缺少id参数")
        }

        // TODO: 从数据库和向量库删除

        return [
            "id": knowledgeId,
            "deleted": true,
            "timestamp": Date().timeIntervalSince1970
        ]
    }

    // MARK: - 知识增强

    /// 生成知识摘要
    private func summarizeKnowledge(parameters: [String: Any]) async throws -> [String: Any] {
        guard let content = parameters["content"] as? String else {
            throw AIEngineError.invalidParameters("缺少content参数")
        }

        let maxLength = parameters["maxLength"] as? Int ?? 200

        let summary = try await autoGenerateSummary(content: content, maxLength: maxLength)

        return [
            "summary": summary,
            "originalLength": content.count,
            "summaryLength": summary.count
        ]
    }

    /// 自动生成摘要
    private func autoGenerateSummary(content: String, maxLength: Int = 200) async throws -> String {
        let prompt = """
        请为以下内容生成简洁的摘要（不超过\(maxLength)字）：

        \(content.prefix(2000))

        要求：
        1. 提炼核心内容
        2. 保留关键信息
        3. 语言简洁明了
        """

        return try await generateWithLLM(
            prompt: prompt,
            systemPrompt: "你是一个内容摘要专家，擅长提炼文本的核心要点。"
        )
    }

    /// 生成标签
    private func generateTags(parameters: [String: Any]) async throws -> [String: Any] {
        guard let content = parameters["content"] as? String else {
            throw AIEngineError.invalidParameters("缺少content参数")
        }

        let maxTags = parameters["maxTags"] as? Int ?? 5

        let tags = try await autoGenerateTags(content: content, maxTags: maxTags)

        return [
            "tags": tags,
            "count": tags.count
        ]
    }

    /// 自动生成标签
    private func autoGenerateTags(content: String, maxTags: Int = 5) async throws -> [String] {
        let prompt = """
        请为以下内容生成\(maxTags)个关键标签：

        \(content.prefix(1000))

        要求：
        1. 标签简洁（2-4个字）
        2. 准确反映主题
        3. 按重要性排序
        4. 只返回标签列表，用逗号分隔
        """

        let response = try await generateWithLLM(
            prompt: prompt,
            systemPrompt: "你是一个内容标签生成专家。"
        )

        // 解析标签
        let tags = response
            .components(separatedBy: CharacterSet(charactersIn: ",，、"))
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .prefix(maxTags)

        return Array(tags)
    }

    /// 提取关系
    private func extractRelations(parameters: [String: Any]) async throws -> [String: Any] {
        guard let content = parameters["content"] as? String else {
            throw AIEngineError.invalidParameters("缺少content参数")
        }

        let prompt = """
        请分析以下内容，提取其中的实体和关系：

        \(content.prefix(2000))

        请以JSON格式返回：
        {
          "entities": [{"name": "实体名", "type": "实体类型"}],
          "relations": [{"from": "实体1", "to": "实体2", "type": "关系类型"}]
        }
        """

        let response = try await generateWithLLM(
            prompt: prompt,
            systemPrompt: "你是一个知识图谱构建专家，擅长提取实体和关系。"
        )

        // 解析JSON响应
        if let jsonData = response.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] {
            return json
        }

        return [
            "entities": [],
            "relations": []
        ]
    }

    // MARK: - 知识推荐

    /// 推荐相关知识
    private func recommendKnowledge(parameters: [String: Any]) async throws -> [String: Any] {
        guard let knowledgeId = parameters["id"] as? String else {
            throw AIEngineError.invalidParameters("缺少id参数")
        }

        let limit = parameters["limit"] as? Int ?? 5

        // TODO: 基于知识向量相似度推荐
        // 1. 获取当前知识的向量
        // 2. 在向量数据库中查找相似知识
        // 3. 返回推荐列表

        // 模拟推荐结果
        let recommendations: [[String: Any]] = [
            [
                "id": "rec_1",
                "title": "相关知识1",
                "type": "note",
                "similarity": 0.85
            ]
        ]

        return [
            "recommendations": recommendations,
            "count": recommendations.count,
            "baseKnowledgeId": knowledgeId
        ]
    }

    // MARK: - 辅助方法

    /// 合并搜索结果
    private func mergeResults(
        _ results1: [[String: Any]],
        _ results2: [[String: Any]]
    ) -> [[String: Any]] {
        var merged = results1
        let ids1 = Set(results1.compactMap { $0["id"] as? String })

        for result in results2 {
            if let id = result["id"] as? String, !ids1.contains(id) {
                merged.append(result)
            }
        }

        return merged
    }

    /// 重排序结果
    private func rerankResults(
        query: String,
        results: [[String: Any]],
        limit: Int
    ) async throws -> [[String: Any]] {
        // TODO: 使用reranker模型重新排序
        // 这里简化实现，按原有分数排序

        let sorted = results.sorted { result1, result2 in
            let score1 = result1["similarity"] as? Double ?? 0.0
            let score2 = result2["similarity"] as? Double ?? 0.0
            return score1 > score2
        }

        return Array(sorted.prefix(limit))
    }
}
