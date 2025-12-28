import { defineStore } from 'pinia';

/**
 * 项目分类管理Store
 * 管理项目分类的CRUD操作和状态
 */
export const useCategoryStore = defineStore('category', {
  state: () => ({
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
    rootCategories: (state) => {
      return state.categories;
    },

    /**
     * 根据ID获取分类
     */
    getCategoryById: (state) => (categoryId) => {
      return state.flatCategories.find((cat) => cat.id === categoryId);
    },

    /**
     * 获取指定分类的子分类
     */
    getChildCategories: (state) => (parentId) => {
      return state.flatCategories.filter((cat) => cat.parent_id === parentId);
    },

    /**
     * 获取分类的完整路径（面包屑）
     */
    getCategoryPath: (state) => (categoryId) => {
      const path = [];
      let current = state.flatCategories.find((cat) => cat.id === categoryId);

      while (current) {
        path.unshift(current);
        current = state.flatCategories.find((cat) => cat.id === current.parent_id);
      }

      return path;
    },

    /**
     * 获取所有一级分类（用于选择器）
     */
    primaryCategoriesOptions: (state) => {
      return state.categories.map((cat) => ({
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
    async initializeDefaults(userId = 'local-user') {
      if (this.initialized) {
        console.log('[CategoryStore] 分类已初始化，跳过');
        return;
      }

      try {
        this.loading = true;
        await window.electronAPI.category.initializeDefaults(userId);
        await this.fetchCategories(userId);
        this.initialized = true;
        console.log('[CategoryStore] 默认分类初始化成功');
      } catch (error) {
        console.error('[CategoryStore] 初始化默认分类失败:', error);
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 获取所有分类（树形结构）
     */
    async fetchCategories(userId = 'local-user') {
      try {
        this.loading = true;
        const categories = await window.electronAPI.category.getAll(userId);
        this.categories = categories;

        // 构建扁平化列表
        this.flatCategories = this._flattenCategories(categories);

        console.log('[CategoryStore] 分类列表获取成功:', categories.length);
        return categories;
      } catch (error) {
        console.error('[CategoryStore] 获取分类列表失败:', error);
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 获取单个分类
     */
    async fetchCategory(categoryId) {
      try {
        const category = await window.electronAPI.category.get(categoryId);
        return category;
      } catch (error) {
        console.error('[CategoryStore] 获取分类失败:', error);
        throw error;
      }
    },

    /**
     * 创建分类
     */
    async createCategory(categoryData) {
      try {
        this.loading = true;
        const category = await window.electronAPI.category.create(categoryData);
        console.log('[CategoryStore] 分类创建成功:', category);

        // 刷新分类列表
        await this.fetchCategories(categoryData.user_id || 'local-user');

        return category;
      } catch (error) {
        console.error('[CategoryStore] 创建分类失败:', error);
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 更新分类
     */
    async updateCategory(categoryId, updates) {
      try {
        this.loading = true;
        const category = await window.electronAPI.category.update(categoryId, updates);
        console.log('[CategoryStore] 分类更新成功:', category);

        // 刷新分类列表
        await this.fetchCategories();

        return category;
      } catch (error) {
        console.error('[CategoryStore] 更新分类失败:', error);
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 删除分类
     */
    async deleteCategory(categoryId) {
      try {
        this.loading = true;
        await window.electronAPI.category.delete(categoryId);
        console.log('[CategoryStore] 分类删除成功');

        // 刷新分类列表
        await this.fetchCategories();

        // 如果删除的是当前选中的分类，清空选中状态
        if (this.selectedCategory?.id === categoryId) {
          this.selectedCategory = null;
        }

        return true;
      } catch (error) {
        console.error('[CategoryStore] 删除分类失败:', error);
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 批量更新分类排序
     */
    async updateCategorySort(sortData) {
      try {
        await window.electronAPI.category.updateSort(sortData);
        console.log('[CategoryStore] 分类排序更新成功');

        // 刷新分类列表
        await this.fetchCategories();

        return true;
      } catch (error) {
        console.error('[CategoryStore] 更新分类排序失败:', error);
        throw error;
      }
    },

    /**
     * 设置选中的分类
     */
    setSelectedCategory(category) {
      this.selectedCategory = category;
    },

    /**
     * 显示分类编辑对话框
     */
    showEditDialog(category = null) {
      this.editingCategory = category;
      this.dialogVisible = true;
    },

    /**
     * 隐藏分类编辑对话框
     */
    hideEditDialog() {
      this.dialogVisible = false;
      this.editingCategory = null;
    },

    /**
     * 辅助方法：将树形结构扁平化
     */
    _flattenCategories(categories, result = []) {
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
    reset() {
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
