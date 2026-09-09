import { isAbsolute } from "node:path";
import { types as utilTypes } from "node:util";

import { SkillSynthesizer } from "../learning/skill-synthesizer.js";

const HOSTS = new WeakSet();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function callable(value, label) {
  if (typeof value !== "function" || utilTypes.isProxy(value)) {
    throw new TypeError(`${label} must be a callable deployment port`);
  }
  return value;
}

function absolutePath(value, label) {
  if (typeof value !== "string" || !isAbsolute(value)) {
    throw new TypeError(`${label} must be an absolute path`);
  }
  return value;
}

function descriptor(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    typeof value.tenantId !== "string" ||
    value.tenantId.trim() === "" ||
    !DIGEST.test(value.handlerArtifactDigest ?? "")
  ) {
    throw new TypeError("learning synthesis deployment descriptor is invalid");
  }
  return Object.freeze({
    tenantId: value.tenantId,
    handlerArtifactDigest: value.handlerArtifactDigest,
  });
}

export function createGovernedSkillSynthesisCliHost({
  descriptor: descriptorInput,
  llmChat: llmChatInput,
  candidateOutputDir: candidateOutputDirInput,
  activeSkillsDirs: activeSkillsDirsInput,
  evaluateCandidate: evaluateCandidateInput,
  synthesis = {},
} = {}) {
  const deployment = descriptor(descriptorInput);
  const llmChat = callable(llmChatInput, "learning synthesis llmChat");
  const evaluateCandidate = callable(
    evaluateCandidateInput,
    "learning synthesis evaluator",
  );
  const candidateOutputDir = absolutePath(
    candidateOutputDirInput,
    "learning synthesis candidateOutputDir",
  );
  if (
    !Array.isArray(activeSkillsDirsInput) ||
    activeSkillsDirsInput.length === 0
  ) {
    throw new TypeError("learning synthesis activeSkillsDirs are required");
  }
  const activeSkillsDirs = Object.freeze(
    activeSkillsDirsInput.map((value) =>
      absolutePath(value, "learning synthesis activeSkillsDirs entry"),
    ),
  );
  if (
    !synthesis ||
    typeof synthesis !== "object" ||
    Array.isArray(synthesis) ||
    utilTypes.isProxy(synthesis)
  ) {
    throw new TypeError("learning synthesis configuration is invalid");
  }
  const allowedConfigKeys = new Set(["minToolCount", "minScore", "minSimilar"]);
  if (Reflect.ownKeys(synthesis).some((key) => !allowedConfigKeys.has(key))) {
    throw new TypeError("learning synthesis configuration has unknown fields");
  }
  const config = Object.freeze({ ...synthesis });

  const host = Object.freeze({
    descriptor: deployment,
    async synthesize({ db, trajectoryStore } = {}) {
      if (!db || typeof db.prepare !== "function") {
        throw new TypeError("learning synthesis database is required");
      }
      if (
        !trajectoryStore ||
        typeof trajectoryStore.findComplexUnprocessed !== "function" ||
        typeof trajectoryStore.findSimilar !== "function" ||
        typeof trajectoryStore.markSynthesized !== "function"
      ) {
        throw new TypeError("learning synthesis trajectory store is required");
      }
      const synthesizer = new SkillSynthesizer(db, llmChat, trajectoryStore, {
        ...config,
        candidateOutputDir,
        activeSkillsDirs,
        evaluateCandidate,
      });
      return synthesizer.synthesize();
    },
  });
  HOSTS.add(host);
  return host;
}

export function isGovernedSkillSynthesisCliHost(value) {
  return HOSTS.has(value);
}
