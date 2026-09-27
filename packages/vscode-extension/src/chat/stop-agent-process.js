/** Stop an owned child and wait for close; kill() returning true is not exit. */
function stopAgentProcess(
  child,
  { spawn, platform = process.platform, timeoutMs = 5000 } = {},
) {
  if (!child) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let closed = false;
    let treeStopped = platform !== "win32" || !child.pid;
    let killer;
    let settled = false;
    const finish = (error) => {
      if (settled || (!error && (!closed || !treeStopped))) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("close", onClose);
      if (error) reject(error);
      else resolve();
    };
    const onClose = () => {
      closed = true;
      finish();
    };
    const timer = setTimeout(
      () =>
        finish(
          new Error("Agent termination was not confirmed before the deadline"),
        ),
      timeoutMs,
    );
    timer.unref?.();
    child.once("close", onClose);
    try {
      if (!treeStopped) {
        killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          windowsHide: true,
        });
        killer.once("error", (error) => finish(error));
        killer.once("close", (code) => {
          if (code !== 0) {
            finish(new Error(`Agent process-tree stop failed (${code})`));
            return;
          }
          treeStopped = true;
          finish();
        });
      } else {
        // The CLI owns and tears down its POSIX children on SIGTERM. This
        // proves direct-child closure only; OS tree probes remain separate.
        child.kill();
      }
    } catch (error) {
      finish(error);
    }
  });
}

module.exports = { stopAgentProcess };
