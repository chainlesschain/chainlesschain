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

const { ipcMain } = require('electron');
const { logger } = require('../utils/logger.js');

/**
 * Register all team task management IPC handlers
 */
function registerTaskIPC(database) {
  logger.info('[IPC] 注册团队任务管理IPC处理器 (49个handlers)');

  // ========================================
  // Board Management (8 handlers)
  // ========================================

  ipcMain.handle('task:create-board', async (_event, params) => {
    try {
      const { getTaskBoardManager } = require('./task-board-manager');
      const manager = getTaskBoardManager(database);
      return await manager.createBoard(params);
    } catch (error) {
      logger.error('[IPC] task:create-board failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:get-boards', async (_event, params) => {
    try {
      const { getTaskBoardManager } = require('./task-board-manager');
      const manager = getTaskBoardManager(database);
      return await manager.getBoards(params.orgId, params.options || {});
    } catch (error) {
      logger.error('[IPC] task:get-boards failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:get-board', async (_event, params) => {
    try {
      const { getTaskBoardManager } = require('./task-board-manager');
      const manager = getTaskBoardManager(database);
      return { success: true, board: await manager.getBoard(params.boardId) };
    } catch (error) {
      logger.error('[IPC] task:get-board failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:update-board', async (_event, params) => {
    try {
      const { getTaskBoardManager } = require('./task-board-manager');
      const manager = getTaskBoardManager(database);
      return await manager.updateBoard(params.boardId, params.updates);
    } catch (error) {
      logger.error('[IPC] task:update-board failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:delete-board', async (_event, params) => {
    try {
      const { getTaskBoardManager } = require('./task-board-manager');
      const manager = getTaskBoardManager(database);
      return await manager.deleteBoard(params.boardId);
    } catch (error) {
      logger.error('[IPC] task:delete-board failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:archive-board', async (_event, params) => {
    try {
      const { getTaskBoardManager } = require('./task-board-manager');
      const manager = getTaskBoardManager(database);
      return await manager.archiveBoard(params.boardId);
    } catch (error) {
      logger.error('[IPC] task:archive-board failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:create-column', async (_event, params) => {
    try {
      const { getTaskBoardManager } = require('./task-board-manager');
      const manager = getTaskBoardManager(database);
      return await manager.createColumn(params.boardId, params.columnData);
    } catch (error) {
      logger.error('[IPC] task:create-column failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:update-column', async (_event, params) => {
    try {
      const { getTaskBoardManager } = require('./task-board-manager');
      const manager = getTaskBoardManager(database);
      return await manager.updateColumn(params.columnId, params.updates);
    } catch (error) {
      logger.error('[IPC] task:update-column failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:reorder-columns', async (_event, params) => {
    try {
      const { getTaskBoardManager } = require('./task-board-manager');
      const manager = getTaskBoardManager(database);
      return await manager.reorderColumns(params.boardId, params.columnOrder);
    } catch (error) {
      logger.error('[IPC] task:reorder-columns failed:', error);
      throw error;
    }
  });

  // ========================================
  // Task Query (3 handlers)
  // ========================================

  ipcMain.handle('task:get-tasks', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return await manager.getTasks(params.boardId, params.options || {});
    } catch (error) {
      logger.error('[IPC] task:get-tasks failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:get-sprints', async (_event, params) => {
    try {
      const { getTaskBoardManager } = require('./task-board-manager');
      const manager = getTaskBoardManager(database);
      return await manager.getSprints(params.boardId);
    } catch (error) {
      logger.error('[IPC] task:get-sprints failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:get-labels', async (_event, params) => {
    try {
      const { getTaskBoardManager } = require('./task-board-manager');
      const manager = getTaskBoardManager(database);
      return await manager.getLabels(params.orgId);
    } catch (error) {
      logger.error('[IPC] task:get-labels failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:create-label', async (_event, params) => {
    try {
      const { getTaskBoardManager } = require('./task-board-manager');
      const manager = getTaskBoardManager(database);
      return await manager.createLabel(params.orgId, params);
    } catch (error) {
      logger.error('[IPC] task:create-label failed:', error);
      throw error;
    }
  });

  // ========================================
  // Task CRUD (12 handlers)
  // ========================================

  ipcMain.handle('task:create-task', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return await manager.createTask(params);
    } catch (error) {
      logger.error('[IPC] task:create-task failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:get-task', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return { success: true, task: await manager.getTask(params.taskId) };
    } catch (error) {
      logger.error('[IPC] task:get-task failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:update-task', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return await manager.updateTask(params.taskId, params.updates, params.actorDid);
    } catch (error) {
      logger.error('[IPC] task:update-task failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:delete-task', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return await manager.deleteTask(params.taskId);
    } catch (error) {
      logger.error('[IPC] task:delete-task failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:move-task', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return await manager.moveTask(params.taskId, params.columnId, params.position, params.actorDid);
    } catch (error) {
      logger.error('[IPC] task:move-task failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:assign-task', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return await manager.assignTask(params.taskId, params.userDid, params.role, params.assignedBy);
    } catch (error) {
      logger.error('[IPC] task:assign-task failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:set-priority', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return await manager.setPriority(params.taskId, params.priority, params.actorDid);
    } catch (error) {
      logger.error('[IPC] task:set-priority failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:set-due-date', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return await manager.setDueDate(params.taskId, params.dueDate, params.actorDid);
    } catch (error) {
      logger.error('[IPC] task:set-due-date failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:add-label', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return await manager.addLabel(params.taskId, params.labelId, params.actorDid);
    } catch (error) {
      logger.error('[IPC] task:add-label failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:link-tasks', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return await manager.linkTasks(params.taskId, params.dependsOnTaskId, params.dependencyType, params.actorDid);
    } catch (error) {
      logger.error('[IPC] task:link-tasks failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:create-subtask', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return await manager.createSubtask(params.parentTaskId, params.subtaskData);
    } catch (error) {
      logger.error('[IPC] task:create-subtask failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:convert-to-subtask', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return await manager.convertToSubtask(params.taskId, params.parentTaskId, params.actorDid);
    } catch (error) {
      logger.error('[IPC] task:convert-to-subtask failed:', error);
      throw error;
    }
  });

  // ========================================
  // Checklists (5 handlers)
  // ========================================

  ipcMain.handle('task:create-checklist', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return await manager.createChecklist(params.taskId, params.title);
    } catch (error) {
      logger.error('[IPC] task:create-checklist failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:add-checklist-item', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return await manager.addChecklistItem(params.checklistId, params.content, params.assigneeDid);
    } catch (error) {
      logger.error('[IPC] task:add-checklist-item failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:toggle-checklist-item', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return await manager.toggleChecklistItem(params.itemId, params.completedBy);
    } catch (error) {
      logger.error('[IPC] task:toggle-checklist-item failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:delete-checklist-item', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return await manager.deleteChecklistItem(params.itemId);
    } catch (error) {
      logger.error('[IPC] task:delete-checklist-item failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:reorder-checklist', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return await manager.reorderChecklist(params.checklistId, params.itemOrder);
    } catch (error) {
      logger.error('[IPC] task:reorder-checklist failed:', error);
      throw error;
    }
  });

  // ========================================
  // Comments and Activity (6 handlers)
  // ========================================

  ipcMain.handle('task:add-comment', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return await manager.addComment(params.taskId, params.comment);
    } catch (error) {
      logger.error('[IPC] task:add-comment failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:edit-comment', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return await manager.editComment(params.commentId, params.content, params.editorDid);
    } catch (error) {
      logger.error('[IPC] task:edit-comment failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:delete-comment', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return await manager.deleteComment(params.commentId, params.deleterDid);
    } catch (error) {
      logger.error('[IPC] task:delete-comment failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:get-comments', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return await manager.getComments(params.taskId, params.options || {});
    } catch (error) {
      logger.error('[IPC] task:get-comments failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:get-activity', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return await manager.getActivity(params.taskId, params.options || {});
    } catch (error) {
      logger.error('[IPC] task:get-activity failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:mention-user', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return await manager.mentionUser(params.taskId, params.userDid, params.mentionedBy);
    } catch (error) {
      logger.error('[IPC] task:mention-user failed:', error);
      throw error;
    }
  });

  // ========================================
  // Attachments (4 handlers)
  // ========================================

  ipcMain.handle('task:upload-attachment', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return await manager.uploadAttachment(params.taskId, params.file, params.uploaderDid, params.uploaderName);
    } catch (error) {
      logger.error('[IPC] task:upload-attachment failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:delete-attachment', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return await manager.deleteAttachment(params.attachmentId, params.deleterDid);
    } catch (error) {
      logger.error('[IPC] task:delete-attachment failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:get-attachments', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return await manager.getAttachments(params.taskId);
    } catch (error) {
      logger.error('[IPC] task:get-attachments failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:preview-attachment', async (_event, params) => {
    try {
      const { getTaskManager } = require('./task-manager');
      const manager = getTaskManager(database);
      return await manager.previewAttachment(params.attachmentId);
    } catch (error) {
      logger.error('[IPC] task:preview-attachment failed:', error);
      throw error;
    }
  });

  // ========================================
  // Sprint Management (5 handlers)
  // ========================================

  ipcMain.handle('task:create-sprint', async (_event, params) => {
    try {
      const { getTaskBoardManager } = require('./task-board-manager');
      const manager = getTaskBoardManager(database);
      return await manager.createSprint(params.boardId, params.sprintData);
    } catch (error) {
      logger.error('[IPC] task:create-sprint failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:start-sprint', async (_event, params) => {
    try {
      const { getTaskBoardManager } = require('./task-board-manager');
      const manager = getTaskBoardManager(database);
      return await manager.startSprint(params.sprintId);
    } catch (error) {
      logger.error('[IPC] task:start-sprint failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:complete-sprint', async (_event, params) => {
    try {
      const { getTaskBoardManager } = require('./task-board-manager');
      const manager = getTaskBoardManager(database);
      return await manager.completeSprint(params.sprintId);
    } catch (error) {
      logger.error('[IPC] task:complete-sprint failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:get-sprint-stats', async (_event, params) => {
    try {
      const { getTaskBoardManager } = require('./task-board-manager');
      const manager = getTaskBoardManager(database);
      return await manager.getSprintStats(params.sprintId);
    } catch (error) {
      logger.error('[IPC] task:get-sprint-stats failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:move-to-sprint', async (_event, params) => {
    try {
      const { getTaskBoardManager } = require('./task-board-manager');
      const manager = getTaskBoardManager(database);
      return await manager.moveToSprint(params.taskIds, params.sprintId);
    } catch (error) {
      logger.error('[IPC] task:move-to-sprint failed:', error);
      throw error;
    }
  });

  // ========================================
  // Reports and Analytics (5 handlers)
  // ========================================

  ipcMain.handle('task:create-report', async (_event, params) => {
    try {
      const { getTeamReportManager } = require('./team-report-manager');
      const manager = getTeamReportManager(database);
      return await manager.createReport(params);
    } catch (error) {
      logger.error('[IPC] task:create-report failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:get-reports', async (_event, params) => {
    try {
      const { getTeamReportManager } = require('./team-report-manager');
      const manager = getTeamReportManager(database);
      return await manager.getReports(params.orgId, params.options || {});
    } catch (error) {
      logger.error('[IPC] task:get-reports failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:generate-ai-summary', async (_event, params) => {
    try {
      const { getTeamReportManager } = require('./team-report-manager');
      const manager = getTeamReportManager(database);
      return await manager.generateAISummary(params.reportId);
    } catch (error) {
      logger.error('[IPC] task:generate-ai-summary failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:get-board-analytics', async (_event, params) => {
    try {
      const { getTaskBoardManager } = require('./task-board-manager');
      const manager = getTaskBoardManager(database);
      return await manager.getBoardAnalytics(params.boardId, params.options || {});
    } catch (error) {
      logger.error('[IPC] task:get-board-analytics failed:', error);
      throw error;
    }
  });

  ipcMain.handle('task:export-board', async (_event, params) => {
    try {
      const { getTaskBoardManager } = require('./task-board-manager');
      const manager = getTaskBoardManager(database);
      return await manager.exportBoard(params.boardId, params.format);
    } catch (error) {
      logger.error('[IPC] task:export-board failed:', error);
      throw error;
    }
  });

  logger.info('[IPC] 团队任务管理IPC处理器注册完成 (49个handlers)');
}

module.exports = {
  registerTaskIPC
};
