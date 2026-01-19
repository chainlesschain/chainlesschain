/**
 * LearnedPatternManager IPC Handlers
 * Handles IPC communication for learned pattern management
 *
 * @module learned-pattern-manager-ipc
 * @version 1.0.0
 * @since 2026-01-17
 */

const ipcGuard = require("../ipc/ipc-guard");

/**
 * Register all LearnedPatternManager IPC handlers
 * @param {Object} dependencies - Dependencies
 * @param {Object} dependencies.learnedPatternManager - LearnedPatternManager instance
 * @param {Object} [dependencies.ipcMain] - IPC main object (for testing)
 */
function registerLearnedPatternManagerIPC({
  learnedPatternManager,
  ipcMain: injectedIpcMain,
}) {
  // Prevent duplicate registration
  if (ipcGuard.isModuleRegistered("learned-pattern-manager-ipc")) {
    console.log(
      "[LearnedPatternManager IPC] Handlers already registered, skipping...",
    );
    return;
  }

  const electron = require("electron");
  const ipcMain = injectedIpcMain || electron.ipcMain;

  console.log(
    "[LearnedPatternManager IPC] Registering LearnedPatternManager IPC handlers...",
  );

  // Create mutable reference for hot-reload support
  const managerRef = { current: learnedPatternManager };

  // ============================================================
  // Prompt Patterns
  // ============================================================

  /**
   * Record a prompt pattern
   * Channel: 'pattern:record-prompt'
   */
  ipcMain.handle("pattern:record-prompt", async (_event, params) => {
    try {
      if (!managerRef.current) {
        throw new Error("LearnedPatternManager not initialized");
      }
      return await managerRef.current.recordPromptPattern(params);
    } catch (error) {
      console.error("[LearnedPatternManager IPC] Record prompt failed:", error);
      throw error;
    }
  });

  /**
   * Update prompt pattern usage
   * Channel: 'pattern:update-prompt-usage'
   */
  ipcMain.handle(
    "pattern:update-prompt-usage",
    async (_event, id, options = {}) => {
      try {
        if (!managerRef.current) {
          throw new Error("LearnedPatternManager not initialized");
        }
        await managerRef.current.updatePromptPatternUsage(id, options);
        return { success: true };
      } catch (error) {
        console.error(
          "[LearnedPatternManager IPC] Update prompt usage failed:",
          error,
        );
        throw error;
      }
    },
  );

  /**
   * Get prompt suggestions
   * Channel: 'pattern:get-prompt-suggestions'
   */
  ipcMain.handle(
    "pattern:get-prompt-suggestions",
    async (_event, context = {}) => {
      try {
        if (!managerRef.current) {
          throw new Error("LearnedPatternManager not initialized");
        }
        return await managerRef.current.getPromptSuggestions(context);
      } catch (error) {
        console.error(
          "[LearnedPatternManager IPC] Get prompt suggestions failed:",
          error,
        );
        throw error;
      }
    },
  );

  /**
   * Search prompt patterns
   * Channel: 'pattern:search-prompts'
   */
  ipcMain.handle(
    "pattern:search-prompts",
    async (_event, query, options = {}) => {
      try {
        if (!managerRef.current) {
          throw new Error("LearnedPatternManager not initialized");
        }
        return await managerRef.current.searchPromptPatterns(query, options);
      } catch (error) {
        console.error(
          "[LearnedPatternManager IPC] Search prompts failed:",
          error,
        );
        throw error;
      }
    },
  );

  // ============================================================
  // Error Fix Patterns
  // ============================================================

  /**
   * Record an error fix pattern
   * Channel: 'pattern:record-error-fix'
   */
  ipcMain.handle("pattern:record-error-fix", async (_event, params) => {
    try {
      if (!managerRef.current) {
        throw new Error("LearnedPatternManager not initialized");
      }
      return await managerRef.current.recordErrorFix(params);
    } catch (error) {
      console.error(
        "[LearnedPatternManager IPC] Record error fix failed:",
        error,
      );
      throw error;
    }
  });

  /**
   * Get error fix suggestions
   * Channel: 'pattern:get-error-fix-suggestions'
   */
  ipcMain.handle(
    "pattern:get-error-fix-suggestions",
    async (_event, error, limit = 3) => {
      try {
        if (!managerRef.current) {
          throw new Error("LearnedPatternManager not initialized");
        }
        return await managerRef.current.getErrorFixSuggestions(error, limit);
      } catch (error) {
        console.error(
          "[LearnedPatternManager IPC] Get error fix suggestions failed:",
          error,
        );
        throw error;
      }
    },
  );

  // ============================================================
  // Code Snippets
  // ============================================================

  /**
   * Save a code snippet
   * Channel: 'pattern:save-snippet'
   */
  ipcMain.handle("pattern:save-snippet", async (_event, snippet) => {
    try {
      if (!managerRef.current) {
        throw new Error("LearnedPatternManager not initialized");
      }
      return await managerRef.current.saveCodeSnippet(snippet);
    } catch (error) {
      console.error("[LearnedPatternManager IPC] Save snippet failed:", error);
      throw error;
    }
  });

  /**
   * Get code snippets
   * Channel: 'pattern:get-snippets'
   */
  ipcMain.handle("pattern:get-snippets", async (_event, options = {}) => {
    try {
      if (!managerRef.current) {
        throw new Error("LearnedPatternManager not initialized");
      }
      return await managerRef.current.getCodeSnippets(options);
    } catch (error) {
      console.error("[LearnedPatternManager IPC] Get snippets failed:", error);
      throw error;
    }
  });

  /**
   * Use a code snippet (increment use count)
   * Channel: 'pattern:use-snippet'
   */
  ipcMain.handle("pattern:use-snippet", async (_event, id) => {
    try {
      if (!managerRef.current) {
        throw new Error("LearnedPatternManager not initialized");
      }
      await managerRef.current.useCodeSnippet(id);
      return { success: true };
    } catch (error) {
      console.error("[LearnedPatternManager IPC] Use snippet failed:", error);
      throw error;
    }
  });

  /**
   * Toggle snippet favorite
   * Channel: 'pattern:toggle-snippet-favorite'
   */
  ipcMain.handle("pattern:toggle-snippet-favorite", async (_event, id) => {
    try {
      if (!managerRef.current) {
        throw new Error("LearnedPatternManager not initialized");
      }
      const isFavorite = await managerRef.current.toggleSnippetFavorite(id);
      return { success: true, isFavorite };
    } catch (error) {
      console.error(
        "[LearnedPatternManager IPC] Toggle favorite failed:",
        error,
      );
      throw error;
    }
  });

  /**
   * Delete a code snippet
   * Channel: 'pattern:delete-snippet'
   */
  ipcMain.handle("pattern:delete-snippet", async (_event, id) => {
    try {
      if (!managerRef.current) {
        throw new Error("LearnedPatternManager not initialized");
      }
      await managerRef.current.deleteCodeSnippet(id);
      return { success: true };
    } catch (error) {
      console.error(
        "[LearnedPatternManager IPC] Delete snippet failed:",
        error,
      );
      throw error;
    }
  });

  // ============================================================
  // Workflow Patterns
  // ============================================================

  /**
   * Record a workflow pattern
   * Channel: 'pattern:record-workflow'
   */
  ipcMain.handle("pattern:record-workflow", async (_event, workflow) => {
    try {
      if (!managerRef.current) {
        throw new Error("LearnedPatternManager not initialized");
      }
      return await managerRef.current.recordWorkflow(workflow);
    } catch (error) {
      console.error(
        "[LearnedPatternManager IPC] Record workflow failed:",
        error,
      );
      throw error;
    }
  });

  /**
   * Get workflow suggestions
   * Channel: 'pattern:get-workflow-suggestions'
   */
  ipcMain.handle(
    "pattern:get-workflow-suggestions",
    async (_event, context = {}) => {
      try {
        if (!managerRef.current) {
          throw new Error("LearnedPatternManager not initialized");
        }
        return await managerRef.current.getWorkflowSuggestions(context);
      } catch (error) {
        console.error(
          "[LearnedPatternManager IPC] Get workflow suggestions failed:",
          error,
        );
        throw error;
      }
    },
  );

  /**
   * Update workflow usage
   * Channel: 'pattern:update-workflow-usage'
   */
  ipcMain.handle(
    "pattern:update-workflow-usage",
    async (_event, id, options = {}) => {
      try {
        if (!managerRef.current) {
          throw new Error("LearnedPatternManager not initialized");
        }
        await managerRef.current.updateWorkflowUsage(id, options);
        return { success: true };
      } catch (error) {
        console.error(
          "[LearnedPatternManager IPC] Update workflow usage failed:",
          error,
        );
        throw error;
      }
    },
  );

  // ============================================================
  // Statistics and Maintenance
  // ============================================================

  /**
   * Get statistics
   * Channel: 'pattern:get-stats'
   */
  ipcMain.handle("pattern:get-stats", async () => {
    try {
      if (!managerRef.current) {
        throw new Error("LearnedPatternManager not initialized");
      }
      return await managerRef.current.getStats();
    } catch (error) {
      console.error("[LearnedPatternManager IPC] Get stats failed:", error);
      throw error;
    }
  });

  /**
   * Backup patterns to files
   * Channel: 'pattern:backup'
   */
  ipcMain.handle("pattern:backup", async () => {
    try {
      if (!managerRef.current) {
        throw new Error("LearnedPatternManager not initialized");
      }
      return await managerRef.current.backupToFiles();
    } catch (error) {
      console.error("[LearnedPatternManager IPC] Backup failed:", error);
      throw error;
    }
  });

  /**
   * Cleanup old patterns
   * Channel: 'pattern:cleanup'
   */
  ipcMain.handle("pattern:cleanup", async (_event, options = {}) => {
    try {
      if (!managerRef.current) {
        throw new Error("LearnedPatternManager not initialized");
      }
      return await managerRef.current.cleanup(options);
    } catch (error) {
      console.error("[LearnedPatternManager IPC] Cleanup failed:", error);
      throw error;
    }
  });

  /**
   * Update LearnedPatternManager reference
   * For hot-reload or reinitialization
   * @param {LearnedPatternManager} newManager - New instance
   */
  function updateLearnedPatternManager(newManager) {
    managerRef.current = newManager;
    console.log("[LearnedPatternManager IPC] Reference updated");
  }

  // Mark as registered
  ipcGuard.markModuleRegistered("learned-pattern-manager-ipc");

  console.log(
    "[LearnedPatternManager IPC] LearnedPatternManager IPC handlers registered successfully",
  );

  return {
    updateLearnedPatternManager,
  };
}

module.exports = {
  registerLearnedPatternManagerIPC,
};
