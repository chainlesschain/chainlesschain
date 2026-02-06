import Foundation
import Combine

/// 信用等级
public struct CreditLevel: Identifiable, Codable {
    public let id = UUID()
    public let name: String
    public let minScore: Int
    public let maxScore: Int
    public let color: String
    public let benefits: [String]

    public var displayName: String {
        return name
    }
}

/// 评分权重配置
public struct ScoreWeights {
    /// 交易完成率权重 30%
    let completionRate: Double = 0.30
    /// 交易金额权重 20%
    let tradeVolume: Double = 0.20
    /// 好评率权重 25%
    let positiveRate: Double = 0.25
    /// 响应速度权重 10%
    let responseSpeed: Double = 0.10
    /// 纠纷率权重 10%
    let disputeRate: Double = 0.10
    /// 退款率权重 5%
    let refundRate: Double = 0.05
}

/// 用户信用记录
public struct UserCredit: Codable {
    public let userDid: String
    public var creditScore: Int
    public var creditLevel: String
    public var totalTransactions: Int
    public var completedTransactions: Int
    public var totalVolume: Int  // 以最小单位存储
    public var positiveReviews: Int
    public var negativeReviews: Int
    public var disputes: Int
    public var refunds: Int
    public var avgResponseTime: Int  // 毫秒
    public var lastUpdated: Date

    public init(userDid: String) {
        self.userDid = userDid
        self.creditScore = 0
        self.creditLevel = "新手"
        self.totalTransactions = 0
        self.completedTransactions = 0
        self.totalVolume = 0
        self.positiveReviews = 0
        self.negativeReviews = 0
        self.disputes = 0
        self.refunds = 0
        self.avgResponseTime = 0
        self.lastUpdated = Date()
    }

    public var completionRate: Double {
        guard totalTransactions > 0 else { return 0 }
        return Double(completedTransactions) / Double(totalTransactions)
    }

    public var positiveReviewRate: Double {
        let total = positiveReviews + negativeReviews
        guard total > 0 else { return 0.5 }
        return Double(positiveReviews) / Double(total)
    }

    public var disputeRateValue: Double {
        guard totalTransactions > 0 else { return 0 }
        return Double(disputes) / Double(totalTransactions)
    }

    public var refundRateValue: Double {
        guard totalTransactions > 0 else { return 0 }
        return Double(refunds) / Double(totalTransactions)
    }
}

/// 信用记录（变化历史）
public struct CreditRecord: Identifiable, Codable {
    public let id: Int
    public let userDid: String
    public let eventType: CreditEventType
    public let eventId: String
    public let scoreChange: Int
    public let scoreAfter: Int
    public let reason: String?
    public let createdAt: Date
}

/// 信用事件类型
public enum CreditEventType: String, Codable {
    case tradeCompleted = "trade_completed"
    case tradeCancelled = "trade_cancelled"
    case positiveReview = "positive_review"
    case negativeReview = "negative_review"
    case dispute = "dispute"
    case disputeResolved = "dispute_resolved"
    case refund = "refund"
}

/// 信用报告
public struct CreditReport: Codable {
    public let userDid: String
    public let creditScore: Int
    public let creditLevel: String
    public let levelColor: String
    public let benefits: [String]
    public let statistics: CreditStatistics
    public let recentRecords: [CreditRecord]
    public let lastUpdated: Date
}

/// 信用统计
public struct CreditStatistics: Codable {
    public let totalTransactions: Int
    public let completedTransactions: Int
    public let completionRate: Double
    public let totalVolume: Int
    public let positiveReviews: Int
    public let negativeReviews: Int
    public let positiveRate: Double
    public let disputes: Int
    public let disputeRate: Double
    public let refunds: Int
    public let refundRate: Double
    public let avgResponseTime: Int
}

/// 信用排行榜条目
public struct LeaderboardEntry: Identifiable, Codable {
    public let id = UUID()
    public let rank: Int
    public let userDid: String
    public let creditScore: Int
    public let creditLevel: String
    public let totalTransactions: Int
    public let totalVolume: Int
}

