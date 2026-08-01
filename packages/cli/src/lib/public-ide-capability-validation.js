/** Repository drift guards for the canonical public IDE capability manifest. */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PUBLIC_IDE_CAPABILITY_MANIFEST,
  PUBLIC_IDE_MANIFEST_OUTPUT,
  README_BLOCK_END,
  README_BLOCK_START,
  renderPublicIdeCapabilityManifest,
  renderPublicIdeReadmeBlock,
} from "./public-ide-capability-manifest.js";

export const DEFAULT_REPO_ROOT = fileURLToPath(
  new URL("../../../../", import.meta.url),
);

const read = (root, path) => readFileSync(join(root, path), "utf8");

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].sort();
}

function sameSet(actual, expected) {
  return (
    actual.length === expected.length &&
    [...actual]
      .sort()
      .every((value, index) => value === [...expected].sort()[index])
  );
}

function describeSetDrift(actual, expected) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((value) => !actualSet.has(value));
  const extra = actual.filter((value) => !expectedSet.has(value));
  return `missing=[${missing.join(", ")}], extra=[${extra.join(", ")}]`;
}

function extractVersion(text, pattern) {
  const match = text.match(pattern);
  return match ? match[1] : null;
}

function compareVersions(left, right) {
  const a = String(left).split(".").map(Number);
  const b = String(right).split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function extractDesktopShortcutKeys(text) {
  const marker = "keyboardShortcuts.registerMultiple([";
  const start = text.indexOf(marker);
  if (start < 0) return [];
  const tail = text.slice(start + marker.length);
  const end = tail.indexOf("]);");
  if (end < 0) return [];
  return [...tail.slice(0, end).matchAll(/\bkey:\s*["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
}

function walkFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...walkFiles(path));
    else files.push(path);
  }
  return files;
}

function readmeBlock(text) {
  const start = text.indexOf(README_BLOCK_START);
  const end = text.indexOf(README_BLOCK_END);
  if (start < 0 || end < start) return null;
  return `${text.slice(start, end + README_BLOCK_END.length).trimEnd()}\n`;
}

export function validatePublicIdeSurfaces({
  repoRoot = DEFAULT_REPO_ROOT,
  manifest = PUBLIC_IDE_CAPABILITY_MANIFEST,
} = {}) {
  const errors = [];
  const fail = (message) => errors.push(message);
  const requireFile = (path) => {
    if (!existsSync(join(repoRoot, path)))
      fail(`Missing declared source: ${path}`);
  };

  const vscode = manifest.surfaces.vscode;
  const vscodePackage = JSON.parse(read(repoRoot, vscode.commandContribution));
  const contributed = (vscodePackage.contributes?.commands || []).map(
    (entry) => entry.command,
  );
  const vscodeSource = read(repoRoot, vscode.runtimeRegistration);
  const registered = [
    ...vscodeSource.matchAll(/registerCommand\s*\(\s*["']([^"']+)["']/g),
  ].map((match) => match[1]);
  for (const [label, actual] of [
    ["VS Code contributed commands", contributed],
    ["VS Code runtime commands", registered],
  ]) {
    const repeated = duplicates(actual);
    if (repeated.length)
      fail(`${label} contain duplicates: ${repeated.join(", ")}`);
    if (!sameSet(actual, vscode.commands)) {
      fail(`${label} drifted: ${describeSetDrift(actual, vscode.commands)}`);
    }
  }

  const vscodeCapabilitySource = read(repoRoot, vscode.bridgeCapabilities);
  const vscodeToolFeatures = [
    ...vscodeCapabilitySource.matchAll(/\["([^"]+)",\s*"([^"]+)"\]/g),
  ].map((match) => [match[1], match[2]]);
  if (
    JSON.stringify(vscodeToolFeatures) !==
    JSON.stringify(manifest.bridge.toolFeatures)
  ) {
    fail(
      "VS Code bridge tool/feature mapping drifted from the public manifest",
    );
  }
  const vscodeSchema = extractVersion(
    vscodeCapabilitySource,
    /IDE_CAPABILITY_VERSION\s*=\s*(\d+)/,
  );
  if (Number(vscodeSchema) !== manifest.bridge.schemaVersion) {
    fail(
      `VS Code bridge schema is ${vscodeSchema}; expected ${manifest.bridge.schemaVersion}`,
    );
  }

  const vscodeMinimumSource = read(repoRoot, vscode.minimumCliVersionSource);
  const vscodeMinimum = extractVersion(
    vscodeMinimumSource,
    /MIN_CLI_VERSION\s*=\s*["']([^"']+)["']/,
  );
  if (vscodeMinimum !== manifest.minimumCliVersion) {
    fail(
      `VS Code minimum CLI is ${vscodeMinimum}; expected ${manifest.minimumCliVersion}`,
    );
  }
  const vscodeDoctor = read(repoRoot, vscode.doctorImplementation);
  if (!vscodeDoctor.includes("evaluateRuntimeCompatibility")) {
    fail("VS Code Doctor no longer consumes runtime compatibility");
  }
  if (!vscodeSource.includes("minCliVersion: MIN_CLI_VERSION")) {
    fail("VS Code Remote Doctor no longer consumes MIN_CLI_VERSION");
  }
  for (const id of vscode.doctorCommands) {
    if (!contributed.includes(id) || !registered.includes(id)) {
      fail(`VS Code Doctor entry is not contributed and registered: ${id}`);
    }
  }

  const jetbrains = manifest.surfaces.jetbrains;
  const pluginXml = read(repoRoot, jetbrains.actionDescriptor);
  const actions = [...pluginXml.matchAll(/<action\s+id="([^"]+)"/g)].map(
    (match) => match[1],
  );
  const repeatedActions = duplicates(actions);
  if (repeatedActions.length) {
    fail(`JetBrains actions contain duplicates: ${repeatedActions.join(", ")}`);
  }
  if (!sameSet(actions, jetbrains.actions)) {
    fail(
      `JetBrains actions drifted: ${describeSetDrift(actions, jetbrains.actions)}`,
    );
  }

  const jetbrainsCapabilitySource = read(
    repoRoot,
    jetbrains.bridgeCapabilities,
  );
  const jetbrainsToolFeatures = [
    ...jetbrainsCapabilitySource.matchAll(
      /TOOL_FEATURES\.put\("([^"]+)",\s*"([^"]+)"\);/g,
    ),
  ].map((match) => [match[1], match[2]]);
  if (
    JSON.stringify(jetbrainsToolFeatures) !==
    JSON.stringify(manifest.bridge.toolFeatures)
  ) {
    fail(
      "JetBrains bridge tool/feature mapping drifted from the public manifest",
    );
  }
  const jetbrainsSchema = extractVersion(
    jetbrainsCapabilitySource,
    /SCHEMA_VERSION\s*=\s*(\d+)/,
  );
  if (Number(jetbrainsSchema) !== manifest.bridge.schemaVersion) {
    fail(
      `JetBrains bridge schema is ${jetbrainsSchema}; expected ${manifest.bridge.schemaVersion}`,
    );
  }

  const jetbrainsMinimumSource = read(
    repoRoot,
    jetbrains.minimumCliVersionSource,
  );
  const jetbrainsMinimum = extractVersion(
    jetbrainsMinimumSource,
    /MIN_CLI_VERSION\s*=\s*"([^"]+)"/,
  );
  if (jetbrainsMinimum !== manifest.minimumCliVersion) {
    fail(
      `JetBrains minimum CLI is ${jetbrainsMinimum}; expected ${manifest.minimumCliVersion}`,
    );
  }
  const jetbrainsDoctor = read(repoRoot, jetbrains.doctorImplementation);
  if (!jetbrainsDoctor.includes("RuntimeCompatibility.MIN_CLI_VERSION")) {
    fail(
      "JetBrains Doctor no longer consumes RuntimeCompatibility.MIN_CLI_VERSION",
    );
  }
  for (const id of jetbrains.doctorActions) {
    if (!actions.includes(id))
      fail(`JetBrains Doctor action is missing: ${id}`);
  }

  const desktop = manifest.surfaces.desktop;
  const desktopRegistry = read(repoRoot, desktop.commandRegistry);
  const desktopKeys = extractDesktopShortcutKeys(desktopRegistry);
  if (
    JSON.stringify(desktopKeys) !== JSON.stringify(desktop.defaultShortcutKeys)
  ) {
    fail(
      `Desktop default command keys drifted: expected [${desktop.defaultShortcutKeys.join(", ")}], got [${desktopKeys.join(", ")}]`,
    );
  }
  for (const marker of desktop.registryContract) {
    if (!desktopRegistry.includes(marker)) {
      fail(`Desktop command registry contract marker is missing: ${marker}`);
    }
  }
  const desktopConsumer = read(repoRoot, desktop.registryConsumer);
  const consumesLegacyRegistry =
    desktopConsumer.includes("keyboardShortcuts") &&
    desktopConsumer.includes("getAllCommands()");
  const consumesCanonicalRegistry =
    desktopConsumer.includes("desktopCommandRegistry.list(") &&
    desktopConsumer.includes("desktopCommandRegistry.execute(");
  if (!consumesLegacyRegistry && !consumesCanonicalRegistry) {
    fail(
      "Desktop CommandPalette no longer consumes a declared command registry",
    );
  }
  for (const path of desktop.unconvergedSurfaces) requireFile(path);

  const rendererRoot = join(repoRoot, "desktop-app-vue/src/renderer");
  const registryInstances = [];
  for (const path of walkFiles(rendererRoot)) {
    if (!/\.(?:js|ts|vue)$/.test(path)) continue;
    const count = [
      ...readFileSync(path, "utf8").matchAll(/new\s+KeyboardShortcuts\s*\(/g),
    ].length;
    for (let index = 0; index < count; index += 1) {
      registryInstances.push(relative(repoRoot, path).replaceAll("\\", "/"));
    }
  }
  if (
    registryInstances.length !== 1 ||
    registryInstances[0] !== desktop.commandRegistry
  ) {
    fail(
      `Desktop must keep one KeyboardShortcuts registry instance; got [${registryInstances.join(", ")}]`,
    );
  }

  const cli = manifest.surfaces.cli;
  const commandManifest = JSON.parse(read(repoRoot, cli.commandManifest));
  const helpIndex = JSON.parse(read(repoRoot, cli.commandHelpIndex));
  const cliCommands = (commandManifest.commands || []).map(
    (entry) => entry.name,
  );
  for (const command of cli.requiredCommands) {
    if (!cliCommands.includes(command))
      fail(`CLI command manifest is missing: ${command}`);
    if (!helpIndex.commands?.[command])
      fail(`CLI help index is missing: ${command}`);
  }
  if (!String(helpIndex.commands?.ide || "").includes("doctor")) {
    fail("CLI `ide` help no longer advertises the `ide doctor` subcommand");
  }
  const cliPackage = JSON.parse(read(repoRoot, "packages/cli/package.json"));
  if (compareVersions(cliPackage.version, manifest.minimumCliVersion) < 0) {
    fail(
      `CLI package ${cliPackage.version} is below the public IDE floor ${manifest.minimumCliVersion}`,
    );
  }

  return errors;
}

