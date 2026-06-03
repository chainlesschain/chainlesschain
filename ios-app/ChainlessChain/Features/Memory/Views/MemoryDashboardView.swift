import SwiftUI
import Combine

/// 记忆仪表板视图
public struct MemoryDashboardView: View {
    @StateObject private var viewModel = MemoryDashboardViewModel()
    @State private var selectedTab = 0
    @State private var searchQuery = ""
    @State private var showingAddNote = false

    public init() {}

    public var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // 搜索栏
                searchBar

                // 统计卡片
                statsCards

                // 标签页
                tabSelector

                // 内容区域
                tabContent
            }
            .navigationTitle("永久记忆")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Button(action: { showingAddNote = true }) {
                            Label("添加笔记", systemImage: "plus")
                        }
                        Button(action: { Task { await viewModel.refreshStats() } }) {
                            Label("刷新统计", systemImage: "arrow.clockwise")
                        }
                        Button(action: { Task { await viewModel.cleanupExpired() } }) {
                            Label("清理过期", systemImage: "trash")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .sheet(isPresented: $showingAddNote) {
                AddNoteView(viewModel: viewModel)
            }
            .task {
                await viewModel.initialize()
            }
        }
    }

    // MARK: - Search Bar

    private var searchBar: some View {
        HStack {
            Image(systemName: "magnifyingglass")
                .foregroundColor(.secondary)

            TextField("搜索记忆...", text: $searchQuery)
                .textFieldStyle(PlainTextFieldStyle())
                .onSubmit {
                    Task {
                        await viewModel.search(query: searchQuery)
                    }
                }

            if !searchQuery.isEmpty {
                Button(action: { searchQuery = "" }) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding(10)
        .background(Color(.systemGray6))
        .cornerRadius(10)
        .padding(.horizontal)
        .padding(.top, 8)
    }

    // MARK: - Stats Cards

    private var statsCards: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                StatCard(
                    title: "Daily Notes",
                    value: "\(viewModel.stats.dailyNotesCount)",
                    icon: "calendar",
                    color: .blue
                )

                StatCard(
                    title: "记忆章节",
                    value: "\(viewModel.stats.memorySectionsCount)",
                    icon: "folder",
                    color: .green
                )

                StatCard(
                    title: "总字数",
                    value: formatNumber(viewModel.stats.totalWordCount),
                    icon: "doc.text",
                    color: .orange
                )
            }
            .padding(.horizontal)
            .padding(.vertical, 12)
        }
    }

    // MARK: - Tab Selector

    private var tabSelector: some View {
        Picker("", selection: $selectedTab) {
            Text("Daily Notes").tag(0)
            Text("长期记忆").tag(1)
            Text("搜索结果").tag(2)
        }
        .pickerStyle(SegmentedPickerStyle())
        .padding(.horizontal)
        .padding(.bottom, 8)
    }

    // MARK: - Tab Content

    @ViewBuilder
    private var tabContent: some View {
        switch selectedTab {
        case 0:
            DailyNotesListView(viewModel: viewModel)
        case 1:
            LongTermMemoryView(viewModel: viewModel)
        case 2:
            SearchResultsView(viewModel: viewModel)
        default:
            EmptyView()
        }
    }

    // MARK: - Helpers

    private func formatNumber(_ number: Int) -> String {
        if number >= 1000 {
            return String(format: "%.1fK", Double(number) / 1000)
        }
        return "\(number)"
    }
}

// MARK: - Stat Card

private struct StatCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon)
                    .foregroundColor(color)
                Text(title)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Text(value)
                .font(.title2)
                .fontWeight(.bold)
        }
        .frame(width: 100)
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.05), radius: 5, x: 0, y: 2)
    }
}

// MARK: - Daily Notes List View

private struct DailyNotesListView: View {
    @ObservedObject var viewModel: MemoryDashboardViewModel

    var body: some View {
        List {
            if viewModel.dailyNotes.isEmpty {
                Text("暂无 Daily Notes")
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .listRowBackground(Color.clear)
            } else {
                ForEach(viewModel.dailyNotes) { note in
                    NavigationLink(destination: DailyNoteDetailView(note: note)) {
                        DailyNoteRow(note: note)
                    }
                }
            }
        }
        .listStyle(PlainListStyle())
        .refreshable {
            await viewModel.loadDailyNotes()
        }
    }
}