/// 信用评分管理器
/// 负责计算和管理用户信用评分
/// 功能：
/// - 6维度信用评分模型
/// - 交易历史权重计算
/// - 评分更新逻辑
/// - 信用等级管理
@MainActor
public class CreditScoreManager: ObservableObject {

    // MARK: - Singleton

    public static let shared = CreditScoreManager()

    // MARK: - Published Properties

    @Published public var leaderboard: [LeaderboardEntry] = []

    // MARK: - Events

    public let creditUpdated = PassthroughSubject<(userDid: String, creditScore: Int, creditLevel: String), Never>()

    // MARK: - Private Properties

    private let database: DatabaseManager
    private let weights = ScoreWeights()

    /// 信用等级定义
    private let creditLevels: [CreditLevel] = [
        CreditLevel(name: "新手", minScore: 0, maxScore: 100, color: "gray", benefits: []),
        CreditLevel(name: "青铜", minScore: 101, maxScore: 300, color: "bronze", benefits: ["降低 5% 手续费"]),
        CreditLevel(name: "白银", minScore: 301, maxScore: 600, color: "silver", benefits: ["降低 10% 手续费", "优先展示"]),
        CreditLevel(name: "黄金", minScore: 601, maxScore: 900, color: "gold", benefits: ["降低 15% 手续费", "优先展示", "更高托管比例"]),
        CreditLevel(name: "钻石", minScore: 901, maxScore: 1000, color: "diamond", benefits: ["降低 20% 手续费", "优先展示", "免保证金", "VIP 支持"])
    ]

    private var initialized = false

    // MARK: - Initialization

    private init() {
        self.database = DatabaseManager.shared
        Logger.shared.info("[CreditScore] 信用评分管理器已初始化")
    }

    // MARK: - Public Methods

    /// 初始化信用评分管理器
    public func initialize() async throws {
        try await initDatabase()
        initialized = true
        Logger.shared.info("[CreditScore] 数据库表初始化完成")
    }

    /// 初始化用户信用记录
    public func initUserCredit(userDid: String) -> UserCredit {
        if let existing = getUserCredit(userDid: userDid) {
            return existing
        }

        let now = Date()

        do {
            try database.execute("""
                INSERT INTO user_credits (user_did, last_updated)
                VALUES (?, ?)
            """, userDid, Int(now.timeIntervalSince1970))
        } catch {
            Logger.shared.error("[CreditScore] 初始化用户信用记录失败: \(error)")
        }

        Logger.shared.info("[CreditScore] 用户信用记录已初始化: \(userDid)")
        return getUserCredit(userDid: userDid) ?? UserCredit(userDid: userDid)
    }

    /// 获取用户信用信息
    public func getUserCredit(userDid: String) -> UserCredit? {
        do {
            let rows = try database.prepare(
                "SELECT * FROM user_credits WHERE user_did = ?",
                [userDid]
            )

            guard let row = rows.first else { return nil }

            return parseUserCredit(row)
        } catch {
            Logger.shared.error("[CreditScore] 获取用户信用失败: \(error)")
            return nil
        }
    }

