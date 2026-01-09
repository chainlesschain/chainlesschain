/**
 * 知识图谱分析算法
 *
 * 提供图论算法用于知识图谱分析
 * 包括社区检测、中心性分析、路径查找等
 */

class GraphAnalytics {
  constructor() {
    this.graph = null;
    this.nodes = [];
    this.edges = [];
    this.adjacencyList = new Map();
  }

  /**
   * 加载图数据
   */
  loadGraph(nodes, edges) {
    this.nodes = nodes;
    this.edges = edges;
    this.buildAdjacencyList();
  }

  /**
   * 构建邻接表
   */
  buildAdjacencyList() {
    this.adjacencyList.clear();

    // 初始化所有节点
    this.nodes.forEach(node => {
      this.adjacencyList.set(node.id, []);
    });

    // 添加边
    this.edges.forEach(edge => {
      const sourceNeighbors = this.adjacencyList.get(edge.source) || [];
      const targetNeighbors = this.adjacencyList.get(edge.target) || [];

      sourceNeighbors.push({
        node: edge.target,
        weight: edge.weight || 1,
        type: edge.relationType
      });

      targetNeighbors.push({
        node: edge.source,
        weight: edge.weight || 1,
        type: edge.relationType
      });

      this.adjacencyList.set(edge.source, sourceNeighbors);
      this.adjacencyList.set(edge.target, targetNeighbors);
    });
  }

  /**
   * 计算度中心性 (Degree Centrality)
   * 衡量节点的连接数量
   */
  calculateDegreeCentrality() {
    const centrality = new Map();
    const maxDegree = this.nodes.length - 1;

    this.nodes.forEach(node => {
      const neighbors = this.adjacencyList.get(node.id) || [];
      const degree = neighbors.length;
      const normalized = maxDegree > 0 ? degree / maxDegree : 0;

      centrality.set(node.id, {
        degree,
        normalized,
        rank: 0
      });
    });

    // 计算排名
    const sorted = Array.from(centrality.entries())
      .sort((a, b) => b[1].degree - a[1].degree);

    sorted.forEach((entry, index) => {
      entry[1].rank = index + 1;
    });

    return centrality;
  }

  /**
   * 计算接近中心性 (Closeness Centrality)
   * 衡量节点到其他所有节点的平均距离
   */
  calculateClosenessCentrality() {
    const centrality = new Map();

    this.nodes.forEach(node => {
      const distances = this.bfs(node.id);
      let totalDistance = 0;
      let reachableNodes = 0;

      distances.forEach((distance, targetId) => {
        if (distance > 0 && distance < Infinity) {
          totalDistance += distance;
          reachableNodes++;
        }
      });

      const closeness = reachableNodes > 0
        ? reachableNodes / totalDistance
        : 0;

      const normalized = reachableNodes > 0
        ? (reachableNodes / (this.nodes.length - 1)) * closeness
        : 0;

      centrality.set(node.id, {
        closeness,
        normalized,
        reachableNodes
      });
    });

    return centrality;
  }

  /**
   * 计算介数中心性 (Betweenness Centrality)
   * 衡量节点在最短路径上出现的频率
   */
  calculateBetweennessCentrality() {
    const centrality = new Map();

    // 初始化
    this.nodes.forEach(node => {
      centrality.set(node.id, 0);
    });

    // 对每个节点作为起点
    this.nodes.forEach(source => {
      const stack = [];
      const paths = new Map();
      const sigma = new Map();
      const distance = new Map();
      const delta = new Map();

      // 初始化
      this.nodes.forEach(node => {
        paths.set(node.id, []);
        sigma.set(node.id, 0);
        distance.set(node.id, -1);
        delta.set(node.id, 0);
      });

      sigma.set(source.id, 1);
      distance.set(source.id, 0);

      const queue = [source.id];

      // BFS
      while (queue.length > 0) {
        const v = queue.shift();
        stack.push(v);

        const neighbors = this.adjacencyList.get(v) || [];
        neighbors.forEach(neighbor => {
          const w = neighbor.node;

          // 首次发现
          if (distance.get(w) < 0) {
            queue.push(w);
            distance.set(w, distance.get(v) + 1);
          }

          // 最短路径
          if (distance.get(w) === distance.get(v) + 1) {
            sigma.set(w, sigma.get(w) + sigma.get(v));
            paths.get(w).push(v);
          }
        });
      }

      // 累积
      while (stack.length > 0) {
        const w = stack.pop();
        const predecessors = paths.get(w);

        predecessors.forEach(v => {
          const c = (sigma.get(v) / sigma.get(w)) * (1 + delta.get(w));
          delta.set(v, delta.get(v) + c);
        });

        if (w !== source.id) {
          centrality.set(w, centrality.get(w) + delta.get(w));
        }
      }
    });

    // 归一化
    const n = this.nodes.length;
    const normFactor = n > 2 ? 1 / ((n - 1) * (n - 2)) : 1;

    centrality.forEach((value, key) => {
      centrality.set(key, value * normFactor);
    });

    return centrality;
  }