// MARK: - Daily Note Row

private struct DailyNoteRow: View {
    let note: DailyNote

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(note.date)
                .font(.headline)

            HStack(spacing: 12) {
                Label("\(note.metadata.conversationCount)", systemImage: "bubble.left")
                Label("\(note.metadata.completedTasks)", systemImage: "checkmark.circle")
                Label("\(note.metadata.wordCount)", systemImage: "character.cursor.ibeam")
            }
            .font(.caption)
            .foregroundColor(.secondary)

            Text(String(note.content.prefix(100)) + "...")
                .font(.caption)
                .foregroundColor(.secondary)
                .lineLimit(2)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Daily Note Detail View

private struct DailyNoteDetailView: View {
    let note: DailyNote

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // 元数据
                HStack(spacing: 16) {
                    Label("\(note.metadata.conversationCount) 对话", systemImage: "bubble.left")
                    Label("\(note.metadata.completedTasks) 完成", systemImage: "checkmark.circle")
                    Spacer()
                }
                .font(.subheadline)
                .foregroundColor(.secondary)

                Divider()

                // Markdown 内容
                Text(note.content)
                    .font(.body)
            }
            .padding()
        }
        .navigationTitle(note.date)
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Long Term Memory View

private struct LongTermMemoryView: View {
    @ObservedObject var viewModel: MemoryDashboardViewModel

    var body: some View {
        List {
            if viewModel.memorySections.isEmpty {
                Text("暂无记忆内容")
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .listRowBackground(Color.clear)
            } else {
                ForEach(viewModel.memorySections, id: \.title) { section in
                    NavigationLink(destination: MemorySectionDetailView(
                        section: section,
                        viewModel: viewModel
                    )) {
                        MemorySectionRow(section: section)
                    }
                }
            }
        }
        .listStyle(PlainListStyle())
        .refreshable {
            await viewModel.loadMemorySections()
        }
    }
}

// MARK: - Memory Section Row

private struct MemorySectionRow: View {
    let section: (title: String, itemCount: Int, hasContent: Bool)

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(section.title)
                    .font(.headline)

                Text("\(section.itemCount) 条记录")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            if section.hasContent {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(.green)
            } else {
                Image(systemName: "circle")
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Memory Section Detail View

private struct MemorySectionDetailView: View {
    let section: (title: String, itemCount: Int, hasContent: Bool)
    @ObservedObject var viewModel: MemoryDashboardViewModel
    @State private var sectionContent = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("\(section.itemCount) 条记录")
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                Divider()

                Text(sectionContent)
                    .font(.body)
            }
            .padding()
        }
        .navigationTitle(section.title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            sectionContent = await viewModel.getSectionContent(section.title)
        }
    }
}

// MARK: - Search Results View

private struct SearchResultsView: View {
    @ObservedObject var viewModel: MemoryDashboardViewModel

    var body: some View {
        List {
            if viewModel.searchResults.isEmpty {
                Text("无搜索结果")
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .listRowBackground(Color.clear)
            } else {
                ForEach(viewModel.searchResults) { result in
                    SearchResultRow(result: result)
                }
            }
        }
        .listStyle(PlainListStyle())
    }
}

// MARK: - Search Result Row

private struct SearchResultRow: View {
    let result: MemorySearchResult

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(sourceLabel)
                    .font(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(sourceColor.opacity(0.2))
                    .foregroundColor(sourceColor)
                    .cornerRadius(4)

                Spacer()

                Text(String(format: "%.0f%%", result.score * 100))
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            if let matchedText = result.matchedText {
                Text(matchedText)
                    .font(.body)
                    .lineLimit(3)
            }
        }
        .padding(.vertical, 4)
    }

    private var sourceLabel: String {
        switch result.source {
        case .dailyNote:
            return "Daily Note"
        case .longTermMemory:
            return "长期记忆"
        case .conversation:
            return "对话"
        }
    }

    private var sourceColor: Color {
        switch result.source {
        case .dailyNote:
            return .blue
        case .longTermMemory:
            return .green
        case .conversation:
            return .orange
        }
    }
}

