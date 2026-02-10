import Foundation
import CoreCommon

/// 知识图谱分析模块
/// 提供图分析算法：中心性分析、社区检测、聚类等
public class GraphAnalytics {

    // MARK: - Centrality Algorithms

    /// 计算节点的度中心性（Degree Centrality）
    /// 度中心性衡量节点的连接数量
    public static func calculateDegreeCentrality(
        nodes: [GraphNode],
        edges: [GraphEdge]
    ) -> [String: Double] {
        var centrality: [String: Double] = [:]

        // 初始化所有节点的度为0
        for node in nodes {
            centrality[node.id] = 0
        }

        // 计算每个节点的度
        for edge in edges {
            centrality[edge.sourceId, default: 0] += 1
            centrality[edge.targetId, default: 0] += 1
        }

        // 归一化（除以最大可能的度）
        let maxDegree = Double(nodes.count - 1)
        if maxDegree > 0 {
            for (key, value) in centrality {
                centrality[key] = value / maxDegree
            }
        }

        return centrality
    }

    /// 计算节点的接近中心性（Closeness Centrality）
    /// 接近中心性衡量节点到其他所有节点的平均距离
    public static func calculateClosenessCentrality(
        nodes: [GraphNode],
        edges: [GraphEdge]
    ) -> [String: Double] {
        var centrality: [String: Double] = [:]
        let adjacency = AdjacencyList(nodes: nodes, edges: edges)

        for node in nodes {
            let distances = bfs(startId: node.id, adjacency: adjacency, nodes: nodes)
            let totalDistance = distances.values.reduce(0, +)

            // 接近中心性 = (n-1) / 总距离
            let n = Double(nodes.count)
            centrality[node.id] = totalDistance > 0 ? (n - 1) / totalDistance : 0
        }

        return centrality
    }

    /// 计算节点的中介中心性（Betweenness Centrality）
    /// 中介中心性衡量节点在最短路径上出现的频率
    public static func calculateBetweennessCentrality(
        nodes: [GraphNode],
        edges: [GraphEdge]
    ) -> [String: Double] {
        var centrality: [String: Double] = [:]
        for node in nodes {
            centrality[node.id] = 0
        }

        let adjacency = AdjacencyList(nodes: nodes, edges: edges)

        // 对每个源节点执行Brandes算法
        for source in nodes {
            var stack: [String] = []
            var paths: [String: [String]] = [:]
            var sigma: [String: Double] = [:]
            var distance: [String: Int] = [:]
            var delta: [String: Double] = [:]

            for node in nodes {
                paths[node.id] = []
                sigma[node.id] = 0
                distance[node.id] = -1
                delta[node.id] = 0
            }

            sigma[source.id] = 1
            distance[source.id] = 0

            var queue = [source.id]

            // BFS
            while !queue.isEmpty {
                let v = queue.removeFirst()
                stack.append(v)

                let neighbors = adjacency.neighbors(of: v)
                for w in neighbors {
                    // 首次发现
                    if distance[w] == -1 {
                        queue.append(w)
                        distance[w] = (distance[v] ?? 0) + 1
                    }

                    // 最短路径
                    if distance[w] == (distance[v] ?? 0) + 1 {
                        sigma[w, default: 0] += sigma[v] ?? 0
                        paths[w]?.append(v)
                    }
                }
            }

            // 回溯累积
            while !stack.isEmpty {
                let w = stack.removeLast()
                let predecessors = paths[w] ?? []

                for v in predecessors {
                    let sigmaV = sigma[v] ?? 0
                    let sigmaW = sigma[w] ?? 0
                    let deltaW = delta[w] ?? 0

                    if sigmaW > 0 {
                        let c = (sigmaV / sigmaW) * (1 + deltaW)
                        delta[v, default: 0] += c
                    }
                }

                if w != source.id {
                    centrality[w, default: 0] += delta[w] ?? 0
                }
            }
        }

        // 归一化
        let n = Double(nodes.count)
        let normFactor = ((n - 1) * (n - 2)) / 2
        if normFactor > 0 {
            for (key, value) in centrality {
                centrality[key] = value / normFactor
            }
        }

        return centrality
    }

