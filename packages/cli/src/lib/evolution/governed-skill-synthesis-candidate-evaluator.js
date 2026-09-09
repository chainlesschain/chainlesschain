import { types as utilTypes } from "node:util";

import {
  assertEvolutionContentContainsNoKnownSecrets,
  inspectEvolutionContentInjectionRisks,
} from "./evolution-evidence-projector.js";

const EVALUATORS = new WeakSet();
const OPTIONS = new Set(["maxContentBytes"]);
const REQUIRED_SECTIONS = Object.freeze([
  "## Procedure",
  "## Pitfalls",
  "## Verification",
  "## Metadata",
]);

function reject(reason) {
  return Object.freeze({ accepted: false, reason });
}

/**
 * Deterministic first-pass evaluator for generated learning candidates.
 * It is intentionally not an Eval Gate or an independent model grader.
 */
export function createGovernedSkillSynthesisCandidateEvaluator(options = {}) {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    utilTypes.isProxy(options) ||
    Reflect.ownKeys(options).some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(options, key);
      return (
        typeof key !== "string" ||
        !OPTIONS.has(key) ||
        !descriptor ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      );
    })
  ) {
    throw new TypeError("learning synthesis evaluator options are invalid");
  }
  const maxContentBytes = options.maxContentBytes ?? 128 * 1024;
  if (
    !Number.isSafeInteger(maxContentBytes) ||
    maxContentBytes < 1_024 ||
    maxContentBytes > 1024 * 1024
  ) {
    throw new TypeError(
      "learning synthesis evaluator maxContentBytes is invalid",
    );
  }

  const evaluator = async (request = {}) => {
    if (
      !request ||
      typeof request !== "object" ||
      Array.isArray(request) ||
      utilTypes.isProxy(request)
    ) {
      return reject("candidate-evaluation-request-invalid");
    }
    const requestDescriptors = Object.getOwnPropertyDescriptors(request);
    if (
      ["skillName", "content", "pattern", "trajectory"].some(
        (key) =>
          !requestDescriptors[key] ||
          !("value" in requestDescriptors[key]) ||
          !requestDescriptors[key].enumerable,
      )
    ) {
      return reject("candidate-evaluation-request-invalid");
    }
    const skillName = requestDescriptors.skillName.value;
    const content = requestDescriptors.content.value;
    const pattern = requestDescriptors.pattern.value;
    const trajectory = requestDescriptors.trajectory.value;
    if (
      typeof skillName !== "string" ||
      !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(skillName)
    ) {
      return reject("skill-name-invalid");
    }
    if (
      typeof content !== "string" ||
      content.length === 0 ||
      Buffer.byteLength(content, "utf8") > maxContentBytes
    ) {
      return reject("candidate-content-invalid-or-oversized");
    }
    if (
      !pattern ||
      typeof pattern !== "object" ||
      Array.isArray(pattern) ||
      utilTypes.isProxy(pattern) ||
      pattern.name !== skillName
    ) {
      return reject("pattern-identity-mismatch");
    }
    if (
      !trajectory ||
      typeof trajectory !== "object" ||
      !Array.isArray(trajectory.toolChain)
    ) {
      return reject("trajectory-evidence-invalid");
    }
    if (
      !content.startsWith("---\n") ||
      !content.includes(`\nname: ${skillName}\n`) ||
      REQUIRED_SECTIONS.some((section) => !content.includes(section))
    ) {
      return reject("candidate-schema-incomplete");
    }
    const observedTools = new Set(
      trajectory.toolChain
        .map((step) => step?.tool)
        .filter((tool) => typeof tool === "string" && tool.length > 0),
    );
    if (
      !Array.isArray(pattern.tools) ||
      pattern.tools.length === 0 ||
      pattern.tools.some((tool) => !observedTools.has(tool))
    ) {
      return reject("candidate-tools-not-grounded-in-trajectory");
    }
    try {
      assertEvolutionContentContainsNoKnownSecrets(content);
    } catch {
      return reject("candidate-secret-or-pii-detected");
    }
    if (inspectEvolutionContentInjectionRisks(content).length > 0) {
      return reject("candidate-prompt-injection-detected");
    }
    return Object.freeze({
      accepted: true,
      reason: "deterministic-precheck-passed",
    });
  };
  Object.freeze(evaluator);
  EVALUATORS.add(evaluator);
  return evaluator;
}

export function isGovernedSkillSynthesisCandidateEvaluator(value) {
  return EVALUATORS.has(value);
}
