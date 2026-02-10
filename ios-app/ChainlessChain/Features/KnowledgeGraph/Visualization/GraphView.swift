import SwiftUI
import Combine
import CoreCommon

// MARK: - Graph View State

/// 图谱视图状态
public class GraphViewState: ObservableObject {

    /// 图谱数据
    @Published public var graphData: GraphData = .empty

    /// 原始数据（未过滤）
    @Published public var originalData: GraphData = .empty

    /// 筛选器
    @Published public var filters: GraphFilters = .default

    /// 搜索文本
    @Published public var searchText: String = ""

    /// 搜索结果
    @Published public var searchResults: [GraphNode] = []

    /// 当前布局类型
    @Published public var layoutType: GraphLayoutType = .force

    /// 是否显示标签
    @Published public var showLabels: Bool = true

    /// 是否显示小地图
    @Published public var showMinimap: Bool = true

    /// 选中节点的详情
    @Published public var selectedNodeDetail: GraphNode?

    /// 图谱统计
    @Published public var stats: GraphStats?

    /// 加载中
    @Published public var isLoading: Bool = false

    /// 错误消息
    @Published public var errorMessage: String?

    public init() {}

    /// 应用筛选
    public func applyFilters() {
        graphData = filters.apply(to: originalData)
    }

    /// 搜索节点
    public func searchNodes(_ query: String) {
        guard !query.isEmpty else {
            searchResults = []
            return
        }

        let lowercased = query.lowercased()
        searchResults = originalData.nodes.filter { node in
            node.label.lowercased().contains(lowercased)
        }
    }
}

// MARK: - Knowledge Graph View

/// 知识图谱完整视图
public struct KnowledgeGraphView: View {

    // MARK: - Properties

    @ObservedObject var viewState: GraphViewState
    @StateObject private var layoutEngine = GraphLayoutEngine()
    @StateObject private var interactionState = GraphInteractionState()
    @StateObject private var graphManager = GraphManager.shared

    /// 节点打开回调
    var onOpenNote: ((String) -> Void)?

    // MARK: - State

    @State private var showFilterSheet = false
    @State private var showStatsSheet = false
    @State private var showExportSheet = false
    @State private var viewSize: CGSize = .zero

    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    public init(
        viewState: GraphViewState,
        onOpenNote: ((String) -> Void)? = nil
    ) {
        self.viewState = viewState
        self.onOpenNote = onOpenNote
    }

    // MARK: - Body

    public var body: some View {
        GeometryReader { geometry in
            ZStack {
                // 主图谱区域
                graphCanvas

                // 工具栏
                VStack {
                    toolbar
                    Spacer()
                }

                // 节点详情面板
                if let node = viewState.selectedNodeDetail {
                    nodeDetailPanel(node: node)
                }

                // 小地图
                if viewState.showMinimap && !viewState.graphData.nodes.isEmpty {
                    minimap
                }

                // 加载指示器
                if viewState.isLoading || layoutEngine.isLoading {
                    loadingOverlay
                }
            }
            .onAppear {
                viewSize = geometry.size
                layoutEngine.bounds = CGRect(origin: .zero, size: geometry.size)
                loadGraphData()
            }
            .onChange(of: geometry.size) { _, newSize in
                viewSize = newSize
                layoutEngine.bounds = CGRect(origin: .zero, size: newSize)
            }
        }
        .sheet(isPresented: $showFilterSheet) {
            filterSheet
        }
        .sheet(isPresented: $showStatsSheet) {
            statsSheet
        }
        .sheet(isPresented: $showExportSheet) {
            exportSheet
        }
    }

    // MARK: - Subviews

    /// 图谱画布
    private var graphCanvas: some View {
        InteractiveGraphView(
            graphData: viewState.graphData,
            layoutEngine: layoutEngine,
            interactionState: interactionState,
            config: GraphRenderConfig(showLabels: viewState.showLabels),
            onNodeTap: { nodeId in
                handleNodeTap(nodeId)
            },
            onNodeDoubleTap: { nodeId in
                onOpenNote?(nodeId)
            },
            onCanvasTap: {
                viewState.selectedNodeDetail = nil
            }
        )
        .contextMenu {
            canvasContextMenu
        }
    }

