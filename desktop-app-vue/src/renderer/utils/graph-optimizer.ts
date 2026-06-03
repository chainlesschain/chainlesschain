import { logger } from '@/utils/logger';

/**
 * Knowledge graph rendering performance optimization module
 * Optimizes rendering performance for large-scale graphs
 */

// ==================== Type Definitions ====================

/**
 * Node type enumeration
 */
export type NodeType = 'note' | 'document' | 'conversation' | 'web_clip' | 'cluster';

/**
 * Rendering strategy type
 */
export type RenderStrategy = 'full' | 'simplified' | 'clustered';

/**
 * Graph optimizer configuration
 */
export interface GraphOptimizerConfig {
  // LOD configuration
  maxNodesForFull: number;
  maxNodesForSimplified: number;
  maxNodesForClustering: number;

  // Rendering configuration
  enableProgressive: boolean;
  progressiveChunkSize: number;
  progressiveDelay: number;

  // Cache configuration
  enableLayoutCache: boolean;
  cacheExpiry: number;

  // WebGL configuration
  enableWebGL: boolean;
  webglThreshold: number;
}

/**
 * Graph node interface
 */
export interface GraphNode {
  id: string;
  name?: string;
  title?: string;
  type?: NodeType;
  importance?: number;
  relationCount?: number;
  x?: number;
  y?: number;
  symbolSize?: number;
  itemStyle?: NodeItemStyle;
  label?: NodeLabel;
  members?: string[];
}

/**
 * Node item style
 */
export interface NodeItemStyle {
  color: string;
  borderColor?: string;
  borderWidth?: number;
  shadowBlur?: number;
  shadowColor?: string;
}

/**
 * Node label configuration
 */
export interface NodeLabel {
  show: boolean;
  formatter?: string;
  fontSize?: number;
}

/**
 * Graph edge interface
 */
export interface GraphEdge {
  source: string;
  target: string;
  weight?: number;
  lineStyle?: EdgeLineStyle;
  count?: number;
}

/**
 * Edge line style
 */
export interface EdgeLineStyle {
  width?: number;
  opacity?: number;
}

/**
 * Viewport configuration
 */
export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
}

/**
 * Optimization result
 */
export interface OptimizationResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  strategy: RenderStrategy;
}

/**
 * Layout cache entry
 */
export interface LayoutCacheEntry {
  layout: GraphNode[];
  timestamp: number;
}

/**
 * Community detection result
 */
export interface Community {
  nodes: string[];
  size: number;
}

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
  renderCount: number;
  averageRenderTime: number;
  renderTimes: number[];
  cacheHits: number;
  fps: number;
}

/**
 * Extended metrics with computed values
 */
export interface ExtendedMetrics extends PerformanceMetrics {
  cacheSize: number;
  cacheHitRate: string;
}

/**
 * WebGL configuration
 */
export interface WebGLConfig {
  renderer: string;
  progressive: {
    enabled: boolean;
    chunkSize: number;
  };
  animation: boolean;
}

/**
 * Render callback function type
 */
export type RenderCallback = (nodes: GraphNode[], edges: GraphEdge[]) => Promise<void>;

// ==================== Implementation ====================

class GraphPerformanceOptimizer {
  private config: GraphOptimizerConfig;
  private layoutCache: Map<string, LayoutCacheEntry>;
  private renderCache: Map<string, unknown>;
  private metrics: PerformanceMetrics;
  private fpsFrames: number[];
  private lastFrameTime: number;
  private nodeClusterMap: Map<string, number>;

  constructor() {
    // Performance configuration
    this.config = {
      // LOD configuration
      maxNodesForFull: 200,
      maxNodesForSimplified: 500,
      maxNodesForClustering: 1000,

      // Rendering configuration
      enableProgressive: true,
      progressiveChunkSize: 100,
      progressiveDelay: 16, // ~60fps

      // Cache configuration
      enableLayoutCache: true,
      cacheExpiry: 300000, // 5 minutes

      // WebGL configuration
      enableWebGL: true,
      webglThreshold: 500,
    };

    // Caches
    this.layoutCache = new Map();
    this.renderCache = new Map();

    // Performance metrics
    this.metrics = {
      renderCount: 0,
      averageRenderTime: 0,
      renderTimes: [],
      cacheHits: 0,
      fps: 0,
    };

    // FPS monitoring
    this.fpsFrames = [];
    this.lastFrameTime = performance.now();

    // Node to cluster mapping
    this.nodeClusterMap = new Map();
  }

