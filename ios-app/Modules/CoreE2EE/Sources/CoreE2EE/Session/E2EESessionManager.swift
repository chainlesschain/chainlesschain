import Foundation
import CoreCommon
import CoreSecurity
import CoreDID

/// E2EE 会话管理器
public class E2EESessionManager {
    public static let shared = E2EESessionManager()

    private var sessions: [String: E2EESession] = [:]
    private let logger = Logger.shared
    private let queue = DispatchQueue(label: "com.chainlesschain.e2ee", qos: .userInitiated)

    private init() {}

    // MARK: - Session Management

    /// 创建新会话
    public func createSession(with remoteDid: String, remotePublicKey: Data) throws -> E2EESession {
        return try queue.sync {
            // 检查是否已有会话
            if let existingSession = sessions[remoteDid] {
                return existingSession
            }

            // 创建新会话
            let session = try E2EESession(remoteDid: remoteDid, remotePublicKey: remotePublicKey)
            sessions[remoteDid] = session

            logger.info("Created E2EE session with: \(remoteDid)", category: "E2EE")

            return session
        }
    }

    /// 获取会话
    public func getSession(for remoteDid: String) -> E2EESession? {
        return queue.sync {
            return sessions[remoteDid]
        }
    }

    /// 删除会话
    public func deleteSession(for remoteDid: String) {
        queue.sync {
            sessions.removeValue(forKey: remoteDid)
            logger.info("Deleted E2EE session with: \(remoteDid)", category: "E2EE")
        }
    }

    /// 加密消息
    public func encrypt(message: String, for remoteDid: String) throws -> EncryptedMessage {
        guard let session = getSession(for: remoteDid) else {
            throw E2EEError.sessionNotFound
        }

        return try session.encrypt(message: message)
    }

    /// 解密消息
    public func decrypt(encryptedMessage: EncryptedMessage, from remoteDid: String) throws -> String {
        guard let session = getSession(for: remoteDid) else {
            throw E2EEError.sessionNotFound
        }

        return try session.decrypt(encryptedMessage: encryptedMessage)
    }

    /// 清除所有会话
    public func clearAllSessions() {
        queue.sync {
            sessions.removeAll()
            logger.info("Cleared all E2EE sessions", category: "E2EE")
        }
    }
}

// MARK: - E2EE Session

public class E2EESession {
    public let id: String
    public let remoteDid: String
    public let remotePublicKey: Data
    public let createdAt: Date

    private var sendingChainKey: Data
    private var receivingChainKey: Data
    private var messageIndex: UInt32 = 0

    private let crypto = CryptoManager.shared

    public init(remoteDid: String, remotePublicKey: Data) throws {
        self.id = UUID().uuidString
        self.remoteDid = remoteDid
        self.remotePublicKey = remotePublicKey
        self.createdAt = Date()

        // 初始化链密钥（简化实现）
        // 实际应使用 X3DH 密钥交换生成共享密钥
        let sharedSecret = try crypto.generateRandomBytes(count: 32)
        self.sendingChainKey = crypto.sha256(sharedSecret + "sending".data(using: .utf8)!)
        self.receivingChainKey = crypto.sha256(sharedSecret + "receiving".data(using: .utf8)!)
    }

    /// 加密消息
    public func encrypt(message: String) throws -> EncryptedMessage {
        guard let messageData = message.data(using: .utf8) else {
            throw E2EEError.invalidMessage
        }

        // 派生消息密钥
        let messageKey = deriveMessageKey(from: sendingChainKey, index: messageIndex)

        // 加密消息
        let encrypted = try crypto.encryptAES(messageData, key: messageKey)

        // 更新链密钥
        sendingChainKey = crypto.sha256(sendingChainKey)
        messageIndex += 1

        return EncryptedMessage(
            ciphertext: encrypted.ciphertext.base64EncodedString(),
            iv: encrypted.iv.base64EncodedString(),
            messageIndex: messageIndex - 1,
            senderDid: "", // Will be set by caller
            timestamp: Date().timestampMs
        )
    }

    /// 解密消息
    public func decrypt(encryptedMessage: EncryptedMessage) throws -> String {
        guard let ciphertext = Data(base64Encoded: encryptedMessage.ciphertext),
              let iv = Data(base64Encoded: encryptedMessage.iv) else {
            throw E2EEError.invalidMessage
        }

        // 派生消息密钥
        let messageKey = deriveMessageKey(from: receivingChainKey, index: encryptedMessage.messageIndex)

        // 解密消息
        let encryptedData = EncryptedData(ciphertext: ciphertext, iv: iv)
        let decrypted = try crypto.decryptAES(encryptedData, key: messageKey)

        // 更新链密钥
        receivingChainKey = crypto.sha256(receivingChainKey)

        guard let message = String(data: decrypted, encoding: .utf8) else {
            throw E2EEError.decryptionFailed
        }

        return message
    }

    /// 派生消息密钥
    private func deriveMessageKey(from chainKey: Data, index: UInt32) -> Data {
        var indexData = Data()
        withUnsafeBytes(of: index.bigEndian) { indexData.append(contentsOf: $0) }
        return crypto.sha256(chainKey + indexData)
    }
}

// MARK: - Encrypted Message

public struct EncryptedMessage: Codable {
    public let ciphertext: String
    public let iv: String
    public let messageIndex: UInt32
    public var senderDid: String
    public let timestamp: Int64

    public init(ciphertext: String, iv: String, messageIndex: UInt32, senderDid: String, timestamp: Int64) {
        self.ciphertext = ciphertext
        self.iv = iv
        self.messageIndex = messageIndex
        self.senderDid = senderDid
        self.timestamp = timestamp
    }
}

// MARK: - E2EE Error

public enum E2EEError: Error, LocalizedError {
    case sessionNotFound
    case invalidMessage
    case encryptionFailed
    case decryptionFailed
    case keyExchangeFailed

    public var errorDescription: String? {
        switch self {
        case .sessionNotFound:
            return "E2EE session not found"
        case .invalidMessage:
            return "Invalid message format"
        case .encryptionFailed:
            return "Message encryption failed"
        case .decryptionFailed:
            return "Message decryption failed"
        case .keyExchangeFailed:
            return "Key exchange failed"
        }
    }
}
