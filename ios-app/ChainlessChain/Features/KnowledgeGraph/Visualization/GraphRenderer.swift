import SwiftUI
import CoreGraphics

// MARK: - Node Style

/// 节点样式
public struct NodeStyle {
    public var fillColor: Color
    public var strokeColor: Color
    public var strokeWidth: CGFloat
    public var size: CGFloat
    public var labelColor: Color
    public var labelFont: Font
    public var showLabel: Bool

    public init(
        fillColor: Color = .blue,
        strokeColor: Color = .white,
        strokeWidth: CGFloat = 2,
        size: CGFloat = 20,
        labelColor: Color = .primary,
        labelFont: Font = .caption,
        showLabel: Bool = true
    ) {
        self.fillColor = fillColor
        self.strokeColor = strokeColor
        self.strokeWidth = strokeWidth
        self.size = size
        self.labelColor = labelColor
        self.labelFont = labelFont
        self.showLabel = showLabel
    }

    /// 根据节点类型获取样式
    public static func forNodeType(_ type: GraphNodeType) -> NodeStyle {
        switch type {
        case .note:
            return NodeStyle(fillColor: .blue)
        case .document:
            return NodeStyle(fillColor: .green)
        case .conversation:
            return NodeStyle(fillColor: .orange)
        case .webClip:
            return NodeStyle(fillColor: .red)
        case .tag:
            return NodeStyle(fillColor: .purple, size: 15)
        case .entity:
            return NodeStyle(fillColor: .teal, size: 18)
        }
    }
}

// MARK: - Edge Style

/// 边样式
public struct EdgeStyle {
    public var color: Color
    public var width: CGFloat
    public var opacity: Double
    public var showArrow: Bool
    public var arrowSize: CGFloat
    public var curvature: CGFloat
    public var dashPattern: [CGFloat]?

    public init(
        color: Color = .gray,
        width: CGFloat = 1,
        opacity: Double = 0.6,
        showArrow: Bool = true,
        arrowSize: CGFloat = 8,
        curvature: CGFloat = 0.1,
        dashPattern: [CGFloat]? = nil
    ) {
        self.color = color
        self.width = width
        self.opacity = opacity
        self.showArrow = showArrow
        self.arrowSize = arrowSize
        self.curvature = curvature
        self.dashPattern = dashPattern
    }

    /// 根据关系类型获取样式
    public static func forRelationType(_ type: GraphRelationType) -> EdgeStyle {
        switch type {
        case .link:
            return EdgeStyle(color: .blue, width: 2)
        case .tag:
            return EdgeStyle(color: .green, width: 1.5, dashPattern: [4, 2])
        case .semantic:
            return EdgeStyle(color: .orange, width: 1.5)
        case .temporal:
            return EdgeStyle(color: .red, width: 1, dashPattern: [2, 2])
        case .reference:
            return EdgeStyle(color: .purple, width: 1.5)
        case .mention:
            return EdgeStyle(color: .teal, width: 1.5)
        }
    }
}

// MARK: - Render Config

/// 渲染配置
public struct GraphRenderConfig {
    /// 节点最小尺寸
    public var minNodeSize: CGFloat = 15

    /// 节点最大尺寸
    public var maxNodeSize: CGFloat = 50

    /// 标签最大长度
    public var maxLabelLength: Int = 15

    /// 是否显示标签
    public var showLabels: Bool = true

    /// 标签偏移
    public var labelOffset: CGFloat = 10

    /// 高亮节点的光晕大小
    public var highlightGlowSize: CGFloat = 5

    /// 选中节点的边框宽度
    public var selectedBorderWidth: CGFloat = 3

    /// 边的曲度
    public var edgeCurvature: CGFloat = 0.1

    /// 背景色
    public var backgroundColor: Color = Color(.systemBackground)

    /// 网格线颜色
    public var gridColor: Color = .gray.opacity(0.1)

    /// 是否显示网格
    public var showGrid: Bool = false

