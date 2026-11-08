import { AsyncLocalStorage } from "node:async_hooks";
import { raceWithAbort } from "./abort-utils.js";

const admissionScope = new AsyncLocalStorage();

function closedAdmission() {
  const error = new Error("The provider request admission has closed");
  error.code = "CC_PROVIDER_REQUEST_ADMISSION_CLOSED";
  error.noReplay = true;
  return error;
}

export function hasProviderRequestAdmission() {
  for (let scope = admissionScope.getStore(); scope; scope = scope.parent) {
    if (isEnabled(scope)) return true;
  }
  return false;
}

function isEnabled(scope) {
  return typeof scope.enabled === "function"
    ? scope.enabled() !== false
    : scope.enabled !== false;
}

function targetFor(active, target) {
  return (
    target ??
    (typeof active?.target === "function" ? active.target() : active?.target)
  );
}

/** No await: use immediately before a physical side effect, including after locks. */
export function assertProviderRequestAdmissionOpen(target, controls = {}) {
  controls.signal?.throwIfAborted();
  if (!hasProviderRequestAdmission()) return;
  const active = admissionScope.getStore();
  const destination = targetFor(active, target);
  for (let scope = active; scope; scope = scope.parent) {
    if (scope.closed) throw closedAdmission();
    if (isEnabled(scope)) scope.check?.(destination, controls);
  }
}

/** Revalidate every inherited host constraint at each physical request/retry. */
export async function assertProviderRequestAdmission(target, controls = {}) {
  controls.signal?.throwIfAborted();
  const active = admissionScope.getStore();
  if (!active || !hasProviderRequestAdmission()) return;
  const destination = targetFor(active, target);
  for (let scope = active; scope; scope = scope.parent) {
    if (scope.closed) throw closedAdmission();
    if (isEnabled(scope)) {
      await raceWithAbort(
        Promise.resolve().then(() => {
          controls.signal?.throwIfAborted();
          return scope.validate(destination, controls);
        }),
        controls.signal,
        "Provider request admission interrupted",
      );
    }
    assertProviderRequestAdmissionOpen(destination, controls);
  }
}

/**
 * Acquire unique authority locks in stable order, start the request, and release
 * the locks before awaiting HTTP. The plain result box prevents Promise
 * assimilation from retaining an authority lock for the response lifetime.
 */
export async function dispatchProviderRequest(
  operation,
  target,
  controls = {},
) {
  await assertProviderRequestAdmission(target, controls);
  const active = admissionScope.getStore();
  const destination = targetFor(active, target);
  const resources = new Map();
  for (let scope = active; scope; scope = scope.parent) {
    if (!isEnabled(scope)) continue;
    const resource =
      typeof scope.resource === "function" ? scope.resource() : scope.resource;
    if (!resource) continue;
    if (
      typeof resource.key !== "string" ||
      typeof resource.withLock !== "function" ||
      !Number.isSafeInteger(resource.revision) ||
      resource.revision < 0
    ) {
      throw new TypeError(
        "Provider admission resource requires an authority key and revision",
      );
    }
    const existing = resources.get(resource.key);
    if (existing && existing.revision !== resource.revision) {
      const error = new Error(
        "Provider contexts bind different revisions of one Memory authority",
      );
      error.code = "revision_conflict";
      error.noReplay = true;
      throw error;
    }
    if (!existing) resources.set(resource.key, resource);
  }
  const ordered = [...resources].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  let started = false;
  const acquire = (index) => {
    if (index < ordered.length)
      return ordered[index][1].withLock(() => acquire(index + 1), controls);
    assertProviderRequestAdmissionOpen(destination, controls);
    started = true;
    const value = Promise.resolve(operation());
    // Observe rejection while asynchronous lock cleanup is still unwinding.
    value.catch(() => {});
    return { value };
  };
  try {
    return await acquire(0);
  } catch (failure) {
    if (!started) throw failure;
    // The operation may already have sent the request. A subsequent authority
    // unlock failure must never look like a retryable network timeout.
    let marked = false;
    try {
      marked =
        failure != null &&
        (typeof failure === "object" || typeof failure === "function") &&
        Reflect.set(failure, "noReplay", true) &&
        failure.noReplay === true;
    } catch {
      /* A frozen/opaque host error is retained as the cause below. */
    }
    if (marked) throw failure;
    const error = new Error("Provider dispatch or authority cleanup failed", {
      cause: failure,
    });
    let code = "CC_PROVIDER_DISPATCH_UNKNOWN";
    try {
      const originalCode = failure?.code;
      if (typeof originalCode === "string" && originalCode) code = originalCode;
    } catch {
      /* Preserve an opaque host failure as cause. */
    }
    error.code = code;
    error.noReplay = true;
    throw error;
  }
}

/** Host-owned constraints follow async transport work without changing payloads. */
export async function withProviderRequestAdmission(
  { validate, check, resource, target, enabled },
  operation,
) {
  if (typeof validate !== "function" || typeof operation !== "function") {
    throw new TypeError(
      "Provider admission requires a validator and operation",
    );
  }
  const scope = {
    validate,
    check,
    resource,
    enabled,
    target,
    parent: admissionScope.getStore(),
    closed: false,
  };
  return admissionScope.run(scope, async () => {
    try {
      await assertProviderRequestAdmission();
      return await operation();
    } finally {
      scope.closed = true;
    }
  });
}
