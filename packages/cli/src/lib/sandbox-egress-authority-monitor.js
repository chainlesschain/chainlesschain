import { randomUUID } from "node:crypto";

/**
 * Recheck the live shell authority while a Docker egress session exists. This
 * uses bounded polling as a fallback. Trusted policy owners also call revoke()
 * synchronously on official revisions; unobserved external changes reverted
 * between polls remain outside that event guarantee.
 */
export function createDockerEgressAuthorityMonitor({
  revalidate,
  abortProxy,
  intervalMs = 500,
  checkTimeoutMs = 5_000,
  sessionId = null,
  policyVersion = null,
}) {
  if (typeof revalidate !== "function" || typeof abortProxy !== "function")
    throw new TypeError("Docker egress authority callbacks are required");
  if (
    (sessionId !== null && typeof sessionId !== "string") ||
    (policyVersion !== null && typeof policyVersion !== "string")
  )
    throw new TypeError(
      "Docker egress acknowledgement identities must be strings",
    );
  const stopIdentity = Object.freeze({
    receiverId: randomUUID(),
    sessionId,
    policyVersion,
  });
  let revoked = null;
  let session = null;
  let timer = null;
  let checking = null;
  let stopped = false;
  const cleanupTasks = new Set();
  let proxyStopped = false;
  let sessionStopped = false;

  function trackCleanup(operation, onStopped) {
    try {
      const task = Promise.resolve(operation()).then(onStopped);
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
    trackCleanup(abortProxy, () => {
      proxyStopped = true;
    });
    if (session) {
      const closing = session;
      trackCleanup(
        () => closing.close(),
        () => {
          if (session === closing) sessionStopped = true;
        },
      );
    }
    return revoked;
  }

  function assertAuthorized() {
    if (revoked) throw revoked;
  }

  function attachSession(value) {
    if (session)
      throw new TypeError("Docker egress monitor session is already attached");
    session = value;
    sessionStopped = false;
    if (revoked) {
      trackCleanup(
        () => value.close(),
        () => {
          if (session === value) sessionStopped = true;
        },
      );
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
    stopIdentity,
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
    getStopAcknowledgement() {
      // A synchronous writer commit is never a stop ACK. Only the receiving
      // runtime, after stopping checks and awaiting both teardown operations,
      // can report this acknowledgement. Cleanup failures never mint one.
      if (
        !stopped ||
        !revoked ||
        revoked.cleanupError ||
        cleanupTasks.size ||
        !proxyStopped ||
        !sessionStopped
      )
        return null;
      return Object.freeze({
        schema: "chainlesschain.egress-stop-ack/v1",
        ...stopIdentity,
        proxyStopped: true,
        sessionStopped: true,
      });
    },
  };
}
