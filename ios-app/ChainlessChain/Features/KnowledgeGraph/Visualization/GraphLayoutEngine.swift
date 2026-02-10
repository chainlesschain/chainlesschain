import Foundation
import CoreGraphics
import Combine
import CoreCommon

// MARK: - Layout Position

/// 节点位置
public struct NodePosition: Equatable {
    public var x: CGFloat
    public var y: CGFloat
    public var vx: CGFloat = 0  // x方向速度（力导向用）
    public var vy: CGFloat = 0  // y方向速度（力导向用）

    public init(x: CGFloat, y: CGFloat) {
        self.x = x
        self.y = y
    }

    public var point: CGPoint {
        CGPoint(x: x, y: y)
    }

    public static func random(in bounds: CGRect) -> NodePosition {
        NodePosition(
            x: CGFloat.random(in: bounds.minX...bounds.maxX),
            y: CGFloat.random(in: bounds.minY...bounds.maxY)
        )
    }
}

// MARK: - Layout Result

/// 布局结果
public struct LayoutResult {
    public let positions: [String: NodePosition]
    public let bounds: CGRect
    public let iterations: Int
    public let converged: Bool

    public init(
        positions: [String: NodePosition],
        bounds: CGRect,
        iterations: Int = 0,
        converged: Bool = true
    ) {
        self.positions = positions
        self.bounds = bounds
        self.iterations = iterations
        self.converged = converged
    }
}

// MARK: - Force Layout Config

/// 力导向布局配置
public struct ForceLayoutConfig {
    /// 排斥力系数
    public var repulsion: CGFloat = 300

    /// 边的理想长度
    public var edgeLength: CGFloat = 150

    /// 重力系数（向中心吸引）
    public var gravity: CGFloat = 0.1

    /// 摩擦力（速度衰减）
    public var friction: CGFloat = 0.6

    /// 最大迭代次数
    public var maxIterations: Int = 300

    /// 收敛阈值
    public var convergenceThreshold: CGFloat = 0.1

    /// 时间步长
    public var timeStep: CGFloat = 0.5

    public init() {}
}

// MARK: - Graph Layout Engine

/// 图谱布局引擎
/// 支持多种布局算法
public class GraphLayoutEngine: ObservableObject {

    // MARK: - Properties

    /// 当前布局类型
    @Published public var layoutType: GraphLayoutType = .force

    /// 布局配置
    public var forceConfig: ForceLayoutConfig = ForceLayoutConfig()

    /// 布局边界
    public var bounds: CGRect = CGRect(x: 0, y: 0, width: 800, height: 600)

    /// 节点位置
    @Published public private(set) var positions: [String: NodePosition] = [:]

    /// 是否正在布局
    @Published public private(set) var isLayouting: Bool = false

    /// 布局进度 (0-1)
    @Published public private(set) var progress: Double = 0

    /// 当前迭代
    private var currentIteration: Int = 0

    /// 布局任务
    private var layoutTask: Task<Void, Never>?

    /// 事件发布
    public let layoutStarted = PassthroughSubject<GraphLayoutType, Never>()
    public let layoutCompleted = PassthroughSubject<LayoutResult, Never>()
    public let layoutUpdated = PassthroughSubject<[String: NodePosition], Never>()

    // MARK: - Initialization

    public init() {}

    // MARK: - Layout Methods

    /// 执行布局
    @MainActor
    public func layout(
        nodes: [GraphNode],
        edges: [GraphEdge],
        type: GraphLayoutType? = nil,
        animated: Bool = true
    ) async -> LayoutResult {
        let targetType = type ?? layoutType
        layoutType = targetType

        isLayouting = true
        progress = 0
        layoutStarted.send(targetType)

        Logger.shared.info("[GraphLayoutEngine] 开始布局: \(targetType.rawValue), \(nodes.count) 节点")

        // 取消之前的布局任务
        layoutTask?.cancel()

        let result: LayoutResult

        switch targetType {
        case .force:
            result = await forceDirectedLayout(nodes: nodes, edges: edges, animated: animated)
        case .circular:
            result = circularLayout(nodes: nodes)
        case .hierarchical:
            result = hierarchicalLayout(nodes: nodes, edges: edges)
        case .grid:
            result = gridLayout(nodes: nodes)
        case .radial:
            result = radialLayout(nodes: nodes, edges: edges)
        }

        positions = result.positions
        isLayouting = false
        progress = 1

        Logger.shared.info("[GraphLayoutEngine] 布局完成: \(result.iterations) 迭代")

        layoutCompleted.send(result)

        return result
    }

