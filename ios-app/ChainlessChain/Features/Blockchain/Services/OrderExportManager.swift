import Foundation
import UIKit
import Combine

/// 订单导出格式
public enum OrderExportFormat: String, CaseIterable {
    case csv = "csv"
    case json = "json"
    case text = "text"
    case html = "html"
}

/// 导出结果
public struct ExportResult {
    public let success: Bool
    public let filePath: URL?
    public let data: Data?
    public let error: String?

    public static func success(filePath: URL) -> ExportResult {
        ExportResult(success: true, filePath: filePath, data: nil, error: nil)
    }

    public static func success(data: Data) -> ExportResult {
        ExportResult(success: true, filePath: nil, data: data, error: nil)
    }

    public static func failure(_ error: String) -> ExportResult {
        ExportResult(success: false, filePath: nil, data: nil, error: error)
    }
}

/// 订单导出配置
public struct OrderExportConfig {
    public var format: OrderExportFormat = .csv
    public var includeHeader: Bool = true
    public var dateFormat: String = "yyyy-MM-dd HH:mm:ss"
    public var currency: String = "CNY"
    public var locale: Locale = Locale(identifier: "zh_CN")

    public init() {}
}

/// 分享链接信息
public struct ShareLinkInfo: Codable {
    public let id: String
    public let orderId: String
    public let token: String
    public let permission: String
    public let expiresAt: Date?
    public let createdAt: Date
    public var accessCount: Int
    public var lastAccessedAt: Date?
    public var isRevoked: Bool
}

/// 订单导出管理器
/// 负责订单的CSV/JSON导出和分享功能
/// 参考PC端: desktop-app-vue/src/main/blockchain/order-export.js
@MainActor
public class OrderExportManager: ObservableObject {

    // MARK: - Singleton

    public static let shared = OrderExportManager()

    // MARK: - Published Properties

    @Published public var isExporting = false
    @Published public var lastExportResult: ExportResult?

    // MARK: - Events

    public let exportCompleted = PassthroughSubject<ExportResult, Never>()
    public let shareCompleted = PassthroughSubject<Bool, Never>()

    // MARK: - Private Properties

    private let database: DatabaseManager
    private let dateFormatter: DateFormatter
    private let fileManager = FileManager.default

    /// 状态映射
    private let statusMap: [String: String] = [
        "open": "开放中",
        "matched": "已匹配",
        "escrow": "托管中",
        "completed": "已完成",
        "cancelled": "已取消",
        "expired": "已过期",
        "disputed": "争议中"
    ]

    /// 类型映射
    private let typeMap: [String: String] = [
        "sell": "出售",
        "buy": "求购"
    ]

    // MARK: - Initialization

    private init() {
        self.database = DatabaseManager.shared
        self.dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        dateFormatter.locale = Locale(identifier: "zh_CN")

        Logger.shared.info("[OrderExportManager] 订单导出管理器已初始化")
    }

    // MARK: - Public Methods

    /// 初始化导出管理器
    public func initialize() async throws {
        try await initializeTables()
        Logger.shared.info("[OrderExportManager] 初始化成功")
    }

    /// 导出单个订单
    /// - Parameters:
    ///   - order: 订单数据
    ///   - config: 导出配置
    /// - Returns: 导出结果
    public func exportOrder(
        _ order: MarketplaceOrder,
        config: OrderExportConfig = OrderExportConfig()
    ) async -> ExportResult {
        return await exportOrders([order], config: config)
    }

