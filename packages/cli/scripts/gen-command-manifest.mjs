#!/usr/bin/env node
/**
 * Generate src/command-manifest.json — a static map of top-level command name
 * (and aliases) -> routing data plus command-surface metadata used by the lazy CLI
 * dispatcher (src/lazy-dispatch.js) so a `cc <cmd>` invocation can import ONLY
 * that command's module instead of eagerly loading all ~154 command modules
 * (the ~2.7s cold-start cost; see memory cli_cold_start_bottleneck_hub_repl).
 *
 * Since the phase-0 refactor, src/index.js consumes this manifest instead of
 * statically importing every registrar. Existing `{ module, register }` pairs
 * are therefore the routing source of truth; this script imports each unique
 * pair, re-discovers its top-level commands and aliases, and refreshes all
 * generated metadata. A new registrar must first be bootstrapped with one
 * route entry, after which every command contributed by it is discovered.
 *
 * Run: node scripts/gen-command-manifest.mjs   (re-run when commands change)
 * Check: node scripts/gen-command-manifest.mjs --check
 */
import { Command } from "commander";
import { readFileSync, writeFileSync } from "fs";
import { format } from "prettier";
import {
  buildCommandSurfaceDescriptor,
  COMMAND_MANIFEST_SCHEMA,
  describeCommandSurface,
} from "../src/command-surface-policy.js";

const SRC_ROOT = new URL("../src/", import.meta.url);
const OUT = new URL("../src/command-manifest.json", import.meta.url);
const checkOnly = process.argv.includes("--check");

const seedManifest = JSON.parse(readFileSync(OUT, "utf8"));
if (
  !Array.isArray(seedManifest.commands) ||
  seedManifest.commands.length === 0
) {
  throw new Error(
    "Refusing to regenerate from an empty command manifest; restore a routing seed first.",
  );
}

const routes = [
  ...new Map(
    seedManifest.commands.map((entry) => [
      `${entry.module}\0${entry.register}`,
      { module: entry.module, register: entry.register },
    ]),
  ).values(),
];

// Introspect each routed registrar against a throwaway program.
const entries = [];
const commandOwners = new Map();
for (const route of routes) {
  const { module: modulePath, register: registerName } = route;
  let imported;
  try {
    imported = await import(new URL(modulePath.replace(/^\.\//, ""), SRC_ROOT));
  } catch (e) {
    throw new Error(
      `Import failed for ${modulePath} (${registerName}): ${e.message}`,
    );
  }
  const regFn = imported[registerName];
  if (typeof regFn !== "function") {
    throw new Error(
      `Register function ${registerName} is missing from ${modulePath}`,
    );
  }
  const probe = new Command();
  try {
    regFn(probe);
  } catch (error) {
    throw new Error(
      `Registration failed for ${modulePath} (${registerName}): ${error.message}`,
    );
  }
  for (const cmd of probe.commands) {
    const existingOwner = commandOwners.get(cmd.name());
    if (existingOwner) {
      throw new Error(
        `Duplicate top-level command ${cmd.name()} from ${existingOwner} and ${modulePath} (${registerName})`,
      );
    }
    commandOwners.set(cmd.name(), `${modulePath} (${registerName})`);
    const aliases =
      typeof cmd.aliases === "function" ? cmd.aliases() : cmd._aliases || [];
    entries.push({
      name: cmd.name(),
      aliases,
      module: modulePath,
      register: registerName,
      summary:
        (typeof cmd.description === "function" ? cmd.description() : "") || "",
      ...describeCommandSurface(cmd.name()),
    });
  }
}

entries.sort((a, b) => a.name.localeCompare(b.name));

const manifest = {
  _generated: "scripts/gen-command-manifest.mjs — do not edit by hand",
  schema: COMMAND_MANIFEST_SCHEMA,
  commandCount: entries.length,
  surface: buildCommandSurfaceDescriptor(),
  commands: entries,
};

const output = await format(JSON.stringify(manifest), { parser: "json" });

if (checkOnly) {
  if (JSON.stringify(seedManifest) !== JSON.stringify(manifest)) {
    console.error(
      "Command manifest is stale. Run: node scripts/gen-command-manifest.mjs",
    );
    process.exitCode = 1;
  }
} else {
  writeFileSync(OUT, output, "utf8");
  console.error(
    `Wrote ${entries.length} command entries to src/command-manifest.json ` +
      `(${routes.length} routed register fns scanned).`,
  );
}
