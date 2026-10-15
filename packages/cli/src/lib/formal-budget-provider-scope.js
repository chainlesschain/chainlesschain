import { AsyncLocalStorage } from "node:async_hooks";
import { budgetError, label, requireBudget } from "./formal-budget-errors.js";

const providerScope = new AsyncLocalStorage();

export function hasFormalBudgetProviderScope() {
  return !!providerScope.getStore();
}

/** Guard an adapter which cannot pass its physical calls to the authority. */
export function requireUnscopedModelTransport() {
  requireBudget(
    !providerScope.getStore(),
    "This model adapter has no governed transport for the active budget scope",
    "CC_BUDGET_TRANSPORT_NOT_COVERED",
  );
}

/** Search/service charges need their own verified contract, not a Chat quote. */
export function requireUnscopedPaidService() {
  const scope = providerScope.getStore();
  if (!scope) return;
  requireBudget(
    !scope.closed,
    "Provider budget scope closed",
    "CC_BUDGET_SCOPE_CLOSED",
  );
  throw budgetError(
    "CC_BUDGET_SERVICE_NOT_COVERED",
    "This external service has no verified billing contract for the active budget scope",
  );
}

/**
 * Canonical Agent tools can launch shells, MCP peers, skills, remote work or
 * descendants. None has a verified physical-request contract in this scope.
 * Deny before inspecting caller-controlled tool arguments or host callbacks.
 */
export function requireUnscopedToolExecution() {
  const scope = providerScope.getStore();
  if (!scope) return;
  requireBudget(
    !scope.closed,
    "Provider budget scope closed",
    "CC_BUDGET_SCOPE_CLOSED",
  );
  throw budgetError(
    "CC_BUDGET_TOOL_NOT_COVERED",
    "Agent tool execution has no governed descendant or external-service contract for the active budget scope",
  );
}

/** Direct process/keeper controls bypass executeTool and cannot inherit its guard. */
export function requireUnscopedDescendantControl() {
  const scope = providerScope.getStore();
  if (!scope) return;
  requireBudget(
    !scope.closed,
    "Provider budget scope closed",
    "CC_BUDGET_SCOPE_CLOSED",
  );
  throw budgetError(
    "CC_BUDGET_DESCENDANT_NOT_COVERED",
    "Descendant process control has no governed physical-request contract for the active budget scope",
  );
}

/** Direct URL/browser tools have no governed target or remote-cost contract. */
export function requireUnscopedExternalToolAccess() {
  const scope = providerScope.getStore();
  if (!scope) return;
  requireBudget(
    !scope.closed,
    "Provider budget scope closed",
    "CC_BUDGET_SCOPE_CLOSED",
  );
  throw budgetError(
    "CC_BUDGET_EXTERNAL_TOOL_NOT_COVERED",
    "Direct external tool access has no governed target or cost contract for the active budget scope",
  );
}

/**
 * Trusted-host opt-in only. Consume agent generators and response bodies inside
 * operation; outstanding requests are aborted when it returns. This binds async
 * calls in this process, not subprocesses, workers, arbitrary fetch or OS egress.
 * It neither admits formal evaluation nor creates/renews a budget lineage.
 */
export async function withFormalBudgetProviderScope(
  { transport, runId },
  operation,
) {
  requireBudget(
    !providerScope.getStore(),
    "A provider budget scope cannot be replaced by a nested scope",
    "CC_BUDGET_SCOPE_NESTED",
  );
  label(runId, "run ID");
  requireBudget(
    typeof transport?.createFetch === "function" &&
      typeof operation === "function",
    "Trusted budget transport and operation required",
  );
  const controller = new AbortController();
  const scope = {
    fetch: transport.createFetch({ runId }),
    signal: controller.signal,
    closed: false,
  };
  return providerScope.run(scope, async () => {
    try {
      const result = await operation();
      requireBudget(
        typeof result?.[Symbol.asyncIterator] !== "function",
        "Consume model generators inside the provider budget scope",
        "CC_BUDGET_SCOPE_UNCONSUMED",
      );
      return result;
    } finally {
      scope.closed = true;
      controller.abort(
        budgetError("CC_BUDGET_SCOPE_CLOSED", "Provider budget scope closed"),
      );
    }
  });
}

/** The injected fallback is used only outside a host-owned budget scope. */
export async function providerFetch(input, init, fetchImpl = globalThis.fetch) {
  const scope = providerScope.getStore();
  if (!scope) return fetchImpl(input, init);
  requireBudget(
    !scope.closed,
    "Provider budget scope closed",
    "CC_BUDGET_SCOPE_CLOSED",
  );
  return scope.fetch(input, {
    ...init,
    signal: init?.signal
      ? AbortSignal.any([scope.signal, init.signal])
      : scope.signal,
  });
}
