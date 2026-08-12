import {
  SchedulerKernelError,
  normalizeAuthorityEnvelope,
  normalizeIdentifier,
} from "./contract.js";

export const DEFAULT_SCHEDULER_AUTHORITY_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const DEFAULT_SCHEDULER_AUTHORITY_MAX_RUNS = 100_000;
export const DEFAULT_SCHEDULER_AUTHORITY_MAX_UNITS = 100_000;

function authorityError(code, message, details = undefined, cause = undefined) {
  const error = new SchedulerKernelError(
    code,
    message,
    details,
    cause ? { cause } : undefined,
  );
  error.retryable = false;
  return error;
}

function assertAuthorityStore(store) {
  const methods = [
    "ensureAuthorityPolicy",
    "getAuthorityPolicy",
    "reserveAuthority",
  ];
  if (!store || methods.some((method) => typeof store[method] !== "function")) {
    throw authorityError(
      "SCHEDULER_AUTHORITY_STORE_REQUIRED",
      "Scheduler authority resolver requires a compatible scheduler store",
    );
  }
  return store;
}

function normalizeUnits(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw authorityError(
      "SCHEDULER_AUTHORITY_UNITS_INVALID",
      "Scheduler authority units must be a positive integer",
    );
  }
  return value;
}

export function schedulerAuthorityPolicyReference(revision) {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw authorityError(
      "SCHEDULER_AUTHORITY_POLICY_INVALID",
      "Scheduler authority policy revision must be a positive integer",
    );
  }
  return `scheduler-authority:${revision}`;
}

export function parseSchedulerAuthorityPolicyReference(value) {
  const match = /^scheduler-authority:(\d+)$/u.exec(String(value || ""));
  const revision = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(revision) && revision > 0 ? revision : null;
}

export function bindSchedulerAuthorityPolicy(store, authority, defaults = {}) {
  const compatibleStore = assertAuthorityStore(store);
  const normalized = normalizeAuthorityEnvelope(authority);
  const policy = compatibleStore.ensureAuthorityPolicy(normalized, {
    windowMs: defaults.windowMs ?? DEFAULT_SCHEDULER_AUTHORITY_WINDOW_MS,
    maxRuns: defaults.maxRuns ?? DEFAULT_SCHEDULER_AUTHORITY_MAX_RUNS,
    maxUnits: defaults.maxUnits ?? DEFAULT_SCHEDULER_AUTHORITY_MAX_UNITS,
  });
  return {
    ...normalized,
    authorizationRefs: {
      ...normalized.authorizationRefs,
      schedulerPolicyRevision: schedulerAuthorityPolicyReference(
        policy.revision,
      ),
    },
  };
}

export function createSchedulerAuthorityResolver({
  store,
  validate,
  units = () => 1,
} = {}) {
  const compatibleStore = assertAuthorityStore(store);
  if (typeof validate !== "function") {
    throw authorityError(
      "SCHEDULER_AUTHORITY_VALIDATOR_REQUIRED",
      "Scheduler authority resolver requires a domain validator",
    );
  }
  if (typeof units !== "function") {
    throw authorityError(
      "SCHEDULER_AUTHORITY_UNITS_REQUIRED",
      "Scheduler authority resolver requires a unit estimator",
    );
  }
  return async (context) => {
    const domain = await validate(context);
    if (!domain || typeof domain !== "object" || domain.allowed !== true) {
      return {
        allowed: false,
        reason:
          typeof domain?.reason === "string"
            ? domain.reason.slice(0, 256)
            : "domain_authority_denied",
      };
    }
    const authority = normalizeAuthorityEnvelope(
      context?.occurrence?.authority,
    );
    const policy = compatibleStore.getAuthorityPolicy(authority.principal);
    if (!policy || !policy.enabled) {
      return { allowed: false, reason: "scheduler_authority_policy_required" };
    }
    const reference = parseSchedulerAuthorityPolicyReference(
      authority.authorizationRefs.schedulerPolicyRevision,
    );
    if (reference === null) {
      return { allowed: false, reason: "scheduler_authority_policy_unbound" };
    }
    if (reference !== policy.revision) {
      return { allowed: false, reason: "scheduler_authority_policy_stale" };
    }
    const occurrenceId = normalizeIdentifier(
      context?.occurrence?.id,
      "occurrenceId",
    );
    try {
      const requestedUnits = normalizeUnits(await units(context));
      const reservation = compatibleStore.reserveAuthority({
        occurrenceId,
        policyRevision: policy.revision,
        units: requestedUnits,
      });
      return {
        allowed: true,
        reason: "scheduler_authority_reserved",
        policyRevision: policy.revision,
        reservation,
      };
    } catch (cause) {
      if (
        typeof cause?.code === "string" &&
        cause.code.startsWith("SCHEDULER_AUTHORITY_")
      ) {
        return {
          allowed: false,
          reason: cause.code.toLowerCase(),
          details: cause.details,
        };
      }
      throw authorityError(
        "SCHEDULER_AUTHORITY_RESOLUTION_FAILED",
        "Scheduler permission and budget resolution failed closed",
        undefined,
        cause,
      );
    }
  };
}
