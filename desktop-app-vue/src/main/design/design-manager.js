/**
 * 设计项目管理器
 * 负责管理设计项目、画板和设计元素的 CRUD 操作
 */

const { v4: uuidv4 } = require('uuid');

class DesignManager {
  constructor(db) {
    this.db = db;
  }

  /**
   * 创建设计项目
   * @param {Object} projectData - 项目数据
   * @returns {Promise<Object>} 创建的项目
   */
  async createDesignProject(projectData) {
    const {
      userId,
      name,
      description = '',
      width = 1920,
      height = 1080,
      templateId = null,
      tags = []
    } = projectData;

    const projectId = uuidv4();
    const now = Date.now();

    try {
      // 开始事务
      this.db.run('BEGIN TRANSACTION');

      // 创建项目
      this.db.run(
        `INSERT INTO projects (
          id, user_id, name, description, project_type, status,
          template_id, tags, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'design', 'active', ?, ?, ?, ?)`,
        [
          projectId,
          userId,
          name,
          description,
          templateId,
          JSON.stringify(tags),
          now,
          now
        ]
      );

      // 创建默认画板
      const artboardId = await this.createArtboard({
        projectId,
        name: 'Artboard 1',
        width,
        height
      });

      // 提交事务
      this.db.run('COMMIT');

      // 返回完整项目信息
      return {
        id: projectId,
        userId,
        name,
        description,
        projectType: 'design',
        status: 'active',
        templateId,
        tags,
        defaultArtboardId: artboardId,
        createdAt: now,
        updatedAt: now
      };
    } catch (error) {
      // 回滚事务
      this.db.run('ROLLBACK');
      throw error;
    }
  }

  /**
   * 获取设计项目
   * @param {string} projectId - 项目 ID
   * @returns {Promise<Object>} 项目信息
   */
  async getDesignProject(projectId) {
    const project = this.db.prepare(
      'SELECT * FROM projects WHERE id = ? AND project_type = ?'
    ).get(projectId, 'design');

    if (!project) {
      throw new Error(`设计项目不存在: ${projectId}`);
    }

    // 获取项目的所有画板
    const artboards = await this.getProjectArtboards(projectId);

    return {
      ...project,
      artboards
    };
  }

  /**
   * 更新设计项目
   * @param {string} projectId - 项目 ID
   * @param {Object} updates - 更新数据
   */
  async updateDesignProject(projectId, updates) {
    const { name, description, status, tags } = updates;
    const now = Date.now();

    const fields = [];
    const values = [];

    if (name !== undefined) {
      fields.push('name = ?');
      values.push(name);
    }
    if (description !== undefined) {
      fields.push('description = ?');
      values.push(description);
    }
    if (status !== undefined) {
      fields.push('status = ?');
      values.push(status);
    }
    if (tags !== undefined) {
      fields.push('tags = ?');
      values.push(JSON.stringify(tags));
    }

    fields.push('updated_at = ?');
    values.push(now);

    values.push(projectId);

    this.db.run(
      `UPDATE projects SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    return { success: true, updatedAt: now };
  }

  /**
   * 删除设计项目
   * @param {string} projectId - 项目 ID
   */
  async deleteDesignProject(projectId) {
    this.db.run('DELETE FROM projects WHERE id = ?', [projectId]);
    return { success: true };
  }

  // ========== 画板管理 ==========

  /**
   * 创建画板
   * @param {Object} artboardData - 画板数据
   * @returns {Promise<string>} 画板 ID
   */
  async createArtboard(artboardData) {
    const {
      projectId,
      name = 'Untitled Artboard',
      width = 1920,
      height = 1080,
      backgroundColor = '#FFFFFF',
      positionX = 0,
      positionY = 0
    } = artboardData;

    const artboardId = uuidv4();
    const now = Date.now();

    // 获取当前最大 order_index
    const maxOrder = this.db.prepare(
      'SELECT COALESCE(MAX(order_index), -1) as max_order FROM design_artboards WHERE project_id = ?'
    ).get(projectId);

    const orderIndex = (maxOrder?.max_order ?? -1) + 1;

    this.db.run(
      `INSERT INTO design_artboards (
        id, project_id, name, width, height, background_color,
        position_x, position_y, order_index, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        artboardId,
        projectId,
        name,
        width,
        height,
        backgroundColor,
        positionX,
        positionY,
        orderIndex,
        now,
        now
      ]
    );

    return artboardId;
  }

  /**
   * 获取项目的所有画板
   * @param {string} projectId - 项目 ID
   * @returns {Promise<Array>} 画板列表
   */
  async getProjectArtboards(projectId) {
    return this.db.prepare(
      'SELECT * FROM design_artboards WHERE project_id = ? ORDER BY order_index'
    ).all(projectId);
  }

  /**
   * 获取画板详情（包含所有对象）
   * @param {string} artboardId - 画板 ID
   * @returns {Promise<Object>} 画板信息和对象列表
   */
  async getArtboard(artboardId) {
    const artboard = this.db.prepare(
      'SELECT * FROM design_artboards WHERE id = ?'
    ).get(artboardId);

    if (!artboard) {
      throw new Error(`画板不存在: ${artboardId}`);
    }

    const objects = await this.getArtboardObjects(artboardId);

    return {
      artboard,
      objects
    };
  }