    /// 计算信用评分
    public func calculateCreditScore(userDid: String) async -> (creditScore: Int, creditLevel: String, levelColor: String, benefits: [String]) {
        var credit = getUserCredit(userDid: userDid) ?? initUserCredit(userDid: userDid)

        var score: Double = 0

        // 1. 交易完成率 (30%)
        let completionScore = credit.completionRate * 300 * (weights.completionRate / 0.30)
        score += completionScore

        // 2. 交易金额 (20%) - 对数增长，最高 200 分
        let volumeScore = min(200, log10(Double(credit.totalVolume + 1)) * 50)
        score += volumeScore * (weights.tradeVolume / 0.20)

        // 3. 好评率 (25%)
        let positiveScore = credit.positiveReviewRate * 250 * (weights.positiveRate / 0.25)
        score += positiveScore

        // 4. 响应速度 (10%) - 响应时间越短越好
        let responseScore: Double
        if credit.avgResponseTime > 0 {
            // 1小时内满分
            responseScore = max(0, 100 - Double(credit.avgResponseTime) / 3600000)
        } else {
            responseScore = 50 // 默认中等
        }
        score += responseScore * (weights.responseSpeed / 0.10)

        // 5. 纠纷率 (10%) - 扣分项
        let disputeScore = (1 - credit.disputeRateValue) * 100 * (weights.disputeRate / 0.10)
        score += disputeScore

        // 6. 退款率 (5%) - 扣分项
        let refundScore = (1 - credit.refundRateValue) * 50 * (weights.refundRate / 0.05)
        score += refundScore

        // 限制在 0-1000 范围内
        let finalScore = max(0, min(1000, Int(score.rounded())))

        // 确定信用等级
        let level = getCreditLevel(score: finalScore)

        // 更新数据库
        do {
            try database.execute("""
                UPDATE user_credits
                SET credit_score = ?, credit_level = ?, last_updated = ?
                WHERE user_did = ?
            """, finalScore, level.name, Int(Date().timeIntervalSince1970), userDid)
        } catch {
            Logger.shared.error("[CreditScore] 更新信用评分失败: \(error)")
        }

        // 触发事件
        creditUpdated.send((userDid: userDid, creditScore: finalScore, creditLevel: level.name))

        Logger.shared.info("[CreditScore] 信用评分已更新: \(userDid) \(finalScore) \(level.name)")

        return (finalScore, level.name, level.color, level.benefits)
    }

    /// 根据分数获取信用等级
    public func getCreditLevel(score: Int) -> CreditLevel {
        for level in creditLevels {
            if score >= level.minScore && score <= level.maxScore {
                return level
            }
        }
        return creditLevels[0] // 默认新手
    }

    // MARK: - Event Handlers

    /// 交易完成
    public func onTransactionCompleted(userDid: String, transactionId: String, amount: Int) async {
        do {
            try database.execute("""
                UPDATE user_credits
                SET total_transactions = total_transactions + 1,
                    completed_transactions = completed_transactions + 1,
                    total_volume = total_volume + ?
                WHERE user_did = ?
            """, amount, userDid)

            let scoreChange = 10
            await addCreditRecord(
                userDid: userDid,
                eventType: .tradeCompleted,
                eventId: transactionId,
                scoreChange: scoreChange,
                reason: "完成交易"
            )

            _ = await calculateCreditScore(userDid: userDid)
        } catch {
            Logger.shared.error("[CreditScore] 更新交易完成失败: \(error)")
        }
    }

    /// 交易取消
    public func onTransactionCancelled(userDid: String, transactionId: String) async {
        do {
            try database.execute("""
                UPDATE user_credits
                SET total_transactions = total_transactions + 1
                WHERE user_did = ?
            """, userDid)

            let scoreChange = -5
            await addCreditRecord(
                userDid: userDid,
                eventType: .tradeCancelled,
                eventId: transactionId,
                scoreChange: scoreChange,
                reason: "取消交易"
            )

            _ = await calculateCreditScore(userDid: userDid)
        } catch {
            Logger.shared.error("[CreditScore] 更新交易取消失败: \(error)")
        }
    }

    /// 收到好评
    public func onPositiveReview(userDid: String, reviewId: String, rating: Int) async {
        do {
            try database.execute("""
                UPDATE user_credits
                SET positive_reviews = positive_reviews + 1
                WHERE user_did = ?
            """, userDid)

            // 5星加15分，4星加10分，3星加5分
            var scoreChange = 5
            if rating >= 5 { scoreChange = 15 }
            else if rating >= 4 { scoreChange = 10 }

            await addCreditRecord(
                userDid: userDid,
                eventType: .positiveReview,
                eventId: reviewId,
                scoreChange: scoreChange,
                reason: "收到 \(rating) 星好评"
            )

            _ = await calculateCreditScore(userDid: userDid)
        } catch {
            Logger.shared.error("[CreditScore] 更新好评失败: \(error)")
        }
    }

