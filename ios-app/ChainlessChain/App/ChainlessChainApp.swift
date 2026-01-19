import SwiftUI
import CoreCommon
import CoreSecurity
import CoreDatabase

@main
struct ChainlessChainApp: App {
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
        }
    }
}
