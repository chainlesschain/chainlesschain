import Foundation
import Combine
import CoreCommon

// MARK: - Graph Manager

/// 知识图谱管理器
/// 提供图谱数据的加载、管理、分析和持久化功能
@MainActor
public class GraphManager: ObservableObject {

    // MARK: - Singleton

    public static let shared = GraphManager()

    // MARK: - Properties

    /// 当前图谱数据
    @Published public private(set) var graphData: GraphData = .empty

    /// 加载状态
    @Published public private(set) var isLoading: Bool = false

    /// 最后更新时间
    @Published public private(set) var lastUpdateTime: Date?

    /// 图谱统计
    @Published public private(set) var stats: GraphStats?

    /// 关系提取器
    private let extractor: GraphExtractor

    /// 数据库访问
    private var database: DatabaseProtocol?

    /// 笔记内容提供者
    public var getNoteContent: ((String) -> String?)?
    public var getNoteCreatedAt: ((String) -> Date?)?
    public var getNoteTags: ((String) -> [String])?
    public var getAllNotes: (() -> [GraphNode])?

    /// 缓存
    private var nodeCache: [String: GraphNode] = [:]
    private var edgeCache: [String: [GraphEdge]] = [:]
    private var cacheExpiry: Date = .distantPast

    /// 缓存有效期（秒）
    private let cacheLifetime: TimeInterval = 60

    /// 事件发布器
    public let graphLoaded = PassthroughSubject<GraphData, Never>()
    public let relationAdded = PassthroughSubject<GraphEdge, Never>()
    public let relationDeleted = PassthroughSubject<String, Never>()
    public let graphUpdated = PassthroughSubject<Void, Never>()

    // MARK: - Initialization

    private init() {
        self.extractor = GraphExtractor()
        setupExtractor()
        Logger.shared.info("[GraphManager] 已初始化")
    }

    /// 设置数据库
    public func setDatabase(_ db: DatabaseProtocol) {
        self.database = db
    }

    /// 设置提取器回调
    private func setupExtractor() {
        extractor.getNoteByTitle = { [weak self] title in
            guard let allNotes = self?.getAllNotes?() else { return nil }
            return allNotes.first { $0.label == title }
        }

        extractor.getNoteById = { [weak self] id in
            guard let allNotes = self?.getAllNotes?() else { return nil }
            return allNotes.first { $0.id == id }
        }

        extractor.getAllNotes = { [weak self] in
            return self?.getAllNotes?() ?? []
        }

        extractor.getNoteTags = { [weak self] id in
            return self?.getNoteTags?(id) ?? []
        }
    }

    // MARK: - Graph Loading

    /// 加载图谱数据
    public func loadGraphData(filters: GraphFilters = .default) async -> GraphData {
        isLoading = true
        defer { isLoading = false }

        Logger.shared.info("[GraphManager] 正在加载图谱数据...")

        // 检查缓存
        if Date() < cacheExpiry && !graphData.nodes.isEmpty {
            Logger.shared.info("[GraphManager] 使用缓存的图谱数据")
            return filters.apply(to: graphData)
        }

        do {
            // 从数据库加载
            let data = try await loadFromDatabase(filters: filters)

            graphData = data
            lastUpdateTime = Date()
            cacheExpiry = Date().addingTimeInterval(cacheLifetime)

            // 更新统计
            stats = GraphAnalytics.analyzeGraphStats(nodes: data.nodes, edges: data.edges)

            Logger.shared.info("[GraphManager] 图谱加载完成: \(data.nodes.count) 节点, \(data.edges.count) 边")

            graphLoaded.send(data)

            return data

        } catch {
            Logger.shared.error("[GraphManager] 加载图谱失败: \(error)")
            return .empty
        }
    }