    /// PageRank 算法
    /// 衡量节点的重要性，考虑链接的质量和数量
    public static func calculatePageRank(
        nodes: [GraphNode],
        edges: [GraphEdge],
        dampingFactor: Double = 0.85,
        maxIterations: Int = 100,
        tolerance: Double = 1e-6
    ) -> [String: Double] {
        var pageRank: [String: Double] = [:]
        let n = Double(nodes.count)

        // 初始化 PageRank 值
        for node in nodes {
            pageRank[node.id] = 1 / n
        }

        // 构建邻接表和出度
        let adjacency = AdjacencyList(nodes: nodes, edges: edges)
        var outDegree: [String: Int] = [:]

        for node in nodes {
            outDegree[node.id] = adjacency.degree(of: node.id)
        }

        // 迭代计算
        for iter in 0..<maxIterations {
            var newPageRank: [String: Double] = [:]
            var diff: Double = 0

            for node in nodes {
                var sum: Double = 0

                // 找到所有指向当前节点的节点
                for edge in edges {
                    if edge.targetId == node.id {
                        let sourceRank = pageRank[edge.sourceId] ?? 0
                        let sourceDegree = outDegree[edge.sourceId] ?? 0
                        if sourceDegree > 0 {
                            sum += sourceRank / Double(sourceDegree)
                        }
                    }
                }

                let newRank = (1 - dampingFactor) / n + dampingFactor * sum
                newPageRank[node.id] = newRank

                diff += abs(newRank - (pageRank[node.id] ?? 0))
            }

            // 更新 PageRank
            pageRank = newPageRank

            // 检查收敛
            if diff < tolerance {
                Logger.shared.info("[GraphAnalytics] PageRank 收敛于第 \(iter + 1) 次迭代")
                break
            }
        }

        return pageRank
    }

    // MARK: - Community Detection

    /// Louvain 社区检测算法
    /// 检测图中的社区结构
    public static func detectCommunities(
        nodes: [GraphNode],
        edges: [GraphEdge]
    ) -> CommunityResult {
        // 初始化：每个节点是一个社区
        var communities: [String: Int] = [:]
        for (index, node) in nodes.enumerated() {
            communities[node.id] = index
        }

        let adjacency = AdjacencyList(nodes: nodes, edges: edges)
        let m = edges.count  // 总边数

        var improved = true
        var iteration = 0
        let maxIterations = 100

        while improved && iteration < maxIterations {
            improved = false
            iteration += 1

            // 对每个节点尝试移动到邻居的社区
            for node in nodes {
                let currentCommunity = communities[node.id] ?? 0
                let neighbors = adjacency.neighbors(of: node.id)

                // 计算移动到每个邻居社区的模块度增益
                var communityGains: [Int: Double] = [:]

                for neighborId in neighbors {
                    let neighborCommunity = communities[neighborId] ?? 0
                    if neighborCommunity != currentCommunity {
                        let gain = calculateModularityGain(
                            nodeId: node.id,
                            fromCommunity: currentCommunity,
                            toCommunity: neighborCommunity,
                            communities: communities,
                            adjacency: adjacency,
                            m: m
                        )

                        if communityGains[neighborCommunity] == nil || gain > (communityGains[neighborCommunity] ?? 0) {
                            communityGains[neighborCommunity] = gain
                        }
                    }
                }

                // 选择最大增益的社区
                var bestCommunity = currentCommunity
                var maxGain: Double = 0

                for (community, gain) in communityGains {
                    if gain > maxGain {
                        maxGain = gain
                        bestCommunity = community
                    }
                }

                // 如果有正增益，移动节点
                if maxGain > 0 && bestCommunity != currentCommunity {
                    communities[node.id] = bestCommunity
                    improved = true
                }
            }
        }

        // 重新编号社区（使其连续）
        var communityMap: [Int: Int] = [:]
        var communityId = 0

        for (nodeId, community) in communities {
            if communityMap[community] == nil {
                communityMap[community] = communityId
                communityId += 1
            }
            communities[nodeId] = communityMap[community]
        }

        Logger.shared.info("[GraphAnalytics] 社区检测完成，共 \(communityId) 个社区，迭代 \(iteration) 次")

        return CommunityResult(communities: communities)
    }

    /// 计算模块度增益
    private static func calculateModularityGain(
        nodeId: String,
        fromCommunity: Int,
        toCommunity: Int,
        communities: [String: Int],
        adjacency: AdjacencyList,
        m: Int
    ) -> Double {
        let neighbors = adjacency.neighbors(of: nodeId)

        // 计算节点到目标社区的边数
        var edgesToCommunity = 0
        for neighborId in neighbors {
            if communities[neighborId] == toCommunity {
                edgesToCommunity += 1
            }
        }

        // 计算节点从原社区的边数
        var edgesFromCommunity = 0
        for neighborId in neighbors {
            if communities[neighborId] == fromCommunity {
                edgesFromCommunity += 1
            }
        }

        // 简化的模块度增益计算
        let gain = Double(edgesToCommunity - edgesFromCommunity) / Double(2 * max(m, 1))

        return gain
    }

    // MARK: - Clustering

