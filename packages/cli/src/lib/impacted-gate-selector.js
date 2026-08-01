/**
 * Conservative impacted-gate selection.
 *
 * This module never executes a gate. It turns an analyzer's evidence into a
 * versioned, machine-readable selection. The optimization is intentionally
 * one-way: only a complete/high-confidence analysis may reduce the project
 * required gate set. Every unknown signal falls back to every required gate.
 */

import crypto from "node:crypto";

export const IMPACTED_GATE_SELECTION_SCHEMA =
  "chainlesschain.impacted-gate-selection";
export const IMPACTED_GATE_SELECTION_VERSION = 1;
export const DEFAULT_IMPACT_CONFIDENCE_THRESHOLD = 0.8;

export const DEFAULT_SUPPORTED_LANGUAGES = Object.freeze([
  "c",
  "cpp",
  "csharp",
  "css",
  "dart",
  "documentation",
  "go",
  "html",
  "java",
  "javascript",
  "json",
  "kotlin",
  "objective-c",
  "php",
  "python",
  "ruby",
  "rust",
  "shell",
  "swift",
  "typescript",
  "vue",
  "xml",
  "yaml",
]);

export const DEFAULT_SUPPORTED_ECOSYSTEMS = Object.freeze([
  "android-gradle",
  "cargo",
  "dotnet",
  "flutter",
  "generic",
  "go-modules",
  "gradle",
  "maven",
  "npm",
  "pip",
  "ruby-bundler",
  "swift-package-manager",
]);

const BUILD_BOUNDARY_RE =
  /(^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|pom\.xml|settings\.gradle(?:\.kts)?|build\.gradle(?:\.kts)?|gradle\.properties|gradle-wrapper\.properties|Cargo\.(?:toml|lock)|go\.(?:mod|sum|work)|pyproject\.toml|poetry\.lock|requirements[^/]*\.txt|Pipfile(?:\.lock)?|Gemfile(?:\.lock)?|Package\.swift|Podfile(?:\.lock)?|[^/]+\.(?:csproj|fsproj|vbproj|sln)|Dockerfile|Makefile)$/i;

const WORKFLOW_BOUNDARY_RE = /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i;

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function digest(value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(canonicalJson(value))
    .digest("hex")}`;
}

function normalizePath(value) {
  return String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/\/{2,}/g, "/")
    .trim();
}

function uniqueStrings(values, normalizer = (value) => String(value).trim()) {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(values.map(normalizer).filter((value) => value.length > 0)),
  ].sort();
}

function normalizeGate(gate) {
  if (typeof gate === "string") {
    return {
      id: gate.trim(),
      always: true,
      selectors: { paths: [], languages: [], ecosystems: [] },
    };
  }
  const selectors = gate?.selectors || {};
  return {
    id: String(gate?.id || "").trim(),
    always: gate?.always === true,
    selectors: {
      paths: uniqueStrings(selectors.paths, normalizePath),
      languages: uniqueStrings(selectors.languages, (value) =>
        String(value).trim().toLowerCase(),
      ),
      ecosystems: uniqueStrings(selectors.ecosystems, (value) =>
        String(value).trim().toLowerCase(),
      ),
    },
  };
}

function globToRegExp(pattern) {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        index += 1;
        if (pattern[index + 1] === "/") {
          index += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`);
}

function gateMatches(gate, context) {
  const { paths, languages, ecosystems } = gate.selectors;
  const hasSelectors =
    paths.length > 0 || languages.length > 0 || ecosystems.length > 0;
  // A required gate without a proven impact selector cannot safely be skipped.
  if (gate.always || !hasSelectors) return true;
  if (
    paths.some((pattern) => {
      try {
        const matcher = globToRegExp(pattern);
        return context.changedFiles.some((file) => matcher.test(file));
      } catch {
        return true;
      }
    })
  ) {
    return true;
  }
  if (languages.some((language) => context.languages.has(language))) {
    return true;
  }
  return ecosystems.some((ecosystem) => context.ecosystems.has(ecosystem));
}

