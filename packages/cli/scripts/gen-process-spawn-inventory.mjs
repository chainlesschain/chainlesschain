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
const auditPolicyPath = resolve(here, "process-spawn-audit-policy.json");

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
const executableMethods =
  "(?:spawn|spawnSync|exec|execFile|execSync|execFileSync|fork)";

function readAuditPolicy() {
  const parsed = JSON.parse(readFileSync(auditPolicyPath, "utf-8"));
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.rules)) {
    throw new Error(`Invalid process spawn audit policy: ${auditPolicyPath}`);
  }
  for (const rule of parsed.rules) {
    if (
      !rule.id ||
      !["brokered", "audited-exemption"].includes(rule.disposition) ||
      (!rule.path && !rule.pathPrefix) ||
      !rule.reason ||
      !rule.owner ||
      !rule.reviewedAt
    ) {
      throw new Error(`Invalid process spawn audit rule: ${rule.id || "?"}`);
    }
  }
  return parsed;
}

const auditPolicy = readAuditPolicy();

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

function isNonExecutableMatch(text) {
  const trimmed = text.trim();
  if (/^(?:\/\/|\/\*|\*|\*\/)/.test(trimmed)) return true;
  if (
    /^(?:import|export)\b/.test(trimmed) &&
    /(?:child_process|node:child_process)/.test(trimmed)
  ) {
    return true;
  }
  if (
    new RegExp(
      `^(?:async\\s+)?${executableMethods}\\s*\\([^)]*\\)\\s*\\{`,
    ).test(trimmed)
  ) {
    return true;
  }
  if (
    /^(?:pattern:\s*)?\/.*\/[dgimsuvy]*,?$/.test(trimmed) ||
    /^message:\s*["'`].*child_process/.test(trimmed) ||
    /^["'`](?:node:)?child_process["'`],?$/.test(trimmed)
  ) {
    return true;
  }
  if (
    new RegExp(
      `^(?:const|let|var)\\s+\\w+\\s*=\\s*(?:_deps|deps)\\.${executableMethods}\\s*;?$`,
    ).test(trimmed)
  ) {
    return true;
  }
  return false;
}

function matchingAuditRule(relPath, text) {
  return auditPolicy.rules.find((rule) => {
    const pathMatches =
      rule.path === relPath ||
      (rule.pathPrefix && relPath.startsWith(rule.pathPrefix));
    if (!pathMatches) return false;
    if (!rule.match) return true;
    return new RegExp(rule.match).test(text);
  });
}

function brokerRouteEvidence(source, text) {
  if (
    /\b(?:executionBroker|broker|this\.executionBroker)\.(?:spawn|spawnSync|exec|execFile|execSync|execFileSync|fork)\b/.test(
      text,
    )
  ) {
    return "call targets ProcessExecutionBroker";
  }
  if (
    source.includes("/process-execution-broker/index.js") ||
    source.includes('"./process-execution-broker/index.js"') ||
    source.includes('"../lib/process-execution-broker/index.js"') ||
    source.includes("spawnWithDesktopBroker")
  ) {
    return "file default process seam is wired to ProcessExecutionBroker";
  }
  return null;
}

function auditRuntimeHit(relPath, text, source) {
  if (isNonExecutableMatch(text)) {
    return {
      disposition: "non-executable",
      evidence: "declaration/comment/type/regex lexical match",
    };
  }
  const rule = matchingAuditRule(relPath, text);
  if (rule) {
    return {
      disposition: rule.disposition,
      evidence: `${rule.id}: ${rule.reason}`,
    };
  }
  const evidence = brokerRouteEvidence(source, text);
  if (evidence) return { disposition: "brokered", evidence };
  return {
    disposition: "unreviewed",
    evidence: "no broker route or audited exemption matched",
  };
}

function collectHits() {
  const files = scanRoots.flatMap((root) => walk(resolve(repoRoot, root)));
  const hits = [];
  for (const file of files) {
    const relPath = toPosix(relative(repoRoot, file));
    const source = readFileSync(file, "utf-8");
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!childProcessPattern.test(line)) return;
      const hit = {
        file: relPath,
        line: index + 1,
        kind: classify(relPath),
        text: line.trim().replace(/\s+/g, " "),
      };
      if (hit.kind === "runtime") {
        Object.assign(hit, auditRuntimeHit(relPath, hit.text, source));
      }
      hits.push(hit);
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
  const runtimeDispositionCounts = [
    "brokered",
    "audited-exemption",
    "non-executable",
    "unreviewed",
  ]
    .map(
      (disposition) =>
        `${disposition}: ${
          hits.filter(
            (hit) => hit.kind === "runtime" && hit.disposition === disposition,
          ).length
        }`,
    )
    .join(", ");
  const lines = [
    "# Process Spawn Inventory",
    "",
    "> Generated from child process call-site scan. Do not edit by hand.",
    "> Regenerate with `npm run docs:spawn-inventory --workspace=packages/cli`.",
    "",
    `Total matches: ${hits.length} (${counts}).`,
    `Runtime audit: ${runtimeDispositionCounts}.`,
    "",
    "## Policy",
    "",
    "- `runtime` entries must migrate to `ProcessExecutionBroker` or carry an explicit audited exemption.",
    "- `non-executable` entries are lexical scan noise (imports, declarations, comments, types, or security regexes).",
    "- `unreviewed` must remain zero; `docs:spawn-inventory:check` fails closed otherwise.",
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
    if (kind === "runtime") {
      lines.push(
        "| File | Line | Disposition | Evidence | Match |",
        "| --- | ---: | --- | --- | --- |",
      );
    } else {
      lines.push("| File | Line | Match |", "| --- | ---: | --- |");
    }
    for (const item of items) {
      const escapedText = item.text.replaceAll("|", "\\|");
      if (kind === "runtime") {
        lines.push(
          `| \`${item.file}\` | ${item.line} | \`${item.disposition}\` | ${item.evidence.replaceAll("|", "\\|")} | \`${escapedText}\` |`,
        );
      } else {
        lines.push(`| \`${item.file}\` | ${item.line} | \`${escapedText}\` |`);
      }
    }
    lines.push("");
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function main(argv) {
  const args = argv.slice(2);
  const hits = collectHits();
  const md = renderMarkdown(hits);
  const unreviewed = hits.filter(
    (hit) => hit.kind === "runtime" && hit.disposition === "unreviewed",
  );
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
    if (unreviewed.length > 0) {
      process.stderr.write(
        `Unreviewed runtime process matches: ${unreviewed.length}\n`,
      );
      for (const hit of unreviewed) {
        process.stderr.write(`- ${hit.file}:${hit.line} ${hit.text}\n`);
      }
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
  if (args.includes("--check-unreviewed") && unreviewed.length > 0) {
    process.stderr.write(
      `Unreviewed runtime process matches: ${unreviewed.length}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(md);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv);
}

export { auditRuntimeHit, collectHits, isNonExecutableMatch, renderMarkdown };
