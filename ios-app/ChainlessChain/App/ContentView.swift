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
    @State private var logoScale: CGFloat = 0.5
    @State private var logoOpacity: Double = 0
    @State private var titleOpacity: Double = 0
    @State private var progressOpacity: Double = 0
    @State private var rotationAngle: Double = 0

    var body: some View {
        ZStack {
            // 渐变背景
            LinearGradient(
                gradient: Gradient(colors: [
                    Color(red: 0/255, green: 84/255, blue: 145/255),  // #005491
                    Color(red: 0/255, green: 168/255, blue: 232/255)  // #00A8E8
                ]),
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 30) {
                // Logo 图标
                ZStack {
                    // 外圈光环效果
                    Circle()
                        .stroke(
                            LinearGradient(
                                gradient: Gradient(colors: [.white.opacity(0.3), .clear]),
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: 2
                        )
                        .frame(width: 140, height: 140)
                        .rotationEffect(.degrees(rotationAngle))

                    // Logo 图标 (如果存在 LaunchIcon,则使用;否则使用系统图标)
                    Group {
                        if let _ = UIImage(named: "LaunchIcon") {
                            Image("LaunchIcon")
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                                .frame(width: 100, height: 100)
                        } else {
                            // 后备方案:使用系统图标
                            ZStack {
                                Circle()
                                    .fill(
                                        LinearGradient(
                                            gradient: Gradient(colors: [
                                                .white.opacity(0.9),
                                                .white.opacity(0.7)
                                            ]),
                                            startPoint: .topLeading,
                                            endPoint: .bottomTrailing
                                        )
                                    )
                                    .frame(width: 100, height: 100)

                                Image(systemName: "link.circle.fill")
                                    .resizable()
                                    .frame(width: 80, height: 80)
                                    .foregroundColor(Color(red: 0/255, green: 84/255, blue: 145/255))
                            }
                        }
                    }
                    .scaleEffect(logoScale)
                    .opacity(logoOpacity)
                }

                // 应用名称
                VStack(spacing: 8) {
                    Text("ChainlessChain")
                        .font(.system(size: 32, weight: .bold, design: .rounded))
                        .foregroundColor(.white)

                    Text("知识·AI·项目 一体化管理")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.white.opacity(0.9))
                }
                .opacity(titleOpacity)

                // 加载进度
                VStack(spacing: 12) {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        .scaleEffect(1.2)

                    Text("正在初始化...")
                        .font(.system(size: 13))
                        .foregroundColor(.white.opacity(0.8))
                }
                .opacity(progressOpacity)
                .padding(.top, 20)
            }
            .padding(.horizontal, 40)

            // 底部版本信息
            VStack {
                Spacer()

                Text("v0.6.0")
                    .font(.system(size: 12))
                    .foregroundColor(.white.opacity(0.6))
                    .padding(.bottom, 30)
                    .opacity(titleOpacity)
            }
        }
        .onAppear {
            // 启动动画序列
            withAnimation(.spring(response: 0.8, dampingFraction: 0.6)) {
                logoScale = 1.0
                logoOpacity = 1.0
            }

            // 旋转动画
            withAnimation(.linear(duration: 3).repeatForever(autoreverses: false)) {
                rotationAngle = 360
            }

            // 延迟显示标题
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                withAnimation(.easeOut(duration: 0.6)) {
                    titleOpacity = 1.0
                }
            }

            // 延迟显示进度
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                withAnimation(.easeOut(duration: 0.6)) {
                    progressOpacity = 1.0
                }
            }
        }
    }
}

// MARK: - Main Tab View

struct MainTabView: View {
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            // 探索页
            ExploreView()
                .tabItem {
                    Label("探索", systemImage: selectedTab == 0 ? "sparkle" : "sparkle")
                }
                .tag(0)

            // 项目页
            ProjectListView()
                .tabItem {
                    Label("项目", systemImage: selectedTab == 1 ? "folder.fill" : "folder")
                }
                .tag(1)

            // 任务页
            TaskListView()
                .tabItem {
                    Label("任务", systemImage: selectedTab == 2 ? "checklist" : "checklist")
                }
                .tag(2)

            // 消息页
            ConversationListView()
                .tabItem {
                    Label("消息", systemImage: selectedTab == 3 ? "message.fill" : "message")
                }
                .tag(3)

            // 我的页
            ProfileView()
                .tabItem {
                    Label("我的", systemImage: selectedTab == 4 ? "person.fill" : "person")
                }
                .tag(4)
        }
        .accentColor(.blue)
    }
}

// MARK: - Explore View (探索页)