    /// 导出多个订单
    /// - Parameters:
    ///   - orders: 订单列表
    ///   - config: 导出配置
    /// - Returns: 导出结果
    public func exportOrders(
        _ orders: [MarketplaceOrder],
        config: OrderExportConfig = OrderExportConfig()
    ) async -> ExportResult {
        guard !orders.isEmpty else {
            return .failure("没有订单可导出")
        }

        isExporting = true
        defer { isExporting = false }

        do {
            let result: ExportResult

            switch config.format {
            case .csv:
                result = try await exportToCSV(orders, config: config)
            case .json:
                result = try await exportToJSON(orders, config: config)
            case .text:
                result = try await exportToText(orders, config: config)
            case .html:
                result = try await exportToHTML(orders, config: config)
            }

            lastExportResult = result
            exportCompleted.send(result)

            return result
        } catch {
            let result = ExportResult.failure(error.localizedDescription)
            lastExportResult = result
            exportCompleted.send(result)
            return result
        }
    }

    /// 分享订单
    /// - Parameters:
    ///   - order: 订单数据
    ///   - format: 导出格式
    ///   - viewController: 用于呈现分享界面的视图控制器
    public func shareOrder(
        _ order: MarketplaceOrder,
        format: OrderExportFormat = .text,
        from viewController: UIViewController
    ) async {
        var config = OrderExportConfig()
        config.format = format

        let result = await exportOrder(order, config: config)

        guard result.success else {
            Logger.shared.error("[OrderExportManager] 导出失败: \(result.error ?? "未知错误")")
            shareCompleted.send(false)
            return
        }

        var itemsToShare: [Any] = []

        if let filePath = result.filePath {
            itemsToShare.append(filePath)
        } else if let data = result.data, let text = String(data: data, encoding: .utf8) {
            itemsToShare.append(text)
        }

        guard !itemsToShare.isEmpty else {
            shareCompleted.send(false)
            return
        }

        let activityVC = UIActivityViewController(
            activityItems: itemsToShare,
            applicationActivities: nil
        )

        // iPad 需要指定 popoverPresentationController
        if let popover = activityVC.popoverPresentationController {
            popover.sourceView = viewController.view
            popover.sourceRect = CGRect(x: viewController.view.bounds.midX,
                                        y: viewController.view.bounds.midY,
                                        width: 0, height: 0)
            popover.permittedArrowDirections = []
        }

        activityVC.completionWithItemsHandler = { [weak self] _, completed, _, error in
            if let error = error {
                Logger.shared.error("[OrderExportManager] 分享失败: \(error)")
                self?.shareCompleted.send(false)
            } else {
                self?.shareCompleted.send(completed)
            }
        }

        viewController.present(activityVC, animated: true)
    }

    /// 分享多个订单
    public func shareOrders(
        _ orders: [MarketplaceOrder],
        format: OrderExportFormat = .csv,
        from viewController: UIViewController
    ) async {
        var config = OrderExportConfig()
        config.format = format

        let result = await exportOrders(orders, config: config)

        guard result.success, let filePath = result.filePath else {
            Logger.shared.error("[OrderExportManager] 导出失败: \(result.error ?? "未知错误")")
            shareCompleted.send(false)
            return
        }

        let activityVC = UIActivityViewController(
            activityItems: [filePath],
            applicationActivities: nil
        )

        if let popover = activityVC.popoverPresentationController {
            popover.sourceView = viewController.view
            popover.sourceRect = CGRect(x: viewController.view.bounds.midX,
                                        y: viewController.view.bounds.midY,
                                        width: 0, height: 0)
            popover.permittedArrowDirections = []
        }

        activityVC.completionWithItemsHandler = { [weak self] _, completed, _, error in
            if let error = error {
                Logger.shared.error("[OrderExportManager] 分享失败: \(error)")
                self?.shareCompleted.send(false)
            } else {
                self?.shareCompleted.send(completed)
            }
        }

        viewController.present(activityVC, animated: true)
    }

    // MARK: - Share Link Management