function selectionResult({
  mode,
  reason,
  reasons,
  confidence,
  changedFiles,
  requiredGateIds,
  selectedGateIds,
  analysisMaterial,
}) {
  return deepFreeze({
    schema: IMPACTED_GATE_SELECTION_SCHEMA,
    version: IMPACTED_GATE_SELECTION_VERSION,
    decision: mode === "blocked" ? "blocked" : "selected",
    mode,
    fallback: mode === "full",
    reason,
    reasons,
    confidence,
    changedFiles,
    requiredGateIds,
    selectedGateIds,
    unverified: reasons,
    analysisDigest: digest(analysisMaterial),
  });
}

/**
 * Select the smallest *proven safe* subset of project-required gates.
 *
 * Expected analyzer evidence:
 *   analysis: {
 *     confidence,
 *     dependencyGraphComplete,
 *     languageServicesComplete,
 *     testHistoryComplete,
 *     classifications: [{path, language, ecosystem, confidence}],
 *     impactedGateIds?: []
 *   }
 *
 * Any omitted/unknown field causes a full fallback. An empty/invalid project
 * required-gate definition is blocked because there is no safe suite to run.
 */
export function selectImpactedGates(input = {}) {
  const changedFiles = uniqueStrings(input.changedFiles, normalizePath);
  const requiredGates = Array.isArray(input.requiredGates)
    ? input.requiredGates.map(normalizeGate)
    : [];
  const requiredGateIds = requiredGates.map((gate) => gate.id);
  const analysis =
    input.analysis && typeof input.analysis === "object" ? input.analysis : {};
  const threshold = Number.isFinite(Number(input.confidenceThreshold))
    ? Math.min(1, Math.max(0, Number(input.confidenceThreshold)))
    : DEFAULT_IMPACT_CONFIDENCE_THRESHOLD;
  const confidence = Number.isFinite(Number(analysis.confidence))
    ? Number(analysis.confidence)
    : null;
  const analysisMaterial = {
    changedFiles,
    requiredGates,
    threshold,
    analysis,
  };

  const invalidGateIds = requiredGateIds.filter((id) => !id);
  const duplicateGateIds = requiredGateIds.filter(
    (id, index) => requiredGateIds.indexOf(id) !== index,
  );
  if (
    requiredGateIds.length === 0 ||
    invalidGateIds.length > 0 ||
    duplicateGateIds.length > 0
  ) {
    const reason =
      requiredGateIds.length === 0
        ? "required-gates-undefined"
        : invalidGateIds.length > 0
          ? "required-gate-id-invalid"
          : "required-gate-id-duplicate";
    return selectionResult({
      mode: "blocked",
      reason,
      reasons: [reason],
      confidence,
      changedFiles,
      requiredGateIds,
      selectedGateIds: [],
      analysisMaterial,
    });
  }

  const reasons = [];
  if (changedFiles.length === 0) reasons.push("changed-files-unverified");
  if (confidence === null || confidence < threshold) {
    reasons.push("confidence-insufficient");
  }
  if (analysis.dependencyGraphComplete !== true) {
    reasons.push("dependency-graph-incomplete");
  }
  if (analysis.languageServicesComplete !== true) {
    reasons.push("language-services-incomplete");
  }
  if (analysis.testHistoryComplete !== true) {
    reasons.push("test-history-incomplete");
  }
  if (
    changedFiles.some(
      (file) => BUILD_BOUNDARY_RE.test(file) || WORKFLOW_BOUNDARY_RE.test(file),
    )
  ) {
    reasons.push("build-or-workflow-boundary-changed");
  }

  const classifications = Array.isArray(analysis.classifications)
    ? analysis.classifications.map((item) => ({
        path: normalizePath(item?.path),
        language: String(item?.language || "")
          .trim()
          .toLowerCase(),
        ecosystem: String(item?.ecosystem || "")
          .trim()
          .toLowerCase(),
        confidence: Number.isFinite(Number(item?.confidence))
          ? Number(item.confidence)
          : null,
      }))
    : [];
  const byPath = new Map(classifications.map((item) => [item.path, item]));
  const supportedLanguages = new Set([
    ...DEFAULT_SUPPORTED_LANGUAGES,
    ...uniqueStrings(input.supportedLanguages, (value) =>
      String(value).trim().toLowerCase(),
    ),
  ]);
  const supportedEcosystems = new Set([
    ...DEFAULT_SUPPORTED_ECOSYSTEMS,
    ...uniqueStrings(input.supportedEcosystems, (value) =>
      String(value).trim().toLowerCase(),
    ),
  ]);
  for (const gate of requiredGates) {
    for (const language of gate.selectors.languages) {
      if (!supportedLanguages.has(language)) {
        reasons.push(`gate-selector-language-unknown:${gate.id}:${language}`);
      }
    }
    for (const ecosystem of gate.selectors.ecosystems) {
      if (!supportedEcosystems.has(ecosystem)) {
        reasons.push(`gate-selector-ecosystem-unknown:${gate.id}:${ecosystem}`);
      }
    }
  }
  const classificationPathCounts = new Map();
  for (const classification of classifications) {
    classificationPathCounts.set(
      classification.path,
      (classificationPathCounts.get(classification.path) || 0) + 1,
    );
  }
  for (const [classificationPath, count] of classificationPathCounts) {
    if (count > 1) {
      reasons.push(`classification-ambiguous:${classificationPath || "empty"}`);
    }
  }
  const languages = new Set();
  const ecosystems = new Set();
  for (const file of changedFiles) {
    const classification = byPath.get(file);
    if (!classification) {
      reasons.push(`classification-missing:${file}`);
      continue;
    }
    if (
      classification.confidence === null ||
      classification.confidence < threshold
    ) {
      reasons.push(`classification-confidence-insufficient:${file}`);
    }
    if (!supportedLanguages.has(classification.language)) {
      reasons.push(`language-unknown:${classification.language || file}`);
    } else {
      languages.add(classification.language);
    }
    if (!supportedEcosystems.has(classification.ecosystem)) {
      reasons.push(`ecosystem-unknown:${classification.ecosystem || file}`);
    } else {
      ecosystems.add(classification.ecosystem);
    }
  }

  const explicitImpacted = analysis.impactedGateIds;
  if (explicitImpacted != null && !Array.isArray(explicitImpacted)) {
    reasons.push("impacted-gate-ids-invalid");
  }
  const explicitIds = uniqueStrings(explicitImpacted);
  for (const id of explicitIds) {
    if (!requiredGateIds.includes(id)) {
      reasons.push(`impacted-gate-unknown:${id}`);
    }
  }

  const uniqueReasons = [...new Set(reasons)];
  if (uniqueReasons.length > 0) {
    return selectionResult({
      mode: "full",
      reason: uniqueReasons[0],
      reasons: uniqueReasons,
      confidence,
      changedFiles,
      requiredGateIds,
      selectedGateIds: [...requiredGateIds],
      analysisMaterial,
    });
  }

  const selected = new Set(
    requiredGates
      .filter((gate) =>
        gateMatches(gate, { changedFiles, languages, ecosystems }),
      )
      .map((gate) => gate.id),
  );
  for (const id of explicitIds) selected.add(id);
  if (selected.size === 0) {
    return selectionResult({
      mode: "full",
      reason: "no-gate-impact-proven",
      reasons: ["no-gate-impact-proven"],
      confidence,
      changedFiles,
      requiredGateIds,
      selectedGateIds: [...requiredGateIds],
      analysisMaterial,
    });
  }

  return selectionResult({
    mode: "impacted",
    reason: "impact-analysis-complete",
    reasons: [],
    confidence,
    changedFiles,
    requiredGateIds,
    selectedGateIds: requiredGateIds.filter((id) => selected.has(id)),
    analysisMaterial,
  });
}
