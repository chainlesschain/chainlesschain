import Foundation
import CoreCommon

// MARK: - ContentRecommender
/// Content-based recommendation algorithm for tools
/// Provides tool similarity calculation and recommendation
///
/// Features:
/// - Tool feature extraction
/// - Tool similarity calculation (Jaccard + Cosine)
/// - Content-based recommendation
/// - Tool chain recommendation
///
/// Version: v1.7.0
/// Date: 2026-02-10

// MARK: - Tool Features

/// Tool feature representation
struct ToolFeatures {
    let name: String
    let category: ToolCategory
    let tags: Set<String>
    let description: String
    let vector: [Float]
}

/// Tool category
enum ToolCategory: String, Codable, CaseIterable {
    case development
    case data
    case design
    case writing
    case testing
    case deployment
    case unknown

    var index: Int {
        return ToolCategory.allCases.firstIndex(of: self) ?? 0
    }
}

/// Tool similarity result
struct ToolSimilarity {
    let tool: String
    let similarity: Float
}

/// Tool recommendation result
struct ToolRecommendation: Identifiable {
    let id = UUID()
    let tool: String
    let score: Float
    let confidence: Float
    let reason: String
    let algorithm: RecommendationAlgorithm
}

/// Recommendation algorithm type
enum RecommendationAlgorithm: String {
    case contentBased = "content_based"
    case toolChain = "tool_chain"
    case hybrid = "hybrid"
}

/// Tool chain entry
struct ToolChainEntry {
    let nextTool: String
    var count: Int
    var probability: Float
}

// MARK: - Content Recommender

/// Content-based recommendation system for tools
@MainActor
class ContentRecommender: ObservableObject {
    // MARK: - Configuration

    struct Config {
        var minSimilarity: Float = 0.2        // Minimum similarity threshold
        var topKSimilar: Int = 5              // Consider Top-K similar tools
        var enableToolChain: Bool = true       // Enable tool chain recommendation
    }

    // MARK: - Properties

    private var config: Config
    private var toolFeatures: [String: ToolFeatures] = [:]
    private var toolSimilarity: [String: Float] = [:]          // Cache: "tool1:tool2" -> similarity
    private var toolChains: [String: [ToolChainEntry]] = [:]    // Previous tool -> next tools
    private let logger = Logger.shared

    @Published private(set) var stats = RecommenderStats()

    /// Statistics
    struct RecommenderStats {
        var totalRecommendations: Int = 0
        var toolChainRecommendations: Int = 0
        var avgSimilarity: Float = 0
    }

    // Standard tag set for vector building
    private let standardTags = ["code", "file", "data", "test", "doc", "format", "debug", "chart"]

    // MARK: - Singleton

    static let shared = ContentRecommender()

    // MARK: - Initialization

    init(config: Config = Config()) {
        self.config = config
        buildToolFeatures()
    }

    // MARK: - Public Methods

    /// Build tool features
    @discardableResult
    func buildToolFeatures() -> [String: ToolFeatures] {
        logger.info("[ContentRecommender] Building tool features...")

        // Default tool feature library
        let defaultTools: [(name: String, category: ToolCategory, tags: [String], description: String)] = [
            ("codeGeneration", .development, ["code", "generate", "function", "class"],
             "Code generation tool, automatically generates functions, classes, etc."),
            ("fileWrite", .development, ["file", "write", "save", "create"],
             "File writing tool, creates and saves file content"),
            ("fileRead", .development, ["file", "read", "load", "open"],
             "File reading tool, loads and reads file content"),
            ("formatCode", .development, ["format", "code", "style", "beautify"],
             "Code formatting tool, beautifies code style"),
            ("debugging", .development, ["debug", "fix", "error", "troubleshoot"],
             "Debugging tool, helps troubleshoot and fix code errors"),
            ("testing", .testing, ["test", "unittest", "qa", "verify"],
             "Testing tool, writes and runs unit tests"),
            ("dataAnalysis", .data, ["data", "analysis", "statistics", "explore"],
             "Data analysis tool, statistical analysis and data exploration"),
            ("chartGeneration", .data, ["chart", "visualization", "graph", "plot"],
             "Chart generation tool, visualizes data in charts"),
            ("documentation", .writing, ["doc", "document", "write", "readme"],
             "Documentation tool, generates project docs and descriptions"),
            ("markdown", .writing, ["markdown", "format", "text", "note"],
             "Markdown editing tool, formats text content"),
            ("deployment", .deployment, ["deploy", "release", "publish", "build"],
             "Deployment tool, publishes and releases applications"),
            ("containerization", .deployment, ["docker", "container", "image", "kubernetes"],
             "Containerization tool, manages Docker containers"),
            ("uiDesign", .design, ["ui", "design", "layout", "component"],
             "UI design tool, creates user interface components"),
            ("imageProcessing", .design, ["image", "photo", "edit", "filter"],
             "Image processing tool, edits and filters images")
        ]

        toolFeatures.removeAll()

        for tool in defaultTools {
            let features = ToolFeatures(
                name: tool.name,
                category: tool.category,
                tags: Set(tool.tags),
                description: tool.description,
                vector: createFeatureVector(category: tool.category, tags: tool.tags)
            )
            toolFeatures[tool.name] = features
        }

        logger.info("[ContentRecommender] Tool features built: \(toolFeatures.count) tools")
        return toolFeatures
    }