    /// 创建分享链接
    /// - Parameters:
    ///   - orderId: 订单ID
    ///   - permission: 权限（view/edit）
    ///   - expiresIn: 过期时间（秒），nil 表示永不过期
    /// - Returns: 分享链接信息
    public func createShareLink(
        orderId: String,
        permission: String = "view",
        expiresIn: TimeInterval? = nil
    ) async throws -> ShareLinkInfo {
        let token = generateShareToken()
        let expiresAt = expiresIn.map { Date().addingTimeInterval($0) }

        let linkInfo = ShareLinkInfo(
            id: UUID().uuidString,
            orderId: orderId,
            token: token,
            permission: permission,
            expiresAt: expiresAt,
            createdAt: Date(),
            accessCount: 0,
            lastAccessedAt: nil,
            isRevoked: false
        )

        try await saveShareLink(linkInfo)

        Logger.shared.info("[OrderExportManager] 创建分享链接: \(token)")
        return linkInfo
    }

    /// 验证分享链接
    /// - Parameter token: 链接令牌
    /// - Returns: 链接信息（如有效）
    public func validateShareLink(token: String) async throws -> ShareLinkInfo? {
        guard let link = try await getShareLink(token: token) else {
            return nil
        }

        // 检查是否已撤销
        if link.isRevoked {
            return nil
        }

        // 检查是否过期
        if let expiresAt = link.expiresAt, expiresAt < Date() {
            return nil
        }

        // 更新访问统计
        try await updateShareLinkAccess(token: token)

        return link
    }

    /// 撤销分享链接
    /// - Parameters:
    ///   - orderId: 订单ID
    ///   - token: 可选，指定令牌；不传则撤销该订单所有链接
    /// - Returns: 撤销的链接数量
    @discardableResult
    public func revokeShareLink(orderId: String, token: String? = nil) async throws -> Int {
        return try await revokeShareLinks(orderId: orderId, token: token)
    }

    /// 获取订单的所有分享链接
    public func getShareLinks(orderId: String) async throws -> [ShareLinkInfo] {
        return try await fetchShareLinks(orderId: orderId)
    }

    // MARK: - Export to CSV

    private func exportToCSV(
        _ orders: [MarketplaceOrder],
        config: OrderExportConfig
    ) async throws -> ExportResult {
        var csvContent = ""

        // 添加表头
        if config.includeHeader {
            let headers = [
                "订单ID", "类型", "资产类型", "资产名称", "数量", "单价",
                "总价", "币种", "状态", "创建者DID", "买家DID",
                "创建时间", "更新时间", "过期时间", "完成时间", "描述"
            ]
            csvContent += headers.joined(separator: ",") + "\n"
        }

        // 添加数据行
        for order in orders {
            let row = [
                escapeCSV(order.id),
                escapeCSV(typeMap[order.type.rawValue] ?? order.type.rawValue),
                escapeCSV(order.assetType),
                escapeCSV(order.assetName ?? ""),
                escapeCSV(order.quantity != nil ? String(format: "%.4f", order.quantity!) : ""),
                escapeCSV(order.price != nil ? String(format: "%.2f", order.price!) : ""),
                escapeCSV(order.totalPrice != nil ? String(format: "%.2f", order.totalPrice!) : ""),
                escapeCSV(order.currency ?? config.currency),
                escapeCSV(statusMap[order.status.rawValue] ?? order.status.rawValue),
                escapeCSV(order.creatorDid),
                escapeCSV(order.buyerDid ?? ""),
                escapeCSV(formatDate(order.createdAt, config: config)),
                escapeCSV(formatDate(order.updatedAt, config: config)),
                escapeCSV(order.expiresAt != nil ? formatDate(order.expiresAt!, config: config) : ""),
                escapeCSV(order.completedAt != nil ? formatDate(order.completedAt!, config: config) : ""),
                escapeCSV(order.description ?? "")
            ]
            csvContent += row.joined(separator: ",") + "\n"
        }

        // 保存到文件
        let fileName = "orders_\(Date().timeIntervalSince1970).csv"
        let fileURL = try getExportDirectory().appendingPathComponent(fileName)

        try csvContent.write(to: fileURL, atomically: true, encoding: .utf8)

        Logger.shared.info("[OrderExportManager] CSV导出成功: \(fileURL.path)")
        return .success(filePath: fileURL)
    }

