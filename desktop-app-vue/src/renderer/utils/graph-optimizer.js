/**
 * 知识图谱渲染性能优化模块
 * 优化大规模图谱的渲染性能
 */

class GraphPerformanceOptimizer {
  constructor() {
    // 性能配置
    this.config = {
      // LOD配置
      maxNodesForFull: 200,
      maxNodesForSimplified: 500,
      maxNodesForClustering: 1000,

      // 渲染配置
      enableProgressive: true,
      progressiveChunkSize: 100,
      progressiveDelay: 16, // 约60fps

      // 缓存配置
      enableLayoutCache: true,
      cacheExpiry: 300000, // 5分钟

      // WebGL配置
      enableWebGL: true,
      webglThreshold: 500,
    };

    // 缓存
    this.layoutCache = new Map();
    this.renderCache = new Map();

    // 性能指标
    this.metrics = {
      renderCount: 0,
      averageRenderTime: 0,
      renderTimes: [],
      cacheHits: 0,
      fps: 0,
    };

    // FPS监控
    this.fpsFrames = [];
    this.lastFrameTime = performance.now();
  }

  /**
   * 优化节点数据
   * 根据节点数量选择合适的渲染策略
   */
  optimizeNodes(nodes, edges) {
    const nodeCount = nodes.length;
    console.log(`[GraphOptimizer] 优化 ${nodeCount} 个节点`);

    if (nodeCount <= this.config.maxNodesForFull) {
      // 全量渲染
      return {
        nodes: this.enhanceNodes(nodes),
        edges: this.enhanceEdges(edges),
        strategy: 'full',
      };
    } else if (nodeCount <= this.config.maxNodesForSimplified) {
      // 简化渲染
      return {
        nodes: this.simplifyNodes(nodes),
        edges: this.simplifyEdges(edges),
        strategy: 'simplified',
      };
    } else {
      // 聚合渲染
      return {
        nodes: this.clusterNodes(nodes, edges),
        edges: this.clusterEdges(edges),
        strategy: 'clustered',
      };
    }
  }

  /**
   * 增强节点（全量渲染）
   */
  enhanceNodes(nodes) {
    return nodes.map(node => ({
      ...node,
      symbolSize: this.calculateNodeSize(node),
      itemStyle: {
        color: this.getNodeColor(node),
        borderColor: '#fff',
        borderWidth: 2,
        shadowBlur: 10,
        shadowColor: 'rgba(0, 0, 0, 0.3)',
      },
      label: {
        show: true,
        formatter: node.title,
        fontSize: 12,
      },
    }));
  }

  /**
   * 简化节点（简化渲染）
   */
  simplifyNodes(nodes) {
    return nodes.map(node => ({
      ...node,
      symbolSize: this.calculateNodeSize(node) * 0.8,
      itemStyle: {
        color: this.getNodeColor(node),
        borderWidth: 1,
      },
      label: {
        show: node.importance > 0.7, // 只显示重要节点的标签
        formatter: node.title,
        fontSize: 10,
      },
    }));
  }

  /**
   * 聚合节点（聚合渲染）
   */
  clusterNodes(nodes, edges) {
    console.log('[GraphOptimizer] 执行节点聚合');

    // 使用社区检测算法进行聚合
    const communities = this.detectCommunities(nodes, edges);

    // 为每个社区创建一个聚合节点
    const clusteredNodes = communities.map((community, index) => ({
      id: `cluster-${index}`,
      name: `社区 ${index + 1}`,
      title: `社区 ${index + 1} (${community.nodes.length}个节点)`,
      type: 'cluster',
      symbolSize: Math.min(50 + community.nodes.length * 2, 100),
      itemStyle: {
        color: this.getClusterColor(index),
      },
      label: {
        show: true,
        formatter: `社区${index + 1}\n${community.nodes.length}`,
      },
      members: community.nodes,
    }));

    return clusteredNodes;
  }

  /**
   * 简化边
   */
  simplifyEdges(edges) {
    // 只保留权重较高的边
    return edges
      .filter(edge => edge.weight > 0.5)
      .map(edge => ({
        ...edge,
        lineStyle: {
          width: 1,
          opacity: 0.5,
        },
      }));
  }

