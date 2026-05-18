export function createTaskRecord(task = {}, meta = {}) {
  return {
    id: task.id || null,
    status: task.status || null,
    type: task.type || null,
    description: task.description || null,
    ownerNodeId: task.ownerNodeId || null,
    createdAt: task.createdAt || null,
    startedAt: task.startedAt || null,
    completedAt: task.completedAt || null,
    result: task.result ?? null,
    error: task.error ?? null,
    recoveredFromRestart: Boolean(task.recoveredFromRestart),
    recoverySourceStatus: task.recoverySourceStatus || null,
    outputSummary: task.outputSummary || null,
    meta,
  };
}
