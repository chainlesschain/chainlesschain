import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GRAPH_AUTHORITY_MODES,
  GRAPH_CUTOVER_STAGES,
  GRAPH_PROJECTION_VERSION,
} from "./authority.js";

export const GRAPH_RUNTIME_SURFACE_MANIFEST_SCHEMA =
  "chainlesschain.graph-runtime-surfaces/v1";
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

function manifestFiles(manifest) {
  return new Set(
    manifest.surfaces.flatMap((surface) =>
      surface.entries.flatMap((entry) => [
        ...entry.entrypoints,
        ...entry.writerFiles,
      ]),
    ),
  );
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
    manifest: Object.freeze(clone(manifest)),
  });
}
