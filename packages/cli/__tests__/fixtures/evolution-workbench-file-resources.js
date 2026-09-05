import path from "node:path";
import { evolutionDurableStoreConfiguration } from "./evolution-durable-store.js";
import { replicaAuthority } from "./skill-revocation-release-registry.js";

// Explicit TEST authorities only. This builds configuration, not a Ledger,
// ArtifactStore, Registry or host; production file resources open those.
export function workbenchFileResourceOptions(root, descriptor) {
  const config = evolutionDurableStoreConfiguration(root, descriptor);
  return {
    descriptor: { ...config.descriptor, ...descriptor },
    storage: {
      artifactDir: path.join(root, "artifacts"),
      ledgerRootDir: path.join(root, "events"),
      ledgerAuthorityRootDir: path.join(root, "authority"),
      witnessFilePath: path.join(root, "witness", "checkpoint.json"),
      witnessId: "pruning-test-witness",
      releaseRootDir: path.join(root, "skill-releases"),
    },
    authorities: {
      artifact: config.artifactAuthority,
      ledger: config.ledgerAuthority,
      witness: config.witnessAuthority,
      releaseDurability: replicaAuthority(path.join(root, "release-replica")),
    },
    fsImpl: config.fsImpl,
    secure: false,
    now: config.clock,
  };
}
