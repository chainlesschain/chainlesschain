// TEST ONLY: real local files and retained v2 HMAC authorities, not production
// key custody, remote durability or origin admission.
import fs from "node:fs";
import path from "node:path";
import { openLedgerV2Fixture } from "./evolution-ledger-v2-store.js";
import { replicaAuthority } from "./skill-revocation-release-registry.js";
import { createEvolutionLedgerPorts } from "../../src/lib/evolution/evolution-ledger-ports.js";
import {
  SkillCandidateRegistry,
  SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_AUTHORITY_SCHEMA,
} from "../../src/lib/evolution/skill-candidate-registry.js";
import { SkillReleaseRegistry } from "../../src/lib/evolution/skill-release-registry.js";
import { createRrsiRegistryStorePolicy } from "../../src/lib/evolution/rrsi-registry-store-policy.js";
import { repairPrivatePath } from "../../src/lib/secure-fs.js";

export const scope = {
  tenantId: "tenant-a",
  artifactTenantId: "artifact-tenant-a-release",
  audience: "evolution-runtime",
};
export const operationId = "test:registry:read-only";
export function openFixture(root) {
  const store = openLedgerV2Fixture(path.join(root, "store"), scope);
  const policy = createRrsiRegistryStorePolicy({
    backend: store.backend,
    artifactPorts: store.artifactPorts,
    ledgerArtifactResolver: store.resolver,
    descriptor: { ...scope, purpose: "evolution-ledger" },
  });
  const ports = createEvolutionLedgerPorts({
    artifactPorts: store.artifactPorts,
    ledger: store.journal,
    artifactTenantId: scope.artifactTenantId,
    audience: scope.audience,
    artifactDurabilityAuthority: replicaAuthority(
      path.join(root, "release-replica"),
    ),
  });
  return { root, store, policy, ports };
}
export function provisionFixture(fixture) {
  const parentDir = path.join(fixture.root, "provisioned");
  fs.mkdirSync(parentDir, { mode: 0o700 });
  repairPrivatePath(parentDir);
  return fixture.policy.provisionFresh({ parentDir, operationId });
}
export function bindFixture(fixture) {
  return Object.fromEntries(
    ["candidate", "release"].map((component) => [
      component,
      fixture.policy.bindComponent({ operationId, component }),
    ]),
  );
}
export function candidateOptions(binding) {
  return {
    tenantId: scope.tenantId,
    rootDir: binding.descriptor.baseDir,
    storePolicyBinding: binding,
    targetMatrixAdmissionAuthority: {
      schema: SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_AUTHORITY_SCHEMA,
      trust: "trusted",
      authorityId: "test-only:read-only",
      revision: 1,
      handlerArtifactDigest: `sha256:${"a".repeat(64)}`,
      resolve() {
        throw new Error(
          "TEST ONLY admission must not be reached before origin admission",
        );
      },
    },
  };
}
export function releaseOptions(binding, ports) {
  return {
    tenantId: scope.tenantId,
    rootDir: binding.descriptor.baseDir,
    storePolicyBinding: binding,
    transactionLedger: ports.transactionLedger,
  };
}
export function openRegistries(bindings, ports) {
  return {
    candidate: new SkillCandidateRegistry(candidateOptions(bindings.candidate)),
    release: new SkillReleaseRegistry(releaseOptions(bindings.release, ports)),
  };
}
