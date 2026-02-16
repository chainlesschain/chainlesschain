/**
 * Unified Tools Store - Pinia state management
 *
 * Manages the unified tool registry state: tools, skills, search, and filtering.
 *
 * @module unified-tools-store
 */

import { defineStore } from 'pinia';

// ==================== Type Definitions ====================

export interface UnifiedTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  source: 'builtin' | 'mcp' | 'skill-handler' | 'builtin-skill' | 'mcp-auto' | 'tool-group';
  skillName: string | null;
  skillCategory: string | null;
  instructions: string;
  examples: ToolExample[];
  tags: string[];
  available: boolean;
  _score?: number;
}

export interface ToolExample {
  input: string;
  tool: string;
  params?: Record<string, unknown>;
}

export interface SkillManifest {
  name: string;
  displayName: string;
  description: string;
  category: string;
  instructions: string;
  examples: ToolExample[];
  toolNames: string[];
  source: string;
  version: string;
  tags: string[];
}

export interface UnifiedToolsState {
  tools: UnifiedTool[];
  skills: SkillManifest[];
  loading: boolean;
  error: string | null;
  searchKeyword: string;
  filterSource: string;
  filterCategory: string;
}

// ==================== Store ====================

export const useUnifiedToolsStore = defineStore('unified-tools', {
  state: (): UnifiedToolsState => ({
    tools: [],
    skills: [],
    loading: false,
    error: null,
    searchKeyword: '',
    filterSource: '',
    filterCategory: '',
  }),

  getters: {
    /** All unique categories from skills */
    categories(state): string[] {
      const cats = new Set<string>();
      for (const skill of state.skills) {
        if (skill.category) cats.add(skill.category);
      }
      return Array.from(cats).sort();
    },

    /** All unique sources */
    sources(state): string[] {
      const srcs = new Set<string>();
      for (const tool of state.tools) {
        if (tool.source) srcs.add(tool.source);
      }
      return Array.from(srcs).sort();
    },

    /** Tools filtered by current search/filter criteria */
    filteredTools(state): UnifiedTool[] {
      let result = state.tools;

      if (state.filterSource) {
        result = result.filter((t) => t.source === state.filterSource);
      }
      if (state.filterCategory) {
        result = result.filter((t) => t.skillCategory === state.filterCategory);
      }
      if (state.searchKeyword) {
        const kw = state.searchKeyword.toLowerCase();
        result = result.filter(
          (t) =>
            t.name.toLowerCase().includes(kw) ||
            t.description?.toLowerCase().includes(kw) ||
            t.skillName?.toLowerCase().includes(kw) ||
            t.tags?.some((tag) => tag.toLowerCase().includes(kw))
        );
      }
      return result;
    },

    /** Skills filtered by category */
    filteredSkills(state): SkillManifest[] {
      if (!state.filterCategory) return state.skills;
      return state.skills.filter((s) => s.category === state.filterCategory);
    },

    /** Statistics */
    stats(state): { totalTools: number; totalSkills: number; bySource: Record<string, number> } {
      const bySource: Record<string, number> = {};
      for (const tool of state.tools) {
        bySource[tool.source] = (bySource[tool.source] || 0) + 1;
      }
      return {
        totalTools: state.tools.length,
        totalSkills: state.skills.length,
        bySource,
      };
    },
  },

  actions: {
    /** Load all tools and skills from the backend */
    async loadAll() {
      this.loading = true;
      this.error = null;
      try {
        const [toolsResult, skillsResult] = await Promise.all([
          (window as any).electronAPI.invoke('tools:get-all-with-skills'),
          (window as any).electronAPI.invoke('tools:get-skill-manifest'),
        ]);

        if (toolsResult?.success) {
          this.tools = toolsResult.data || [];
        }
        if (skillsResult?.success) {
          this.skills = skillsResult.data || [];
        }
      } catch (err: unknown) {
        this.error = (err as Error)?.message || String(err) || 'Failed to load tools';
      } finally {
        this.loading = false;
      }
    },

    /** Search tools via backend */
    async search(keyword: string) {
      this.searchKeyword = keyword;
      if (!keyword) {
        await this.loadAll();
        return;
      }

      this.loading = true;
      try {
        const result = await (window as any).electronAPI.invoke('tools:search-unified', keyword);
        if (result?.success) {
          this.tools = result.data || [];
        }
      } catch (err: unknown) {
        this.error = (err as Error)?.message || String(err);
      } finally {
        this.loading = false;
      }
    },

    /** Refresh the unified registry */
    async refresh() {
      this.loading = true;
      try {
        await (window as any).electronAPI.invoke('tools:refresh-unified');
        await this.loadAll();
      } catch (err: unknown) {
        this.error = (err as Error)?.message || String(err);
      } finally {
        this.loading = false;
      }
    },

    /** Set source filter */
    setFilterSource(source: string) {
      this.filterSource = source;
    },

    /** Set category filter */
    setFilterCategory(category: string) {
      this.filterCategory = category;
    },

    /** Clear all filters */
    clearFilters() {
      this.searchKeyword = '';
      this.filterSource = '';
      this.filterCategory = '';
    },
  },
});
