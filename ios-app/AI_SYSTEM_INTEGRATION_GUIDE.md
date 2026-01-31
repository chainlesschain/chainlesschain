# iOS AI系统集成指南

## 概述

本指南说明如何将完整的AI系统集成到iOS应用中，包括所有引擎、Agent、UI组件的使用方法。

---

## 快速开始

### 1. 初始化AI系统

在应用启动时初始化所有组件：

```swift
// AppDelegate.swift 或 App.swift

import SwiftUI

@main
struct ChainlessChainApp: App {
    init() {
        // 初始化AI系统
        setupAISystem()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }

    private func setupAISystem() {
        // 1. 初始化AI引擎管理器
        let engineManager = AIEngineManager.shared

        // 2. 注册所有引擎（自动完成）
        Task {
            try? await engineManager.initialize()
            Logger.shared.info("AI引擎系统已初始化")
        }

        // 3. 初始化Agent系统
        let orchestrator = AgentOrchestrator.shared
        Logger.shared.info("Agent系统已初始化")

        // 4. 注册扩展工具
        ToolManager.shared.registerExtendedTools()
        Logger.shared.info("扩展工具已注册")

        // 5. 创建向量存储
        VectorStoreManager.shared.createStore(name: "default", persistent: false)
        VectorStoreManager.shared.createStore(name: "knowledge", persistent: true)
        Logger.shared.info("向量存储已创建")
    }
}
```

### 2. 使用AI控制台（推荐）

最简单的集成方式是使用AIDashboardView作为入口：

```swift
// ContentView.swift

import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            // AI控制台
            AIDashboardView()
                .tabItem {
                    Label("AI控制台", systemImage: "cpu")
                }

            // 你的其他Tab
            // ...
        }
    }
}
```

### 3. 独立使用各模块

如果只需要某个特定功能：

```swift
// 只显示AI引擎监控
NavigationView {
    AIEngineMonitorView()
}

// 只显示向量搜索
NavigationView {
    VectorStoreView()
}

// 只显示任务执行
NavigationView {
    TaskExecutionView()
}
```

---

## 核心功能使用

### 1. 使用AI引擎

#### 1.1 直接调用引擎

```swift
// 获取引擎管理器
let engineManager = AIEngineManager.shared

// 方式1: 按类型获取引擎
if let dataEngine = engineManager.getEngine(type: .data) {
    let result = try await dataEngine.execute(
        task: "统计分析",
        parameters: [
            "data": [1.0, 2.0, 3.0, 4.0, 5.0]
        ]
    )
    print(result)
}

// 方式2: 智能路由（推荐）
let result = try await engineManager.route(
    task: "分析这组数据的统计特征: [1,2,3,4,5]",
    parameters: [:]
)
// 系统自动选择DataEngine处理
```

#### 1.2 使用特定引擎能力

```swift
// CodeEngine - 代码生成
let codeEngine = AIEngineManager.shared.getEngine(type: .code)
let code = try await codeEngine?.execute(
    task: "生成代码",
    parameters: [
        "language": "Swift",
        "description": "实现快速排序算法"
    ]
)

// KnowledgeEngine - RAG问答
let knowledgeEngine = AIEngineManager.shared.getEngine(type: .knowledge)
let answer = try await knowledgeEngine?.execute(
    task: "回答问题",
    parameters: [
        "question": "什么是向量数据库？",
        "maxContext": 5
    ]
)

// ImageEngine - OCR识别
let imageEngine = AIEngineManager.shared.getEngine(type: .image)
let text = try await imageEngine?.execute(
    task: "OCR识别",
    parameters: [
        "imagePath": "/path/to/image.jpg",
        "language": "zh-Hans"
    ]
)
```

---

### 2. 使用Multi-Agent系统

#### 2.1 执行复杂任务