    /// 从数据库加载图谱数据
    private func loadFromDatabase(filters: GraphFilters) async throws -> GraphData {
        guard let db = database else {
            Logger.shared.warning("[GraphManager] 数据库未设置，使用内存数据")
            return graphData
        }

        // 查询关系涉及的所有节点ID
        let nodeIds = try await db.queryRelatedNodeIds(
            relationTypes: Array(filters.relationTypes.map { $0.rawValue }),
            minWeight: filters.minWeight,
            limit: filters.limit
        )

        // 加载节点
        var nodes: [GraphNode] = []
        for nodeId in nodeIds {
            if let node = try await db.getGraphNode(nodeId) {
                if filters.nodeTypes.contains(node.type) {
                    nodes.append(node)
                }
            }
        }

        // 加载边
        let nodeIdSet = Set(nodes.map { $0.id })
        let edges = try await db.getGraphEdges(
            nodeIds: Array(nodeIdSet),
            relationTypes: Array(filters.relationTypes.map { $0.rawValue }),
            minWeight: filters.minWeight
        )

        return GraphData(nodes: nodes, edges: edges)
    }

    /// 刷新图谱
    public func refreshGraph() async {
        invalidateCache()
        _ = await loadGraphData()
        graphUpdated.send()
    }

    /// 使缓存失效
    public func invalidateCache() {
        cacheExpiry = .distantPast
        nodeCache.removeAll()
        edgeCache.removeAll()
    }

    // MARK: - Relation CRUD

    /// 添加关系
    @discardableResult
    public func addRelation(
        sourceId: String,
        targetId: String,
        type: GraphRelationType,
        weight: Double = 1.0,
        metadata: [String: String] = [:]
    ) async throws -> GraphEdge {
        Logger.shared.info("[GraphManager] 添加关系: \(sourceId) -> \(targetId) (\(type.rawValue))")

        let edge = GraphEdge(
            sourceId: sourceId,
            targetId: targetId,
            type: type,
            weight: weight,
            metadata: metadata
        )

        // 保存到数据库
        if let db = database {
            try await db.saveGraphEdge(edge)
        }

        // 更新内存数据
        var edges = graphData.edges
        edges.append(edge)
        graphData = GraphData(nodes: graphData.nodes, edges: edges)

        // 更新缓存
        edgeCache[sourceId, default: []].append(edge)
        edgeCache[targetId, default: []].append(edge)

        relationAdded.send(edge)
        graphUpdated.send()

        return edge
    }

    /// 批量添加关系
    public func addRelations(_ relations: [GraphEdge]) async throws -> Int {
        guard !relations.isEmpty else { return 0 }

        Logger.shared.info("[GraphManager] 批量添加 \(relations.count) 个关系")

        // 保存到数据库
        if let db = database {
            try await db.saveGraphEdges(relations)
        }

        // 更新内存数据
        var edges = graphData.edges
        edges.append(contentsOf: relations)
        graphData = GraphData(nodes: graphData.nodes, edges: edges)

        // 清空缓存
        edgeCache.removeAll()

        graphUpdated.send()

        return relations.count
    }

    /// 删除关系
    public func deleteRelation(edgeId: String) async throws {
        Logger.shared.info("[GraphManager] 删除关系: \(edgeId)")

        // 从数据库删除
        if let db = database {
            try await db.deleteGraphEdge(edgeId)
        }

        // 更新内存数据
        var edges = graphData.edges
        edges.removeAll { $0.id == edgeId }
        graphData = GraphData(nodes: graphData.nodes, edges: edges)

        // 清空缓存
        edgeCache.removeAll()

        relationDeleted.send(edgeId)
        graphUpdated.send()
    }

    /// 删除笔记的所有关系
    public func deleteRelations(
        noteId: String,
        types: [GraphRelationType]? = nil
    ) async throws -> Int {
        Logger.shared.info("[GraphManager] 删除笔记关系: \(noteId), 类型: \(types?.map { $0.rawValue } ?? ["all"])")

        var count = 0

        // 从数据库删除
        if let db = database {
            count = try await db.deleteGraphEdges(
                nodeId: noteId,
                types: types?.map { $0.rawValue }
            )
        }

        // 更新内存数据
        var edges = graphData.edges
        if let types = types {
            let typeSet = Set(types)
            edges.removeAll { edge in
                (edge.sourceId == noteId || edge.targetId == noteId) &&
                typeSet.contains(edge.type)
            }
        } else {
            edges.removeAll { edge in
                edge.sourceId == noteId || edge.targetId == noteId
            }
        }
        graphData = GraphData(nodes: graphData.nodes, edges: edges)

        // 清空缓存
        edgeCache.removeAll()

        graphUpdated.send()

        return count
    }