    public init() {}
}

// MARK: - Graph Renderer

/// 图谱渲染器
public struct GraphRenderer: View {

    // MARK: - Properties

    /// 图谱数据
    let graphData: GraphData

    /// 节点位置
    let positions: [String: NodePosition]

    /// 选中的节点
    let selectedNodeId: String?

    /// 悬停的节点
    let hoveredNodeId: String?

    /// 高亮的节点集合
    let highlightedNodeIds: Set<String>

    /// 渲染配置
    let config: GraphRenderConfig

    /// 缩放比例
    let scale: CGFloat

    /// 偏移量
    let offset: CGSize

    /// 节点点击回调
    var onNodeTap: ((String) -> Void)?

    /// 边点击回调
    var onEdgeTap: ((String) -> Void)?

    // MARK: - Initialization

    public init(
        graphData: GraphData,
        positions: [String: NodePosition],
        selectedNodeId: String? = nil,
        hoveredNodeId: String? = nil,
        highlightedNodeIds: Set<String> = [],
        config: GraphRenderConfig = GraphRenderConfig(),
        scale: CGFloat = 1,
        offset: CGSize = .zero,
        onNodeTap: ((String) -> Void)? = nil,
        onEdgeTap: ((String) -> Void)? = nil
    ) {
        self.graphData = graphData
        self.positions = positions
        self.selectedNodeId = selectedNodeId
        self.hoveredNodeId = hoveredNodeId
        self.highlightedNodeIds = highlightedNodeIds
        self.config = config
        self.scale = scale
        self.offset = offset
        self.onNodeTap = onNodeTap
        self.onEdgeTap = onEdgeTap
    }

    // MARK: - Body

    public var body: some View {
        Canvas { context, size in
            // 应用变换
            var transformedContext = context
            transformedContext.translateBy(x: offset.width, y: offset.height)
            transformedContext.scaleBy(x: scale, y: scale)

            // 绘制网格（可选）
            if config.showGrid {
                drawGrid(context: transformedContext, size: size)
            }

            // 绘制边
            for edge in graphData.edges {
                drawEdge(context: transformedContext, edge: edge)
            }

            // 绘制节点
            for node in graphData.nodes {
                drawNode(context: transformedContext, node: node)
            }

        }
        .background(config.backgroundColor)
    }

    // MARK: - Drawing Methods

    /// 绘制网格
    private func drawGrid(context: GraphicsContext, size: CGSize) {
        let gridSpacing: CGFloat = 50

        var path = Path()

        // 垂直线
        var x: CGFloat = 0
        while x < size.width / scale {
            path.move(to: CGPoint(x: x, y: 0))
            path.addLine(to: CGPoint(x: x, y: size.height / scale))
            x += gridSpacing
        }

        // 水平线
        var y: CGFloat = 0
        while y < size.height / scale {
            path.move(to: CGPoint(x: 0, y: y))
            path.addLine(to: CGPoint(x: size.width / scale, y: y))
            y += gridSpacing
        }

        context.stroke(path, with: .color(config.gridColor), lineWidth: 0.5)
    }

