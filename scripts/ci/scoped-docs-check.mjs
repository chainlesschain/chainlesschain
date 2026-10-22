import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { TextDecoder } from "node:util";

// Deliberately narrow: content interpreted as runtime skills/config is excluded.
const MARKDOWN = new Set([
  "README.md",
  "README_EN.md",
  "CHANGELOG.md",
  "packages/cli/README.md",
  "packages/vscode-extension/README.md",
  "packages/jetbrains-plugin/README.md",
  "docs-site/docs/index.md",
  "docs-site/docs/chainlesschain/agent-platform-release.md",
  "docs-site/docs/chainlesschain/cli-ide-update-2026-10-20.md",
  "docs-site/docs/chainlesschain/goal-drafts-current.md",
]);
const EVIDENCE =
  /^docs\/research\/cli\/evidence\/release[1-9][0-9]*-public\/(cli|open-vsx|jetbrains|gates|publication)\.json$/;
const HELPER = "scripts/ci/scoped-docs-check.mjs";
const WORKFLOW = ".github/workflows/_scoped-docs-check.yml";
const sha = (value) =>
  typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
const require = (ok, message) => {
  if (!ok) throw new Error(message);
};
const git = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }).trimEnd();
const existsAt = (commit, path) => {
  try {
    git("cat-file", "-e", `${commit}:${path}`);
    return true;
  } catch {
    return false;
  }
};
const utf8 = new TextDecoder("utf-8", { fatal: true });

function textAt(commit, path) {
  const tree = git("ls-tree", commit, "--", path);
  require(/^100644 blob [0-9a-f]{40}\t/.test(
    tree,
  ), `Not a regular non-executable file: ${path}`);
  const size = Number(git("cat-file", "-s", `${commit}:${path}`));
  require(Number.isSafeInteger(size) &&
    size > 0 &&
    size <= 5_000_000, `Invalid document size: ${path}`);
  const raw = execFileSync("git", ["show", `${commit}:${path}`], {
    maxBuffer: 5_000_001,
  });
  const text = utf8.decode(raw);
  require(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(
    text,
  ), `Control bytes: ${path}`);
  require(!/^([<]{7}|[=]{7}|[>]{7})(?:\s|$)/m.test(
    text,
  ), `Unresolved conflict marker: ${path}`);
  return text;
}

