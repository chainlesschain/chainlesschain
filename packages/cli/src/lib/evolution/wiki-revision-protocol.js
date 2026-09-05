import {
  WIKI_REVISION_SCHEMA,
  WIKI_STATE_SCHEMA,
  digestWikiState,
} from "./evidence-backed-wiki-maintainer.js";

export const WIKI_LEDGER_CORRUPT_CODE = "CC_EVOLUTION_WIKI_LEDGER_CORRUPT";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const REVISION_ID = /^wiki:[a-f0-9]{64}$/u;
function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

// Same canonical digest as the Maintainer, including legacy revisions whose
// payload predates maintenanceRequestId/maintenanceRequestDigest.
export function verifyWikiRevision(revision, descriptor) {
  const { state, stateDigest, revisionId, ...payload } = revision ?? {};
  const fields = [
    "schema",
    "tenantId",
    "evolutionRunId",
    "revision",
    "priorStateDigest",
    "rulesDigest",
    "maintainerModel",
    "effectiveAt",
    "evidenceRefs",
    "operationDigest",
  ];
  const hasRequest = Object.hasOwn(payload, "maintenanceRequestId");
  if (hasRequest)
    fields.push("maintenanceRequestId", "maintenanceRequestDigest");
  if (
    Object.keys(payload).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(payload, key)) ||
    payload.schema !== WIKI_REVISION_SCHEMA ||
    payload.tenantId !== descriptor.tenantId ||
    payload.evolutionRunId !== descriptor.evolutionRunId ||
    !Number.isSafeInteger(payload.revision) ||
    payload.revision < 1 ||
    !DIGEST.test(payload.priorStateDigest ?? "") ||
    !DIGEST.test(payload.rulesDigest ?? "") ||
    !DIGEST.test(payload.operationDigest ?? "") ||
    typeof payload.maintainerModel !== "string" ||
    !payload.maintainerModel.trim() ||
    typeof payload.effectiveAt !== "string" ||
    !Number.isFinite(Date.parse(payload.effectiveAt)) ||
    !Array.isArray(payload.evidenceRefs) ||
    payload.evidenceRefs.length === 0 ||
    payload.evidenceRefs.length > 256 ||
    payload.evidenceRefs.some(
      (ref) => typeof ref !== "string" || !ref.trim(),
    ) ||
    digestWikiState(payload.evidenceRefs) !==
      digestWikiState([...new Set(payload.evidenceRefs)].sort()) ||
    !REVISION_ID.test(revisionId ?? "") ||
    revisionId !== `wiki:${digestWikiState(payload).slice(7)}` ||
    state?.schema !== WIKI_STATE_SCHEMA ||
    state.tenantId !== descriptor.tenantId ||
    state.revision !== payload.revision ||
    state.revisionId !== revisionId ||
    stateDigest !== digestWikiState(state)
  ) {
    fail(
      WIKI_LEDGER_CORRUPT_CODE,
      "Wiki revision identity or state binding is invalid",
    );
  }
  if (
    hasRequest &&
    !(
      payload.maintenanceRequestId === null &&
      payload.maintenanceRequestDigest === null
    ) &&
    (!DIGEST.test(payload.maintenanceRequestDigest ?? "") ||
      payload.maintenanceRequestId !==
        `wiki-maintenance:${payload.maintenanceRequestDigest.slice(7)}`)
  ) {
    fail(
      WIKI_LEDGER_CORRUPT_CODE,
      "Wiki maintenance request binding is invalid",
    );
  }
  return revision;
}

export function verifyWikiRequestTransition(previousState, revision) {
  const requests = revision.state.maintenanceRequests ?? {};
  const previous = previousState.maintenanceRequests ?? {};
  const requestId = revision.maintenanceRequestId ?? null;
  if (
    !requests ||
    typeof requests !== "object" ||
    Array.isArray(requests) ||
    (requestId && Object.hasOwn(previous, requestId))
  ) {
    fail(
      WIKI_LEDGER_CORRUPT_CODE,
      "Wiki maintenance request is duplicated or invalid",
    );
  }
  const expected = { ...previous };
  if (requestId)
    expected[requestId] = {
      requestDigest: revision.maintenanceRequestDigest,
      evidenceRefs: revision.evidenceRefs,
      effectiveAt: revision.effectiveAt,
      operationDigest: revision.operationDigest,
      revision: revision.revision,
      revisionId: revision.revisionId,
    };
  if (digestWikiState(requests) !== digestWikiState(expected)) {
    fail(
      WIKI_LEDGER_CORRUPT_CODE,
      "Wiki maintenance request history was substituted",
    );
  }
}
