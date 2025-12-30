const { v4: uuidv4 } = require('uuid');

/**
 * 项目分类管理器
 * 提供项目分类的CRUD操作
 */
class CategoryManager {
  constructor(db) {
    this.db = db;
  }

  /**
   * 初始化默认项目分类
   * @param {string} userId - 用户ID
   */
  initializeDefaultCategories(userId = 'local-user') {
    // 检查是否已经初始化过
    const existingStmt = this.db.prepare('SELECT COUNT(*) as count FROM project_categories WHERE user_id = ?');
    const result = existingStmt.get(userId);

    if (result && result.count > 0) {
      console.log('[CategoryManager] 默认分类已存在，跳过初始化');
      return;
    }

    console.log('[CategoryManager] 初始化默认项目分类...');

    const now = Date.now();
    const categories = [
      // 一级分类
      { id: uuidv4(), name: '写作', parent_id: null, icon: '✍️', color: '#1890ff', sort_order: 1 },
      { id: uuidv4(), name: '营销', parent_id: null, icon: '📢', color: '#52c41a', sort_order: 2 },
      { id: uuidv4(), name: 'Excel', parent_id: null, icon: '📊', color: '#13c2c2', sort_order: 3 },
      { id: uuidv4(), name: '简历', parent_id: null, icon: '📄', color: '#fa8c16', sort_order: 4 },
      { id: uuidv4(), name: 'PPT', parent_id: null, icon: '📽️', color: '#eb2f96', sort_order: 5 },
      { id: uuidv4(), name: '研究', parent_id: null, icon: '🔬', color: '#722ed1', sort_order: 6 },
      { id: uuidv4(), name: '教育', parent_id: null, icon: '🎓', color: '#fa541c', sort_order: 7 },
      { id: uuidv4(), name: '生活', parent_id: null, icon: '🏠', color: '#fadb14', sort_order: 8 },
      { id: uuidv4(), name: '播客', parent_id: null, icon: '🎙️', color: '#2f54eb', sort_order: 9 },
      { id: uuidv4(), name: '视频', parent_id: null, icon: '🎬', color: '#ff4d4f', sort_order: 10 },
      { id: uuidv4(), name: '设计', parent_id: null, icon: '🎨', color: '#f5222d', sort_order: 11 },
      { id: uuidv4(), name: '网页', parent_id: null, icon: '🌐', color: '#52c41a', sort_order: 12 },
      // 新增分类 - 日常生活与个人成长
      { id: uuidv4(), name: '学习', parent_id: null, icon: '📚', color: '#40a9ff', sort_order: 13 },
      { id: uuidv4(), name: '健康', parent_id: null, icon: '💪', color: '#73d13d', sort_order: 14 },
      { id: uuidv4(), name: '时间管理', parent_id: null, icon: '⏰', color: '#fa8c16', sort_order: 15 },
      { id: uuidv4(), name: '效率', parent_id: null, icon: '⚡', color: '#faad14', sort_order: 16 },
      // 新增分类 - 专业领域
      { id: uuidv4(), name: '编程', parent_id: null, icon: '💻', color: '#722ed1', sort_order: 17 },
      { id: uuidv4(), name: '数据科学', parent_id: null, icon: '📈', color: '#2f54eb', sort_order: 18 },
      { id: uuidv4(), name: '技术文档', parent_id: null, icon: '📖', color: '#597ef7', sort_order: 19 },
      { id: uuidv4(), name: '法律', parent_id: null, icon: '⚖️', color: '#722ed1', sort_order: 20 },
      // 新增分类 - 内容创作
      { id: uuidv4(), name: '创意写作', parent_id: null, icon: '✒️', color: '#9254de', sort_order: 21 },
      { id: uuidv4(), name: '社交媒体', parent_id: null, icon: '📱', color: '#eb2f96', sort_order: 22 },
      { id: uuidv4(), name: '电商', parent_id: null, icon: '🛒', color: '#52c41a', sort_order: 23 },
    ];

    // 保存一级分类的ID，用于创建二级分类
    const categoryIds = {};
    categories.forEach(cat => {
      categoryIds[cat.name] = cat.id;
    });

    // 二级分类
    const subcategories = [
      // 原有二级分类
      { name: '办公文档', parent_name: '写作', icon: '📝', color: '#1890ff', sort_order: 1 },
      { name: '商业', parent_name: '营销', icon: '💼', color: '#52c41a', sort_order: 1 },
      { name: '技术', parent_name: '网页', icon: '⚙️', color: '#722ed1', sort_order: 1 },
      { name: '活动', parent_name: '营销', icon: '🎉', color: '#fa8c16', sort_order: 2 },
      { name: '财务', parent_name: 'Excel', icon: '💰', color: '#13c2c2', sort_order: 1 },
      { name: '分析', parent_name: 'Excel', icon: '📈', color: '#13c2c2', sort_order: 2 },
      { name: '求职', parent_name: '简历', icon: '🔍', color: '#fa541c', sort_order: 1 },
      { name: '短视频', parent_name: '视频', icon: '📱', color: '#ff4d4f', sort_order: 1 },
      { name: '长视频', parent_name: '视频', icon: '📺', color: '#ff4d4f', sort_order: 2 },
      { name: '直播', parent_name: '视频', icon: '📡', color: '#ff4d4f', sort_order: 3 },
      { name: 'Vlog', parent_name: '视频', icon: '📹', color: '#ff4d4f', sort_order: 4 },
      { name: '动画', parent_name: '视频', icon: '🎨', color: '#ff4d4f', sort_order: 5 },
      { name: '测评', parent_name: '视频', icon: '🎮', color: '#ff4d4f', sort_order: 6 },

      // 学习分类
      { name: '笔记整理', parent_name: '学习', icon: '📔', color: '#40a9ff', sort_order: 1 },
      { name: '学习规划', parent_name: '学习', icon: '🎯', color: '#40a9ff', sort_order: 2 },

      // 健康分类
      { name: '健身运动', parent_name: '健康', icon: '🏃', color: '#73d13d', sort_order: 1 },
      { name: '饮食营养', parent_name: '健康', icon: '🥗', color: '#73d13d', sort_order: 2 },
      { name: '健康管理', parent_name: '健康', icon: '💊', color: '#73d13d', sort_order: 3 },

      // 时间管理分类
      { name: '目标规划', parent_name: '时间管理', icon: '🎯', color: '#fa8c16', sort_order: 1 },
      { name: '日常管理', parent_name: '时间管理', icon: '📅', color: '#fa8c16', sort_order: 2 },

      // 编程分类
      { name: '前端开发', parent_name: '编程', icon: '🎨', color: '#722ed1', sort_order: 1 },
      { name: '后端开发', parent_name: '编程', icon: '⚙️', color: '#722ed1', sort_order: 2 },
      { name: '小程序', parent_name: '编程', icon: '📱', color: '#722ed1', sort_order: 3 },

      // 数据科学分类
      { name: '数据处理', parent_name: '数据科学', icon: '🔧', color: '#2f54eb', sort_order: 1 },
      { name: '数据分析', parent_name: '数据科学', icon: '📊', color: '#2f54eb', sort_order: 2 },
      { name: '机器学习', parent_name: '数据科学', icon: '🤖', color: '#2f54eb', sort_order: 3 },

      // 技术文档分类
      { name: '开发文档', parent_name: '技术文档', icon: '📝', color: '#597ef7', sort_order: 1 },
      { name: '系统文档', parent_name: '技术文档', icon: '🏗️', color: '#597ef7', sort_order: 2 },

      // 法律分类
      { name: '合同协议', parent_name: '法律', icon: '📋', color: '#722ed1', sort_order: 1 },
      { name: '法律文书', parent_name: '法律', icon: '📜', color: '#722ed1', sort_order: 2 },

      // 创意写作分类
      { name: '小说/故事', parent_name: '创意写作', icon: '📖', color: '#9254de', sort_order: 1 },
      { name: '诗歌/歌词', parent_name: '创意写作', icon: '🎵', color: '#9254de', sort_order: 2 },
      { name: '剧本', parent_name: '创意写作', icon: '🎭', color: '#9254de', sort_order: 3 },

      // 社交媒体分类
      { name: '微信生态', parent_name: '社交媒体', icon: '💬', color: '#eb2f96', sort_order: 1 },
      { name: '内容平台', parent_name: '社交媒体', icon: '📢', color: '#eb2f96', sort_order: 2 },

      // 电商分类
      { name: '商品运营', parent_name: '电商', icon: '📦', color: '#52c41a', sort_order: 1 },
      { name: '营销活动', parent_name: '电商', icon: '🎁', color: '#52c41a', sort_order: 2 },
      { name: '客服/直播', parent_name: '电商', icon: '🎥', color: '#52c41a', sort_order: 3 },
    ];

    // 插入所有分类
    const stmt = this.db.prepare(`
      INSERT INTO project_categories (
        id, user_id, name, parent_id, icon, color, sort_order, description, created_at, updated_at, deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // 插入一级分类
    categories.forEach(cat => {
      stmt.run(cat.id, userId, cat.name, null, cat.icon, cat.color, cat.sort_order, null, now, now, 0);
    });

    // 插入二级分类
    subcategories.forEach(subcat => {
      const parentId = categoryIds[subcat.parent_name];
      if (parentId) {
        const id = uuidv4();
        stmt.run(id, userId, subcat.name, parentId, subcat.icon, subcat.color, subcat.sort_order, null, now, now, 0);
      }
    });

    this.db.saveToFile();
    console.log('[CategoryManager] 默认项目分类初始化完成');
  }

  /**
   * 获取所有项目分类（树形结构）
   * @param {string} userId - 用户ID
   * @returns {Array} 分类树
   */
  getProjectCategories(userId = 'local-user') {
    const stmt = this.db.prepare(`
      SELECT * FROM project_categories
      WHERE user_id = ? AND deleted = 0
      ORDER BY sort_order ASC
    `);

    const categories = stmt.all(userId);

    // 构建树形结构
    const categoryMap = {};
    const rootCategories = [];

    categories.forEach(cat => {
      categoryMap[cat.id] = { ...cat, children: [] };
    });

    categories.forEach(cat => {
      if (cat.parent_id && categoryMap[cat.parent_id]) {
        categoryMap[cat.parent_id].children.push(categoryMap[cat.id]);
      } else if (!cat.parent_id) {
        rootCategories.push(categoryMap[cat.id]);
      }
    });

    return rootCategories;
  }

  /**
   * 获取单个项目分类
   * @param {string} categoryId - 分类ID
   * @returns {Object|null} 分类对象
   */
  getProjectCategoryById(categoryId) {
    const stmt = this.db.prepare('SELECT * FROM project_categories WHERE id = ? AND deleted = 0');
    return stmt.get(categoryId);
  }

  /**
   * 创建项目分类
   * @param {Object} categoryData - 分类数据
   * @returns {Object} 创建的分类
   */
  createProjectCategory(categoryData) {
    const id = categoryData.id || uuidv4();
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO project_categories (
        id, user_id, name, parent_id, icon, color, sort_order, description, created_at, updated_at, deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      categoryData.user_id || 'local-user',
      categoryData.name,
      categoryData.parent_id || null,
      categoryData.icon || '📁',
      categoryData.color || '#1890ff',
      categoryData.sort_order || 0,
      categoryData.description || null,
      now,
      now,
      0
    );

    this.db.saveToFile();
    return this.getProjectCategoryById(id);
  }

  /**
   * 更新项目分类
   * @param {string} categoryId - 分类ID
   * @param {Object} updates - 更新数据
   * @returns {Object|null} 更新后的分类
   */
  updateProjectCategory(categoryId, updates) {
    const fields = [];
    const values = [];

    const allowedFields = ['name', 'parent_id', 'icon', 'color', 'sort_order', 'description'];

    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(updates[field]);
      }
    });

    // 总是更新 updated_at
    fields.push('updated_at = ?');
    values.push(Date.now());

    values.push(categoryId);

    if (fields.length === 1) {
      return this.getProjectCategoryById(categoryId);
    }

    this.db.run(`
      UPDATE project_categories SET ${fields.join(', ')} WHERE id = ?
    `, values);

    this.db.saveToFile();
    return this.getProjectCategoryById(categoryId);
  }

  /**
   * 删除项目分类（软删除）
   * @param {string} categoryId - 分类ID
   * @returns {boolean} 是否删除成功
   */
  deleteProjectCategory(categoryId) {
    // 检查是否有子分类
    const childrenStmt = this.db.prepare(
      'SELECT COUNT(*) as count FROM project_categories WHERE parent_id = ? AND deleted = 0'
    );
    const childrenResult = childrenStmt.get(categoryId);

    if (childrenResult && childrenResult.count > 0) {
      throw new Error('无法删除：该分类下还有子分类');
    }

    // 检查是否有关联的项目
    const projectsStmt = this.db.prepare(
      'SELECT COUNT(*) as count FROM projects WHERE category_id = ? AND deleted = 0'
    );
    const projectsResult = projectsStmt.get(categoryId);

    if (projectsResult && projectsResult.count > 0) {
      throw new Error('无法删除：该分类下还有项目');
    }

    // 软删除
    const stmt = this.db.prepare(`
      UPDATE project_categories
      SET deleted = 1, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(Date.now(), categoryId);
    this.db.saveToFile();
    return true;
  }

  /**
   * 批量更新分类排序
   * @param {Array} sortData - 排序数据 [{id, sort_order}, ...]
   * @returns {boolean} 是否成功
   */
  batchUpdateCategorySort(sortData) {
    try {
      this.db.transaction(() => {
        const stmt = this.db.prepare(`
          UPDATE project_categories
          SET sort_order = ?, updated_at = ?
          WHERE id = ?
        `);

        const now = Date.now();
        sortData.forEach(item => {
          stmt.run(item.sort_order, now, item.id);
        });
      });

      return true;
    } catch (error) {
      console.error('[CategoryManager] 批量更新分类排序失败:', error);
      return false;
    }
  }
}

module.exports = CategoryManager;