export function validatePublicIdeGeneratedArtifacts({
  repoRoot = DEFAULT_REPO_ROOT,
  manifest = PUBLIC_IDE_CAPABILITY_MANIFEST,
} = {}) {
  const errors = [];
  const generatedPath = join(repoRoot, PUBLIC_IDE_MANIFEST_OUTPUT);
  if (!existsSync(generatedPath)) {
    errors.push(`Missing generated manifest: ${PUBLIC_IDE_MANIFEST_OUTPUT}`);
  } else {
    try {
      const actual = JSON.parse(readFileSync(generatedPath, "utf8"));
      const expected = JSON.parse(renderPublicIdeCapabilityManifest(manifest));
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        errors.push(
          `Generated manifest is stale: ${PUBLIC_IDE_MANIFEST_OUTPUT}`,
        );
      }
    } catch (error) {
      errors.push(
        `Generated manifest is invalid JSON: ${PUBLIC_IDE_MANIFEST_OUTPUT} (${error.message})`,
      );
    }
  }

  for (const host of ["vscode", "jetbrains"]) {
    const path = manifest.surfaces[host].readme;
    const actual = readmeBlock(read(repoRoot, path));
    const expected = renderPublicIdeReadmeBlock(host, manifest);
    if (actual !== expected) errors.push(`${path} capability block is stale`);
  }
  return errors;
}

export function replacePublicIdeReadmeBlock(text, block) {
  const start = text.indexOf(README_BLOCK_START);
  const end = text.indexOf(README_BLOCK_END);
  if (start < 0 && end < 0) return `${text.trimEnd()}\n\n${block}`;
  if (start < 0 || end < start) {
    throw new Error("Malformed public IDE capability README markers");
  }
  const after = end + README_BLOCK_END.length;
  return `${text.slice(0, start)}${block.trimEnd()}${text.slice(after)}`;
}
