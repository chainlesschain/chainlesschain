import Foundation
import SwiftUI
import CoreCommon
import CoreDatabase
import CoreSecurity

/// 全局应用状态管理
@MainActor
class AppState: ObservableObject {
    static let shared = AppState()

    @Published var isAuthenticated = false
    @Published var isInitialized = false
    @Published var currentDID: String?
    @Published var isDatabaseUnlocked = false

    private let logger = Logger.shared
    private var notificationObservers: [NSObjectProtocol] = []

    private init() {
        setupNotificationObservers()
    }

    // MARK: - Initialization

    func initialize() async {
        logger.info("Initializing app state", category: "AppState")

        // 检查数据库是否存在
        let dbExists = DatabaseManager.shared.databaseExists()

        if dbExists {
            // 尝试从 UserDefaults 恢复状态
            currentDID = UserDefaults.standard.string(forKey: AppConstants.UserDefaults.currentDID)
        }

        isInitialized = true
        logger.info("App state initialized (DB exists: \(dbExists))", category: "AppState")
    }

    // MARK: - Authentication

    func authenticate(pin: String) async throws {
        logger.info("Authenticating user", category: "AppState")

        // 打开数据库
        try DatabaseManager.shared.open(password: pin)
        isDatabaseUnlocked = true

        // 加载当前 DID
        if currentDID == nil {
            currentDID = try await loadPrimaryDID()
        }

        isAuthenticated = true
        logger.info("User authenticated successfully", category: "AppState")
    }

    func logout() {
        logger.info("Logging out user", category: "AppState")

        // 关闭数据库
        DatabaseManager.shared.close()

        isAuthenticated = false
        isDatabaseUnlocked = false
        currentDID = nil

        NotificationCenter.default.post(name: AppConstants.Notification.didLogout, object: nil)
        logger.info("User logged out", category: "AppState")
    }

    // MARK: - DID Management

    private func loadPrimaryDID() async throws -> String? {
        let sql = "SELECT did FROM did_identities WHERE is_primary = 1 LIMIT 1;"

        let result: String? = try DatabaseManager.shared.queryOne(sql) { stmt in
            return String(cString: sqlite3_column_text(stmt, 0))
        }

        if let did = result {
            UserDefaults.standard.set(did, forKey: AppConstants.UserDefaults.currentDID)
        }

        return result
    }

    // MARK: - Notification Observers

    private func setupNotificationObservers() {
        let databaseUnlockedObserver = NotificationCenter.default.addObserver(
            forName: AppConstants.Notification.databaseUnlocked,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.isDatabaseUnlocked = true
        }
        notificationObservers.append(databaseUnlockedObserver)

        let authenticatedObserver = NotificationCenter.default.addObserver(
            forName: AppConstants.Notification.didAuthenticated,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.isAuthenticated = true
        }
        notificationObservers.append(authenticatedObserver)
    }

    deinit {
        notificationObservers.forEach { observer in
            NotificationCenter.default.removeObserver(observer)
        }
    }
}
