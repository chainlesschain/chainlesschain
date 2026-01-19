/**
 * 知识图谱分析模块
 * 提供图分析算法：中心性分析、社区检测、聚类等
 */

/**
 * 计算节点的度中心性（Degree Centrality）
 * 度中心性衡量节点的连接数量
 */
function calculateDegreeCentrality(nodes, edges) {
  const centrality = new Map();

  // 初始化所有节点的度为0
  nodes.forEach(node => {
    centrality.set(node.id, 0);
  });

  // 计算每个节点的度
  edges.forEach(edge => {
    centrality.set(edge.source_id, (centrality.get(edge.source_id) || 0) + 1);
    centrality.set(edge.target_id, (centrality.get(edge.target_id) || 0) + 1);
  });

  // 归一化（除以最大可能的度）
  const maxDegree = nodes.length - 1;
  if (maxDegree > 0) {
    centrality.forEach((value, key) => {
      centrality.set(key, value / maxDegree);
    });
  }

  return centrality;
}

/**
 * 计算节点的接近中心性（Closeness Centrality）
 * 接近中心性衡量节点到其他所有节点的平均距离
 */
function calculateClosenessCentrality(nodes, edges) {
  const centrality = new Map();

  // 构建邻接表
  const adjacency = buildAdjacencyList(nodes, edges);

  nodes.forEach(node => {
    const distances = bfs(node.id, adjacency, nodes);
    const totalDistance = Array.from(distances.values()).reduce((sum, d) => sum + d, 0);

    // 接近中心性 = (n-1) / 总距离
    const n = nodes.length;
    centrality.set(node.id, totalDistance > 0 ? (n - 1) / totalDistance : 0);
  });

  return centrality;
}

/**
 * 计算节点的中介中心性（Betweenness Centrality）
 * 中介中心性衡量节点在最短路径上出现的频率
 */