```swift
let orchestrator = AgentOrchestrator.shared

// 让系统自动分解并执行复杂任务
let result = try await orchestrator.executeComplexTask(
    description: "创建一个用户注册功能，包括前端页面、后端API和数据库设计",
    parameters: [:]
)

print(result)
// 输出:
// {
//   "subtasks": [
//     { "id": "task1", "description": "设计数据库表结构", "assignedTo": "analyzer" },
//     { "id": "task2", "description": "编写后端API", "assignedTo": "coder", "dependencies": ["task1"] },
//     { "id": "task3", "description": "开发前端页面", "assignedTo": "coder", "dependencies": ["task2"] }
//   ],
//   "results": { ... },
//   "totalTasks": 3
// }
```

#### 2.2 使用特定Agent

```swift
// 获取特定Agent
if let coder = orchestrator.findAgent(byRole: .coder) {
    let task = AgentTask(
        id: UUID().uuidString,
        description: "编写一个HTTP客户端类",
        parameters: ["language": "Swift"],
        priority: .high,
        dependencies: []
    )

    let result = try await coder.execute(task: task)
    print(result.result)
}

// Agent思考
if let analyzer = orchestrator.findAgent(byRole: .analyzer) {
    let analysis = try await analyzer.think(about: "如何优化这个SQL查询？")
    print(analysis)
}
```

---

### 3. 使用向量存储

#### 3.1 添加向量

```swift
let vectorStore = VectorStoreManager.shared.getStore(name: "knowledge")

// 准备文本
let text = "向量数据库是一种专门用于存储和检索向量嵌入的数据库系统"

// 生成向量嵌入（需要embedding模型）
let embedding: [Float] = generateEmbedding(text: text) // 你的embedding函数

// 创建向量
let vector = Vector(
    id: UUID().uuidString,
    values: embedding,
    metadata: [
        "content": text,
        "category": "database",
        "timestamp": "\(Date().timeIntervalSince1970)"
    ]
)

// 插入向量
try await vectorStore.insert(vector: vector)
```

#### 3.2 语义搜索

```swift
let vectorStore = VectorStoreManager.shared.getStore(name: "knowledge")

// 查询文本
let query = "什么是向量数据库"

// 生成查询向量
let queryEmbedding = generateEmbedding(text: query)
let queryVector = Vector(id: "query", values: queryEmbedding, metadata: [:])

// 搜索
let results = try await vectorStore.search(
    query: queryVector,
    topK: 5,
    threshold: 0.7  // 只返回相似度>0.7的结果
)

// 处理结果
for result in results {
    print("ID: \(result.id)")
    print("相似度: \(result.score)")
    print("内容: \(result.metadata["content"] ?? "")")
    print("---")
}
```

#### 3.3 批量操作

```swift
// 批量插入
let vectors: [Vector] = texts.map { text in
    let embedding = generateEmbedding(text: text)
    return Vector(
        id: UUID().uuidString,
        values: embedding,
        metadata: ["content": text]
    )
}

try await vectorStore.insertBatch(vectors: vectors)

// 清空存储
try await vectorStore.clear()

// 获取数量
let count = try await vectorStore.count()
print("向量总数: \(count)")
```

---

### 4. 使用缓存系统

#### 4.1 LLM响应缓存

```swift
let cacheManager = CacheManager.shared

// 缓存LLM响应
let prompt = "解释什么是Swift"
if let cached = cacheManager.getCachedLLMResponse(for: prompt) {
    print("从缓存获取: \(cached)")
} else {
    // 调用LLM
    let response = try await llmManager.generate(prompt: prompt)
    // 缓存结果
    cacheManager.cacheLLMResponse(response, for: prompt)
    print("新生成: \(response)")
}
```

#### 4.2 引擎结果缓存

```swift
let cacheKey = "data_analysis_\(dataHash)"

// 检查缓存
if let cached: [String: Any] = cacheManager.getCachedEngineResult(for: cacheKey) {
    return cached
}

// 执行引擎
let result = try await dataEngine.execute(task: "分析", parameters: params)

// 缓存结果（5分钟过期）
cacheManager.cacheEngineResult(
    result,
    for: cacheKey,
    policy: .cacheFor(300)
)
```

#### 4.3 向量嵌入缓存

```swift
let text = "示例文本"

// 检查缓存
if let cached = cacheManager.getCachedEmbedding(for: text) {
    return cached
}

// 生成嵌入
let embedding = generateEmbedding(text: text)

// 缓存
cacheManager.cacheEmbedding(embedding, for: text)
```

