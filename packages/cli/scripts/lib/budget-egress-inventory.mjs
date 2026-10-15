import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

// Developer-side audit tooling; acorn is a declared repository dependency.
const { parse } = createRequire(import.meta.url)("acorn");
export const SOURCE_REVIEW_SCHEMA =
  "chainlesschain.budget-egress-source-review/v1";
export const sha256 = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");

const MODULE_KINDS = new Map([
  ["http", "http"],
  ["node:http", "http"],
  ["https", "http"],
  ["node:https", "http"],
  ["net", "socket"],
  ["node:net", "socket"],
  ["tls", "socket"],
  ["node:tls", "socket"],
  ["undici", "http"],
  ["node-fetch", "fetch"],
  ["cross-fetch", "fetch"],
  ["axios", "http"],
  ["got", "http"],
  ["ws", "websocket"],
  ["openai", "sdk"],
  ["@anthropic-ai/sdk", "sdk"],
  ["@google/generative-ai", "sdk"],
]);
const SDK_METHODS = new Set([
  "create",
  "send",
  "invoke",
  "post",
  "request",
  "get",
  "generateContent",
  "stream",
  "chat",
  "complete",
]);
const SDK_CONSTRUCTORS = new Set([
  "OpenAI",
  "AzureOpenAI",
  "Anthropic",
  "GoogleGenerativeAI",
]);
function importedKind(kind, name) {
  if (name === "default") return kind;
  if (name === "fetch") return "fetch";
  if (kind === "http" && ["request", "get", "post", "stream"].includes(name))
    return "network-function";
  if (kind === "socket" && ["connect", "createConnection"].includes(name))
    return "network-function";
  if (kind === "websocket" && name === "WebSocket") return "websocket";
  if (kind === "sdk" && SDK_CONSTRUCTORS.has(name)) return "sdk";
  return null;
}
const propertyName = (node) =>
  node?.computed
    ? typeof node.property?.value === "string"
      ? node.property.value
      : null
    : node?.property?.name;

function walk(node, visit) {
  if (!node || typeof node.type !== "string") return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) if (child?.type) walk(child, visit);
    } else if (value?.type) walk(value, visit);
  }
}

/**
 * Static candidates, not a call graph or permission authority. Bindings are
 * deliberately conservative across lexical scopes. Dynamic properties, eval,
 * native addons, arbitrary SDKs and descendant execution remain outside proof.
 */