    /// 收到差评
    public func onNegativeReview(userDid: String, reviewId: String, rating: Int) async {
        do {
            try database.execute("""
                UPDATE user_credits
                SET negative_reviews = negative_reviews + 1
                WHERE user_did = ?
            """, userDid)

            // 1星扣30分，2星扣20分
            var scoreChange = -10
            if rating <= 1 { scoreChange = -30 }
            else if rating <= 2 { scoreChange = -20 }

            await addCreditRecord(
                userDid: userDid,
                eventType: .negativeReview,
                eventId: reviewId,
                scoreChange: scoreChange,
                reason: "收到 \(rating) 星差评"
            )

            _ = await calculateCreditScore(userDid: userDid)
        } catch {
            Logger.shared.error("[CreditScore] 更新差评失败: \(error)")
        }
    }

    /// 发生纠纷
    public func onDisputeInitiated(userDid: String, disputeId: String) async {
        do {
            try database.execute("""
                UPDATE user_credits
                SET disputes = disputes + 1
                WHERE user_did = ?
            """, userDid)

            let scoreChange = -20
            await addCreditRecord(
                userDid: userDid,
                eventType: .dispute,
                eventId: disputeId,
                scoreChange: scoreChange,
                reason: "发生纠纷"
            )

            _ = await calculateCreditScore(userDid: userDid)
        } catch {
            Logger.shared.error("[CreditScore] 更新纠纷失败: \(error)")
        }
    }

    /// 纠纷解决
    public func onDisputeResolved(userDid: String, disputeId: String, resolution: String) async {
        var scoreChange = 0
        var reason = ""

        switch resolution {
        case "favor_user":
            scoreChange = 10
            reason = "纠纷解决（胜诉）"
        case "favor_opponent":
            scoreChange = -10
            reason = "纠纷解决（败诉）"
        default:
            scoreChange = 5
            reason = "纠纷解决（和解）"
        }

        await addCreditRecord(
            userDid: userDid,
            eventType: .disputeResolved,
            eventId: disputeId,
            scoreChange: scoreChange,
            reason: reason
        )

        _ = await calculateCreditScore(userDid: userDid)
    }

    /// 退款
    public func onRefund(userDid: String, refundId: String) async {
        do {
            try database.execute("""
                UPDATE user_credits
                SET refunds = refunds + 1
                WHERE user_did = ?
            """, userDid)

            let scoreChange = -8
            await addCreditRecord(
                userDid: userDid,
                eventType: .refund,
                eventId: refundId,
                scoreChange: scoreChange,
                reason: "发生退款"
            )

            _ = await calculateCreditScore(userDid: userDid)
        } catch {
            Logger.shared.error("[CreditScore] 更新退款失败: \(error)")
        }
    }

    /// 更新响应时间
    public func updateResponseTime(userDid: String, responseTime: Int) async {
        guard var credit = getUserCredit(userDid: userDid) else { return }

        let count = max(1, credit.totalTransactions)
        let avgTime = (credit.avgResponseTime * (count - 1) + responseTime) / count

        do {
            try database.execute("""
                UPDATE user_credits
                SET avg_response_time = ?
                WHERE user_did = ?
            """, avgTime, userDid)

            _ = await calculateCreditScore(userDid: userDid)
        } catch {
            Logger.shared.error("[CreditScore] 更新响应时间失败: \(error)")
        }
    }

    // MARK: - Query Methods

    /// 获取信用记录
    public func getCreditRecords(userDid: String, limit: Int = 50) -> [CreditRecord] {
        do {
            let rows = try database.prepare("""
                SELECT * FROM credit_records
                WHERE user_did = ?
                ORDER BY created_at DESC
                LIMIT ?
            """, [userDid, limit])

            return rows.compactMap { parseCreditRecord($0) }
        } catch {
            Logger.shared.error("[CreditScore] 获取信用记录失败: \(error)")
            return []
        }
    }

