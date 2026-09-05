import fs from "node:fs";
import { join } from "node:path";
import { createGovernedSkillMarketplaceCandidateInstaller } from "../../../src/lib/evolution/governed-skill-marketplace-candidate.js";
import {
  SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_AUTHORITY_SCHEMA,
  SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_RESOLUTION_SCHEMA,
} from "../../../src/lib/evolution/skill-candidate-registry.js";

// Test-only admission and artifact source; candidate storage is the actual registry.
const [root, operation] = process.argv.slice(2);
const input = JSON.parse(
  fs.readFileSync(join(root, "candidate-worker-input.json"), "utf8"),
);
const descriptor = {
  schema: SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_AUTHORITY_SCHEMA,
  authorityId: "authority:marketplace-worker-test",
  trust: "trusted",
  revision: 1,
  handlerArtifactDigest: input.inspected.manifest.sourceCommitDigest,
};
const candidate = input.candidate;
const installer = createGovernedSkillMarketplaceCandidateInstaller({
  tenantId: candidate.tenantId,
  registryOptions: {
    rootDir: join(root, "marketplace-candidates"),
    secure: false,
    targetMatrixAdmissionAuthority: {
      ...descriptor,
      resolve(request) {
        if (
          request.tenantId !== candidate.tenantId ||
          request.skillName !== candidate.skillName ||
          request.proposedTargetMatrixRoot !== candidate.targetMatrixRoot ||
          request.dependencyLockDigest !== candidate.dependencyLockDigest ||
          request.runtimeManifestDigest !== candidate.runtimeManifestDigest
        )
          return false;
        return {
          ...descriptor,
          schema: SKILL_CANDIDATE_TARGET_MATRIX_ADMISSION_RESOLUTION_SCHEMA,
          admitted: true,
          tenantId: candidate.tenantId,
          skillName: candidate.skillName,
          dependencyLockDigest: candidate.dependencyLockDigest,
          runtimeManifestDigest: candidate.runtimeManifestDigest,
          expectedTargetMatrixRoot: candidate.targetMatrixRoot,
          expectedEnvironmentBindings: candidate.targetMatrix.cells,
        };
      },
    },
  },
  artifacts: {
    resolve: async () =>
      Object.fromEntries(
        ["packageBytes", "adaptedBytes", "sbomBytes"].map((key) => [
          key,
          Buffer.from(input[key], "base64"),
        ]),
      ),
  },
});
if (operation === "materialize-crash") {
  await installer.materialize(input.inspected);
  process.exit(97);
} else if (operation === "verify") {
  fs.writeSync(1, JSON.stringify(installer.verify(input.state)));
} else {
  throw new Error("unknown marketplace candidate worker operation");
}
