/**
 * Team Task Manager
 * Handles CRUD operations for team_tasks (board tasks)
 */

const { v4: uuidv4 } = require("uuid");
const { logger } = require("../utils/logger.js");

class TeamTaskManager {
  constructor(database) {
    this.database = database;
  }

  /**
   * Create a team task (board task)
   */
  async createTask(taskData) {
    return this.createTaskSync(taskData);
  }

  createTaskSync(taskData) {
    throw Object.assign(new Error("BOARD_ACTION_CONTROLLED_CREATE_REQUIRED"), {
      code: "BOARD_ACTION_CONTROLLED_CREATE_REQUIRED",
    });
  }

  /**
   * Get a task by ID
   */
  async getTask(taskId) {
    try {
      const db = this.database.getDatabase();
      const task = db
        .prepare(
          `
        SELECT * FROM team_tasks WHERE id = ?
      `,
        )
        .get(taskId);

      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      return {
        id: task.id,
        boardId: task.board_id,
        columnId: task.column_id,
        title: task.title,
        description: task.description,
        priority: task.priority,
        status: task.status,
        taskType: task.task_type,
        parentTaskId: task.parent_task_id,
        sprintId: task.sprint_id,
        labels: task.labels == null ? [] : JSON.parse(task.labels),
        assigneeDid: task.assignee_did,
        reporterDid: task.reporter_did,
        dueDate: task.due_date,
        estimatedHours: task.estimated_hours,
        actualHours: task.actual_hours,
        createdAt: task.created_at,
        updatedAt: task.updated_at,
        completedAt: task.completed_at,
      };
    } catch (error) {
      logger.error("[TeamTaskManager] Get task failed:", error);
      throw error;
    }
  }

  /**
   * Get all team tasks for a board.
   */
  async getTasks(boardId, options = {}) {
    try {
      const db = this.database.getDatabase();
      let sql = `
        SELECT * FROM team_tasks
        WHERE board_id = ?
      `;
      const params = [boardId];

      if (options.columnId) {
        sql += " AND column_id = ?";
        params.push(options.columnId);
      }
      if (options.status) {
        sql += " AND status = ?";
        params.push(options.status);
      }
      if (options.priority) {
        sql += " AND priority = ?";
        params.push(options.priority);
      }
      if (options.assigneeDid) {
        sql += " AND assignee_did = ?";
        params.push(options.assigneeDid);
      }
      if (options.sprintId) {
        sql += " AND sprint_id = ?";
        params.push(options.sprintId);
      }

      sql += " ORDER BY position ASC, created_at DESC";

      if (Number.isInteger(options.limit) && options.limit > 0) {
        sql += " LIMIT ?";
        params.push(options.limit);

        if (Number.isInteger(options.offset) && options.offset >= 0) {
          sql += " OFFSET ?";
          params.push(options.offset);
        }
      }

      const tasks = db
        .prepare(sql)
        .all(...params)
        .map((task) => {
          let labels = [];
          try {
            labels = task.labels ? JSON.parse(task.labels) : [];
          } catch (_error) {
            labels = [];
          }

          return {
            id: task.id,
            boardId: task.board_id,
            columnId: task.column_id,
            title: task.title,
            description: task.description,
            priority: task.priority,
            status: task.status,
            taskType: task.task_type,
            parentTaskId: task.parent_task_id,
            assigneeDid: task.assignee_did,
            reporterDid: task.reporter_did,
            dueDate: task.due_date,
            startDate: task.start_date,
            storyPoints: task.story_points,
            estimatedHours: task.estimated_hours,
            actualHours: task.actual_hours,
            labels,
            position: task.position,
            sprintId: task.sprint_id,
            createdAt: task.created_at,
            updatedAt: task.updated_at,
            completedAt: task.completed_at,
          };
        });

      return { success: true, tasks };
    } catch (error) {
      logger.error("[TeamTaskManager] Get tasks failed:", error);
      throw error;
    }
  }

  /**
   * Update a task
   */
  async updateTask(taskId, updates, actorDid) {
    return this.updateTaskSync(taskId, updates, actorDid);
  }

  updateTaskSync(taskId, updates, actorDid) {
    throw Object.assign(new Error("BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED"), {
      code: "BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED",
    });
  }

  /**
   * Move task to different column
   */
  async moveTask(taskId, columnId, position, actorDid) {
    return this.moveTaskSync(taskId, columnId, position, actorDid);
  }

  moveTaskSync(taskId, columnId, position, actorDid) {
    throw Object.assign(new Error("BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED"), {
      code: "BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED",
    });
  }

  /**
   * Delete a task
   */
  async deleteTask(taskId) {
    return this.deleteTaskSync(taskId);
  }

