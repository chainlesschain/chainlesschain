import Foundation
import Combine

/// JSON-RPC 请求模型
struct JSONRPCRequest: Codable {
    let jsonrpc: String = "2.0"
    let id: Int
    let method: String
    let params: [AnyCodable]

    init(id: Int, method: String, params: [Any]) {
        self.id = id
        self.method = method
        self.params = params.map { AnyCodable($0) }
    }
}

/// JSON-RPC 响应模型
struct JSONRPCResponse<T: Decodable>: Decodable {
    let jsonrpc: String
    let id: Int
    let result: T?
    let error: JSONRPCError?
}

/// JSON-RPC 错误
struct JSONRPCError: Decodable, Error {
    let code: Int
    let message: String
    let data: String?
}

/// AnyCodable - 支持任意类型编码
struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if let intValue = try? container.decode(Int.self) {
            value = intValue
        } else if let stringValue = try? container.decode(String.self) {
            value = stringValue
        } else if let boolValue = try? container.decode(Bool.self) {
            value = boolValue
        } else if let doubleValue = try? container.decode(Double.self) {
            value = doubleValue
        } else if let arrayValue = try? container.decode([AnyCodable].self) {
            value = arrayValue.map { $0.value }
        } else if let dictValue = try? container.decode([String: AnyCodable].self) {
            value = dictValue.mapValues { $0.value }
        } else {
            value = NSNull()
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()

        switch value {
        case let intValue as Int:
            try container.encode(intValue)
        case let stringValue as String:
            try container.encode(stringValue)
        case let boolValue as Bool:
            try container.encode(boolValue)
        case let doubleValue as Double:
            try container.encode(doubleValue)
        case let arrayValue as [Any]:
            try container.encode(arrayValue.map { AnyCodable($0) })
        case let dictValue as [String: Any]:
            try container.encode(dictValue.mapValues { AnyCodable($0) })
        case is NSNull:
            try container.encodeNil()
        default:
            try container.encodeNil()
        }
    }
}

/// 区块链RPC客户端
/// 支持以太坊及兼容链的JSON-RPC调用
class BlockchainRPCClient {
    private let session: URLSession
    private var requestIdCounter = 0
    private let requestIdLock = NSLock()

    // 请求缓存（减少重复请求）
    private var cache: [String: (data: Any, timestamp: Date)] = [:]
    private let cacheLock = NSLock()
    private let cacheExpiration: TimeInterval = 60 // 缓存60秒

    init(session: URLSession = .shared) {
        self.session = session
    }

    // MARK: - Core RPC Methods

    /// 通用RPC调用
    func call<T: Decodable>(
        rpcUrl: String,
        method: String,
        params: [Any] = [],
        cacheKey: String? = nil
    ) async throws -> T {
        // 检查缓存
        if let key = cacheKey, let cached = getCache(key: key) as? T {
            return cached
        }

        let requestId = getNextRequestId()
        let request = JSONRPCRequest(id: requestId, method: method, params: params)

        // 创建URL请求
        guard let url = URL(string: rpcUrl) else {
            throw RPCError.invalidURL
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // 编码请求体
        let encoder = JSONEncoder()
        urlRequest.httpBody = try encoder.encode(request)

        // 发送请求
        let (data, response) = try await session.data(for: urlRequest)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw RPCError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            throw RPCError.httpError(statusCode: httpResponse.statusCode)
        }

        // 解码响应
        let decoder = JSONDecoder()
        let rpcResponse = try decoder.decode(JSONRPCResponse<T>.self, from: data)

        if let error = rpcResponse.error {
            throw RPCError.rpcError(error)
        }

        guard let result = rpcResponse.result else {
            throw RPCError.noResult
        }

        // 缓存结果
        if let key = cacheKey {
            setCache(key: key, value: result)
        }

        return result
    }

    // MARK: - Ethereum RPC Methods

    /// 获取区块号
    func getBlockNumber(rpcUrl: String) async throws -> String {
        return try await call(
            rpcUrl: rpcUrl,
            method: "eth_blockNumber",
            params: []
        )
    }

    /// 获取账户余额
    func getBalance(rpcUrl: String, address: String, block: String = "latest") async throws -> String {
        return try await call(
            rpcUrl: rpcUrl,
            method: "eth_getBalance",
            params: [address, block],
            cacheKey: "balance_\(address)_\(block)"
        )
    }