    /// Add custom tool features
    func addToolFeatures(name: String, category: ToolCategory, tags: [String], description: String) {
        let features = ToolFeatures(
            name: name,
            category: category,
            tags: Set(tags),
            description: description,
            vector: createFeatureVector(category: category, tags: tags)
        )
        toolFeatures[name] = features

        // Clear similarity cache for this tool
        let keysToRemove = toolSimilarity.keys.filter { $0.contains(name) }
        for key in keysToRemove {
            toolSimilarity.removeValue(forKey: key)
        }
    }

    /// Calculate tool similarity (cosine + Jaccard)
    /// - Parameters:
    ///   - tool1: First tool name
    ///   - tool2: Second tool name
    /// - Returns: Similarity score [0, 1]
    func calculateToolSimilarity(_ tool1: String, _ tool2: String) -> Float {
        // Check cache
        let cacheKey = "\(tool1):\(tool2)"
        if let cached = toolSimilarity[cacheKey] {
            return cached
        }

        guard let features1 = toolFeatures[tool1],
              let features2 = toolFeatures[tool2] else {
            return 0
        }

        // 1. Category similarity
        let categorySimilarity: Float = features1.category == features2.category ? 1.0 : 0.0

        // 2. Tag similarity (Jaccard)
        let intersection = features1.tags.intersection(features2.tags)
        let union = features1.tags.union(features2.tags)
        let tagSimilarity: Float = union.isEmpty ? 0 : Float(intersection.count) / Float(union.count)

        // 3. Feature vector cosine similarity
        let vectorSimilarity = cosineSimilarity(features1.vector, features2.vector)

        // Weighted average
        let similarity = categorySimilarity * 0.4 + tagSimilarity * 0.3 + vectorSimilarity * 0.3

        // Cache result (symmetric)
        toolSimilarity[cacheKey] = similarity
        toolSimilarity["\(tool2):\(tool1)"] = similarity

        return similarity
    }

    /// Find similar tools
    /// - Parameter toolName: Tool name
    /// - Returns: List of similar tools sorted by similarity
    func findSimilarTools(_ toolName: String) -> [ToolSimilarity] {
        if toolFeatures.isEmpty {
            buildToolFeatures()
        }

        var similarTools: [ToolSimilarity] = []

        for otherTool in toolFeatures.keys where otherTool != toolName {
            let similarity = calculateToolSimilarity(toolName, otherTool)

            if similarity >= config.minSimilarity {
                similarTools.append(ToolSimilarity(tool: otherTool, similarity: similarity))
            }
        }

        similarTools.sort { $0.similarity > $1.similarity }
        return Array(similarTools.prefix(config.topKSimilar))
    }

    /// Build tool chain statistics from usage history
    /// - Parameter usageHistory: Array of (previousTool, currentTool, count)
    func buildToolChains(from usageHistory: [(previousTool: String, currentTool: String, count: Int)]) {
        logger.info("[ContentRecommender] Building tool chain statistics...")

        toolChains.removeAll()

        for entry in usageHistory {
            if toolChains[entry.previousTool] == nil {
                toolChains[entry.previousTool] = []
            }

            toolChains[entry.previousTool]?.append(ToolChainEntry(
                nextTool: entry.currentTool,
                count: entry.count,
                probability: 0  // Calculate later
            ))
        }

        // Calculate conditional probabilities
        for (prevTool, var nextTools) in toolChains {
            let totalCount = nextTools.reduce(0) { $0 + $1.count }
            for i in 0..<nextTools.count {
                nextTools[i].probability = Float(nextTools[i].count) / Float(totalCount)
            }
            toolChains[prevTool] = nextTools.sorted { $0.probability > $1.probability }
        }

        logger.info("[ContentRecommender] Tool chains built: \(toolChains.count) starting tools")
    }