  /**
   * 聚合边
   */
  clusterEdges(edges) {
    // 聚合社区之间的边
    const clusterEdges = new Map();

    edges.forEach(edge => {
      const sourceCluster = this.getNodeCluster(edge.source);
      const targetCluster = this.getNodeCluster(edge.target);

      if (sourceCluster !== targetCluster) {
        const key = `${sourceCluster}-${targetCluster}`;
        if (!clusterEdges.has(key)) {
          clusterEdges.set(key, {
            source: `cluster-${sourceCluster}`,
            target: `cluster-${targetCluster}`,
            weight: 0,
            count: 0,
          });
        }

        const clusterEdge = clusterEdges.get(key);
        clusterEdge.weight += edge.weight;
        clusterEdge.count++;
      }
    });

    return Array.from(clusterEdges.values()).map(edge => ({
      ...edge,
      lineStyle: {
        width: Math.min(edge.count / 2, 5),
        opacity: 0.6,
      },
    }));
  }

  /**
   * 渐进式渲染
   */
  async progressiveRender(nodes, edges, renderCallback) {
    const chunkSize = this.config.progressiveChunkSize;
    const delay = this.config.progressiveDelay;

    console.log(`[GraphOptimizer] 渐进式渲染: ${nodes.length} 个节点`);

    for (let i = 0; i < nodes.length; i += chunkSize) {
      const chunk = nodes.slice(i, i + chunkSize);
      const chunkEdges = edges.filter(
        edge =>
          chunk.some(n => n.id === edge.source) ||
          chunk.some(n => n.id === edge.target)
      );

      await renderCallback(chunk, chunkEdges);

      // 让出主线程
      await new Promise(resolve => setTimeout(resolve, delay));

      // 更新进度
      const progress = Math.min((i + chunkSize) / nodes.length * 100, 100);
      this.emitProgress(progress);
    }

    console.log('[GraphOptimizer] 渐进式渲染完成');
  }

  /**
   * 布局缓存
   */
  getCachedLayout(graphId, nodes, edges) {
    const cacheKey = this.generateCacheKey(graphId, nodes, edges);

    if (this.config.enableLayoutCache && this.layoutCache.has(cacheKey)) {
      const cached = this.layoutCache.get(cacheKey);

      // 检查是否过期
      if (Date.now() - cached.timestamp < this.config.cacheExpiry) {
        console.log('[GraphOptimizer] 使用缓存的布局');
        this.metrics.cacheHits++;
        return cached.layout;
      } else {
        this.layoutCache.delete(cacheKey);
      }
    }

    return null;
  }

  /**
   * 保存布局到缓存
   */
  cacheLayout(graphId, nodes, edges, layout) {
    const cacheKey = this.generateCacheKey(graphId, nodes, edges);

    this.layoutCache.set(cacheKey, {
      layout,
      timestamp: Date.now(),
    });

    // 限制缓存大小
    if (this.layoutCache.size > 10) {
      const firstKey = this.layoutCache.keys().next().value;
      this.layoutCache.delete(firstKey);
    }
  }

  /**
   * 生成缓存键
   */
  generateCacheKey(graphId, nodes, edges) {
    const nodeIds = nodes.map(n => n.id).sort().join(',');
    const edgeIds = edges.map(e => `${e.source}-${e.target}`).sort().join(',');
    return `${graphId}-${nodeIds.length}-${edgeIds.length}`;
  }

  /**
   * WebGL渲染优化
   */
  shouldUseWebGL(nodeCount) {
    return this.config.enableWebGL && nodeCount >= this.config.webglThreshold;
  }

  /**
   * 获取WebGL配置
   */
  getWebGLConfig() {
    return {
      renderer: 'webgl',
      progressive: {
        enabled: true,
        chunkSize: this.config.progressiveChunkSize,
      },
      animation: false, // WebGL模式下禁用动画以提高性能
    };
  }

  /**
   * 视口裁剪
   * 只渲染可见区域的节点
   */
  cullNodes(nodes, viewport) {
    const { x, y, width, height, zoom } = viewport;

    return nodes.filter(node => {
      const nodeX = node.x || 0;
      const nodeY = node.y || 0;

      return (
        nodeX >= x - width / zoom &&
        nodeX <= x + width / zoom &&
        nodeY >= y - height / zoom &&
        nodeY <= y + height / zoom
      );
    });
  }

  /**
   * 计算节点大小
   */
  calculateNodeSize(node) {
    const baseSize = 20;
    const importance = node.importance || 0.5;
    const relationCount = node.relationCount || 0;

    return baseSize + importance * 20 + Math.min(relationCount * 2, 30);
  }

  /**
   * 获取节点颜色
   */
  getNodeColor(node) {
    const colors = {
      note: '#1890ff',
      document: '#52c41a',
      conversation: '#faad14',
      web_clip: '#f5222d',
    };

    return colors[node.type] || '#8c8c8c';
  }