    // MARK: - Relation Building

    /// 处理单个笔记
    @discardableResult
    public func processNote(
        noteId: String,
        content: String,
        tags: [String] = []
    ) async throws -> Int {
        Logger.shared.info("[GraphManager] 处理笔记: \(noteId)")

        // 先删除旧的链接关系
        _ = try await deleteRelations(noteId: noteId, types: [.link, .mention])

        // 提取新关系
        let relations = extractor.processNote(noteId: noteId, content: content, tags: tags)

        // 添加关系
        if !relations.isEmpty {
            _ = try await addRelations(relations)
        }

        return relations.count
    }

    /// 批量处理所有笔记
    public func processAllNotes() async throws -> ProcessingResult {
        guard let allNotes = getAllNotes?() else {
            return ProcessingResult(processed: 0, linkRelations: 0, relations: [])
        }

        Logger.shared.info("[GraphManager] 批量处理 \(allNotes.count) 个笔记")

        let result = extractor.processAllNotes(
            notes: allNotes,
            getContent: { [weak self] id in
                self?.getNoteContent?(id)
            },
            getTags: { [weak self] id in
                self?.getNoteTags?(id) ?? []
            }
        )

        // 保存所有关系到数据库
        if !result.relations.isEmpty {
            _ = try await addRelations(result.relations)
        }

        return result
    }

    /// 构建标签关系
    public func buildTagRelations() async throws -> Int {
        guard let allNotes = getAllNotes?() else { return 0 }

        Logger.shared.info("[GraphManager] 构建标签关系...")

        // 先删除旧的标签关系
        if let db = database {
            _ = try await db.deleteGraphEdges(type: .tag)
        }

        // 构建新关系
        let relations = extractor.buildTagRelations(
            notes: allNotes,
            getTags: { [weak self] id in
                self?.getNoteTags?(id) ?? []
            }
        )

        // 保存关系
        if !relations.isEmpty {
            _ = try await addRelations(relations)
        }

        Logger.shared.info("[GraphManager] 构建了 \(relations.count) 个标签关系")

        return relations.count
    }

    /// 构建时间关系
    public func buildTemporalRelations(windowDays: Int = 7) async throws -> Int {
        guard let allNotes = getAllNotes?() else { return 0 }

        Logger.shared.info("[GraphManager] 构建时间关系 (窗口: \(windowDays) 天)...")

        // 先删除旧的时间关系
        if let db = database {
            _ = try await db.deleteGraphEdges(type: .temporal)
        }

        // 构建新关系
        let relations = extractor.buildTemporalRelations(
            notes: allNotes,
            getCreatedAt: { [weak self] id in
                self?.getNoteCreatedAt?(id)
            },
            windowDays: windowDays
        )

        // 保存关系
        if !relations.isEmpty {
            _ = try await addRelations(relations)
        }

        Logger.shared.info("[GraphManager] 构建了 \(relations.count) 个时间关系")

        return relations.count
    }

    // MARK: - Graph Queries

    /// 获取笔记的所有关系
    public func getRelations(noteId: String) -> [GraphEdge] {
        // 检查缓存
        if let cached = edgeCache[noteId], Date() < cacheExpiry {
            return cached
        }

        let relations = graphData.edges.filter { edge in
            edge.sourceId == noteId || edge.targetId == noteId
        }.sorted { $0.weight > $1.weight }

        // 更新缓存
        edgeCache[noteId] = relations

        return relations
    }

    /// 获取笔记的邻居
    public func getNeighbors(noteId: String) -> [GraphNode] {
        return graphData.getNeighbors(noteId)
    }

