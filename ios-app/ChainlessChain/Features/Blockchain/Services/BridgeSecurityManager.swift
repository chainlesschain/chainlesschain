import Foundation
import Combine
import CryptoKit

/// 安全配置
struct BridgeSecurityConfig {
    /// 每小时最大转账次数
    let maxTransfersPerHour: Int = 10
    /// 单笔最大转账金额（Wei）
    let maxAmountPerTransfer: Decimal = Decimal(string: "1000000000000000000000")! // 1000 tokens
    /// 每日最大交易量（Wei）
    let maxDailyVolume: Decimal = Decimal(string: "10000000000000000000000")! // 10000 tokens

    /// 多签最少签名数
    let minSignaturesRequired: Int = 2
    /// 签名超时时间（秒）
    let signatureTimeout: TimeInterval = 300

    /// 可疑金额阈值（Wei）
    let suspiciousAmountThreshold: Decimal = Decimal(string: "100000000000000000000")! // 100 tokens
    /// 快速转账窗口（秒）
    let rapidTransferWindow: TimeInterval = 60
    /// 快速转账窗口内最大转账次数
    let maxRapidTransfers: Int = 3

    /// 暂停持续时间（秒）
    let pauseDuration: TimeInterval = 3600 // 1 hour
}

/// 安全事件严重程度
enum SecurityEventSeverity: String, Codable {
    case critical
    case high
    case medium
    case low
    case info
}

/// 安全事件类型
enum SecurityEventType: String, Codable {
    case blacklistAttempt = "BLACKLIST_ATTEMPT"
    case rateLimitExceeded = "RATE_LIMIT_EXCEEDED"
    case volumeLimitExceeded = "VOLUME_LIMIT_EXCEEDED"
    case suspiciousActivity = "SUSPICIOUS_ACTIVITY"
    case bridgePaused = "BRIDGE_PAUSED"
    case bridgeResumed = "BRIDGE_RESUMED"
    case addressBlacklisted = "ADDRESS_BLACKLISTED"
    case addressUnblacklisted = "ADDRESS_UNBLACKLISTED"
    case multiSigCreated = "MULTISIG_CREATED"
    case multiSigApproved = "MULTISIG_APPROVED"
}

/// 安全事件
struct BridgeSecurityEvent: Identifiable, Codable {
    let id: String
    let eventType: SecurityEventType
    let severity: SecurityEventSeverity
    let address: String?
    let amount: String?
    let chainId: Int?
    let details: String?
    let createdAt: Date

    init(
        eventType: SecurityEventType,
        severity: SecurityEventSeverity,
        address: String? = nil,
        amount: String? = nil,
        chainId: Int? = nil,
        details: String? = nil
    ) {
        self.id = UUID().uuidString
        self.eventType = eventType
        self.severity = severity
        self.address = address
        self.amount = amount
        self.chainId = chainId
        self.details = details
        self.createdAt = Date()
    }
}

/// 验证结果
struct TransferValidationResult {
    let valid: Bool
    let reason: String?
    let message: String?
    let severity: SecurityEventSeverity?
    let requiresMultiSig: Bool

    static func success(requiresMultiSig: Bool = false) -> TransferValidationResult {
        return TransferValidationResult(
            valid: true,
            reason: nil,
            message: "验证成功",
            severity: nil,
            requiresMultiSig: requiresMultiSig
        )
    }

    static func failure(reason: String, message: String, severity: SecurityEventSeverity) -> TransferValidationResult {
        return TransferValidationResult(
            valid: false,
            reason: reason,
            message: message,
            severity: severity,
            requiresMultiSig: false
        )
    }
}

/// 多签交易
struct MultiSigTransaction: Identifiable, Codable {
    let id: String
    let txData: BridgeRecord
    let requiredSignatures: Int
    var signatures: [MultiSigSignature]
    var status: MultiSigStatus
    let createdAt: Date
    var completedAt: Date?

    var isApproved: Bool {
        return signatures.count >= requiredSignatures
    }
}

