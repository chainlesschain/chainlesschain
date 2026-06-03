/**
 * Agent Task Queue — Priority Queue with Persistence
 *
 * Manages a priority-sorted queue of autonomous agent goals.
 * Tasks are sorted by priority (lower number = higher priority)
 * and persisted to the database for recovery across restarts.
 *
 * @module ai-engine/autonomous/agent-task-queue
 * @version 1.0.0
 */

"use strict";

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

// ============================================================
// Constants
// ============================================================

const QUEUE_STATUS = {
  IDLE: "idle",
  PROCESSING: "processing",
};

// ============================================================
// AgentTaskQueue
// ============================================================

class AgentTaskQueue extends EventEmitter {
  constructor() {
    super();

    /** @type {Array<QueueItem>} Sorted by priority (lower = higher priority) */
    this.queue = [];

    /** @type {Object|null} Database reference */
    this.database = null;

    /** @type {boolean} Whether the queue is currently processing */
    this.processing = false;

    /** @type {number} Maximum concurrent active tasks */
    this.maxConcurrent = 3;

    /** @type {number} Currently active task count */
    this.activeCount = 0;

    /** @type {boolean} Initialization flag */
    this.initialized = false;
  }

  /**
   * Initialize with database and load persisted queue
   * @param {Object} database - Database manager instance
   */
  async initialize(database) {
    if (this.initialized) {
      return;
    }

    this.database = database || null;

    this._ensureTables();
    await this._loadFromDB();

    this.initialized = true;
    logger.info(
      `[AgentTaskQueue] Initialized with ${this.queue.length} queued tasks`
    );
  }

