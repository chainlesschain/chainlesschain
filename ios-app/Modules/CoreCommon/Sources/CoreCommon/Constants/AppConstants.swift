import Foundation

/// 应用常量
public enum AppConstants {
    /// 应用信息
    public enum App {
        public static let name = "ChainlessChain"
        public static let bundleId = "com.chainlesschain.ios"
        public static let version = "0.32.0"
        public static let buildNumber = "32"
    }

    /// API 端点
    public enum API {
        public static let baseURL = "https://api.chainlesschain.com"
        public static let signalingURL = "wss://signal.chainlesschain.com"
        public static let timeout: TimeInterval = 30
    }

    /// 数据库配置
    public enum Database {
        public static let name = "chainlesschain.db"
        public static let version = 2
        public static let encryptionKeySize = 32 // 256 bits
        public static let pbkdf2Iterations = 256_000
    }

    /// 加密配置
    public enum Crypto {
        public static let aesKeySize = 32 // 256 bits
        public static let aesIVSize = 16 // 128 bits
        public static let saltSize = 32
        public static let pbkdf2Iterations = 256_000
    }

    /// DID 配置
    public enum DID {
        public static let method = "key"
        public static let keyType = "Ed25519"
        public static let prefix = "did:key:"
    }

    /// P2P 配置
    public enum P2P {
        public static let stunServers = [
            "stun:stun.l.google.com:19302",
            "stun:stun1.l.google.com:19302"
        ]
        public static let turnServer = "turn:turn.chainlesschain.com:3478"
        public static let turnUsername = "chainlesschain"
        public static let turnCredential = "changeme"
        public static let connectionTimeout: TimeInterval = 30
        public static let reconnectDelay: TimeInterval = 5
        public static let maxReconnectAttempts = 5
    }

    /// 同步配置
    public enum Sync {
        public static let interval: TimeInterval = 60 // 60 秒
        public static let batchSize = 100
        public static let maxRetries = 3
    }

    /// UI 配置
    public enum UI {
        public static let animationDuration: TimeInterval = 0.3
        public static let pageSize = 20
        public static let maxImageSize: Int64 = 10 * 1024 * 1024 // 10MB
    }

    /// Keychain 配置
    public enum Keychain {
        public static let service = "com.chainlesschain.ios"
        public static let pinKey = "user.pin"
        public static let dbKeyKey = "database.key"
        public static let didPrivateKeyPrefix = "did.privatekey."
        public static let masterKeyKey = "master.key"
    }

    /// 通知名称
    public enum Notification {
        public static let didAuthenticated = NSNotification.Name("didAuthenticated")
        public static let didLogout = NSNotification.Name("didLogout")
        public static let databaseUnlocked = NSNotification.Name("databaseUnlocked")
        public static let syncCompleted = NSNotification.Name("syncCompleted")
        public static let p2pConnected = NSNotification.Name("p2pConnected")
        public static let p2pDisconnected = NSNotification.Name("p2pDisconnected")
        public static let newMessage = NSNotification.Name("newMessage")
    }

    /// 用户默认值键
    public enum UserDefaults {
        public static let isFirstLaunch = "isFirstLaunch"
        public static let currentDID = "currentDID"
        public static let lastSyncTime = "lastSyncTime"
        public static let biometricEnabled = "biometricEnabled"
        public static let autoSyncEnabled = "autoSyncEnabled"
    }
}