    /// 获取交易数量（nonce）
    func getTransactionCount(rpcUrl: String, address: String, block: String = "latest") async throws -> String {
        return try await call(
            rpcUrl: rpcUrl,
            method: "eth_getTransactionCount",
            params: [address, block]
        )
    }

    /// 估算Gas
    func estimateGas(rpcUrl: String, transaction: [String: Any]) async throws -> String {
        return try await call(
            rpcUrl: rpcUrl,
            method: "eth_estimateGas",
            params: [transaction]
        )
    }

    /// 获取Gas价格
    func getGasPrice(rpcUrl: String) async throws -> String {
        return try await call(
            rpcUrl: rpcUrl,
            method: "eth_gasPrice",
            params: [],
            cacheKey: "gas_price"
        )
    }

    /// 发送原始交易
    func sendRawTransaction(rpcUrl: String, signedTransaction: String) async throws -> String {
        return try await call(
            rpcUrl: rpcUrl,
            method: "eth_sendRawTransaction",
            params: [signedTransaction]
        )
    }

    /// 获取交易回执
    func getTransactionReceipt(rpcUrl: String, txHash: String) async throws -> TransactionReceipt? {
        return try await call(
            rpcUrl: rpcUrl,
            method: "eth_getTransactionReceipt",
            params: [txHash]
        )
    }

    /// 获取交易详情
    func getTransactionByHash(rpcUrl: String, txHash: String) async throws -> TransactionDetails? {
        return try await call(
            rpcUrl: rpcUrl,
            method: "eth_getTransactionByHash",
            params: [txHash]
        )
    }

    /// 调用智能合约（不修改状态）
    func call(rpcUrl: String, transaction: [String: Any], block: String = "latest") async throws -> String {
        return try await call(
            rpcUrl: rpcUrl,
            method: "eth_call",
            params: [transaction, block]
        )
    }

    /// 获取链ID
    func getChainId(rpcUrl: String) async throws -> String {
        return try await call(
            rpcUrl: rpcUrl,
            method: "eth_chainId",
            params: [],
            cacheKey: "chain_id_\(rpcUrl)"
        )
    }

    /// 获取网络ID
    func getNetworkId(rpcUrl: String) async throws -> String {
        return try await call(
            rpcUrl: rpcUrl,
            method: "net_version",
            params: [],
            cacheKey: "network_id_\(rpcUrl)"
        )
    }

    // MARK: - ERC-20 Token Methods

    /// 获取ERC-20 Token余额
    func getTokenBalance(
        rpcUrl: String,
        tokenAddress: String,
        walletAddress: String
    ) async throws -> String {
        // balanceOf(address) 函数签名: 0x70a08231
        let data = "0x70a08231" + walletAddress.stripHexPrefix().padLeft(toLength: 64, withPad: "0")

        let transaction: [String: Any] = [
            "to": tokenAddress,
            "data": data
        ]

        return try await call(rpcUrl: rpcUrl, transaction: transaction)
    }

    /// 获取Token名称
    func getTokenName(rpcUrl: String, tokenAddress: String) async throws -> String {
        let data = "0x06fdde03" // name() 函数签名

        let transaction: [String: Any] = [
            "to": tokenAddress,
            "data": data
        ]

        let result: String = try await call(rpcUrl: rpcUrl, transaction: transaction)
        return try decodeString(from: result)
    }

    /// 获取Token符号
    func getTokenSymbol(rpcUrl: String, tokenAddress: String) async throws -> String {
        let data = "0x95d89b41" // symbol() 函数签名

        let transaction: [String: Any] = [
            "to": tokenAddress,
            "data": data
        ]

        let result: String = try await call(rpcUrl: rpcUrl, transaction: transaction)
        return try decodeString(from: result)
    }

    /// 获取Token小数位数
    func getTokenDecimals(rpcUrl: String, tokenAddress: String) async throws -> Int {
        let data = "0x313ce567" // decimals() 函数签名

        let transaction: [String: Any] = [
            "to": tokenAddress,
            "data": data
        ]

        let result: String = try await call(rpcUrl: rpcUrl, transaction: transaction)
        return try decodeUInt(from: result)
    }