  /**
   * Optimize node data
   * Choose appropriate rendering strategy based on node count
   */
  optimizeNodes(nodes: GraphNode[], edges: GraphEdge[]): OptimizationResult {
    const nodeCount = nodes.length;
    logger.info(`[GraphOptimizer] Optimizing ${nodeCount} nodes`);

    if (nodeCount <= this.config.maxNodesForFull) {
      // Full rendering
      return {
        nodes: this.enhanceNodes(nodes),
        edges: this.enhanceEdges(edges),
        strategy: 'full',
      };
    } else if (nodeCount <= this.config.maxNodesForSimplified) {
      // Simplified rendering
      return {
        nodes: this.simplifyNodes(nodes),
        edges: this.simplifyEdges(edges),
        strategy: 'simplified',
      };
    } else {
      // Clustered rendering
      return {
        nodes: this.clusterNodes(nodes, edges),
        edges: this.clusterEdges(edges),
        strategy: 'clustered',
      };
    }
  }

  /**
   * Enhance nodes (full rendering)
   */
  private enhanceNodes(nodes: GraphNode[]): GraphNode[] {
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
   * Enhance edges (full rendering)
   */
  private enhanceEdges(edges: GraphEdge[]): GraphEdge[] {
    return edges.map(edge => ({
      ...edge,
      lineStyle: {
        width: Math.max(1, (edge.weight || 0.5) * 3),
        opacity: 0.8,
      },
    }));
  }

  /**
   * Simplify nodes (simplified rendering)
   */
  private simplifyNodes(nodes: GraphNode[]): GraphNode[] {
    return nodes.map(node => ({
      ...node,
      symbolSize: this.calculateNodeSize(node) * 0.8,
      itemStyle: {
        color: this.getNodeColor(node),
        borderWidth: 1,
      },
      label: {
        show: (node.importance || 0) > 0.7, // Only show labels for important nodes
        formatter: node.title,
        fontSize: 10,
      },
    }));
  }

  /**
   * Cluster nodes (clustered rendering)
   */
  private clusterNodes(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
    logger.info('[GraphOptimizer] Performing node clustering');

    // Use community detection algorithm for clustering
    const communities = this.detectCommunities(nodes, edges);

    // Update node to cluster mapping
    this.nodeClusterMap.clear();
    communities.forEach((community, index) => {
      community.nodes.forEach(nodeId => {
        this.nodeClusterMap.set(nodeId, index);
      });
    });

    // Create a cluster node for each community
    const clusteredNodes: GraphNode[] = communities.map((community, index) => ({
      id: `cluster-${index}`,
      name: `Community ${index + 1}`,
      title: `Community ${index + 1} (${community.nodes.length} nodes)`,
      type: 'cluster' as NodeType,
      symbolSize: Math.min(50 + community.nodes.length * 2, 100),
      itemStyle: {
        color: this.getClusterColor(index),
      },
      label: {
        show: true,
        formatter: `Community ${index + 1}\n${community.nodes.length}`,
      },
      members: community.nodes,
    }));

    return clusteredNodes;
  }

  /**
   * Simplify edges
   */
  private simplifyEdges(edges: GraphEdge[]): GraphEdge[] {
    // Only keep edges with higher weight
    return edges
      .filter(edge => (edge.weight || 0) > 0.5)
      .map(edge => ({
        ...edge,
        lineStyle: {
          width: 1,
          opacity: 0.5,
        },
      }));
  }

  /**
   * Cluster edges
   */
  private clusterEdges(edges: GraphEdge[]): GraphEdge[] {
    // Aggregate edges between clusters
    const clusterEdges = new Map<string, GraphEdge>();

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

        const clusterEdge = clusterEdges.get(key)!;
        clusterEdge.weight = (clusterEdge.weight || 0) + (edge.weight || 0);
        clusterEdge.count = (clusterEdge.count || 0) + 1;
      }
    });

    return Array.from(clusterEdges.values()).map(edge => ({
      ...edge,
      lineStyle: {
        width: Math.min((edge.count || 1) / 2, 5),
        opacity: 0.6,
      },
    }));
  }

  /**
   * Progressive rendering
   */
  async progressiveRender(
    nodes: GraphNode[],
    edges: GraphEdge[],
    renderCallback: RenderCallback
  ): Promise<void> {
    const chunkSize = this.config.progressiveChunkSize;
    const delay = this.config.progressiveDelay;

    logger.info(`[GraphOptimizer] Progressive rendering: ${nodes.length} nodes`);

    for (let i = 0; i < nodes.length; i += chunkSize) {
      const chunk = nodes.slice(i, i + chunkSize);
      const chunkEdges = edges.filter(
        edge =>
          chunk.some(n => n.id === edge.source) ||
          chunk.some(n => n.id === edge.target)
      );

      await renderCallback(chunk, chunkEdges);

      // Yield to main thread
      await new Promise(resolve => setTimeout(resolve, delay));

      // Update progress
      const progress = Math.min((i + chunkSize) / nodes.length * 100, 100);
      this.emitProgress(progress);
    }

    logger.info('[GraphOptimizer] Progressive rendering complete');
  }

  /**
   * Layout cache
   */
  getCachedLayout(graphId: string, nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] | null {
    const cacheKey = this.generateCacheKey(graphId, nodes, edges);

    if (this.config.enableLayoutCache && this.layoutCache.has(cacheKey)) {
      const cached = this.layoutCache.get(cacheKey)!;

      // Check if expired
      if (Date.now() - cached.timestamp < this.config.cacheExpiry) {
        logger.info('[GraphOptimizer] Using cached layout');
        this.metrics.cacheHits++;
        return cached.layout;
      } else {
        this.layoutCache.delete(cacheKey);
      }
    }

    return null;
  }

  /**
   * Save layout to cache
   */
  cacheLayout(graphId: string, nodes: GraphNode[], edges: GraphEdge[], layout: GraphNode[]): void {
    const cacheKey = this.generateCacheKey(graphId, nodes, edges);

    this.layoutCache.set(cacheKey, {
      layout,
      timestamp: Date.now(),
    });

    // Limit cache size
    if (this.layoutCache.size > 10) {
      const firstKey = this.layoutCache.keys().next().value;
      if (firstKey) {
        this.layoutCache.delete(firstKey);
      }
    }
  }

  /**
   * Generate cache key
   */
  private generateCacheKey(graphId: string, nodes: GraphNode[], edges: GraphEdge[]): string {
    const nodeIds = nodes.map(n => n.id).sort().join(',');
    const edgeIds = edges.map(e => `${e.source}-${e.target}`).sort().join(',');
    return `${graphId}-${nodeIds.length}-${edgeIds.length}`;
  }

  /**
   * WebGL rendering optimization
   */
  shouldUseWebGL(nodeCount: number): boolean {
    return this.config.enableWebGL && nodeCount >= this.config.webglThreshold;
  }

  /**
   * Get WebGL configuration
   */
  getWebGLConfig(): WebGLConfig {
    return {
      renderer: 'webgl',
      progressive: {
        enabled: true,
        chunkSize: this.config.progressiveChunkSize,
      },
      animation: false, // Disable animation in WebGL mode for better performance
    };
  }

  /**
   * Viewport culling
   * Only render nodes in the visible area
   */
  cullNodes(nodes: GraphNode[], viewport: Viewport): GraphNode[] {
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
   * Calculate node size
   */
  private calculateNodeSize(node: GraphNode): number {
    const baseSize = 20;
    const importance = node.importance || 0.5;
    const relationCount = node.relationCount || 0;

    return baseSize + importance * 20 + Math.min(relationCount * 2, 30);
  }

  /**
   * Get node color
   */
  private getNodeColor(node: GraphNode): string {
    const colors: Record<string, string> = {
      note: '#1890ff',
      document: '#52c41a',
      conversation: '#faad14',
      web_clip: '#f5222d',
    };

    return colors[node.type || ''] || '#8c8c8c';
  }

  /**
   * Get cluster node color
   */
  private getClusterColor(index: number): string {
    const colors = [
      '#1890ff', '#52c41a', '#faad14', '#f5222d',
      '#722ed1', '#13c2c2', '#eb2f96', '#fa8c16',
    ];

    return colors[index % colors.length];
  }

  /**
   * Community detection (simplified Louvain algorithm)
   */
  private detectCommunities(nodes: GraphNode[], edges: GraphEdge[]): Community[] {
    // Build adjacency list
    const adjacency = new Map<string, string[]>();
    nodes.forEach(node => adjacency.set(node.id, []));

    edges.forEach(edge => {
      if (adjacency.has(edge.source)) {
        adjacency.get(edge.source)!.push(edge.target);
      }
      if (adjacency.has(edge.target)) {
        adjacency.get(edge.target)!.push(edge.source);
      }
    });

    // Initialize: each node is its own community
    const communities = new Map<string, number>();
    nodes.forEach((node, index) => {
      communities.set(node.id, index);
    });

    // Iterative optimization (simplified version)
    let improved = true;
    let iteration = 0;
    const maxIterations = 10;

    while (improved && iteration < maxIterations) {
      improved = false;
      iteration++;

      for (const node of nodes) {
        const neighbors = adjacency.get(node.id) || [];
        const communityScores = new Map<number, number>();

        // Calculate score for moving to each neighbor's community
        neighbors.forEach(neighborId => {
          const community = communities.get(neighborId);
          if (community !== undefined) {
            communityScores.set(
              community,
              (communityScores.get(community) || 0) + 1
            );
          }
        });

        // Select the community with highest score
        let bestCommunity = communities.get(node.id)!;
        let bestScore = 0;

        for (const [community, score] of communityScores.entries()) {
          if (score > bestScore) {
            bestScore = score;
            bestCommunity = community;
          }
        }

        // If a better community is found, move the node
        if (bestCommunity !== communities.get(node.id)) {
          communities.set(node.id, bestCommunity);
          improved = true;
        }
      }
    }

    // Organize community results
    const communityMap = new Map<number, string[]>();
    for (const [nodeId, communityId] of communities.entries()) {
      if (!communityMap.has(communityId)) {
        communityMap.set(communityId, []);
      }
      communityMap.get(communityId)!.push(nodeId);
    }

    return Array.from(communityMap.values()).map(nodeIds => ({
      nodes: nodeIds,
      size: nodeIds.length,
    }));
  }

  /**
   * Get the cluster a node belongs to
   */
  private getNodeCluster(nodeId: string): number {
    // Use maintained node to cluster mapping
    const cluster = this.nodeClusterMap.get(nodeId);
    if (cluster !== undefined) {
      return cluster;
    }
    // Fallback: return hash of node ID mod 10
    return Math.abs(this.hashCode(nodeId)) % 10;
  }

  /**
   * String hash function
   */
  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash;
  }

  /**
   * FPS monitoring
   */
  updateFPS(): void {
    const now = performance.now();
    const delta = now - this.lastFrameTime;
    this.lastFrameTime = now;

    this.fpsFrames.push(1000 / delta);

    // Keep only the last 60 frames
    if (this.fpsFrames.length > 60) {
      this.fpsFrames.shift();
    }

    // Calculate average FPS
    const sum = this.fpsFrames.reduce((a, b) => a + b, 0);
    this.metrics.fps = Math.round(sum / this.fpsFrames.length);
  }

  /**
   * Record render time
   */
  recordRenderTime(time: number): void {
    this.metrics.renderCount++;
    this.metrics.renderTimes.push(time);

    // Keep only the last 100 times
    if (this.metrics.renderTimes.length > 100) {
      this.metrics.renderTimes.shift();
    }

    // Calculate average time
    const sum = this.metrics.renderTimes.reduce((a, b) => a + b, 0);
    this.metrics.averageRenderTime = sum / this.metrics.renderTimes.length;
  }

  /**
   * Emit progress event
   */
  private emitProgress(progress: number): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('graph-render-progress', {
        detail: { progress },
      }));
    }
  }

  /**
   * Get performance metrics
   */
  getMetrics(): ExtendedMetrics {
    return {
      ...this.metrics,
      cacheSize: this.layoutCache.size,
      cacheHitRate: this.metrics.renderCount > 0
        ? `${(this.metrics.cacheHits / this.metrics.renderCount * 100).toFixed(2)}%`
        : '0%',
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.layoutCache.clear();
    this.renderCache.clear();
    logger.info('[GraphOptimizer] Cache cleared');
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<GraphOptimizerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): GraphOptimizerConfig {
    return { ...this.config };
  }
}

// Export singleton
const graphOptimizer = new GraphPerformanceOptimizer();

export { GraphPerformanceOptimizer };
export default graphOptimizer;
