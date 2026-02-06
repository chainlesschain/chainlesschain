/**
 * Graph Store - 知识图谱管理
 */

import { logger } from '@/utils/logger';
import { defineStore } from 'pinia';

// ==================== 类型定义 ====================

/**
 * 图谱节点
 */
export interface GraphNode {
  id: string;
  label: string;
  type: 'note' | 'document' | 'conversation' | 'web_clip' | string;
  data?: any;
  [key: string]: any;
}

/**
 * 图谱边（关系）
 */
export interface GraphEdge {
  id?: string;
  source: string;
  target: string;
  type: 'link' | 'tag' | 'semantic' | 'temporal';
  weight?: number;
  metadata?: any;
  [key: string]: any;
}

/**
 * 关系类型
 */
export type RelationType = 'link' | 'tag' | 'semantic' | 'temporal';

/**
 * 节点类型
 */
export type NodeType = 'note' | 'document' | 'conversation' | 'web_clip';

/**
 * 筛选选项
 */
export interface GraphFilters {
  relationTypes: RelationType[];
  nodeTypes: NodeType[];
  minWeight: number;
  limit: number;
}

/**
 * 图谱统计信息
 */
export interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  linkRelations: number;
  tagRelations: number;
  semanticRelations: number;
  temporalRelations: number;
}

/**
 * 按类型分组的关系
 */
export interface RelationsByType {
  link: GraphEdge[];
  tag: GraphEdge[];
  semantic: GraphEdge[];
  temporal: GraphEdge[];
}

/**
 * 布局类型
 */
export type LayoutType = 'force' | 'circular' | 'hierarchical';

/**
 * 加载图谱数据选项
 */
export interface LoadGraphOptions extends Partial<GraphFilters> {
  [key: string]: any;
}

/**
 * 图谱数据结果
 */
export interface GraphDataResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * 关联路径
 */
export interface RelationPath {
  nodes: GraphNode[];
  edges: GraphEdge[];
  [key: string]: any;
}

/**
 * 潜在链接建议
 */
export interface PotentialLink {
  targetId: string;
  title: string;
  score: number;
  reason: string;
  [key: string]: any;
}

/**
 * 语义关系
 */
export interface SemanticRelation {
  sourceId: string;
  targetId: string;
  type: string;
  description?: string;
  [key: string]: any;
}

/**
 * 中心性结果
 */
export type CentralityResult = Map<string, number>;

/**
 * 社区检测结果
 */
export type CommunityResult = Map<string, number>;

/**
 * 聚类结果
 */
export type ClusterResult = Map<string, number>;

/**
 * 关键节点信息
 */
export interface KeyNode {
  id: string;
  label: string;
  score: number;
  [key: string]: any;
}

/**
 * 图谱分析统计
 */
export interface GraphAnalysisStats {
  density: number;
  avgDegree: number;
  clusteringCoefficient: number;
  diameter?: number;
  [key: string]: any;
}

/**
 * 导出结果
 */
export interface ExportResult {
  format: string;
  data: string;
  [key: string]: any;
}

/**
 * Graph Store 状态
 */
export interface GraphState {
  nodes: GraphNode[];
  edges: GraphEdge[];
  loading: boolean;
  processing: boolean;
  filters: GraphFilters;
  selectedNode: string | null;
  hoveredNode: string | null;
  layout: LayoutType;
  stats: GraphStats;
}

// ==================== 工具函数 ====================

/**
 * 将值转换为普通对象，去除Vue代理
 */
const toPlainObject = <T extends object>(value: T | null | undefined): T => {
  if (!value || typeof value !== 'object') {
    return {} as T;
  }
  return JSON.parse(JSON.stringify(value));
};

// ==================== Store ====================