    // MARK: - Helper Methods

    /// 获取下一个请求ID
    private func getNextRequestId() -> Int {
        requestIdLock.lock()
        defer { requestIdLock.unlock() }
        requestIdCounter += 1
        return requestIdCounter
    }

    /// 从缓存获取
    private func getCache(key: String) -> Any? {
        cacheLock.lock()
        defer { cacheLock.unlock() }

        guard let cached = cache[key] else { return nil }

        // 检查是否过期
        if Date().timeIntervalSince(cached.timestamp) > cacheExpiration {
            cache.removeValue(forKey: key)
            return nil
        }

        return cached.data
    }

    /// 设置缓存
    private func setCache(key: String, value: Any) {
        cacheLock.lock()
        defer { cacheLock.unlock() }

        cache[key] = (value, Date())
    }

    /// 清除缓存
    func clearCache() {
        cacheLock.lock()
        defer { cacheLock.unlock() }

        cache.removeAll()
    }

    /// 解码字符串（从ABI编码）
    private func decodeString(from hex: String) throws -> String {
        // 简化实现：跳过前64字节，读取字符串长度和内容
        let cleanHex = hex.stripHexPrefix()
        guard cleanHex.count >= 128 else {
            throw RPCError.invalidData
        }

        // 读取长度（第64-128字节）
        let lengthHex = String(cleanHex.dropFirst(64).prefix(64))
        guard let length = Int(lengthHex, radix: 16) else {
            throw RPCError.invalidData
        }

        // 读取内容
        let contentHex = String(cleanHex.dropFirst(128).prefix(length * 2))
        guard let data = Data(hex: contentHex),
              let string = String(data: data, encoding: .utf8) else {
            throw RPCError.invalidData
        }

        return string
    }

    /// 解码UInt
    private func decodeUInt(from hex: String) throws -> Int {
        let cleanHex = hex.stripHexPrefix()
        guard let value = Int(cleanHex, radix: 16) else {
            throw RPCError.invalidData
        }
        return value
    }
}

// MARK: - Response Models

/// 交易回执
struct TransactionReceipt: Codable {
    let transactionHash: String
    let blockNumber: String
    let blockHash: String
    let gasUsed: String
    let cumulativeGasUsed: String
    let status: String
    let from: String
    let to: String?
    let contractAddress: String?
}

/// 交易详情
struct TransactionDetails: Codable {
    let hash: String
    let nonce: String
    let blockHash: String?
    let blockNumber: String?
    let from: String
    let to: String?
    let value: String
    let gas: String
    let gasPrice: String
    let input: String
}

// MARK: - Errors

enum RPCError: LocalizedError {
    case invalidURL
    case invalidResponse
    case httpError(statusCode: Int)
    case rpcError(JSONRPCError)
    case noResult
    case invalidData

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "无效的RPC URL"
        case .invalidResponse:
            return "无效的响应"
        case .httpError(let code):
            return "HTTP错误: \(code)"
        case .rpcError(let error):
            return "RPC错误 [\(error.code)]: \(error.message)"
        case .noResult:
            return "响应无结果"
        case .invalidData:
            return "无效的数据格式"
        }
    }
}

// MARK: - String Extensions

extension String {
    func stripHexPrefix() -> String {
        hasPrefix("0x") ? String(dropFirst(2)) : self
    }

    func padLeft(toLength length: Int, withPad pad: String) -> String {
        let paddingLength = max(0, length - count)
        return String(repeating: pad, count: paddingLength) + self
    }
}

extension Data {
    init?(hex: String) {
        let cleanHex = hex.stripHexPrefix()
        guard cleanHex.count % 2 == 0 else { return nil }

        var data = Data(capacity: cleanHex.count / 2)

        var index = cleanHex.startIndex
        while index < cleanHex.endIndex {
            let nextIndex = cleanHex.index(index, offsetBy: 2)
            let byteString = cleanHex[index..<nextIndex]

            guard let byte = UInt8(byteString, radix: 16) else { return nil }
            data.append(byte)

            index = nextIndex
        }

        self = data
    }

    var hexString: String {
        map { String(format: "%02x", $0) }.joined()
    }
}
