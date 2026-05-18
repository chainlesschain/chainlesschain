import Foundation
import CoreCommon

// MARK: - RecommendationSystem
/// Hybrid recommendation system combining multiple algorithms
/// Integrates content-based, collaborative filtering, and dynamic few-shot learning
///
/// Features:
/// - Collaborative filtering (user-tool matrix)
/// - Hybrid recommendation (content + collaborative)
/// - Dynamic few-shot example selection
/// - Real-time quality gating
///
/// Version: v1.7.0
/// Date: 2026-02-10

// MARK: - Collaborative Filter

/// User-tool interaction record
struct UserToolInteraction: Codable {
    let userId: String
    let toolName: String
    let count: Int
    let lastUsed: Date
    let rating: Float?  // Optional explicit rating

    var implicitRating: Float {
        // Calculate implicit rating from usage count and recency
        let countScore = min(Float(count) / 10.0, 1.0)  // Normalize to 0-1
        let daysSinceUse = max(0, Date().timeIntervalSince(lastUsed) / (24 * 60 * 60))
        let recencyScore = Float(1.0 / (1.0 + daysSinceUse / 7.0))  // Decay over weeks
        return (countScore * 0.6 + recencyScore * 0.4)
    }
}

/// Collaborative filtering engine
class CollaborativeFilter {
    // User-tool interaction matrix
    private var userToolMatrix: [String: [String: Float]] = [:]  // userId -> (toolName -> rating)
    private var toolUserMatrix: [String: [String: Float]] = [:]  // toolName -> (userId -> rating)

    // Similarity caches
    private var userSimilarityCache: [String: Float] = [:]
    private var toolSimilarityCache: [String: Float] = [:]

    private let logger = Logger.shared

    /// Build user-tool matrix from interactions
    func buildMatrix(from interactions: [UserToolInteraction]) {
        logger.info("[CollaborativeFilter] Building user-tool matrix from \(interactions.count) interactions")

        userToolMatrix.removeAll()
        toolUserMatrix.removeAll()
        userSimilarityCache.removeAll()
        toolSimilarityCache.removeAll()

        for interaction in interactions {
            let rating = interaction.rating ?? interaction.implicitRating

            // User -> Tool matrix
            if userToolMatrix[interaction.userId] == nil {
                userToolMatrix[interaction.userId] = [:]
            }
            userToolMatrix[interaction.userId]?[interaction.toolName] = rating

            // Tool -> User matrix
            if toolUserMatrix[interaction.toolName] == nil {
                toolUserMatrix[interaction.toolName] = [:]
            }
            toolUserMatrix[interaction.toolName]?[interaction.userId] = rating
        }

        logger.info("[CollaborativeFilter] Matrix built: \(userToolMatrix.count) users, \(toolUserMatrix.count) tools")
    }

    /// Calculate user similarity (Pearson correlation)
    func userSimilarity(_ user1: String, _ user2: String) -> Float {
        let cacheKey = "\(user1):\(user2)"
        if let cached = userSimilarityCache[cacheKey] {
            return cached
        }

        guard let ratings1 = userToolMatrix[user1],
              let ratings2 = userToolMatrix[user2] else {
            return 0
        }

        // Find common tools
        let commonTools = Set(ratings1.keys).intersection(Set(ratings2.keys))
        guard commonTools.count >= 2 else { return 0 }

        // Calculate Pearson correlation
        let n = Float(commonTools.count)
        var sum1: Float = 0, sum2: Float = 0
        var sumSq1: Float = 0, sumSq2: Float = 0
        var sumProd: Float = 0

        for tool in commonTools {
            let r1 = ratings1[tool] ?? 0
            let r2 = ratings2[tool] ?? 0
            sum1 += r1
            sum2 += r2
            sumSq1 += r1 * r1
            sumSq2 += r2 * r2
            sumProd += r1 * r2
        }

        let num = sumProd - (sum1 * sum2 / n)
        let den1 = sqrt(sumSq1 - sum1 * sum1 / n)
        let den2 = sqrt(sumSq2 - sum2 * sum2 / n)

        guard den1 > 0, den2 > 0 else { return 0 }

        let similarity = num / (den1 * den2)

        // Cache result
        userSimilarityCache[cacheKey] = similarity
        userSimilarityCache["\(user2):\(user1)"] = similarity

        return similarity
    }