  /**
   * 更新画板
   * @param {string} artboardId - 画板 ID
   * @param {Object} updates - 更新数据
   */
  async updateArtboard(artboardId, updates) {
    const { name, width, height, backgroundColor, positionX, positionY } = updates;
    const now = Date.now();

    const fields = [];
    const values = [];

    if (name !== undefined) {
      fields.push('name = ?');
      values.push(name);
    }
    if (width !== undefined) {
      fields.push('width = ?');
      values.push(width);
    }
    if (height !== undefined) {
      fields.push('height = ?');
      values.push(height);
    }
    if (backgroundColor !== undefined) {
      fields.push('background_color = ?');
      values.push(backgroundColor);
    }
    if (positionX !== undefined) {
      fields.push('position_x = ?');
      values.push(positionX);
    }
    if (positionY !== undefined) {
      fields.push('position_y = ?');
      values.push(positionY);
    }

    fields.push('updated_at = ?');
    values.push(now);

    values.push(artboardId);

    this.db.run(
      `UPDATE design_artboards SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    return { success: true, updatedAt: now };
  }

  /**
   * 删除画板
   * @param {string} artboardId - 画板 ID
   */
  async deleteArtboard(artboardId) {
    this.db.run('DELETE FROM design_artboards WHERE id = ?', [artboardId]);
    return { success: true };
  }

  // ========== 对象管理 ==========

  /**
   * 添加设计对象
   * @param {Object} objectData - 对象数据
   * @returns {Promise<string>} 对象 ID
   */
  async addObject(objectData) {
    const {
      artboardId,
      objectType,
      name = 'Layer',
      fabricJson,
      parentId = null,
      constraints = null,
      metadata = null
    } = objectData;

    const objectId = uuidv4();
    const now = Date.now();

    // 获取当前最大 order_index
    const maxOrder = this.db.prepare(
      'SELECT COALESCE(MAX(order_index), -1) as max_order FROM design_objects WHERE artboard_id = ?'
    ).get(artboardId);

    const orderIndex = (maxOrder?.max_order ?? -1) + 1;

    this.db.run(
      `INSERT INTO design_objects (
        id, artboard_id, object_type, name, fabric_json,
        parent_id, order_index, constraints, metadata,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        objectId,
        artboardId,
        objectType,
        name,
        JSON.stringify(fabricJson),
        parentId,
        orderIndex,
        constraints ? JSON.stringify(constraints) : null,
        metadata ? JSON.stringify(metadata) : null,
        now,
        now
      ]
    );

    return objectId;
  }

  /**
   * 获取画板的所有对象
   * @param {string} artboardId - 画板 ID
   * @returns {Promise<Array>} 对象列表
   */
  async getArtboardObjects(artboardId) {
    return this.db.prepare(
      'SELECT * FROM design_objects WHERE artboard_id = ? ORDER BY order_index'
    ).all(artboardId);
  }

  /**
   * 更新对象
   * @param {string} objectId - 对象 ID
   * @param {Object} updates - 更新数据
   */
  async updateObject(objectId, updates) {
    const { name, fabricJson, isLocked, isVisible, constraints, metadata } = updates;
    const now = Date.now();

    const fields = [];
    const values = [];

    if (name !== undefined) {
      fields.push('name = ?');
      values.push(name);
    }
    if (fabricJson !== undefined) {
      fields.push('fabric_json = ?');
      values.push(JSON.stringify(fabricJson));
    }
    if (isLocked !== undefined) {
      fields.push('is_locked = ?');
      values.push(isLocked ? 1 : 0);
    }
    if (isVisible !== undefined) {
      fields.push('is_visible = ?');
      values.push(isVisible ? 1 : 0);
    }
    if (constraints !== undefined) {
      fields.push('constraints = ?');
      values.push(constraints ? JSON.stringify(constraints) : null);
    }
    if (metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(metadata ? JSON.stringify(metadata) : null);
    }

    fields.push('updated_at = ?');
    values.push(now);

    values.push(objectId);

    this.db.run(
      `UPDATE design_objects SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    return { success: true, updatedAt: now };
  }

  /**
   * 删除对象
   * @param {string} objectId - 对象 ID
   */
  async deleteObject(objectId) {
    this.db.run('DELETE FROM design_objects WHERE id = ?', [objectId]);
    return { success: true };
  }

  /**
   * 批量更新对象顺序
   * @param {Array} objectIds - 对象 ID 列表（按新顺序）
   */
  async reorderObjects(objectIds) {
    try {
      this.db.run('BEGIN TRANSACTION');

      const stmt = this.db.prepare(
        'UPDATE design_objects SET order_index = ?, updated_at = ? WHERE id = ?'
      );

      const now = Date.now();
      objectIds.forEach((objectId, index) => {
        stmt.run(index, now, objectId);
      });

      stmt.finalize();
      this.db.run('COMMIT');

      return { success: true };
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
  }

  /**
   * 保存画板（批量更新所有对象）
   * @param {string} artboardId - 画板 ID
   * @param {Array} objects - 对象列表（包含完整的 fabric_json）
   */
  async saveArtboard(artboardId, objects) {
    try {
      this.db.run('BEGIN TRANSACTION');

      const now = Date.now();
      const stmt = this.db.prepare(
        'UPDATE design_objects SET fabric_json = ?, updated_at = ? WHERE id = ?'
      );

      for (const obj of objects) {
        if (obj.id && obj.fabric_json) {
          stmt.run(JSON.stringify(obj.fabric_json), now, obj.id);
        }
      }

      stmt.finalize();
      this.db.run('COMMIT');

      return { success: true, updatedAt: now };
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
  }
}

module.exports = { DesignManager };