#### 4.4 缓存管理

```swift
// 清空特定类型缓存
cacheManager.clearCache(type: .llm)
cacheManager.clearCache(type: .engine)
cacheManager.clearCache(type: .embedding)

// 清空所有缓存
cacheManager.clearAll()

// 获取统计信息
let stats = cacheManager.getStatistics()
print(stats)
// {
//   "llmCacheSize": "~100 items (LRU)",
//   "engineCacheSize": "~50 items (LRU)",
//   "embeddingCacheSize": "~200 items (LRU)",
//   "expirationCacheSize": 15
// }
```

---

### 5. 使用工具系统

#### 5.1 执行工具

```swift
let toolManager = ToolManager.shared

// 文本分词
let tokens = try await toolManager.execute(
    toolId: "tool.text.tokenize",
    input: [
        "text": "这是一段示例文本",
        "language": "zh"
    ]
)

// Base64编码
let encoded = try await toolManager.execute(
    toolId: "tool.crypto.base64.encode",
    input: ["text": "Hello World"]
)

// URL解析
let parsed = try await toolManager.execute(
    toolId: "tool.url.parse",
    input: ["url": "https://example.com/path?query=value"]
)
```

#### 5.2 列出可用工具

```swift
let allTools = toolManager.getAllTools()

for tool in allTools {
    print("ID: \(tool.id)")
    print("名称: \(tool.name)")
    print("类别: \(tool.category)")
    print("参数: \(tool.parameters.count)个")
    print("---")
}

// 按类别过滤
let textTools = allTools.filter { $0.category == .system }
```

---

### 6. 使用技能系统

#### 6.1 执行技能

```swift
let skillManager = SkillManager.shared

// 执行文档总结技能
let summary = try await skillManager.execute(
    skillId: "skill.document.summarize",
    input: [
        "document": documentText,
        "maxLength": 200
    ]
)

// 执行代码解释技能
let explanation = try await skillManager.execute(
    skillId: "skill.code.explain",
    input: [
        "code": sourceCode,
        "language": "Swift"
    ]
)
```

#### 6.2 列出技能

```swift
let allSkills = skillManager.getAllSkills()

for skill in allSkills {
    print("ID: \(skill.id)")
    print("名称: \(skill.name)")
    print("类别: \(skill.category)")
    print("依赖工具: \(skill.requiredTools.count)个")
    print("---")
}
```

---

## 实战示例

### 示例1: 智能文档分析系统

```swift
class DocumentAnalyzer {
    let engineManager = AIEngineManager.shared
    let vectorStore = VectorStoreManager.shared.getStore(name: "documents")
    let cacheManager = CacheManager.shared

    func analyzeDocument(path: String) async throws -> [String: Any] {
        // 1. 提取文本
        guard let docEngine = engineManager.getEngine(type: .document) else {
            throw AnalysisError.engineNotFound
        }

        let extracted = try await docEngine.execute(
            task: "提取文本",
            parameters: ["filePath": path]
        ) as! [String: Any]

        let text = extracted["text"] as! String

        // 2. 生成摘要（使用缓存）
        let cacheKey = "summary_\(path.hashValue)"
        var summary: String

        if let cached: String = cacheManager.getCachedEngineResult(for: cacheKey) {
            summary = cached
        } else {
            summary = try await docEngine.execute(
                task: "生成摘要",
                parameters: ["text": text, "maxLength": 200]
            ) as! String

            cacheManager.cacheEngineResult(summary, for: cacheKey, policy: .cacheFor(3600))
        }

        // 3. 提取关键词
        let keywords = try await ToolManager.shared.execute(
            toolId: "tool.text.keywords",
            input: ["text": text, "topK": 10]
        ) as! [String]

        // 4. 生成向量并存储
        let embedding = generateEmbedding(text: text)
        let vector = Vector(
            id: path,
            values: embedding,
            metadata: [
                "path": path,
                "summary": summary,
                "keywords": keywords.joined(separator: ",")
            ]
        )
        try await vectorStore.insert(vector: vector)

        return [
            "summary": summary,
            "keywords": keywords,
            "length": text.count
        ]
    }

    func searchSimilarDocuments(query: String) async throws -> [String] {
        let queryEmbedding = generateEmbedding(text: query)
        let queryVector = Vector(id: "query", values: queryEmbedding, metadata: [:])

        let results = try await vectorStore.search(
            query: queryVector,
            topK: 5,
            threshold: 0.7
        )

        return results.map { $0.metadata["path"] ?? "" }
    }

    private func generateEmbedding(text: String) -> [Float] {
        // 使用你的embedding模型
        // 这里返回模拟数据
        return (0..<384).map { _ in Float.random(in: -1...1) }
    }
}

// 使用
let analyzer = DocumentAnalyzer()
let result = try await analyzer.analyzeDocument(path: "/path/to/doc.pdf")
print(result)

let similar = try await analyzer.searchSimilarDocuments(query: "机器学习")
print(similar)
```

