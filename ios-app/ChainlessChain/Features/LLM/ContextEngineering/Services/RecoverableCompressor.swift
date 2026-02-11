import Foundation
import CoreCommon

/// 可恢复压缩器
///
/// Manus 策略：超长观察数据使用可恢复的压缩——保留 URL/路径，丢弃内容本体
/// 这样可以在需要时重新获取原始内容
///
public class RecoverableCompressor {

    // MARK: - Singleton

    public static let shared = RecoverableCompressor()

    // MARK: - Compression Thresholds

    /// 压缩阈值（字符数）
    public struct Thresholds {
        public var webpage: Int = 2000
        public var file: Int = 5000
        public var dbResult: Int = 1000
        public var `default`: Int = 3000

        public init() {}
    }

    private var thresholds = Thresholds()

    // MARK: - Initialization

    private init() {}

    /// 配置阈值
    public func configure(_ thresholds: Thresholds) {
        self.thresholds = thresholds
    }

    // MARK: - Compression

    /// 压缩内容，保留可恢复的引用
    /// - Parameters:
    ///   - content: 原始内容
    ///   - type: 内容类型
    /// - Returns: 压缩后的引用或原始内容
    public func compress(_ content: Any, type: RefType = .text) -> Any {
        switch type {
        case .webpage:
            return compressWebpage(content)
        case .file:
            return compressFile(content)
        case .dbResult:
            return compressDbResult(content)
        default:
            return compressDefault(content)
        }
    }

    /// 压缩字符串内容
    public func compressString(_ content: String, type: RefType = .text, threshold: Int? = nil) -> CompressedRef? {
        let limit = threshold ?? getThreshold(for: type)

        guard content.count >= limit else {
            return nil  // 不需要压缩
        }

        return CompressedRef(
            refType: type,
            preview: String(content.prefix(limit / 2)) + "...",
            originalLength: content.count,
            recoverable: false
        )
    }

    // MARK: - Type-specific Compression

    /// 压缩网页内容
    private func compressWebpage(_ content: Any) -> Any {
        if let stringContent = content as? String {
            guard stringContent.count >= thresholds.webpage else {
                return stringContent
            }

            return CompressedRef(
                refType: .webpage,
                preview: String(stringContent.prefix(500)) + "...",
                originalLength: stringContent.count,
                recoverable: false
            )
        }

        if let webContent = content as? WebpageContent {
            return CompressedRef(
                refType: .webpage,
                preview: webContent.summary?.prefix(200).description,
                originalLength: webContent.content?.count,
                recoverable: webContent.url != nil,
                url: webContent.url
            )
        }

        return compressDefault(content)
    }

    /// 压缩文件内容
    private func compressFile(_ content: Any) -> Any {
        if let stringContent = content as? String {
            guard stringContent.count >= thresholds.file else {
                return stringContent
            }

            return CompressedRef(
                refType: .file,
                preview: String(stringContent.prefix(1000)) + "...",
                originalLength: stringContent.count,
                recoverable: false
            )
        }

        if let fileContent = content as? FileContent {
            return CompressedRef(
                refType: .file,
                preview: fileContent.content?.prefix(500).description,
                originalLength: fileContent.content?.count ?? fileContent.size,
                recoverable: fileContent.path != nil,
                path: fileContent.path
            )
        }

        return compressDefault(content)
    }

    /// 压缩数据库结果
    private func compressDbResult(_ content: Any) -> Any {
        let maxRows = 10

        if let rows = content as? [[String: Any]] {
            guard rows.count > maxRows else {
                return content
            }

            return CompressedRef(
                refType: .dbResult,
                preview: "Total rows: \(rows.count), showing first \(maxRows)",
                originalLength: rows.count,
                recoverable: false
            )
        }

        if let dbResult = content as? DatabaseResult {
            return CompressedRef(
                refType: .dbResult,
                preview: "Columns: \(dbResult.columns?.joined(separator: ", ") ?? "unknown")",
                originalLength: dbResult.rows?.count,
                recoverable: dbResult.query != nil,
                query: dbResult.query
            )
        }

        return compressDefault(content)
    }

    /// 默认压缩
    private func compressDefault(_ content: Any) -> Any {
        if let stringContent = content as? String {
            guard stringContent.count >= thresholds.default else {
                return stringContent
            }

            return CompressedRef(
                refType: .text,
                preview: String(stringContent.prefix(1000)) + "...",
                originalLength: stringContent.count,
                recoverable: false
            )
        }

        // 尝试 JSON 序列化
        if let jsonData = try? JSONSerialization.data(withJSONObject: content),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            guard jsonString.count >= thresholds.default else {
                return content
            }

            return CompressedRef(
                refType: .object,
                preview: String(jsonString.prefix(1000)) + "...",
                originalLength: jsonString.count,
                recoverable: false
            )
        }