    /// 获取笔记的邻居（指定深度）
    public func getNeighborhood(noteId: String, depth: Int = 1) -> GraphData {
        var visitedNodes = Set<String>([noteId])
        var allEdges = Set<String>()
        var currentLevel = [noteId]

        for _ in 0..<depth {
            var nextLevel: [String] = []

            for nodeId in currentLevel {
                let edges = graphData.getNodeEdges(nodeId)

                for edge in edges {
                    let otherId = edge.sourceId == nodeId ? edge.targetId : edge.sourceId

                    if !visitedNodes.contains(otherId) {
                        visitedNodes.insert(otherId)
                        nextLevel.append(otherId)
                    }

                    allEdges.insert(edge.id)
                }
            }

            currentLevel = nextLevel
        }

        // 收集节点和边
        let nodes = graphData.nodes.filter { visitedNodes.contains($0.id) }
        let edges = graphData.edges.filter { allEdges.contains($0.id) }

        return GraphData(nodes: nodes, edges: edges)
    }

    /// 查找两个笔记之间的路径（BFS）
    public func findPath(
        sourceId: String,
        targetId: String,
        maxDepth: Int = 5
    ) -> RelationPath? {
        if sourceId == targetId {
            if let node = graphData.getNode(sourceId) {
                return RelationPath(nodes: [node], edges: [])
            }
            return nil
        }

        // BFS
        var queue: [(nodeId: String, path: [String], edgePath: [GraphEdge])] = [(sourceId, [sourceId], [])]
        var visited = Set<String>([sourceId])

        // 构建邻接表
        var adjacency: [String: [(nodeId: String, edge: GraphEdge)]] = [:]
        for edge in graphData.edges {
            adjacency[edge.sourceId, default: []].append((edge.targetId, edge))
            adjacency[edge.targetId, default: []].append((edge.sourceId, edge))
        }

        while !queue.isEmpty {
            let current = queue.removeFirst()

            // 检查深度
            if current.path.count > maxDepth {
                continue
            }

            // 检查邻居
            guard let neighbors = adjacency[current.nodeId] else { continue }

            for (neighborId, edge) in neighbors {
                if neighborId == targetId {
                    // 找到目标
                    var path = current.path
                    path.append(neighborId)

                    var edgePath = current.edgePath
                    edgePath.append(edge)

                    let nodes = path.compactMap { graphData.getNode($0) }
                    return RelationPath(nodes: nodes, edges: edgePath)
                }

                if !visited.contains(neighborId) {
                    visited.insert(neighborId)

                    var newPath = current.path
                    newPath.append(neighborId)

                    var newEdgePath = current.edgePath
                    newEdgePath.append(edge)

                    queue.append((neighborId, newPath, newEdgePath))
                }
            }
        }

        return nil
    }

    /// 查找相关笔记
    public func findRelatedNotes(
        noteId: String,
        limit: Int = 10,
        relationTypes: Set<GraphRelationType>? = nil
    ) -> [(node: GraphNode, weight: Double)] {
        var relatedWeights: [String: Double] = [:]

        // 收集相关笔记及其权重
        for edge in graphData.edges {
            // 过滤关系类型
            if let types = relationTypes, !types.contains(edge.type) {
                continue
            }

            if edge.sourceId == noteId {
                relatedWeights[edge.targetId, default: 0] += edge.weight
            } else if edge.targetId == noteId {
                relatedWeights[edge.sourceId, default: 0] += edge.weight
            }
        }

        // 按权重排序
        let sorted = relatedWeights.sorted { $0.value > $1.value }.prefix(limit)

        return sorted.compactMap { (id, weight) in
            if let node = graphData.getNode(id) {
                return (node, weight)
            }
            return nil
        }
    }

    /// 查找潜在链接
    public func findPotentialLinks(noteId: String, content: String) -> [PotentialLink] {
        return extractor.findPotentialLinks(noteId: noteId, content: content)
    }

    // MARK: - Analytics