    /// K-means 聚类算法（基于节点特征）
    public static func clusterNodes(
        nodes: [GraphNode],
        edges: [GraphEdge],
        k: Int = 5,
        maxIterations: Int = 100
    ) -> ClusterResult {
        var actualK = min(k, max(1, nodes.count))

        // 提取节点特征
        let features = extractNodeFeatures(nodes: nodes, edges: edges)

        // 随机初始化聚类中心
        var centroids: [[String: Double]] = []
        let shuffled = nodes.shuffled()
        for i in 0..<actualK {
            if let feature = features[shuffled[i].id] {
                centroids.append(feature)
            }
        }

        var clusters: [String: Int] = [:]
        var changed = true
        var iteration = 0

        while changed && iteration < maxIterations {
            changed = false
            iteration += 1

            // 分配节点到最近的聚类中心
            for node in nodes {
                guard let feature = features[node.id] else { continue }

                var minDist = Double.infinity
                var bestCluster = 0

                for (clusterIdx, centroid) in centroids.enumerated() {
                    let dist = euclideanDistance(feature1: feature, feature2: centroid)
                    if dist < minDist {
                        minDist = dist
                        bestCluster = clusterIdx
                    }
                }

                if clusters[node.id] != bestCluster {
                    clusters[node.id] = bestCluster
                    changed = true
                }
            }

            // 更新聚类中心
            var newCentroids: [[String: Double]] = []
            for i in 0..<actualK {
                let clusterNodes = nodes.filter { clusters[$0.id] == i }
                if !clusterNodes.isEmpty {
                    let clusterFeatures = clusterNodes.compactMap { features[$0.id] }
                    newCentroids.append(calculateCentroid(features: clusterFeatures))
                } else {
                    newCentroids.append(centroids[i])  // 保持原中心
                }
            }
            centroids = newCentroids
        }

        Logger.shared.info("[GraphAnalytics] K-means 聚类完成，k=\(actualK)，迭代 \(iteration) 次")

        return ClusterResult(clusters: clusters, k: actualK)
    }

    /// 提取节点特征
    private static func extractNodeFeatures(
        nodes: [GraphNode],
        edges: [GraphEdge]
    ) -> [String: [String: Double]] {
        var features: [String: [String: Double]] = [:]

        // 计算基本特征
        let degreeCentrality = calculateDegreeCentrality(nodes: nodes, edges: edges)
        let adjacency = AdjacencyList(nodes: nodes, edges: edges)

        for node in nodes {
            let degree = degreeCentrality[node.id] ?? 0
            let neighbors = adjacency.neighbors(of: node.id)

            // 计算聚类系数
            var triangles = 0
            var possibleTriangles = 0

            for i in 0..<neighbors.count {
                for j in (i + 1)..<neighbors.count {
                    possibleTriangles += 1
                    let neighbors_i = adjacency.neighbors(of: neighbors[i])
                    if neighbors_i.contains(neighbors[j]) {
                        triangles += 1
                    }
                }
            }

            let clusteringCoeff = possibleTriangles > 0 ? Double(triangles) / Double(possibleTriangles) : 0

            features[node.id] = [
                "degree": degree,
                "clusteringCoeff": clusteringCoeff,
                "neighborCount": Double(neighbors.count)
            ]
        }

        return features
    }

    /// 计算欧几里得距离
    private static func euclideanDistance(
        feature1: [String: Double],
        feature2: [String: Double]
    ) -> Double {
        var sum: Double = 0

        for key in feature1.keys {
            let diff = (feature1[key] ?? 0) - (feature2[key] ?? 0)
            sum += diff * diff
        }

        return sqrt(sum)
    }

    /// 计算质心
    private static func calculateCentroid(features: [[String: Double]]) -> [String: Double] {
        guard !features.isEmpty else { return [:] }

        var centroid: [String: Double] = [:]
        let keys = features[0].keys

        for key in keys {
            let sum = features.reduce(0) { $0 + ($1[key] ?? 0) }
            centroid[key] = sum / Double(features.count)
        }

        return centroid
    }

    // MARK: - Graph Analysis

    /// 查找关键节点（综合多个指标）
    public static func findKeyNodes(
        nodes: [GraphNode],
        edges: [GraphEdge],
        topN: Int = 10
    ) -> [KeyNode] {
        let degreeCentrality = calculateDegreeCentrality(nodes: nodes, edges: edges)
        let pageRank = calculatePageRank(nodes: nodes, edges: edges)

        // 综合评分
        var scores: [String: Double] = [:]
        for node in nodes {
            let degree = degreeCentrality[node.id] ?? 0
            let rank = pageRank[node.id] ?? 0
            let score = 0.5 * degree + 0.5 * rank
            scores[node.id] = score
        }

        // 排序并返回 top N
        let sortedNodes = nodes.sorted { (scores[$0.id] ?? 0) > (scores[$1.id] ?? 0) }

        return sortedNodes.prefix(topN).map { node in
            KeyNode(
                id: node.id,
                label: node.label,
                score: scores[node.id] ?? 0,
                degree: degreeCentrality[node.id] ?? 0,
                pageRank: pageRank[node.id] ?? 0
            )
        }
    }

