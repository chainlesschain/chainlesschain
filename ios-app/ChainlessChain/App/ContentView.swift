import SwiftUI

struct ContentView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var authViewModel: AuthViewModel

    var body: some View {
        Group {
            if !appState.isInitialized {
                // 启动加载界面
                SplashView()
            } else if !appState.isAuthenticated {
                // 认证界面
                AuthView()
            } else {
                // 主界面
                MainTabView()
            }
        }
        .animation(.easeInOut, value: appState.isAuthenticated)
    }
}

// MARK: - Splash View

struct SplashView: View {
    var body: some View {
        ZStack {
            Color.blue.opacity(0.1)
                .ignoresSafeArea()

            VStack(spacing: 20) {
                Image(systemName: "link.circle.fill")
                    .resizable()
                    .frame(width: 100, height: 100)
                    .foregroundColor(.blue)

                Text("ChainlessChain")
                    .font(.largeTitle)
                    .fontWeight(.bold)

                ProgressView()
                    .scaleEffect(1.5)
            }
        }
    }
}

// MARK: - Main Tab View

struct MainTabView: View {
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            KnowledgeListView()
                .tabItem {
                    Label("知识库", systemImage: "book.fill")
                }
                .tag(0)

            AIConversationListView()
                .tabItem {
                    Label("AI 对话", systemImage: "message.fill")
                }
                .tag(1)

            ConversationListView()
                .tabItem {
                    Label("消息", systemImage: "bubble.left.and.bubble.right.fill")
                }
                .tag(2)

            SocialFeedView()
                .tabItem {
                    Label("社交", systemImage: "person.3.fill")
                }
                .tag(3)

            SettingsView()
                .tabItem {
                    Label("设置", systemImage: "gearshape.fill")
                }
                .tag(4)
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(AppState.shared)
        .environmentObject(AuthViewModel())
}