    /// Recommend tools for user based on similar users
    func recommendForUser(_ userId: String, topK: Int = 5, excludeUsed: Bool = true) -> [ToolRecommendation] {
        guard let userRatings = userToolMatrix[userId] else {
            return []
        }

        // Find similar users
        var similarUsers: [(userId: String, similarity: Float)] = []
        for otherUser in userToolMatrix.keys where otherUser != userId {
            let similarity = userSimilarity(userId, otherUser)
            if similarity > 0.1 {  // Minimum similarity threshold
                similarUsers.append((otherUser, similarity))
            }
        }

        similarUsers.sort { $0.similarity > $1.similarity }
        let topSimilarUsers = Array(similarUsers.prefix(10))

        // Predict ratings for unrated tools
        var predictions: [String: (weightedSum: Float, similaritySum: Float)] = [:]

        for (similarUser, similarity) in topSimilarUsers {
            guard let otherRatings = userToolMatrix[similarUser] else { continue }

            for (tool, rating) in otherRatings {
                // Skip if user already used this tool and excludeUsed is true
                if excludeUsed && userRatings[tool] != nil { continue }

                if predictions[tool] == nil {
                    predictions[tool] = (0, 0)
                }
                predictions[tool]!.weightedSum += similarity * rating
                predictions[tool]!.similaritySum += abs(similarity)
            }
        }

        // Calculate final predictions
        var recommendations: [ToolRecommendation] = []

        for (tool, data) in predictions {
            guard data.similaritySum > 0 else { continue }

            let predictedRating = data.weightedSum / data.similaritySum
            let confidence = min(data.similaritySum / Float(topSimilarUsers.count), 1.0)

            recommendations.append(ToolRecommendation(
                tool: tool,
                score: predictedRating,
                confidence: confidence,
                reason: "Recommended by similar users",
                algorithm: .hybrid
            ))
        }

        recommendations.sort { $0.score > $1.score }
        return Array(recommendations.prefix(topK))
    }

    /// Get user's tool ratings
    func getUserRatings(_ userId: String) -> [String: Float]? {
        return userToolMatrix[userId]
    }

    /// Get stats
    func getStats() -> [String: Any] {
        return [
            "userCount": userToolMatrix.count,
            "toolCount": toolUserMatrix.count,
            "averageToolsPerUser": userToolMatrix.values.map { Float($0.count) }.reduce(0, +) / max(1, Float(userToolMatrix.count))
        ]
    }
}

// MARK: - Dynamic Few-Shot Learner

/// Few-shot example
struct FewShotExample: Codable, Identifiable {
    let id: String
    let input: String
    let output: String
    let category: String
    let embedding: [Float]?
    let quality: Float      // Quality score 0-1
    let usageCount: Int

    init(input: String, output: String, category: String, embedding: [Float]? = nil, quality: Float = 1.0) {
        self.id = UUID().uuidString.prefix(8).lowercased()
        self.input = input
        self.output = output
        self.category = category
        self.embedding = embedding
        self.quality = quality
        self.usageCount = 0
    }
}

/// Dynamic few-shot example selector
class DynamicFewShotLearner {
    private var examples: [String: [FewShotExample]] = [:]  // category -> examples
    private let maxExamplesPerCategory = 100
    private let logger = Logger.shared

    /// Add example
    func addExample(_ example: FewShotExample) {
        if examples[example.category] == nil {
            examples[example.category] = []
        }

        examples[example.category]?.append(example)

        // Prune if over limit
        if let count = examples[example.category]?.count, count > maxExamplesPerCategory {
            // Remove lowest quality examples
            examples[example.category]?.sort { $0.quality > $1.quality }
            examples[example.category] = Array(examples[example.category]!.prefix(maxExamplesPerCategory))
        }
    }

    /// Select best examples for a given input
    func selectExamples(
        for input: String,
        category: String? = nil,
        topK: Int = 3,
        inputEmbedding: [Float]? = nil
    ) -> [FewShotExample] {
        var candidates: [FewShotExample] = []

        if let category = category, let categoryExamples = examples[category] {
            candidates = categoryExamples
        } else {
            // Use all examples
            candidates = examples.values.flatMap { $0 }
        }

        guard !candidates.isEmpty else { return [] }

        // Score examples
        var scoredExamples: [(example: FewShotExample, score: Float)] = []

        for example in candidates {
            var score: Float = example.quality

            // Add similarity bonus if embeddings available
            if let inputEmb = inputEmbedding, let exampleEmb = example.embedding {
                let similarity = cosineSimilarity(inputEmb, exampleEmb)
                score += similarity * 0.5
            }

            // Add usage bonus (diminishing returns)
            score += Float(min(example.usageCount, 10)) * 0.01

            scoredExamples.append((example, score))
        }

        scoredExamples.sort { $0.score > $1.score }

        return scoredExamples.prefix(topK).map { $0.example }
    }