    /// 工具栏
    private var toolbar: some View {
        HStack(spacing: 12) {
            // 搜索框
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(.secondary)

                TextField("搜索节点...", text: $viewState.searchText)
                    .textFieldStyle(.plain)
                    .onChange(of: viewState.searchText) { _, newValue in
                        viewState.searchNodes(newValue)
                    }

                if !viewState.searchText.isEmpty {
                    Button {
                        viewState.searchText = ""
                        viewState.searchResults = []
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.secondary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(8)
            .background(Color(.systemBackground))
            .cornerRadius(8)
            .frame(maxWidth: 200)

            Spacer()

            // 布局选择
            Menu {
                ForEach(GraphLayoutType.allCases, id: \.self) { type in
                    Button {
                        changeLayout(type)
                    } label: {
                        Label(type.displayName, systemImage: type.iconName)
                    }
                }
            } label: {
                Label(viewState.layoutType.displayName, systemImage: viewState.layoutType.iconName)
                    .padding(8)
                    .background(Color(.systemBackground))
                    .cornerRadius(8)
            }

            // 刷新布局
            Button {
                refreshLayout()
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(ToolbarButtonStyle())

            // 适应视图
            Button {
                fitToView()
            } label: {
                Image(systemName: "arrow.up.left.and.arrow.down.right")
            }
            .buttonStyle(ToolbarButtonStyle())

            // 筛选
            Button {
                showFilterSheet = true
            } label: {
                Image(systemName: "line.3.horizontal.decrease.circle")
            }
            .buttonStyle(ToolbarButtonStyle())

            // 统计
            Button {
                showStatsSheet = true
            } label: {
                Image(systemName: "chart.bar")
            }
            .buttonStyle(ToolbarButtonStyle())

            // 更多选项
            Menu {
                Toggle(isOn: $viewState.showLabels) {
                    Label("显示标签", systemImage: "tag")
                }

                Toggle(isOn: $viewState.showMinimap) {
                    Label("显示小地图", systemImage: "map")
                }

                Divider()

                Button {
                    showExportSheet = true
                } label: {
                    Label("导出图谱", systemImage: "square.and.arrow.up")
                }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .buttonStyle(ToolbarButtonStyle())
        }
        .padding()
        .background(Color(.systemBackground).opacity(0.9))
    }

    /// 节点详情面板
    private func nodeDetailPanel(node: GraphNode) -> some View {
        VStack(alignment: .leading) {
            Spacer()

            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text(node.label)
                        .font(.headline)
                        .lineLimit(2)

                    Spacer()

                    Button {
                        viewState.selectedNodeDetail = nil
                    } label: {
                        Image(systemName: "xmark")
                            .foregroundColor(.secondary)
                    }
                }

                Divider()

                LabeledContent("类型", value: nodeTypeLabel(node.type))

                if let centrality = node.centrality {
                    LabeledContent("中心性", value: String(format: "%.2f", centrality))
                }

                if let communityId = node.communityId {
                    LabeledContent("社区", value: "#\(communityId)")
                }

                // 关系数量
                let relationCount = viewState.graphData.getNodeEdges(node.id).count
                LabeledContent("关联数", value: "\(relationCount)")

                Divider()

                HStack {
                    Button("打开笔记") {
                        onOpenNote?(node.id)
                    }
                    .buttonStyle(.borderedProminent)

                    Button("查看邻居") {
                        expandNeighbors(node.id)
                    }
                    .buttonStyle(.bordered)
                }
            }
            .padding()
            .background(Color(.systemBackground))
            .cornerRadius(12)
            .shadow(radius: 5)
        }
        .padding()
        .frame(maxWidth: 300)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// 小地图
    private var minimap: some View {
        VStack {
            Spacer()
            HStack {
                Spacer()
                GraphMinimap(
                    graphData: viewState.graphData,
                    positions: layoutEngine.positions,
                    viewportRect: calculateViewport(),
                    fullBounds: calculateFullBounds(),
                    onTap: { point in
                        navigateToPoint(point)
                    }
                )
                .padding()
            }
        }
    }

    /// 加载覆盖层
    private var loadingOverlay: some View {
        ZStack {
            Color.black.opacity(0.3)

            VStack(spacing: 16) {
                ProgressView()
                    .scaleEffect(1.5)

                if layoutEngine.isLayouting {
                    Text("布局计算中...")
                        .foregroundColor(.white)

                    ProgressView(value: layoutEngine.progress)
                        .frame(width: 150)
                }
            }
            .padding(24)
            .background(Color(.systemBackground))
            .cornerRadius(12)
        }
    }

    /// 画布上下文菜单
    @ViewBuilder
    private var canvasContextMenu: some View {
        Button {
            refreshLayout()
        } label: {
            Label("刷新布局", systemImage: "arrow.clockwise")
        }

        Button {
            fitToView()
        } label: {
            Label("适应视图", systemImage: "arrow.up.left.and.arrow.down.right")
        }

        Divider()

        Button {
            interactionState.resetView()
        } label: {
            Label("重置视图", systemImage: "arrow.counterclockwise")
        }
    }

    /// 筛选Sheet
    private var filterSheet: some View {
        NavigationView {
            Form {
                Section("关系类型") {
                    ForEach(GraphRelationType.allCases, id: \.self) { type in
                        Toggle(relationTypeLabel(type), isOn: Binding(
                            get: { viewState.filters.relationTypes.contains(type) },
                            set: { isOn in
                                if isOn {
                                    viewState.filters.relationTypes.insert(type)
                                } else {
                                    viewState.filters.relationTypes.remove(type)
                                }
                            }
                        ))
                    }
                }

                Section("节点类型") {
                    ForEach(GraphNodeType.allCases, id: \.self) { type in
                        Toggle(nodeTypeLabel(type), isOn: Binding(
                            get: { viewState.filters.nodeTypes.contains(type) },
                            set: { isOn in
                                if isOn {
                                    viewState.filters.nodeTypes.insert(type)
                                } else {
                                    viewState.filters.nodeTypes.remove(type)
                                }
                            }
                        ))
                    }
                }

                Section("权重筛选") {
                    Slider(value: $viewState.filters.minWeight, in: 0...1, step: 0.1) {
                        Text("最小权重")
                    }
                    Text("最小权重: \(viewState.filters.minWeight, specifier: "%.1f")")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Section("节点限制") {
                    Stepper("最大节点数: \(viewState.filters.limit)", value: $viewState.filters.limit, in: 50...1000, step: 50)
                }
            }
            .navigationTitle("筛选")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") {
                        showFilterSheet = false
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("应用") {
                        applyFilters()
                        showFilterSheet = false
                    }
                }
            }
        }
    }

    /// 统计Sheet
    private var statsSheet: some View {
        NavigationView {
            List {
                if let stats = viewState.stats {
                    Section("基本统计") {
                        LabeledContent("节点数", value: "\(stats.nodeCount)")
                        LabeledContent("边数", value: "\(stats.edgeCount)")
                        LabeledContent("密度", value: String(format: "%.4f", stats.density))
                        LabeledContent("平均度", value: String(format: "%.2f", stats.avgDegree))
                        LabeledContent("最大度", value: "\(stats.maxDegree)")
                        LabeledContent("最小度", value: "\(stats.minDegree)")
                    }

                    Section("连通性") {
                        LabeledContent("连通分量数", value: "\(stats.componentCount)")
                        LabeledContent("最大分量大小", value: "\(stats.largestComponentSize)")
                        LabeledContent("平均聚类系数", value: String(format: "%.4f", stats.avgClusteringCoeff))
                    }

                    Section("关系类型分布") {
                        LabeledContent("链接关系", value: "\(stats.linkRelations)")
                        LabeledContent("标签关系", value: "\(stats.tagRelations)")
                        LabeledContent("语义关系", value: "\(stats.semanticRelations)")
                        LabeledContent("时间关系", value: "\(stats.temporalRelations)")
                    }
                } else {
                    Text("暂无统计数据")
                        .foregroundColor(.secondary)
                }
            }
            .navigationTitle("图谱统计")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") {
                        showStatsSheet = false
                    }
                }
            }
        }
    }

    /// 导出Sheet
    private var exportSheet: some View {
        NavigationView {
            List {
                ForEach(GraphExportFormat.allCases, id: \.self) { format in
                    Button {
                        exportGraph(format: format)
                        showExportSheet = false
                    } label: {
                        HStack {
                            Image(systemName: iconForFormat(format))
                            Text(format.rawValue.uppercased())
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                        }
                    }
                }
            }
            .navigationTitle("导出图谱")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") {
                        showExportSheet = false
                    }
                }
            }
        }
    }

    // MARK: - Actions

    /// 加载图谱数据
    private func loadGraphData() {
        Task {
            viewState.isLoading = true

            let data = await graphManager.loadGraphData(filters: viewState.filters)

            await MainActor.run {
                viewState.originalData = data
                viewState.graphData = data
                viewState.stats = graphManager.stats
                viewState.isLoading = false
            }

            // 执行布局
            _ = await layoutEngine.layout(
                nodes: data.nodes,
                edges: data.edges,
                type: viewState.layoutType
            )
        }
    }

    /// 切换布局
    private func changeLayout(_ type: GraphLayoutType) {
        viewState.layoutType = type

        Task {
            _ = await layoutEngine.layout(
                nodes: viewState.graphData.nodes,
                edges: viewState.graphData.edges,
                type: type
            )
        }
    }

    /// 刷新布局
    private func refreshLayout() {
        Task {
            layoutEngine.resetPositions()
            _ = await layoutEngine.layout(
                nodes: viewState.graphData.nodes,
                edges: viewState.graphData.edges,
                type: viewState.layoutType
            )
        }
    }

    /// 适应视图
    private func fitToView() {
        let bounds = calculateFullBounds()
        interactionState.fitToContent(bounds: bounds, viewSize: viewSize)
    }

    /// 应用筛选
    private func applyFilters() {
        viewState.applyFilters()

        Task {
            _ = await layoutEngine.layout(
                nodes: viewState.graphData.nodes,
                edges: viewState.graphData.edges,
                type: viewState.layoutType
            )
        }
    }

    /// 处理节点点击
    private func handleNodeTap(_ nodeId: String) {
        if let node = viewState.graphData.getNode(nodeId) {
            viewState.selectedNodeDetail = node
        }
    }

    /// 展开邻居
    private func expandNeighbors(_ nodeId: String) {
        let neighbors = viewState.graphData.getNeighbors(nodeId).map { $0.id }
        interactionState.highlightNeighbors(nodeId, neighbors: neighbors)
    }

    /// 导航到点
    private func navigateToPoint(_ point: CGPoint) {
        interactionState.offset = CGSize(
            width: viewSize.width / 2 - point.x * interactionState.scale,
            height: viewSize.height / 2 - point.y * interactionState.scale
        )
        interactionState.lastOffset = interactionState.offset
    }

    /// 导出图谱
    private func exportGraph(format: GraphExportFormat) {
        if let data = graphManager.exportGraph(format: format) {
            // TODO: 分享或保存数据
            Logger.shared.info("[GraphView] 导出图谱: \(format.rawValue), \(data.count) bytes")
        }
    }

    // MARK: - Helper Methods

    private func calculateViewport() -> CGRect {
        CGRect(
            x: -interactionState.offset.width / interactionState.scale,
            y: -interactionState.offset.height / interactionState.scale,
            width: viewSize.width / interactionState.scale,
            height: viewSize.height / interactionState.scale
        )
    }

    private func calculateFullBounds() -> CGRect {
        guard !layoutEngine.positions.isEmpty else {
            return CGRect(origin: .zero, size: viewSize)
        }

        var minX = CGFloat.infinity
        var minY = CGFloat.infinity
        var maxX = -CGFloat.infinity
        var maxY = -CGFloat.infinity

        for pos in layoutEngine.positions.values {
            minX = min(minX, pos.x)
            minY = min(minY, pos.y)
            maxX = max(maxX, pos.x)
            maxY = max(maxY, pos.y)
        }

        let padding: CGFloat = 50
        return CGRect(
            x: minX - padding,
            y: minY - padding,
            width: maxX - minX + padding * 2,
            height: maxY - minY + padding * 2
        )
    }

    private func nodeTypeLabel(_ type: GraphNodeType) -> String {
        switch type {
        case .note: return "笔记"
        case .document: return "文档"
        case .conversation: return "对话"
        case .webClip: return "网页剪藏"
        case .tag: return "标签"
        case .entity: return "实体"
        }
    }

    private func relationTypeLabel(_ type: GraphRelationType) -> String {
        switch type {
        case .link: return "链接"
        case .tag: return "标签"
        case .semantic: return "语义"
        case .temporal: return "时间"
        case .reference: return "引用"
        case .mention: return "提及"
        }
    }

    private func iconForFormat(_ format: GraphExportFormat) -> String {
        switch format {
        case .json: return "curlybraces"
        case .csv: return "tablecells"
        case .graphml: return "doc.text"
        case .gexf: return "doc.richtext"
        }
    }
}

// MARK: - Toolbar Button Style

struct ToolbarButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(8)
            .background(configuration.isPressed ? Color.gray.opacity(0.2) : Color(.systemBackground))
            .cornerRadius(8)
    }
}

// MARK: - Preview

#if DEBUG
struct KnowledgeGraphView_Previews: PreviewProvider {
    static var previews: some View {
        KnowledgeGraphView(viewState: GraphViewState())
    }
}
#endif
