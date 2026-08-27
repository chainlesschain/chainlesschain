import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GRAPH_AUTHORITY_MODES,
  GRAPH_CUTOVER_STAGES,
  GRAPH_PROJECTION_VERSION,
} from "./authority.js";
import {
  GRAPH_CUTOVER_LEDGER_SCHEMA,
  GRAPH_CUTOVER_REQUIRED_PLATFORMS,
} from "./cutover-ledger.js";
import { graphDigest } from "./compiler.js";

export const GRAPH_RUNTIME_SURFACE_MANIFEST_SCHEMA =
  "chainlesschain.graph-runtime-surfaces/v1";
export const GRAPH_RUNTIME_DURABILITY = Object.freeze([
  "durable",
  "process_local",
  "non_durable",
]);
export const GRAPH_CUTOVER_STRATEGIES = Object.freeze([
  "migrate",
  "retire",
  "disabled",
]);
export const GRAPH_RUNTIME_CANDIDATE_CLASSIFICATIONS = Object.freeze([
  "canonical_agent_kernel_adapter",
  "tool_free_advisor",
  "durable_event_transport",
]);
export const GRAPH_RUNTIME_SURFACE_MANIFEST_PATH = fileURLToPath(
  new URL("./graph-runtime-surfaces.json", import.meta.url),
);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function walkJavaScriptFiles(directory, output = []) {
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__") continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walkJavaScriptFiles(target, output);
    else if (/\.(?:cjs|mjs|js)$/u.test(entry.name)) output.push(target);
  }
  return output;
}

export function loadGraphRuntimeSurfaceManifest(
  manifestPath = GRAPH_RUNTIME_SURFACE_MANIFEST_PATH,
) {
  return Object.freeze(
    JSON.parse(fs.readFileSync(path.resolve(manifestPath), "utf8")),
  );
}

export function graphRuntimeSurfaceEntry(manifest, surfaceName, entryId) {
  const surface = (manifest?.surfaces || []).find(
    (candidate) => candidate.originSurface === surfaceName,
  );
  const entry = (surface?.entries || []).find(
    (candidate) => candidate.id === entryId,
  );
  if (!surface || !entry) {
    const error = new Error(
      `Graph runtime entry is not declared: ${surfaceName}/${entryId}`,
    );
    error.name = "GraphRuntimeSurfaceManifestError";
    error.code = "CC_GRAPH_RUNTIME_ENTRY_NOT_DECLARED";
    error.surface = String(surfaceName || "");
    error.entryId = String(entryId || "");
    throw error;
  }
  return Object.freeze({
    surface: Object.freeze(clone(surface)),
    entry: Object.freeze(clone(entry)),
  });
}

export function graphRuntimeEntryManifestDigest(
  manifest,
  surfaceName,
  entryId,
) {
  const { surface, entry } = graphRuntimeSurfaceEntry(
    manifest,
    surfaceName,
    entryId,
  );
  return graphDigest(
    {
      manifestSchema: manifest.schema,
      manifestVersion: manifest.version,
      projectionVersion: manifest.projectionVersion,
      cutoverPolicy: manifest.cutoverPolicy,
      surface: {
        originSurface: surface.originSurface,
        durability: surface.durability,
        targetAuthoritySource: surface.targetAuthoritySource,
        featureFlag: surface.featureFlag,
      },
      entry,
    },
    "cc.graph.runtime-surface-entry/v1",
  );
}

function manifestFiles(manifest) {
  return new Set([
    ...manifest.surfaces.flatMap((surface) =>
      surface.entries.flatMap((entry) => [
        ...entry.entrypoints,
        ...entry.writerFiles,
      ]),
    ),
    ...(manifest.discovery?.classifiedNonWriters || []).flatMap(
      (candidate) => candidate.files || [],
    ),
  ]);
}

export function discoverUnclassifiedRuntimeWriters(
  manifest,
  {
    repositoryRoot = fileURLToPath(new URL("../../../../../", import.meta.url)),
  } = {},
) {
  const classified = manifestFiles(manifest);
  const patterns = (manifest.discovery?.writerPatterns || []).map(
    (pattern) => new RegExp(pattern, "u"),
  );
  const discovered = new Set();
  for (const root of manifest.discovery?.roots || []) {
    for (const file of walkJavaScriptFiles(
      path.resolve(repositoryRoot, root),
    )) {
      const source = fs.readFileSync(file, "utf8");
      if (!patterns.some((pattern) => pattern.test(source))) continue;
      discovered.add(path.relative(repositoryRoot, file).replaceAll("\\", "/"));
    }
  }
  return Object.freeze(
    [...discovered].filter((file) => !classified.has(file)).sort(),
  );
}

