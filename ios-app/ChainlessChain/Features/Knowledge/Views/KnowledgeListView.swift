import SwiftUI

struct KnowledgeListView: View {
    @StateObject private var viewModel = KnowledgeViewModel()
    @State private var showingAddSheet = false
    @State private var selectedItem: KnowledgeItem?
    @State private var showingFilterSheet = false

    var body: some View {
        NavigationView {
            ZStack {
                if viewModel.isLoading && viewModel.items.isEmpty {
                    ProgressView("加载中...")
                } else if viewModel.filteredItems.isEmpty {
                    emptyView
                } else {
                    listView
                }
            }
            .navigationTitle("知识库")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(action: { showingFilterSheet = true }) {
                        Image(systemName: "line.3.horizontal.decrease.circle")
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showingAddSheet = true }) {
                        Image(systemName: "plus")
                    }
                }
            }
            .searchable(text: $viewModel.searchText, prompt: "搜索知识库")
            .onChange(of: viewModel.searchText) { oldValue, newValue in
                viewModel.applyFilters()
            }
            .refreshable {
                await viewModel.refresh()
            }
            .sheet(isPresented: $showingAddSheet) {
                KnowledgeEditView(mode: .create) { item in
                    Task {
                        try await viewModel.create(
                            title: item.title,
                            content: item.content,
                            contentType: item.contentType,
                            tags: item.tags,
                            category: item.category
                        )
                    }
                }
            }
            .sheet(item: $selectedItem) { item in
                KnowledgeDetailView(item: item) { updatedItem in
                    Task {
                        try await viewModel.update(updatedItem)
                    }
                } onDelete: {
                    Task {
                        try await viewModel.delete(id: item.id)
                    }
                }
            }
            .sheet(isPresented: $showingFilterSheet) {
                KnowledgeFilterView(viewModel: viewModel)
            }
            .alert("错误", isPresented: .constant(viewModel.errorMessage != nil)) {
                Button("确定") {
                    viewModel.errorMessage = nil
                }
            } message: {
                if let error = viewModel.errorMessage {
                    Text(error)
                }
            }
        }
    }

    // MARK: - List View

    private var listView: some View {
        List {
            // 统计信息
            if let stats = viewModel.statistics {
                Section {
                    HStack {
                        StatCard(title: "总计", value: "\(stats.totalItems)", icon: "doc.text.fill", color: .blue)
                        StatCard(title: "收藏", value: "\(stats.favoriteItems)", icon: "star.fill", color: .yellow)
                        StatCard(title: "分类", value: "\(stats.categoryCount)", icon: "folder.fill", color: .green)
                    }
                }
            }

            // 知识库列表
            Section {
                ForEach(viewModel.filteredItems) { item in
                    KnowledgeItemRow(item: item)
                        .contentShape(Rectangle())
                        .onTapGesture {
                            selectedItem = item
                            Task {
                                await viewModel.incrementViewCount(id: item.id)
                            }
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                Task {
                                    try await viewModel.delete(id: item.id)
                                }
                            } label: {
                                Label("删除", systemImage: "trash")
                            }

                            Button {
                                Task {
                                    try await viewModel.toggleFavorite(id: item.id)
                                }
                            } label: {
                                Label(
                                    item.isFavorite ? "取消收藏" : "收藏",
                                    systemImage: item.isFavorite ? "star.slash" : "star"
                                )
                            }
                            .tint(.yellow)
                        }
                }
            }
        }
    }

    // MARK: - Empty View

    private var emptyView: some View {
        VStack(spacing: 20) {
            Image(systemName: "book.closed")
                .resizable()
                .frame(width: 80, height: 80)
                .foregroundColor(.gray)

            Text("暂无知识库条目")
                .font(.headline)
                .foregroundColor(.gray)

            Text("点击右上角 + 按钮添加")
                .font(.subheadline)
                .foregroundColor(.gray)

            Button(action: { showingAddSheet = true }) {
                Text("添加第一条")
                    .font(.headline)
                    .foregroundColor(.white)
                    .padding()
                    .background(Color.blue)
                    .cornerRadius(12)
            }
        }
    }
}

// MARK: - Knowledge Item Row

struct KnowledgeItemRow: View {
    let item: KnowledgeItem

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(item.title)
                    .font(.headline)
                    .lineLimit(1)

                Spacer()

                if item.isFavorite {
                    Image(systemName: "star.fill")
                        .foregroundColor(.yellow)
                        .font(.caption)
                }
            }

            Text(item.content)
                .font(.subheadline)
                .foregroundColor(.gray)
                .lineLimit(2)

            HStack {
                // 分类
                if let category = item.category {
                    Label(category, systemImage: "folder")
                        .font(.caption)
                        .foregroundColor(.blue)
                }

                // 标签
                ForEach(item.tags.prefix(3), id: \.self) { tag in
                    Text("#\(tag)")
                        .font(.caption)
                        .foregroundColor(.green)
                }

                Spacer()

                // 查看次数
                Label("\(item.viewCount)", systemImage: "eye")
                    .font(.caption)
                    .foregroundColor(.gray)

                // 更新时间
                Text(item.updatedAt, style: .relative)
                    .font(.caption)
                    .foregroundColor(.gray)
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Stat Card

struct StatCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundColor(color)

            Text(value)
                .font(.title3)
                .fontWeight(.bold)

            Text(title)
                .font(.caption)
                .foregroundColor(.gray)
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(color.opacity(0.1))
        .cornerRadius(12)
    }
}

// MARK: - Filter View

struct KnowledgeFilterView: View {
    @ObservedObject var viewModel: KnowledgeViewModel
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationView {
            Form {
                Section("搜索选项") {
                    Toggle("语义搜索", isOn: $viewModel.useSemanticSearch)
                        .onChange(of: viewModel.useSemanticSearch) { _, _ in
                            viewModel.applyFilters()
                        }

                    if viewModel.useSemanticSearch {
                        HStack {
                            Image(systemName: "info.circle")
                                .foregroundColor(.blue)
                            Text("使用 AI 理解搜索意图，查找语义相关内容")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                }

                Section("过滤选项") {
                    Toggle("仅显示收藏", isOn: $viewModel.showFavoritesOnly)
                        .onChange(of: viewModel.showFavoritesOnly) { _, _ in
                            viewModel.applyFilters()
                        }
                }

                Section("分类") {
                    Picker("选择分类", selection: $viewModel.selectedCategory) {
                        Text("全部").tag(nil as String?)
                        ForEach(viewModel.categories, id: \.self) { category in
                            Text(category).tag(category as String?)
                        }
                    }
                    .onChange(of: viewModel.selectedCategory) { _, _ in
                        viewModel.applyFilters()
                    }
                }

                Section("标签") {
                    Picker("选择标签", selection: $viewModel.selectedTag) {
                        Text("全部").tag(nil as String?)
                        ForEach(viewModel.tags, id: \.self) { tag in
                            Text(tag).tag(tag as String?)
                        }
                    }
                    .onChange(of: viewModel.selectedTag) { _, _ in
                        viewModel.applyFilters()
                    }
                }

                Section {
                    Button("清除所有过滤") {
                        viewModel.clearFilters()
                        dismiss()
                    }
                }
            }
            .navigationTitle("过滤")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") {
                        dismiss()
                    }
                }
            }
        }
    }
}

#Preview {
    KnowledgeListView()
}
