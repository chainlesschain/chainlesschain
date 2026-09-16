import { ContextMemoryKernel } from "@chainlesschain/context-memory-kernel";
import { TaskWorklog } from "../../src/lib/context-memory-kernel/task-worklog-port.js";

export function createTaskWorklogHarness() {
  const checkpoints = new Map();
  const port = {
    commitTaskCheckpoint(checkpoint, expectedRevision) {
      if (
        (checkpoints.get(checkpoint.sessionId)?.revision || 0) !==
        expectedRevision
      )
        return { ok: false };
      checkpoints.set(checkpoint.sessionId, structuredClone(checkpoint));
      return { ok: true, head: checkpoint.digest };
    },
  };
  const kernel = new ContextMemoryKernel({ sessionPort: port });
  return {
    checkpoints,
    create: (options) =>
      new TaskWorklog({
        ...options,
        runtime: { kernel },
        readCheckpoint: (id) => checkpoints.get(id) || null,
      }),
  };
}