struct ExploreView: View {
    @StateObject private var viewModel = ExploreFeedViewModel()
    @State private var selectedKnowledge: KnowledgeItem?
    @State private var selectedConversation: AIConversationEntity?
    @State private var selectedProject: ProjectEntity?

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 16) {
                    // 统计概览
                    if !viewModel.cards.isEmpty {
                        ExploreStatsOverview(statistics: viewModel.statistics)
                    }

                    // 筛选和排序栏
                    filterSortBar

                    // 搜索栏
                    SearchBarView(searchText: $viewModel.searchText)
                        .padding(.horizontal)

                    // 内容区域
                    if viewModel.isLoading && viewModel.cards.isEmpty {
                        ProgressView("加载中...")
                            .frame(maxWidth: .infinity)
                            .padding(.top, 40)
                    } else if viewModel.cards.isEmpty {
                        ExploreEmptyView(filter: viewModel.selectedFilter)
                    } else {
                        contentList
                    }
                }
                .padding(.top, 8)
            }
            .navigationTitle("探索")
            .navigationBarTitleDisplayMode(.large)
            .refreshable {
                await viewModel.refresh()
            }
            .task {
                await viewModel.loadFeed()
            }
            .alert("错误", isPresented: .constant(viewModel.errorMessage != nil)) {
                Button("确定") {
                    viewModel.errorMessage = nil
                }
            } message: {
                Text(viewModel.errorMessage ?? "")
            }
            // Navigation links
            .background(navigationLinks)
        }
    }

    // MARK: - Filter and Sort Bar

    private var filterSortBar: some View {
        VStack(spacing: 12) {
            // 内容筛选器
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(ContentFilter.allCases, id: \.self) { filter in
                        FilterChip(
                            title: filter.rawValue,
                            icon: filter.icon,
                            isSelected: viewModel.selectedFilter == filter
                        ) {
                            withAnimation {
                                viewModel.selectedFilter = filter
                                viewModel.applyFiltersAndSort()
                            }
                        }
                    }
                }
                .padding(.horizontal)
            }

            // 排序选择器
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(SortOption.allCases, id: \.self) { option in
                        SortChip(
                            title: option.rawValue,
                            icon: option.icon,
                            isSelected: viewModel.selectedSort == option
                        ) {
                            withAnimation {
                                viewModel.selectedSort = option
                                viewModel.applyFiltersAndSort()
                            }
                        }
                    }
                }
                .padding(.horizontal)
            }
        }
    }

    // MARK: - Content List

    private var contentList: some View {
        LazyVStack(spacing: 12) {
            ForEach(viewModel.cards) { card in
                Button(action: {
                    handleCardTap(card)
                }) {
                    ExploreCardView(card: card)
                }
                .buttonStyle(PlainButtonStyle())
                .onAppear {
                    // Load more when reaching the last item
                    if card.id == viewModel.cards.last?.id {
                        viewModel.loadMore()
                    }
                }
            }

            if viewModel.isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding()
            }
        }
        .padding(.horizontal)
    }

    // MARK: - Navigation Links

    private var navigationLinks: some View {
        Group {
            // Knowledge navigation
            NavigationLink(
                destination: Group {
                    if let item = selectedKnowledge {
                        KnowledgeDetailView(
                            item: item,
                            onUpdate: { _ in
                                Task {
                                    await viewModel.refresh()
                                }
                            },
                            onDelete: {
                                selectedKnowledge = nil
                                Task {
                                    await viewModel.refresh()
                                }
                            }
                        )
                    }
                },
                tag: selectedKnowledge,
                selection: $selectedKnowledge
            ) { EmptyView() }

            // AI Conversation navigation
            NavigationLink(
                destination: Group {
                    if let conversation = selectedConversation {
                        AIChatView(conversation: conversation.toConversation())
                    }
                },
                tag: selectedConversation,
                selection: $selectedConversation
            ) { EmptyView() }

            // Project navigation
            NavigationLink(
                destination: Group {
                    if let project = selectedProject {
                        ProjectDetailView(project: project)
                    }
                },
                tag: selectedProject,
                selection: $selectedProject
            ) { EmptyView() }
        }
    }

    // MARK: - Actions

    private func handleCardTap(_ card: ExploreCardModel) {
        switch card.type {
        case .knowledge(let item):
            selectedKnowledge = item
        case .aiConversation(let conversation):
            selectedConversation = conversation
        case .project(let project):
            selectedProject = project
        }
    }
}

// MARK: - Filter Chip

private struct FilterChip: View {
    let title: String
    let icon: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 12))
                Text(title)
                    .font(.subheadline)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(isSelected ? Color.blue : Color(.systemGray6))
            .foregroundColor(isSelected ? .white : .primary)
            .cornerRadius(16)
        }
    }
}