/// 多签状态
enum MultiSigStatus: String, Codable {
    case pending
    case approved
    case expired
    case rejected
}

/// 多签签名
struct MultiSigSignature: Codable {
    let signer: String
    let signature: String
    let timestamp: Date
}

/// 转账历史记录
struct TransferHistoryEntry {
    let timestamp: Date
    let amount: Decimal
}

/// 每日交易量记录
struct DailyVolumeEntry {
    let date: String  // YYYY-MM-DD
    var volume: Decimal
}

/// 跨链桥安全管理器
/// 提供生产级别的安全功能：
/// - 黑名单机制
/// - 速率限制
/// - 多签验证
/// - 紧急暂停
/// - 审计日志
@MainActor
public class BridgeSecurityManager: ObservableObject {

    // MARK: - Singleton

    public static let shared = BridgeSecurityManager()

    // MARK: - Published Properties

    @Published public var isPaused = false
    @Published public var pausedUntil: Date?
    @Published public var blacklistedAddresses: Set<String> = []
    @Published public var securityEvents: [BridgeSecurityEvent] = []

    // MARK: - Events

    public let suspiciousActivityDetected = PassthroughSubject<(address: String, amount: String, reason: String), Never>()
    public let bridgePausedEvent = PassthroughSubject<(duration: TimeInterval, reason: String), Never>()
    public let bridgeResumedEvent = PassthroughSubject<Void, Never>()
    public let multiSigApproved = PassthroughSubject<MultiSigTransaction, Never>()
    public let securityEventLogged = PassthroughSubject<BridgeSecurityEvent, Never>()

    // MARK: - Private Properties

    private let config = BridgeSecurityConfig()
    private let database: DatabaseManager

    /// 转账历史（地址 -> 转账记录列表）
    private var transferHistory: [String: [TransferHistoryEntry]] = [:]

    /// 每日交易量（地址 -> 日期和交易量）
    private var dailyVolume: [String: DailyVolumeEntry] = [:]

    /// 待处理的多签交易
    private var pendingMultiSig: [String: MultiSigTransaction] = [:]

    /// 清理定时器
    private var cleanupTimer: Timer?

    private var initialized = false

    // MARK: - Initialization

    private init() {
        self.database = DatabaseManager.shared
        Logger.shared.info("[BridgeSecurity] 安全管理器已初始化")
    }

    // MARK: - Public Methods

    /// 初始化安全管理器
    public func initialize() async throws {
        guard !initialized else {
            Logger.shared.info("[BridgeSecurity] 已初始化")
            return
        }

        try await initializeTables()
        await loadBlacklist()
        startCleanupInterval()

        initialized = true
        Logger.shared.info("[BridgeSecurity] 初始化成功")
    }

    // MARK: - Transfer Validation

