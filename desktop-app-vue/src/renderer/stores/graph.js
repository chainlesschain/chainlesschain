import { defineStore } from 'pinia';

export const useGraphStore = defineStore('graph', {
  state: () => ({
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
    layout: 'force', // force, circular, hierarchical

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
    // 获取指定节点的所有关系
    nodeRelations: (state) => (nodeId) => {
      return state.edges.filter(
        edge => edge.source === nodeId || edge.target === nodeId
      );
    },

    // 获取关联节点
    connectedNodes: (state) => (nodeId) => {
      const connectedIds = new Set();
      state.edges.forEach(edge => {
        if (edge.source === nodeId) {
          connectedIds.add(edge.target);
        } else if (edge.target === nodeId) {
          connectedIds.add(edge.source);
        }
      });
      return state.nodes.filter(node => connectedIds.has(node.id));
    },

    // 按类型分组的关系
    relationsByType: (state) => {
      const groups = {
        link: [],
        tag: [],
        semantic: [],
        temporal: [],
      };
      state.edges.forEach(edge => {
        if (groups[edge.type]) {
          groups[edge.type].push(edge);
        }
      });
      return groups;
    },

    // 是否有数据
    hasData: (state) => {
      return state.nodes.length > 0 && state.edges.length > 0;
    },
  },

  actions: {
    /**
     * 加载图谱数据
     */
    async loadGraphData(options = {}) {
      this.loading = true;

      try {
        const mergedOptions = {
          ...this.filters,
          ...options,
        };

        const result = await window.electronAPI.graph.getGraphData(mergedOptions);

        this.nodes = result.nodes || [];
        this.edges = result.edges || [];

        // 更新统计信息
        this.stats.totalNodes = this.nodes.length;
        this.stats.totalEdges = this.edges.length;

        // 统计各类型关系
        const typeCount = { link: 0, tag: 0, semantic: 0, temporal: 0 };
        this.edges.forEach(edge => {
          if (typeCount[edge.type] !== undefined) {
            typeCount[edge.type]++;
          }
        });
        this.stats.linkRelations = typeCount.link;
        this.stats.tagRelations = typeCount.tag;
        this.stats.semanticRelations = typeCount.semantic;
        this.stats.temporalRelations = typeCount.temporal;

        console.log('[GraphStore] 图谱数据加载完成:', {
          nodes: this.nodes.length,
          edges: this.edges.length,
        });

        return { nodes: this.nodes, edges: this.edges };
      } catch (error) {
        console.error('[GraphStore] 加载图谱数据失败:', error);
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 处理单个笔记的关系
     */
    async processNote(noteId, content, tags = []) {
      try {
        const count = await window.electronAPI.graph.processNote(noteId, content, tags);
        console.log(`[GraphStore] 处理笔记 ${noteId}，创建了 ${count} 个关系`);
        return count;
      } catch (error) {
        console.error('[GraphStore] 处理笔记失败:', error);
        throw error;
      }
    },

    /**
     * 批量处理所有笔记
     */
    async processAllNotes(noteIds = null) {
      this.processing = true;

      try {
        const result = await window.electronAPI.graph.processAllNotes(noteIds);
        console.log('[GraphStore] 批量处理完成:', result);

        // 重新加载图谱数据
        await this.loadGraphData();

        return result;
      } catch (error) {
        console.error('[GraphStore] 批量处理失败:', error);
        throw error;
      } finally {
        this.processing = false;
      }
    },

    /**
     * 获取笔记的所有关系
     */
    async getKnowledgeRelations(knowledgeId) {
      try {
        const relations = await window.electronAPI.graph.getKnowledgeRelations(knowledgeId);
        return relations;
      } catch (error) {
        console.error('[GraphStore] 获取笔记关系失败:', error);
        return [];
      }
    },

    /**
     * 查找两个笔记之间的关联路径
     */
    async findRelatedNotes(sourceId, targetId, maxDepth = 3) {
      try {
        const path = await window.electronAPI.graph.findRelatedNotes(sourceId, targetId, maxDepth);
        return path;
      } catch (error) {
        console.error('[GraphStore] 查找关联路径失败:', error);
        return null;
      }
    },

    /**
     * 查找潜在链接建议
     */
    async findPotentialLinks(noteId, content) {
      try {
        const suggestions = await window.electronAPI.graph.findPotentialLinks(noteId, content);
        return suggestions;
      } catch (error) {
        console.error('[GraphStore] 查找潜在链接失败:', error);
        return [];
      }
    },

    /**
     * 添加关系
     */
    async addRelation(sourceId, targetId, type, weight = 1.0, metadata = null) {
      try {
        const relation = await window.electronAPI.graph.addRelation(
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
        console.error('[GraphStore] 添加关系失败:', error);
        throw error;
      }
    },

    /**
     * 删除关系
     */
    async deleteRelations(noteId, types = []) {
      try {
        const count = await window.electronAPI.graph.deleteRelations(noteId, types);

        // 重新加载图谱数据
        await this.loadGraphData();

        return count;
      } catch (error) {
        console.error('[GraphStore] 删除关系失败:', error);
        throw error;
      }
    },

    /**
     * 重建标签关系
     */
    async buildTagRelations() {
      this.processing = true;

      try {
        const count = await window.electronAPI.graph.buildTagRelations();
        console.log(`[GraphStore] 重建标签关系完成，创建了 ${count} 个关系`);

        // 重新加载图谱数据
        await this.loadGraphData();

        return count;
      } catch (error) {
        console.error('[GraphStore] 重建标签关系失败:', error);
        throw error;
      } finally {
        this.processing = false;
      }
    },

    /**
     * 重建时间关系
     */
    async buildTemporalRelations(windowDays = 7) {
      this.processing = true;

      try {
        const count = await window.electronAPI.graph.buildTemporalRelations(windowDays);
        console.log(`[GraphStore] 重建时间关系完成，创建了 ${count} 个关系`);

        // 重新加载图谱数据
        await this.loadGraphData();

        return count;
      } catch (error) {
        console.error('[GraphStore] 重建时间关系失败:', error);
        throw error;
      } finally {
        this.processing = false;
      }
    },

    /**
     * 提取语义关系（使用LLM）
     */
    async extractSemanticRelations(noteId, content) {
      try {
        const relations = await window.electronAPI.graph.extractSemanticRelations(noteId, content);
        console.log(`[GraphStore] 提取语义关系完成，找到了 ${relations.length} 个关系`);

        // 重新加载图谱数据
        await this.loadGraphData();

        return relations;
      } catch (error) {
        console.error('[GraphStore] 提取语义关系失败:', error);
        throw error;
      }
    },

    /**
     * 更新筛选选项
     */
    updateFilters(newFilters) {
      this.filters = {
        ...this.filters,
        ...newFilters,
      };
    },

    /**
     * 选中节点
     */
    selectNode(nodeId) {
      this.selectedNode = nodeId;
    },

    /**
     * 悬停节点
     */
    hoverNode(nodeId) {
      this.hoveredNode = nodeId;
    },

    /**
     * 取消选中
     */
    clearSelection() {
      this.selectedNode = null;
      this.hoveredNode = null;
    },

    /**
     * 切换布局
     */
    setLayout(layout) {
      this.layout = layout;
    },

    /**
     * 重置状态
     */
    reset() {
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