    /// 分析图谱统计信息
    public static func analyzeGraphStats(
        nodes: [GraphNode],
        edges: [GraphEdge]
    ) -> GraphStats {
        let adjacency = AdjacencyList(nodes: nodes, edges: edges)

        // 基本统计
        let nodeCount = nodes.count
        let edgeCount = edges.count
        let density = nodeCount > 1 ? Double(2 * edgeCount) / Double(nodeCount * (nodeCount - 1)) : 0

        // 度分布
        var degrees: [Int] = []
        for node in nodes {
            degrees.append(adjacency.degree(of: node.id))
        }

        let avgDegree = degrees.isEmpty ? 0 : Double(degrees.reduce(0, +)) / Double(nodeCount)
        let maxDegree = degrees.max() ?? 0
        let minDegree = degrees.min() ?? 0

        // 连通性分析
        let components = findConnectedComponents(nodes: nodes, adjacency: adjacency)

        // 聚类系数
        var totalClusteringCoeff: Double = 0
        for node in nodes {
            let neighbors = adjacency.neighbors(of: node.id)
            let k = neighbors.count

            if k < 2 { continue }

            var triangles = 0
            for i in 0..<neighbors.count {
                for j in (i + 1)..<neighbors.count {
                    let neighbors_i = adjacency.neighbors(of: neighbors[i])
                    if neighbors_i.contains(neighbors[j]) {
                        triangles += 1
                    }
                }
            }

            let possibleTriangles = (k * (k - 1)) / 2
            if possibleTriangles > 0 {
                totalClusteringCoeff += Double(triangles) / Double(possibleTriangles)
            }
        }

        let avgClusteringCoeff = nodeCount > 0 ? totalClusteringCoeff / Double(nodeCount) : 0

        // 按类型统计关系
        var linkRelations = 0
        var tagRelations = 0
        var semanticRelations = 0
        var temporalRelations = 0

        for edge in edges {
            switch edge.type {
            case .link, .reference, .mention:
                linkRelations += 1
            case .tag:
                tagRelations += 1
            case .semantic:
                semanticRelations += 1
            case .temporal:
                temporalRelations += 1
            }
        }

        return GraphStats(
            nodeCount: nodeCount,
            edgeCount: edgeCount,
            density: density,
            avgDegree: avgDegree,
            maxDegree: maxDegree,
            minDegree: minDegree,
            componentCount: components.count,
            largestComponentSize: components.map { $0.count }.max() ?? 0,
            avgClusteringCoeff: avgClusteringCoeff,
            linkRelations: linkRelations,
            tagRelations: tagRelations,
            semanticRelations: semanticRelations,
            temporalRelations: temporalRelations
        )
    }

    /// 查找连通分量
    private static func findConnectedComponents(
        nodes: [GraphNode],
        adjacency: AdjacencyList
    ) -> [[String]] {
        var visited = Set<String>()
        var components: [[String]] = []

        for node in nodes {
            if !visited.contains(node.id) {
                var component: [String] = []
                var queue = [node.id]

                while !queue.isEmpty {
                    let currentId = queue.removeFirst()

                    if visited.contains(currentId) { continue }
                    visited.insert(currentId)
                    component.append(currentId)

                    let neighbors = adjacency.neighbors(of: currentId)
                    for neighborId in neighbors {
                        if !visited.contains(neighborId) {
                            queue.append(neighborId)
                        }
                    }
                }

                components.append(component)
            }
        }

        return components
    }

    // MARK: - Helper Methods

    /// BFS（广度优先搜索）
    private static func bfs(
        startId: String,
        adjacency: AdjacencyList,
        nodes: [GraphNode]
    ) -> [String: Double] {
        var distances: [String: Double] = [:]
        var visited = Set<String>()
        var queue: [(id: String, distance: Double)] = [(startId, 0)]

        // 初始化距离为无穷大
        for node in nodes {
            distances[node.id] = Double.infinity
        }
        distances[startId] = 0

        while !queue.isEmpty {
            let (id, distance) = queue.removeFirst()

            if visited.contains(id) { continue }
            visited.insert(id)

            let neighbors = adjacency.neighbors(of: id)
            for neighborId in neighbors {
                if !visited.contains(neighborId) {
                    let newDistance = distance + 1
                    if newDistance < (distances[neighborId] ?? .infinity) {
                        distances[neighborId] = newDistance
                        queue.append((neighborId, newDistance))
                    }
                }
            }
        }

        return distances
    }
}
