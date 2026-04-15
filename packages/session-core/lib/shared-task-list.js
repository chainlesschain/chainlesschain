/**
 * SharedTaskList — 多 Agent 共享任务列表
 *
 * Phase C of Managed Agents parity plan.
 *
 * 对标 Managed Agents Teams 的 "shared task list" — 同一 team 内所有 peer agent
 * 读写同一份 TODO,互相可见进度,避免重复工作。
 *
 * 设计要点:
 * - 乐观锁: 每个 task 有 rev,update 时必须传入当前 rev,不匹配则抛 ConcurrencyError
 * - 事件广播: added / updated / completed / removed / claimed
 * - 角色无关: 任何成员都可增删改;claim 只是元数据(不互斥)
 * - 状态: pending → in_progress → completed | cancelled | blocked
 */

const EventEmitter = require("events");
const crypto = require("crypto");

const TASK_STATUS = Object.freeze({
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  BLOCKED: "blocked",
});

const TERMINAL = new Set([TASK_STATUS.COMPLETED, TASK_STATUS.CANCELLED]);

function generateTaskId() {
  return `task_${crypto.randomBytes(6).toString("hex")}`;
}

class ConcurrencyError extends Error {
  constructor(taskId, expectedRev, actualRev) {
    super(
      `ConcurrencyError: task ${taskId} rev mismatch (expected ${expectedRev}, got ${actualRev})`
    );
    this.name = "ConcurrencyError";
    this.taskId = taskId;
    this.expectedRev = expectedRev;
    this.actualRev = actualRev;
  }
}

class SharedTaskList extends EventEmitter {
  constructor({ groupId = null, now = Date.now } = {}) {
    super();
    this.groupId = groupId;
    this._now = now;
    this._tasks = new Map(); // taskId → task
  }

  /**
   * 新增 task
   */
  add({ title, description = "", assignee = null, priority = "normal", metadata = {}, createdBy = null } = {}) {
    if (!title || typeof title !== "string") {
      throw new Error("SharedTaskList.add: title required");
    }
    const id = generateTaskId();
    const task = {
      id,
      title,
      description,
      status: TASK_STATUS.PENDING,
      assignee,
      priority,
      metadata: { ...metadata },
      createdBy,
      createdAt: this._now(),
      updatedAt: this._now(),
      rev: 1,
      history: [
        {
          ts: this._now(),
          actor: createdBy,
          action: "created",
        },
      ],
    };
    this._tasks.set(id, task);
    this.emit("added", task);
    return { ...task };
  }

  /**
   * 更新 task(乐观锁)
   */
  update(taskId, { rev, patch = {}, actor = null }) {
    const task = this._tasks.get(taskId);
    if (!task) throw new Error(`update: task ${taskId} not found`);
    if (rev == null) throw new Error("update: rev required");
    if (task.rev !== rev) {
      throw new ConcurrencyError(taskId, rev, task.rev);
    }

    // 允许修改的字段白名单
    const allowed = ["title", "description", "status", "assignee", "priority", "metadata"];
    const changes = {};
    for (const k of allowed) {
      if (patch[k] !== undefined) {
        changes[k] = patch[k];
      }
    }
    if (changes.status && !Object.values(TASK_STATUS).includes(changes.status)) {
      throw new Error(`update: invalid status "${changes.status}"`);
    }

    Object.assign(task, changes);
    task.updatedAt = this._now();
    task.rev++;
    task.history.push({
      ts: this._now(),
      actor,
      action: "updated",
      changes: Object.keys(changes),
    });

    this.emit("updated", task);
    if (changes.status === TASK_STATUS.COMPLETED) {
      this.emit("completed", task);
    }
    return { ...task };
  }

  /**
   * Claim — 认领任务(语义:只更新 assignee + status→in_progress)
   * 不互斥;返回 null 表示 task 已在终态
   */
  claim(taskId, { agentId, actor = agentId } = {}) {
    const task = this._tasks.get(taskId);
    if (!task) throw new Error(`claim: task ${taskId} not found`);
    if (TERMINAL.has(task.status)) return null;
    return this.update(taskId, {
      rev: task.rev,
      patch: { assignee: agentId, status: TASK_STATUS.IN_PROGRESS },
      actor,
    });
  }

  complete(taskId, { actor = null, note = null } = {}) {
    const task = this._tasks.get(taskId);
    if (!task) throw new Error(`complete: task ${taskId} not found`);
    const patch = { status: TASK_STATUS.COMPLETED };
    if (note) patch.metadata = { ...task.metadata, completionNote: note };
    return this.update(taskId, { rev: task.rev, patch, actor });
  }

  remove(taskId, { actor = null } = {}) {
    const task = this._tasks.get(taskId);
    if (!task) return false;
    this._tasks.delete(taskId);
    this.emit("removed", { ...task, removedBy: actor, removedAt: this._now() });
    return true;
  }

  get(taskId) {
    const t = this._tasks.get(taskId);
    return t ? { ...t } : null;
  }

  /**
   * 列表,支持过滤
   */
  list({ status, assignee, priority } = {}) {
    const out = [];
    for (const t of this._tasks.values()) {
      if (status && t.status !== status) continue;
      if (assignee !== undefined && t.assignee !== assignee) continue;
      if (priority && t.priority !== priority) continue;
      out.push({ ...t });
    }
    return out;
  }

  /**
   * 统计汇总
   */
  stats() {
    const counts = { total: 0 };
    for (const s of Object.values(TASK_STATUS)) counts[s] = 0;
    for (const t of this._tasks.values()) {
      counts.total++;
      counts[t.status]++;
    }
    return counts;
  }

  /**
   * 快照(持久化用)
   */
  snapshot() {
    return {
      groupId: this.groupId,
      tasks: Array.from(this._tasks.values()).map((t) => ({
        ...t,
        history: [...t.history],
      })),
    };
  }

  static restore(snapshot, { now = Date.now } = {}) {
    const list = new SharedTaskList({ groupId: snapshot.groupId, now });
    for (const t of snapshot.tasks || []) {
      list._tasks.set(t.id, { ...t, history: [...(t.history || [])] });
    }
    return list;
  }

  size() {
    return this._tasks.size;
  }

  clear() {
    this._tasks.clear();
  }
}

module.exports = {
  SharedTaskList,
  TASK_STATUS,
  ConcurrencyError,
  generateTaskId,
};