    /// 验证桥接转账
    /// - Parameter transfer: 转账记录
    /// - Returns: 验证结果
    public func validateTransfer(_ transfer: BridgeRecord) async -> TransferValidationResult {
        Logger.shared.info("[BridgeSecurity] 验证转账: \(transfer.senderAddress) -> \(transfer.recipientAddress), 金额: \(transfer.amount)")

        // 检查是否暂停
        if isPaused {
            if let until = pausedUntil {
                let remaining = until.timeIntervalSince(Date())
                return .failure(
                    reason: "BRIDGE_PAUSED",
                    message: "桥接已暂停，还需等待 \(Int(remaining / 60)) 分钟",
                    severity: .critical
                )
            }
        }

        // 检查黑名单
        if isBlacklisted(transfer.senderAddress) || isBlacklisted(transfer.recipientAddress) {
            await logSecurityEvent(BridgeSecurityEvent(
                eventType: .blacklistAttempt,
                severity: .critical,
                address: transfer.senderAddress,
                amount: transfer.amount,
                chainId: transfer.fromChainId,
                details: "试图从/向黑名单地址转账"
            ))

            return .failure(
                reason: "BLACKLISTED",
                message: "地址已被列入黑名单",
                severity: .critical
            )
        }

        // 检查速率限制
        let rateLimitCheck = checkRateLimit(address: transfer.senderAddress, amount: transfer.amount)
        if !rateLimitCheck.valid {
            await logSecurityEvent(BridgeSecurityEvent(
                eventType: .rateLimitExceeded,
                severity: .high,
                address: transfer.senderAddress,
                amount: transfer.amount,
                chainId: transfer.fromChainId,
                details: rateLimitCheck.message
            ))
            return rateLimitCheck
        }

        // 检查每日交易量
        let volumeCheck = checkDailyVolume(address: transfer.senderAddress, amount: transfer.amount)
        if !volumeCheck.valid {
            await logSecurityEvent(BridgeSecurityEvent(
                eventType: .volumeLimitExceeded,
                severity: .high,
                address: transfer.senderAddress,
                amount: transfer.amount,
                chainId: transfer.fromChainId,
                details: volumeCheck.message
            ))
            return volumeCheck
        }

        // 检查可疑活动
        let suspiciousCheck = checkSuspiciousActivity(address: transfer.senderAddress, amount: transfer.amount)
        if suspiciousCheck.suspicious {
            await logSecurityEvent(BridgeSecurityEvent(
                eventType: .suspiciousActivity,
                severity: .medium,
                address: transfer.senderAddress,
                amount: transfer.amount,
                chainId: transfer.fromChainId,
                details: suspiciousCheck.reason
            ))

            // 通知但不阻止
            suspiciousActivityDetected.send((
                address: transfer.senderAddress,
                amount: transfer.amount,
                reason: suspiciousCheck.reason ?? ""
            ))
        }

        // 记录转账
        recordTransfer(address: transfer.senderAddress, amount: transfer.amount)

        // 检查是否需要多签
        let requiresMultiSig = amountExceedsThreshold(transfer.amount)

        return .success(requiresMultiSig: requiresMultiSig)
    }

    // MARK: - Rate Limiting

    /// 检查速率限制
    private func checkRateLimit(address: String, amount: String) -> TransferValidationResult {
        let now = Date()
        let addr = address.lowercased()
        let history = transferHistory[addr] ?? []

        // 移除超过1小时的记录
        let recentTransfers = history.filter { now.timeIntervalSince($0.timestamp) < 3600 }

        if recentTransfers.count >= config.maxTransfersPerHour {
            return .failure(
                reason: "RATE_LIMIT",
                message: "已超过每小时最大转账次数（\(config.maxTransfersPerHour)次）",
                severity: .high
            )
        }

        // 检查单笔转账金额
        guard let amountDecimal = Decimal(string: amount) else {
            return .failure(reason: "INVALID_AMOUNT", message: "无效的转账金额", severity: .high)
        }

        if amountDecimal > config.maxAmountPerTransfer {
            return .failure(
                reason: "AMOUNT_LIMIT",
                message: "转账金额超过单笔最大限制",
                severity: .high
            )
        }

        return .success()
    }

    /// 检查每日交易量
    private func checkDailyVolume(address: String, amount: String) -> TransferValidationResult {
        let addr = address.lowercased()
        let today = formatDate(Date())

        guard let amountDecimal = Decimal(string: amount) else {
            return .failure(reason: "INVALID_AMOUNT", message: "无效的转账金额", severity: .high)
        }

        var currentVolume: Decimal = 0
        if let volumeData = dailyVolume[addr], volumeData.date == today {
            currentVolume = volumeData.volume
        }

        let newVolume = currentVolume + amountDecimal

        if newVolume > config.maxDailyVolume {
            return .failure(
                reason: "DAILY_VOLUME_LIMIT",
                message: "已超过每日最大交易量限制",
                severity: .high
            )
        }

        return .success()
    }