    /// Get example count
    func getExampleCount() -> Int {
        return examples.values.reduce(0) { $0 + $1.count }
    }

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
}

// MARK: - Quality Gate

/// Quality assessment result
struct QualityAssessment {
    let passed: Bool
    let score: Float
    let issues: [String]
    let suggestions: [String]
}

/// Real-time quality gate
class RealTimeQualityGate {
    struct Config {
        var minQualityScore: Float = 0.6
        var maxResponseTime: TimeInterval = 30
        var enableAutoFix: Bool = true
    }

    private var config: Config
    private let logger = Logger.shared

    init(config: Config = Config()) {
        self.config = config
    }

    /// Assess output quality
    func assess(_ output: String, expectedFormat: String? = nil) -> QualityAssessment {
        var score: Float = 1.0
        var issues: [String] = []
        var suggestions: [String] = []

        // Check length
        if output.isEmpty {
            score -= 0.5
            issues.append("Output is empty")
            suggestions.append("Regenerate response")
        } else if output.count < 10 {
            score -= 0.2
            issues.append("Output is too short")
        }

        // Check for error indicators
        let errorIndicators = ["error", "failed", "exception", "cannot"]
        for indicator in errorIndicators {
            if output.lowercased().contains(indicator) {
                score -= 0.1
                issues.append("Output contains error indicator: \(indicator)")
            }
        }

        // Check format if specified
        if let format = expectedFormat {
            switch format {
            case "json":
                if !isValidJSON(output) {
                    score -= 0.3
                    issues.append("Invalid JSON format")
                    suggestions.append("Fix JSON syntax")
                }
            case "code":
                if !containsCode(output) {
                    score -= 0.2
                    issues.append("No code block detected")
                }
            default:
                break
            }
        }

        // Ensure score is in valid range
        score = max(0, min(1, score))

        return QualityAssessment(
            passed: score >= config.minQualityScore,
            score: score,
            issues: issues,
            suggestions: suggestions
        )
    }

    private func isValidJSON(_ text: String) -> Bool {
        guard let data = text.data(using: .utf8) else { return false }
        return (try? JSONSerialization.jsonObject(with: data)) != nil
    }

    private func containsCode(_ text: String) -> Bool {
        // Check for common code patterns
        let codePatterns = ["```", "func ", "function ", "class ", "def ", "import ", "const ", "let ", "var "]
        return codePatterns.contains { text.contains($0) }
    }

    /// Update configuration
    func updateConfig(_ newConfig: Config) {
        config = newConfig
    }
}

// MARK: - Hybrid Recommender

/// Hybrid recommendation system
@MainActor
class HybridRecommender: ObservableObject {
    // MARK: - Components

    private let contentRecommender: ContentRecommender
    private let collaborativeFilter: CollaborativeFilter
    private let fewShotLearner: DynamicFewShotLearner
    private let qualityGate: RealTimeQualityGate
    private let logger = Logger.shared

    // MARK: - Configuration

    struct Config {
        var contentWeight: Float = 0.4
        var collaborativeWeight: Float = 0.4
        var popularityWeight: Float = 0.2
        var minConfidence: Float = 0.3
    }

    private var config: Config

    // MARK: - Statistics

    @Published private(set) var stats = HybridStats()

    struct HybridStats {
        var totalRecommendations: Int = 0
        var contentBasedCount: Int = 0
        var collaborativeCount: Int = 0
        var hybridCount: Int = 0
        var avgQualityScore: Float = 0
    }

    // MARK: - Singleton

    static let shared = HybridRecommender()

    // MARK: - Initialization

    init(
        contentRecommender: ContentRecommender = .shared,
        config: Config = Config()
    ) {
        self.contentRecommender = contentRecommender
        self.collaborativeFilter = CollaborativeFilter()
        self.fewShotLearner = DynamicFewShotLearner()
        self.qualityGate = RealTimeQualityGate()
        self.config = config
    }

    // MARK: - Public Methods

    /// Build recommendation models from data
    func buildModels(interactions: [UserToolInteraction]) {
        // Build collaborative filter matrix
        collaborativeFilter.buildMatrix(from: interactions)

        // Build content features (if not already done)
        contentRecommender.buildToolFeatures()

        logger.info("[HybridRecommender] Models built successfully")
    }

