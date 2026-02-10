import SwiftUI
import Combine

// MARK: - Interaction State

/// 交互状态
public class GraphInteractionState: ObservableObject {

    // MARK: - View Transform

    /// 缩放比例
    @Published public var scale: CGFloat = 1.0

    /// 偏移量
    @Published public var offset: CGSize = .zero

    /// 最小缩放
    public var minScale: CGFloat = 0.1

    /// 最大缩放
    public var maxScale: CGFloat = 5.0

    // MARK: - Selection

    /// 选中的节点ID
    @Published public var selectedNodeId: String?

    /// 多选的节点ID集合
    @Published public var selectedNodeIds: Set<String> = []

    /// 悬停的节点ID
    @Published public var hoveredNodeId: String?

    /// 高亮的节点ID集合（邻居等）
    @Published public var highlightedNodeIds: Set<String> = []

    // MARK: - Dragging

    /// 是否正在拖拽节点
    @Published public var isDraggingNode: Bool = false

    /// 正在拖拽的节点ID
    @Published public var draggingNodeId: String?

    /// 拖拽开始位置
    public var dragStartPosition: CGPoint = .zero

    // MARK: - Gesture State

    /// 上一次缩放比例（用于增量计算）
    public var lastScale: CGFloat = 1.0

    /// 上一次偏移量
    public var lastOffset: CGSize = .zero

    // MARK: - Events

    public let nodeSelected = PassthroughSubject<String?, Never>()
    public let nodeDoubleClicked = PassthroughSubject<String, Never>()
    public let nodeDragged = PassthroughSubject<(String, CGPoint), Never>()
    public let canvasClicked = PassthroughSubject<CGPoint, Never>()
    public let contextMenuRequested = PassthroughSubject<(String, CGPoint), Never>()

    // MARK: - Initialization

    public init() {}

    // MARK: - Transform Methods

    /// 重置视图
    public func resetView() {
        scale = 1.0
        offset = .zero
        lastScale = 1.0
        lastOffset = .zero
    }

    /// 缩放到适应内容
    public func fitToContent(bounds: CGRect, viewSize: CGSize) {
        guard bounds.width > 0 && bounds.height > 0 else { return }

        let scaleX = viewSize.width / bounds.width
        let scaleY = viewSize.height / bounds.height
        scale = min(scaleX, scaleY) * 0.9

        offset = CGSize(
            width: viewSize.width / 2 - bounds.midX * scale,
            height: viewSize.height / 2 - bounds.midY * scale
        )

        lastScale = scale
        lastOffset = offset
    }

    /// 缩放到指定节点
    public func zoomToNode(_ nodeId: String, position: NodePosition, viewSize: CGSize) {
        scale = 2.0
        offset = CGSize(
            width: viewSize.width / 2 - position.x * scale,
            height: viewSize.height / 2 - position.y * scale
        )
        lastScale = scale
        lastOffset = offset
    }

    // MARK: - Selection Methods

    /// 选择节点
    public func selectNode(_ nodeId: String?) {
        selectedNodeId = nodeId
        nodeSelected.send(nodeId)

        if let id = nodeId {
            selectedNodeIds = [id]
        } else {
            selectedNodeIds.removeAll()
        }
    }

    /// 切换节点选择
    public func toggleNodeSelection(_ nodeId: String) {
        if selectedNodeIds.contains(nodeId) {
            selectedNodeIds.remove(nodeId)
            if selectedNodeId == nodeId {
                selectedNodeId = selectedNodeIds.first
            }
        } else {
            selectedNodeIds.insert(nodeId)
            selectedNodeId = nodeId
        }
        nodeSelected.send(selectedNodeId)
    }

    /// 添加到选择
    public func addToSelection(_ nodeId: String) {
        selectedNodeIds.insert(nodeId)
        selectedNodeId = nodeId
    }

    /// 清除选择
    public func clearSelection() {
        selectedNodeId = nil
        selectedNodeIds.removeAll()
        highlightedNodeIds.removeAll()
        nodeSelected.send(nil)
    }