export function collectNetworkCalls(source, { commonJs = false } = {}) {
  const ast = parse(source, {
    ecmaVersion: "latest",
    sourceType: commonJs ? "script" : "module",
    allowReturnOutsideFunction: commonJs,
    locations: true,
    allowHashBang: true,
  });
  const bindings = new Map([
    ["fetch", "fetch"],
    ["fetchImpl", "fetch"],
    ["providerFetch", "governed-fetch"],
    ["WebSocket", "websocket"],
  ]);
  const declarations = [];
  walk(ast, (node) => {
    if (node.type === "ImportDeclaration") {
      const kind = MODULE_KINDS.get(node.source.value);
      if (!kind) return;
      for (const item of node.specifiers) {
        const bindingKind =
          item.type !== "ImportSpecifier"
            ? kind
            : importedKind(kind, item.imported?.name ?? item.imported?.value);
        if (bindingKind) bindings.set(item.local.name, bindingKind);
      }
    }
    if (node.type === "VariableDeclarator") declarations.push(node);
    if (node.type === "AssignmentExpression" && node.operator === "=")
      declarations.push({ id: node.left, init: node.right });
  });

  function valueKind(node) {
    if (!node) return null;
    if (node.type === "ChainExpression") return valueKind(node.expression);
    if (node.type === "Identifier") return bindings.get(node.name) || null;
    if (node.type === "MemberExpression") {
      const name = propertyName(node);
      if (name === "fetch" || name === "fetchImpl") return "fetch";
      if (name === "providerFetch") return "governed-fetch";
      if (["http", "https", "undici"].includes(name)) return "http";
      if (["net", "tls"].includes(name)) return "socket";
      if (name === "WebSocket") return "websocket";
      const kind = valueKind(node.object);
      if (name === "default") return kind;
      if (name === "bind") return kind;
      if (kind === "sdk") return kind;
      if (
        kind === "http" &&
        ["get", "request", "post", "stream"].includes(name)
      )
        return "network-function";
      if (kind === "socket" && ["connect", "createConnection"].includes(name))
        return "network-function";
      return null;
    }
    if (node.type === "ConditionalExpression")
      return valueKind(node.consequent) || valueKind(node.alternate);
    if (node.type === "LogicalExpression")
      return valueKind(node.left) || valueKind(node.right);
    if (node.type === "AwaitExpression") return valueKind(node.argument);
    if (node.type === "ImportExpression")
      return MODULE_KINDS.get(node.source?.value) || null;
    if (node.type === "CallExpression") {
      if (node.callee.type === "Identifier" && node.callee.name === "require")
        return MODULE_KINDS.get(node.arguments[0]?.value) || null;
      if (
        node.callee.type === "MemberExpression" &&
        propertyName(node.callee) === "bind"
      )
        return valueKind(node.callee.object);
    }
    if (node.type === "NewExpression") return valueKind(node.callee);
    return null;
  }
  // Resolve ordinary import/require, destructured and conditional HTTP aliases.
  // A bounded fixed point prevents pathological source from blocking an audit.
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    const bind = (name, kind) => {
      if (kind && !bindings.has(name)) {
        bindings.set(name, kind);
        changed = true;
      }
    };
    for (const { id, init } of declarations) {
      const kind = valueKind(init);
      if (id.type === "Identifier") bind(id.name, kind);
      else if (id.type === "ObjectPattern") {
        for (const item of id.properties) {
          if (item.type !== "Property" || item.value.type !== "Identifier")
            continue;
          const name = item.key.name || item.key.value;
          bind(
            item.value.name,
            name === "fetch"
              ? "fetch"
              : kind && importedKind(kind, name)
                ? importedKind(kind, name)
                : ["http", "https"].includes(name)
                  ? "http"
                  : null,
          );
        }
      }
    }
    if (!changed) break;
  }
  const calls = [];
  walk(ast, (node) => {
    if (node.type !== "CallExpression" && node.type !== "NewExpression") return;
    const kind = valueKind(node.callee);
    if (!kind) return;
    const member = node.callee.type === "MemberExpression";
    if (
      kind === "sdk" &&
      node.type !== "NewExpression" &&
      (!member || !SDK_METHODS.has(propertyName(node.callee)))
    )
      return;
    // Module constructors/factories (URL, server creation, EventEmitter, etc.)
    // are not physical outbound calls. An SDK constructor remains a candidate.
    if (member && ["bind", "createServer"].includes(propertyName(node.callee)))
      return;
    if (node.type === "NewExpression" && !["websocket", "sdk"].includes(kind))
      return;
    calls.push({
      line: node.loc.start.line,
      column: node.loc.start.column,
      callee: source.slice(node.callee.start, node.callee.end),
      kind,
    });
  });
  return calls.sort((a, b) => a.line - b.line || a.column - b.column);
}

