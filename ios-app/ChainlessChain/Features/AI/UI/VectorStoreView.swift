import SwiftUI
import Combine

/// 向量存储视图
public struct VectorStoreView: View {
    @StateObject private var viewModel = VectorStoreViewModel()
    @State private var showingAddVector = false
    @State private var searchQuery = ""

    public init() {}

    public var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // 搜索栏
                SearchBar(text: $searchQuery, onSearch: { query in
                    Task {
                        await viewModel.performSearch(query: query)
                    }
                })
                .padding()

                // 统计卡片
                VectorStoreStatsCard(
                    totalVectors: viewModel.totalVectors,
                    stores: viewModel.storeCount,
                    dimensions: viewModel.dimensions
                )
                .padding(.horizontal)

                // 向量列表或搜索结果
                List {
                    if viewModel.isSearching {
                        // 搜索结果
                        Section(header: Text("搜索结果 (\(viewModel.searchResults.count))")) {
                            ForEach(viewModel.searchResults) { result in
                                SearchResultRow(result: result)
                            }
                        }
                    } else {
                        // 按存储分组显示
                        ForEach(viewModel.storeNames, id: \.self) { storeName in
                            Section(header: HStack {
                                Text(storeName)
                                Spacer()
                                Text("\(viewModel.vectorCount(for: storeName)) 个向量")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }) {
                                ForEach(viewModel.vectors(for: storeName)) { vector in
                                    VectorRow(vector: vector, onDelete: {
                                        Task {
                                            await viewModel.deleteVector(id: vector.id, store: storeName)
                                        }
                                    })
                                }
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
            }
            .navigationTitle("向量存储")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(action: { viewModel.refresh() }) {
                        Image(systemName: "arrow.clockwise")
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showingAddVector = true }) {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingAddVector) {
                AddVectorView(onAdd: { text, metadata, storeName in
                    Task {
                        await viewModel.addVector(text: text, metadata: metadata, store: storeName)
                        showingAddVector = false
                    }
                })
            }
            .onAppear {
                viewModel.loadData()
            }
        }
    }
}

// MARK: - 搜索栏

struct SearchBar: View {
    @Binding var text: String
    let onSearch: (String) -> Void

    var body: some View {
        HStack {
            Image(systemName: "magnifyingglass")
                .foregroundColor(.secondary)

            TextField("语义搜索...", text: $text, onCommit: {
                if !text.isEmpty {
                    onSearch(text)
                }
            })
            .textFieldStyle(.plain)

            if !text.isEmpty {
                Button(action: {
                    text = ""
                }) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.secondary)
                }
            }

            Button(action: {
                if !text.isEmpty {
                    onSearch(text)
                }
            }) {
                Text("搜索")
                    .fontWeight(.medium)
            }
            .buttonStyle(.borderedProminent)
            .disabled(text.isEmpty)
        }
        .padding(12)
        .background(Color(.systemGray6))
        .cornerRadius(10)
    }
}

// MARK: - 统计卡片

struct VectorStoreStatsCard: View {
    let totalVectors: Int
    let stores: Int
    let dimensions: Int

