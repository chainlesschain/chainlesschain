/**
 * Recheck the live shell authority while a Docker egress session exists. This
 * is a bounded poll, not a lossless revision subscription: changes that are
 * reverted between checks cannot be observed.
 */
export function createDockerEgressAuthorityMonitor({
  revalidate,
  abortProxy,
  intervalMs = 500,
  checkTimeoutMs = 5_000,
}) {
  if (typeof revalidate !== "function" || typeof abortProxy !== "function")
    throw new TypeError("Docker egress authority callbacks are required");
  let revoked = null;
  let session = null;
  let timer = null;
  let checking = null;
  let stopped = false;
  const cleanupTasks = new Set();

  function trackCleanup(operation) {
    try {
      const task = Promise.resolve(operation());
      cleanupTasks.add(task);
      void task.catch((error) => {
        if (revoked && !revoked.cleanupError) revoked.cleanupError = error;
      });
      void task.finally(() => cleanupTasks.delete(task)).catch(() => {});
    } catch (error) {
      if (revoked && !revoked.cleanupError) revoked.cleanupError = error;
    }
  }

  function revoke(cause) {
    if (revoked) return revoked;
    revoked =
      cause instanceof Error
        ? cause
        : new Error("Docker egress authority was revoked");
    if (!revoked.code) revoked.code = "CC_DOCKER_EGRESS_AUTHORITY_CHANGED";
    clearTimeout(timer);
    // Latch first, then cut the broker before closing the target containers.
    trackCleanup(abortProxy);
    if (session) trackCleanup(() => session.close());
    return revoked;
  }

  function assertAuthorized() {
    if (revoked) throw revoked;
  }

  function attachSession(value) {
    session = value;
    if (revoked) {
      trackCleanup(() => value.close());
      throw revoked;
    }
  }

  function checkNow() {
    assertAuthorized();
    if (checking) return checking;
    let timeout;
    const deadline = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        reject(
          Object.assign(new Error("Docker egress authority check timed out"), {
            code: "CC_DOCKER_EGRESS_AUTHORITY_TIMEOUT",
          }),
        );
      }, checkTimeoutMs);
      timeout.unref?.();
    });
    const current = Promise.race([Promise.resolve().then(revalidate), deadline])
      .then((accepted) => {
        if (accepted === false)
          throw new Error("Docker egress authority check rejected execution");
        assertAuthorized();
      })
      .catch((error) => {
        throw revoke(error);
      })
      .finally(() => {
        clearTimeout(timeout);
        if (checking === current) checking = null;
      });
    checking = current;
    return current;
  }

  async function checkFresh() {
    // A check already in flight may have sampled authority before a dispatch
    // or receipt boundary. Drain it, then make a new observation.
    if (checking) await checking;
    assertAuthorized();
    await checkNow();
  }

  function schedule() {
    if (stopped || revoked) return;
    timer = setTimeout(async () => {
      if (stopped || revoked) return;
      try {
        await checkNow();
      } catch {
        // revoke() already latched the error and started teardown.
      }
      schedule();
    }, intervalMs);
    timer.unref?.();
  }

  return {
    get revocationError() {
      return revoked;
    },
    start: schedule,
    checkNow,
    checkFresh,
    assertAuthorized,
    attachSession,
    revoke,
    async finish() {
      stopped = true;
      clearTimeout(timer);
      await checkFresh();
      assertAuthorized();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
    async awaitCleanup() {
      await Promise.allSettled([...cleanupTasks]);
    },
  };
}