// MARK: - Sort Chip

private struct SortChip: View {
    let title: String
    let icon: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 12))
                Text(title)
                    .font(.caption)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(isSelected ? Color.blue.opacity(0.2) : Color.clear)
            .foregroundColor(isSelected ? .blue : .secondary)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isSelected ? Color.blue : Color.gray.opacity(0.3), lineWidth: 1)
            )
            .cornerRadius(12)
        }
    }
}

// MARK: - Task List View (任务页)

struct TaskListView: View {
    var body: some View {
        NavigationView {
            ScrollView {
                LazyVStack(spacing: 12) {
                    ForEach(0..<10) { index in
                        TaskCardView(title: "任务 \(index + 1)",
                                   status: index % 3 == 0 ? "进行中" : "待完成")
                    }
                }
                .padding()
            }
            .navigationTitle("我的任务")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: {}) {
                        Image(systemName: "plus")
                    }
                }
            }
        }
    }
}

// MARK: - Profile View (我的页)

struct ProfileView: View {
    @EnvironmentObject var authViewModel: AuthViewModel

    var body: some View {
        NavigationView {
            List {
                // 用户信息区域
                Section {
                    HStack(spacing: 16) {
                        Image(systemName: "person.circle.fill")
                            .resizable()
                            .frame(width: 60, height: 60)
                            .foregroundColor(.blue)

                        VStack(alignment: .leading, spacing: 4) {
                            Text("用户名")
                                .font(.headline)
                            Text("user@example.com")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                        }

                        Spacer()
                    }
                    .padding(.vertical, 8)
                }

                // 功能菜单
                Section {
                    NavigationLink(destination: SettingsView()) {
                        Label("设置", systemImage: "gearshape")
                    }

                    NavigationLink(destination: Text("AI 对话")) {
                        Label("AI 对话", systemImage: "message")
                    }

                    NavigationLink(destination: Text("知识库")) {
                        Label("知识库", systemImage: "book")
                    }

                    NavigationLink(destination: Text("社交")) {
                        Label("社交", systemImage: "person.3")
                    }

                    NavigationLink(destination: ComputerUseView()) {
                        Label("浏览器自动化", systemImage: "desktopcomputer")
                    }
                }

                // 其他选项
                Section {
                    NavigationLink(destination: Text("关于")) {
                        Label("关于", systemImage: "info.circle")
                    }

                    NavigationLink(destination: Text("帮助")) {
                        Label("帮助", systemImage: "questionmark.circle")
                    }
                }

                // 退出登录
                Section {
                    Button(action: {
                        authViewModel.logout()
                    }) {
                        HStack {
                            Label("退出登录", systemImage: "arrow.right.square")
                            Spacer()
                        }
                        .foregroundColor(.red)
                    }
                }
            }
            .navigationTitle("我的")
            .navigationBarTitleDisplayMode(.large)
        }
    }
}

// MARK: - Supporting Views

struct SearchBarView: View {
    @Binding var searchText: String

    init(searchText: Binding<String>) {
        self._searchText = searchText
    }

    // Default initializer for backward compatibility
    init() {
        self._searchText = .constant("")
    }

    var body: some View {
        HStack {
            Image(systemName: "magnifyingglass")
                .foregroundColor(.secondary)

            TextField("搜索项目、任务...", text: $searchText)

            if !searchText.isEmpty {
                Button(action: { searchText = "" }) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding(10)
        .background(Color(.systemGray6))
        .cornerRadius(10)
    }
}

struct ExploreCardView: View {
    let title: String
    let description: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "folder.fill")
                    .foregroundColor(.blue)

                Text(title)
                    .font(.headline)

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Text(description)
                .font(.subheadline)
                .foregroundColor(.secondary)
                .lineLimit(2)

            HStack {
                Label("5 个任务", systemImage: "checklist")
                    .font(.caption)
                    .foregroundColor(.secondary)

                Spacer()

                Text("2天前")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: Color.black.opacity(0.05), radius: 5, x: 0, y: 2)
    }
}

struct TaskCardView: View {
    let title: String
    let status: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: status == "进行中" ? "circle.inset.filled" : "circle")
                .foregroundColor(status == "进行中" ? .blue : .secondary)

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.body)

                Text(status)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            Text("今天")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(10)
        .shadow(color: Color.black.opacity(0.05), radius: 3, x: 0, y: 1)
    }
}

#Preview {
    ContentView()
        .environmentObject(AppState.shared)
        .environmentObject(AuthViewModel())
}