function calculateBetweennessCentrality(nodes, edges) {
  const centrality = new Map();
  nodes.forEach(node => centrality.set(node.id, 0));

  const adjacency = buildAdjacencyList(nodes, edges);

  // 对每对节点计算最短路径
  nodes.forEach(source => {
    const stack = [];
    const paths = new Map();
    const sigma = new Map();
    const distance = new Map();
    const delta = new Map();

    nodes.forEach(node => {
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

      const neighbors = adjacency.get(v) || [];
      neighbors.forEach(w => {
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

    // 回溯累积
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
  const n = nodes.length;
  const normFactor = (n - 1) * (n - 2) / 2;
  if (normFactor > 0) {
    centrality.forEach((value, key) => {
      centrality.set(key, value / normFactor);
    });
  }

  return centrality;
}

/**
 * PageRank 算法
 * 衡量节点的重要性，考虑链接的质量和数量
 */
function calculatePageRank(nodes, edges, dampingFactor = 0.85, maxIterations = 100, tolerance = 1e-6) {
  const pageRank = new Map();
  const n = nodes.length;

  // 初始化 PageRank 值
  nodes.forEach(node => {
    pageRank.set(node.id, 1 / n);
  });

  // 构建邻接表和出度
  const adjacency = buildAdjacencyList(nodes, edges);
  const outDegree = new Map();

  nodes.forEach(node => {
    outDegree.set(node.id, (adjacency.get(node.id) || []).length);
  });

  // 迭代计算
  for (let iter = 0; iter < maxIterations; iter++) {
    const newPageRank = new Map();
    let diff = 0;

    nodes.forEach(node => {
      let sum = 0;

      // 找到所有指向当前节点的节点
      edges.forEach(edge => {
        if (edge.target_id === node.id) {
          const sourceRank = pageRank.get(edge.source_id);
          const sourceDegree = outDegree.get(edge.source_id);
          if (sourceDegree > 0) {
            sum += sourceRank / sourceDegree;
          }
        }
      });

      const newRank = (1 - dampingFactor) / n + dampingFactor * sum;
      newPageRank.set(node.id, newRank);

      diff += Math.abs(newRank - pageRank.get(node.id));
    });

    // 更新 PageRank
    newPageRank.forEach((value, key) => {
      pageRank.set(key, value);
    });

    // 检查收敛
    if (diff < tolerance) {
      console.log(`PageRank 收敛于第 ${iter + 1} 次迭代`);
      break;
    }
  }

  return pageRank;
}

/**
 * Louvain 社区检测算法
 * 检测图中的社区结构
 */
function detectCommunities(nodes, edges) {
  // 初始化：每个节点是一个社区
  const communities = new Map();
  nodes.forEach((node, index) => {
    communities.set(node.id, index);
  });

  const adjacency = buildAdjacencyList(nodes, edges);
  const m = edges.length; // 总边数

  let improved = true;
  let iteration = 0;
  const maxIterations = 100;

  while (improved && iteration < maxIterations) {
    improved = false;
    iteration++;

    // 对每个节点尝试移动到邻居的社区
    nodes.forEach(node => {
      const currentCommunity = communities.get(node.id);
      const neighbors = adjacency.get(node.id) || [];

      // 计算移动到每个邻居社区的模块度增益
      const communityGains = new Map();

      neighbors.forEach(neighborId => {
        const neighborCommunity = communities.get(neighborId);
        if (neighborCommunity !== currentCommunity) {
          const gain = calculateModularityGain(
            node.id,
            currentCommunity,
            neighborCommunity,
            communities,
            adjacency,
            m
          );

          if (!communityGains.has(neighborCommunity) || gain > communityGains.get(neighborCommunity)) {
            communityGains.set(neighborCommunity, gain);
          }
        }
      });

      // 选择最大增益的社区
      let bestCommunity = currentCommunity;
      let maxGain = 0;

      communityGains.forEach((gain, community) => {
        if (gain > maxGain) {
          maxGain = gain;
          bestCommunity = community;
        }
      });

      // 如果有正增益，移动节点
      if (maxGain > 0 && bestCommunity !== currentCommunity) {
        communities.set(node.id, bestCommunity);
        improved = true;
      }
    });
  }

  // 重新编号社区（使其连续）
  const communityMap = new Map();
  let communityId = 0;

  communities.forEach((community, nodeId) => {
    if (!communityMap.has(community)) {
      communityMap.set(community, communityId++);
    }
    communities.set(nodeId, communityMap.get(community));
  });

  console.log(`社区检测完成，共 ${communityId} 个社区，迭代 ${iteration} 次`);

  return communities;
}

/**
 * 计算模块度增益
 */
function calculateModularityGain(nodeId, fromCommunity, toCommunity, communities, adjacency, m) {
  const neighbors = adjacency.get(nodeId) || [];

  // 计算节点到目标社区的边数
  let edgesToCommunity = 0;
  neighbors.forEach(neighborId => {
    if (communities.get(neighborId) === toCommunity) {
      edgesToCommunity++;
    }
  });

  // 计算节点从原社区的边数
  let edgesFromCommunity = 0;
  neighbors.forEach(neighborId => {
    if (communities.get(neighborId) === fromCommunity) {
      edgesFromCommunity++;
    }
  });

  // 简化的模块度增益计算
  const gain = (edgesToCommunity - edgesFromCommunity) / (2 * m);

  return gain;
}

/**
 * K-means 聚类算法（基于节点特征）
 */
function clusterNodes(nodes, edges, k = 5, maxIterations = 100) {
  if (nodes.length < k) {
    k = Math.max(1, nodes.length);
  }

  // 提取节点特征（度、中心性等）
  const features = extractNodeFeatures(nodes, edges);

  // 随机初始化聚类中心
  let centroids = [];
  const shuffled = [...nodes].sort(() => Math.random() - 0.5);
  for (let i = 0; i < k; i++) {
    centroids.push(features.get(shuffled[i].id));
  }

  const clusters = new Map();
  let changed = true;
  let iteration = 0;

  while (changed && iteration < maxIterations) {
    changed = false;
    iteration++;

    // 分配节点到最近的聚类中心
    nodes.forEach(node => {
      const feature = features.get(node.id);
      let minDist = Infinity;
      let bestCluster = 0;

      centroids.forEach((centroid, clusterIdx) => {
        const dist = euclideanDistance(feature, centroid);
        if (dist < minDist) {
          minDist = dist;
          bestCluster = clusterIdx;
        }
      });

      if (clusters.get(node.id) !== bestCluster) {
        clusters.set(node.id, bestCluster);
        changed = true;
      }
    });

    // 更新聚类中心
    const newCentroids = [];
    for (let i = 0; i < k; i++) {
      const clusterNodes = nodes.filter(node => clusters.get(node.id) === i);
      if (clusterNodes.length > 0) {
        const clusterFeatures = clusterNodes.map(node => features.get(node.id));
        newCentroids.push(calculateCentroid(clusterFeatures));
      } else {
        newCentroids.push(centroids[i]); // 保持原中心
      }
    }
    centroids = newCentroids;
  }

  console.log(`K-means 聚类完成，k=${k}，迭代 ${iteration} 次`);

  return clusters;
}

/**
 * 提取节点特征
 */
function extractNodeFeatures(nodes, edges) {
  const features = new Map();

  // 计算基本特征
  const degreeCentrality = calculateDegreeCentrality(nodes, edges);
  const adjacency = buildAdjacencyList(nodes, edges);

  nodes.forEach(node => {
    const degree = degreeCentrality.get(node.id) || 0;
    const neighbors = adjacency.get(node.id) || [];

    // 计算聚类系数
    let triangles = 0;
    let possibleTriangles = 0;

    for (let i = 0; i < neighbors.length; i++) {
      for (let j = i + 1; j < neighbors.length; j++) {
        possibleTriangles++;
        const neighbors_i = adjacency.get(neighbors[i]) || [];
        if (neighbors_i.includes(neighbors[j])) {
          triangles++;
        }
      }
    }

    const clusteringCoeff = possibleTriangles > 0 ? triangles / possibleTriangles : 0;

    features.set(node.id, {
      degree,
      clusteringCoeff,
      neighborCount: neighbors.length,
    });
  });

  return features;
}

/**
 * 计算欧几里得距离
 */
function euclideanDistance(feature1, feature2) {
  const keys = Object.keys(feature1);
  let sum = 0;

  keys.forEach(key => {
    const diff = (feature1[key] || 0) - (feature2[key] || 0);
    sum += diff * diff;
  });

  return Math.sqrt(sum);
}

/**
 * 计算质心
 */
function calculateCentroid(features) {
  if (features.length === 0) {return {};}

  const centroid = {};
  const keys = Object.keys(features[0]);

  keys.forEach(key => {
    const sum = features.reduce((acc, f) => acc + (f[key] || 0), 0);
    centroid[key] = sum / features.length;
  });

  return centroid;
}

/**
 * 构建邻接表
 */
function buildAdjacencyList(nodes, edges) {
  const adjacency = new Map();

  nodes.forEach(node => {
    adjacency.set(node.id, []);
  });

  edges.forEach(edge => {
    if (!adjacency.has(edge.source_id)) {
      adjacency.set(edge.source_id, []);
    }
    if (!adjacency.has(edge.target_id)) {
      adjacency.set(edge.target_id, []);
    }

    adjacency.get(edge.source_id).push(edge.target_id);
    adjacency.get(edge.target_id).push(edge.source_id); // 无向图
  });

  return adjacency;
}

/**
 * 广度优先搜索（BFS）
 */
function bfs(startId, adjacency, nodes) {
  const distances = new Map();
  const visited = new Set();
  const queue = [{ id: startId, distance: 0 }];

  nodes.forEach(node => {
    distances.set(node.id, Infinity);
  });
  distances.set(startId, 0);

  while (queue.length > 0) {
    const { id, distance } = queue.shift();

    if (visited.has(id)) {continue;}
    visited.add(id);

    const neighbors = adjacency.get(id) || [];
    neighbors.forEach(neighborId => {
      if (!visited.has(neighborId)) {
        const newDistance = distance + 1;
        if (newDistance < distances.get(neighborId)) {
          distances.set(neighborId, newDistance);
          queue.push({ id: neighborId, distance: newDistance });
        }
      }
    });
  }

  return distances;
}

/**
 * 查找关键节点（综合多个指标）
 */
function findKeyNodes(nodes, edges, topN = 10) {
  const degreeCentrality = calculateDegreeCentrality(nodes, edges);
  const pageRank = calculatePageRank(nodes, edges);

  // 综合评分
  const scores = new Map();
  nodes.forEach(node => {
    const degree = degreeCentrality.get(node.id) || 0;
    const rank = pageRank.get(node.id) || 0;
    const score = 0.5 * degree + 0.5 * rank;
    scores.set(node.id, score);
  });

  // 排序并返回 top N
  const sortedNodes = [...nodes].sort((a, b) => {
    return (scores.get(b.id) || 0) - (scores.get(a.id) || 0);
  });

  return sortedNodes.slice(0, topN).map(node => ({
    ...node,
    score: scores.get(node.id),
    degree: degreeCentrality.get(node.id),
    pageRank: pageRank.get(node.id),
  }));
}

/**
 * 分析图谱统计信息
 */
function analyzeGraphStats(nodes, edges) {
  const adjacency = buildAdjacencyList(nodes, edges);

  // 基本统计
  const nodeCount = nodes.length;
  const edgeCount = edges.length;
  const density = nodeCount > 1 ? (2 * edgeCount) / (nodeCount * (nodeCount - 1)) : 0;

  // 度分布
  const degrees = [];
  nodes.forEach(node => {
    degrees.push((adjacency.get(node.id) || []).length);
  });

  const avgDegree = degrees.reduce((sum, d) => sum + d, 0) / nodeCount;
  const maxDegree = Math.max(...degrees);
  const minDegree = Math.min(...degrees);

  // 连通性分析
  const components = findConnectedComponents(nodes, adjacency);

  // 聚类系数
  let totalClusteringCoeff = 0;
  nodes.forEach(node => {
    const neighbors = adjacency.get(node.id) || [];
    const k = neighbors.length;

    if (k < 2) {
      return;
    }

    let triangles = 0;
    for (let i = 0; i < neighbors.length; i++) {
      for (let j = i + 1; j < neighbors.length; j++) {
        const neighbors_i = adjacency.get(neighbors[i]) || [];
        if (neighbors_i.includes(neighbors[j])) {
          triangles++;
        }
      }
    }

    const possibleTriangles = (k * (k - 1)) / 2;
    totalClusteringCoeff += possibleTriangles > 0 ? triangles / possibleTriangles : 0;
  });

  const avgClusteringCoeff = nodeCount > 0 ? totalClusteringCoeff / nodeCount : 0;

  return {
    nodeCount,
    edgeCount,
    density,
    avgDegree,
    maxDegree,
    minDegree,
    componentCount: components.length,
    largestComponentSize: Math.max(...components.map(c => c.length)),
    avgClusteringCoeff,
  };
}

/**
 * 查找连通分量
 */
function findConnectedComponents(nodes, adjacency) {
  const visited = new Set();
  const components = [];

  nodes.forEach(node => {
    if (!visited.has(node.id)) {
      const component = [];
      const queue = [node.id];

      while (queue.length > 0) {
        const currentId = queue.shift();

        if (visited.has(currentId)) {continue;}
        visited.add(currentId);
        component.push(currentId);

        const neighbors = adjacency.get(currentId) || [];
        neighbors.forEach(neighborId => {
          if (!visited.has(neighborId)) {
            queue.push(neighborId);
          }
        });
      }

      components.push(component);
    }
  });

  return components;
}

module.exports = {
  calculateDegreeCentrality,
  calculateClosenessCentrality,
  calculateBetweennessCentrality,
  calculatePageRank,
  detectCommunities,
  clusterNodes,
  findKeyNodes,
  analyzeGraphStats,
  buildAdjacencyList,
};
