import path from "node:path";
import { openEvolutionDurableStore } from "./evolution-durable-store.js";
import { replicaAuthority } from "./skill-revocation-release-registry.js";
import { createEvolutionLedgerPorts } from "../../src/lib/evolution/evolution-ledger-ports.js";
import { SkillReleaseRegistry } from "../../src/lib/evolution/skill-release-registry.js";
import { createEvolutionWorkbenchRegistrySource } from "../../src/lib/evolution/evolution-workbench-registry-source.js";

export function openEmptyWorkbenchRegistry(root, owner) {
  const descriptor = owner.shared.descriptor;
  const verifierStore = openEvolutionDurableStore(root, {
    tenantId: descriptor.tenantId,
    streamId: descriptor.streamId,
  });
  const readers = [owner, verifierStore].map((store) => {
    const { transactionLedger } = createEvolutionLedgerPorts({
      artifactPorts: store.artifactPorts,
      artifactTenantId: descriptor.artifactTenantId,
      audience: "evolution-runtime",
      ledger: store.backend.ledger,
      artifactDurabilityAuthority: replicaAuthority(
        path.join(root, "empty-registry-replica"),
      ),
    });
    const releaseRegistry = new SkillReleaseRegistry({
      tenantId: descriptor.tenantId,
      rootDir: path.join(root, "empty-registry"),
      transactionLedger,
      fsImpl: store.fsImpl,
      secure: false,
    });
    return { transactionLedger, releaseRegistry };
  });
  const registryOptions = {
    ...owner.shared,
    ...readers[0],
    verifierLedger: verifierStore.backend.ledger,
    verifierLedgerArtifactResolver: verifierStore.resolver,
    verifierReleaseRegistry: readers[1].releaseRegistry,
    verifierTransactionLedger: readers[1].transactionLedger,
  };
  return {
    registryOptions,
    registrySource: createEvolutionWorkbenchRegistrySource(registryOptions),
  };
}
