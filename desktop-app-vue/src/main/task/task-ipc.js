/**
 * Team Task Management IPC Handlers
 *
 * Provides 49 IPC handlers for enterprise task management:
 * - Board management (9)
 * - Task query (4)
 * - Task CRUD (12)
 * - Checklists (5)
 * - Comments and activity (6)
 * - Attachments (4)
 * - Sprint management (5)
 * - Reports and analytics (5)
 *
 * @module task/task-ipc
 */

const { ipcMain } = require("electron");
const { logger } = require("../utils/logger.js");
const {
  withBoardReadAccess,
  createBoardReadCheck,
} = require("./board-read-authority");
const { executeBoardWrite } = require("./board-write-authority");

function resolveDatabase(database) {
  if (database?.getDatabase) {
    return database;
  }

  try {
    const { getDatabase } = require("../database.js");
    return getDatabase();
  } catch (_error) {
    return null;
  }
}

// The old enterprise TaskManager assumes a different project_tasks schema and
// accepts renderer-supplied actors. Canonical rows must use governed actions.
function rejectLegacyProjectTaskAccess(database, params) {
  const wrapper = resolveDatabase(database);
  const db = wrapper?.getDatabase ? wrapper.getDatabase() : wrapper;
  if (!db) throw new Error("ACTION_AUTHORITY_UNAVAILABLE");
  const taskIds = [
    params?.taskId,
    params?.parentTaskId,
    params?.dependsOnTaskId,
    params?.subtaskData?.parentTaskId,
    ...(Array.isArray(params?.taskIds) ? params.taskIds : []),
  ];
  const childRefs = [
    ["checklistId", "SELECT task_id FROM task_checklists WHERE id=?"],
    [
      "itemId",
      "SELECT c.task_id FROM task_checklist_items i JOIN task_checklists c ON c.id=i.checklist_id WHERE i.id=?",
    ],
    ["commentId", "SELECT task_id FROM task_comments WHERE id=?"],
    ["attachmentId", "SELECT task_id FROM task_attachments WHERE id=?"],
  ];
  for (const [key, sql] of childRefs) {
    if (typeof params?.[key] === "string") {
      taskIds.push(db.prepare(sql).get(params[key])?.task_id);
    }
  }
  if (typeof params?.comment?.parentId === "string") {
    taskIds.push(
      db
        .prepare("SELECT task_id FROM task_comments WHERE id=?")
        .get(params.comment.parentId)?.task_id,
    );
  }
  for (const taskId of taskIds) {
    if (
      typeof taskId === "string" &&
      db.prepare("SELECT 1 FROM project_tasks WHERE id=?").get(taskId)
    ) {
      const error = new Error("ACTION_CONTROLLED_TASK_REQUIRED");
      error.code = "ACTION_CONTROLLED_TASK_REQUIRED";
      throw error;
    }
  }
}

/**
 * Register all team task management IPC handlers
 */
