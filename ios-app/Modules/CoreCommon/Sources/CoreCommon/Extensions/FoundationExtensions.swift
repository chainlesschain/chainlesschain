import Foundation

// MARK: - String Extensions

public extension String {
    /// 将字符串转换为 Data
    var data: Data? {
        return self.data(using: .utf8)
    }

    /// Base64 编码
    var base64Encoded: String? {
        return self.data?.base64EncodedString()
    }

    /// Base64 解码
    var base64Decoded: String? {
        guard let data = Data(base64Encoded: self) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// SHA256 哈希
    var sha256: String {
        guard let data = self.data else { return "" }
        return data.sha256.hexString
    }

    /// 验证是否为有效的 DID
    var isValidDID: Bool {
        return self.hasPrefix("did:") && self.count > 10
    }

    /// 去除空白字符
    var trimmed: String {
        return self.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

// MARK: - Data Extensions

public extension Data {
    /// 转换为十六进制字符串
    var hexString: String {
        return map { String(format: "%02x", $0) }.joined()
    }

    /// 从十六进制字符串创建 Data
    init?(hexString: String) {
        let len = hexString.count / 2
        var data = Data(capacity: len)
        var index = hexString.startIndex
        for _ in 0..<len {
            let nextIndex = hexString.index(index, offsetBy: 2)
            if let byte = UInt8(hexString[index..<nextIndex], radix: 16) {
                data.append(byte)
            } else {
                return nil
            }
            index = nextIndex
        }
        self = data
    }

    /// SHA256 哈希
    var sha256: Data {
        var hash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        self.withUnsafeBytes {
            _ = CC_SHA256($0.baseAddress, CC_LONG(self.count), &hash)
        }
        return Data(hash)
    }

    /// Base64 编码字符串
    var base64String: String {
        return self.base64EncodedString()
    }
}

// MARK: - Date Extensions

public extension Date {
    /// Unix 时间戳（毫秒）
    var timestampMs: Int64 {
        return Int64(self.timeIntervalSince1970 * 1000)
    }

    /// 从 Unix 时间戳（毫秒）创建
    init(timestampMs: Int64) {
        self.init(timeIntervalSince1970: TimeInterval(timestampMs) / 1000)
    }

    /// ISO8601 格式化
    var iso8601String: String {
        let formatter = ISO8601DateFormatter()
        return formatter.string(from: self)
    }

    /// 相对时间描述（如 "2小时前"）
    var relativeTimeString: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return formatter.localizedString(for: self, relativeTo: Date())
    }
}

// MARK: - Array Extensions

public extension Array {
    /// 安全下标访问
    subscript(safe index: Int) -> Element? {
        return indices.contains(index) ? self[index] : nil
    }

    /// 分块（每块最多 size 个元素）
    func chunked(into size: Int) -> [[Element]] {
        return stride(from: 0, to: count, by: size).map {
            Array(self[$0 ..< Swift.min($0 + size, count)])
        }
    }
}

// MARK: - Dictionary Extensions

public extension Dictionary {
    /// 合并字典
    mutating func merge(_ other: [Key: Value]) {
        for (key, value) in other {
            self[key] = value
        }
    }

    /// 返回合并后的新字典
    func merged(with other: [Key: Value]) -> [Key: Value] {
        var result = self
        result.merge(other)
        return result
    }
}

// MARK: - CommonCrypto Import

import CommonCrypto