    /// 获取信用报告
    public func getCreditReport(userDid: String) -> CreditReport? {
        guard let credit = getUserCredit(userDid: userDid) else { return nil }

        let level = getCreditLevel(score: credit.creditScore)
        let recentRecords = getCreditRecords(userDid: userDid, limit: 10)

        let totalReviews = credit.positiveReviews + credit.negativeReviews
        let positiveRate = totalReviews > 0 ? Double(credit.positiveReviews) / Double(totalReviews) * 100 : 0
        let disputeRate = credit.totalTransactions > 0 ? Double(credit.disputes) / Double(credit.totalTransactions) * 100 : 0
        let refundRate = credit.totalTransactions > 0 ? Double(credit.refunds) / Double(credit.totalTransactions) * 100 : 0

        let statistics = CreditStatistics(
            totalTransactions: credit.totalTransactions,
            completedTransactions: credit.completedTransactions,
            completionRate: credit.completionRate * 100,
            totalVolume: credit.totalVolume,
            positiveReviews: credit.positiveReviews,
            negativeReviews: credit.negativeReviews,
            positiveRate: positiveRate,
            disputes: credit.disputes,
            disputeRate: disputeRate,
            refunds: credit.refunds,
            refundRate: refundRate,
            avgResponseTime: credit.avgResponseTime
        )

        return CreditReport(
            userDid: userDid,
            creditScore: credit.creditScore,
            creditLevel: level.name,
            levelColor: level.color,
            benefits: level.benefits,
            statistics: statistics,
            recentRecords: recentRecords,
            lastUpdated: credit.lastUpdated
        )
    }

    /// 验证信用等级
    public func verifyCreditLevel(userDid: String, requiredLevel: String) -> Bool {
        guard let credit = getUserCredit(userDid: userDid) else { return false }

        let currentLevel = getCreditLevel(score: credit.creditScore)
        guard let required = creditLevels.first(where: { $0.name == requiredLevel }) else {
            return false
        }

        return currentLevel.minScore >= required.minScore
    }

    /// 获取信用排行榜
    public func getLeaderboard(limit: Int = 50) -> [LeaderboardEntry] {
        do {
            let rows = try database.prepare("""
                SELECT * FROM user_credits
                ORDER BY credit_score DESC, total_transactions DESC
                LIMIT ?
            """, [limit])

            var entries: [LeaderboardEntry] = []
            for (index, row) in rows.enumerated() {
                if let entry = parseLeaderboardEntry(row, rank: index + 1) {
                    entries.append(entry)
                }
            }

            leaderboard = entries
            return entries
        } catch {
            Logger.shared.error("[CreditScore] 获取排行榜失败: \(error)")
            return []
        }
    }

    /// 批量重新计算所有用户评分
    public func recalculateAllScores() async {
        do {
            let rows = try database.prepare("SELECT DISTINCT user_did FROM user_credits")

            Logger.shared.info("[CreditScore] 开始批量计算信用评分，共 \(rows.count) 个用户")

            for row in rows {
                if let userDid = row["user_did"] as? String {
                    _ = await calculateCreditScore(userDid: userDid)
                }
            }

            Logger.shared.info("[CreditScore] 批量计算完成")
        } catch {
            Logger.shared.error("[CreditScore] 批量计算失败: \(error)")
        }
    }

    // MARK: - Private Methods

    /// 初始化数据库表
    private func initDatabase() async throws {
        // 用户信用表
        try database.execute("""
            CREATE TABLE IF NOT EXISTS user_credits (
                user_did TEXT PRIMARY KEY,
                credit_score INTEGER DEFAULT 0,
                credit_level TEXT DEFAULT '新手',
                total_transactions INTEGER DEFAULT 0,
                completed_transactions INTEGER DEFAULT 0,
                total_volume INTEGER DEFAULT 0,
                positive_reviews INTEGER DEFAULT 0,
                negative_reviews INTEGER DEFAULT 0,
                disputes INTEGER DEFAULT 0,
                refunds INTEGER DEFAULT 0,
                avg_response_time INTEGER DEFAULT 0,
                last_updated INTEGER NOT NULL
            )
        """)

        // 信用记录表
        try database.execute("""
            CREATE TABLE IF NOT EXISTS credit_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_did TEXT NOT NULL,
                event_type TEXT NOT NULL,
                event_id TEXT NOT NULL,
                score_change INTEGER NOT NULL,
                score_after INTEGER NOT NULL,
                reason TEXT,
                created_at INTEGER NOT NULL
            )
        """)

        // 信用快照表
        try database.execute("""
            CREATE TABLE IF NOT EXISTS credit_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_did TEXT NOT NULL,
                credit_score INTEGER NOT NULL,
                credit_level TEXT NOT NULL,
                snapshot_date INTEGER NOT NULL,
                metadata TEXT
            )
        """)
    }

