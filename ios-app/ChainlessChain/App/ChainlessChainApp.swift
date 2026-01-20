import SwiftUI
import CoreCommon
import CoreSecurity
import CoreDatabase
import UserNotifications

@main
struct ChainlessChainApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var appState = AppState.shared
    @StateObject private var authViewModel = AuthViewModel()

    init() {
        setupApp()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(appState)
                .environmentObject(authViewModel)
                .onAppear {
                    handleAppLaunch()
                }
        }
    }

    // MARK: - Setup

    private func setupApp() {
        // 配置日志
        Logger.shared.configure(level: .debug)

        // 检查首次启动
        if UserDefaults.standard.bool(forKey: AppConstants.UserDefaults.isFirstLaunch) == false {
            UserDefaults.standard.set(true, forKey: AppConstants.UserDefaults.isFirstLaunch)
        }
    }

    private func handleAppLaunch() {
        Task {
            await appState.initialize()

            // Request notification permissions
            _ = await PushNotificationManager.shared.requestAuthorization()
        }
    }
}

// MARK: - App Delegate

class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Set notification center delegate
        UNUserNotificationCenter.current().delegate = PushNotificationManager.shared
        return true
    }

    // MARK: - Remote Notifications

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in
            PushNotificationManager.shared.didRegisterForRemoteNotifications(deviceToken: deviceToken)
        }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Task { @MainActor in
            PushNotificationManager.shared.didFailToRegisterForRemoteNotifications(error: error)
        }
    }
}