  /**
   * PageRank算法
   * 衡量节点的重要性
   */
  calculatePageRank(dampingFactor = 0.85, maxIterations = 100, tolerance = 1e-6) {
    const pageRank = new Map();
    const n = this.nodes.length;

    // 初始化
    this.nodes.forEach(node => {
      pageRank.set(node.id, 1 / n);
    });

    // 迭代计算
    for (let iter = 0; iter < maxIterations; iter++) {
      const newPageRank = new Map();
      let diff = 0;

      this.nodes.forEach(node => {
        let sum = 0;

        // 计算所有指向当前节点的节点贡献
        this.nodes.forEach(otherNode => {
          const neighbors = this.adjacencyList.get(otherNode.id) || [];
          const hasEdge = neighbors.some(n => n.node === node.id);

          if (hasEdge && neighbors.length > 0) {
            sum += pageRank.get(otherNode.id) / neighbors.length;
          }
        });

        const newValue = (1 - dampingFactor) / n + dampingFactor * sum;
        newPageRank.set(node.id, newValue);

        diff += Math.abs(newValue - pageRank.get(node.id));
      });

      // 更新
      newPageRank.forEach((value, key) => {
        pageRank.set(key, value);
      });

      // 收敛检查
      if (diff < tolerance) {
        console.log(`PageRank converged after ${iter + 1} iterations`);
        break;
      }
    }

    return pageRank;
  }

  /**
   * 社区检测 - Louvain算法
   * 识别图中的社区结构
   */
  detectCommunities() {
    const communities = new Map();
    let communityId = 0;

    // 初始化：每个节点是一个社区
    this.nodes.forEach(node => {
      communities.set(node.id, communityId++);
    });

    let improved = true;
    let iteration = 0;
    const maxIterations = 100;

    while (improved && iteration < maxIterations) {
      improved = false;
      iteration++;

      // 对每个节点尝试移动到邻居社区
      this.nodes.forEach(node => {
        const currentCommunity = communities.get(node.id);
        const neighbors = this.adjacencyList.get(node.id) || [];

        // 计算移动到每个邻居社区的模块度增益
        const communityGains = new Map();

        neighbors.forEach(neighbor => {
          const neighborCommunity = communities.get(neighbor.node);
          if (!communityGains.has(neighborCommunity)) {
            communityGains.set(neighborCommunity, 0);
          }
          communityGains.set(
            neighborCommunity,
            communityGains.get(neighborCommunity) + (neighbor.weight || 1)
          );
        });

        // 找到最佳社区
        let bestCommunity = currentCommunity;
        let bestGain = communityGains.get(currentCommunity) || 0;

        communityGains.forEach((gain, community) => {
          if (gain > bestGain) {
            bestGain = gain;
            bestCommunity = community;
          }
        });

        // 移动到最佳社区
        if (bestCommunity !== currentCommunity) {
          communities.set(node.id, bestCommunity);
          improved = true;
        }
      });
    }

    // 重新编号社区（使其连续）
    const uniqueCommunities = new Set(communities.values());
    const communityMap = new Map();
    let newId = 0;

    uniqueCommunities.forEach(oldId => {
      communityMap.set(oldId, newId++);
    });

    communities.forEach((oldId, nodeId) => {
      communities.set(nodeId, communityMap.get(oldId));
    });

    return {
      communities,
      count: uniqueCommunities.size,
      iterations: iteration
    };
  }