  /**
   * 获取聚合节点颜色
   */
  getClusterColor(index) {
    const colors = [
      '#1890ff', '#52c41a', '#faad14', '#f5222d',
      '#722ed1', '#13c2c2', '#eb2f96', '#fa8c16',
    ];

    return colors[index % colors.length];
  }

  /**
   * 社区检测（简化版Louvain算法）
   */
  detectCommunities(nodes, edges) {
    // 构建邻接表
    const adjacency = new Map();
    nodes.forEach(node => adjacency.set(node.id, []));

    edges.forEach(edge => {
      if (adjacency.has(edge.source)) {
        adjacency.get(edge.source).push(edge.target);
      }
      if (adjacency.has(edge.target)) {
        adjacency.get(edge.target).push(edge.source);
      }
    });

    // 初始化：每个节点为一个社区
    const communities = new Map();
    nodes.forEach((node, index) => {
      communities.set(node.id, index);
    });

    // 迭代优化（简化版）
    let improved = true;
    let iteration = 0;
    const maxIterations = 10;

    while (improved && iteration < maxIterations) {
      improved = false;
      iteration++;

      for (const node of nodes) {
        const neighbors = adjacency.get(node.id) || [];
        const communityScores = new Map();

        // 计算移动到每个邻居社区的得分
        neighbors.forEach(neighborId => {
          const community = communities.get(neighborId);
          communityScores.set(
            community,
            (communityScores.get(community) || 0) + 1
          );
        });

        // 选择得分最高的社区
        let bestCommunity = communities.get(node.id);
        let bestScore = 0;

        for (const [community, score] of communityScores.entries()) {
          if (score > bestScore) {
            bestScore = score;
            bestCommunity = community;
          }
        }

        // 如果找到更好的社区，移动节点
        if (bestCommunity !== communities.get(node.id)) {
          communities.set(node.id, bestCommunity);
          improved = true;
        }
      }
    }

    // 整理社区结果
    const communityMap = new Map();
    for (const [nodeId, communityId] of communities.entries()) {
      if (!communityMap.has(communityId)) {
        communityMap.set(communityId, []);
      }
      communityMap.get(communityId).push(nodeId);
    }

    return Array.from(communityMap.values()).map(nodeIds => ({
      nodes: nodeIds,
      size: nodeIds.length,
    }));
  }

  /**
   * 获取节点所属社区
   */
  getNodeCluster(nodeId) {
    // 这里需要维护一个节点到社区的映射
    // 简化实现，返回节点ID的哈希值模10
    return Math.abs(this.hashCode(nodeId)) % 10;
  }

  /**
   * 字符串哈希
   */
  hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash;
  }

  /**
   * FPS监控
   */
  updateFPS() {
    const now = performance.now();
    const delta = now - this.lastFrameTime;
    this.lastFrameTime = now;

    this.fpsFrames.push(1000 / delta);

    // 只保留最近60帧
    if (this.fpsFrames.length > 60) {
      this.fpsFrames.shift();
    }

    // 计算平均FPS
    const sum = this.fpsFrames.reduce((a, b) => a + b, 0);
    this.metrics.fps = Math.round(sum / this.fpsFrames.length);
  }

  /**
   * 记录渲染时间
   */
  recordRenderTime(time) {
    this.metrics.renderCount++;
    this.metrics.renderTimes.push(time);

    // 只保留最近100次
    if (this.metrics.renderTimes.length > 100) {
      this.metrics.renderTimes.shift();
    }

    // 计算平均时间
    const sum = this.metrics.renderTimes.reduce((a, b) => a + b, 0);
    this.metrics.averageRenderTime = sum / this.metrics.renderTimes.length;
  }

  /**
   * 发送进度事件
   */
  emitProgress(progress) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('graph-render-progress', {
        detail: { progress },
      }));
    }
  }

  /**
   * 获取性能指标
   */
  getMetrics() {
    return {
      ...this.metrics,
      cacheSize: this.layoutCache.size,
      cacheHitRate: this.metrics.renderCount > 0
        ? `${(this.metrics.cacheHits / this.metrics.renderCount * 100).toFixed(2)}%`
        : '0%',
    };
  }

  /**
   * 清理缓存
   */
  clearCache() {
    this.layoutCache.clear();
    this.renderCache.clear();
    console.log('[GraphOptimizer] 缓存已清理');
  }
}

// 导出单例
const graphOptimizer = new GraphPerformanceOptimizer();

export default graphOptimizer;