    /// 绘制边
    private func drawEdge(context: GraphicsContext, edge: GraphEdge) {
        guard let sourcePos = positions[edge.sourceId],
              let targetPos = positions[edge.targetId] else { return }

        let style = EdgeStyle.forRelationType(edge.type)
        let isHighlighted = highlightedNodeIds.contains(edge.sourceId) ||
                           highlightedNodeIds.contains(edge.targetId)

        let sourcePoint = sourcePos.point
        let targetPoint = targetPos.point

        // 计算控制点（曲线）
        let midX = (sourcePoint.x + targetPoint.x) / 2
        let midY = (sourcePoint.y + targetPoint.y) / 2

        let dx = targetPoint.x - sourcePoint.x
        let dy = targetPoint.y - sourcePoint.y

        let controlX = midX - dy * config.edgeCurvature
        let controlY = midY + dx * config.edgeCurvature

        // 绘制曲线
        var path = Path()
        path.move(to: sourcePoint)
        path.addQuadCurve(
            to: targetPoint,
            control: CGPoint(x: controlX, y: controlY)
        )

        let lineWidth = style.width * (isHighlighted ? 1.5 : 1) * CGFloat(edge.weight)
        let opacity = isHighlighted ? 1.0 : style.opacity

        if let dashPattern = style.dashPattern {
            context.stroke(
                path,
                with: .color(style.color.opacity(opacity)),
                style: StrokeStyle(lineWidth: lineWidth, dash: dashPattern)
            )
        } else {
            context.stroke(
                path,
                with: .color(style.color.opacity(opacity)),
                lineWidth: lineWidth
            )
        }

        // 绘制箭头
        if style.showArrow {
            drawArrow(
                context: context,
                from: CGPoint(x: controlX, y: controlY),
                to: targetPoint,
                color: style.color.opacity(opacity),
                size: style.arrowSize
            )
        }
    }

    /// 绘制箭头
    private func drawArrow(
        context: GraphicsContext,
        from: CGPoint,
        to: CGPoint,
        color: Color,
        size: CGFloat
    ) {
        let angle = atan2(to.y - from.y, to.x - from.x)

        // 箭头尖端位置（稍微后退以避免重叠节点）
        let tipOffset: CGFloat = 15
        let tipX = to.x - cos(angle) * tipOffset
        let tipY = to.y - sin(angle) * tipOffset

        // 箭头两侧
        let arrowAngle: CGFloat = .pi / 6
        let leftX = tipX - cos(angle - arrowAngle) * size
        let leftY = tipY - sin(angle - arrowAngle) * size
        let rightX = tipX - cos(angle + arrowAngle) * size
        let rightY = tipY - sin(angle + arrowAngle) * size

        var path = Path()
        path.move(to: CGPoint(x: tipX, y: tipY))
        path.addLine(to: CGPoint(x: leftX, y: leftY))
        path.addLine(to: CGPoint(x: rightX, y: rightY))
        path.closeSubpath()

        context.fill(path, with: .color(color))
    }

    /// 绘制节点
    private func drawNode(context: GraphicsContext, node: GraphNode) {
        guard let pos = positions[node.id] else { return }

        let style = NodeStyle.forNodeType(node.type)
        let isSelected = node.id == selectedNodeId
        let isHovered = node.id == hoveredNodeId
        let isHighlighted = highlightedNodeIds.contains(node.id)

        // 计算节点大小
        var size = style.size
        if let centrality = node.centrality {
            size = config.minNodeSize + CGFloat(centrality) * (config.maxNodeSize - config.minNodeSize)
        }
        if isHovered { size *= 1.2 }

        let rect = CGRect(
            x: pos.x - size / 2,
            y: pos.y - size / 2,
            width: size,
            height: size
        )

        // 高亮光晕
        if isHighlighted || isHovered {
            let glowRect = rect.insetBy(dx: -config.highlightGlowSize, dy: -config.highlightGlowSize)
            context.fill(
                Circle().path(in: glowRect),
                with: .color(style.fillColor.opacity(0.3))
            )
        }

        // 节点填充
        context.fill(
            Circle().path(in: rect),
            with: .color(style.fillColor)
        )

        // 节点边框
        let borderWidth = isSelected ? config.selectedBorderWidth : style.strokeWidth
        context.stroke(
            Circle().path(in: rect),
            with: .color(isSelected ? .yellow : style.strokeColor),
            lineWidth: borderWidth
        )

        // 标签
        if config.showLabels && style.showLabel {
            drawLabel(
                context: context,
                text: node.label,
                at: CGPoint(x: pos.x, y: pos.y + size / 2 + config.labelOffset),
                color: style.labelColor,
                font: style.labelFont
            )
        }
    }