// MARK: - Add Note View

private struct AddNoteView: View {
    @ObservedObject var viewModel: MemoryDashboardViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var noteContent = ""
    @State private var selectedType = 0
    @State private var selectedSection = MemorySection.discoveries
    @State private var isSaving = false

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("保存位置")) {
                    Picker("类型", selection: $selectedType) {
                        Text("Daily Note").tag(0)
                        Text("长期记忆").tag(1)
                    }
                    .pickerStyle(SegmentedPickerStyle())

                    if selectedType == 1 {
                        Picker("章节", selection: $selectedSection) {
                            ForEach(MemorySection.allCases, id: \.self) { section in
                                Text(section.title).tag(section)
                            }
                        }
                    }
                }

                Section(header: Text("内容")) {
                    TextEditor(text: $noteContent)
                        .frame(minHeight: 200)
                }
            }
            .navigationTitle("添加笔记")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        Task {
                            await saveNote()
                        }
                    }
                    .disabled(noteContent.isEmpty || isSaving)
                }
            }
        }
    }

    private func saveNote() async {
        isSaving = true

        do {
            if selectedType == 0 {
                try await viewModel.addDailyNote(noteContent)
            } else {
                try await viewModel.addToMemory(noteContent, section: selectedSection)
            }
            dismiss()
        } catch {
            // 处理错误
        }

        isSaving = false
    }
}

// MARK: - View Model

@MainActor
class MemoryDashboardViewModel: ObservableObject {
    @Published var stats = MemoryStats()
    @Published var dailyNotes: [DailyNote] = []
    @Published var memorySections: [(title: String, itemCount: Int, hasContent: Bool)] = []
    @Published var searchResults: [MemorySearchResult] = []
    @Published var isLoading = false
    @Published var error: Error?

    private let memoryManager = PermanentMemoryManager.shared
    private var cancellables = Set<AnyCancellable>()

    func initialize() async {
        isLoading = true

        do {
            try await memoryManager.initialize()
            await refreshStats()
            await loadDailyNotes()
            await loadMemorySections()
        } catch {
            self.error = error
        }

        isLoading = false
    }

    func refreshStats() async {
        stats = await memoryManager.getStats()
    }

    func loadDailyNotes() async {
        do {
            dailyNotes = try await memoryManager.getRecentDailyNotes(limit: 30)
        } catch {
            self.error = error
        }
    }

    func loadMemorySections() async {
        do {
            memorySections = try await memoryManager.getMemorySections()
        } catch {
            self.error = error
        }
    }

    func search(query: String) async {
        guard !query.isEmpty else {
            searchResults = []
            return
        }

        do {
            searchResults = try await memoryManager.searchMemory(query: query)
        } catch {
            self.error = error
        }
    }

    func addDailyNote(_ content: String) async throws {
        try await memoryManager.writeDailyNote(content, append: true)
        await loadDailyNotes()
        await refreshStats()
    }

    func addToMemory(_ content: String, section: MemorySection) async throws {
        let formattedContent = "### \(formatDate(Date()))\n\n\(content)"
        try await memoryManager.appendToMemory(formattedContent, section: section)
        await loadMemorySections()
        await refreshStats()
    }

    func getSectionContent(_ title: String) async -> String {
        do {
            let content = try await memoryManager.readMemory()

            // 提取指定章节的内容
            let pattern = "(## \(NSRegularExpression.escapedPattern(for: title))[\\s\\S]*?)(?=\\n## |$)"
            if let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
               let match = regex.firstMatch(in: content, range: NSRange(content.startIndex..., in: content)),
               let range = Range(match.range, in: content) {
                return String(content[range])
            }

            return "章节内容为空"
        } catch {
            return "加载失败: \(error.localizedDescription)"
        }
    }

    func cleanupExpired() async {
        await memoryManager.cleanupExpiredDailyNotes()
        await loadDailyNotes()
        await refreshStats()
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}

// MARK: - Preview

struct MemoryDashboardView_Previews: PreviewProvider {
    static var previews: some View {
        MemoryDashboardView()
    }
}