    var body: some View {
        HStack(spacing: 20) {
            VectorStatItem(title: "向量数", value: "\(totalVectors)", icon: "cube.fill", color: .blue)
            VectorStatItem(title: "存储", value: "\(stores)", icon: "archivebox.fill", color: .green)
            VectorStatItem(title: "维度", value: "\(dimensions)", icon: "chart.bar.fill", color: .orange)
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
}

struct VectorStatItem: View {
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
                .font(.title2)
                .fontWeight(.bold)

            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - 向量行

struct VectorRow: View {
    let vector: VectorDisplayInfo
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // ID和删除按钮
            HStack {
                Text(vector.displayId)
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundColor(.secondary)

                Spacer()

                Button(action: onDelete) {
                    Image(systemName: "trash")
                        .foregroundColor(.red)
                        .font(.caption)
                }
            }

            // 元数据
            if !vector.metadata.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(vector.metadata.keys.sorted().prefix(3)), id: \.self) { key in
                        HStack {
                            Text(key)
                                .font(.caption2)
                                .foregroundColor(.blue)
                            Text(": \(vector.metadata[key] ?? "")")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                                .lineLimit(1)
                        }
                    }

                    if vector.metadata.count > 3 {
                        Text("+ \(vector.metadata.count - 3) 更多")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }
            }

            // 向量维度信息
            Text("维度: \(vector.dimensions)")
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - 搜索结果行

struct SearchResultRow: View {
    let result: SearchResultDisplayInfo

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(result.displayId)
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundColor(.secondary)

                Spacer()

                // 相似度分数
                HStack(spacing: 4) {
                    Image(systemName: "star.fill")
                        .foregroundColor(.yellow)
                        .font(.caption2)
                    Text(String(format: "%.3f", result.score))
                        .font(.caption)
                        .fontWeight(.medium)
                }
            }

            // 元数据摘要
            if let content = result.metadata["content"] {
                Text(content)
                    .font(.caption)
                    .foregroundColor(.primary)
                    .lineLimit(2)
            }

            // 相似度可视化
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Rectangle()
                        .fill(Color.gray.opacity(0.2))
                        .frame(height: 4)

                    Rectangle()
                        .fill(similarityColor(result.score))
                        .frame(width: geometry.size.width * CGFloat(result.score), height: 4)
                }
            }
            .frame(height: 4)
        }
        .padding(.vertical, 4)
    }

    private func similarityColor(_ score: Float) -> Color {
        if score > 0.8 {
            return .green
        } else if score > 0.6 {
            return .orange
        } else {
            return .red
        }
    }
}

// MARK: - 添加向量视图

struct AddVectorView: View {
    @Environment(\.dismiss) var dismiss
    @State private var text = ""
    @State private var metadataKey = ""
    @State private var metadataValue = ""
    @State private var metadata: [String: String] = [:]
    @State private var selectedStore = "default"

    let onAdd: (String, [String: String], String) -> Void

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("文本内容")) {
                    TextEditor(text: $text)
                        .frame(minHeight: 100)
                }

                Section(header: Text("元数据")) {
                    HStack {
                        TextField("键", text: $metadataKey)
                        TextField("值", text: $metadataValue)
                        Button(action: addMetadata) {
                            Image(systemName: "plus.circle.fill")
                        }
                        .disabled(metadataKey.isEmpty || metadataValue.isEmpty)
                    }

                    ForEach(Array(metadata.keys), id: \.self) { key in
                        HStack {
                            Text(key)
                                .fontWeight(.medium)
                            Text(": \(metadata[key] ?? "")")
                                .foregroundColor(.secondary)
                            Spacer()
                            Button(action: {
                                metadata.removeValue(forKey: key)
                            }) {
                                Image(systemName: "trash")
                                    .foregroundColor(.red)
                            }
                        }
                    }
                }

                Section(header: Text("存储位置")) {
                    Picker("存储", selection: $selectedStore) {
                        Text("默认存储").tag("default")
                        Text("知识库").tag("knowledge")
                        Text("文档").tag("documents")
                    }
                }
            }
            .navigationTitle("添加向量")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("添加") {
                        onAdd(text, metadata, selectedStore)
                    }
                    .disabled(text.isEmpty)
                }
            }
        }
    }

    private func addMetadata() {
        guard !metadataKey.isEmpty, !metadataValue.isEmpty else { return }
        metadata[metadataKey] = metadataValue
        metadataKey = ""
        metadataValue = ""
    }
}

// MARK: - ViewModel

class VectorStoreViewModel: ObservableObject {
    @Published var storeNames: [String] = []
    @Published var vectorsByStore: [String: [VectorDisplayInfo]] = [:]
    @Published var searchResults: [SearchResultDisplayInfo] = []
    @Published var isSearching = false

    @Published var totalVectors: Int = 0
    @Published var storeCount: Int = 0
    @Published var dimensions: Int = 384  // 默认维度

