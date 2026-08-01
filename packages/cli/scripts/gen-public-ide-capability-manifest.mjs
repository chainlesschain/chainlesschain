#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  PUBLIC_IDE_CAPABILITY_MANIFEST,
  PUBLIC_IDE_MANIFEST_OUTPUT,
  renderPublicIdeCapabilityManifest,
  renderPublicIdeReadmeBlock,
} from "../src/lib/public-ide-capability-manifest.js";
import {
  DEFAULT_REPO_ROOT,
  replacePublicIdeReadmeBlock,
  validatePublicIdeGeneratedArtifacts,
  validatePublicIdeSurfaces,
} from "../src/lib/public-ide-capability-validation.js";

const checkOnly = process.argv.includes("--check");
const surfaceErrors = validatePublicIdeSurfaces();
if (surfaceErrors.length) {
  console.error("Public IDE capability surface drift detected:");
  for (const error of surfaceErrors) console.error(`- ${error}`);
  process.exitCode = 1;
} else if (checkOnly) {
  const artifactErrors = validatePublicIdeGeneratedArtifacts();
  if (artifactErrors.length) {
    console.error("Public IDE capability generated artifacts are stale:");
    for (const error of artifactErrors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(
      "Public IDE capability manifest and host surfaces are in sync.",
    );
  }
} else {
  const output = join(DEFAULT_REPO_ROOT, PUBLIC_IDE_MANIFEST_OUTPUT);
  let formattedManifest = renderPublicIdeCapabilityManifest();
  try {
    // Prettier is a root development dependency, not a CLI runtime dependency.
    // Keep generation usable in a standalone CLI checkout while producing the
    // repository's preferred formatting when invoked through the root script.
    const { format } = await import("prettier");
    formattedManifest = await format(formattedManifest, {
      parser: "json",
      endOfLine: "lf",
    });
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    // JSON.stringify output remains deterministic and semantically identical
    // when the optional repository formatter is unavailable.
  }
  writeFileSync(output, formattedManifest, "utf8");
  for (const host of ["vscode", "jetbrains"]) {
    const readmePath = join(
      DEFAULT_REPO_ROOT,
      PUBLIC_IDE_CAPABILITY_MANIFEST.surfaces[host].readme,
    );
    const next = replacePublicIdeReadmeBlock(
      readFileSync(readmePath, "utf8"),
      renderPublicIdeReadmeBlock(host),
    );
    writeFileSync(readmePath, next, "utf8");
  }
  console.log(`Wrote ${PUBLIC_IDE_MANIFEST_OUTPUT} and host README blocks.`);
}
