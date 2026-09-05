import { randomBytes } from "node:crypto";
import { types } from "node:util";
import { captureWorkbenchFileResources } from "./evolution-workbench-file-resources.js";
import { captureSkillCandidateRegistryReader } from "./skill-candidate-registry.js";
import { captureSkillReleaseRegistryReader } from "./skill-release-registry.js";
import { SkillPromotionController } from "./skill-promotion-controller.js";
import {
  SkillMutationAuthority,
  buildSkillMutationRequest,
  digestSkillMutationTransitionSubject,
} from "./skill-mutation-authority.js";
import { consumeWorkbenchRollbackMutationContext } from "./evolution-workbench-rollback-ledger-adapter.js";
import {
  capturePruningData as capture,
  pruningCanonical as canonical,
} from "./governed-wiki-pruning-journal.js";

const RECEIPTS = [
  "candidateReceipt",
  "evalReceipt",
  "actorReceipt",
  "parentReceipt",
  "targetReceipt",
];
const TTL_MS = 120_000;
function record(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value)
  )
    throw new TypeError(`${label} must be an own data record`);
  const fields = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(fields).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(fields, key))
  )
    throw new TypeError(`${label} has missing or replaced fields`);
  const output = {};
  for (const key of keys) {
    if (!Object.hasOwn(fields[key], "value") || !fields[key].enumerable)
      throw new TypeError(`${label}.${key} must be an own data field`);
    output[key] = fields[key].value;
  }
  return output;
}
function fixed(owner, name) {
  if (!owner || typeof owner !== "object" || types.isProxy(owner))
    throw new TypeError(`Workbench ${name} port is required`);
  const fn = Object.getOwnPropertyDescriptor(owner, name)?.value;
  if (typeof fn !== "function" || types.isProxy(fn))
    throw new TypeError(`Workbench ${name} fixed own method is required`);
  return Object.freeze({ [name]: fn.bind(owner) });
}
function same(a, b) {
  return canonical(a) === canonical(b);
}
function fail(message) {
  throw new Error(`Workbench mutation: ${message}`);
}

/**
 * Real same-Ledger mutation authority and a rollback-only controller surface.
 * External receipt sources supply artifacts; independent principal/receipt
 * verifiers decide authority. No identity, receipt, approval or key is invented.
 */
export function createEvolutionWorkbenchControlPorts(input) {
  const options = record(
    input,
    [
      "descriptor",
      "fileResources",
      "candidateRegistry",
      "principalResolver",
      "receiptVerifier",
      "rollbackReceiptSource",
    ],
    "Workbench control options",
  );
  const { runtimeResources: r, mutationPorts } = captureWorkbenchFileResources(
    options.fileResources,
  );
  const descriptor = capture(options.descriptor);
  if (!same(descriptor, r.descriptor))
    fail("descriptor differs from file resources");
  const candidate = captureSkillCandidateRegistryReader(
    options.candidateRegistry,
  );
  if (candidate.tenantId !== descriptor.tenantId)
    fail("candidate tenant differs");
  const primary = captureSkillReleaseRegistryReader(r.releaseRegistry);
  const verifier = captureSkillReleaseRegistryReader(r.verifierReleaseRegistry);
  const principalResolver = fixed(options.principalResolver, "resolve");
  const receiptVerifier = fixed(options.receiptVerifier, "verify");
  const receiptSource = fixed(options.rollbackReceiptSource, "resolve");
  if (
    options.rollbackReceiptSource === options.receiptVerifier ||
    options.rollbackReceiptSource.resolve === options.receiptVerifier.verify
  )
    fail("receipt source and verifier must be independent ports");
  const authority = new SkillMutationAuthority({
    principalResolver,
    receiptVerifier,
    ...mutationPorts,
    now: r.now,
  });
  const controller = new SkillPromotionController({
    candidateRegistry: options.candidateRegistry,
    releaseRegistry: r.releaseRegistry,
    authority,
  });

  function current(expected, deadline = expected.expiresAt) {
    if (Number(r.now()) >= Date.parse(deadline)) fail("authorization expired");
    const active = primary.readActive(descriptor.skillName);
    if (!active || !same(active, verifier.readActive(descriptor.skillName)))
      fail("independent active states differ");
    const target = primary.readRelease(expected.targetReleaseDigest);
    if (!same(target, verifier.readRelease(expected.targetReleaseDigest)))
      fail("independent target bytes differ");
    if (
      expected.tenantId !== descriptor.tenantId ||
      expected.skillName !== descriptor.skillName ||
      expected.operation !== "rollback" ||
      expected.targetScope !== "active" ||
      active.state.stateDigest !== expected.expectedActiveStateDigest ||
      active.state.revision !== expected.expectedTargetRevision ||
      active.release.releaseDigest !== expected.fromReleaseDigest ||
      active.release.contentDigest !== expected.expectedTargetDigest ||
      active.state.lastKnownGoodReleaseDigest !==
        expected.targetReleaseDigest ||
      target.tenantId !== descriptor.tenantId ||
      target.skillName !== descriptor.skillName ||
      target.dependencyLockDigest !== expected.dependencyLockDigest ||
      digestSkillMutationTransitionSubject({
        tenantId: descriptor.tenantId,
        skillName: descriptor.skillName,
        operation: "rollback",
        candidateId: null,
        rollbackTargetReleaseDigest: target.releaseDigest,
        dependencyLockDigest: target.dependencyLockDigest,
        expectedActiveContentDigest: active.release.contentDigest,
        expectedActiveRevision: active.state.revision,
      }) !== expected.transitionSubjectDigest
    )
      fail("current release no longer matches the exact prepared rollback");
  }

  const authorizationProvider = Object.freeze({
    async authorizeRollback(input) {
      const expected = consumeWorkbenchRollbackMutationContext(
        input,
        r.releaseRegistry,
        r.ledger,
        descriptor,
      );
      current(expected);
      const mutation = capture({
        tenantId: descriptor.tenantId,
        audience: descriptor.audience,
        operationId: expected.operationId,
        operation: "rollback",
        skillName: descriptor.skillName,
        targetScope: "active",
        expectedTargetDigest: expected.expectedTargetDigest,
        expectedTargetRevision: expected.expectedTargetRevision,
        transitionSubjectDigest: expected.transitionSubjectDigest,
        expiresAt: new Date(
          Math.min(Number(r.now()) + TTL_MS, Date.parse(expected.expiresAt)),
        ).toISOString(),
        nonce: randomBytes(32).toString("hex"),
      });
      const supplied = await receiptSource.resolve(
        capture({
          mutation,
          planDigest: expected.planDigest,
          authorizationReceiptDigest: expected.authorizationReceiptDigest,
          policyReceipt: expected.policyReceipt,
          fromReleaseDigest: expected.fromReleaseDigest,
          targetReleaseDigest: expected.targetReleaseDigest,
        }),
      );
      const receipts = record(
        supplied,
        RECEIPTS,
        "Workbench rollback receipt source",
      );
      const request = buildSkillMutationRequest({
        ...mutation,
        receipts: { ...receipts, policyReceipt: expected.policyReceipt },
      });
      current(expected, request.expiresAt);
      const capability = await authority.authorize(request);
      current(expected, request.expiresAt);
      return Object.freeze({ request, capability });
    },
  });
  return Object.freeze({
    rollbackProvider: controller.createRollbackProvider(),
    authorizationProvider,
  });
}