    /// 计算中心性
    public func calculateCentrality(type: CentralityType) -> CentralityResult {
        let values: [String: Double]

        switch type {
        case .degree:
            values = GraphAnalytics.calculateDegreeCentrality(
                nodes: graphData.nodes,
                edges: graphData.edges
            )
        case .closeness:
            values = GraphAnalytics.calculateClosenessCentrality(
                nodes: graphData.nodes,
                edges: graphData.edges
            )
        case .betweenness:
            values = GraphAnalytics.calculateBetweennessCentrality(
                nodes: graphData.nodes,
                edges: graphData.edges
            )
        case .pagerank:
            values = GraphAnalytics.calculatePageRank(
                nodes: graphData.nodes,
                edges: graphData.edges
            )
        }

        return CentralityResult(type: type, values: values)
    }

    /// 社区检测
    public func detectCommunities() -> CommunityResult {
        return GraphAnalytics.detectCommunities(
            nodes: graphData.nodes,
            edges: graphData.edges
        )
    }

    /// 节点聚类
    public func clusterNodes(k: Int = 5) -> ClusterResult {
        return GraphAnalytics.clusterNodes(
            nodes: graphData.nodes,
            edges: graphData.edges,
            k: k
        )
    }

    /// 查找关键节点
    public func findKeyNodes(topN: Int = 10) -> [KeyNode] {
        return GraphAnalytics.findKeyNodes(
            nodes: graphData.nodes,
            edges: graphData.edges,
            topN: topN
        )
    }

    /// 更新图谱统计
    public func updateStats() {
        stats = GraphAnalytics.analyzeGraphStats(
            nodes: graphData.nodes,
            edges: graphData.edges
        )
    }

    // MARK: - Export

    /// 导出图谱
    public func exportGraph(format: GraphExportFormat) -> Data? {
        switch format {
        case .json:
            return exportAsJSON()
        case .csv:
            return exportAsCSV()
        case .graphml:
            return exportAsGraphML()
        case .gexf:
            return exportAsGEXF()
        }
    }

    private func exportAsJSON() -> Data? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try? encoder.encode(graphData)
    }

    private func exportAsCSV() -> Data? {
        var csv = "source_id,target_id,relation_type,weight\n"

        for edge in graphData.edges {
            csv += "\(edge.sourceId),\(edge.targetId),\(edge.type.rawValue),\(edge.weight)\n"
        }

        return csv.data(using: .utf8)
    }

    private func exportAsGraphML() -> Data? {
        var xml = """
        <?xml version="1.0" encoding="UTF-8"?>
        <graphml xmlns="http://graphml.graphdrawing.org/xmlns">
          <key id="label" for="node" attr.name="label" attr.type="string"/>
          <key id="type" for="node" attr.name="type" attr.type="string"/>
          <key id="weight" for="edge" attr.name="weight" attr.type="double"/>
          <key id="relation_type" for="edge" attr.name="relation_type" attr.type="string"/>
          <graph id="G" edgedefault="directed">

        """

        for node in graphData.nodes {
            xml += """
                <node id="\(escapeXML(node.id))">
                  <data key="label">\(escapeXML(node.label))</data>
                  <data key="type">\(node.type.rawValue)</data>
                </node>

            """
        }

        for edge in graphData.edges {
            xml += """
                <edge id="\(escapeXML(edge.id))" source="\(escapeXML(edge.sourceId))" target="\(escapeXML(edge.targetId))">
                  <data key="weight">\(edge.weight)</data>
                  <data key="relation_type">\(edge.type.rawValue)</data>
                </edge>

            """
        }

        xml += """
          </graph>
        </graphml>
        """

        return xml.data(using: .utf8)
    }

    private func exportAsGEXF() -> Data? {
        let dateFormatter = ISO8601DateFormatter()
        let now = dateFormatter.string(from: Date())

        var xml = """
        <?xml version="1.0" encoding="UTF-8"?>
        <gexf xmlns="http://www.gexf.net/1.2draft" version="1.2">
          <meta lastmodifieddate="\(now)">
            <creator>ChainlessChain</creator>
            <description>Knowledge Graph Export</description>
          </meta>
          <graph mode="static" defaultedgetype="directed">
            <nodes>

        """

        for node in graphData.nodes {
            xml += """
                  <node id="\(escapeXML(node.id))" label="\(escapeXML(node.label))"/>

            """
        }

        xml += """
            </nodes>
            <edges>

        """

        for edge in graphData.edges {
            xml += """
                  <edge id="\(escapeXML(edge.id))" source="\(escapeXML(edge.sourceId))" target="\(escapeXML(edge.targetId))" weight="\(edge.weight)"/>

            """
        }

        xml += """
            </edges>
          </graph>
        </gexf>
        """

        return xml.data(using: .utf8)
    }

    private func escapeXML(_ string: String) -> String {
        return string
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&apos;")
    }
}