    /// 设置高亮节点
    public func highlightNeighbors(_ nodeId: String, neighbors: [String]) {
        highlightedNodeIds = Set([nodeId] + neighbors)
    }

    /// 清除高亮
    public func clearHighlight() {
        highlightedNodeIds.removeAll()
    }
}

// MARK: - Interactive Graph View

/// 可交互的图谱视图
public struct InteractiveGraphView: View {

    // MARK: - Properties

    /// 图谱数据
    let graphData: GraphData

    /// 布局引擎
    @ObservedObject var layoutEngine: GraphLayoutEngine

    /// 交互状态
    @ObservedObject var interactionState: GraphInteractionState

    /// 渲染配置
    var config: GraphRenderConfig

    /// 节点点击回调
    var onNodeTap: ((String) -> Void)?

    /// 节点双击回调
    var onNodeDoubleTap: ((String) -> Void)?

    /// 空白区域点击回调
    var onCanvasTap: (() -> Void)?

    // MARK: - State

    @State private var viewSize: CGSize = .zero
    @GestureState private var magnifyBy: CGFloat = 1.0

    // MARK: - Initialization

    public init(
        graphData: GraphData,
        layoutEngine: GraphLayoutEngine,
        interactionState: GraphInteractionState,
        config: GraphRenderConfig = GraphRenderConfig(),
        onNodeTap: ((String) -> Void)? = nil,
        onNodeDoubleTap: ((String) -> Void)? = nil,
        onCanvasTap: (() -> Void)? = nil
    ) {
        self.graphData = graphData
        self.layoutEngine = layoutEngine
        self.interactionState = interactionState
        self.config = config
        self.onNodeTap = onNodeTap
        self.onNodeDoubleTap = onNodeDoubleTap
        self.onCanvasTap = onCanvasTap
    }

    // MARK: - Body

    public var body: some View {
        GeometryReader { geometry in
            ZStack {
                // 图谱渲染
                GraphRenderer(
                    graphData: graphData,
                    positions: layoutEngine.positions,
                    selectedNodeId: interactionState.selectedNodeId,
                    hoveredNodeId: interactionState.hoveredNodeId,
                    highlightedNodeIds: interactionState.highlightedNodeIds,
                    config: config,
                    scale: interactionState.scale * magnifyBy,
                    offset: interactionState.offset
                )

                // 拖拽指示器
                if interactionState.isDraggingNode,
                   let nodeId = interactionState.draggingNodeId,
                   let pos = layoutEngine.positions[nodeId] {
                    Circle()
                        .stroke(Color.blue, lineWidth: 2)
                        .frame(width: 30, height: 30)
                        .position(transformedPosition(pos.point))
                }
            }
            .contentShape(Rectangle())
            .gesture(combinedGesture)
            .onTapGesture(count: 2) { location in
                handleDoubleTap(at: location)
            }
            .onTapGesture { location in
                handleTap(at: location)
            }
            .onAppear {
                viewSize = geometry.size
            }
            .onChange(of: geometry.size) { _, newSize in
                viewSize = newSize
            }
        }
    }

    // MARK: - Gestures

    private var combinedGesture: some Gesture {
        SimultaneousGesture(panGesture, magnificationGesture)
    }

    /// 平移手势
    private var panGesture: some Gesture {
        DragGesture()
            .onChanged { value in
                if interactionState.isDraggingNode {
                    // 拖拽节点
                    handleNodeDrag(value)
                } else {
                    // 检测是否开始拖拽节点
                    if !interactionState.isDraggingNode {
                        let nodeId = hitTestNode(at: value.startLocation)
                        if let nodeId = nodeId {
                            interactionState.isDraggingNode = true
                            interactionState.draggingNodeId = nodeId
                            interactionState.dragStartPosition = value.startLocation
                        } else {
                            // 平移画布
                            interactionState.offset = CGSize(
                                width: interactionState.lastOffset.width + value.translation.width,
                                height: interactionState.lastOffset.height + value.translation.height
                            )
                        }
                    }
                }
            }
            .onEnded { value in
                if interactionState.isDraggingNode {
                    // 结束节点拖拽
                    interactionState.isDraggingNode = false
                    interactionState.draggingNodeId = nil
                } else {
                    // 更新偏移量
                    interactionState.lastOffset = interactionState.offset
                }
            }
    }