  /**
   * Create database tables for queue persistence
   * @private
   */
  _ensureTables() {
    if (!this.database) {
      return;
    }

    try {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS autonomous_task_queue (
          id TEXT PRIMARY KEY,
          goal_id TEXT NOT NULL,
          priority INTEGER DEFAULT 5,
          description TEXT NOT NULL,
          status TEXT DEFAULT 'queued',
          created_at TEXT DEFAULT (datetime('now')),
          started_at TEXT,
          completed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_atq_status ON autonomous_task_queue(status);
        CREATE INDEX IF NOT EXISTS idx_atq_priority ON autonomous_task_queue(priority, created_at);
      `);
      if (this.database.saveToFile) {
        this.database.saveToFile();
      }
    } catch (e) {
      logger.error("[AgentTaskQueue] Table creation error:", e.message);
    }
  }

  // ============================================================
  // Queue Operations
  // ============================================================

  /**
   * Add a task to the queue, maintaining priority sort order
   * @param {Object} task - { goalId, priority, description, createdAt }
   * @returns {Object} Enqueued task
   */
  async enqueue(task) {
    if (!task || !task.goalId) {
      throw new Error("Task must have a goalId");
    }

    const queueItem = {
      id: uuidv4(),
      goalId: task.goalId,
      priority: Math.max(1, Math.min(10, task.priority || 5)),
      description: task.description || "",
      status: "queued",
      createdAt: task.createdAt || new Date().toISOString(),
      startedAt: null,
      completedAt: null,
    };

    // Insert in priority-sorted position (lower number = higher priority)
    let inserted = false;
    for (let i = 0; i < this.queue.length; i++) {
      if (queueItem.priority < this.queue[i].priority) {
        this.queue.splice(i, 0, queueItem);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      this.queue.push(queueItem);
    }

    // Persist to DB
    this._saveItemToDB(queueItem);

    logger.info(
      `[AgentTaskQueue] Enqueued task ${queueItem.id} for goal ${queueItem.goalId} (priority: ${queueItem.priority}, queue size: ${this.queue.length})`
    );

    this.emit("task-enqueued", {
      id: queueItem.id,
      goalId: queueItem.goalId,
      priority: queueItem.priority,
      queueSize: this.queue.length,
    });

    return queueItem;
  }

  /**
   * Get and remove the highest priority task from the queue
   * @returns {Object|null} Dequeued task or null if empty
   */
  async dequeue() {
    if (this.queue.length === 0) {
      return null;
    }

    const task = this.queue.shift();
    task.status = "active";
    task.startedAt = new Date().toISOString();

    this.activeCount++;

    // Update DB
    this._updateItemInDB(task.id, {
      status: "active",
      started_at: task.startedAt,
    });

    logger.info(
      `[AgentTaskQueue] Dequeued task ${task.id} for goal ${task.goalId} (remaining: ${this.queue.length})`
    );

    this.emit("task-dequeued", {
      id: task.id,
      goalId: task.goalId,
      queueSize: this.queue.length,
    });

    return task;
  }

  /**
   * Peek at the next task without removing it
   * @returns {Object|null} Next task or null
   */
  async peek() {
    return this.queue[0] || null;
  }

  /**
   * Remove a task from the queue by goalId
   * @param {string} goalId - Goal ID to remove
   * @returns {boolean} Whether a task was removed
   */
  async remove(goalId) {
    const index = this.queue.findIndex((item) => item.goalId === goalId);

    if (index === -1) {
      return false;
    }

    const removed = this.queue.splice(index, 1)[0];

    // Update DB
    this._updateItemInDB(removed.id, {
      status: "removed",
      completed_at: new Date().toISOString(),
    });

    logger.info(
      `[AgentTaskQueue] Removed task for goal ${goalId} (queue size: ${this.queue.length})`
    );

    this.emit("task-removed", {
      id: removed.id,
      goalId,
      queueSize: this.queue.length,
    });

    return true;
  }

  /**
   * Mark a task as completed (decrements active count)
   * @param {string} goalId - Goal ID
   * @param {string} status - Final status ('completed', 'failed', 'cancelled')
   */
  async markComplete(goalId, status = "completed") {
    this.activeCount = Math.max(0, this.activeCount - 1);

    // Update DB if we can find the task record
    if (this.database) {
      try {
        this.database.run(
          "UPDATE autonomous_task_queue SET status = ?, completed_at = ? WHERE goal_id = ? AND status = 'active'",
          [status, new Date().toISOString(), goalId]
        );
        if (this.database.saveToFile) {
          this.database.saveToFile();
        }
      } catch (e) {
        logger.warn("[AgentTaskQueue] markComplete DB error:", e.message);
      }
    }

    logger.info(
      `[AgentTaskQueue] Task for goal ${goalId} marked as ${status} (active: ${this.activeCount})`
    );

    this.emit("task-completed", {
      goalId,
      status,
      activeCount: this.activeCount,
    });
  }

  /**
   * Get comprehensive queue status
   * @returns {Object} Queue status
   */
  async getQueueStatus() {
    const pending = this.queue.length;
    const active = this.activeCount;

    // Priority distribution
    const byPriority = {};
    for (const item of this.queue) {
      const key = `priority-${item.priority}`;
      byPriority[key] = (byPriority[key] || 0) + 1;
    }

    // Historical stats from DB
    let totalProcessed = 0;
    let totalCompleted = 0;
    let totalFailed = 0;

    if (this.database) {
      try {
        const processedRow = this.database
          .prepare(
            "SELECT COUNT(*) as count FROM autonomous_task_queue WHERE status IN ('completed', 'failed', 'cancelled')"
          )
          .get();
        totalProcessed = processedRow?.count || 0;

        const completedRow = this.database
          .prepare(
            "SELECT COUNT(*) as count FROM autonomous_task_queue WHERE status = 'completed'"
          )
          .get();
        totalCompleted = completedRow?.count || 0;

        const failedRow = this.database
          .prepare(
            "SELECT COUNT(*) as count FROM autonomous_task_queue WHERE status = 'failed'"
          )
          .get();
        totalFailed = failedRow?.count || 0;
      } catch (e) {
        // Ignore DB errors for status
      }
    }

    return {
      success: true,
      data: {
        pending,
        active,
        total: pending + active,
        maxConcurrent: this.maxConcurrent,
        canAcceptMore: active < this.maxConcurrent,
        byPriority,
        items: this.queue.map((item) => ({
          id: item.id,
          goalId: item.goalId,
          priority: item.priority,
          description:
            item.description.length > 100
              ? item.description.substring(0, 100) + "..."
              : item.description,
          status: item.status,
          createdAt: item.createdAt,
        })),
        historical: {
          totalProcessed,
          totalCompleted,
          totalFailed,
        },
      },
    };
  }

  /**
   * Reorder queue items by priority
   * Useful after dynamic priority changes
   */
  reSort() {
    this.queue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      // Same priority: earlier created goes first (FIFO)
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    logger.info("[AgentTaskQueue] Queue resorted");
    this.emit("queue-resorted", { queueSize: this.queue.length });
  }

  /**
   * Update the priority of a queued task
   * @param {string} goalId
   * @param {number} newPriority
   * @returns {boolean}
   */
  async updatePriority(goalId, newPriority) {
    const item = this.queue.find((i) => i.goalId === goalId);
    if (!item) {
      return false;
    }

    item.priority = Math.max(1, Math.min(10, newPriority));
    this.reSort();

    // Update DB
    if (this.database) {
      try {
        this.database.run(
          "UPDATE autonomous_task_queue SET priority = ? WHERE goal_id = ? AND status = 'queued'",
          [item.priority, goalId]
        );
        if (this.database.saveToFile) {
          this.database.saveToFile();
        }
      } catch (e) {
        logger.warn("[AgentTaskQueue] updatePriority DB error:", e.message);
      }
    }

    this.emit("priority-updated", { goalId, newPriority: item.priority });
    return true;
  }

  /**
   * Clear the entire queue (does not cancel active tasks)
   * @returns {number} Number of items removed
   */
  async clear() {
    const count = this.queue.length;
    const goalIds = this.queue.map((item) => item.goalId);

    this.queue = [];

    // Mark all queued items as removed in DB
    if (this.database) {
      try {
        this.database.run(
          "UPDATE autonomous_task_queue SET status = 'removed', completed_at = ? WHERE status = 'queued'",
          [new Date().toISOString()]
        );
        if (this.database.saveToFile) {
          this.database.saveToFile();
        }
      } catch (e) {
        logger.warn("[AgentTaskQueue] clear DB error:", e.message);
      }
    }

    logger.info(`[AgentTaskQueue] Queue cleared (${count} items removed)`);
    this.emit("queue-cleared", { removedCount: count, goalIds });

    return count;
  }

  // ============================================================
  // Persistence
  // ============================================================

  /**
   * Load pending tasks from database
   * @private
   */
  async _loadFromDB() {
    if (!this.database) {
      return;
    }

    try {
      const rows = this.database
        .prepare(
          "SELECT * FROM autonomous_task_queue WHERE status = 'queued' ORDER BY priority ASC, created_at ASC"
        )
        .all();

      for (const row of rows) {
        this.queue.push({
          id: row.id,
          goalId: row.goal_id,
          priority: row.priority,
          description: row.description,
          status: row.status,
          createdAt: row.created_at,
          startedAt: row.started_at,
          completedAt: row.completed_at,
        });
      }

      // Count active tasks to restore activeCount
      const activeRow = this.database
        .prepare(
          "SELECT COUNT(*) as count FROM autonomous_task_queue WHERE status = 'active'"
        )
        .get();
      this.activeCount = activeRow?.count || 0;
    } catch (e) {
      logger.error("[AgentTaskQueue] _loadFromDB error:", e.message);
    }
  }

  /**
   * Save a queue item to database
   * @private
   */
  _saveItemToDB(item) {
    if (!this.database) {
      return;
    }

    try {
      this.database.run(
        `INSERT INTO autonomous_task_queue (id, goal_id, priority, description, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          item.id,
          item.goalId,
          item.priority,
          item.description,
          item.status,
          item.createdAt,
        ]
      );
      if (this.database.saveToFile) {
        this.database.saveToFile();
      }
    } catch (e) {
      logger.error("[AgentTaskQueue] _saveItemToDB error:", e.message);
    }
  }

  /**
   * Update a queue item in database
   * @private
   */
  _updateItemInDB(itemId, fields) {
    if (!this.database) {
      return;
    }

    try {
      const setClauses = [];
      const values = [];

      for (const [key, value] of Object.entries(fields)) {
        setClauses.push(`${key} = ?`);
        values.push(value);
      }

      values.push(itemId);

      this.database.run(
        `UPDATE autonomous_task_queue SET ${setClauses.join(", ")} WHERE id = ?`,
        values
      );
      if (this.database.saveToFile) {
        this.database.saveToFile();
      }
    } catch (e) {
      logger.error("[AgentTaskQueue] _updateItemInDB error:", e.message);
    }
  }
}

// Singleton
let instance = null;

function getAgentTaskQueue() {
  if (!instance) {
    instance = new AgentTaskQueue();
  }
  return instance;
}

module.exports = {
  AgentTaskQueue,
  getAgentTaskQueue,
  QUEUE_STATUS,
};
