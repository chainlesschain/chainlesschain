/**
 * Category Store - 项目分类管理
 */

import { logger } from '@/utils/logger';
import { defineStore } from 'pinia';

// ==================== 类型定义 ====================

/**
 * 分类选项（用于选择器）
 */
export interface CategoryOption {
  label: string;
  value: string;
  icon?: string;
  color?: string;
  children?: CategoryOption[];
}

/**
 * 分类信息
 */
export interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  user_id: string;
  icon?: string;
  color?: string;
  sort_order?: number;
  children?: Category[];
  created_at?: number;
  updated_at?: number;
  [key: string]: any;
}

/**
 * 分类创建/更新数据
 */
export interface CategoryData {
  name: string;
  parent_id?: string | null;
  user_id?: string;
  icon?: string;
  color?: string;
  sort_order?: number;
  [key: string]: any;
}

/**
 * 分类排序数据
 */
export interface CategorySortItem {
  id: string;
  sort_order: number;
}

/**
 * Category Store 状态
 */
export interface CategoryState {
  categories: Category[];
  flatCategories: Category[];
  selectedCategory: Category | null;
  loading: boolean;
  initialized: boolean;
  dialogVisible: boolean;
  editingCategory: Category | null;
}

// ==================== Store ====================

export const useCategoryStore = defineStore('category', {
  state: (): CategoryState => ({
    // 分类列表（树形结构）
    categories: [],

    // 扁平化的分类列表（用于快速查找）
    flatCategories: [],

    // 当前选中的分类
    selectedCategory: null,

    // UI状态
    loading: false,
    initialized: false,

    // 分类管理对话框状态
    dialogVisible: false,
    editingCategory: null,
  }),

  getters: {
    /**
     * 获取一级分类
     */
    rootCategories(): Category[] {
      return this.categories;
    },

    /**
     * 根据ID获取分类
     */
    getCategoryById(): (categoryId: string) => Category | undefined {
      return (categoryId: string): Category | undefined => {
        return this.flatCategories.find((cat) => cat.id === categoryId);
      };
    },

    /**
     * 获取指定分类的子分类
     */
    getChildCategories(): (parentId: string) => Category[] {
      return (parentId: string): Category[] => {
        return this.flatCategories.filter((cat) => cat.parent_id === parentId);
      };
    },

    /**
     * 获取分类的完整路径（面包屑）
     */
    getCategoryPath(): (categoryId: string) => Category[] {
      return (categoryId: string): Category[] => {
        const path: Category[] = [];
        let current: Category | undefined = this.flatCategories.find(
          (cat) => cat.id === categoryId
        );

        while (current) {
          path.unshift(current);
          current = this.flatCategories.find((cat) => cat.id === current!.parent_id);
        }

        return path;
      };
    },

    /**
     * 获取所有一级分类（用于选择器）
     */
    primaryCategoriesOptions(): CategoryOption[] {
      return this.categories.map((cat) => ({
        label: cat.name,
        value: cat.id,
        icon: cat.icon,
        color: cat.color,
        children: cat.children?.map((sub) => ({
          label: sub.name,
          value: sub.id,
          icon: sub.icon,
          color: sub.color,
        })),
      }));
    },
  },

  actions: {
    /**
     * 初始化默认分类
     */
    async initializeDefaults(userId: string = 'local-user'): Promise<void> {
      if (this.initialized) {
        logger.info('[CategoryStore] 分类已初始化，跳过');
        return;
      }

      try {
        this.loading = true;
        await (window as any).electronAPI.category.initializeDefaults(userId);
        await this.fetchCategories(userId);
        this.initialized = true;
        logger.info('[CategoryStore] 默认分类初始化成功');
      } catch (error) {
        // IPC 未就绪时静默处理
        if (!(error as Error).message?.includes('No handler registered')) {
          logger.error('[CategoryStore] 初始化默认分类失败:', error as any);
        }
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 获取所有分类（树形结构）
     */
    async fetchCategories(userId: string = 'local-user'): Promise<Category[]> {
      try {
        this.loading = true;
        const categories = await (window as any).electronAPI.category.getAll(userId);
        this.categories = categories;

        // 构建扁平化列表
        this.flatCategories = this._flattenCategories(categories);

        logger.info('[CategoryStore] 分类列表获取成功:', categories.length);
        return categories;
      } catch (error) {
        // IPC 未就绪时静默处理
        if (!(error as Error).message?.includes('No handler registered')) {
          logger.error('[CategoryStore] 获取分类列表失败:', error as any);
        }
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 获取单个分类
     */
    async fetchCategory(categoryId: string): Promise<Category> {
      try {
        const category = await (window as any).electronAPI.category.get(categoryId);
        return category;
      } catch (error) {
        logger.error('[CategoryStore] 获取分类失败:', error as any);
        throw error;
      }
    },

    /**
     * 创建分类
     */
    async createCategory(categoryData: CategoryData): Promise<Category> {
      try {
        this.loading = true;
        const category = await (window as any).electronAPI.category.create(categoryData);
        logger.info('[CategoryStore] 分类创建成功:', category);

        // 刷新分类列表
        await this.fetchCategories(categoryData.user_id || 'local-user');

        return category;
      } catch (error) {
        logger.error('[CategoryStore] 创建分类失败:', error as any);
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 更新分类
     */
    async updateCategory(categoryId: string, updates: Partial<CategoryData>): Promise<Category> {
      try {
        this.loading = true;
        const category = await (window as any).electronAPI.category.update(categoryId, updates);
        logger.info('[CategoryStore] 分类更新成功:', category);

        // 刷新分类列表
        await this.fetchCategories();

        return category;
      } catch (error) {
        logger.error('[CategoryStore] 更新分类失败:', error as any);
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 删除分类
     */
    async deleteCategory(categoryId: string): Promise<boolean> {
      try {
        this.loading = true;
        await (window as any).electronAPI.category.delete(categoryId);
        logger.info('[CategoryStore] 分类删除成功');

        // 刷新分类列表
        await this.fetchCategories();

        // 如果删除的是当前选中的分类，清空选中状态
        if (this.selectedCategory?.id === categoryId) {
          this.selectedCategory = null;
        }

        return true;
      } catch (error) {
        logger.error('[CategoryStore] 删除分类失败:', error as any);
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 批量更新分类排序
     */
    async updateCategorySort(sortData: CategorySortItem[]): Promise<boolean> {
      try {
        await (window as any).electronAPI.category.updateSort(sortData);
        logger.info('[CategoryStore] 分类排序更新成功');

        // 刷新分类列表
        await this.fetchCategories();

        return true;
      } catch (error) {
        logger.error('[CategoryStore] 更新分类排序失败:', error as any);
        throw error;
      }
    },

    /**
     * 设置选中的分类
     */
    setSelectedCategory(category: Category | null): void {
      this.selectedCategory = category;
    },

    /**
     * 显示分类编辑对话框
     */
    showEditDialog(category: Category | null = null): void {
      this.editingCategory = category;
      this.dialogVisible = true;
    },

    /**
     * 隐藏分类编辑对话框
     */
    hideEditDialog(): void {
      this.dialogVisible = false;
      this.editingCategory = null;
    },

    /**
     * 辅助方法：将树形结构扁平化
     */
    _flattenCategories(categories: Category[], result: Category[] = []): Category[] {
      categories.forEach((cat) => {
        result.push(cat);
        if (cat.children && cat.children.length > 0) {
          this._flattenCategories(cat.children, result);
        }
      });
      return result;
    },

    /**
     * 重置状态
     */
    reset(): void {
      this.categories = [];
      this.flatCategories = [];
      this.selectedCategory = null;
      this.loading = false;
      this.initialized = false;
      this.dialogVisible = false;
      this.editingCategory = null;
    },
  },
});