export function scanNetworkSources(repository, roots = ["packages/cli/src"]) {
  if (!Array.isArray(roots) || roots.length === 0)
    throw new Error("Nonempty audit roots required");
  const repositoryRoot = fs.realpathSync(repository);
  const files = [],
    candidates = [],
    parseErrors = [],
    skippedPaths = [];
  const relative = (file) =>
    path.relative(repositoryRoot, file).split(path.sep).join("/");
  const inside = (file) => {
    const rel = path.relative(repositoryRoot, file);
    return (
      rel === "" ||
      (!path.isAbsolute(rel) &&
        rel !== ".." &&
        !rel.startsWith(".." + path.sep))
    );
  };
  function scan(directory) {
    for (const item of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, item.name),
        name = relative(absolute);
      if (item.isSymbolicLink()) {
        skippedPaths.push({ path: name, reason: "symlink-not-followed" });
        continue;
      }
      if (item.isDirectory()) {
        if (["__tests__", "node_modules", ".git"].includes(item.name)) continue;
        scan(absolute);
      } else if (item.isFile() && /\.(?:js|mjs|cjs)$/u.test(item.name)) {
        const bytes = fs.readFileSync(absolute),
          digest = sha256(bytes);
        files.push({ path: name, digest });
        try {
          const calls = collectNetworkCalls(bytes.toString("utf8"), {
            commonJs: item.name.endsWith(".cjs"),
          });
          if (calls.length) candidates.push({ path: name, digest, calls });
        } catch (error) {
          parseErrors.push({
            path: name,
            digest,
            line: error.loc?.line ?? null,
            reason: String(error.message).slice(0, 200),
          });
        }
      }
    }
  }
  for (const root of roots) {
    const absolute = path.resolve(repositoryRoot, root);
    if (!inside(absolute) || !inside(fs.realpathSync(absolute)))
      throw new Error("Audit root escapes repository");
    if (fs.lstatSync(absolute).isSymbolicLink()) {
      skippedPaths.push({
        path: relative(absolute),
        reason: "symlink-not-followed",
      });
      continue;
    }
    scan(absolute);
  }
  return {
    auditRoots: roots.map((root) =>
      relative(path.resolve(repositoryRoot, root)),
    ),
    filesScanned: files.length,
    sourceTreeDigest: sha256(JSON.stringify(files)),
    networkCandidates: candidates,
    parseErrors,
    skippedPaths,
  };
}

export const SOURCE_REVIEW_CATEGORIES = Object.freeze([
  "MODEL_REQUEST",
  "BUDGET_BOUNDARY",
  "TASK_CONTROLLED_NETWORK",
  "SERVICE_API",
  "DISTRIBUTION",
  "LOCAL_DIAGNOSTIC",
  "CONTENT_ADDRESSED_DATA",
  "PAID_SEARCH_SERVICE",
  "LOCAL_IPC",
  "REMOTE_EXECUTION_CONTROL",
]);

export function reviewNetworkSources(scan, catalogue) {
  if (
    catalogue?.schema !== SOURCE_REVIEW_SCHEMA ||
    !Array.isArray(catalogue.entries) ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(catalogue.reviewedAt || "") ||
    !Number.isFinite(Date.parse(catalogue.reviewedAt))
  )
    throw new Error("Invalid budget source review catalogue");
  const entries = new Map(),
    issues = [],
    rows = [],
    outOfScopeReviewedPaths = [];
  for (const item of catalogue.entries) {
    if (
      !item ||
      typeof item.path !== "string" ||
      entries.has(item.path) ||
      !/^sha256:[a-f0-9]{64}$/u.test(item.digest || "") ||
      !SOURCE_REVIEW_CATEGORIES.includes(item.category) ||
      typeof item.rationale !== "string" ||
      !item.rationale.trim()
    )
      throw new Error("Invalid or duplicate budget source review entry");
    entries.set(item.path, item);
  }
  for (const item of entries.values()) {
    if (
      Array.isArray(scan.auditRoots) &&
      !scan.auditRoots.some(
        (root) =>
          !root || item.path === root || item.path.startsWith(root + "/"),
      )
    ) {
      outOfScopeReviewedPaths.push(item.path);
      entries.delete(item.path);
    }
  }
  for (const candidate of scan.networkCandidates) {
    const entry = entries.get(candidate.path);
    const status = !entry
      ? "UNREVIEWED"
      : entry.digest !== candidate.digest
        ? "STALE"
        : "REVIEWED";
    if (status !== "REVIEWED") issues.push({ path: candidate.path, status });
    rows.push({
      path: candidate.path,
      status,
      category: status === "REVIEWED" ? entry.category : null,
      rationale: status === "REVIEWED" ? entry.rationale : null,
      digest: candidate.digest,
    });
    entries.delete(candidate.path);
  }
  for (const item of entries.values())
    issues.push({ path: item.path, status: "REMOVED_OR_NO_LONGER_CANDIDATE" });
  return {
    sourceReviewPassed:
      issues.length === 0 &&
      scan.parseErrors.length === 0 &&
      scan.skippedPaths.length === 0,
    runtimeCoverageVerified: false,
    outOfScopeReviewedPaths,
    issues,
    rows,
  };
}