    /// 停止布局
    public func stopLayout() {
        layoutTask?.cancel()
        isLayouting = false
    }

    /// 更新单个节点位置
    public func updateNodePosition(_ nodeId: String, position: NodePosition) {
        positions[nodeId] = position
        layoutUpdated.send(positions)
    }

    // MARK: - Force Directed Layout

    /// 力导向布局
    private func forceDirectedLayout(
        nodes: [GraphNode],
        edges: [GraphEdge],
        animated: Bool
    ) async -> LayoutResult {
        guard !nodes.isEmpty else {
            return LayoutResult(positions: [:], bounds: bounds)
        }

        // 初始化位置
        var nodePositions: [String: NodePosition] = [:]
        let center = CGPoint(x: bounds.midX, y: bounds.midY)

        for node in nodes {
            if let existingPos = positions[node.id] {
                nodePositions[node.id] = existingPos
            } else if let x = node.x, let y = node.y {
                nodePositions[node.id] = NodePosition(x: CGFloat(x), y: CGFloat(y))
            } else {
                // 随机初始位置（围绕中心）
                let angle = CGFloat.random(in: 0...(2 * .pi))
                let radius = CGFloat.random(in: 50...200)
                nodePositions[node.id] = NodePosition(
                    x: center.x + cos(angle) * radius,
                    y: center.y + sin(angle) * radius
                )
            }
        }

        // 构建邻接关系
        var adjacency: [String: Set<String>] = [:]
        for node in nodes {
            adjacency[node.id] = []
        }
        for edge in edges {
            adjacency[edge.sourceId, default: []].insert(edge.targetId)
            adjacency[edge.targetId, default: []].insert(edge.sourceId)
        }

        // 迭代计算
        var converged = false
        var iterations = 0

        while iterations < forceConfig.maxIterations && !converged {
            // 检查取消
            if Task.isCancelled { break }

            converged = true
            var maxDisplacement: CGFloat = 0

            // 计算每个节点的力
            for node in nodes {
                guard var pos = nodePositions[node.id] else { continue }

                var fx: CGFloat = 0
                var fy: CGFloat = 0

                // 1. 排斥力（所有节点之间）
                for otherNode in nodes {
                    if node.id == otherNode.id { continue }
                    guard let otherPos = nodePositions[otherNode.id] else { continue }

                    let dx = pos.x - otherPos.x
                    let dy = pos.y - otherPos.y
                    let distance = max(sqrt(dx * dx + dy * dy), 1)

                    // 库仑力
                    let force = forceConfig.repulsion / (distance * distance)
                    fx += (dx / distance) * force
                    fy += (dy / distance) * force
                }

                // 2. 吸引力（连接的节点之间）
                if let neighbors = adjacency[node.id] {
                    for neighborId in neighbors {
                        guard let neighborPos = nodePositions[neighborId] else { continue }

                        let dx = neighborPos.x - pos.x
                        let dy = neighborPos.y - pos.y
                        let distance = max(sqrt(dx * dx + dy * dy), 1)

                        // 胡克定律
                        let force = (distance - forceConfig.edgeLength) * 0.1
                        fx += (dx / distance) * force
                        fy += (dy / distance) * force
                    }
                }

                // 3. 重力（向中心）
                let dx = center.x - pos.x
                let dy = center.y - pos.y
                fx += dx * forceConfig.gravity
                fy += dy * forceConfig.gravity

                // 更新速度
                pos.vx = (pos.vx + fx * forceConfig.timeStep) * forceConfig.friction
                pos.vy = (pos.vy + fy * forceConfig.timeStep) * forceConfig.friction

                // 更新位置
                pos.x += pos.vx * forceConfig.timeStep
                pos.y += pos.vy * forceConfig.timeStep

                // 边界约束
                pos.x = max(bounds.minX + 20, min(bounds.maxX - 20, pos.x))
                pos.y = max(bounds.minY + 20, min(bounds.maxY - 20, pos.y))

                nodePositions[node.id] = pos

                // 检查收敛
                let displacement = sqrt(pos.vx * pos.vx + pos.vy * pos.vy)
                maxDisplacement = max(maxDisplacement, displacement)
            }

            converged = maxDisplacement < forceConfig.convergenceThreshold
            iterations += 1

            // 更新进度
            let newProgress = Double(iterations) / Double(forceConfig.maxIterations)
            await MainActor.run {
                self.progress = newProgress
                self.currentIteration = iterations

                // 动画更新
                if animated && iterations % 5 == 0 {
                    self.positions = nodePositions
                    self.layoutUpdated.send(nodePositions)
                }
            }

            // 让出控制权
            if iterations % 10 == 0 {
                await Task.yield()
            }
        }

        return LayoutResult(
            positions: nodePositions,
            bounds: calculateBounds(nodePositions),
            iterations: iterations,
            converged: converged
        )
    }

