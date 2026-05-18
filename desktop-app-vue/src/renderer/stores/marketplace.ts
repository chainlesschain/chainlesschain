/**
 * Marketplace Store - Pinia 状态管理
 * 管理插件市场的状态：插件浏览、安装、更新、评价等
 *
 * @module marketplace-store
 * @version 1.0.0
 */

import { defineStore } from 'pinia';

// ==================== 类型定义 ====================

/**
 * 插件信息
 */
export interface PluginInfo {
  id: string;
  pluginId: string;
  name: string;
  version: string;
  author: string;
  description: string;
  category: string;
  tags: string[];
  downloads: number;
  rating: number;
  ratingCount: number;
  verified: boolean;
  featured: boolean;
}

/**
 * 已安装插件
 */
export interface InstalledPlugin {
  id: string;
  plugin_id: string;
  name: string;
  version: string;
  author?: string;
  install_path: string;
  installed_at: number;
  enabled: boolean;
  auto_update: boolean;
  source: string;
  metadata?: string;
}

/**
 * 插件分类
 */
export interface PluginCategory {
  id: number;
  code: string;
  name: string;
  description: string;
  icon: string;
  pluginCount: number;
}

/**
 * 插件评价
 */
export interface PluginRating {
  id: number;
  pluginId: number;
  userDid: string;
  username: string;
  rating: number;
  comment: string;
  helpfulCount: number;
  createdAt: string;
}

/**
 * Marketplace Store 状态
 */
interface MarketplaceState {
  plugins: PluginInfo[];
  featuredPlugins: PluginInfo[];
  popularPlugins: PluginInfo[];
  installedPlugins: InstalledPlugin[];
  categories: PluginCategory[];
  currentPlugin: PluginInfo | null;
  ratings: PluginRating[];
  availableUpdates: any[];
  totalPlugins: number;
  currentPage: number;
  pageSize: number;
  searchKeyword: string;
  selectedCategory: string;
  loading: boolean;
  error: string | null;
}

// ==================== Store ====================