    /// Content-based tool recommendation
    /// - Parameters:
    ///   - recentTools: User's recently used tools
    ///   - topK: Number of recommendations
    /// - Returns: List of recommendations
    func recommendTools(recentTools: [String], topK: Int = 5) -> [ToolRecommendation] {
        if toolFeatures.isEmpty {
            buildToolFeatures()
        }

        guard !recentTools.isEmpty else {
            logger.info("[ContentRecommender] No recent tools for recommendation")
            return []
        }

        var toolScores: [String: (totalScore: Float, count: Int, basedOnTools: [(tool: String, similarity: Float)])] = [:]

        // Calculate similarity-based scores
        for recentTool in recentTools {
            let similarTools = findSimilarTools(recentTool)

            for similar in similarTools {
                // Skip if tool is in recent tools
                if recentTools.contains(similar.tool) { continue }

                if toolScores[similar.tool] == nil {
                    toolScores[similar.tool] = (totalScore: 0, count: 0, basedOnTools: [])
                }

                toolScores[similar.tool]?.totalScore += similar.similarity
                toolScores[similar.tool]?.count += 1
                toolScores[similar.tool]?.basedOnTools.append((tool: recentTool, similarity: similar.similarity))
            }
        }

        // Build recommendations
        var recommendations: [ToolRecommendation] = []

        for (tool, data) in toolScores {
            let avgScore = data.totalScore / Float(data.count)
            let confidence = min(Float(data.count) / Float(recentTools.count), 1.0)

            recommendations.append(ToolRecommendation(
                tool: tool,
                score: avgScore,
                confidence: confidence,
                reason: generateReason(basedOn: data.basedOnTools),
                algorithm: .contentBased
            ))
        }

        recommendations.sort { $0.score > $1.score }

        // Update stats
        stats.totalRecommendations += 1
        if let first = recommendations.first {
            let n = Float(stats.totalRecommendations)
            stats.avgSimilarity = (stats.avgSimilarity * (n - 1) + first.score) / n
        }

        return Array(recommendations.prefix(topK))
    }

    /// Tool chain recommendation (predict next tool)
    /// - Parameters:
    ///   - currentTool: Current tool being used
    ///   - topK: Number of recommendations
    /// - Returns: List of recommendations
    func recommendNextTools(currentTool: String, topK: Int = 3) -> [ToolRecommendation] {
        guard let nextTools = toolChains[currentTool], !nextTools.isEmpty else {
            return []
        }

        let recommendations = Array(nextTools.prefix(topK)).map { entry in
            ToolRecommendation(
                tool: entry.nextTool,
                score: entry.probability,
                confidence: entry.probability,
                reason: String(format: "%.0f%% of users use after %@", entry.probability * 100, currentTool),
                algorithm: .toolChain
            )
        }

        stats.toolChainRecommendations += 1

        return recommendations
    }

    /// Get statistics
    func getStats() -> [String: Any] {
        return [
            "totalRecommendations": stats.totalRecommendations,
            "toolChainRecommendations": stats.toolChainRecommendations,
            "toolCount": toolFeatures.count,
            "toolChainCount": toolChains.count,
            "avgSimilarity": String(format: "%.1f%%", stats.avgSimilarity * 100)
        ]
    }

    // MARK: - Private Methods

    /// Create feature vector for a tool
    private func createFeatureVector(category: ToolCategory, tags: [String]) -> [Float] {
        var vector: [Float] = []

        // 1. Category encoding (one-hot)
        for cat in ToolCategory.allCases {
            vector.append(cat == category ? 1.0 : 0.0)
        }

        // 2. Tag features (presence in standard tags)
        let tagSet = Set(tags)
        for standardTag in standardTags {
            vector.append(tagSet.contains(standardTag) ? 1.0 : 0.0)
        }

        return vector
    }

    /// Calculate cosine similarity
    private func cosineSimilarity(_ vec1: [Float], _ vec2: [Float]) -> Float {
        guard vec1.count == vec2.count, !vec1.isEmpty else { return 0 }

        var dotProduct: Float = 0
        var norm1: Float = 0
        var norm2: Float = 0

        for i in 0..<vec1.count {
            dotProduct += vec1[i] * vec2[i]
            norm1 += vec1[i] * vec1[i]
            norm2 += vec2[i] * vec2[i]
        }

        guard norm1 > 0, norm2 > 0 else { return 0 }

        return dotProduct / (sqrt(norm1) * sqrt(norm2))
    }

    /// Generate recommendation reason
    private func generateReason(basedOn tools: [(tool: String, similarity: Float)]) -> String {
        guard let topTool = tools.first else {
            return "Based on content similarity"
        }

        let similarity = Int(topTool.similarity * 100)
        return "Similar to \(topTool.tool) (\(similarity)%)"
    }
}