    // MARK: - Export to JSON

    private func exportToJSON(
        _ orders: [MarketplaceOrder],
        config: OrderExportConfig
    ) async throws -> ExportResult {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601

        // 创建导出数据结构
        let exportData: [[String: Any]] = orders.map { order in
            [
                "id": order.id,
                "type": order.type.rawValue,
                "typeDisplay": typeMap[order.type.rawValue] ?? order.type.rawValue,
                "assetType": order.assetType,
                "assetName": order.assetName ?? "",
                "quantity": order.quantity ?? 0,
                "price": order.price ?? 0,
                "totalPrice": order.totalPrice ?? 0,
                "currency": order.currency ?? config.currency,
                "status": order.status.rawValue,
                "statusDisplay": statusMap[order.status.rawValue] ?? order.status.rawValue,
                "creatorDid": order.creatorDid,
                "buyerDid": order.buyerDid ?? "",
                "description": order.description ?? "",
                "createdAt": formatDate(order.createdAt, config: config),
                "updatedAt": formatDate(order.updatedAt, config: config),
                "expiresAt": order.expiresAt != nil ? formatDate(order.expiresAt!, config: config) : "",
                "completedAt": order.completedAt != nil ? formatDate(order.completedAt!, config: config) : ""
            ]
        }

        let wrapper: [String: Any] = [
            "exportedAt": formatDate(Date(), config: config),
            "count": orders.count,
            "orders": exportData
        ]

        let jsonData = try JSONSerialization.data(withJSONObject: wrapper, options: [.prettyPrinted, .sortedKeys])

        // 保存到文件
        let fileName = "orders_\(Date().timeIntervalSince1970).json"
        let fileURL = try getExportDirectory().appendingPathComponent(fileName)

        try jsonData.write(to: fileURL)

        Logger.shared.info("[OrderExportManager] JSON导出成功: \(fileURL.path)")
        return .success(filePath: fileURL)
    }

    // MARK: - Export to Text

    private func exportToText(
        _ orders: [MarketplaceOrder],
        config: OrderExportConfig
    ) async throws -> ExportResult {
        var textContent = "ChainlessChain 交易订单\n"
        textContent += "导出时间: \(formatDate(Date(), config: config))\n"
        textContent += "订单数量: \(orders.count)\n"
        textContent += String(repeating: "=", count: 50) + "\n\n"

        for (index, order) in orders.enumerated() {
            textContent += "【订单 \(index + 1)】\n"
            textContent += "订单号: \(order.id)\n"
            textContent += "类型: \(typeMap[order.type.rawValue] ?? order.type.rawValue)\n"
            textContent += "资产: \(order.assetName ?? order.assetType)\n"

            if let quantity = order.quantity {
                textContent += "数量: \(String(format: "%.4f", quantity))\n"
            }

            if let price = order.price {
                textContent += "单价: \(String(format: "%.2f", price)) \(order.currency ?? config.currency)\n"
            }

            if let totalPrice = order.totalPrice {
                textContent += "总价: \(String(format: "%.2f", totalPrice)) \(order.currency ?? config.currency)\n"
            }

            textContent += "状态: \(statusMap[order.status.rawValue] ?? order.status.rawValue)\n"
            textContent += "创建时间: \(formatDate(order.createdAt, config: config))\n"

            if let description = order.description, !description.isEmpty {
                textContent += "描述: \(description)\n"
            }

            textContent += "\n"
        }

        textContent += String(repeating: "=", count: 50) + "\n"
        textContent += "由 ChainlessChain 生成\n"

        let data = textContent.data(using: .utf8)!
        return .success(data: data)
    }

    // MARK: - Export to HTML

