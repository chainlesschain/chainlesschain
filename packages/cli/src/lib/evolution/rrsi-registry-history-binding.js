/** Genuine storage graph binding; origin cutover and promotion remain separate. */
import { isProxy } from "node:util/types";
import {
  captureEvolutionLedgerFileBackend,
  captureEvolutionLedgerFileBackendBinding,
} from "./evolution-ledger-file-backend.js";
import { captureEvolutionLedgerArtifactResolverBinding } from "./evolution-artifact-ports.js";
import { captureSkillReleaseOperationReader } from "./evolution-ledger-ports.js";
import { captureSkillReleaseRegistryReader } from "./skill-release-registry.js";
import { captureRrsiHistoryLedgerAdapter } from "./rrsi-history-ledger-adapter.js";
import { isEvolutionLedgerV2Journal } from "./evolution-ledger-v2-journal.js";
import { rrsiCanonical, rrsiEnvelope, rrsiFail } from "./rrsi-data.js";

export const RRSI_REGISTRY_HISTORY_BINDING_SCHEMA =
  "chainlesschain.rrsi-registry-history-binding/v1";
export const RRSI_REGISTRY_HISTORY_READBACK_SCHEMA =
  "chainlesschain.rrsi-registry-history-readback/v1";
const BINDINGS = new WeakMap();
function captureOptions(input) {
  const names = [
    "backend",
    "historyAdapter",
    "releaseRegistry",
    "transactionLedger",
  ];
  if (
    !input ||
    isProxy(input) ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Reflect.ownKeys(input).length !== names.length
  )
    rrsiFail("Registry History binding requires plain own composition fields");
  return Object.fromEntries(
    names.map((name) => {
      const field = Object.getOwnPropertyDescriptor(input, name);
      if (!field?.enumerable || !("value" in field))
        rrsiFail("Registry History binding cannot use accessors");
      return [name, field.value];
    }),
  );
}
function same(left, right, label) {
  if (rrsiCanonical(left) !== rrsiCanonical(right))
    rrsiFail(
      `Registry History ${label} differs`,
      "CC_RRSI_STORAGE_BINDING_DRIFT",
    );
}
function assertGraph(state) {
  const {
    backend,
    backendBinding,
    history,
    release,
    operations,
    resolver,
    ports,
  } = state;
  if (
    !backendBinding.matchesLedger(history.ledger) ||
    backend.ledger !== history.ledger ||
    !operations.matchesLedger(backend.ledger)
  )
    rrsiFail(
      "Registry transaction ports and History require the same genuine backend journal",
    );
  if (!release.matchesTransactionLedger(ports.transactionLedger))
    rrsiFail("Registry uses another transaction port instance");
  if (
    !operations.matchesArtifactPorts(history.artifactPorts) ||
    !resolver.matchesArtifactPorts(history.artifactPorts) ||
    !backendBinding.matchesArtifactResolver(history.ledgerArtifactResolver)
  )
    rrsiFail(
      "Registry and History require the original backend artifact ports and resolver",
    );
  if (
    release.tenantId !== history.descriptor.tenantId ||
    resolver.tenantId !== history.descriptor.artifactTenantId ||
    resolver.audience !== history.descriptor.audience ||
    resolver.purpose !== history.descriptor.purpose
  )
    rrsiFail("Registry History tenant or artifact scope differs");
}
function readGraph(state) {
  assertGraph(state);
  for (let attempt = 0; attempt < 3; attempt++) {
    // v2 verify may legitimately recover a pending, already authorized WAL
    // suffix. Its complete retained readback still precedes this context.
    const before = state.operations.currentContext();
    const root = state.history.resolveCampaignRoot();
    // The genuine reader rechecks actual Registry directories and marker.
    // This does not authenticate a persistent origin policy or cutover yet.
    state.release.readState(state.history.descriptor.goalId);
    const after = state.operations.currentContext();
    if (rrsiCanonical(before) !== rrsiCanonical(after)) continue;
    for (const field of ["ledgerId", "identityDigest", "epoch"])
      if (root.identity[field] !== after.checkpoint[field])
        rrsiFail("Registry History root belongs to another journal");
    return { root, context: after };
  }
  rrsiFail(
    "Registry History changed repeatedly during binding",
    "CC_RRSI_STORAGE_BINDING_DRIFT",
  );
}

