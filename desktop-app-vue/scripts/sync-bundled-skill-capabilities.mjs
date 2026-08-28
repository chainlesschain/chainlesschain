#!/usr/bin/env node

/**
 * Generate and verify the complete bundled Skill execution-capability audit.
 *
 * The checked-in catalog remains the runtime authority. This script is the
 * review/CI authority that derives the minimum declared host surfaces from
 * each exact handler source and fails closed for unknown modules or fs APIs.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const acorn = require("acorn");
const prettier = require("prettier");

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const BUILTIN_ROOT = path.join(
  PROJECT_ROOT,
  "src",
  "main",
  "ai-engine",
  "cowork",
  "skills",
  "builtin",
);
const CATALOG_PATH = path.join(
  PROJECT_ROOT,
  "src",
  "main",
  "ai-engine",
  "cowork",
  "skills",
  "bundled-skill-capability-catalog.js",
);
const HANDLER_FILENAME = "handler.js";
const MANIFEST_FILENAME = "SKILL.md";
const BASE_CAPABILITIES = Object.freeze(["data:result", "data:task"]);
const CAPABILITY_RE = /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)+$/;

const FS_READ_METHODS = new Set([
  "access",
  "accessSync",
  "exists",
  "existsSync",
  "fstat",
  "fstatSync",
  "lstat",
  "lstatSync",
  "open",
  "openSync",
  "opendir",
  "opendirSync",
  "read",
  "readFile",
  "readFileSync",
  "readSync",
  "readdir",
  "readdirSync",
  "readlink",
  "readlinkSync",
  "realpath",
  "realpathSync",
  "stat",
  "statSync",
  "watch",
  "watchFile",
  "createReadStream",
]);
const FS_WRITE_METHODS = new Set([
  "appendFile",
  "appendFileSync",
  "chmod",
  "chmodSync",
  "chown",
  "chownSync",
  "copyFile",
  "copyFileSync",
  "cp",
  "cpSync",
  "createWriteStream",
  "fchmod",
  "fchmodSync",
  "fchown",
  "fchownSync",
  "fdatasync",
  "fdatasyncSync",
  "fsync",
  "fsyncSync",
  "ftruncate",
  "ftruncateSync",
  "link",
  "linkSync",
  "mkdir",
  "mkdirSync",
  "mkdtemp",
  "mkdtempSync",
  "open",
  "openSync",
  "rename",
  "renameSync",
  "rm",
  "rmSync",
  "rmdir",
  "rmdirSync",
  "symlink",
  "symlinkSync",
  "truncate",
  "truncateSync",
  "unlink",
  "unlinkSync",
  "unwatchFile",
  "utimes",
  "utimesSync",
  "write",
  "writeFile",
  "writeFileSync",
  "writeSync",
]);
const FS_NON_EFFECT_METHODS = new Set(["close", "closeSync"]);

const PURE_MODULES = new Set(["handlebars", "marked", "path", "url"]);
const THIRD_PARTY_MODULE_CAPABILITIES = new Map([
  ["@chainlesschain/mcp-sdk", ["host:mcp"]],
  ["adm-zip", ["host:archive"]],
  ["archiver", ["host:archive"]],
  ["axios", ["network:http"]],
  ["docx", ["host:document"]],
  ["electron", ["host:electron"]],
  ["exceljs", ["host:document"]],
  ["fluent-ffmpeg", ["host:media", "process:execute"]],
  ["mammoth", ["host:document"]],
  ["pdf-parse", ["host:document"]],
  ["pptxgenjs", ["host:document"]],
  ["sharp", ["host:media"]],
  ["tesseract.js", ["host:media"]],
  ["uuid", ["runtime:random"]],
]);
const REVIEWED_SKILL_CAPABILITY_ADDITIONS = new Map([
  // The broker URL is assembled through pathToFileURL before import(), so the
  // AST cannot recover the literal target even though the handler calls spawn.
  ["code-runner", ["process:execute"]],
]);
const REVIEWED_SKILL_FILESYSTEM_ROOTS = new Map([
  // Code snippets are materialized below a host-owned, Skill-specific temp
  // directory before the process broker executes them.
  ["code-runner", ["workspace", "skill-temporary"]],
]);

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function unwrapChain(node) {
  return node?.type === "ChainExpression" ? node.expression : node;
}

function propertyName(node) {
  const current = unwrapChain(node);
  if (!current || current.type !== "MemberExpression") return null;
  if (!current.computed && current.property.type === "Identifier") {
    return current.property.name;
  }
  if (
    current.computed &&
    ["Literal", "StringLiteral"].includes(current.property.type) &&
    typeof current.property.value === "string"
  ) {
    return current.property.value;
  }
  return null;
}

function memberSegments(node) {
  const current = unwrapChain(node);
  if (!current) return null;
  if (current.type === "Identifier") return [current.name];
  if (current.type !== "MemberExpression") return null;
  const base = memberSegments(current.object);
  const property = propertyName(current);
  return base && property ? [...base, property] : null;
}

function requiredModule(node) {
  const current = unwrapChain(node);
  if (!current) return null;
  if (
    current.type === "CallExpression" &&
    current.callee.type === "Identifier" &&
    current.callee.name === "require"
  ) {
    const argument = current.arguments[0];
    return argument?.type === "Literal" && typeof argument.value === "string"
      ? { moduleName: argument.value, members: [] }
      : { moduleName: null, members: [] };
  }
  if (current.type === "MemberExpression") {
    const base = requiredModule(current.object);
    const property = propertyName(current);
    if (base && property)
      return { ...base, members: [...base.members, property] };
  }
  return null;
}

function walk(node, visit, parent = null, parentKey = null) {
  if (!node || typeof node !== "object") return;
  visit(node, parent, parentKey);
  for (const [key, value] of Object.entries(node)) {
    if (["start", "end", "loc", "range"].includes(key)) continue;
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit, node, key);
    } else if (value && typeof value === "object" && value.type) {
      walk(value, visit, node, key);
    }
  }
}

function addCapabilities(target, values) {
  for (const capability of values) {
    if (!CAPABILITY_RE.test(capability)) {
      throw new Error(`Invalid generated capability: ${capability}`);
    }
    target.add(capability);
  }
}

function classifyInternalModule(moduleName) {
  const normalized = moduleName.replace(/\\/g, "/");
  if (normalized.includes("/utils/logger")) return ["host:logger"];
  if (normalized.includes("bundled-skill-egress-broker")) {
    return ["host:network", "network:http"];
  }
  if (normalized.includes("bundled-skill-local-service-broker")) {
    return ["host:network", "network:http"];
  }
  if (normalized.includes("bundled-skill-network-diagnostics-broker")) {
    return ["host:network", "network:socket", "process:execute"];
  }
  if (normalized.includes("bundled-skill-archive-codec")) {
    return ["host:archive"];
  }
  if (normalized.includes("bundled-skill-environment-broker")) {
    return ["host:environment"];
  }
  if (normalized.includes("bundled-skill-filesystem-broker")) {
    return ["host:filesystem"];
  }
  if (normalized.includes("bundled-skill-process-broker")) {
    return ["host:process", "process:execute"];
  }
  if (normalized.includes("/browser/")) return ["host:browser"];
  if (normalized.includes("/code-agent/")) return ["host:code-agent"];
  if (normalized.includes("/crypto/")) return ["host:cryptography"];
  if (normalized.endsWith("/database.js")) return ["host:database"];
  if (normalized.includes("/llm/")) return ["host:memory"];
  if (normalized.includes("/p2p/")) return ["host:p2p"];
  if (normalized.includes("/rag/")) return ["host:rag"];
  if (normalized.includes("/speech/")) return ["host:speech"];
  if (normalized.includes("skill-registry")) return ["host:skill-registry"];
  if (normalized.startsWith("../") || normalized.startsWith("./")) {
    return ["host:skill"];
  }
  return null;
}

function classifyModule(moduleName, capabilities, diagnostics) {
  const coreName = moduleName.startsWith("node:")
    ? moduleName.slice("node:".length)
    : moduleName;
  if (PURE_MODULES.has(coreName)) return;
  switch (coreName) {
    case "fs":
      return;
    case "child_process":
      addCapabilities(capabilities, ["process:execute"]);
      return;
    case "crypto":
      addCapabilities(capabilities, ["runtime:crypto"]);
      return;
    case "dns":
    case "net":
      addCapabilities(capabilities, ["network:socket"]);
      return;
    case "http":
    case "https":
      addCapabilities(capabilities, ["network:http"]);
      return;
    case "os":
    case "v8":
      addCapabilities(capabilities, ["system:inspect"]);
      return;
    case "readline":
      addCapabilities(capabilities, ["process:stdio"]);
      return;
    default:
      break;
  }
  const thirdParty = THIRD_PARTY_MODULE_CAPABILITIES.get(coreName);
  if (thirdParty) {
    addCapabilities(capabilities, thirdParty);
    return;
  }
  const internal = classifyInternalModule(moduleName);
  if (internal) {
    addCapabilities(capabilities, internal);
    return;
  }
  diagnostics.push(`unknown required module ${JSON.stringify(moduleName)}`);
}

function collectFsBindings(ast) {
  const objectBindings = new Set();
  const functionBindings = new Map();
  walk(ast, (node) => {
    if (node.type !== "VariableDeclarator") return;
    const required = requiredModule(node.init);
    if (!required) return;
    const coreName = required.moduleName?.replace(/^node:/, "");
    const bundledBroker = required.moduleName
      ?.replace(/\\/g, "/")
      .includes("bundled-skill-filesystem-broker");
    if (coreName !== "fs" && !bundledBroker) return;
    if (node.id.type === "Identifier") {
      if (bundledBroker) return;
      objectBindings.add(node.id.name);
      return;
    }
    if (node.id.type === "ObjectPattern") {
      for (const property of node.id.properties) {
        if (property.type !== "Property") continue;
        const imported =
          property.key.type === "Identifier"
            ? property.key.name
            : String(property.key.value || "");
        const local =
          property.value.type === "Identifier" ? property.value.name : null;
        if (!imported || !local) continue;
        if (bundledBroker) {
          if (imported === "bundledSkillFs") objectBindings.add(local);
        } else {
          functionBindings.set(local, imported);
        }
      }
    }
  });
  return { objectBindings, functionBindings };
}

function auditFsMethod(method, capabilities, diagnostics) {
  let recognized = false;
  if (FS_READ_METHODS.has(method)) {
    capabilities.add("filesystem:read");
    recognized = true;
  }
  if (FS_WRITE_METHODS.has(method)) {
    capabilities.add("filesystem:write");
    recognized = true;
  }
  if (FS_NON_EFFECT_METHODS.has(method)) recognized = true;
  if (!recognized)
    diagnostics.push(`unknown fs operation ${JSON.stringify(method)}`);
}

export function inferCapabilities(source, skillId, auditDetails = null) {
  const diagnostics = [];
  const capabilities = new Set(BASE_CAPABILITIES);
  let ast;
  try {
    ast = acorn.parse(source, {
      allowHashBang: true,
      ecmaVersion: "latest",
      sourceType: "script",
    });
  } catch (error) {
    throw new Error(`${skillId}: handler AST parse failed: ${error.message}`);
  }

  const modules = new Set();
  let dynamicRequire = false;
  walk(ast, (node) => {
    if (
      node.type === "CallExpression" &&
      node.callee.type === "Identifier" &&
      node.callee.name === "require"
    ) {
      const required = requiredModule(node);
      if (required?.moduleName) modules.add(required.moduleName);
      else dynamicRequire = true;
    }
    if (node.type === "ImportExpression") {
      if (
        node.source?.type === "Literal" &&
        typeof node.source.value === "string"
      ) {
        modules.add(node.source.value);
      } else {
        dynamicRequire = true;
      }
    }
  });
  for (const moduleName of modules) {
    classifyModule(moduleName, capabilities, diagnostics);
  }
  if (dynamicRequire) capabilities.add("host:module-load");

  const { objectBindings, functionBindings } = collectFsBindings(ast);
  const auditedFsCalls = new Set();
  walk(ast, (node) => {
    if (!["CallExpression", "NewExpression"].includes(node.type)) return;
    const callee = unwrapChain(node.callee);
    if (callee?.type === "Identifier" && functionBindings.has(callee.name)) {
      const method = functionBindings.get(callee.name);
      auditedFsCalls.add(method);
      auditFsMethod(method, capabilities, diagnostics);
      return;
    }
    const segments = memberSegments(callee);
    if (
      segments &&
      [...objectBindings].some((binding) => segments.includes(binding))
    ) {
      const method = segments.at(-1);
      if (method !== "promises") {
        auditedFsCalls.add(method);
        auditFsMethod(method, capabilities, diagnostics);
      }
      return;
    }
    const direct = requiredModule(callee?.object);
    if (direct?.moduleName?.replace(/^node:/, "") === "fs") {
      const method = propertyName(callee);
      if (method) {
        auditedFsCalls.add(method);
        auditFsMethod(method, capabilities, diagnostics);
      }
    }
  });
  const importsFs = [...modules].some(
    (moduleName) => moduleName.replace(/^node:/, "") === "fs",
  );
  if (importsFs && auditedFsCalls.size === 0) {
    diagnostics.push("fs is imported but no auditable fs operation was found");
  }
  if (auditDetails && typeof auditDetails === "object") {
    auditDetails.filesystemOperations = [...auditedFsCalls].sort();
  }

  walk(ast, (node) => {
    if (node.type === "MemberExpression") {
      const segments = memberSegments(node);
      if (!segments) return;
      const joined = segments.join(".");
      if (joined === "Math.random") capabilities.add("runtime:random");
      if (segments[0] === "Date" || joined === "performance.now") {
        capabilities.add("runtime:time");
      }
      if (segments[0] === "console") capabilities.add("host:console");
      if (segments[0] === "process") {
        if (segments[1] === "env") capabilities.add("environment:read");
        else if (segments[1] === "cwd") capabilities.add("process:cwd");
        else if (["stdin", "stdout", "stderr"].includes(segments[1])) {
          capabilities.add("process:stdio");
        } else if (["exit", "kill", "abort", "chdir"].includes(segments[1])) {
          capabilities.add("process:control");
        } else {
          capabilities.add("system:inspect");
        }
      }
      if (segments[0] === "global" || segments[0] === "globalThis") {
        capabilities.add("system:inspect");
      }
      if (segments[0] === "require") {
        capabilities.add("host:module-load");
      }
    }
    if (node.type === "NewExpression" && node.callee.type === "Identifier") {
      if (node.callee.name === "Date") capabilities.add("runtime:time");
      if (node.callee.name === "Function") {
        capabilities.add("runtime:dynamic-code");
      }
    }
    if (node.type === "CallExpression" && node.callee.type === "Identifier") {
      if (node.callee.name === "Date") capabilities.add("runtime:time");
      if (
        ["setTimeout", "setInterval", "setImmediate"].includes(node.callee.name)
      ) {
        capabilities.add("runtime:timers");
      }
      if (node.callee.name === "fetch") capabilities.add("network:http");
      if (["eval", "Function"].includes(node.callee.name)) {
        capabilities.add("runtime:dynamic-code");
      }
    }
    if (
      node.type === "Identifier" &&
      ["__dirname", "__filename"].includes(node.name)
    ) {
      capabilities.add("process:module-path");
    }
  });

  addCapabilities(
    capabilities,
    REVIEWED_SKILL_CAPABILITY_ADDITIONS.get(skillId) || [],
  );

  if (diagnostics.length > 0) {
    throw new Error(`${skillId}: ${[...new Set(diagnostics)].join("; ")}`);
  }
  return [...capabilities].sort();
}

function discoverEntries() {
  const entries = [];
  for (const skillId of fs.readdirSync(BUILTIN_ROOT).sort()) {
    const skillDirectory = path.join(BUILTIN_ROOT, skillId);
    const handlerPath = path.join(skillDirectory, HANDLER_FILENAME);
    const manifestPath = path.join(skillDirectory, MANIFEST_FILENAME);
    if (!fs.existsSync(handlerPath)) continue;
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`${skillId}: executable bundled Skill has no SKILL.md`);
    }
    const sourceBytes = fs.readFileSync(handlerPath);
    const source = sourceBytes.toString("utf8");
    const auditDetails = {};
    const executionCapabilities = inferCapabilities(
      source,
      skillId,
      auditDetails,
    );
    const filesystemOperations = auditDetails.filesystemOperations || [];
    entries.push({
      skillId,
      handlerPath,
      manifestPath,
      sourceSha256: sha256(sourceBytes),
      executionCapabilities,
      filesystemOperations,
      filesystemRoots:
        filesystemOperations.length > 0
          ? REVIEWED_SKILL_FILESYSTEM_ROOTS.get(skillId) || ["workspace"]
          : [],
    });
  }
  return entries;
}

function renderManifest(current, entry) {
  const newline = current.includes("\r\n") ? "\r\n" : "\n";
  const normalized = current.replace(
    /^execution-capabilities:[^\r\n]*(?:\r?\n)?/gm,
    "",
  );
  const declaration = `execution-capabilities: [${entry.executionCapabilities.join(", ")}]`;
  const handlerPattern = /^handler:\s*\.\/handler\.js\s*$/m;
  if (!handlerPattern.test(normalized)) {
    throw new Error(
      `${entry.skillId}: manifest must declare handler: ./handler.js`,
    );
  }
  return normalized.replace(
    handlerPattern,
    `${declaration}${newline}handler: ./handler.js`,
  );
}

async function renderCatalog(entries) {
  const rows = entries
    .map((entry) => {
      const property = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(entry.skillId)
        ? entry.skillId
        : JSON.stringify(entry.skillId);
      const capabilities = entry.executionCapabilities
        .map((capability) => `      ${JSON.stringify(capability)},`)
        .join("\n");
      return `  ${property}: Object.freeze([
    ${JSON.stringify(entry.sourceSha256)},
    Object.freeze([
${capabilities}
    ]),
  ]),`;
    })
    .join("\n");
  const filesystemRows = entries
    .filter((entry) => entry.filesystemOperations.length > 0)
    .map((entry) => {
      const property = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(entry.skillId)
        ? entry.skillId
        : JSON.stringify(entry.skillId);
      const operations = entry.filesystemOperations
        .map((operation) => `      ${JSON.stringify(operation)},`)
        .join("\n");
      const roots = entry.filesystemRoots
        .map((root) => `      ${JSON.stringify(root)},`)
        .join("\n");
      return `  ${property}: Object.freeze([
    Object.freeze([
${operations}
    ]),
    Object.freeze([
${roots}
    ]),
  ]),`;
    })
    .join("\n");
  const rawCatalog = `/**
 * Reviewed execution identities for all bundled executable Skills.
 *
 * Generated by scripts/sync-bundled-skill-capabilities.mjs from an AST-based
 * host-surface audit. The checked-in rows are the runtime authority; CI
 * rejects handler, manifest, capability, or catalog drift.
 */

