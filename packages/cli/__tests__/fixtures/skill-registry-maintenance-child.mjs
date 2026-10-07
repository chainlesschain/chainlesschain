/** Real Registry process/control fixtures; no production identities or models. */
import path from "node:path";
import { openEvolutionDurableStore } from "./evolution-durable-store.js";
import { openRevocationReleaseRegistry } from "./skill-revocation-release-registry.js";
import { withSkillRegistryMaintenance } from "../../src/lib/evolution/skill-registry-maintenance.js";

const [root, mode] = process.argv.slice(2);
const scope = {
  tenantId: "tenant-a",
  artifactTenantId: "artifact-tenant-a-release",
  audience: "evolution-runtime",
};
const storage = openEvolutionDurableStore(path.join(root, "store"), scope);
const value = await openRevocationReleaseRegistry({
  root,
  storage: { ...storage, now: storage.clock() },
  fsImpl: storage.fsImpl,
  tenantId: scope.tenantId,
  artifactTenantId: scope.artifactTenantId,
});
const input = {
  candidateRegistry: value.candidateRegistry,
  releaseRegistry: value.pruningRollbackOptions.releaseRegistry,
};
if (mode === "maintenance-owner") {
  // A pending Promise alone does not keep a forked child alive. Keep its real
  // IPC channel referenced until the test terminates this maintenance owner.
  process.on("message", () => {});
  await withSkillRegistryMaintenance(input, async (context) => {
    process.send({ ready: true, descriptor: context.descriptor });
    await new Promise(() => {});
  });
} else if (mode === "cached-writer") {
  process.on("message", async ({ id, command }) => {
    try {
      if (command === "candidate") {
        const candidate = value.createDerivedCandidate();
        process.send({ id, ok: true, candidateId: candidate.candidateId });
      } else if (command === "rollback") {
        const result = await value.rollbackTo(
          value.baseline.releaseDigest,
          `test:child:rollback:${id}`,
        );
        process.send({ id, ok: true, revision: result.state.revision });
      } else if (command === "exit") {
        process.exit(0);
      } else throw new Error("unknown test command");
    } catch (error) {
      process.send({ id, ok: false, code: error.code });
    }
  });
  process.send({ ready: true });
} else throw new Error("unknown test mode");