  deleteTaskSync(taskId) {
    try {
      const db = this.database.getDatabase();

      db.prepare(
        `
        DELETE FROM team_tasks WHERE id = ?
      `,
      ).run(taskId);

      logger.info("[TeamTaskManager] ✓ Task deleted:", taskId);

      return { success: true, taskId };
    } catch (error) {
      logger.error("[TeamTaskManager] Delete task failed:", error);
      throw error;
    }
  }

  /**
   * Assign task to a user
   */
  async assignTask(taskId, userDid, role, assignedBy) {
    return this.assignTaskSync(taskId, userDid, role, assignedBy);
  }

  assignTaskSync(taskId, userDid, role, assignedBy) {
    throw Object.assign(new Error("BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED"), {
      code: "BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED",
    });
  }

  /**
   * Set task priority
   */
  async setPriority(taskId, priority, actorDid) {
    return this.setPrioritySync(taskId, priority, actorDid);
  }

  setPrioritySync(taskId, priority, actorDid) {
    throw Object.assign(new Error("BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED"), {
      code: "BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED",
    });
  }

  /**
   * Set task due date
   */
  async setDueDate(taskId, dueDate, actorDid) {
    return this.setDueDateSync(taskId, dueDate, actorDid);
  }

  setDueDateSync(taskId, dueDate, actorDid) {
    throw Object.assign(new Error("BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED"), {
      code: "BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED",
    });
  }

  /**
   * Create a checklist for a task
   */
  async createChecklist(taskId, title) {
    return this.createChecklistSync(taskId, title);
  }

  createChecklistSync(taskId, title) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();
      const checklistId = uuidv4();

      db.prepare(
        `
        INSERT INTO task_checklists (id, task_id, title, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      ).run(checklistId, taskId, title, 0, now, now);

      logger.info("[TeamTaskManager] ✓ Checklist created:", checklistId);

      return {
        success: true,
        checklistId,
        checklist: {
          id: checklistId,
          taskId,
          title,
          createdAt: now,
        },
      };
    } catch (error) {
      logger.error("[TeamTaskManager] Create checklist failed:", error);
      throw error;
    }
  }

  /**
   * Add an item to a checklist
   */
  async addChecklistItem(checklistId, content, assigneeDid) {
    return this.addChecklistItemSync(checklistId, content, assigneeDid);
  }

  addChecklistItemSync(checklistId, content, assigneeDid) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();
      const itemId = uuidv4();

      db.prepare(
        `
        INSERT INTO task_checklist_items (
          id, checklist_id, content, is_done, assignee_did,
          position, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(itemId, checklistId, content, 0, assigneeDid || null, 0, now, now);

      logger.info("[TeamTaskManager] ✓ Checklist item added:", itemId);

      return {
        success: true,
        itemId,
        item: {
          id: itemId,
          checklistId,
          content,
          isDone: false,
          assigneeDid,
          createdAt: now,
        },
      };
    } catch (error) {
      logger.error("[TeamTaskManager] Add checklist item failed:", error);
      throw error;
    }
  }

  /**
   * Add a comment to a task
   */
  async addComment(taskId, commentData) {
    return this.addCommentSync(taskId, commentData);
  }

  addCommentSync(taskId, commentData) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();
      const commentId = uuidv4();

      db.prepare(
        `
        INSERT INTO task_comments (
          id, task_id, author_did, author_name, content, parent_id,
          mentions, is_edited, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        commentId,
        taskId,
        commentData.authorDid,
        commentData.authorName || "",
        commentData.content,
        commentData.parentId || null,
        commentData.mentions ? JSON.stringify(commentData.mentions) : null,
        0,
        now,
        now,
      );

      logger.info("[TeamTaskManager] ✓ Comment added:", commentId);

      return {
        success: true,
        commentId,
        comment: {
          id: commentId,
          taskId,
          authorDid: commentData.authorDid,
          authorName: commentData.authorName,
          content: commentData.content,
          createdAt: now,
        },
      };
    } catch (error) {
      logger.error("[TeamTaskManager] Add comment failed:", error);
      throw error;
    }
  }

  // Governed IPC calls these synchronous cores inside its authorization
  // transaction. Activity records intentionally contain references, not bodies.
  _recordActivitySync(taskId, actorDid, action, metadata) {
    const activityId = uuidv4();
    this.database
      .getDatabase()
      .prepare(
        `INSERT INTO task_activity_log
        (id, task_id, actor_did, action, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        activityId,
        taskId,
        actorDid,
        action,
        JSON.stringify(metadata),
        Date.now(),
      );
    return activityId;
  }