export function validateGraphRuntimeSurfaceManifest(
  manifest,
  {
    repositoryRoot = fileURLToPath(new URL("../../../../../", import.meta.url)),
    requireFiles = true,
    discoverWriters = true,
  } = {},
) {
  const errors = [];
  if (manifest?.schema !== GRAPH_RUNTIME_SURFACE_MANIFEST_SCHEMA) {
    errors.push("manifest schema is unsupported");
  }
  if (manifest?.version !== 1) errors.push("manifest version must be 1");
  if (manifest?.projectionVersion !== GRAPH_PROJECTION_VERSION) {
    errors.push("manifest projectionVersion does not match Graph Kernel");
  }
  const cutoverPolicy = manifest?.cutoverPolicy;
  if (
    cutoverPolicy?.ledgerSchema !== GRAPH_CUTOVER_LEDGER_SCHEMA ||
    cutoverPolicy?.scope !== "entry" ||
    cutoverPolicy?.existingCanonicalRunRollback !== "retain_authority"
  ) {
    errors.push(
      "manifest cutoverPolicy does not match the Graph cutover ledger",
    );
  }
  const requiredPlatforms = Array.isArray(cutoverPolicy?.requiredPlatforms)
    ? [...cutoverPolicy.requiredPlatforms].sort()
    : [];
  if (
    JSON.stringify(requiredPlatforms) !==
    JSON.stringify([...GRAPH_CUTOVER_REQUIRED_PLATFORMS].sort())
  ) {
    errors.push(
      "manifest cutoverPolicy must require Linux, Windows, and macOS",
    );
  }
  const surfaces = Array.isArray(manifest?.surfaces) ? manifest.surfaces : [];
  const names = surfaces.map((surface) => surface.originSurface);
  for (const required of [
    "cli_team",
    "cowork",
    "scheduler",
    "desktop",
    "browser",
  ]) {
    if (names.filter((name) => name === required).length !== 1) {
      errors.push(`surface ${required} must appear exactly once`);
    }
  }
  const entryIds = new Set();
  const rolloutKeys = new Set();
  const strategyCounts = { migrate: 0, retire: 0, disabled: 0 };
  for (const surface of surfaces) {
    if (!GRAPH_CUTOVER_STAGES.includes(surface.currentCutoverStage)) {
      errors.push(`${surface.originSurface}: invalid currentCutoverStage`);
    }
    if (!surface.featureFlag?.name || !surface.featureFlag?.default) {
      errors.push(`${surface.originSurface}: featureFlag must be explicit`);
    }
    if (surface.originSurface === "browser") {
      if (
        surface.durability !== "non_durable" ||
        surface.featureFlag.default !== "disabled" ||
        surface.targetAuthoritySource !== "legacy_runtime"
      ) {
        errors.push(
          "browser must remain non-durable, disabled by default, and non-canonical",
        );
      }
    }
    for (const entry of surface.entries || []) {
      if (!entry.id || entryIds.has(entry.id)) {
        errors.push(
          `${surface.originSurface}: entry id is missing or duplicated`,
        );
      }
      entryIds.add(entry.id);
      const expectedRolloutKey = `${surface.originSurface}/${entry.id}`;
      if (
        entry.rolloutKey !== expectedRolloutKey ||
        rolloutKeys.has(entry.rolloutKey)
      ) {
        errors.push(`${entry.id}: rolloutKey must be unique and entry-scoped`);
      }
      rolloutKeys.add(entry.rolloutKey);
      if (!GRAPH_RUNTIME_DURABILITY.includes(entry.runtimeDurability)) {
        errors.push(`${entry.id}: runtimeDurability is invalid`);
      }
      if (!GRAPH_CUTOVER_STRATEGIES.includes(entry.cutoverStrategy)) {
        errors.push(`${entry.id}: cutoverStrategy is invalid`);
      } else {
        strategyCounts[entry.cutoverStrategy] += 1;
      }
      for (const field of [
        "entrypoints",
        "writerFiles",
        "mutationFunctions",
        "stores",
        "recoveryEntrypoints",
      ]) {
        if (!Array.isArray(entry[field])) {
          errors.push(`${entry.id}: ${field} must be an array`);
        }
      }
      if (!entry.entrypoints?.length)
        errors.push(`${entry.id}: entrypoints are empty`);
      if (!entry.writerFiles?.length)
        errors.push(`${entry.id}: writerFiles are empty`);
      if (!entry.mutationFunctions?.length) {
        errors.push(`${entry.id}: mutationFunctions are empty`);
      }
      const dispositions = entry.storeDispositions;
      const dispositionLists = ["migrate", "retire", "rebuild", "disabled"].map(
        (disposition) =>
          Array.isArray(dispositions?.[disposition])
            ? dispositions[disposition]
            : null,
      );
      if (dispositionLists.some((stores) => stores === null)) {
        errors.push(
          `${entry.id}: storeDispositions must declare migrate, retire, rebuild, and disabled arrays`,
        );
      } else {
        const classifiedStores = dispositionLists.flat();
        const declaredStores = [...(entry.stores || [])].sort();
        if (
          new Set(classifiedStores).size !== classifiedStores.length ||
          JSON.stringify([...classifiedStores].sort()) !==
            JSON.stringify(declaredStores)
        ) {
          errors.push(
            `${entry.id}: storeDispositions must classify every store exactly once`,
          );
        }
      }
      if (
        entry.cutoverStrategy === "migrate" &&
        (entry.runtimeDurability !== "durable" ||
          !dispositions?.migrate?.length ||
          !entry.recoveryEntrypoints?.length)
      ) {
        errors.push(
          `${entry.id}: migrate requires durable stores and a recovery entrypoint`,
        );
      }
      if (
        entry.cutoverStrategy === "retire" &&
        (entry.runtimeDurability === "non_durable" ||
          !dispositions?.retire?.length ||
          dispositions?.migrate?.length !== 0 ||
          dispositions?.rebuild?.length !== 0 ||
          dispositions?.disabled?.length !== 0 ||
          entry.recoveryEntrypoints?.length !== 0)
      ) {
        errors.push(
          `${entry.id}: retire requires only historical read-only stores without a recovery entrypoint`,
        );
      }
      if (
        entry.cutoverStrategy === "retire" &&
        (!entry.replacementEntrypoint ||
          entry.replacementAuthoritySource !== "graph_kernel" ||
          entry.retiredStoreAccess !== "historical_read_only")
      ) {
        errors.push(
          `${entry.id}: retire requires a Graph Kernel replacement and historical_read_only store access`,
        );
      }
      if (
        entry.cutoverStrategy === "disabled" &&
        (entry.runtimeDurability !== "non_durable" ||
          dispositions?.migrate?.length !== 0 ||
          dispositions?.retire?.length !== 0 ||
          dispositions?.rebuild?.length !== 0 ||
          surface.durability !== "non_durable")
      ) {
        errors.push(
          `${entry.id}: disabled requires a non-durable entry on a non-durable surface`,
        );
      }
      if (requireFiles) {
        for (const file of [
          ...(entry.entrypoints || []),
          ...(entry.writerFiles || []),
        ]) {
          if (!fs.existsSync(path.resolve(repositoryRoot, file))) {
            errors.push(`${entry.id}: classified file does not exist: ${file}`);
          }
        }
      }
    }
  }
  const classifiedNonWriters = Array.isArray(
    manifest?.discovery?.classifiedNonWriters,
  )
    ? manifest.discovery.classifiedNonWriters
    : [];
  const classifiedNonWriterFiles = new Set();
  for (const candidate of classifiedNonWriters) {
    if (
      !GRAPH_RUNTIME_CANDIDATE_CLASSIFICATIONS.includes(
        candidate?.classification,
      ) ||
      !candidate?.reason ||
      !Array.isArray(candidate?.files) ||
      candidate.files.length === 0
    ) {
      errors.push(
        "classified non-writer candidates require files, a supported classification, and a reason",
      );
      continue;
    }
    for (const file of candidate.files) {
      if (classifiedNonWriterFiles.has(file)) {
        errors.push(`classified non-writer file is duplicated: ${file}`);
      }
      classifiedNonWriterFiles.add(file);
      if (requireFiles && !fs.existsSync(path.resolve(repositoryRoot, file))) {
        errors.push(`classified non-writer file does not exist: ${file}`);
      }
    }
  }
  if (discoverWriters) {
    for (const file of discoverUnclassifiedRuntimeWriters(manifest, {
      repositoryRoot,
    })) {
      errors.push(`unclassified runtime writer: ${file}`);
    }
  }
  if (GRAPH_AUTHORITY_MODES.length !== 3) {
    errors.push("Graph authority mode contract is incomplete");
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    surfaceCount: surfaces.length,
    entryCount: entryIds.size,
    migratableEntryCount: strategyCounts.migrate,
    retirementEntryCount: strategyCounts.retire,
    disabledEntryCount: strategyCounts.disabled,
    manifest: Object.freeze(clone(manifest)),
  });
}
