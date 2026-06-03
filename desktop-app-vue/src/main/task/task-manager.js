const { logger } = require('../utils/logger.js');
const { v4: uuidv4 } = require('uuid');

/**
 * 任务管理器 - 企业协作任务管理核心模块
 * Phase 1 - v0.17.0
 *
 * 功能:
 * - 任务CRUD
 * - 任务分配与协作
 * - 任务评论
 * - 任务变更历史
 * - 任务看板管理
 *
 * @class TaskManager
 */
class TaskManager {
  /**
   * @param {Object} db - 数据库实例
   * @param {Object} organizationManager - 组织管理器实例
   */
  constructor(db, organizationManager) {
    this.db = db;
    this.organizationManager = organizationManager;
  }

  /**
   * 创建任务
   * @param {Object} taskData - 任务数据
   * @param {string} taskData.project_id - 项目ID
   * @param {string} taskData.org_id - 组织ID（可选）
   * @param {string} taskData.workspace_id - 工作区ID（可选）
   * @param {string} taskData.title - 任务标题
   * @param {string} taskData.description - 任务描述
   * @param {string} taskData.status - 状态 (pending|in_progress|completed|cancelled)
   * @param {string} taskData.priority - 优先级 (low|medium|high|urgent)
   * @param {string} taskData.assigned_to - 指派给（DID）
   * @param {Array<string>} taskData.collaborators - 协作者列表
   * @param {Array<string>} taskData.labels - 标签列表
   * @param {number} taskData.due_date - 截止日期
   * @param {number} taskData.estimate_hours - 预估工时
   * @param {string} creatorDID - 创建者DID
   * @returns {Promise<Object>} 创建的任务信息
   */
  async createTask(taskData, creatorDID) {
    logger.info('[TaskManager] 创建任务:', taskData.title);

    try {
      // 1. 检查权限
      if (taskData.org_id) {
        const hasPermission = await this.organizationManager.checkPermission(
          taskData.org_id,
          creatorDID,
          'task.create'
        );
        if (!hasPermission) {
          throw new Error('没有权限创建任务');
        }
      }

      // 2. 创建任务
      const taskId = `task_${uuidv4().replace(/-/g, '')}`;
      const now = Date.now();

      const task = {
        id: taskId,
        project_id: taskData.project_id,
        org_id: taskData.org_id || null,
        workspace_id: taskData.workspace_id || null,
        title: taskData.title,
        description: taskData.description || '',
        status: taskData.status || 'pending',
        priority: taskData.priority || 'medium',
        assigned_to: taskData.assigned_to || null,
        collaborators: JSON.stringify(taskData.collaborators || []),
        labels: JSON.stringify(taskData.labels || []),
        due_date: taskData.due_date || null,
        reminder_at: taskData.reminder_at || null,
        blocked_by: JSON.stringify(taskData.blocked_by || []),
        estimate_hours: taskData.estimate_hours || null,
        actual_hours: null,
        created_by: creatorDID,
        created_at: now,
        updated_at: now,
        completed_at: null
      };

      this.db.prepare(`
        INSERT INTO project_tasks
        (id, project_id, org_id, workspace_id, title, description, status, priority,
         assigned_to, collaborators, labels, due_date, reminder_at, blocked_by,
         estimate_hours, actual_hours, created_by, created_at, updated_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        task.id, task.project_id, task.org_id, task.workspace_id, task.title,
        task.description, task.status, task.priority, task.assigned_to,
        task.collaborators, task.labels, task.due_date, task.reminder_at,
        task.blocked_by, task.estimate_hours, task.actual_hours,
        task.created_by, task.created_at, task.updated_at, task.completed_at
      );

      // 3. 记录变更历史
      await this.recordChange(taskId, creatorDID, 'create', null, JSON.stringify(task));

      // 4. 记录活动日志
      if (task.org_id) {
        await this.organizationManager.logActivity(
          task.org_id,
          creatorDID,
          'create_task',
          'task',
          taskId,
          { title: task.title, projectId: task.project_id }
        );
      }

      logger.info('[TaskManager] ✓ 任务创建成功:', taskId);

      return {
        ...task,
        collaborators: JSON.parse(task.collaborators),
        labels: JSON.parse(task.labels),
        blocked_by: JSON.parse(task.blocked_by)
      };
    } catch (error) {
      logger.error('[TaskManager] 创建任务失败:', error);
      throw error;
    }
  }

  /**
   * 更新任务
   * @param {string} taskId - 任务ID
   * @param {Object} updates - 更新字段
   * @param {string} updaterDID - 更新者DID
   * @returns {Promise<Object>} 更新结果
   */
  async updateTask(taskId, updates, updaterDID) {
    try {
      // 1. 获取原任务
      const oldTask = await this.getTask(taskId);
      if (!oldTask) {
        return { success: false, error: '任务不存在' };
      }

      // 2. 检查权限
      if (oldTask.org_id) {
        const hasPermission = await this.organizationManager.checkPermission(
          oldTask.org_id,
          updaterDID,
          'task.edit'
        );
        if (!hasPermission) {
          return { success: false, error: '没有权限编辑任务' };
        }
      }

      // 3. 构建更新SQL
      const fields = [];
      const values = [];
      const changes = [];

      const updateFields = {
        title: 'TEXT',
        description: 'TEXT',
        status: 'TEXT',
        priority: 'TEXT',
        assigned_to: 'TEXT',
        collaborators: 'JSON',
        labels: 'JSON',
        due_date: 'INTEGER',
        reminder_at: 'INTEGER',
        blocked_by: 'JSON',
        estimate_hours: 'REAL',
        actual_hours: 'REAL'
      };

      for (const [field, type] of Object.entries(updateFields)) {
        if (updates[field] !== undefined) {
          fields.push(`${field} = ?`);

          let value = updates[field];
          if (type === 'JSON' && typeof value !== 'string') {
            value = JSON.stringify(value);
          }

          values.push(value);

          // 记录变更
          const oldValue = oldTask[field];
          if (JSON.stringify(oldValue) !== JSON.stringify(updates[field])) {
            changes.push({
              field,
              oldValue: type === 'JSON' ? JSON.parse(oldValue || '[]') : oldValue,
              newValue: updates[field]
            });
          }
        }
      }

      if (fields.length === 0) {
        return { success: false, error: '没有需要更新的字段' };
      }

      // 状态变更为完成时，设置完成时间
      if (updates.status === 'completed' && oldTask.status !== 'completed') {
        fields.push('completed_at = ?');
        values.push(Date.now());
      }

      // 添加更新时间
      fields.push('updated_at = ?');
      values.push(Date.now());

      values.push(taskId);

      // 4. 执行更新
      const sql = `UPDATE project_tasks SET ${fields.join(', ')} WHERE id = ?`;
      this.db.prepare(sql).run(...values);

      // 5. 记录所有变更
      for (const change of changes) {
        await this.recordChange(
          taskId,
          updaterDID,
          change.field,
          JSON.stringify(change.oldValue),
          JSON.stringify(change.newValue)
        );
      }

      // 6. 记录活动日志
      if (oldTask.org_id) {
        await this.organizationManager.logActivity(
          oldTask.org_id,
          updaterDID,
          'update_task',
          'task',
          taskId,
          { changes: changes.map(c => c.field) }
        );
      }

      logger.info('[TaskManager] ✓ 任务更新成功:', taskId);

      return { success: true };
    } catch (error) {
      logger.error('[TaskManager] 更新任务失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 删除任务
   * @param {string} taskId - 任务ID
   * @param {string} deleterDID - 删除者DID
   * @returns {Promise<Object>} 删除结果
   */
  async deleteTask(taskId, deleterDID) {
    try {
      const task = await this.getTask(taskId);
      if (!task) {
        return { success: false, error: '任务不存在' };
      }

      // 检查权限
      if (task.org_id) {
        const hasPermission = await this.organizationManager.checkPermission(
          task.org_id,
          deleterDID,
          'task.delete'
        );
        if (!hasPermission) {
          return { success: false, error: '没有权限删除任务' };
        }
      }

      // 删除任务（级联删除评论和变更历史）
      this.db.prepare('DELETE FROM project_tasks WHERE id = ?').run(taskId);
      this.db.prepare('DELETE FROM task_comments WHERE task_id = ?').run(taskId);
      this.db.prepare('DELETE FROM task_changes WHERE task_id = ?').run(taskId);

      // 记录活动日志
      if (task.org_id) {
        await this.organizationManager.logActivity(
          task.org_id,
          deleterDID,
          'delete_task',
          'task',
          taskId,
          { title: task.title }
        );
      }

      logger.info('[TaskManager] ✓ 任务删除成功:', taskId);

      return { success: true };
    } catch (error) {
      logger.error('[TaskManager] 删除任务失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取任务列表
   * @param {Object} filters - 筛选条件
   * @param {string} filters.org_id - 组织ID
   * @param {string} filters.workspace_id - 工作区ID
   * @param {string} filters.project_id - 项目ID
   * @param {string} filters.status - 状态
   * @param {string} filters.assigned_to - 指派给
   * @param {number} filters.limit - 限制数量
   * @param {number} filters.offset - 偏移量
   * @returns {Promise<Array>} 任务列表
   */
  async getTasks(filters = {}) {
    try {
      let sql = 'SELECT * FROM project_tasks WHERE 1=1';
      const params = [];

      if (filters.org_id) {
        sql += ' AND org_id = ?';
        params.push(filters.org_id);
      }

      if (filters.workspace_id) {
        sql += ' AND workspace_id = ?';
        params.push(filters.workspace_id);
      }

      if (filters.project_id) {
        sql += ' AND project_id = ?';
        params.push(filters.project_id);
      }

      if (filters.status) {
        sql += ' AND status = ?';
        params.push(filters.status);
      }

      if (filters.assigned_to) {
        sql += ' AND assigned_to = ?';
        params.push(filters.assigned_to);
      }

      sql += ' ORDER BY created_at DESC';

      if (filters.limit) {
        sql += ' LIMIT ?';
        params.push(filters.limit);

        if (filters.offset) {
          sql += ' OFFSET ?';
          params.push(filters.offset);
        }
      }

      const tasks = this.db.prepare(sql).all(...params);

      return tasks.map(task => ({
        ...task,
        collaborators: JSON.parse(task.collaborators || '[]'),
        labels: JSON.parse(task.labels || '[]'),
        blocked_by: JSON.parse(task.blocked_by || '[]')
      }));
    } catch (error) {
      logger.error('[TaskManager] 获取任务列表失败:', error);
      return [];
    }
  }

  /**
   * 获取单个任务详情
   * @param {string} taskId - 任务ID
   * @returns {Promise<Object|null>} 任务信息
   */
  async getTask(taskId) {
    try {
      const task = this.db.prepare(
        'SELECT * FROM project_tasks WHERE id = ?'
      ).get(taskId);

      if (!task) {
        return null;
      }

      return {
        ...task,
        collaborators: JSON.parse(task.collaborators || '[]'),
        labels: JSON.parse(task.labels || '[]'),
        blocked_by: JSON.parse(task.blocked_by || '[]')
      };
    } catch (error) {
      logger.error('[TaskManager] 获取任务失败:', error);
      return null;
    }
  }

  /**
   * 分配任务
   * @param {string} taskId - 任务ID
   * @param {string} assignedTo - 被指派人DID
   * @param {string} assignerDID - 指派人DID
   * @returns {Promise<Object>} 分配结果
   */
  async assignTask(taskId, assignedTo, assignerDID) {
    try {
      const task = await this.getTask(taskId);
      if (!task) {
        return { success: false, error: '任务不存在' };
      }

      // 检查权限
      if (task.org_id) {
        const hasPermission = await this.organizationManager.checkPermission(
          task.org_id,
          assignerDID,
          'task.assign'
        );
        if (!hasPermission) {
          return { success: false, error: '没有权限分配任务' };
        }
      }

      const oldAssignee = task.assigned_to;

      // 更新指派
      this.db.prepare(
        'UPDATE project_tasks SET assigned_to = ?, updated_at = ? WHERE id = ?'
      ).run(assignedTo, Date.now(), taskId);

      // 记录变更
      await this.recordChange(
        taskId,
        assignerDID,
        'assigned_to',
        oldAssignee,
        assignedTo
      );

      logger.info('[TaskManager] ✓ 任务分配成功:', taskId, '→', assignedTo);

      return { success: true };
    } catch (error) {
      logger.error('[TaskManager] 分配任务失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 变更任务状态
   * @param {string} taskId - 任务ID
   * @param {string} newStatus - 新状态
   * @param {string} changerDID - 更改者DID
   * @returns {Promise<Object>} 变更结果
   */
  async changeStatus(taskId, newStatus, changerDID) {
    return await this.updateTask(taskId, { status: newStatus }, changerDID);
  }

  /**
   * 添加任务评论
   * @param {string} taskId - 任务ID
   * @param {Object} commentData - 评论数据
   * @param {string} commentData.content - 评论内容
   * @param {Array<string>} commentData.mentions - 提到的成员
   * @param {Array<Object>} commentData.attachments - 附件
   * @param {string} authorDID - 作者DID
   * @returns {Promise<Object>} 评论信息
   */
  async addComment(taskId, commentData, authorDID) {
    try {
      const commentId = uuidv4();
      const now = Date.now();

      const comment = {
        id: commentId,
        task_id: taskId,
        author_did: authorDID,
        content: commentData.content,
        mentions: JSON.stringify(commentData.mentions || []),
        attachments: JSON.stringify(commentData.attachments || []),
        created_at: now,
        updated_at: now,
        is_deleted: 0
      };

      this.db.prepare(`
        INSERT INTO task_comments
        (id, task_id, author_did, content, mentions, attachments, created_at, updated_at, is_deleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        comment.id, comment.task_id, comment.author_did, comment.content,
        comment.mentions, comment.attachments, comment.created_at,
        comment.updated_at, comment.is_deleted
      );

      logger.info('[TaskManager] ✓ 评论添加成功:', commentId);

      return {
        ...comment,
        mentions: JSON.parse(comment.mentions),
        attachments: JSON.parse(comment.attachments)
      };
    } catch (error) {
      logger.error('[TaskManager] 添加评论失败:', error);
      throw error;
    }
  }

  /**
   * 获取任务评论列表
   * @param {string} taskId - 任务ID
   * @returns {Promise<Array>} 评论列表
   */
  async getComments(taskId) {
    try {
      const comments = this.db.prepare(
        'SELECT * FROM task_comments WHERE task_id = ? AND is_deleted = 0 ORDER BY created_at ASC'
      ).all(taskId);

      return comments.map(comment => ({
        ...comment,
        is_deleted: Boolean(comment.is_deleted),
        mentions: JSON.parse(comment.mentions || '[]'),
        attachments: JSON.parse(comment.attachments || '[]')
      }));
    } catch (error) {
      logger.error('[TaskManager] 获取评论列表失败:', error);
      return [];
    }
  }

  /**
   * 删除评论
   * @param {string} commentId - 评论ID
   * @param {string} deleterDID - 删除者DID
   * @returns {Promise<Object>} 删除结果
   */
  async deleteComment(commentId, _deleterDID) {
    try {
      // 软删除
      this.db.prepare(
        'UPDATE task_comments SET is_deleted = 1, updated_at = ? WHERE id = ?'
      ).run(Date.now(), commentId);

      logger.info('[TaskManager] ✓ 评论删除成功:', commentId);

      return { success: true };
    } catch (error) {
      logger.error('[TaskManager] 删除评论失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取任务变更历史
   * @param {string} taskId - 任务ID
   * @returns {Promise<Array>} 变更历史
   */
  async getChanges(taskId) {
    try {
      const changes = this.db.prepare(
        'SELECT * FROM task_changes WHERE task_id = ? ORDER BY changed_at DESC'
      ).all(taskId);

      return changes || [];
    } catch (error) {
      logger.error('[TaskManager] 获取变更历史失败:', error);
      return [];
    }
  }

  /**
   * 记录任务变更
   * @param {string} taskId - 任务ID
   * @param {string} changerDID - 更改者DID
   * @param {string} changeType - 变更类型
   * @param {string} oldValue - 旧值
   * @param {string} newValue - 新值
   * @returns {Promise<void>}
   */
  async recordChange(taskId, changerDID, changeType, oldValue, newValue) {
    try {
      const changeId = uuidv4();

      this.db.prepare(`
        INSERT INTO task_changes (id, task_id, changed_by, change_type, old_value, new_value, changed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(changeId, taskId, changerDID, changeType, oldValue, newValue, Date.now());
    } catch (error) {
      logger.error('[TaskManager] 记录变更失败:', error);
    }
  }

  /**
   * 创建任务看板
   * @param {string} orgId - 组织ID
   * @param {Object} boardData - 看板数据
   * @param {string} boardData.name - 看板名称
   * @param {Array<Object>} boardData.columns - 列配置
   * @param {string} creatorDID - 创建者DID
   * @returns {Promise<Object>} 看板信息
   */
  async createBoard(orgId, boardData, creatorDID) {
    try {
      const boardId = uuidv4();

      const board = {
        id: boardId,
        org_id: orgId,
        workspace_id: boardData.workspace_id || null,
        name: boardData.name,
        description: boardData.description || '',
        columns: JSON.stringify(boardData.columns || [
          { id: 'pending', name: '待处理', status: 'pending', order: 1 },
          { id: 'in_progress', name: '进行中', status: 'in_progress', order: 2 },
          { id: 'completed', name: '已完成', status: 'completed', order: 3 }
        ]),
        filters: JSON.stringify(boardData.filters || {}),
        created_by: creatorDID,
        created_at: Date.now()
      };

      this.db.prepare(`
        INSERT INTO task_boards
        (id, org_id, workspace_id, name, description, columns, filters, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        board.id, board.org_id, board.workspace_id, board.name,
        board.description, board.columns, board.filters,
        board.created_by, board.created_at
      );

      logger.info('[TaskManager] ✓ 任务看板创建成功:', boardId);

      return {
        ...board,
        columns: JSON.parse(board.columns),
        filters: JSON.parse(board.filters)
      };
    } catch (error) {
      logger.error('[TaskManager] 创建看板失败:', error);
      throw error;
    }
  }

  /**
   * 获取看板列表
   * @param {string} orgId - 组织ID
   * @param {string} workspaceId - 工作区ID（可选）
   * @returns {Promise<Array>} 看板列表
   */
  async getBoards(orgId, workspaceId = null) {
    try {
      let sql = 'SELECT * FROM task_boards WHERE org_id = ?';
      const params = [orgId];

      if (workspaceId) {
        sql += ' AND workspace_id = ?';
        params.push(workspaceId);
      }

      sql += ' ORDER BY created_at DESC';

      const boards = this.db.prepare(sql).all(...params);

      return boards.map(board => ({
        ...board,
        columns: JSON.parse(board.columns || '[]'),
        filters: JSON.parse(board.filters || '{}')
      }));
    } catch (error) {
      logger.error('[TaskManager] 获取看板列表失败:', error);
      return [];
    }
  }

  /**
   * 更新看板
   * @param {string} boardId - 看板ID
   * @param {Object} updates - 更新数据
   * @param {string} updates.name - 看板名称
   * @param {string} updates.description - 看板描述
   * @param {Array<Object>} updates.columns - 列配置
   * @param {Object} updates.filters - 筛选条件
   * @returns {Promise<Object>} 更新结果
   */
  async updateBoard(boardId, updates) {
    try {
      logger.info('[TaskManager] 更新看板:', boardId);

      // 检查看板是否存在
      const board = this.db.prepare('SELECT * FROM task_boards WHERE id = ?').get(boardId);
      if (!board) {
        return { success: false, error: '看板不存在' };
      }

      // 构建更新SQL
      const allowedFields = ['name', 'description', 'columns', 'filters', 'workspace_id'];
      const updateParts = [];
      const values = [];

      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
          updateParts.push(`${key} = ?`);
          // JSON字段需要序列化
          if (key === 'columns' || key === 'filters') {
            values.push(JSON.stringify(value));
          } else {
            values.push(value);
          }
        }
      }

      if (updateParts.length === 0) {
        return { success: true, message: '无需更新' };
      }

      // 添加更新时间
      updateParts.push('updated_at = ?');
      values.push(Date.now());
      values.push(boardId);

      this.db.prepare(`
        UPDATE task_boards SET ${updateParts.join(', ')} WHERE id = ?
      `).run(...values);

      // 获取更新后的看板
      const updatedBoard = this.db.prepare('SELECT * FROM task_boards WHERE id = ?').get(boardId);

      logger.info('[TaskManager] ✓ 看板更新成功:', boardId);

      return {
        success: true,
        board: {
          ...updatedBoard,
          columns: JSON.parse(updatedBoard.columns || '[]'),
          filters: JSON.parse(updatedBoard.filters || '{}')
        }
      };
    } catch (error) {
      logger.error('[TaskManager] 更新看板失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 删除看板
   * @param {string} boardId - 看板ID
   * @param {Object} options - 选项
   * @param {boolean} options.force - 强制删除（即使有任务）
   * @param {boolean} options.archive - 改为归档而非删除
   * @returns {Promise<Object>} 删除结果
   */
  async deleteBoard(boardId, options = {}) {
    try {
      logger.info('[TaskManager] 删除看板:', boardId);

      // 检查看板是否存在
      const board = this.db.prepare('SELECT * FROM task_boards WHERE id = ?').get(boardId);
      if (!board) {
        return { success: false, error: '看板不存在' };
      }

      // 检查是否有关联任务
      const taskCount = this.db.prepare(`
        SELECT COUNT(*) as count FROM tasks WHERE board_id = ?
      `).get(boardId);

      if (taskCount?.count > 0 && !options.force) {
        if (options.archive) {
          // 归档看板
          this.db.prepare(`
            UPDATE task_boards SET is_archived = 1, updated_at = ? WHERE id = ?
          `).run(Date.now(), boardId);

          logger.info('[TaskManager] ✓ 看板已归档:', boardId);
          return {
            success: true,
            archived: true,
            taskCount: taskCount.count,
            message: `看板已归档，包含 ${taskCount.count} 个任务`
          };
        }

        return {
          success: false,
          error: 'BOARD_HAS_TASKS',
          taskCount: taskCount.count,
          message: `看板包含 ${taskCount.count} 个任务，请使用强制删除或归档`
        };
      }

      // 如果强制删除，先将任务的 board_id 设为 null
      if (taskCount?.count > 0 && options.force) {
        this.db.prepare(`
          UPDATE tasks SET board_id = NULL, updated_at = ? WHERE board_id = ?
        `).run(Date.now(), boardId);
        logger.info(`[TaskManager] 已解除 ${taskCount.count} 个任务与看板的关联`);
      }

      // 删除看板
      this.db.prepare('DELETE FROM task_boards WHERE id = ?').run(boardId);

      logger.info('[TaskManager] ✓ 看板删除成功:', boardId);

      return {
        success: true,
        deletedTaskLinks: taskCount?.count || 0
      };
    } catch (error) {
      logger.error('[TaskManager] 删除看板失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取单个看板详情
   * @param {string} boardId - 看板ID
   * @returns {Promise<Object>} 看板详情
   */
  async getBoard(boardId) {
    try {
      const board = this.db.prepare('SELECT * FROM task_boards WHERE id = ?').get(boardId);

      if (!board) {
        return null;
      }

      // 获取看板下的任务统计
      const taskStats = this.db.prepare(`
        SELECT
          status,
          COUNT(*) as count
        FROM tasks
        WHERE board_id = ?
        GROUP BY status
      `).all(boardId);

      const stats = {
        total: 0,
        pending: 0,
        in_progress: 0,
        completed: 0,
        cancelled: 0
      };

      taskStats.forEach(s => {
        stats[s.status] = s.count;
        stats.total += s.count;
      });

      return {
        ...board,
        columns: JSON.parse(board.columns || '[]'),
        filters: JSON.parse(board.filters || '{}'),
        taskStats: stats
      };
    } catch (error) {
      logger.error('[TaskManager] 获取看板详情失败:', error);
      return null;
    }
  }
}

// Singleton instance cache
let taskManagerInstance = null;

/**
 * Get TaskManager singleton instance
 */
function getTaskManager(database) {
  if (!taskManagerInstance) {
    taskManagerInstance = new TaskManager(database);
  }
  return taskManagerInstance;
}

module.exports = {
  TaskManager,
  getTaskManager
};