  async addLabel(taskId, labelId, actorDid) {
    return this.addLabelSync(taskId, labelId, actorDid);
  }

  mentionUserSync(taskId, recipientDid, actorDid) {
    const db = this.database.getDatabase();
    const {
      BOARD_NOTICE_SCHEMA,
      BOARD_NOTICE_PREFIX,
    } = require("./board-notice-projection");
    const source = db
      .prepare(
        "SELECT t.board_id,b.org_id FROM team_tasks t JOIN task_boards b ON b.id=t.board_id WHERE t.id=?",
      )
      .get(taskId);
    const notificationId = `${BOARD_NOTICE_PREFIX}${uuidv4()}`;
    const activityId = this._recordActivitySync(
      taskId,
      actorDid,
      "task_mentioned",
      {
        recipientDid,
        notificationId,
      },
    );
    const { created_at: createdAt } = db
      .prepare("SELECT created_at FROM task_activity_log WHERE id=?")
      .get(activityId);
    db.prepare(
      `INSERT INTO task_board_notice_events
      (id,task_id,board_id,org_id,actor_did,recipient_did,activity_id,created_at)
      VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      notificationId,
      taskId,
      source.board_id,
      source.org_id,
      actorDid,
      recipientDid,
      activityId,
      createdAt,
    );
    db.prepare(
      `INSERT INTO notifications
      (id,user_did,type,title,content,data,is_read,created_at)
      VALUES (?,?,'comment','Task mention',NULL,?,0,?)`,
    ).run(
      notificationId,
      recipientDid,
      JSON.stringify({ schema: BOARD_NOTICE_SCHEMA, eventId: notificationId }),
      createdAt,
    );
    return { success: true, taskId, notificationId, activityId };
  }

  addLabelSync(taskId, labelId, actorDid) {
    throw Object.assign(new Error("BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED"), {
      code: "BOARD_ACTION_CONTROLLED_UPDATE_REQUIRED",
    });
  }

  async linkTasks(taskId, dependsOnTaskId, dependencyType, actorDid) {
    return this.linkTasksSync(
      taskId,
      dependsOnTaskId,
      dependencyType,
      actorDid,
    );
  }

  linkTasksSync(taskId, dependsOnTaskId, dependencyType = "blocks", actorDid) {
    const db = this.database.getDatabase();
    const existing = db
      .prepare(
        "SELECT id FROM task_dependencies WHERE task_id=? AND depends_on_task_id=? AND dependency_type=?",
      )
      .get(taskId, dependsOnTaskId, dependencyType);
    if (existing)
      return { success: true, dependencyId: existing.id, linked: false };
    const dependencyId = uuidv4();
    db.prepare(
      "INSERT INTO task_dependencies (id,task_id,depends_on_task_id,dependency_type,created_at,created_by) VALUES (?,?,?,?,?,?)",
    ).run(
      dependencyId,
      taskId,
      dependsOnTaskId,
      dependencyType,
      Date.now(),
      actorDid,
    );
    const activityId = this._recordActivitySync(
      taskId,
      actorDid,
      "task_linked",
      { dependencyId, dependsOnTaskId, dependencyType },
    );
    return { success: true, dependencyId, linked: true, activityId };
  }

  async createSubtask(parentTaskId, taskData, actorDid) {
    return this.createSubtaskSync(parentTaskId, taskData, actorDid);
  }

  createSubtaskSync(parentTaskId, taskData, actorDid) {
    throw Object.assign(new Error("BOARD_ACTION_CONTROLLED_CREATE_REQUIRED"), {
      code: "BOARD_ACTION_CONTROLLED_CREATE_REQUIRED",
    });
  }

  async convertToSubtask(taskId, parentTaskId, actorDid) {
    return this.convertToSubtaskSync(taskId, parentTaskId, actorDid);
  }

  convertToSubtaskSync(taskId, parentTaskId, actorDid) {
    this.database
      .getDatabase()
      .prepare(
        "UPDATE team_tasks SET parent_task_id=?,task_type='subtask',updated_at=? WHERE id=?",
      )
      .run(parentTaskId, Date.now(), taskId);
    const activityId = this._recordActivitySync(
      taskId,
      actorDid,
      "converted_to_subtask",
      { parentTaskId },
    );
    return { success: true, taskId, parentTaskId, activityId };
  }

  async toggleChecklistItem(itemId, actorDid) {
    return this.toggleChecklistItemSync(itemId, actorDid);
  }

  toggleChecklistItemSync(itemId, actorDid) {
    const db = this.database.getDatabase();
    const item = db
      .prepare(
        "SELECT i.is_done,c.task_id FROM task_checklist_items i JOIN task_checklists c ON c.id=i.checklist_id WHERE i.id=?",
      )
      .get(itemId);
    const isDone = item.is_done === 0;
    const now = Date.now();
    db.prepare(
      "UPDATE task_checklist_items SET is_done=?,completed_at=?,completed_by=?,updated_at=? WHERE id=?",
    ).run(
      isDone ? 1 : 0,
      isDone ? now : null,
      isDone ? actorDid : null,
      now,
      itemId,
    );
    const activityId = this._recordActivitySync(
      item.task_id,
      actorDid,
      "checklist_item_toggled",
      { itemId, isDone },
    );
    return { success: true, itemId, isDone, activityId };
  }

  async deleteChecklistItem(itemId, actorDid) {
    return this.deleteChecklistItemSync(itemId, actorDid);
  }

  deleteChecklistItemSync(itemId, actorDid) {
    const db = this.database.getDatabase();
    const item = db
      .prepare(
        "SELECT c.task_id FROM task_checklist_items i JOIN task_checklists c ON c.id=i.checklist_id WHERE i.id=?",
      )
      .get(itemId);
    db.prepare("DELETE FROM task_checklist_items WHERE id=?").run(itemId);
    const activityId = this._recordActivitySync(
      item.task_id,
      actorDid,
      "checklist_item_deleted",
      { itemId },
    );
    return { success: true, itemId, activityId };
  }

  async reorderChecklist(checklistId, itemOrder, actorDid) {
    return this.reorderChecklistSync(checklistId, itemOrder, actorDid);
  }

  reorderChecklistSync(checklistId, itemOrder, actorDid) {
    const db = this.database.getDatabase();
    const checklist = db
      .prepare("SELECT task_id FROM task_checklists WHERE id=?")
      .get(checklistId);
    const statement = db.prepare(
      "UPDATE task_checklist_items SET position=?,updated_at=? WHERE id=? AND checklist_id=?",
    );
    const now = Date.now();
    itemOrder.forEach((id, position) =>
      statement.run(position, now, id, checklistId),
    );
    const activityId = this._recordActivitySync(
      checklist.task_id,
      actorDid,
      "checklist_reordered",
      { checklistId, itemCount: itemOrder.length },
    );
    return { success: true, checklistId, activityId };
  }

  async editComment(commentId, content, actorDid) {
    return this.editCommentSync(commentId, content, actorDid);
  }

  editCommentSync(commentId, content, actorDid) {
    const db = this.database.getDatabase();
    const comment = db
      .prepare("SELECT task_id FROM task_comments WHERE id=?")
      .get(commentId);
    db.prepare(
      "UPDATE task_comments SET content=?,is_edited=1,updated_at=? WHERE id=?",
    ).run(content, Date.now(), commentId);
    const activityId = this._recordActivitySync(
      comment.task_id,
      actorDid,
      "comment_edited",
      { commentId },
    );
    return { success: true, commentId, activityId };
  }

  async deleteComment(commentId, actorDid) {
    return this.deleteCommentSync(commentId, actorDid);
  }

  deleteCommentSync(commentId, actorDid) {
    const db = this.database.getDatabase();
    const comment = db
      .prepare("SELECT task_id FROM task_comments WHERE id=?")
      .get(commentId);
    const result = db
      .prepare("DELETE FROM task_comments WHERE id=?")
      .run(commentId);
    const activityId = this._recordActivitySync(
      comment.task_id,
      actorDid,
      "comment_deleted",
      { commentId },
    );
    return {
      success: true,
      commentId,
      deleted: result.changes === 1,
      activityId,
    };
  }

  async getComments(taskId) {
    return this.database
      .getDatabase()
      .prepare(
        "SELECT * FROM task_comments WHERE task_id=? ORDER BY created_at,id",
      )
      .all(taskId)
      .map((row) => ({
        ...row,
        mentions: row.mentions == null ? [] : JSON.parse(row.mentions),
        is_edited: !!row.is_edited,
      }));
  }

  async getActivity(taskId, options = {}) {
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
      throw new Error("BOARD_READ_INVALID_REQUEST");
    return this.database
      .getDatabase()
      .prepare(
        "SELECT * FROM task_activity_log WHERE task_id=? ORDER BY created_at DESC,id DESC LIMIT ?",
      )
      .all(taskId, limit);
  }
}

// Singleton instance
let teamTaskManagerInstance = null;

function getTeamTaskManager(database) {
  if (!teamTaskManagerInstance) {
    teamTaskManagerInstance = new TeamTaskManager(database);
  }
  return teamTaskManagerInstance;
}

module.exports = {
  TeamTaskManager,
  getTeamTaskManager,
};