    /// Get hybrid recommendations for user
    func recommend(
        userId: String,
        recentTools: [String],
        currentContext: String? = nil,
        topK: Int = 5
    ) async -> [ToolRecommendation] {
        // 1. Get content-based recommendations
        let contentRecs = contentRecommender.recommendTools(recentTools: recentTools, topK: topK * 2)
        stats.contentBasedCount += contentRecs.count

        // 2. Get collaborative recommendations
        let collabRecs = collaborativeFilter.recommendForUser(userId, topK: topK * 2)
        stats.collaborativeCount += collabRecs.count

        // 3. Merge and score
        var mergedScores: [String: HybridScore] = [:]

        for rec in contentRecs {
            if mergedScores[rec.tool] == nil {
                mergedScores[rec.tool] = HybridScore()
            }
            mergedScores[rec.tool]!.contentScore = rec.score
            mergedScores[rec.tool]!.contentReason = rec.reason
        }

        for rec in collabRecs {
            if mergedScores[rec.tool] == nil {
                mergedScores[rec.tool] = HybridScore()
            }
            mergedScores[rec.tool]!.collaborativeScore = rec.score
            mergedScores[rec.tool]!.collaborativeReason = rec.reason
        }

        // Calculate hybrid scores
        var recommendations: [ToolRecommendation] = []

        for (tool, scores) in mergedScores {
            let hybridScore = scores.contentScore * config.contentWeight +
                              scores.collaborativeScore * config.collaborativeWeight

            // Skip low confidence recommendations
            guard hybridScore >= config.minConfidence else { continue }

            let reason = generateHybridReason(scores)
            let confidence = min(
                (scores.contentScore > 0 ? 0.5 : 0) + (scores.collaborativeScore > 0 ? 0.5 : 0),
                1.0
            )

            recommendations.append(ToolRecommendation(
                tool: tool,
                score: hybridScore,
                confidence: confidence,
                reason: reason,
                algorithm: .hybrid
            ))
        }

        recommendations.sort { $0.score > $1.score }
        let finalRecs = Array(recommendations.prefix(topK))

        // Update stats
        stats.totalRecommendations += 1
        stats.hybridCount += finalRecs.count

        return finalRecs
    }

    /// Add few-shot example
    func addFewShotExample(_ example: FewShotExample) {
        fewShotLearner.addExample(example)
    }

    /// Select few-shot examples for input
    func selectFewShotExamples(for input: String, category: String? = nil, topK: Int = 3) -> [FewShotExample] {
        return fewShotLearner.selectExamples(for: input, category: category, topK: topK)
    }

    /// Assess output quality
    func assessQuality(_ output: String, expectedFormat: String? = nil) -> QualityAssessment {
        let assessment = qualityGate.assess(output, expectedFormat: expectedFormat)

        // Update quality stats
        let n = Float(stats.totalRecommendations)
        if n > 0 {
            stats.avgQualityScore = (stats.avgQualityScore * (n - 1) + assessment.score) / n
        } else {
            stats.avgQualityScore = assessment.score
        }

        return assessment
    }

    /// Get statistics
    func getStats() -> [String: Any] {
        return [
            "totalRecommendations": stats.totalRecommendations,
            "contentBasedCount": stats.contentBasedCount,
            "collaborativeCount": stats.collaborativeCount,
            "hybridCount": stats.hybridCount,
            "avgQualityScore": String(format: "%.2f", stats.avgQualityScore),
            "fewShotExampleCount": fewShotLearner.getExampleCount(),
            "collaborativeStats": collaborativeFilter.getStats(),
            "contentStats": contentRecommender.getStats()
        ]
    }

    /// Update configuration
    func updateConfig(_ newConfig: Config) {
        config = newConfig
    }

    // MARK: - Private Methods

    private struct HybridScore {
        var contentScore: Float = 0
        var collaborativeScore: Float = 0
        var contentReason: String = ""
        var collaborativeReason: String = ""
    }

    private func generateHybridReason(_ scores: HybridScore) -> String {
        var reasons: [String] = []

        if scores.contentScore > 0 {
            reasons.append(scores.contentReason)
        }
        if scores.collaborativeScore > 0 {
            reasons.append(scores.collaborativeReason)
        }

        if reasons.isEmpty {
            return "Hybrid recommendation"
        } else if reasons.count == 1 {
            return reasons[0]
        } else {
            return "Based on content similarity and user behavior"
        }
    }
}