    // MARK: - Circular Layout

    /// 圆形布局
    private func circularLayout(nodes: [GraphNode]) -> LayoutResult {
        guard !nodes.isEmpty else {
            return LayoutResult(positions: [:], bounds: bounds)
        }

        var nodePositions: [String: NodePosition] = [:]
        let center = CGPoint(x: bounds.midX, y: bounds.midY)
        let radius = min(bounds.width, bounds.height) / 2 - 50

        for (index, node) in nodes.enumerated() {
            let angle = (CGFloat(index) / CGFloat(nodes.count)) * 2 * .pi - .pi / 2
            nodePositions[node.id] = NodePosition(
                x: center.x + cos(angle) * radius,
                y: center.y + sin(angle) * radius
            )
        }

        return LayoutResult(
            positions: nodePositions,
            bounds: calculateBounds(nodePositions),
            iterations: 1,
            converged: true
        )
    }

    // MARK: - Hierarchical Layout

    /// 层级布局
    private func hierarchicalLayout(
        nodes: [GraphNode],
        edges: [GraphEdge]
    ) -> LayoutResult {
        guard !nodes.isEmpty else {
            return LayoutResult(positions: [:], bounds: bounds)
        }

        // 计算节点层级（使用入度）
        var inDegree: [String: Int] = [:]
        for node in nodes {
            inDegree[node.id] = 0
        }
        for edge in edges {
            inDegree[edge.targetId, default: 0] += 1
        }

        // 分配层级
        var levels: [String: Int] = [:]
        var currentLevel = 0
        var remaining = Set(nodes.map { $0.id })

        // 构建邻接表
        var outNeighbors: [String: [String]] = [:]
        for edge in edges {
            outNeighbors[edge.sourceId, default: []].append(edge.targetId)
        }

        while !remaining.isEmpty {
            // 找出当前层的节点（入度为0或只依赖已分配的节点）
            let currentLevelNodes = remaining.filter { nodeId in
                let degree = inDegree[nodeId] ?? 0
                if degree == 0 { return true }

                // 检查所有入边是否来自已分配的节点
                let incomingFrom = edges.filter { $0.targetId == nodeId }.map { $0.sourceId }
                return incomingFrom.allSatisfy { !remaining.contains($0) }
            }

            if currentLevelNodes.isEmpty {
                // 打破循环依赖：选择入度最小的节点
                if let minNode = remaining.min(by: { (inDegree[$0] ?? 0) < (inDegree[$1] ?? 0) }) {
                    levels[minNode] = currentLevel
                    remaining.remove(minNode)
                }
            } else {
                for nodeId in currentLevelNodes {
                    levels[nodeId] = currentLevel
                    remaining.remove(nodeId)
                }
            }

            currentLevel += 1
        }

        let maxLevel = levels.values.max() ?? 0

        // 计算每层节点
        var levelNodes: [Int: [String]] = [:]
        for (nodeId, level) in levels {
            levelNodes[level, default: []].append(nodeId)
        }

        // 计算位置
        var nodePositions: [String: NodePosition] = [:]
        let levelHeight = bounds.height / CGFloat(maxLevel + 2)

        for level in 0...maxLevel {
            guard let nodesInLevel = levelNodes[level] else { continue }
            let levelWidth = bounds.width / CGFloat(nodesInLevel.count + 1)

            for (index, nodeId) in nodesInLevel.enumerated() {
                nodePositions[nodeId] = NodePosition(
                    x: bounds.minX + levelWidth * CGFloat(index + 1),
                    y: bounds.minY + levelHeight * CGFloat(level + 1)
                )
            }
        }

        return LayoutResult(
            positions: nodePositions,
            bounds: calculateBounds(nodePositions),
            iterations: 1,
            converged: true
        )
    }

    // MARK: - Grid Layout

    /// 网格布局
    private func gridLayout(nodes: [GraphNode]) -> LayoutResult {
        guard !nodes.isEmpty else {
            return LayoutResult(positions: [:], bounds: bounds)
        }

        var nodePositions: [String: NodePosition] = [:]

        let count = nodes.count
        let cols = Int(ceil(sqrt(Double(count))))
        let rows = Int(ceil(Double(count) / Double(cols)))

        let cellWidth = bounds.width / CGFloat(cols + 1)
        let cellHeight = bounds.height / CGFloat(rows + 1)

        for (index, node) in nodes.enumerated() {
            let row = index / cols
            let col = index % cols

            nodePositions[node.id] = NodePosition(
                x: bounds.minX + cellWidth * CGFloat(col + 1),
                y: bounds.minY + cellHeight * CGFloat(row + 1)
            )
        }

        return LayoutResult(
            positions: nodePositions,
            bounds: calculateBounds(nodePositions),
            iterations: 1,
            converged: true
        )
    }