    func loadData() {
        Task {
            await refreshStores()
        }
    }

    func refresh() {
        loadData()
    }

    @MainActor
    private func refreshStores() async {
        // 获取所有存储名称
        storeNames = ["default", "knowledge", "documents"]  // TODO: 从VectorStoreManager获取
        storeCount = storeNames.count

        // 加载每个存储的向量
        var totalCount = 0
        for storeName in storeNames {
            let store = VectorStoreManager.shared.getStore(name: storeName)

            do {
                let count = try await store.count()
                totalCount += count

                // TODO: 实际实现需要VectorStore协议支持列表操作
                // 这里使用模拟数据
                vectorsByStore[storeName] = []
            } catch {
                Logger.shared.error("加载存储\(storeName)失败: \(error)")
            }
        }

        totalVectors = totalCount
        isSearching = false
    }

    func vectors(for store: String) -> [VectorDisplayInfo] {
        return vectorsByStore[store] ?? []
    }

    func vectorCount(for store: String) -> Int {
        return vectors(for: store).count
    }

    func performSearch(query: String) async {
        isSearching = true

        do {
            // 生成查询向量（需要embedding模型）
            let queryVector = try await generateEmbedding(text: query)

            var allResults: [SearchResultDisplayInfo] = []

            // 在所有存储中搜索
            for storeName in storeNames {
                let store = VectorStoreManager.shared.getStore(name: storeName)
                let results = try await store.search(query: queryVector, topK: 10, threshold: 0.5)

                let displayResults = results.map { result in
                    SearchResultDisplayInfo(
                        id: result.id,
                        score: result.score,
                        metadata: result.metadata,
                        storeName: storeName
                    )
                }

                allResults.append(contentsOf: displayResults)
            }

            // 按分数排序
            allResults.sort { $0.score > $1.score }

            await MainActor.run {
                self.searchResults = Array(allResults.prefix(20))
            }
        } catch {
            Logger.shared.error("搜索失败: \(error)")
            await MainActor.run {
                self.searchResults = []
            }
        }
    }

    func addVector(text: String, metadata: [String: String], store: String) async {
        do {
            // 生成向量嵌入
            let embedding = try await generateEmbedding(text: text)

            // 添加content到metadata
            var fullMetadata = metadata
            fullMetadata["content"] = String(text.prefix(200))

            // 插入向量
            let vectorStore = VectorStoreManager.shared.getStore(name: store)
            try await vectorStore.insert(vector: Vector(
                id: UUID().uuidString,
                values: embedding.values,
                metadata: fullMetadata
            ))

            Logger.shared.info("向量添加成功")

            // 刷新数据
            await refreshStores()
        } catch {
            Logger.shared.error("添加向量失败: \(error)")
        }
    }

    func deleteVector(id: String, store: String) async {
        do {
            let vectorStore = VectorStoreManager.shared.getStore(name: store)
            try await vectorStore.delete(id: id)

            Logger.shared.info("向量删除成功")

            // 刷新数据
            await refreshStores()
        } catch {
            Logger.shared.error("删除向量失败: \(error)")
        }
    }

    private func generateEmbedding(text: String) async throws -> Vector {
        // TODO: 实际实现需要调用embedding模型
        // 这里使用模拟数据

        let dimensions = 384
        let values = (0..<dimensions).map { _ in Float.random(in: -1...1) }

        return Vector(
            id: UUID().uuidString,
            values: values,
            metadata: ["text": text]
        )
    }
}

// MARK: - Models

struct VectorDisplayInfo: Identifiable {
    let id: String
    let metadata: [String: String]
    let dimensions: Int

    var displayId: String {
        String(id.prefix(8)) + "..."
    }
}

struct SearchResultDisplayInfo: Identifiable {
    let id: String
    let score: Float
    let metadata: [String: String]
    let storeName: String

    var displayId: String {
        String(id.prefix(8)) + "..."
    }
}

// MARK: - Preview

struct VectorStoreView_Previews: PreviewProvider {
    static var previews: some View {
        VectorStoreView()
    }
}