    /// 添加信用记录
    private func addCreditRecord(
        userDid: String,
        eventType: CreditEventType,
        eventId: String,
        scoreChange: Int,
        reason: String?
    ) async {
        let credit = getUserCredit(userDid: userDid) ?? initUserCredit(userDid: userDid)
        let scoreAfter = credit.creditScore + scoreChange
        let now = Int(Date().timeIntervalSince1970)

        do {
            try database.execute("""
                INSERT INTO credit_records (
                    user_did, event_type, event_id, score_change, score_after, reason, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """, userDid, eventType.rawValue, eventId, scoreChange, scoreAfter, reason, now)

            Logger.shared.info("[CreditScore] 信用记录已添加: \(userDid) \(eventType.rawValue) \(scoreChange)")
        } catch {
            Logger.shared.error("[CreditScore] 添加信用记录失败: \(error)")
        }
    }

    /// 解析用户信用
    private func parseUserCredit(_ row: [String: Any]) -> UserCredit? {
        guard let userDid = row["user_did"] as? String else { return nil }

        var credit = UserCredit(userDid: userDid)
        credit.creditScore = row["credit_score"] as? Int ?? 0
        credit.creditLevel = row["credit_level"] as? String ?? "新手"
        credit.totalTransactions = row["total_transactions"] as? Int ?? 0
        credit.completedTransactions = row["completed_transactions"] as? Int ?? 0
        credit.totalVolume = row["total_volume"] as? Int ?? 0
        credit.positiveReviews = row["positive_reviews"] as? Int ?? 0
        credit.negativeReviews = row["negative_reviews"] as? Int ?? 0
        credit.disputes = row["disputes"] as? Int ?? 0
        credit.refunds = row["refunds"] as? Int ?? 0
        credit.avgResponseTime = row["avg_response_time"] as? Int ?? 0

        if let lastUpdated = row["last_updated"] as? Int {
            credit.lastUpdated = Date(timeIntervalSince1970: TimeInterval(lastUpdated))
        }

        return credit
    }

    /// 解析信用记录
    private func parseCreditRecord(_ row: [String: Any]) -> CreditRecord? {
        guard
            let id = row["id"] as? Int,
            let userDid = row["user_did"] as? String,
            let eventTypeRaw = row["event_type"] as? String,
            let eventType = CreditEventType(rawValue: eventTypeRaw),
            let eventId = row["event_id"] as? String,
            let scoreChange = row["score_change"] as? Int,
            let scoreAfter = row["score_after"] as? Int,
            let createdAt = row["created_at"] as? Int
        else {
            return nil
        }

        return CreditRecord(
            id: id,
            userDid: userDid,
            eventType: eventType,
            eventId: eventId,
            scoreChange: scoreChange,
            scoreAfter: scoreAfter,
            reason: row["reason"] as? String,
            createdAt: Date(timeIntervalSince1970: TimeInterval(createdAt))
        )
    }

    /// 解析排行榜条目
    private func parseLeaderboardEntry(_ row: [String: Any], rank: Int) -> LeaderboardEntry? {
        guard let userDid = row["user_did"] as? String else { return nil }

        return LeaderboardEntry(
            rank: rank,
            userDid: userDid,
            creditScore: row["credit_score"] as? Int ?? 0,
            creditLevel: row["credit_level"] as? String ?? "新手",
            totalTransactions: row["total_transactions"] as? Int ?? 0,
            totalVolume: row["total_volume"] as? Int ?? 0
        )
    }
}