    private func exportToHTML(
        _ orders: [MarketplaceOrder],
        config: OrderExportConfig
    ) async throws -> ExportResult {
        let order = orders.first!
        let html = generateOrderHTML(order, config: config)

        // 保存到文件
        let fileName = "order_\(order.id).html"
        let fileURL = try getExportDirectory().appendingPathComponent(fileName)

        try html.write(to: fileURL, atomically: true, encoding: .utf8)

        Logger.shared.info("[OrderExportManager] HTML导出成功: \(fileURL.path)")
        return .success(filePath: fileURL)
    }

    /// 生成订单HTML（对齐PC端样式）
    private func generateOrderHTML(_ order: MarketplaceOrder, config: OrderExportConfig) -> String {
        let statusDisplay = statusMap[order.status.rawValue] ?? order.status.rawValue
        let typeDisplay = typeMap[order.type.rawValue] ?? order.type.rawValue

        return """
        <!DOCTYPE html>
        <html lang="zh-CN">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>订单详情 - \(order.id)</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
              background: #f5f7fa;
              padding: 40px;
              color: #333;
            }
            .container {
              max-width: 800px;
              margin: 0 auto;
              background: white;
              border-radius: 12px;
              box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
              overflow: hidden;
            }
            .header {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              padding: 30px;
              text-align: center;
            }
            .header h1 { font-size: 24px; margin-bottom: 8px; }
            .header .order-id { font-size: 14px; opacity: 0.9; }
            .status-badge {
              display: inline-block;
              padding: 6px 16px;
              border-radius: 20px;
              font-size: 14px;
              font-weight: 500;
              margin-top: 12px;
              background: rgba(255, 255, 255, 0.2);
            }
            .content { padding: 30px; }
            .section { margin-bottom: 24px; }
            .section-title {
              font-size: 16px;
              font-weight: 600;
              color: #667eea;
              margin-bottom: 16px;
              padding-bottom: 8px;
              border-bottom: 2px solid #f0f0f0;
            }
            .info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
            .info-item { padding: 12px; background: #f8f9fc; border-radius: 8px; }
            .info-label { font-size: 12px; color: #888; margin-bottom: 4px; }
            .info-value { font-size: 16px; font-weight: 500; color: #333; }
            .description { padding: 16px; background: #f8f9fc; border-radius: 8px; line-height: 1.6; }
            .footer { text-align: center; padding: 20px; background: #f8f9fc; font-size: 12px; color: #888; }
            .price-highlight { font-size: 24px; color: #667eea; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>ChainlessChain 交易订单</h1>
              <div class="order-id">订单号: \(order.id)</div>
              <div class="status-badge">\(statusDisplay)</div>
            </div>

            <div class="content">
              <div class="section">
                <div class="section-title">基本信息</div>
                <div class="info-grid">
                  <div class="info-item">
                    <div class="info-label">订单类型</div>
                    <div class="info-value">\(typeDisplay)</div>
                  </div>
                  <div class="info-item">
                    <div class="info-label">资产类型</div>
                    <div class="info-value">\(order.assetType)</div>
                  </div>
                  <div class="info-item">
                    <div class="info-label">数量</div>
                    <div class="info-value">\(order.quantity != nil ? String(format: "%.4f", order.quantity!) : "-")</div>
                  </div>
                  <div class="info-item">
                    <div class="info-label">单价</div>
                    <div class="info-value price-highlight">\(order.price != nil ? String(format: "%.2f", order.price!) : "-") \(order.currency ?? config.currency)</div>
                  </div>
                </div>
              </div>

              <div class="section">
                <div class="section-title">时间信息</div>
                <div class="info-grid">
                  <div class="info-item">
                    <div class="info-label">创建时间</div>
                    <div class="info-value">\(formatDate(order.createdAt, config: config))</div>
                  </div>
                  <div class="info-item">
                    <div class="info-label">更新时间</div>
                    <div class="info-value">\(formatDate(order.updatedAt, config: config))</div>
                  </div>
                  <div class="info-item">
                    <div class="info-label">过期时间</div>
                    <div class="info-value">\(order.expiresAt != nil ? formatDate(order.expiresAt!, config: config) : "-")</div>
                  </div>
                  <div class="info-item">
                    <div class="info-label">完成时间</div>
                    <div class="info-value">\(order.completedAt != nil ? formatDate(order.completedAt!, config: config) : "-")</div>
                  </div>
                </div>
              </div>

              \(order.description != nil && !order.description!.isEmpty ? """
              <div class="section">
                <div class="section-title">订单描述</div>
                <div class="description">\(order.description!)</div>
              </div>
              """ : "")

              <div class="section">
                <div class="section-title">交易方信息</div>
                <div class="info-grid">
                  <div class="info-item">
                    <div class="info-label">创建者 DID</div>
                    <div class="info-value" style="font-size: 12px; word-break: break-all;">\(order.creatorDid)</div>
                  </div>
                  \(order.buyerDid != nil ? """
                  <div class="info-item">
                    <div class="info-label">买家 DID</div>
                    <div class="info-value" style="font-size: 12px; word-break: break-all;">\(order.buyerDid!)</div>
                  </div>
                  """ : "")
                </div>
              </div>
            </div>

            <div class="footer">
              <p>由 ChainlessChain 生成 | \(formatDate(Date(), config: config))</p>
              <p>此文档仅供参考，以链上数据为准</p>
            </div>
          </div>
        </body>
        </html>
        """
    }

