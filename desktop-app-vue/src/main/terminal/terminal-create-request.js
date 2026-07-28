/**
 * Shared create adapter for native IPC, web-shell WS and Android command
 * routing. Keep the accepted caller fields narrow: no caller can submit a
 * workspace/policy root. PtyManager resolves projectId (or the legacy cwd
 * selector) through its injected main-process database project resolver.
 */
function createBoundTerminalSession(ptyManager, payload = {}) {
  if (!ptyManager || typeof ptyManager.create !== "function") {
    throw new TypeError("ptyManager.create is required");
  }
  const request = payload && typeof payload === "object" ? payload : {};
  return ptyManager.create({
    projectId: request.projectId,
    shell: request.shell,
    cwd: request.cwd,
    env: request.env,
    cols: request.cols,
    rows: request.rows,
  });
}

module.exports = { createBoundTerminalSession };