    /// 缩放手势
    private var magnificationGesture: some Gesture {
        MagnificationGesture()
            .updating($magnifyBy) { value, state, _ in
                state = value
            }
            .onEnded { value in
                let newScale = interactionState.lastScale * value
                interactionState.scale = min(max(newScale, interactionState.minScale), interactionState.maxScale)
                interactionState.lastScale = interactionState.scale
            }
    }

    // MARK: - Event Handlers

    /// 处理点击
    private func handleTap(at location: CGPoint) {
        if let nodeId = hitTestNode(at: location) {
            interactionState.selectNode(nodeId)
            onNodeTap?(nodeId)

            // 高亮邻居
            let neighbors = graphData.getNeighbors(nodeId).map { $0.id }
            interactionState.highlightNeighbors(nodeId, neighbors: neighbors)
        } else {
            interactionState.clearSelection()
            onCanvasTap?()
        }
    }

    /// 处理双击
    private func handleDoubleTap(at location: CGPoint) {
        if let nodeId = hitTestNode(at: location) {
            interactionState.nodeDoubleClicked.send(nodeId)
            onNodeDoubleTap?(nodeId)

            // 缩放到节点
            if let pos = layoutEngine.positions[nodeId] {
                interactionState.zoomToNode(nodeId, position: pos, viewSize: viewSize)
            }
        } else {
            // 双击空白区域：重置视图
            interactionState.resetView()
        }
    }

    /// 处理节点拖拽
    private func handleNodeDrag(_ value: DragGesture.Value) {
        guard let nodeId = interactionState.draggingNodeId,
              var pos = layoutEngine.positions[nodeId] else { return }

        // 计算新位置
        let dx = value.translation.width / interactionState.scale
        let dy = value.translation.height / interactionState.scale

        pos.x += dx
        pos.y += dy

        // 更新位置
        layoutEngine.updateNodePosition(nodeId, position: pos)

        // 发送拖拽事件
        interactionState.nodeDragged.send((nodeId, pos.point))
    }

    // MARK: - Hit Testing

    /// 检测点击的节点
    private func hitTestNode(at point: CGPoint) -> String? {
        return GraphRenderer.hitTestNode(
            at: point,
            nodes: graphData.nodes,
            positions: layoutEngine.positions,
            scale: interactionState.scale,
            offset: interactionState.offset
        )
    }

    /// 变换坐标
    private func transformedPosition(_ point: CGPoint) -> CGPoint {
        CGPoint(
            x: point.x * interactionState.scale + interactionState.offset.width,
            y: point.y * interactionState.scale + interactionState.offset.height
        )
    }
}

// MARK: - Context Menu

/// 图谱节点上下文菜单
public struct GraphNodeContextMenu: View {

    let nodeId: String
    let node: GraphNode?
    let onOpenNote: (String) -> Void
    let onExpandNeighbors: (String) -> Void
    let onHideNode: (String) -> Void
    let onFocusNode: (String) -> Void

    public init(
        nodeId: String,
        node: GraphNode?,
        onOpenNote: @escaping (String) -> Void,
        onExpandNeighbors: @escaping (String) -> Void,
        onHideNode: @escaping (String) -> Void,
        onFocusNode: @escaping (String) -> Void
    ) {
        self.nodeId = nodeId
        self.node = node
        self.onOpenNote = onOpenNote
        self.onExpandNeighbors = onExpandNeighbors
        self.onHideNode = onHideNode
        self.onFocusNode = onFocusNode
    }