    // MARK: - Helper Methods

    private func escapeCSV(_ value: String) -> String {
        var escaped = value
        if escaped.contains("\"") {
            escaped = escaped.replacingOccurrences(of: "\"", with: "\"\"")
        }
        if escaped.contains(",") || escaped.contains("\"") || escaped.contains("\n") {
            escaped = "\"\(escaped)\""
        }
        return escaped
    }

    private func formatDate(_ date: Date, config: OrderExportConfig) -> String {
        dateFormatter.dateFormat = config.dateFormat
        dateFormatter.locale = config.locale
        return dateFormatter.string(from: date)
    }

    private func getExportDirectory() throws -> URL {
        let documentsURL = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first!
        let exportDir = documentsURL.appendingPathComponent("exports", isDirectory: true)

        if !fileManager.fileExists(atPath: exportDir.path) {
            try fileManager.createDirectory(at: exportDir, withIntermediateDirectories: true)
        }

        return exportDir
    }

    private func generateShareToken() -> String {
        let characters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
        return String((0..<32).map { _ in characters.randomElement()! })
    }

    // MARK: - Database Operations

    private func initializeTables() async throws {
        try database.execute("""
            CREATE TABLE IF NOT EXISTS order_share_links (
                id TEXT PRIMARY KEY,
                order_id TEXT NOT NULL,
                token TEXT UNIQUE NOT NULL,
                permission TEXT DEFAULT 'view',
                expires_at INTEGER,
                created_at INTEGER NOT NULL,
                access_count INTEGER DEFAULT 0,
                last_accessed_at INTEGER,
                is_revoked INTEGER DEFAULT 0
            )
        """)

        try database.execute("""
            CREATE INDEX IF NOT EXISTS idx_share_links_order_id ON order_share_links(order_id)
        """)

        try database.execute("""
            CREATE INDEX IF NOT EXISTS idx_share_links_token ON order_share_links(token)
        """)
    }

    private func saveShareLink(_ link: ShareLinkInfo) async throws {
        try database.execute("""
            INSERT INTO order_share_links (id, order_id, token, permission, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """,
            link.id,
            link.orderId,
            link.token,
            link.permission,
            link.expiresAt.map { Int($0.timeIntervalSince1970) },
            Int(link.createdAt.timeIntervalSince1970)
        )
    }

    private func getShareLink(token: String) async throws -> ShareLinkInfo? {
        let rows = try database.prepare(
            "SELECT * FROM order_share_links WHERE token = ?",
            [token]
        )

        return rows.first.flatMap { parseShareLinkRow($0) }
    }