### 示例2: 智能代码助手

```swift
class CodeAssistant {
    let orchestrator = AgentOrchestrator.shared
    let codeEngine = AIEngineManager.shared.getEngine(type: .code)

    func implementFeature(description: String) async throws -> [String: Any] {
        // 使用Multi-Agent系统分解和实现功能
        let result = try await orchestrator.executeComplexTask(
            description: "实现功能: \(description)",
            parameters: [
                "includeTests": true,
                "includeDocumentation": true
            ]
        )

        return result
    }

    func reviewCode(code: String, language: String) async throws -> [String: Any] {
        guard let engine = codeEngine else {
            throw AssistantError.engineNotFound
        }

        let review = try await engine.execute(
            task: "代码审查",
            parameters: [
                "code": code,
                "language": language,
                "checkSecurity": true
            ]
        ) as! [String: Any]

        return review
    }

    func explainCode(code: String, language: String) async throws -> String {
        let explanation = try await SkillManager.shared.execute(
            skillId: "skill.code.explain",
            input: [
                "code": code,
                "language": language
            ]
        ) as! String

        return explanation
    }

    func generateTests(code: String, language: String) async throws -> String {
        guard let engine = codeEngine else {
            throw AssistantError.engineNotFound
        }

        let tests = try await engine.execute(
            task: "生成测试",
            parameters: [
                "code": code,
                "language": language
            ]
        ) as! String

        return tests
    }
}

// 使用
let assistant = CodeAssistant()

// 1. 实现功能
let implementation = try await assistant.implementFeature(
    description: "用户登录功能，支持邮箱和手机号登录"
)

// 2. 审查代码
let review = try await assistant.reviewCode(
    code: sourceCode,
    language: "Swift"
)

// 3. 解释代码
let explanation = try await assistant.explainCode(
    code: complexCode,
    language: "Swift"
)
```

### 示例3: 智能客服系统

```swift
class CustomerServiceBot {
    let knowledgeEngine = AIEngineManager.shared.getEngine(type: .knowledge)
    let vectorStore = VectorStoreManager.shared.getStore(name: "knowledge")
    let cacheManager = CacheManager.shared

    func answer(question: String) async throws -> String {
        // 1. 检查缓存
        let cacheKey = "qa_\(question.hashValue)"
        if let cached: String = cacheManager.getCachedLLMResponse(for: cacheKey) {
            return cached
        }

        // 2. 语义搜索相关知识
        let queryEmbedding = generateEmbedding(text: question)
        let queryVector = Vector(id: "query", values: queryEmbedding, metadata: [:])

        let results = try await vectorStore.search(
            query: queryVector,
            topK: 3,
            threshold: 0.8
        )

        // 3. 使用知识引擎生成答案
        guard let engine = knowledgeEngine else {
            throw BotError.engineNotFound
        }

        let context = results.map { $0.metadata["content"] ?? "" }.joined(separator: "\n\n")

        let answer = try await engine.execute(
            task: "回答问题",
            parameters: [
                "question": question,
                "context": context,
                "maxContext": 3
            ]
        ) as! String

        // 4. 缓存答案
        cacheManager.cacheLLMResponse(answer, for: cacheKey)

        return answer
    }

    func addKnowledge(content: String, category: String) async throws {
        let embedding = generateEmbedding(text: content)
        let vector = Vector(
            id: UUID().uuidString,
            values: embedding,
            metadata: [
                "content": content,
                "category": category,
                "timestamp": "\(Date().timeIntervalSince1970)"
            ]
        )

        try await vectorStore.insert(vector: vector)
    }

    private func generateEmbedding(text: String) -> [Float] {
        // 实际使用embedding模型
        return (0..<384).map { _ in Float.random(in: -1...1) }
    }
}

// 使用
let bot = CustomerServiceBot()

// 添加知识
try await bot.addKnowledge(
    content: "我们的营业时间是周一到周五9:00-18:00",
    category: "营业信息"
)

// 回答问题
let answer = try await bot.answer(question: "你们什么时候营业？")
print(answer)
```

