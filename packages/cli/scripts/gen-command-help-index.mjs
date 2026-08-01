#!/usr/bin/env node
/**
 * Generate a phase-0 command help index from the canonical Commander program.
 * Runtime help reads the generated text without importing command modules.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createProgram } from "../src/index.js";

const OUTPUT = new URL("../src/command-help-index.json", import.meta.url);
const MANIFEST = new URL("../src/command-manifest.json", import.meta.url);
const checkOnly = process.argv.includes("--check");
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const program = createProgram();
const commands = {};

for (const entry of manifest.commands) {
  const command = program.commands.find(
    (candidate) => candidate.name() === entry.name,
  );
  if (!command) {
    throw new Error(`Manifest command is not registered: ${entry.name}`);
  }
  command.configureHelp({ helpWidth: 80 });
  commands[entry.name] = command.helpInformation();
}

const output = `${JSON.stringify(
  {
    _generated: "scripts/gen-command-help-index.mjs — do not edit by hand",
    commandCount: Object.keys(commands).length,
    commands,
  },
  null,
  2,
)}\n`;

if (checkOnly) {
  let existing = "";
  try {
    existing = readFileSync(OUTPUT, "utf8");
  } catch {
    // Report the same actionable drift error for a missing artifact.
  }
  if (existing !== output) {
    console.error(
      "Command help index is stale. Run: node scripts/gen-command-help-index.mjs",
    );
    process.exitCode = 1;
  }
} else {
  writeFileSync(OUTPUT, output, "utf8");
  console.error(`Wrote help for ${Object.keys(commands).length} commands.`);
}
