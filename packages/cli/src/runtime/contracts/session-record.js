import { createWorktreeRecord } from "./worktree-record.js";

export function createSessionRecord(session = {}, extras = {}) {
  const history = Array.isArray(extras.history)
    ? extras.history
    : Array.isArray(session.messages)
      ? session.messages.filter((item) => item.role !== "system")
      : [];

  return {
    id: session.id || extras.sessionId || null,
    type: session.type || extras.sessionType || null,
    provider: session.provider || extras.provider || null,
    model: session.model || extras.model || null,
    baseUrl: session.baseUrl || extras.baseUrl || null,
    enabledToolNames: Array.isArray(extras.enabledToolNames)
      ? extras.enabledToolNames
      : Array.isArray(session.enabledToolNames)
        ? session.enabledToolNames
        : [],
    projectRoot: session.projectRoot || extras.projectRoot || null,
    baseProjectRoot: session.baseProjectRoot || extras.baseProjectRoot || null,
    planModeState:
      extras.planModeState ||
      session.planManager?.state ||
      session.planModeState ||
      null,
    hasHostManagedToolPolicy:
      extras.hasHostManagedToolPolicy ?? !!session.hostManagedToolPolicy,
    worktreeIsolation:
      session.worktreeIsolation === true || extras.worktreeIsolation === true,
    worktree:
      session.worktree || extras.worktree
        ? createWorktreeRecord(session.worktree || extras.worktree, {
            requested:
              session.worktreeIsolation === true ||
              extras.worktreeIsolation === true,
          })
        : null,
    messageCount: extras.messageCount ?? history.length,
    history,
    status: extras.status || null,
  };
}