    // MARK: - Radial Layout

    /// 径向布局
    private func radialLayout(
        nodes: [GraphNode],
        edges: [GraphEdge]
    ) -> LayoutResult {
        guard !nodes.isEmpty else {
            return LayoutResult(positions: [:], bounds: bounds)
        }

        // 找到中心节点（度最高的节点）
        var degree: [String: Int] = [:]
        for node in nodes {
            degree[node.id] = 0
        }
        for edge in edges {
            degree[edge.sourceId, default: 0] += 1
            degree[edge.targetId, default: 0] += 1
        }

        let centerNodeId = degree.max(by: { $0.value < $1.value })?.key ?? nodes[0].id

        // BFS分配层级
        var levels: [String: Int] = [centerNodeId: 0]
        var queue = [centerNodeId]
        var visited = Set([centerNodeId])

        // 邻接表
        var neighbors: [String: [String]] = [:]
        for edge in edges {
            neighbors[edge.sourceId, default: []].append(edge.targetId)
            neighbors[edge.targetId, default: []].append(edge.sourceId)
        }

        while !queue.isEmpty {
            let current = queue.removeFirst()
            let currentLevel = levels[current] ?? 0

            for neighborId in neighbors[current] ?? [] {
                if !visited.contains(neighborId) {
                    visited.insert(neighborId)
                    levels[neighborId] = currentLevel + 1
                    queue.append(neighborId)
                }
            }
        }

        // 处理未连接的节点
        for node in nodes {
            if levels[node.id] == nil {
                let maxLevel = (levels.values.max() ?? 0) + 1
                levels[node.id] = maxLevel
            }
        }

        let maxLevel = levels.values.max() ?? 0

        // 计算每层节点
        var levelNodes: [Int: [String]] = [:]
        for (nodeId, level) in levels {
            levelNodes[level, default: []].append(nodeId)
        }

        // 计算位置
        var nodePositions: [String: NodePosition] = [:]
        let center = CGPoint(x: bounds.midX, y: bounds.midY)
        let maxRadius = min(bounds.width, bounds.height) / 2 - 50
        let levelRadius = maxRadius / CGFloat(max(maxLevel, 1))

        for level in 0...maxLevel {
            guard let nodesInLevel = levelNodes[level] else { continue }

            if level == 0 {
                // 中心节点
                for nodeId in nodesInLevel {
                    nodePositions[nodeId] = NodePosition(x: center.x, y: center.y)
                }
            } else {
                let radius = levelRadius * CGFloat(level)
                for (index, nodeId) in nodesInLevel.enumerated() {
                    let angle = (CGFloat(index) / CGFloat(nodesInLevel.count)) * 2 * .pi - .pi / 2
                    nodePositions[nodeId] = NodePosition(
                        x: center.x + cos(angle) * radius,
                        y: center.y + sin(angle) * radius
                    )
                }
            }
        }

        return LayoutResult(
            positions: nodePositions,
            bounds: calculateBounds(nodePositions),
            iterations: 1,
            converged: true
        )
    }

    // MARK: - Helper Methods

    /// 计算边界
    private func calculateBounds(_ positions: [String: NodePosition]) -> CGRect {
        guard !positions.isEmpty else { return bounds }

        var minX = CGFloat.infinity
        var minY = CGFloat.infinity
        var maxX = -CGFloat.infinity
        var maxY = -CGFloat.infinity

        for pos in positions.values {
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

    /// 重置位置
    public func resetPositions() {
        positions.removeAll()
    }
}

// MARK: - Layout Type Extension

extension GraphLayoutType {
    public var displayName: String {
        switch self {
        case .force: return "力导向布局"
        case .circular: return "环形布局"
        case .hierarchical: return "层级布局"
        case .grid: return "网格布局"
        case .radial: return "径向布局"
        }
    }

    public var iconName: String {
        switch self {
        case .force: return "arrow.triangle.branch"
        case .circular: return "circle"
        case .hierarchical: return "rectangle.3.group"
        case .grid: return "square.grid.3x3"
        case .radial: return "sun.max"
        }
    }
}