const BUNDLED_SKILL_CAPABILITY_ROWS = Object.freeze({
${rows}
});

const BUNDLED_SKILL_FILESYSTEM_ROWS = Object.freeze({
${filesystemRows}
});

const EMPTY_FILESYSTEM_POLICY = Object.freeze([
  Object.freeze([]),
  Object.freeze([]),
]);

const BUNDLED_SKILL_CAPABILITY_CATALOG = Object.freeze(
  Object.fromEntries(
    Object.entries(BUNDLED_SKILL_CAPABILITY_ROWS).map(
      ([skillId, [sourceSha256, executionCapabilities]]) => {
        const [filesystemOperations, filesystemRoots] =
          BUNDLED_SKILL_FILESYSTEM_ROWS[skillId] || EMPTY_FILESYSTEM_POLICY;
        return [
          skillId,
          Object.freeze({
            skillId,
            handlerRelativePath: "handler.js",
            sourceSha256,
            executionCapabilities,
            filesystemOperations,
            filesystemRoots,
          }),
        ];
      },
    ),
  ),
);

module.exports = { BUNDLED_SKILL_CAPABILITY_CATALOG };
`;
  const prettierConfig = (await prettier.resolveConfig(CATALOG_PATH)) || {};
  return await prettier.format(rawCatalog, {
    ...prettierConfig,
    filepath: CATALOG_PATH,
  });
}

async function applyOrCheck(entries, { write = false } = {}) {
  const drift = [];
  for (const entry of entries) {
    const current = fs.readFileSync(entry.manifestPath, "utf8");
    const expected = renderManifest(current, entry);
    if (current !== expected) {
      if (write) fs.writeFileSync(entry.manifestPath, expected, "utf8");
      else drift.push(path.relative(PROJECT_ROOT, entry.manifestPath));
    }
  }
  const expectedCatalog = await renderCatalog(entries);
  const currentCatalog = fs.existsSync(CATALOG_PATH)
    ? fs.readFileSync(CATALOG_PATH, "utf8")
    : "";
  if (currentCatalog !== expectedCatalog) {
    if (write) fs.writeFileSync(CATALOG_PATH, expectedCatalog, "utf8");
    else drift.push(path.relative(PROJECT_ROOT, CATALOG_PATH));
  }
  if (drift.length > 0) {
    throw new Error(
      `Bundled Skill capability audit drift:\n${drift.map((item) => `- ${item}`).join("\n")}\nRun this script with --write and review every capability change.`,
    );
  }
}

function capabilitySummary(entries) {
  const counts = new Map();
  for (const entry of entries) {
    for (const capability of entry.executionCapabilities) {
      counts.set(capability, (counts.get(capability) || 0) + 1);
    }
  }
  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([capability, count]) => `${capability}=${count}`)
    .join(", ");
}

export async function auditBundledSkillCapabilities(options = {}) {
  const entries = discoverEntries();
  if (entries.length !== 145) {
    throw new Error(`Expected 145 bundled handlers, found ${entries.length}`);
  }
  await applyOrCheck(entries, options);
  return {
    count: entries.length,
    summary: capabilitySummary(entries),
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const write = process.argv.slice(2).includes("--write");
    const result = await auditBundledSkillCapabilities({ write });
    console.log(
      `Bundled Skill capability audit ${write ? "synchronized" : "verified"}: ${result.count}/145`,
    );
    console.log(result.summary);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
