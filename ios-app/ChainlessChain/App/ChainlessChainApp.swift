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
    @StateObject private var pairingDeps: PairingDependencies
    // Phase 2.4 — 远程终端 deps，依赖同一份 pairingDeps 实例
    @StateObject private var remoteDeps: RemoteDependencies

    init() {
        // Initialize @StateObject backing storage BEFORE calling any instance
        // method (Swift requires all stored properties initialized before
        // `self` is fully formed). setupApp() now uses no instance state, so
        // it can run after property init. @StateObject wrappedValue closure
        // executes on first view creation; synchronous init here ensures
        // remoteDeps shares the SAME pairingDeps instance (avoid two
        // SignalClient + two WS connections).
        let deps = PairingDependencies(currentDIDProvider: { AppState.shared.currentDID })
        _pairingDeps = StateObject(wrappedValue: deps)
        _remoteDeps = StateObject(wrappedValue: RemoteDependencies(pairingDeps: deps))

        setupApp()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(appState)
                .environmentObject(authViewModel)
                .environmentObject(pairingDeps)
                .environmentObject(remoteDeps)
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