        // 无法序列化，返回字符串描述
        let description = String(describing: content)
        return CompressedRef(
            refType: .unknown,
            preview: String(description.prefix(500)),
            originalLength: description.count,
            recoverable: false
        )
    }

    // MARK: - Utility Methods

    /// 获取指定类型的阈值
    private func getThreshold(for type: RefType) -> Int {
        switch type {
        case .webpage:
            return thresholds.webpage
        case .file:
            return thresholds.file
        case .dbResult:
            return thresholds.dbResult
        default:
            return thresholds.default
        }
    }

    /// 检查是否为压缩引用
    public func isCompressedRef(_ data: Any) -> Bool {
        return data is CompressedRef
    }

    /// 解析压缩引用
    public func asCompressedRef(_ data: Any) -> CompressedRef? {
        return data as? CompressedRef
    }

    // MARK: - Recovery

    /// 恢复函数协议
    public typealias WebpageFetcher = (String) async throws -> String
    public typealias FileReader = (String) async throws -> String
    public typealias QueryRunner = (String) async throws -> [[String: Any]]

    /// 恢复压缩内容
    /// - Parameters:
    ///   - ref: 压缩引用
    ///   - webpageFetcher: 网页获取函数
    ///   - fileReader: 文件读取函数
    ///   - queryRunner: 查询执行函数
    /// - Returns: 恢复的原始内容
    public func recover(
        _ ref: CompressedRef,
        webpageFetcher: WebpageFetcher? = nil,
        fileReader: FileReader? = nil,
        queryRunner: QueryRunner? = nil
    ) async throws -> Any {
        guard ref.recoverable else {
            throw RecoveryError.notRecoverable(ref.refType)
        }

        switch ref.refType {
        case .webpage:
            guard let url = ref.url, let fetcher = webpageFetcher else {
                throw RecoveryError.missingRecoveryFunction("webpageFetcher")
            }
            return try await fetcher(url)

        case .file:
            guard let path = ref.path, let reader = fileReader else {
                throw RecoveryError.missingRecoveryFunction("fileReader")
            }
            return try await reader(path)

        case .dbResult:
            guard let query = ref.query, let runner = queryRunner else {
                throw RecoveryError.missingRecoveryFunction("queryRunner")
            }
            return try await runner(query)

        default:
            throw RecoveryError.unsupportedType(ref.refType)
        }
    }

    // MARK: - Batch Compression

    /// 批量压缩工具调用结果
    public func compressToolResults(_ results: [String: Any]) -> [String: Any] {
        var compressed: [String: Any] = [:]

        for (key, value) in results {
            if let stringValue = value as? String {
                if let ref = compressString(stringValue, type: .text) {
                    compressed[key] = ref
                } else {
                    compressed[key] = value
                }
            } else {
                compressed[key] = compress(value, type: .object)
            }
        }

        return compressed
    }
}

// MARK: - Supporting Types

/// 网页内容
public struct WebpageContent {
    public let url: String?
    public let title: String?
    public let content: String?
    public let summary: String?

    public init(url: String? = nil, title: String? = nil, content: String? = nil, summary: String? = nil) {
        self.url = url
        self.title = title
        self.content = content
        self.summary = summary
    }
}

/// 文件内容
public struct FileContent {
    public let path: String?
    public let name: String?
    public let content: String?
    public let size: Int?

    public init(path: String? = nil, name: String? = nil, content: String? = nil, size: Int? = nil) {
        self.path = path
        self.name = name
        self.content = content
        self.size = size
    }
}

/// 数据库结果
public struct DatabaseResult {
    public let query: String?
    public let columns: [String]?
    public let rows: [[String: Any]]?

    public init(query: String? = nil, columns: [String]? = nil, rows: [[String: Any]]? = nil) {
        self.query = query
        self.columns = columns
        self.rows = rows
    }
}

// MARK: - Recovery Errors

public enum RecoveryError: Error, LocalizedError {
    case notRecoverable(RefType)
    case missingRecoveryFunction(String)
    case unsupportedType(RefType)
    case recoveryFailed(String)

    public var errorDescription: String? {
        switch self {
        case .notRecoverable(let type):
            return "内容不可恢复: \(type.rawValue)"
        case .missingRecoveryFunction(let name):
            return "缺少恢复函数: \(name)"
        case .unsupportedType(let type):
            return "不支持的类型: \(type.rawValue)"
        case .recoveryFailed(let reason):
            return "恢复失败: \(reason)"
        }
    }
}