function registerTaskIPC(database) {
  const boardUpdates =
    require("./board-task-update-host").createBoardTaskUpdateHost({
      database: resolveDatabase(database),
    });
  ipcMain.handle("task:board-edit-source", (event, params) =>
    boardUpdates.getBoardEditSource(event, params),
  );
  ipcMain.handle("task:board-update-preview", (event, params) =>
    boardUpdates.previewBoardUpdate(event, params),
  );
  ipcMain.handle("task:board-update-execute", (event, params) =>
    boardUpdates.executeBoardUpdate(event, params),
  );
  ipcMain.handle("task:board-update-runs", (event, params) =>
    boardUpdates.getBoardUpdateRuns(event, params),
  );
  ipcMain.handle("task:board-update-cancel", (event, params) =>
    boardUpdates.cancelBoardUpdate(event, params),
  );
  ipcMain.handle("task:board-create-source", (event, params) =>
    boardUpdates.getBoardCreateSource(event, params),
  );
  ipcMain.handle("task:board-create-preview", (event, params) =>
    boardUpdates.previewBoardCreate(event, params),
  );
  ipcMain.handle("task:board-create-execute", (event, params) =>
    boardUpdates.executeBoardCreate(event, params),
  );
  ipcMain.handle("task:board-create-runs", (event, params) =>
    boardUpdates.getBoardCreateRuns(event, params),
  );
  ipcMain.handle("task:board-create-cancel", (event, params) =>
    boardUpdates.cancelBoardCreate(event, params),
  );
  logger.info("[IPC] 注册团队任务管理IPC处理器 (49个handlers)");
  require("./task-description-ipc").registerTaskDescriptionIPC(
    resolveDatabase(database),
  );
  const organizationProjectHost =
    require("./organization-project-ipc").registerOrganizationProjectIPC(
      resolveDatabase(database),
    );
  const projectGoalHost = require("./project-goal-ipc").registerProjectGoalIPC(
    resolveDatabase(database),
  );

  // ========================================
  // Board Management (8 handlers)
  // ========================================

  ipcMain.handle("task:create-board", async (event, params) => {
    try {
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "create-board",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:create-board failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:get-boards", async (event, params) => {
    try {
      const { getTaskBoardManager } = require("./task-board-manager");
      const manager = getTaskBoardManager(resolveDatabase(database));
      return await withBoardReadAccess(
        database,
        event,
        { orgId: params?.orgId },
        () => manager.getBoards(params.orgId, params.options || {}),
      );
    } catch (error) {
      logger.error("[IPC] task:get-boards failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:get-board", async (event, params) => {
    try {
      const { getTaskBoardManager } = require("./task-board-manager");
      const manager = getTaskBoardManager(resolveDatabase(database));
      const board = await withBoardReadAccess(
        database,
        event,
        { boardId: params?.boardId },
        () => manager.getBoard(params.boardId),
      );
      return { success: true, board };
    } catch (error) {
      logger.error("[IPC] task:get-board failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:update-board", async (event, params) => {
    try {
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "update-board",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:update-board failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:delete-board", async (event, params) => {
    try {
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "delete-board",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:delete-board failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:archive-board", async (event, params) => {
    try {
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "archive-board",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:archive-board failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:create-column", async (event, params) => {
    try {
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "create-column",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:create-column failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:update-column", async (event, params) => {
    try {
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "update-column",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:update-column failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:reorder-columns", async (event, params) => {
    try {
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "reorder-columns",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:reorder-columns failed:", error);
      throw error;
    }
  });

  // ========================================
  // Task Query (3 handlers)
  // ========================================

  ipcMain.handle("task:get-tasks", async (event, params) => {
    try {
      if (params.boardId) {
        const { getTeamTaskManager } = require("./team-task-manager");
        const manager = getTeamTaskManager(resolveDatabase(database));
        return await withBoardReadAccess(
          database,
          event,
          { boardId: params.boardId },
          () => manager.getTasks(params.boardId, params.options || {}),
        );
      }

      const options = params.options || params.filters || params;
      const projectId = options.projectId || options.project_id;
      if (!projectId) throw new Error("ACTION_CONTROLLED_TASK_REQUIRED");
      const result = require("./task-description-ipc")
        .createTaskDescriptionHost({ database: resolveDatabase(database) })
        .listTasks(event, {
          projectId,
          afterId: options.afterId,
          limit: options.limit,
        });
      return { success: true, ...result };
    } catch (error) {
      logger.error("[IPC] task:get-tasks failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:get-sprints", async (event, params) => {
    try {
      const { getTaskBoardManager } = require("./task-board-manager");
      const manager = getTaskBoardManager(resolveDatabase(database));
      return await withBoardReadAccess(
        database,
        event,
        { boardId: params?.boardId },
        () => manager.getSprints(params.boardId),
      );
    } catch (error) {
      logger.error("[IPC] task:get-sprints failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:get-labels", async (event, params) => {
    try {
      const { getTaskBoardManager } = require("./task-board-manager");
      const manager = getTaskBoardManager(resolveDatabase(database));
      return await withBoardReadAccess(
        database,
        event,
        { orgId: params?.orgId },
        () => manager.getLabels(params.orgId),
      );
    } catch (error) {
      logger.error("[IPC] task:get-labels failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:create-label", async (event, params) => {
    try {
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "create-label",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:create-label failed:", error);
      throw error;
    }
  });

  // ========================================
  // Task CRUD (12 handlers)
  // ========================================

  ipcMain.handle("task:create-task", async (event, params) => {
    try {
      if (!params?.boardId) {
        if (!params?.request)
          throw new Error("ACTION_CONTROLLED_TASK_REQUIRED");
        return await require("./task-description-ipc")
          .createTaskDescriptionHost({ database: resolveDatabase(database) })
          .executeCreate(event, { request: params.request });
      }
      rejectLegacyProjectTaskAccess(database, params);
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "create-task",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:create-task failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:get-task", async (event, params) => {
    try {
      const db = resolveDatabase(database).getDatabase();
      if (
        db.prepare("SELECT 1 FROM project_tasks WHERE id=?").get(params.taskId)
      ) {
        const task = require("./task-description-ipc")
          .createTaskDescriptionHost({ database: resolveDatabase(database) })
          .readTask(event, { taskId: params.taskId });
        return {
          success: true,
          task: { ...task, id: task.taskId, project_id: task.projectId },
        };
      }
      // Canonical tasks keep their own project authority; board tasks require
      // current organization membership before their details are returned.
      if (
        db.prepare("SELECT 1 FROM team_tasks WHERE id=?").get(params.taskId)
      ) {
        const { getTeamTaskManager } = require("./team-task-manager");
        const manager = getTeamTaskManager(resolveDatabase(database));
        const task = await withBoardReadAccess(
          database,
          event,
          { taskId: params.taskId },
          () => manager.getTask(params.taskId),
        );
        return { success: true, task };
      }
      const task = require("./task-description-ipc")
        .createTaskDescriptionHost({ database: resolveDatabase(database) })
        .readTask(event, { taskId: params.taskId });
      return {
        success: true,
        task: { ...task, id: task.taskId, project_id: task.projectId },
      };
    } catch (error) {
      logger.error("[IPC] task:get-task failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:update-task", async (event, params) => {
    try {
      if (params?.request) {
        if (params.taskId !== params.request.target?.id)
          throw new Error("ACTION_INVALID_REQUEST");
        return await require("./task-description-ipc")
          .createTaskDescriptionHost({ database: resolveDatabase(database) })
          .execute(event, { request: params.request });
      }
      rejectLegacyProjectTaskAccess(database, params);
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "update-task",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:update-task failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:delete-task", async (event, params) => {
    try {
      rejectLegacyProjectTaskAccess(database, params);
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "delete-task",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:delete-task failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:move-task", async (event, params) => {
    try {
      rejectLegacyProjectTaskAccess(database, params);
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "move-task",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:move-task failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:assign-task", async (event, params) => {
    try {
      rejectLegacyProjectTaskAccess(database, params);
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "assign-task",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:assign-task failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:set-priority", async (event, params) => {
    try {
      rejectLegacyProjectTaskAccess(database, params);
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "set-priority",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:set-priority failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:set-due-date", async (event, params) => {
    try {
      rejectLegacyProjectTaskAccess(database, params);
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "set-due-date",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:set-due-date failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:add-label", async (event, params) => {
    try {
      rejectLegacyProjectTaskAccess(database, params);
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "add-label",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:add-label failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:link-tasks", async (event, params) => {
    try {
      rejectLegacyProjectTaskAccess(database, params);
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "link-tasks",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:link-tasks failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:create-subtask", async (event, params) => {
    try {
      rejectLegacyProjectTaskAccess(database, params);
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "create-subtask",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:create-subtask failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:convert-to-subtask", async (event, params) => {
    try {
      rejectLegacyProjectTaskAccess(database, params);
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "convert-to-subtask",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:convert-to-subtask failed:", error);
      throw error;
    }
  });

  // ========================================
  // Checklists (5 handlers)
  // ========================================

  ipcMain.handle("task:create-checklist", async (event, params) => {
    try {
      rejectLegacyProjectTaskAccess(database, params);
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "create-checklist",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:create-checklist failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:add-checklist-item", async (event, params) => {
    try {
      rejectLegacyProjectTaskAccess(database, params);
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "add-checklist-item",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:add-checklist-item failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:toggle-checklist-item", async (event, params) => {
    try {
      rejectLegacyProjectTaskAccess(database, params);
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "toggle-checklist-item",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:toggle-checklist-item failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:delete-checklist-item", async (event, params) => {
    try {
      rejectLegacyProjectTaskAccess(database, params);
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "delete-checklist-item",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:delete-checklist-item failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:reorder-checklist", async (event, params) => {
    try {
      rejectLegacyProjectTaskAccess(database, params);
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "reorder-checklist",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:reorder-checklist failed:", error);
      throw error;
    }
  });

  // ========================================
  // Comments and Activity (6 handlers)
  // ========================================

  ipcMain.handle("task:add-comment", async (event, params) => {
    try {
      rejectLegacyProjectTaskAccess(database, params);
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "add-comment",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:add-comment failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:edit-comment", async (event, params) => {
    try {
      rejectLegacyProjectTaskAccess(database, params);
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "edit-comment",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:edit-comment failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:delete-comment", async (event, params) => {
    try {
      rejectLegacyProjectTaskAccess(database, params);
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "delete-comment",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:delete-comment failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:get-comments", async (event, params) => {
    try {
      rejectLegacyProjectTaskAccess(database, params);
      const { TeamTaskManager } = require("./team-task-manager");
      const manager = new TeamTaskManager(resolveDatabase(database));
      return await withBoardReadAccess(
        database,
        event,
        { taskId: params?.taskId },
        () => manager.getComments(params.taskId, params.options || {}),
      );
    } catch (error) {
      logger.error("[IPC] task:get-comments failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:get-activity", async (event, params) => {
    try {
      rejectLegacyProjectTaskAccess(database, params);
      const { TeamTaskManager } = require("./team-task-manager");
      const manager = new TeamTaskManager(resolveDatabase(database));
      return await withBoardReadAccess(
        database,
        event,
        { taskId: params?.taskId },
        () => manager.getActivity(params.taskId, params.options || {}),
      );
    } catch (error) {
      logger.error("[IPC] task:get-activity failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:mention-user", async (event, params) => {
    try {
      rejectLegacyProjectTaskAccess(database, params);
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "mention-user",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:mention-user failed:", error);
      throw error;
    }
  });

  // ========================================
  // Attachments (4 handlers)
  // ========================================

  ipcMain.handle("task:upload-attachment", async (event, params) => {
    try {
      rejectLegacyProjectTaskAccess(database, params);
      return await require("./board-attachment-host").mutateBoardAttachment(
        resolveDatabase(database),
        event,
        "upload-attachment",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:upload-attachment failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:delete-attachment", async (event, params) => {
    try {
      rejectLegacyProjectTaskAccess(database, params);
      return await require("./board-attachment-host").mutateBoardAttachment(
        resolveDatabase(database),
        event,
        "delete-attachment",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:delete-attachment failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:get-attachments", async (event, params) => {
    try {
      rejectLegacyProjectTaskAccess(database, params);
      return require("./board-attachment-host").readBoardAttachment(
        resolveDatabase(database),
        event,
        "list",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:get-attachments failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:preview-attachment", async (event, params) => {
    try {
      rejectLegacyProjectTaskAccess(database, params);
      return require("./board-attachment-host").readBoardAttachment(
        resolveDatabase(database),
        event,
        "preview",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:preview-attachment failed:", error);
      throw error;
    }
  });

  // ========================================
  // Sprint Management (5 handlers)
  // ========================================

  ipcMain.handle("task:create-sprint", async (event, params) => {
    try {
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "create-sprint",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:create-sprint failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:start-sprint", async (event, params) => {
    try {
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "start-sprint",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:start-sprint failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:complete-sprint", async (event, params) => {
    try {
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "complete-sprint",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:complete-sprint failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:get-sprint-stats", async (event, params) => {
    try {
      const { getTaskBoardManager } = require("./task-board-manager");
      const manager = getTaskBoardManager(resolveDatabase(database));
      return await withBoardReadAccess(
        database,
        event,
        { sprintId: params?.sprintId },
        () => manager.getSprintStats(params.sprintId),
      );
    } catch (error) {
      logger.error("[IPC] task:get-sprint-stats failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:move-to-sprint", async (event, params) => {
    try {
      rejectLegacyProjectTaskAccess(database, params);
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "move-to-sprint",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:move-to-sprint failed:", error);
      throw error;
    }
  });

  // ========================================
  // Reports and Analytics (5 handlers)
  // ========================================

  ipcMain.handle("task:create-report", async (event, params) => {
    try {
      return executeBoardWrite(
        resolveDatabase(database),
        event,
        "create-report",
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:create-report failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:get-reports", async (event, params) => {
    try {
      const resolved = resolveDatabase(database);
      const check = createBoardReadCheck(resolved, event, {
        orgId: params?.orgId,
      });
      const { TeamReportManager } = require("./team-report-manager");
      const manager = new TeamReportManager(resolved);
      const db = resolved.getDatabase();
      const savepoint = `board_reports_${require("node:crypto").randomUUID().replaceAll("-", "")}`;
      let released = false;
      db.exec(`SAVEPOINT ${savepoint}`);
      try {
        // One SQLite snapshot covers membership, report/board scope and the
        // successful-run projection, including writes from other processes.
        check();
        const result = manager.getReportsSync(
          params.orgId,
          params.options || {},
        );
        check();
        db.exec(`RELEASE ${savepoint}`);
        released = true;
        check();
        return result;
      } catch (error) {
        if (!released) {
          db.exec(`ROLLBACK TO ${savepoint}`);
          db.exec(`RELEASE ${savepoint}`);
        }
        throw error;
      }
    } catch (error) {
      logger.error("[IPC] task:get-reports failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:generate-ai-summary", async (event, params) => {
    try {
      return await require("./board-report-summary-host").generateAISummary(
        resolveDatabase(database),
        event,
        params,
      );
    } catch (error) {
      logger.error("[IPC] task:generate-ai-summary failed:", error);
      throw error;
    }
  });

  const summaryOperation = (method, event, params) => {
    const host = require("./board-report-summary-host");
    try {
      return host[method](resolveDatabase(database), event, params);
    } catch (error) {
      return { success: false, error: host.safeCode(error) };
    }
  };
  ipcMain.handle("task:get-summary-status", (event, params) =>
    summaryOperation("getSummaryStatus", event, params),
  );
  ipcMain.handle("task:cancel-summary", (event, params) =>
    summaryOperation("cancelSummary", event, params),
  );

  ipcMain.handle("task:get-board-analytics", async (event, params) => {
    try {
      const { getTaskBoardManager } = require("./task-board-manager");
      const manager = getTaskBoardManager(resolveDatabase(database));
      return await withBoardReadAccess(
        database,
        event,
        { boardId: params?.boardId },
        () => manager.getBoardAnalytics(params.boardId, params.options || {}),
      );
    } catch (error) {
      logger.error("[IPC] task:get-board-analytics failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task:export-board", async (event, params) => {
    try {
      const { getTaskBoardManager } = require("./task-board-manager");
      const manager = getTaskBoardManager(resolveDatabase(database));
      return await withBoardReadAccess(
        database,
        event,
        { boardId: params?.boardId },
        () => manager.exportBoard(params.boardId, params.format),
      );
    } catch (error) {
      logger.error("[IPC] task:export-board failed:", error);
      throw error;
    }
  });

  logger.info("[IPC] 团队任务管理IPC处理器注册完成 (49个handlers)");
  return Object.freeze({
    ...projectGoalHost,
    async initializeMonitoring() {
      const results = await Promise.allSettled([
        projectGoalHost.initializeMonitoring(),
        organizationProjectHost.initializeMonitoring(),
      ]);
      const failure = results.find((result) => result.status === "rejected");
      if (failure) throw failure.reason;
      return results[0].value;
    },
    async close() {
      const results = await Promise.allSettled([
        projectGoalHost.close(),
        organizationProjectHost.close(),
      ]);
      const failure = results.find((result) => result.status === "rejected");
      if (failure) throw failure.reason;
    },
  });
}

module.exports = {
  registerTaskIPC,
};