export function createRrsiRegistryHistoryBinding(input) {
  const ports = captureOptions(input),
    backend = captureEvolutionLedgerFileBackend(ports.backend);
  const state = {
    ports,
    backend,
    backendBinding: captureEvolutionLedgerFileBackendBinding(ports.backend),
    history: captureRrsiHistoryLedgerAdapter(ports.historyAdapter),
    release: captureSkillReleaseRegistryReader(ports.releaseRegistry),
    operations: captureSkillReleaseOperationReader(ports.transactionLedger),
  };
  state.resolver = captureEvolutionLedgerArtifactResolverBinding(
    state.history.ledgerArtifactResolver,
  );
  const { root } = readGraph(state);
  const descriptor = rrsiEnvelope(
    RRSI_REGISTRY_HISTORY_BINDING_SCHEMA,
    "registryHistoryBindingDigest",
    {
      tenantId: state.history.descriptor.tenantId,
      skillName: state.history.descriptor.goalId,
      artifactTenantId: state.history.descriptor.artifactTenantId,
      audience: state.history.descriptor.audience,
      purpose: state.history.descriptor.purpose,
      historyScopeId: state.history.descriptor.scopeId,
      ledgerIdentity: root.identity,
      journalKind: isEvolutionLedgerV2Journal(backend.ledger)
        ? "manifest-v2"
        : "file-v1",
      rootCampaignDigest: root.campaign.campaignDigest,
      parentReleaseDigest: root.campaign.parentReleaseDigest,
      anchorReleaseDigest: root.campaign.anchorReleaseDigest,
      rootRegistrationRecord: root.registrationRecord,
      transactionJournalObjectIdentityVerified: true,
      registryTransactionPortObjectIdentityVerified: true,
      artifactResolverObjectIdentityVerified: true,
      artifactPortsObjectIdentityVerified: true,
      registryBoundaryRechecked: true,
      registryStoreIdentityAuthenticated: false,
      originCutoverAuthenticated: false,
      originClassificationAvailable: false,
      productionAuthorityVerified: false,
      grantsMutationOrDispatchAuthority: false,
    },
  );
  const binding = Object.freeze({ descriptor });
  BINDINGS.set(binding, Object.freeze({ ...state, root }));
  return binding;
}

export function captureRrsiRegistryHistoryBinding(binding) {
  const state = BINDINGS.get(binding);
  if (!state) rrsiFail("a genuine Registry History binding is required");
  return Object.freeze({
    descriptor: binding.descriptor,
    matchesHistory: (historyAdapter) =>
      captureRrsiHistoryLedgerAdapter(historyAdapter) === state.history,
    matchesCapturedHistory: (history) => history === state.history,
    matchesReleaseRegistry: (registry) =>
      captureSkillReleaseRegistryReader(registry) === state.release,
    matchesTransactionLedger: (ledger) =>
      ledger === state.ports.transactionLedger,
  });
}

export function recheckRrsiRegistryHistoryBinding(binding) {
  const state = BINDINGS.get(binding);
  if (!state) rrsiFail("a genuine Registry History binding is required");
  const { root, context } = readGraph(state);
  same(root, state.root, "root registration");
  return rrsiEnvelope(
    RRSI_REGISTRY_HISTORY_READBACK_SCHEMA,
    "registryHistoryReadbackDigest",
    {
      registryHistoryBindingDigest:
        binding.descriptor.registryHistoryBindingDigest,
      ledgerIdentity: root.identity,
      currentHead: context.checkpoint,
      originalStorageGraphRechecked: true,
      registryBoundaryRechecked: true,
      originCutoverAuthenticated: false,
      originClassificationAvailable: false,
      atomicDispatchOrPromotionAuthorized: false,
    },
  );
}