    /// 绘制标签
    private func drawLabel(
        context: GraphicsContext,
        text: String,
        at point: CGPoint,
        color: Color,
        font: Font
    ) {
        var displayText = text
        if text.count > config.maxLabelLength {
            displayText = String(text.prefix(config.maxLabelLength - 1)) + "..."
        }

        let resolvedText = Text(displayText)
            .font(font)
            .foregroundColor(color)

        context.draw(
            resolvedText,
            at: point,
            anchor: .top
        )
    }
}

// MARK: - Node Hit Testing

extension GraphRenderer {

    /// 检测点击的节点
    public static func hitTestNode(
        at point: CGPoint,
        nodes: [GraphNode],
        positions: [String: NodePosition],
        scale: CGFloat,
        offset: CGSize
    ) -> String? {
        // 反向变换点击位置
        let transformedPoint = CGPoint(
            x: (point.x - offset.width) / scale,
            y: (point.y - offset.height) / scale
        )

        // 查找点击的节点
        for node in nodes {
            guard let pos = positions[node.id] else { continue }

            let style = NodeStyle.forNodeType(node.type)
            let size = style.size * 1.5 // 增加点击区域

            let rect = CGRect(
                x: pos.x - size / 2,
                y: pos.y - size / 2,
                width: size,
                height: size
            )

            if rect.contains(transformedPoint) {
                return node.id
            }
        }

        return nil
    }

    /// 检测点击的边
    public static func hitTestEdge(
        at point: CGPoint,
        edges: [GraphEdge],
        positions: [String: NodePosition],
        scale: CGFloat,
        offset: CGSize,
        tolerance: CGFloat = 10
    ) -> String? {
        let transformedPoint = CGPoint(
            x: (point.x - offset.width) / scale,
            y: (point.y - offset.height) / scale
        )

        for edge in edges {
            guard let sourcePos = positions[edge.sourceId],
                  let targetPos = positions[edge.targetId] else { continue }

            let distance = pointToLineDistance(
                point: transformedPoint,
                lineStart: sourcePos.point,
                lineEnd: targetPos.point
            )

            if distance < tolerance {
                return edge.id
            }
        }

        return nil
    }

    /// 计算点到线段的距离
    private static func pointToLineDistance(
        point: CGPoint,
        lineStart: CGPoint,
        lineEnd: CGPoint
    ) -> CGFloat {
        let dx = lineEnd.x - lineStart.x
        let dy = lineEnd.y - lineStart.y

        if dx == 0 && dy == 0 {
            return sqrt(pow(point.x - lineStart.x, 2) + pow(point.y - lineStart.y, 2))
        }

        let t = max(0, min(1, (
            (point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy
        ) / (dx * dx + dy * dy)))

        let nearestX = lineStart.x + t * dx
        let nearestY = lineStart.y + t * dy

        return sqrt(pow(point.x - nearestX, 2) + pow(point.y - nearestY, 2))
    }
}

// MARK: - Preview

#if DEBUG
struct GraphRenderer_Previews: PreviewProvider {
    static var previews: some View {
        let nodes = [
            GraphNode(id: "1", label: "笔记A", type: .note),
            GraphNode(id: "2", label: "笔记B", type: .note),
            GraphNode(id: "3", label: "文档C", type: .document),
        ]

        let edges = [
            GraphEdge(sourceId: "1", targetId: "2", type: .link, weight: 1.0),
            GraphEdge(sourceId: "2", targetId: "3", type: .tag, weight: 0.5),
        ]

        let positions: [String: NodePosition] = [
            "1": NodePosition(x: 100, y: 100),
            "2": NodePosition(x: 200, y: 150),
            "3": NodePosition(x: 300, y: 100),
        ]

        GraphRenderer(
            graphData: GraphData(nodes: nodes, edges: edges),
            positions: positions,
            selectedNodeId: "1"
        )
        .frame(width: 400, height: 300)
    }
}
#endif
