import { EventEmitter } from "node:events";

export const RUNTIME_EVENTS = {
  RUNTIME_START: "runtime:start",
  RUNTIME_STOP: "runtime:stop",
  SESSION_START: "session:start",
  SESSION_RESUME: "session:resume",
  SESSION_END: "session:end",
  SESSION_MESSAGE: "session:message",
  TURN_START: "turn:start",
  TURN_END: "turn:end",
  TASK_CREATED: "task:created",
  TASK_COMPLETED: "task:completed",
  TASK_NOTIFICATION: "task:notification",
  WORKTREE_DIFF_READY: "worktree:diff:ready",
  WORKTREE_MERGED: "worktree:merge:completed",
  COMPRESSION_APPLIED: "compression:applied",
  COMPRESSION_SUMMARY: "compression:summary",
  SERVER_START: "server:start",
  SERVER_STOP: "server:stop",
  ERROR: "runtime:error",
};

export function createRuntimeEvent(type, payload = {}, context = {}) {
  return {
    type,
    toolDescriptor: payload.toolDescriptor || context.toolDescriptor || null,
    toolTelemetryRecord:
      payload.toolTelemetryRecord || context.toolTelemetryRecord || null,
    kind: context.kind || payload.kind || null,
    sessionId: context.sessionId || payload.sessionId || null,
    timestamp: context.timestamp || Date.now(),
    payload,
  };
}

export class RuntimeEventEmitter extends EventEmitter {}