    /// 检查可疑活动
    private func checkSuspiciousActivity(address: String, amount: String) -> (suspicious: Bool, reason: String?) {
        let now = Date()
        let addr = address.lowercased()
        let history = transferHistory[addr] ?? []

        // 检查快速连续转账
        let rapidTransfers = history.filter {
            now.timeIntervalSince($0.timestamp) < config.rapidTransferWindow
        }

        if rapidTransfers.count >= config.maxRapidTransfers {
            return (true, "检测到快速连续转账")
        }

        // 检查大额转账
        guard let amountDecimal = Decimal(string: amount) else {
            return (false, nil)
        }

        if amountDecimal >= config.suspiciousAmountThreshold {
            return (true, "大额转账")
        }

        return (false, nil)
    }

    /// 记录转账
    private func recordTransfer(address: String, amount: String) {
        let now = Date()
        let today = formatDate(now)
        let addr = address.lowercased()

        guard let amountDecimal = Decimal(string: amount) else { return }

        // 更新转账历史
        var history = transferHistory[addr] ?? []
        history.append(TransferHistoryEntry(timestamp: now, amount: amountDecimal))
        transferHistory[addr] = history

        // 更新每日交易量
        if var volumeData = dailyVolume[addr], volumeData.date == today {
            volumeData.volume += amountDecimal
            dailyVolume[addr] = volumeData
        } else {
            dailyVolume[addr] = DailyVolumeEntry(date: today, volume: amountDecimal)
        }
    }

    /// 检查金额是否超过阈值（需要多签）
    private func amountExceedsThreshold(_ amount: String) -> Bool {
        guard let amountDecimal = Decimal(string: amount) else { return false }
        return amountDecimal >= config.suspiciousAmountThreshold
    }

    // MARK: - Multi-Signature

    /// 创建多签交易
    public func createMultiSigTransaction(_ transfer: BridgeRecord) async throws -> MultiSigTransaction {
        let txId = generateTransactionId(transfer)

        let multiSigTx = MultiSigTransaction(
            id: txId,
            txData: transfer,
            requiredSignatures: config.minSignaturesRequired,
            signatures: [],
            status: .pending,
            createdAt: Date(),
            completedAt: nil
        )

        pendingMultiSig[txId] = multiSigTx

        await logSecurityEvent(BridgeSecurityEvent(
            eventType: .multiSigCreated,
            severity: .info,
            address: transfer.senderAddress,
            amount: transfer.amount,
            details: "多签交易已创建，需要 \(config.minSignaturesRequired) 个签名"
        ))

        Logger.shared.info("[BridgeSecurity] 多签交易已创建: \(txId)")

        return multiSigTx
    }

    /// 添加签名
    public func addSignature(txId: String, signature: String, signer: String) async throws -> (approved: Bool, signaturesCount: Int) {
        guard var multiSigTx = pendingMultiSig[txId] else {
            throw BridgeError.requestNotFound
        }

        guard multiSigTx.status == .pending else {
            throw BridgeError.alreadyCompleted
        }

        // 检查超时
        if Date().timeIntervalSince(multiSigTx.createdAt) > config.signatureTimeout {
            multiSigTx.status = .expired
            pendingMultiSig[txId] = multiSigTx
            throw BridgeError.securityCheckFailed("签名超时")
        }

        // 添加签名
        let sig = MultiSigSignature(signer: signer, signature: signature, timestamp: Date())
        multiSigTx.signatures.append(sig)

        // 检查是否达到要求的签名数
        if multiSigTx.signatures.count >= multiSigTx.requiredSignatures {
            multiSigTx.status = .approved
            multiSigTx.completedAt = Date()

            await logSecurityEvent(BridgeSecurityEvent(
                eventType: .multiSigApproved,
                severity: .info,
                address: multiSigTx.txData.senderAddress,
                amount: multiSigTx.txData.amount,
                details: "多签交易已批准"
            ))

            multiSigApproved.send(multiSigTx)

            Logger.shared.info("[BridgeSecurity] 多签交易已批准: \(txId)")
        }

        pendingMultiSig[txId] = multiSigTx

        Logger.shared.info("[BridgeSecurity] 签名已添加 (\(multiSigTx.signatures.count)/\(multiSigTx.requiredSignatures))")

        return (multiSigTx.isApproved, multiSigTx.signatures.count)
    }