export const useMarketplaceStore = defineStore('marketplace', {
  state: (): MarketplaceState => ({
    // ==========================================
    // 插件列表
    // ==========================================

    // 所有插件
    plugins: [],

    // 精选插件
    featuredPlugins: [],

    // 热门插件
    popularPlugins: [],

    // 已安装插件
    installedPlugins: [],

    // ==========================================
    // 分类与详情
    // ==========================================

    // 分类列表
    categories: [],

    // 当前查看的插件
    currentPlugin: null,

    // 当前插件的评价列表
    ratings: [],

    // ==========================================
    // 更新管理
    // ==========================================

    // 可用更新列表
    availableUpdates: [],

    // ==========================================
    // 分页与筛选
    // ==========================================

    // 插件总数
    totalPlugins: 0,

    // 当前页码
    currentPage: 1,

    // 每页大小
    pageSize: 20,

    // 搜索关键词
    searchKeyword: '',

    // 选中的分类
    selectedCategory: '',

    // ==========================================
    // 状态
    // ==========================================

    // 加载状态
    loading: false,

    // 错误信息
    error: null,
  }),

  getters: {
    /**
     * 是否有可用更新
     */
    hasUpdates(): boolean {
      return this.availableUpdates.length > 0;
    },

    /**
     * 可用更新数量
     */
    updateCount(): number {
      return this.availableUpdates.length;
    },

    /**
     * 已安装插件数量
     */
    installedCount(): number {
      return this.installedPlugins.length;
    },

    /**
     * 启用的已安装插件
     */
    enabledPlugins(): InstalledPlugin[] {
      return this.installedPlugins.filter((p) => p.enabled);
    },

    /**
     * 禁用的已安装插件
     */
    disabledPlugins(): InstalledPlugin[] {
      return this.installedPlugins.filter((p) => !p.enabled);
    },

    /**
     * 是否已安装指定插件
     */
    isInstalled(): (pluginId: string) => boolean {
      return (pluginId: string) =>
        this.installedPlugins.some((p) => p.plugin_id === pluginId);
    },

    /**
     * 总页数
     */
    totalPages(): number {
      return Math.ceil(this.totalPlugins / this.pageSize);
    },
  },

  actions: {
    // ==========================================
    // 插件浏览
    // ==========================================

    /**
     * 获取插件列表
     */
    async fetchPlugins(filters?: Record<string, any>): Promise<any> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'marketplace:list-plugins',
          {
            page: this.currentPage,
            pageSize: this.pageSize,
            category: this.selectedCategory || undefined,
            ...filters,
          }
        );

        if (result.success) {
          this.plugins = result.plugins || [];
          this.totalPlugins = result.total || 0;
        }

        return result;
      } catch (error) {
        console.error('[MarketplaceStore] 获取插件列表失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 搜索插件
     */
    async searchPlugins(keyword: string, filters?: Record<string, any>): Promise<any> {
      this.loading = true;
      this.error = null;
      this.searchKeyword = keyword;

      try {
        const result = await (window as any).electronAPI.invoke(
          'marketplace:search-plugins',
          {
            keyword,
            page: this.currentPage,
            pageSize: this.pageSize,
            ...filters,
          }
        );

        if (result.success) {
          this.plugins = result.plugins || [];
          this.totalPlugins = result.total || 0;
        }

        return result;
      } catch (error) {
        console.error('[MarketplaceStore] 搜索插件失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 获取插件详情
     */
    async fetchPluginDetail(id: string): Promise<any> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'marketplace:get-plugin-detail',
          { id }
        );

        if (result.success) {
          this.currentPlugin = result.plugin || null;
        }

        return result;
      } catch (error) {
        console.error('[MarketplaceStore] 获取插件详情失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 获取精选插件
     */
    async fetchFeatured(): Promise<any> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'marketplace:get-featured'
        );

        if (result.success) {
          this.featuredPlugins = result.plugins || [];
        }

        return result;
      } catch (error) {
        console.error('[MarketplaceStore] 获取精选插件失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 获取热门插件
     */
    async fetchPopular(): Promise<any> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'marketplace:get-popular'
        );

        if (result.success) {
          this.popularPlugins = result.plugins || [];
        }

        return result;
      } catch (error) {
        console.error('[MarketplaceStore] 获取热门插件失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 获取插件分类列表
     */
    async fetchCategories(): Promise<any> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'marketplace:get-categories'
        );

        if (result.success) {
          this.categories = result.categories || [];
        }

        return result;
      } catch (error) {
        console.error('[MarketplaceStore] 获取分类列表失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // 插件安装与管理
    // ==========================================

    /**
     * 安装插件
     */
    async installPlugin(pluginId: string, version?: string): Promise<any> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'marketplace:install-plugin',
          { pluginId, version }
        );

        if (result.success) {
          // 刷新已安装列表
          await this.fetchInstalled();
        }

        return result;
      } catch (error) {
        console.error('[MarketplaceStore] 安装插件失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 卸载插件
     */
    async uninstallPlugin(pluginId: string): Promise<any> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'marketplace:uninstall-plugin',
          { pluginId }
        );

        if (result.success) {
          this.installedPlugins = this.installedPlugins.filter(
            (p) => p.plugin_id !== pluginId
          );
        }

        return result;
      } catch (error) {
        console.error('[MarketplaceStore] 卸载插件失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 更新插件
     */
    async updatePlugin(pluginId: string, version: string): Promise<any> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'marketplace:update-plugin',
          { pluginId, version }
        );

        if (result.success) {
          // 更新本地已安装插件的版本
          const installed = this.installedPlugins.find(
            (p) => p.plugin_id === pluginId
          );
          if (installed) {
            installed.version = version;
          }

          // 从可用更新中移除
          this.availableUpdates = this.availableUpdates.filter(
            (u) => u.pluginId !== pluginId
          );
        }

        return result;
      } catch (error) {
        console.error('[MarketplaceStore] 更新插件失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 启用插件
     */
    async enablePlugin(pluginId: string): Promise<any> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'marketplace:enable-plugin',
          { pluginId }
        );

        if (result.success) {
          const plugin = this.installedPlugins.find(
            (p) => p.plugin_id === pluginId
          );
          if (plugin) {
            plugin.enabled = true;
          }
        }

        return result;
      } catch (error) {
        console.error('[MarketplaceStore] 启用插件失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 禁用插件
     */
    async disablePlugin(pluginId: string): Promise<any> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'marketplace:disable-plugin',
          { pluginId }
        );

        if (result.success) {
          const plugin = this.installedPlugins.find(
            (p) => p.plugin_id === pluginId
          );
          if (plugin) {
            plugin.enabled = false;
          }
        }

        return result;
      } catch (error) {
        console.error('[MarketplaceStore] 禁用插件失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // 更新检查
    // ==========================================

    /**
     * 检查插件更新
     */
    async checkUpdates(): Promise<any> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'marketplace:check-updates'
        );

        if (result.success) {
          this.availableUpdates = result.updates || [];
        }

        return result;
      } catch (error) {
        console.error('[MarketplaceStore] 检查更新失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // 已安装插件管理
    // ==========================================

    /**
     * 获取已安装插件列表
     */
    async fetchInstalled(): Promise<any> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'marketplace:list-installed'
        );

        if (result.success) {
          this.installedPlugins = result.plugins || [];
        }

        return result;
      } catch (error) {
        console.error('[MarketplaceStore] 获取已安装插件失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // 评价管理
    // ==========================================

    /**
     * 评价插件
     */
    async ratePlugin(pluginId: string, rating: number, comment: string): Promise<any> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'marketplace:rate-plugin',
          { pluginId, rating, comment }
        );

        return result;
      } catch (error) {
        console.error('[MarketplaceStore] 评价插件失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 获取插件评价列表
     */
    async fetchRatings(pluginId: string): Promise<any> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'marketplace:get-ratings',
          { pluginId }
        );

        if (result.success) {
          this.ratings = result.ratings || [];
        }

        return result;
      } catch (error) {
        console.error('[MarketplaceStore] 获取评价列表失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // 辅助操作
    // ==========================================

    /**
     * 设置当前页码
     */
    setCurrentPage(page: number): void {
      this.currentPage = page;
    },

    /**
     * 设置每页大小
     */
    setPageSize(size: number): void {
      this.pageSize = size;
    },

    /**
     * 设置选中分类
     */
    setSelectedCategory(category: string): void {
      this.selectedCategory = category;
    },

    /**
     * 设置搜索关键词
     */
    setSearchKeyword(keyword: string): void {
      this.searchKeyword = keyword;
    },

    /**
     * 清除当前插件
     */
    clearCurrentPlugin(): void {
      this.currentPlugin = null;
      this.ratings = [];
    },

    /**
     * 重置所有状态
     */
    reset(): void {
      this.$reset();
    },
  },
});
