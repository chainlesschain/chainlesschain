#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rendererRoot = path.join(root, "src", "renderer");
const mainRoot = path.join(root, "src", "main");
const manifestPath = path.join(
  root,
  "src",
  "preload",
  "renderer-ipc-capabilities.json",
);
const preloadPath = path.join(root, "src", "preload", "index.js");
const beginMarker = "  // BEGIN GENERATED FIXED RENDERER IPC CHANNELS";
const endMarker = "  // END GENERATED FIXED RENDERER IPC CHANNELS";
const supportedExtensions = new Set([".js", ".jsx", ".ts", ".tsx", ".vue"]);
const channelPattern = /^[A-Za-z][A-Za-z0-9_-]*:[A-Za-z0-9][A-Za-z0-9_.:/-]*$/;
const ignoredDirectories = new Set([
  "__tests__",
  "fixtures",
  "node_modules",
  "dist",
]);

function listFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue;
      files.push(...listFiles(target));
    } else if (
      supportedExtensions.has(path.extname(entry.name)) &&
      !/\.(?:test|spec)\.[^.]+$/.test(entry.name)
    ) {
      files.push(target);
    }
  }
  return files;
}

// This deliberately over-approximates string literals in production renderer
// source so dynamically wrapped calls remain compatible. The authority
// intersection below prevents renderer-only strings from minting channels;
// tests and fixtures are excluded before either side is scanned.
function stringLiterals(source) {
  const values = [];
  for (let index = 0; index < source.length; index += 1) {
    const quote = source[index];
    if (quote !== '"' && quote !== "'" && quote !== "`") continue;
    let value = "";
    let escaped = false;
    let dynamicTemplate = false;
    for (index += 1; index < source.length; index += 1) {
      const char = source[index];
      if (escaped) {
        value += char;
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (quote === "`" && char === "$" && source[index + 1] === "{") {
        dynamicTemplate = true;
      }
      if (char === quote) break;
      value += char;
    }
    if (!dynamicTemplate) values.push(value);
  }
  return values;
}

function channelsIn(directory) {
  const channels = new Set();
  for (const file of listFiles(directory)) {
    const source = fs.readFileSync(file, "utf8");
    for (const value of stringLiterals(source)) {
      if (channelPattern.test(value)) channels.add(value);
    }
  }
  return channels;
}

function directIpcChannels(source, patterns) {
  const channels = new Set();
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const value = match[2];
      if (channelPattern.test(value)) channels.add(value);
    }
  }
  return channels;
}

function mainAuthorityChannels() {
  const channels = new Set();
  const registrationPatterns = [
    /\b_?ipcMain\s*\.\s*(?:handle|handleOnce|on|once)\s*\(\s*(["'`])([^"'`\r\n]+)\1/g,
    /\bsafeHandle\s*\(\s*(["'`])([^"'`\r\n]+)\1/g,
    /\bregisterHandler\s*\(\s*(["'`])([^"'`\r\n]+)\1/g,
    /\bsendToRenderer\s*\(\s*(["'`])([^"'`\r\n]+)\1/g,
    /\bwebContents\s*\.\s*(?:send|postMessage)\s*\(\s*(["'`])([^"'`\r\n]+)\1/g,
  ];
  for (const file of listFiles(mainRoot)) {
    const source = fs.readFileSync(file, "utf8");
    for (const channel of directIpcChannels(source, registrationPatterns)) {
      channels.add(channel);
    }
  }

  // Existing scoped preload methods are also authoritative capabilities.
  // Remove the generated block first so it cannot authorize itself.
  const preloadSource = fs.readFileSync(preloadPath, "utf8");
  const withoutGeneratedBlock = replaceGeneratedBlock(preloadSource, []);
  const preloadPatterns = [
    /\bipcRenderer\s*\.\s*(?:invoke|send|on|once)\s*\(\s*(["'`])([^"'`\r\n]+)\1/g,
  ];
  for (const channel of directIpcChannels(
    withoutGeneratedBlock,
    preloadPatterns,
  )) {
    channels.add(channel);
  }
  return channels;
}

function rendererBridgeChannels() {
  const channels = new Set();
  const bridgePatterns = [
    /\b(?:ipcRenderer|electronAPI|electron|ipc|api)\s*(?:\?\.|\.)\s*(?:invoke|send|on|once|removeListener|removeAllListeners)\s*\(\s*(["'`])([^"'`\r\n]+)\1/g,
  ];
  for (const file of listFiles(rendererRoot)) {
    const source = fs.readFileSync(file, "utf8");
    for (const channel of directIpcChannels(source, bridgePatterns)) {
      channels.add(channel);
    }
  }
  return channels;
}

function expectedChannels() {
  const rendererChannels = channelsIn(rendererRoot);
  const mainChannels = mainAuthorityChannels();
  // A generic renderer call is useful only when the same exact channel is an
  // actual main-process registration/delivery point or an existing scoped
  // preload method. This excludes imports, model identifiers, URLs, test
  // fixtures and other channel-shaped strings from the authority set.
  return [...rendererChannels]
    .filter((channel) => mainChannels.has(channel))
    .sort();
}

function generatedBlock(channels) {
  return [
    beginMarker,
    ...channels.map((channel) => `  ${JSON.stringify(channel)},`),
    endMarker,
  ].join("\n");
}

function replaceGeneratedBlock(source, channels) {
  const start = source.indexOf(beginMarker);
  const end = source.indexOf(endMarker);
  if (start < 0 || end < start) {
    throw new Error("preload fixed IPC generated markers are missing");
  }
  return (
    source.slice(0, start) +
    generatedBlock(channels) +
    source.slice(end + endMarker.length)
  );
}

const channels = expectedChannels();
const authorityChannels = mainAuthorityChannels();
const unregisteredRendererChannels = [...rendererBridgeChannels()]
  .filter((channel) => !authorityChannels.has(channel))
  .sort();
const manifest = `${JSON.stringify(
  {
    version: 1,
    channels,
    deniedUnregisteredChannels: unregisteredRendererChannels,
  },
  null,
  2,
)}\n`;
const preloadSource = fs.readFileSync(preloadPath, "utf8");
const expectedPreload = replaceGeneratedBlock(preloadSource, channels);

if (process.argv.includes("--write")) {
  fs.writeFileSync(manifestPath, manifest, "utf8");
  fs.writeFileSync(preloadPath, expectedPreload, "utf8");
  process.stdout.write(
    `Updated fixed renderer IPC manifest (${channels.length} exact channels; ${unregisteredRendererChannels.length} unregistered renderer channels denied).\n`,
  );
  process.exit(0);
}

const actualManifest = fs.existsSync(manifestPath)
  ? fs.readFileSync(manifestPath, "utf8")
  : "";
const problems = [];
if (actualManifest !== manifest) {
  problems.push(
    "renderer-ipc-capabilities.json is stale; run node scripts/verify-fixed-renderer-ipc.mjs --write",
  );
}
if (preloadSource !== expectedPreload) {
  problems.push(
    "preload fixed IPC channel block is stale; run node scripts/verify-fixed-renderer-ipc.mjs --write",
  );
}
if (preloadSource.includes("CC_ENABLE_LEGACY_GENERIC_IPC")) {
  problems.push("the legacy environment-variable IPC bypass is present");
}

if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`- ${problem}\n`);
  process.exit(1);
}

process.stdout.write(
  `Fixed renderer IPC manifest is current (${channels.length} exact channels; ${unregisteredRendererChannels.length} unregistered renderer channels denied).\n`,
);