    private func updateShareLinkAccess(token: String) async throws {
        try database.execute("""
            UPDATE order_share_links
            SET access_count = access_count + 1, last_accessed_at = ?
            WHERE token = ?
        """,
            Int(Date().timeIntervalSince1970),
            token
        )
    }

    private func revokeShareLinks(orderId: String, token: String?) async throws -> Int {
        if let token = token {
            try database.execute("""
                UPDATE order_share_links SET is_revoked = 1 WHERE order_id = ? AND token = ?
            """,
                orderId,
                token
            )
        } else {
            try database.execute("""
                UPDATE order_share_links SET is_revoked = 1 WHERE order_id = ?
            """,
                orderId
            )
        }

        // 返回修改的行数（简化处理）
        return 1
    }

    private func fetchShareLinks(orderId: String) async throws -> [ShareLinkInfo] {
        let rows = try database.prepare("""
            SELECT * FROM order_share_links
            WHERE order_id = ? AND is_revoked = 0
            ORDER BY created_at DESC
        """,
            [orderId]
        )

        return rows.compactMap { parseShareLinkRow($0) }
    }

    private func parseShareLinkRow(_ row: [String: Any]) -> ShareLinkInfo? {
        guard
            let id = row["id"] as? String,
            let orderId = row["order_id"] as? String,
            let token = row["token"] as? String,
            let permission = row["permission"] as? String,
            let createdAt = row["created_at"] as? Int
        else {
            return nil
        }

        return ShareLinkInfo(
            id: id,
            orderId: orderId,
            token: token,
            permission: permission,
            expiresAt: (row["expires_at"] as? Int).map { Date(timeIntervalSince1970: TimeInterval($0)) },
            createdAt: Date(timeIntervalSince1970: TimeInterval(createdAt)),
            accessCount: row["access_count"] as? Int ?? 0,
            lastAccessedAt: (row["last_accessed_at"] as? Int).map { Date(timeIntervalSince1970: TimeInterval($0)) },
            isRevoked: (row["is_revoked"] as? Int ?? 0) == 1
        )
    }

    /// 清理过期的导出文件
    public func cleanupExportedFiles(olderThan days: Int = 7) async {
        do {
            let exportDir = try getExportDirectory()
            let files = try fileManager.contentsOfDirectory(
                at: exportDir,
                includingPropertiesForKeys: [.creationDateKey]
            )

            let cutoffDate = Calendar.current.date(byAdding: .day, value: -days, to: Date())!
            var deletedCount = 0

            for file in files {
                if let attributes = try? fileManager.attributesOfItem(atPath: file.path),
                   let creationDate = attributes[.creationDate] as? Date,
                   creationDate < cutoffDate {
                    try fileManager.removeItem(at: file)
                    deletedCount += 1
                }
            }

            if deletedCount > 0 {
                Logger.shared.info("[OrderExportManager] 清理了 \(deletedCount) 个过期导出文件")
            }
        } catch {
            Logger.shared.error("[OrderExportManager] 清理导出文件失败: \(error)")
        }
    }
}

// MARK: - Errors

public enum OrderExportError: Error, LocalizedError {
    case noOrdersToExport
    case exportFailed(String)
    case invalidFormat
    case fileWriteFailed
    case shareLinkNotFound
    case shareLinkExpired
    case shareLinkRevoked

    public var errorDescription: String? {
        switch self {
        case .noOrdersToExport:
            return "没有订单可导出"
        case .exportFailed(let message):
            return "导出失败: \(message)"
        case .invalidFormat:
            return "无效的导出格式"
        case .fileWriteFailed:
            return "文件写入失败"
        case .shareLinkNotFound:
            return "分享链接不存在"
        case .shareLinkExpired:
            return "分享链接已过期"
        case .shareLinkRevoked:
            return "分享链接已撤销"
        }
    }
}