    public var body: some View {
        Group {
            Button {
                onOpenNote(nodeId)
            } label: {
                Label("打开笔记", systemImage: "doc.text")
            }

            Button {
                onExpandNeighbors(nodeId)
            } label: {
                Label("展开邻居", systemImage: "arrow.triangle.branch")
            }

            Button {
                onFocusNode(nodeId)
            } label: {
                Label("聚焦此节点", systemImage: "scope")
            }

            Divider()

            Button(role: .destructive) {
                onHideNode(nodeId)
            } label: {
                Label("隐藏节点", systemImage: "eye.slash")
            }
        }
    }
}

// MARK: - Selection Overlay

/// 选择框覆盖层
public struct SelectionOverlay: View {

    @Binding var isSelecting: Bool
    @Binding var selectionRect: CGRect

    public var body: some View {
        if isSelecting {
            Rectangle()
                .stroke(Color.blue, style: StrokeStyle(lineWidth: 1, dash: [5, 3]))
                .background(Color.blue.opacity(0.1))
                .frame(width: selectionRect.width, height: selectionRect.height)
                .position(
                    x: selectionRect.midX,
                    y: selectionRect.midY
                )
        }
    }
}

// MARK: - Minimap View

/// 小地图视图
public struct GraphMinimap: View {

    let graphData: GraphData
    let positions: [String: NodePosition]
    let viewportRect: CGRect
    let fullBounds: CGRect
    let size: CGSize

    var onTap: ((CGPoint) -> Void)?

    public init(
        graphData: GraphData,
        positions: [String: NodePosition],
        viewportRect: CGRect,
        fullBounds: CGRect,
        size: CGSize = CGSize(width: 150, height: 100),
        onTap: ((CGPoint) -> Void)? = nil
    ) {
        self.graphData = graphData
        self.positions = positions
        self.viewportRect = viewportRect
        self.fullBounds = fullBounds
        self.size = size
        self.onTap = onTap
    }

    public var body: some View {
        Canvas { context, canvasSize in
            guard fullBounds.width > 0 && fullBounds.height > 0 else { return }

            let scaleX = canvasSize.width / fullBounds.width
            let scaleY = canvasSize.height / fullBounds.height
            let scale = min(scaleX, scaleY)

            // 绘制边
            for edge in graphData.edges {
                guard let sourcePos = positions[edge.sourceId],
                      let targetPos = positions[edge.targetId] else { continue }

                var path = Path()
                path.move(to: transformPoint(sourcePos.point, scale: scale))
                path.addLine(to: transformPoint(targetPos.point, scale: scale))

                context.stroke(path, with: .color(.gray.opacity(0.3)), lineWidth: 0.5)
            }

            // 绘制节点
            for node in graphData.nodes {
                guard let pos = positions[node.id] else { continue }

                let point = transformPoint(pos.point, scale: scale)
                let rect = CGRect(x: point.x - 2, y: point.y - 2, width: 4, height: 4)

                context.fill(Circle().path(in: rect), with: .color(.blue))
            }

            // 绘制视口
            let viewportPath = Path(transformRect(viewportRect, scale: scale))
            context.stroke(viewportPath, with: .color(.red), lineWidth: 1)
        }
        .frame(width: size.width, height: size.height)
        .background(Color.white.opacity(0.9))
        .cornerRadius(8)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.gray.opacity(0.3), lineWidth: 1)
        )
        .onTapGesture { location in
            let scaleX = size.width / fullBounds.width
            let scaleY = size.height / fullBounds.height
            let scale = min(scaleX, scaleY)

            let targetPoint = CGPoint(
                x: (location.x / scale) + fullBounds.minX,
                y: (location.y / scale) + fullBounds.minY
            )

            onTap?(targetPoint)
        }
    }

    private func transformPoint(_ point: CGPoint, scale: CGFloat) -> CGPoint {
        CGPoint(
            x: (point.x - fullBounds.minX) * scale,
            y: (point.y - fullBounds.minY) * scale
        )
    }

    private func transformRect(_ rect: CGRect, scale: CGFloat) -> CGRect {
        CGRect(
            x: (rect.minX - fullBounds.minX) * scale,
            y: (rect.minY - fullBounds.minY) * scale,
            width: rect.width * scale,
            height: rect.height * scale
        )
    }
}