    // MARK: - Emergency Pause

    /// 紧急暂停桥接
    public func pauseBridge(duration: TimeInterval? = nil, reason: String = "") async {
        let actualDuration = duration ?? config.pauseDuration
        isPaused = true
        pausedUntil = Date().addingTimeInterval(actualDuration)

        await logSecurityEvent(BridgeSecurityEvent(
            eventType: .bridgePaused,
            severity: .critical,
            details: "桥接暂停 \(Int(actualDuration / 60)) 分钟。原因: \(reason)"
        ))

        bridgePausedEvent.send((duration: actualDuration, reason: reason))

        Logger.shared.info("[BridgeSecurity] 桥接已暂停，直到 \(pausedUntil?.description ?? "N/A")")

        // 自动恢复
        DispatchQueue.main.asyncAfter(deadline: .now() + actualDuration) { [weak self] in
            Task { @MainActor in
                await self?.resumeBridge()
            }
        }
    }

    /// 恢复桥接
    public func resumeBridge() async {
        isPaused = false
        pausedUntil = nil

        await logSecurityEvent(BridgeSecurityEvent(
            eventType: .bridgeResumed,
            severity: .info,
            details: "桥接已恢复"
        ))

        bridgeResumedEvent.send()

        Logger.shared.info("[BridgeSecurity] 桥接已恢复")
    }

    // MARK: - Blacklist

    /// 添加到黑名单
    public func addToBlacklist(address: String, reason: String, addedBy: String = "system") async {
        let addr = address.lowercased()

        guard !blacklistedAddresses.contains(addr) else {
            Logger.shared.info("[BridgeSecurity] 地址已在黑名单中: \(addr)")
            return
        }

        blacklistedAddresses.insert(addr)

        // 保存到数据库
        try? database.execute("""
            INSERT INTO bridge_blacklist (address, reason, added_at, added_by)
            VALUES (?, ?, ?, ?)
        """, addr, reason, Int(Date().timeIntervalSince1970), addedBy)

        await logSecurityEvent(BridgeSecurityEvent(
            eventType: .addressBlacklisted,
            severity: .high,
            address: addr,
            details: "原因: \(reason)"
        ))

        Logger.shared.info("[BridgeSecurity] 地址已加入黑名单: \(addr)")
    }

    /// 从黑名单移除
    public func removeFromBlacklist(address: String) async {
        let addr = address.lowercased()

        blacklistedAddresses.remove(addr)

        // 从数据库删除
        try? database.execute("DELETE FROM bridge_blacklist WHERE address = ?", addr)

        await logSecurityEvent(BridgeSecurityEvent(
            eventType: .addressUnblacklisted,
            severity: .info,
            address: addr,
            details: "地址已从黑名单移除"
        ))

        Logger.shared.info("[BridgeSecurity] 地址已从黑名单移除: \(addr)")
    }

    /// 检查地址是否在黑名单中
    public func isBlacklisted(_ address: String) -> Bool {
        return blacklistedAddresses.contains(address.lowercased())
    }

    // MARK: - Security Events

