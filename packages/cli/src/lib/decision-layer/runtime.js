import { randomUUID } from "node:crypto";

import { runMeteredDirectModelCall } from "../direct-model-usage.js";
import { isTerminalModelFailure } from "../model-failure-policy.js";
import { markRuntimeLedgerPersistenceError } from "../runtime-usage-ledger.js";
import {
  createSkillDecisionRequest,
  decisionDigest,
  normalizeDecisionMode,
  normalizeSkillDecisionProviderResult,
  resolveSkillDecision,
  SKILL_DECISION_OBSERVATION_SCHEMA,
} from "./contracts.js";
import { captureDecisionProviderAuthority } from "./provider-authority.js";

export const SKILL_DECISION_RUNTIME_SCHEMA =
  "chainlesschain.skill-decision-runtime/v1";

const RUNTIMES = new WeakSet();
const DEFAULT_TIMEOUT_MS = 800;

function requiredText(value, label, maximum = 256) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > maximum ||
    /\p{Cc}/u.test(value)
  ) {
    throw new TypeError(`${label} is required and bounded`);
  }
  return value.trim();
}

function timeoutSignal(signal, timeoutMs) {
  const deadline = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

function projectUnavailable(error) {
  if (error?.name === "TimeoutError") return "provider-timeout";
  if (error?.code === "CC_DECISION_USAGE_UNKNOWN_BLOCKED") {
    return "provider-usage-unknown-blocked";
  }
  if (error?.code === "CC_DECISION_PROVIDER_HTTP_ERROR") {
    return "provider-http-error";
  }
  return "provider-unavailable";
}

function unavailableOutcome(reasonCode) {
  return {
    status: "unavailable",
    reasonCode,
    selectedCandidateId: null,
    selectedDigest: null,
    selectedSkillId: null,
    needsSkillProbability: null,
    choiceConfidence: null,
    resultDigest: null,
  };
}

function asPersistenceError(error) {
  if (error?.runtimeLedgerPersistence === true) return error;
  try {
    return markRuntimeLedgerPersistenceError(error);
  } catch {
    return markRuntimeLedgerPersistenceError(
      new Error("decision observation persistence failed", { cause: error }),
    );
  }
}

export function createSkillDecisionRuntime({
  mode = "off",
  tenantId = null,
  sessionId = null,
  provider = null,
  persist = null,
  observe = null,
  sessionBudget = null,
  initialUsageUnknown = false,
  thresholds = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  idGenerator = () => randomUUID(),
  now = () => new Date(),
} = {}) {
  const normalizedMode = normalizeDecisionMode(mode);
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 50 ||
    timeoutMs > 30_000
  ) {
    throw new TypeError(
      "decision timeout must be an integer from 50 to 30000 ms",
    );
  }
  if (typeof idGenerator !== "function" || typeof now !== "function") {
    throw new TypeError("decision runtime generators must be functions");
  }
  let providerAuthority = null;
  let boundTenantId = null;
  let boundSessionId = null;
  let unknownUsageSeen = initialUsageUnknown === true;
  if (normalizedMode !== "off") {
    providerAuthority = captureDecisionProviderAuthority(provider);
    boundTenantId = requiredText(tenantId, "tenantId");
    boundSessionId = requiredText(sessionId, "sessionId");
    if (typeof persist !== "function" || typeof observe !== "function") {
      throw new TypeError(
        "enabled decision runtime requires usage and observation persistence",
      );
    }
  }

  const writeObservation = async (observation) => {
    if (normalizedMode === "off") return;
    try {
      await observe(observation);
    } catch (error) {
      throw asPersistenceError(error);
    }
  };

  const persistDecisionUsage = async (type, event) => {
    await persist(type, event);
    if (type === "model_usage_unknown") unknownUsageSeen = true;
  };

  const runtime = Object.freeze({
    schema: SKILL_DECISION_RUNTIME_SCHEMA,
    mode: normalizedMode,
    tenantId: boundTenantId,
    sessionId: boundSessionId,
    suggest: async ({
      query,
      candidates,
      turnId,
      contextRevision,
      signal,
    } = {}) => {
      if (normalizedMode === "off") {
        return Object.freeze({
          schema: SKILL_DECISION_OBSERVATION_SCHEMA,
          mode: normalizedMode,
          status: "disabled",
          visible: false,
        });
      }
      if (signal?.aborted) throw signal.reason;
      const decisionId = `skill-${requiredText(idGenerator(), "decisionId")}`;
      const request = createSkillDecisionRequest({
        decisionId,
        tenantId: boundTenantId,
        sessionId: boundSessionId,
        turnId,
        query,
        candidates,
        contextRevision,
      });
      const startedAt = now();
      if (
        !(startedAt instanceof Date) ||
        !Number.isFinite(startedAt.getTime())
      ) {
        throw new TypeError("decision runtime clock returned an invalid date");
      }
      let outcome;
      let requestSignal = null;
      if (unknownUsageSeen) {
        outcome = unavailableOutcome("provider-usage-unknown-blocked");
      } else {
        try {
          const { result: raw, settlement } = await runMeteredDirectModelCall({
            sessionId: boundSessionId,
            persist: persistDecisionUsage,
            provider: providerAuthority.provider,
            model: providerAuthority.model,
            source: "model",
            operationId: `decision:${decisionId}`,
            sessionBudget,
            includeSettlement: true,
            call: () => {
              if (unknownUsageSeen) {
                const error = new Error("decision usage recovery is required");
                error.code = "CC_DECISION_USAGE_UNKNOWN_BLOCKED";
                throw error;
              }
              requestSignal = timeoutSignal(signal, timeoutMs);
              return providerAuthority.decide(request, {
                signal: requestSignal,
              });
            },
          });
          if (settlement !== "known") {
            // The metered call already persisted model_usage_unknown. Without a
            // budget root it may return the answer; never expose that answer.
            outcome = unavailableOutcome("provider-usage-unknown");
          } else {
            const normalized = normalizeSkillDecisionProviderResult(
              request,
              raw,
            );
            const resolved = resolveSkillDecision(
              request,
              normalized,
              thresholds,
            );
            outcome = {
              status: resolved.status,
              reasonCode: resolved.reasonCode,
              selectedCandidateId: resolved.selectedCandidateId,
              selectedDigest: resolved.selectedDigest,
              selectedSkillId: resolved.selectedSkillId,
              needsSkillProbability: resolved.needsSkillProbability,
              choiceConfidence: resolved.choiceConfidence,
              resultDigest: resolved.resultDigest,
            };
          }
        } catch (error) {
          const localTimeout =
            !signal?.aborted &&
            requestSignal?.aborted &&
            requestSignal.reason === error &&
            error?.name === "TimeoutError";
          if (
            signal?.aborted ||
            (isTerminalModelFailure(error) && !localTimeout)
          ) {
            throw error;
          }
          outcome = unavailableOutcome(projectUnavailable(error));
        }
      }
      const finishedAt = now();
      if (
        !(finishedAt instanceof Date) ||
        !Number.isFinite(finishedAt.getTime())
      ) {
        throw new TypeError("decision runtime clock returned an invalid date");
      }
      const observationCore = {
        schema: SKILL_DECISION_OBSERVATION_SCHEMA,
        decisionId,
        mode: normalizedMode,
        tenantId: boundTenantId,
        sessionId: boundSessionId,
        turnId: request.binding.turnId,
        requestDigest: request.requestDigest,
        candidateSetDigest: request.candidateSetDigest,
        provider: providerAuthority.provider,
        model: providerAuthority.model,
        status: outcome.status,
        reasonCode: outcome.reasonCode,
        selectedDigest: outcome.selectedDigest,
        resultDigest: outcome.resultDigest,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        latencyMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      };
      const observation = Object.freeze({
        ...observationCore,
        observationDigest: decisionDigest(
          SKILL_DECISION_OBSERVATION_SCHEMA,
          observationCore,
        ),
      });
      await writeObservation(observation);
      return Object.freeze({
        schema: SKILL_DECISION_OBSERVATION_SCHEMA,
        decisionId,
        mode: normalizedMode,
        visible: normalizedMode === "suggest",
        receiptRef: observation.observationDigest,
        ...outcome,
      });
    },
  });
  RUNTIMES.add(runtime);
  return runtime;
}

export function captureSkillDecisionRuntime(value) {
  if (!RUNTIMES.has(value)) {
    throw new TypeError("a branded Skill decision runtime is required");
  }
  return value;
}