  /**
   * 最短路径 - Dijkstra算法
   */
  findShortestPath(sourceId, targetId) {
    const distances = new Map();
    const previous = new Map();
    const unvisited = new Set();

    // 初始化
    this.nodes.forEach(node => {
      distances.set(node.id, Infinity);
      previous.set(node.id, null);
      unvisited.add(node.id);
    });

    distances.set(sourceId, 0);

    while (unvisited.size > 0) {
      // 找到距离最小的未访问节点
      let current = null;
      let minDistance = Infinity;

      unvisited.forEach(nodeId => {
        const distance = distances.get(nodeId);
        if (distance < minDistance) {
          minDistance = distance;
          current = nodeId;
        }
      });

      if (current === null || minDistance === Infinity) {
        break;
      }

      unvisited.delete(current);

      // 到达目标
      if (current === targetId) {
        break;
      }

      // 更新邻居距离
      const neighbors = this.adjacencyList.get(current) || [];
      neighbors.forEach(neighbor => {
        if (unvisited.has(neighbor.node)) {
          const alt = distances.get(current) + (neighbor.weight || 1);
          if (alt < distances.get(neighbor.node)) {
            distances.set(neighbor.node, alt);
            previous.set(neighbor.node, current);
          }
        }
      });
    }

    // 重建路径
    const path = [];
    let current = targetId;

    while (current !== null) {
      path.unshift(current);
      current = previous.get(current);
    }

    return {
      path: path.length > 1 ? path : [],
      distance: distances.get(targetId),
      exists: distances.get(targetId) < Infinity
    };
  }

  /**
   * BFS广度优先搜索
   */
  bfs(startId) {
    const distances = new Map();
    const queue = [startId];

    this.nodes.forEach(node => {
      distances.set(node.id, Infinity);
    });

    distances.set(startId, 0);

    while (queue.length > 0) {
      const current = queue.shift();
      const currentDistance = distances.get(current);

      const neighbors = this.adjacencyList.get(current) || [];
      neighbors.forEach(neighbor => {
        if (distances.get(neighbor.node) === Infinity) {
          distances.set(neighbor.node, currentDistance + 1);
          queue.push(neighbor.node);
        }
      });
    }

    return distances;
  }

  /**
   * 获取N跳邻居
   */
  getNHopNeighbors(nodeId, hops = 1) {
    const visited = new Set();
    const neighbors = new Map();

    const queue = [{ id: nodeId, hop: 0 }];
    visited.add(nodeId);

    while (queue.length > 0) {
      const { id, hop } = queue.shift();

      if (hop < hops) {
        const nodeNeighbors = this.adjacencyList.get(id) || [];

        nodeNeighbors.forEach(neighbor => {
          if (!visited.has(neighbor.node)) {
            visited.add(neighbor.node);
            neighbors.set(neighbor.node, hop + 1);
            queue.push({ id: neighbor.node, hop: hop + 1 });
          }
        });
      }
    }

    return neighbors;
  }

  /**
   * 计算图的统计信息
   */
  calculateStatistics() {
    const degreeCentrality = this.calculateDegreeCentrality();
    const pageRank = this.calculatePageRank();
    const communities = this.detectCommunities();

    // 度分布
    const degrees = Array.from(degreeCentrality.values()).map(c => c.degree);
    const avgDegree = degrees.reduce((a, b) => a + b, 0) / degrees.length;
    const maxDegree = Math.max(...degrees);

    // 连通性
    const distances = this.bfs(this.nodes[0]?.id);
    const reachableNodes = Array.from(distances.values())
      .filter(d => d < Infinity).length;

    return {
      nodeCount: this.nodes.length,
      edgeCount: this.edges.length,
      avgDegree: avgDegree.toFixed(2),
      maxDegree,
      density: (2 * this.edges.length) / (this.nodes.length * (this.nodes.length - 1)),
      communityCount: communities.count,
      isConnected: reachableNodes === this.nodes.length,
      reachableNodes
    };
  }
}

module.exports = GraphAnalytics;