    /// 记录安全事件
    private func logSecurityEvent(_ event: BridgeSecurityEvent) async {
        securityEvents.insert(event, at: 0)

        // 只保留最近100条事件
        if securityEvents.count > 100 {
            securityEvents = Array(securityEvents.prefix(100))
        }

        // 保存到数据库
        try? database.execute("""
            INSERT INTO bridge_security_events
            (id, event_type, severity, address, amount, chain_id, details, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
            event.id,
            event.eventType.rawValue,
            event.severity.rawValue,
            event.address,
            event.amount,
            event.chainId,
            event.details,
            Int(event.createdAt.timeIntervalSince1970)
        )

        securityEventLogged.send(event)

        Logger.shared.info("[BridgeSecurity] 安全事件已记录: \(event.eventType.rawValue) (\(event.severity.rawValue))")
    }

    /// 获取安全事件
    public func getSecurityEvents(
        severity: SecurityEventSeverity? = nil,
        type: SecurityEventType? = nil,
        address: String? = nil,
        limit: Int = 100
    ) -> [BridgeSecurityEvent] {
        var filtered = securityEvents

        if let severity = severity {
            filtered = filtered.filter { $0.severity == severity }
        }

        if let type = type {
            filtered = filtered.filter { $0.eventType == type }
        }

        if let address = address {
            filtered = filtered.filter { $0.address?.lowercased() == address.lowercased() }
        }

        return Array(filtered.prefix(limit))
    }

    // MARK: - Private Methods

    /// 初始化数据库表
    private func initializeTables() async throws {
        // 安全事件表
        try database.execute("""
            CREATE TABLE IF NOT EXISTS bridge_security_events (
                id TEXT PRIMARY KEY,
                event_type TEXT NOT NULL,
                severity TEXT NOT NULL,
                address TEXT,
                amount TEXT,
                chain_id INTEGER,
                details TEXT,
                created_at INTEGER NOT NULL
            )
        """)

        // 黑名单表
        try database.execute("""
            CREATE TABLE IF NOT EXISTS bridge_blacklist (
                address TEXT PRIMARY KEY,
                reason TEXT NOT NULL,
                added_at INTEGER NOT NULL,
                added_by TEXT
            )
        """)

        // 多签交易表
        try database.execute("""
            CREATE TABLE IF NOT EXISTS bridge_multisig_txs (
                tx_id TEXT PRIMARY KEY,
                tx_data TEXT NOT NULL,
                required_signatures INTEGER NOT NULL,
                signatures TEXT,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                completed_at INTEGER
            )
        """)

        Logger.shared.info("[BridgeSecurity] 数据库表初始化完成")
    }

    /// 加载黑名单
    private func loadBlacklist() async {
        do {
            let rows = try database.prepare("SELECT address FROM bridge_blacklist")

            blacklistedAddresses.removeAll()
            for row in rows {
                if let address = row["address"] as? String {
                    blacklistedAddresses.insert(address.lowercased())
                }
            }

            Logger.shared.info("[BridgeSecurity] 已加载 \(blacklistedAddresses.count) 个黑名单地址")
        } catch {
            Logger.shared.error("[BridgeSecurity] 加载黑名单失败: \(error)")
        }
    }

    /// 启动清理定时器
    private func startCleanupInterval() {
        cleanupTimer = Timer.scheduledTimer(withTimeInterval: 3600, repeats: true) { [weak self] _ in
            self?.cleanup()
        }
    }

    /// 清理旧数据
    private func cleanup() {
        let now = Date()

        // 清理转账历史（保留1小时内）
        for (address, history) in transferHistory {
            let recent = history.filter { now.timeIntervalSince($0.timestamp) < 3600 }
            if recent.isEmpty {
                transferHistory.removeValue(forKey: address)
            } else {
                transferHistory[address] = recent
            }
        }

        // 清理每日交易量（只保留当天）
        let today = formatDate(now)
        for (address, data) in dailyVolume {
            if data.date != today {
                dailyVolume.removeValue(forKey: address)
            }
        }

        // 清理过期的多签交易
        for (txId, tx) in pendingMultiSig {
            if now.timeIntervalSince(tx.createdAt) > config.signatureTimeout {
                pendingMultiSig.removeValue(forKey: txId)
            }
        }

        Logger.shared.info("[BridgeSecurity] 清理完成")
    }

    /// 生成交易ID
    private func generateTransactionId(_ transfer: BridgeRecord) -> String {
        let data = "\(transfer.senderAddress)\(transfer.recipientAddress)\(transfer.amount)\(Date().timeIntervalSince1970)"
        let hash = SHA256.hash(data: Data(data.utf8))
        return hash.compactMap { String(format: "%02x", $0) }.joined()
    }

    /// 格式化日期
    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    /// 关闭管理器
    public func close() {
        cleanupTimer?.invalidate()
        cleanupTimer = nil
        initialized = false
        Logger.shared.info("[BridgeSecurity] 已关闭")
    }
}
