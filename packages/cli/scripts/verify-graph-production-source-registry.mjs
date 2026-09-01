#!/usr/bin/env node

import process from "node:process";
import {
  GRAPH_PRODUCTION_SOURCE_REGISTRY_PATH,
  loadTrustedGraphRuntimeSurfaceManifest,
  loadTrustedJsonFile,
} from "./assemble-graph-production-cutover-evidence.mjs";
import { normalizeGraphProductionSourceRegistry } from "../src/lib/graph-kernel/production-source-evidence.js";
import { graphRuntimeSurfaceManifestDigest } from "../src/lib/graph-kernel/runtime-surface-manifest.js";

function required(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (!value || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}

try {
  const repository = required("--repository");
  const expectedRegistryDigest = required("--expected-registry-digest");
  const registry = loadTrustedJsonFile(GRAPH_PRODUCTION_SOURCE_REGISTRY_PATH, {
    field: "checked-in source registry",
  });
  const manifest = loadTrustedGraphRuntimeSurfaceManifest();
  const verified = normalizeGraphProductionSourceRegistry(registry, {
    expectedRepository: repository,
    expectedManifestDigest: graphRuntimeSurfaceManifestDigest(manifest),
    expectedRegistryDigest,
  });
  process.stdout.write(`${verified.registryDigest}\n`);
} catch (error) {
  process.stderr.write(
    `${error?.code ? `${error.code}: ` : ""}${error?.message || error}\n`,
  );
  process.exitCode = 1;
}