function markdown(text, path) {
  require(text.trim().length > 0, `Empty Markdown: ${path}`);
  let fence = null;
  const pageLines = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (
        match &&
        match[1][0] === fence.char &&
        match[1].length >= fence.length &&
        !match[2].trim()
      )
        fence = null;
      continue;
    }
    if (match) {
      require(!(
        match[1][0] === "`" && match[2].includes("`")
      ), `Invalid code fence: ${path}`);
      fence = { char: match[1][0], length: match[1].length };
      continue;
    }
    pageLines.push(line);
  }
  require(fence === null, `Unclosed code fence: ${path}`);
  const page = pageLines.join("\n");
  // Encoded characters can hide an active URL in raw HTML or Markdown links.
  // Route either snapshot to full code checks without rejecting the document.
  if (/&#(?:x[0-9a-f]+|[0-9]+);?|&(?:colon|tab|newline|amp);?/i.test(page))
    return true;
  const compactPage = page.replace(/[\t\r\n]/g, "");
  // Vue directives/interpolation, MDX, active URLs/attributes and unknown tags
  // select code checks. This is intentionally conservative, not a Vue parser.
  if (
    /(?:javascript|vbscript|data)\s*:/i.test(compactPage) ||
    /\{\{|\}\}|\bon[a-z]+\s*=|\bstyle\s*=/i.test(page) ||
    /^\s*(?:import|export)\s/m.test(page) ||
    /(?:^|\s)(?:v-[\w-]+|[:@#][\w:[\].-]+)\s*(?:=|(?=\s|\/?>))/m.test(page)
  )
    return true;
  const passiveTags = new Set([
    "a",
    "p",
    "img",
    "br",
    "div",
    "span",
    "details",
    "summary",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "th",
    "td",
    "ol",
    "ul",
    "li",
    "strong",
    "em",
    "b",
    "i",
    "blockquote",
    "code",
    "pre",
    "hr",
    "kbd",
    "sub",
    "sup",
    "s",
    "mark",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "dl",
    "dt",
    "dd",
  ]);
  // Standard Markdown URL/email autolinks are not component tags.
  const withoutAutolinks = page.replace(
    /<(?:https?:\/\/[^<>\s]+|mailto:[^<>\s]+|[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)>/gi,
    "",
  );
  for (const match of withoutAutolinks.matchAll(
    /<\s*\/?\s*([A-Za-z][\w:.-]*)/g,
  )) {
    if (!passiveTags.has(match[1])) return true;
  }
  return false;
}

function checkFormatting(target, paths) {
  const lock = JSON.parse(git("show", `${target}:package-lock.json`));
  const pinned = lock.packages?.["node_modules/prettier"];
  require(pinned &&
    /^\d+\.\d+\.\d+$/.test(pinned.version) &&
    pinned.resolved ===
      `https://registry.npmjs.org/prettier/-/prettier-${pinned.version}.tgz` &&
    /^sha512-[A-Za-z0-9+/]{86}==$/.test(pinned.integrity) &&
    !pinned.dependencies &&
    !pinned.optionalDependencies, "Expected a standalone, integrity-pinned Prettier entry in repository lockfile");
  require(process.env.RUNNER_TEMP, "Missing RUNNER_TEMP");
  const folder = mkdtempSync(
    join(process.env.RUNNER_TEMP, "scoped-docs-prettier-"),
  );
  const manifest = {
    name: "scoped-docs-format-check",
    version: "1.0.0",
    private: true,
    dependencies: { prettier: pinned.version },
  };
  const isolatedLock = {
    name: manifest.name,
    version: manifest.version,
    lockfileVersion: 3,
    packages: {
      "": {
        name: manifest.name,
        version: manifest.version,
        dependencies: manifest.dependencies,
      },
      "node_modules/prettier": {
        version: pinned.version,
        resolved: pinned.resolved,
        integrity: pinned.integrity,
        bin: pinned.bin,
        engines: pinned.engines,
      },
    },
  };
  writeFileSync(join(folder, "package.json"), JSON.stringify(manifest));
  writeFileSync(
    join(folder, "package-lock.json"),
    JSON.stringify(isolatedLock),
  );
  // Install just the locked formatter in RUNNER_TEMP, never the repository workspace.
  execFileSync(
    "npm",
    [
      "ci",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--workspaces=false",
      "--registry=https://registry.npmjs.org",
    ],
    { cwd: folder, stdio: "inherit", timeout: 120_000 },
  );
  const emptyIgnore = join(folder, "empty.ignore");
  writeFileSync(emptyIgnore, "");
  // The reviewed repository has no static Prettier options for these paths;
  // an inert empty JSON object preserves its defaults without discovering code.
  const inertConfig = join(folder, "prettier-options.json");
  writeFileSync(inertConfig, "{}\n");
  for (const [extension, parser] of [
    [".md", "markdown"],
    [".json", "json"],
  ]) {
    const selected = paths.filter((path) => path.endsWith(extension));
    if (!selected.length) continue;
    execFileSync(
      process.execPath,
      [
        join(folder, "node_modules/prettier/bin/prettier.cjs"),
        "--check",
        "--config",
        inertConfig,
        "--config-precedence",
        "cli-override",
        "--no-editorconfig",
        "--parser",
        parser,
        "--ignore-path",
        emptyIgnore,
        ...selected,
      ],
      { stdio: "inherit", timeout: 120_000 },
    );
  }
}

function emit(target, docsOnly, reason, files = []) {
  const output = `docs_only=${docsOnly}\ndocs_validated=${docsOnly}\ntarget_sha=${target}\n`;
  require(process.env.GITHUB_OUTPUT, "Missing GITHUB_OUTPUT");
  appendFileSync(process.env.GITHUB_OUTPUT, output);
  const report = {
    targetSha: target,
    mode: docsOnly ? "validated-scoped-docs" : "full-code-checks-required",
    reason,
    files,
  };
  console.log(JSON.stringify(report, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Scoped documentation decision\n\nTarget: \`${target}\`\n\nMode: **${report.mode}**\n\n${reason}\n\n${docsOnly ? "Validated Markdown, JSON syntax and formatting. Code tests were not run by this job; no previous check status was copied." : "The existing code jobs must complete normally."}\n`,
    );
}

function main() {
  const target = process.env.DOCS_TARGET_SHA;
  require(sha(target) &&
    git("rev-parse", "HEAD") ===
      target, "Target must match the exact checked-out SHA");
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const kind = process.env.GITHUB_EVENT_NAME;
  let base;
  if (kind === "pull_request") {
    require(event.pull_request?.head?.sha === target &&
      sha(event.pull_request?.base?.sha), "PR source identity mismatch");
    try {
      base = git("merge-base", event.pull_request.base.sha, target);
    } catch {
      emit(target, false, "Cannot establish complete PR diff");
      return;
    }
  } else if (kind === "push") {
    require(process.env.GITHUB_SHA === target, "Push source identity mismatch");
    base = event.before;
    if (!sha(base) || /^0+$/.test(base)) {
      emit(target, false, "New ref or unknown push baseline");
      return;
    }
    try {
      git("merge-base", "--is-ancestor", base, target);
    } catch {
      emit(target, false, "Push baseline missing or non-ancestor");
      return;
    }
  } else {
    emit(
      target,
      false,
      "Manual/scheduled/release validation always uses code checks",
    );
    return;
  }
  if (!existsAt(base, HELPER) || !existsAt(base, WORKFLOW)) {
    emit(
      target,
      false,
      "First installation of CI policy must run full code checks",
    );
    return;
  }
  let entries;
  try {
    const raw = git(
      "diff",
      "--name-status",
      "-z",
      "--no-renames",
      base,
      target,
      "--",
    );
    const fields = raw.split("\0");
    if (fields.at(-1) === "") fields.pop();
    require(fields.length % 2 === 0, "Malformed git diff");
    entries = [];
    for (let i = 0; i < fields.length; i += 2)
      entries.push({ status: fields[i], path: fields[i + 1] });
  } catch {
    emit(target, false, "Cannot establish complete changed-file list");
    return;
  }
  if (!entries.length) {
    emit(target, false, "Empty diff is not docs-only evidence");
    return;
  }
  const allowed = entries.every(
    ({ status, path }) =>
      (MARKDOWN.has(path) && ["A", "M"].includes(status)) ||
      // Historical public evidence is immutable; edits/deletions do not get an exemption.
      (EVIDENCE.test(path) && status === "A"),
  );
  if (!allowed) {
    emit(
      target,
      false,
      "Change includes code, policy, metadata, history edits, deletion or an unapproved path",
      entries,
    );
    return;
  }
  let activeMarkdown = false;
  for (const { path, status } of entries) {
    const text = textAt(target, path);
    if (MARKDOWN.has(path)) {
      const targetActive = markdown(text, path);
      const baselineActive =
        status === "M" ? markdown(textAt(base, path), path) : false;
      activeMarkdown = activeMarkdown || targetActive || baselineActive;
    }
    // Publication truth remains the responsibility of existing release/readback tools.
    else JSON.parse(text);
  }
  if (activeMarkdown) {
    emit(
      target,
      false,
      "Markdown baseline or target contains active/unknown page syntax; full code checks required",
      entries,
    );
    return;
  }
  checkFormatting(
    target,
    entries.map(({ path }) => path),
  );
  emit(
    target,
    true,
    "Every changed file is on the narrow allowlist and passed document syntax and formatting checks",
    entries,
  );
}

main();