---

## 性能优化建议

### 1. 使用缓存

```swift
// ✅ 好：使用缓存避免重复LLM调用
if let cached = cacheManager.getCachedLLMResponse(for: prompt) {
    return cached
}
let response = try await llm.generate(prompt: prompt)
cacheManager.cacheLLMResponse(response, for: prompt)

// ❌ 坏：每次都调用LLM
let response = try await llm.generate(prompt: prompt)
```

### 2. 并行执行

```swift
// ✅ 好：并行执行多个独立任务
async let summary = docEngine.execute(task: "摘要", parameters: params1)
async let keywords = docEngine.execute(task: "关键词", parameters: params2)

let results = try await [summary, keywords]

// ❌ 坏：串行执行
let summary = try await docEngine.execute(task: "摘要", parameters: params1)
let keywords = try await docEngine.execute(task: "关键词", parameters: params2)
```

### 3. 批量操作

```swift
// ✅ 好：批量插入向量
try await vectorStore.insertBatch(vectors: vectors)

// ❌ 坏：逐个插入
for vector in vectors {
    try await vectorStore.insert(vector: vector)
}
```

### 4. 使用Multi-Agent分解任务

```swift
// ✅ 好：让Agent系统自动分解和并行执行
let result = try await orchestrator.executeComplexTask(
    description: "复杂任务",
    parameters: [:]
)

// ❌ 坏：手动分解和串行执行
let step1 = try await engine1.execute(...)
let step2 = try await engine2.execute(...)
let step3 = try await engine3.execute(...)
```

---

## 错误处理

### 1. 基础错误处理

```swift
do {
    let result = try await engineManager.route(
        task: "分析数据",
        parameters: params
    )
    print(result)
} catch AIEngineError.engineNotFound {
    print("未找到合适的引擎")
} catch AIEngineError.executionFailed(let message) {
    print("执行失败: \(message)")
} catch {
    print("未知错误: \(error)")
}
```

### 2. 带重试的错误处理

```swift
func executeWithRetry<T>(
    maxRetries: Int = 3,
    operation: () async throws -> T
) async throws -> T {
    var lastError: Error?

    for attempt in 1...maxRetries {
        do {
            return try await operation()
        } catch {
            lastError = error
            Logger.shared.warning("尝试 \(attempt)/\(maxRetries) 失败: \(error)")

            if attempt < maxRetries {
                try await Task.sleep(nanoseconds: UInt64(attempt) * 1_000_000_000)
            }
        }
    }

    throw lastError ?? NSError(domain: "retry", code: -1)
}

// 使用
let result = try await executeWithRetry {
    try await engineManager.route(task: "任务", parameters: params)
}
```

---

## 调试技巧

### 1. 启用详细日志

```swift
// 在AppDelegate或App.swift中设置
Logger.shared.setLevel(.debug)

// 查看引擎执行日志
Logger.shared.debug("执行引擎: \(engineType)")
```

### 2. 监控缓存命中率

```swift
extension CacheManager {
    var stats: [String: Any] {
        getStatistics()
    }

    func printStats() {
        let stats = getStatistics()
        print("=== 缓存统计 ===")
        for (key, value) in stats {
            print("\(key): \(value)")
        }
    }
}

// 定期检查
Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { _ in
    CacheManager.shared.printStats()
}
```

