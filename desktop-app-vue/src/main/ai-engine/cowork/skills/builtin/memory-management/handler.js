/**
 * Memory Management Skill Handler
 *
 * Interfaces with the Permanent Memory system for cross-session
 * knowledge persistence and retrieval.
 */

const { logger } = require("../../../../utils/logger.js");

let memoryManager = null;

module.exports = {
  /**
   * Initialize the handler
   * @param {object} skill - The MarkdownSkill instance
   */
  async init(skill) {
    try {
      memoryManager = require("../../../../llm/permanent-memory-manager.js");
      logger.info("[MemoryManagement] Handler initialized");
    } catch (error) {
      logger.warn(
        "[MemoryManagement] PermanentMemoryManager not available:",
        error.message,
      );
    }
  },

  /**
   * Execute memory management task
   * @param {object} task - Task with input/args
   * @param {object} context - Execution context
   * @param {object} skill - The MarkdownSkill instance
   * @returns {Promise<object>}
   */
  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { action, content } = parseInput(input);

    logger.info(`[MemoryManagement] Executing action: ${action}`, {
      content: content?.substring(0, 100),
    });

    try {
      switch (action) {
        case "save":
        case "remember":
          return await handleSave(content, context);

        case "search":
        case "recall":
        case "find":
          return await handleSearch(content, context);

        case "review":
        case "read":
          return await handleReview(content, context);

        case "extract":
          return await handleExtract(content, context);

        case "stats":
        case "status":
          return await handleStats();

        default:
          // If no action specified, try to infer from content
          if (content) {
            return await handleSearch(content, context);
          }
          return {
            success: false,
            error: `Unknown action: ${action}. Use save, search, review, extract, or stats.`,
          };
      }
    } catch (error) {
      logger.error(`[MemoryManagement] Error executing ${action}:`, error);
      return {
        success: false,
        error: error.message,
        action,
      };
    }
  },
};

/**
 * Parse user input into action and content
 */
function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { action: "stats", content: "" };
  }

  const trimmed = input.trim();
  const spaceIndex = trimmed.indexOf(" ");

  if (spaceIndex === -1) {
    return { action: trimmed.toLowerCase(), content: "" };
  }

  return {
    action: trimmed.substring(0, spaceIndex).toLowerCase(),
    content: trimmed.substring(spaceIndex + 1).trim(),
  };
}

/**
 * Save content to memory
 */
async function handleSave(content, context) {
  if (!content) {
    return { success: false, error: "No content provided to save." };
  }

  if (!memoryManager) {
    return { success: false, error: "Memory manager not available." };
  }

  const manager =
    typeof memoryManager.getInstance === "function"
      ? memoryManager.getInstance()
      : memoryManager;

  // Save to daily notes
  const today = new Date().toISOString().split("T")[0];

  if (typeof manager.appendDailyNote === "function") {
    await manager.appendDailyNote(today, content);
  } else if (typeof manager.writeDailyNote === "function") {
    await manager.writeDailyNote(today, content);
  }

  return {
    success: true,
    action: "save",
    message: `Saved to daily notes (${today})`,
    date: today,
    contentLength: content.length,
  };
}

/**
 * Search memory using hybrid search
 */
async function handleSearch(query, context) {
  if (!query) {
    return { success: false, error: "No search query provided." };
  }

  if (!memoryManager) {
    return { success: false, error: "Memory manager not available." };
  }

  const manager =
    typeof memoryManager.getInstance === "function"
      ? memoryManager.getInstance()
      : memoryManager;

  let results = [];

  if (typeof manager.search === "function") {
    results = await manager.search(query, { limit: 10 });
  } else if (typeof manager.hybridSearch === "function") {
    results = await manager.hybridSearch(query, { limit: 10 });
  }

  return {
    success: true,
    action: "search",
    query,
    results: Array.isArray(results) ? results : [],
    resultCount: Array.isArray(results) ? results.length : 0,
  };
}

/**
 * Review daily notes
 */
async function handleReview(dateStr, context) {
  if (!memoryManager) {
    return { success: false, error: "Memory manager not available." };
  }

  const manager =
    typeof memoryManager.getInstance === "function"
      ? memoryManager.getInstance()
      : memoryManager;

  const date = dateStr || new Date().toISOString().split("T")[0];

  let content = "";
  if (typeof manager.readDailyNote === "function") {
    content = await manager.readDailyNote(date);
  } else if (typeof manager.getDailyNote === "function") {
    content = await manager.getDailyNote(date);
  }

  return {
    success: true,
    action: "review",
    date,
    content: content || `No notes found for ${date}`,
    hasContent: !!content,
  };
}

/**
 * Extract insights from conversation
 */
async function handleExtract(content, context) {
  if (!memoryManager) {
    return { success: false, error: "Memory manager not available." };
  }

  const manager =
    typeof memoryManager.getInstance === "function"
      ? memoryManager.getInstance()
      : memoryManager;

  if (typeof manager.extractFromConversation === "function") {
    const extracted = await manager.extractFromConversation(
      context.conversationHistory || content || "",
    );
    return {
      success: true,
      action: "extract",
      extracted,
    };
  }

  return {
    success: true,
    action: "extract",
    message:
      "Extract function not available in current memory manager version.",
  };
}

/**
 * Get memory statistics
 */
async function handleStats() {
  if (!memoryManager) {
    return { success: false, error: "Memory manager not available." };
  }

  const manager =
    typeof memoryManager.getInstance === "function"
      ? memoryManager.getInstance()
      : memoryManager;

  let stats = {};
  if (typeof manager.getStats === "function") {
    stats = await manager.getStats();
  }

  return {
    success: true,
    action: "stats",
    stats,
  };
}
