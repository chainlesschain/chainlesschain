#!/usr/bin/env node
/**
 * Generate (or byte-diff-check) an inventory of direct child_process usage.
 *
 * This is the M0 fact baseline for the ProcessExecutionBroker migration: it
 * gives reviewers and CI a deterministic list of places that must either move
 * behind the broker or be documented as audited exemptions.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

const scanRoots = [
  "packages/cli/bin",
  "packages/cli/src",
  "packages/cli/scripts",
  "packages/agent-sdk/src",
  "desktop-app-vue/scripts",
  "desktop-app-vue/src/main/ai-engine/code-agent",
  "desktop-app-vue/src/main/ipc",
];

const sourceExtensions = new Set([".js", ".cjs", ".mjs", ".ts", ".tsx"]);
const skipDirs = new Set([".git", "node_modules", "dist", "out", "coverage"]);
const childProcessPattern =
  /(?:child_process|node:child_process|\b(?:cpDefault|childProcess|_deps|deps)\.(?:spawn|spawnSync|exec|execFile|execSync|execFileSync|fork)\b|\b(?:spawn|spawnSync|execFile|execSync|execFileSync|fork)\s*\()/;

function toPosix(pathname) {
  return pathname.split(sep).join("/");
}

function extname(filename) {
  const index = filename.lastIndexOf(".");
  return index === -1 ? "" : filename.slice(index);
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (skipDirs.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (stat.isFile() && sourceExtensions.has(extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

function classify(relPath) {
  if (relPath.includes("/__tests__/") || relPath.includes("/test/")) {
    return "test";
  }
  if (
    relPath.includes("/src/assets/") ||
    relPath.startsWith("packages/cli/scripts/") ||
    relPath.startsWith("desktop-app-vue/scripts/")
  ) {
    return "tooling";
  }
  return "runtime";
}

function collectHits() {
  const files = scanRoots.flatMap((root) => walk(resolve(repoRoot, root)));
  const hits = [];
  for (const file of files) {
    const relPath = toPosix(relative(repoRoot, file));
    const lines = readFileSync(file, "utf-8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!childProcessPattern.test(line)) return;
      hits.push({
        file: relPath,
        line: index + 1,
        kind: classify(relPath),
        text: line.trim().replace(/\s+/g, " "),
      });
    });
  }
  return hits.sort((a, b) =>
    `${a.kind}:${a.file}:${String(a.line).padStart(8, "0")}`.localeCompare(
      `${b.kind}:${b.file}:${String(b.line).padStart(8, "0")}`,
    ),
  );
}

function renderMarkdown(hits) {
  const byKind = new Map();
  for (const hit of hits) {
    if (!byKind.has(hit.kind)) byKind.set(hit.kind, []);
    byKind.get(hit.kind).push(hit);
  }
  const counts = ["runtime", "tooling", "test"]
    .map((kind) => `${kind}: ${byKind.get(kind)?.length || 0}`)
    .join(", ");
  const lines = [
    "# Process Spawn Inventory",
    "",
    "> Generated from child process call-site scan. Do not edit by hand.",
    "> Regenerate with `npm run docs:spawn-inventory --workspace=packages/cli`.",
    "",
    `Total matches: ${hits.length} (${counts}).`,
    "",
    "## Policy",
    "",
    "- `runtime` entries must migrate to `ProcessExecutionBroker` or carry an explicit audited exemption.",
    "- `tooling` entries are allowed for repository maintenance scripts but must not be used as runtime proof.",
    "- `test` entries are inventory noise unless they launch real runtime processes; keep them visible for drift review.",
    "",
  ];
  for (const kind of ["runtime", "tooling", "test"]) {
    const items = byKind.get(kind) || [];
    lines.push(`## ${kind}`, "");
    if (items.length === 0) {
      lines.push("_No matches._", "");
      continue;
    }
    lines.push("| File | Line | Match |", "| --- | ---: | --- |");
    for (const item of items) {
      lines.push(
        `| \`${item.file}\` | ${item.line} | \`${item.text.replaceAll("|", "\\|")}\` |`,
      );
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function main(argv) {
  const args = argv.slice(2);
  const md = renderMarkdown(collectHits());
  const outIdx = args.indexOf("--out");
  if (outIdx !== -1) {
    const outPath = args[outIdx + 1];
    if (!outPath) {
      process.stderr.write("--out requires a doc path\n");
      process.exit(2);
    }
    writeFileSync(outPath, md, "utf-8");
    process.stdout.write(`Wrote ${outPath}\n`);
    return;
  }
  const checkIdx = args.indexOf("--check");
  if (checkIdx !== -1) {
    const docPath = args[checkIdx + 1];
    if (!docPath) {
      process.stderr.write("--check requires a doc path\n");
      process.exit(2);
    }
    let current;
    try {
      current = readFileSync(docPath, "utf-8");
    } catch (err) {
      process.stderr.write(`Cannot read ${docPath}: ${err.message}\n`);
      process.exit(1);
    }
    if (current === md) {
      process.stdout.write(`No drift: ${docPath} matches the scan.\n`);
      return;
    }
    process.stderr.write(`Process spawn inventory drift in ${docPath}.\n`);
    process.exit(1);
    return;
  }
  process.stdout.write(md);
}

main(process.argv);