### 3. 性能监控

```swift
func measurePerformance<T>(
    name: String,
    operation: () async throws -> T
) async rethrows -> T {
    let start = Date()
    let result = try await operation()
    let duration = Date().timeIntervalSince(start)

    Logger.shared.info("[\(name)] 耗时: \(String(format: "%.2f", duration))秒")

    return result
}

// 使用
let result = try await measurePerformance(name: "数据分析") {
    try await dataEngine.execute(task: "分析", parameters: params)
}
```

---

## 常见问题

### Q1: 如何选择合适的引擎？

**A**: 使用智能路由功能，系统会根据任务描述自动选择：

```swift
// 让系统自动选择
let result = try await engineManager.route(
    task: "分析这张图片中的文字",
    parameters: ["imagePath": path]
)
// 自动选择ImageEngine
```

### Q2: 如何处理大规模向量数据？

**A**: 使用持久化存储和分批处理：

```swift
// 创建持久化存储
VectorStoreManager.shared.createStore(name: "large", persistent: true)

// 分批插入
let batchSize = 100
for i in stride(from: 0, to: vectors.count, by: batchSize) {
    let batch = Array(vectors[i..<min(i + batchSize, vectors.count)])
    try await vectorStore.insertBatch(vectors: batch)
}
```

### Q3: 如何优化LLM调用成本？

**A**: 使用多层缓存策略：

```swift
// 1. 永久缓存常见问题
cacheManager.cacheEngineResult(answer, for: key, policy: .cacheForever)

// 2. 短期缓存变化内容
cacheManager.cacheEngineResult(result, for: key, policy: .cacheFor(300))

// 3. 批量处理减少调用
let results = try await engineManager.executeBatch(tasks: tasks)
```

### Q4: Agent执行失败怎么办？

**A**: 检查任务描述和依赖关系：

```swift
do {
    let result = try await orchestrator.executeComplexTask(
        description: "详细的任务描述",  // 要足够详细
        parameters: [:]
    )
} catch {
    // 查看任务分解结果
    Logger.shared.error("任务执行失败: \(error)")

    // 尝试简化任务
    let simpler = try await orchestrator.executeComplexTask(
        description: "简化后的任务",
        parameters: [:]
    )
}
```

---

## 最佳实践

### 1. 初始化顺序

```swift
// 正确的初始化顺序
setupAISystem() {
    1. AIEngineManager.initialize()      // 先初始化引擎
    2. AgentOrchestrator.shared          // 然后Agent系统
    3. ToolManager.registerExtendedTools() // 注册工具
    4. VectorStoreManager.createStore()  // 创建存储
    5. 预热缓存（可选）
}
```

### 2. 资源管理

```swift
// 在适当的时候清理资源
func applicationWillTerminate() {
    // 清空临时缓存
    CacheManager.shared.clearCache(type: .llm)

    // 保存向量存储
    Task {
        try? await vectorStore.save()
    }
}
```

### 3. 错误恢复

```swift
// 实现优雅降级
func executeWithFallback() async throws -> String {
    do {
        // 首选：使用LLM
        return try await llmEngine.execute(...)
    } catch {
        // 降级：使用基于规则的方法
        return ruleBasedFallback()
    }
}
```

---

## 版本兼容性

- **最低iOS版本**: iOS 15.0
- **推荐iOS版本**: iOS 16.0+
- **Swift版本**: 5.7+
- **依赖框架**:
  - SwiftUI
  - Combine
  - Vision
  - AVFoundation
  - Speech

---

## 总结

本指南涵盖了iOS AI系统的所有核心功能：

✅ AI引擎使用（16个引擎）
✅ Multi-Agent任务编排
✅ 向量存储与语义搜索
✅ 三层缓存系统
✅ 工具与技能系统
✅ SwiftUI UI集成

通过这些示例，你可以快速构建智能应用，包括：
- 智能文档分析
- 代码助手
- 客服机器人
- 内容推荐系统
- 数据分析工具

---

**文档版本**: 1.0
**最后更新**: 2025年
**维护者**: ChainlessChain iOS Team
