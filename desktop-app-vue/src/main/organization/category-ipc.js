const { ipcMain } = require("electron");
const CategoryManager = require("./category-manager");

/**
 * 注册项目分类管理的IPC处理函数
 * @param {Object} database - 数据库实例（DatabaseManager）
 * @param {Object} mainWindow - 主窗口实例
 */
function registerCategoryIPCHandlers(database, mainWindow) {
  let categoryManager = null;

  // 获取或创建 CategoryManager 实例
  const getCategoryManager = () => {
    if (!categoryManager) {
      // 从 DatabaseManager 中获取真正的数据库连接
      const db = database.db;
      if (!db) {
        throw new Error("数据库未初始化");
      }
      categoryManager = new CategoryManager(db);
    }
    return categoryManager;
  };

  // 初始化默认分类
  ipcMain.handle(
    "category:initialize-defaults",
    async (_event, userId = "local-user") => {
      try {
        const manager = getCategoryManager();
        manager.initializeDefaultCategories(userId);
        return { success: true };
      } catch (error) {
        console.error("[CategoryIPC] 初始化默认分类失败:", error);
        throw error;
      }
    },
  );

  // 获取所有分类（树形结构）
  ipcMain.handle("category:get-all", async (_event, userId = "local-user") => {
    try {
      const manager = getCategoryManager();
      const categories = manager.getProjectCategories(userId);
      return categories;
    } catch (error) {
      console.error("[CategoryIPC] 获取分类列表失败:", error);
      throw error;
    }
  });

  // 获取单个分类
  ipcMain.handle("category:get", async (_event, categoryId) => {
    try {
      const manager = getCategoryManager();
      const category = manager.getProjectCategoryById(categoryId);
      return category;
    } catch (error) {
      console.error("[CategoryIPC] 获取分类失败:", error);
      throw error;
    }
  });

  // 创建分类
  ipcMain.handle("category:create", async (_event, categoryData) => {
    try {
      const manager = getCategoryManager();
      const category = manager.createProjectCategory(categoryData);
      console.log("[CategoryIPC] 分类创建成功:", category);
      return category;
    } catch (error) {
      console.error("[CategoryIPC] 创建分类失败:", error);
      throw error;
    }
  });

  // 更新分类
  ipcMain.handle("category:update", async (_event, categoryId, updates) => {
    try {
      const manager = getCategoryManager();
      const category = manager.updateProjectCategory(categoryId, updates);
      console.log("[CategoryIPC] 分类更新成功:", category);
      return category;
    } catch (error) {
      console.error("[CategoryIPC] 更新分类失败:", error);
      throw error;
    }
  });

  // 删除分类
  ipcMain.handle("category:delete", async (_event, categoryId) => {
    try {
      const manager = getCategoryManager();
      const result = manager.deleteProjectCategory(categoryId);
      console.log("[CategoryIPC] 分类删除成功");
      return { success: result };
    } catch (error) {
      console.error("[CategoryIPC] 删除分类失败:", error);
      throw error;
    }
  });

  // 批量更新分类排序
  ipcMain.handle("category:update-sort", async (_event, sortData) => {
    try {
      const manager = getCategoryManager();
      const result = manager.batchUpdateCategorySort(sortData);
      console.log("[CategoryIPC] 分类排序更新成功");
      return { success: result };
    } catch (error) {
      console.error("[CategoryIPC] 更新分类排序失败:", error);
      throw error;
    }
  });

  console.log("[CategoryIPC] 项目分类管理IPC处理函数已注册");
}

module.exports = {
  registerCategoryIPCHandlers,
};