export const useGraphStore = defineStore('graph', {
  state: (): GraphState => ({
    // 图谱数据
    nodes: [],
    edges: [],

    // 加载状态
    loading: false,
    processing: false,

    // 筛选选项
    filters: {
      relationTypes: ['link', 'tag', 'semantic', 'temporal'],
      nodeTypes: ['note', 'document', 'conversation', 'web_clip'],
      minWeight: 0.0,
      limit: 500,
    },

    // 选中的节点
    selectedNode: null,
    hoveredNode: null,

    // 布局选项
    layout: 'force',

    // 统计信息
    stats: {
      totalNodes: 0,
      totalEdges: 0,
      linkRelations: 0,
      tagRelations: 0,
      semanticRelations: 0,
      temporalRelations: 0,
    },
  }),

  getters: {
    /**
     * 获取指定节点的所有关系
     */
    nodeRelations(): (nodeId: string) => GraphEdge[] {
      return (nodeId: string): GraphEdge[] => {
        return this.edges.filter((edge) => edge.source === nodeId || edge.target === nodeId);
      };
    },

    /**
     * 获取关联节点
     */
    connectedNodes(): (nodeId: string) => GraphNode[] {
      return (nodeId: string): GraphNode[] => {
        const connectedIds = new Set<string>();
        this.edges.forEach((edge) => {
          if (edge.source === nodeId) {
            connectedIds.add(edge.target);
          } else if (edge.target === nodeId) {
            connectedIds.add(edge.source);
          }
        });
        return this.nodes.filter((node) => connectedIds.has(node.id));
      };
    },

    /**
     * 按类型分组的关系
     */
    relationsByType(): RelationsByType {
      const groups: RelationsByType = {
        link: [],
        tag: [],
        semantic: [],
        temporal: [],
      };
      this.edges.forEach((edge) => {
        if (groups[edge.type]) {
          groups[edge.type].push(edge);
        }
      });
      return groups;
    },

    /**
     * 是否有数据
     */
    hasData(): boolean {
      return this.nodes.length > 0 && this.edges.length > 0;
    },
  },

  actions: {
    /**
     * 加载图谱数据
     */
    async loadGraphData(options: LoadGraphOptions = {}): Promise<GraphDataResult> {
      this.loading = true;

      try {
        const mergedOptions: LoadGraphOptions = {
          ...toPlainObject(this.filters),
          ...toPlainObject(options),
        };

        const result: GraphDataResult = await (window as any).electronAPI.graph.getGraphData(
          mergedOptions
        );

        this.nodes = result.nodes || [];
        this.edges = result.edges || [];

        // 更新统计信息
        this.stats.totalNodes = this.nodes.length;
        this.stats.totalEdges = this.edges.length;

        // 统计各类型关系
        const typeCount: Record<RelationType, number> = {
          link: 0,
          tag: 0,
          semantic: 0,
          temporal: 0,
        };
        this.edges.forEach((edge) => {
          if (typeCount[edge.type] !== undefined) {
            typeCount[edge.type]++;
          }
        });
        this.stats.linkRelations = typeCount.link;
        this.stats.tagRelations = typeCount.tag;
        this.stats.semanticRelations = typeCount.semantic;
        this.stats.temporalRelations = typeCount.temporal;

        logger.info('[GraphStore] 图谱数据加载完成:', {
          nodes: this.nodes.length,
          edges: this.edges.length,
        });

        return { nodes: this.nodes, edges: this.edges };
      } catch (error) {
        logger.error('[GraphStore] 加载图谱数据失败:', error as any);
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 处理单个笔记的关系
     */
    async processNote(noteId: string, content: string, tags: string[] = []): Promise<number> {
      try {
        const count: number = await (window as any).electronAPI.graph.processNote(
          noteId,
          content,
          tags
        );
        logger.info(`[GraphStore] 处理笔记 ${noteId}，创建了 ${count} 个关系`);
        return count;
      } catch (error) {
        logger.error('[GraphStore] 处理笔记失败:', error as any);
        throw error;
      }
    },

    /**
     * 批量处理所有笔记
     */
    async processAllNotes(noteIds: string[] | null = null): Promise<any> {
      this.processing = true;

      try {
        const result = await (window as any).electronAPI.graph.processAllNotes(noteIds);
        logger.info('[GraphStore] 批量处理完成:', result);

        // 重新加载图谱数据
        await this.loadGraphData();

        return result;
      } catch (error) {
        logger.error('[GraphStore] 批量处理失败:', error as any);
        throw error;
      } finally {
        this.processing = false;
      }
    },

    /**
     * 获取笔记的所有关系
     */
    async getKnowledgeRelations(knowledgeId: string): Promise<GraphEdge[]> {
      try {
        const relations: GraphEdge[] =
          await (window as any).electronAPI.graph.getKnowledgeRelations(knowledgeId);
        return relations;
      } catch (error) {
        logger.error('[GraphStore] 获取笔记关系失败:', error as any);
        return [];
      }
    },

    /**
     * 查找两个笔记之间的关联路径
     */
    async findRelatedNotes(
      sourceId: string,
      targetId: string,
      maxDepth: number = 3
    ): Promise<RelationPath | null> {
      try {
        const path: RelationPath | null = await (window as any).electronAPI.graph.findRelatedNotes(
          sourceId,
          targetId,
          maxDepth
        );
        return path;
      } catch (error) {
        logger.error('[GraphStore] 查找关联路径失败:', error as any);
        return null;
      }
    },

    /**
     * 查找潜在链接建议
     */
    async findPotentialLinks(noteId: string, content: string): Promise<PotentialLink[]> {
      try {
        const suggestions: PotentialLink[] =
          await (window as any).electronAPI.graph.findPotentialLinks(noteId, content);
        return suggestions;
      } catch (error) {
        logger.error('[GraphStore] 查找潜在链接失败:', error as any);
        return [];
      }
    },

    /**
     * 添加关系
     */
    async addRelation(
      sourceId: string,
      targetId: string,
      type: RelationType,
      weight: number = 1.0,
      metadata: any = null
    ): Promise<GraphEdge> {
      try {
        const relation: GraphEdge = await (window as any).electronAPI.graph.addRelation(
          sourceId,
          targetId,
          type,
          weight,
          metadata
        );

        // 重新加载图谱数据
        await this.loadGraphData();

        return relation;
      } catch (error) {
        logger.error('[GraphStore] 添加关系失败:', error as any);
        throw error;
      }
    },

    /**
     * 删除关系
     */
    async deleteRelations(noteId: string, types: RelationType[] = []): Promise<number> {
      try {
        const count: number = await (window as any).electronAPI.graph.deleteRelations(
          noteId,
          types
        );

        // 重新加载图谱数据
        await this.loadGraphData();

        return count;
      } catch (error) {
        logger.error('[GraphStore] 删除关系失败:', error as any);
        throw error;
      }
    },

    /**
     * 重建标签关系
     */
    async buildTagRelations(): Promise<number> {
      this.processing = true;

      try {
        const count: number = await (window as any).electronAPI.graph.buildTagRelations();
        logger.info(`[GraphStore] 重建标签关系完成，创建了 ${count} 个关系`);

        // 重新加载图谱数据
        await this.loadGraphData();

        return count;
      } catch (error) {
        logger.error('[GraphStore] 重建标签关系失败:', error as any);
        throw error;
      } finally {
        this.processing = false;
      }
    },

    /**
     * 重建时间关系
     */
    async buildTemporalRelations(windowDays: number = 7): Promise<number> {
      this.processing = true;

      try {
        const count: number = await (window as any).electronAPI.graph.buildTemporalRelations(
          windowDays
        );
        logger.info(`[GraphStore] 重建时间关系完成，创建了 ${count} 个关系`);

        // 重新加载图谱数据
        await this.loadGraphData();

        return count;
      } catch (error) {
        logger.error('[GraphStore] 重建时间关系失败:', error as any);
        throw error;
      } finally {
        this.processing = false;
      }
    },

    /**
     * 提取语义关系（使用LLM）
     */
    async extractSemanticRelations(noteId: string, content: string): Promise<SemanticRelation[]> {
      try {
        const relations: SemanticRelation[] =
          await (window as any).electronAPI.graph.extractSemanticRelations(noteId, content);
        logger.info(`[GraphStore] 提取语义关系完成，找到了 ${relations.length} 个关系`);

        // 重新加载图谱数据
        await this.loadGraphData();

        return relations;
      } catch (error) {
        logger.error('[GraphStore] 提取语义关系失败:', error as any);
        throw error;
      }
    },

    /**
     * 更新筛选选项
     */
    updateFilters(newFilters: Partial<GraphFilters>): void {
      this.filters = {
        ...toPlainObject(this.filters),
        ...toPlainObject(newFilters),
      };
    },

    /**
     * 选中节点
     */
    selectNode(nodeId: string | null): void {
      this.selectedNode = nodeId;
    },

    /**
     * 悬停节点
     */
    hoverNode(nodeId: string | null): void {
      this.hoveredNode = nodeId;
    },

    /**
     * 取消选中
     */
    clearSelection(): void {
      this.selectedNode = null;
      this.hoveredNode = null;
    },

    /**
     * 切换布局
     */
    setLayout(layout: LayoutType): void {
      this.layout = layout;
    },

    /**
     * 计算节点中心性
     */
    async calculateCentrality(type: string = 'degree'): Promise<CentralityResult> {
      try {
        const result: [string, number][] = await (window as any).electronAPI.graph.calculateCentrality(
          this.nodes,
          this.edges,
          type
        );
        return new Map(result);
      } catch (error) {
        logger.error('[GraphStore] 计算中心性失败:', error as any);
        return new Map();
      }
    },

    /**
     * 社区检测
     */
    async detectCommunities(): Promise<CommunityResult> {
      try {
        const result: [string, number][] = await (window as any).electronAPI.graph.detectCommunities(
          this.nodes,
          this.edges
        );
        return new Map(result);
      } catch (error) {
        logger.error('[GraphStore] 社区检测失败:', error as any);
        return new Map();
      }
    },

    /**
     * 节点聚类
     */
    async clusterNodes(k: number = 5): Promise<ClusterResult> {
      try {
        const result: [string, number][] = await (window as any).electronAPI.graph.clusterNodes(
          this.nodes,
          this.edges,
          k
        );
        return new Map(result);
      } catch (error) {
        logger.error('[GraphStore] 节点聚类失败:', error as any);
        return new Map();
      }
    },

    /**
     * 查找关键节点
     */
    async findKeyNodes(topN: number = 10): Promise<KeyNode[]> {
      try {
        const keyNodes: KeyNode[] = await (window as any).electronAPI.graph.findKeyNodes(
          this.nodes,
          this.edges,
          topN
        );
        return keyNodes;
      } catch (error) {
        logger.error('[GraphStore] 查找关键节点失败:', error as any);
        return [];
      }
    },

    /**
     * 分析图谱统计
     */
    async analyzeGraphStats(): Promise<GraphAnalysisStats | null> {
      try {
        const stats: GraphAnalysisStats = await (window as any).electronAPI.graph.analyzeStats(
          this.nodes,
          this.edges
        );
        return stats;
      } catch (error) {
        logger.error('[GraphStore] 分析图谱统计失败:', error as any);
        return null;
      }
    },

    /**
     * 导出图谱
     */
    async exportGraph(format: string): Promise<ExportResult> {
      try {
        const result: ExportResult = await (window as any).electronAPI.graph.exportGraph(
          this.nodes,
          this.edges,
          format
        );
        return result;
      } catch (error) {
        logger.error('[GraphStore] 导出图谱失败:', error as any);
        throw error;
      }
    },

    /**
     * 重置状态
     */
    reset(): void {
      this.nodes = [];
      this.edges = [];
      this.selectedNode = null;
      this.hoveredNode = null;
      this.stats = {
        totalNodes: 0,
        totalEdges: 0,
        linkRelations: 0,
        tagRelations: 0,
        semanticRelations: 0,
        temporalRelations: 0,
      };
    },
  },
});