// MARK: - Database Protocol

/// 数据库协议（图谱相关操作）
public protocol DatabaseProtocol {

    /// 查询涉及关系的节点ID
    func queryRelatedNodeIds(
        relationTypes: [String],
        minWeight: Double,
        limit: Int
    ) async throws -> [String]

    /// 获取图谱节点
    func getGraphNode(_ id: String) async throws -> GraphNode?

    /// 获取图谱边
    func getGraphEdges(
        nodeIds: [String],
        relationTypes: [String],
        minWeight: Double
    ) async throws -> [GraphEdge]

    /// 保存图谱边
    func saveGraphEdge(_ edge: GraphEdge) async throws

    /// 批量保存图谱边
    func saveGraphEdges(_ edges: [GraphEdge]) async throws

    /// 删除图谱边
    func deleteGraphEdge(_ id: String) async throws

    /// 删除节点的图谱边
    func deleteGraphEdges(nodeId: String, types: [String]?) async throws -> Int

    /// 删除指定类型的所有边
    func deleteGraphEdges(type: GraphRelationType) async throws -> Int
}

// MARK: - Mock Database (for testing)

/// 模拟数据库实现
public class MockGraphDatabase: DatabaseProtocol {

    private var nodes: [String: GraphNode] = [:]
    private var edges: [GraphEdge] = []

    public init() {}

    public func addNode(_ node: GraphNode) {
        nodes[node.id] = node
    }

    public func queryRelatedNodeIds(
        relationTypes: [String],
        minWeight: Double,
        limit: Int
    ) async throws -> [String] {
        var nodeIds = Set<String>()

        for edge in edges {
            if relationTypes.contains(edge.type.rawValue) && edge.weight >= minWeight {
                nodeIds.insert(edge.sourceId)
                nodeIds.insert(edge.targetId)
            }
        }

        return Array(nodeIds.prefix(limit))
    }

    public func getGraphNode(_ id: String) async throws -> GraphNode? {
        return nodes[id]
    }

    public func getGraphEdges(
        nodeIds: [String],
        relationTypes: [String],
        minWeight: Double
    ) async throws -> [GraphEdge] {
        let nodeIdSet = Set(nodeIds)
        return edges.filter { edge in
            nodeIdSet.contains(edge.sourceId) &&
            nodeIdSet.contains(edge.targetId) &&
            relationTypes.contains(edge.type.rawValue) &&
            edge.weight >= minWeight
        }
    }

    public func saveGraphEdge(_ edge: GraphEdge) async throws {
        // 检查是否已存在
        if !edges.contains(where: { $0.id == edge.id }) {
            edges.append(edge)
        }
    }

    public func saveGraphEdges(_ newEdges: [GraphEdge]) async throws {
        for edge in newEdges {
            if !edges.contains(where: {
                $0.sourceId == edge.sourceId &&
                $0.targetId == edge.targetId &&
                $0.type == edge.type
            }) {
                edges.append(edge)
            }
        }
    }

    public func deleteGraphEdge(_ id: String) async throws {
        edges.removeAll { $0.id == id }
    }

    public func deleteGraphEdges(nodeId: String, types: [String]?) async throws -> Int {
        let count = edges.count
        if let types = types {
            edges.removeAll { edge in
                (edge.sourceId == nodeId || edge.targetId == nodeId) &&
                types.contains(edge.type.rawValue)
            }
        } else {
            edges.removeAll { edge in
                edge.sourceId == nodeId || edge.targetId == nodeId
            }
        }
        return count - edges.count
    }

    public func deleteGraphEdges(type: GraphRelationType) async throws -> Int {
        let count = edges.count
        edges.removeAll { $0.type == type }
        return count - edges.count
    }
}
