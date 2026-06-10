/**
 * Project inventory — offline resource census for `cc init --memory`.
 *
 * Scans the target folder (bounded walk: depth/entry caps, heavy dirs
 * skipped) and produces a deterministic snapshot of what is already there:
 * languages by extension, package manager, npm scripts, workspaces/monorepo
 * layout, notable tool configs (TS/bundlers/docker/CI/lint), test runners and
 * a README summary. `renderMemoryFile` turns that snapshot into a starter
 * `cc.md` project-memory file (the file `cc agent` auto-loads — see
 * project-instructions.js). No LLM, no network: the census is pure I/O and
 * unit-testable via the `deps` seam; reads are explicit UTF-8 (encoding.md).
 */

import fsDefault from "fs";
import pathDefault from "path";

export const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".venv",
  "venv",
  "__pycache__",
  "target",
  ".gradle",
  ".idea",
  ".vscode",
  "Pods",
  "DerivedData",
]);

export const DEFAULT_MAX_DEPTH = 4;
export const DEFAULT_MAX_ENTRIES = 20000;

const EXT_LANG = {
  ".js": "JavaScript",
  ".cjs": "JavaScript",
  ".mjs": "JavaScript",
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".jsx": "JavaScript",
  ".vue": "Vue",
  ".py": "Python",
  ".java": "Java",
  ".kt": "Kotlin",
  ".kts": "Kotlin",
  ".swift": "Swift",
  ".go": "Go",
  ".rs": "Rust",
  ".rb": "Ruby",
  ".php": "PHP",
  ".cs": "C#",
  ".c": "C",
  ".h": "C/C++ header",
  ".cpp": "C++",
  ".cc": "C++",
  ".m": "Objective-C",
  ".sql": "SQL",
  ".sh": "Shell",
  ".ps1": "PowerShell",
  ".md": "Markdown",
};

const CONFIG_MARKERS = [
  ["tsconfig.json", "TypeScript"],
  ["vite.config.js", "Vite"],
  ["vite.config.ts", "Vite"],
  ["webpack.config.js", "Webpack"],
  ["rollup.config.js", "Rollup"],
  ["next.config.js", "Next.js"],
  ["nuxt.config.ts", "Nuxt"],
  ["docker-compose.yml", "Docker Compose"],
  ["docker-compose.yaml", "Docker Compose"],
  ["Dockerfile", "Docker"],
  ["pom.xml", "Maven"],
  ["build.gradle", "Gradle"],
  ["build.gradle.kts", "Gradle (Kotlin DSL)"],
  ["settings.gradle.kts", "Gradle (Kotlin DSL)"],
  ["Cargo.toml", "Cargo / Rust"],
  ["go.mod", "Go modules"],
  ["pyproject.toml", "Python (pyproject)"],
  ["requirements.txt", "Python (requirements)"],
  ["pubspec.yaml", "Flutter/Dart"],
  [".eslintrc.json", "ESLint"],
  ["eslint.config.js", "ESLint"],
  [".prettierrc", "Prettier"],
  ["vitest.config.js", "Vitest"],
  ["vitest.config.ts", "Vitest"],
  ["jest.config.js", "Jest"],
  ["playwright.config.ts", "Playwright"],
  ["electron-builder.yml", "electron-builder"],
];

const LOCKFILE_PM = [
  ["package-lock.json", "npm"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
];

function resolveDeps(opts) {
  return {
    fs: opts.deps?.fs || fsDefault,
    path: opts.deps?.path || pathDefault,
  };
}

function readJson(fs, p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function readText(fs, p) {
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

/** First markdown paragraph after the title — a cheap README synopsis. */
export function readmeSynopsis(text, maxChars = 400) {
  if (!text) return null;
  const lines = String(text).split(/\r?\n/);
  const out = [];
  let started = false;
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (started) break;
      continue;
    }
    if (/^#/.test(t) || /^!\[/.test(t) || /^<.*>$/.test(t) || /^\[!\[/.test(t))
      continue; // headings / badges / bare HTML
    out.push(t);
    started = true;
  }
  const para = out.join(" ").trim();
  if (!para) return null;
  return para.length > maxChars ? `${para.slice(0, maxChars)}…` : para;
}

/**
 * Walk the tree (bounded) counting files per language and remembering
 * top-level directories with file counts.
 */
function census(root, { fs, path, maxDepth, maxEntries }) {
  const languages = new Map(); // lang -> count
  const topDirs = new Map(); // top-level dir -> file count
  let entries = 0;
  let truncated = false;

  const walk = (dir, depth, top) => {
    if (entries >= maxEntries) {
      truncated = true;
      return;
    }
    let list;
    try {
      list = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      if (entries >= maxEntries) {
        truncated = true;
        return;
      }
      entries += 1;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
        if (depth < maxDepth) {
          walk(path.join(dir, e.name), depth + 1, top || e.name);
        }
      } else if (e.isFile()) {
        if (top) topDirs.set(top, (topDirs.get(top) || 0) + 1);
        const ext = path.extname(e.name).toLowerCase();
        const lang = EXT_LANG[ext];
        if (lang) languages.set(lang, (languages.get(lang) || 0) + 1);
      }
    }
  };
  walk(root, 0, null);
  return { languages, topDirs, truncated };
}

/**
 * Inventory the folder. Pure data out — rendering is separate.
 *
 * @param {string} cwd
 * @param {object} [opts] { deps, maxDepth, maxEntries }
 */
export function inventoryProject(cwd, opts = {}) {
  const { fs, path } = resolveDeps(opts);
  const root = path.resolve(cwd);
  const maxDepth = Number.isFinite(opts.maxDepth)
    ? opts.maxDepth
    : DEFAULT_MAX_DEPTH;
  const maxEntries = Number.isFinite(opts.maxEntries)
    ? opts.maxEntries
    : DEFAULT_MAX_ENTRIES;

  const pkg = readJson(fs, path.join(root, "package.json"));

  let packageManager = null;
  for (const [lock, pm] of LOCKFILE_PM) {
    if (fs.existsSync(path.join(root, lock))) {
      packageManager = pm;
      break;
    }
  }

  const configs = [];
  for (const [file, label] of CONFIG_MARKERS) {
    if (fs.existsSync(path.join(root, file)) && !configs.includes(label)) {
      configs.push(label);
    }
  }

  let ciWorkflows = 0;
  try {
    ciWorkflows = fs
      .readdirSync(path.join(root, ".github", "workflows"))
      .filter((f) => /\.ya?ml$/.test(f)).length;
  } catch {
    /* no CI dir */
  }

  const readme =
    readText(fs, path.join(root, "README.md")) ||
    readText(fs, path.join(root, "readme.md"));

  const { languages, topDirs, truncated } = census(root, {
    fs,
    path,
    maxDepth,
    maxEntries,
  });

  const workspaces = Array.isArray(pkg?.workspaces)
    ? pkg.workspaces
    : Array.isArray(pkg?.workspaces?.packages)
      ? pkg.workspaces.packages
      : [];

  const scripts = pkg?.scripts ? Object.entries(pkg.scripts) : [];

  const existingMemory = ["cc.md", "CLAUDE.md", "AGENTS.md"].filter((f) =>
    fs.existsSync(path.join(root, f)),
  );

  return {
    root,
    name: pkg?.name || path.basename(root),
    description: pkg?.description || null,
    synopsis: readmeSynopsis(readme),
    packageManager,
    configs,
    ciWorkflows,
    workspaces,
    scripts,
    languages: [...languages.entries()].sort((a, b) => b[1] - a[1]),
    topDirs: [...topDirs.entries()].sort((a, b) => b[1] - a[1]),
    truncated,
    existingMemory,
  };
}

/** Render the inventory as a starter cc.md project-memory file. */
export function renderMemoryFile(inv, opts = {}) {
  const today = opts.date || new Date().toISOString().slice(0, 10);
  const L = [];
  L.push(`# ${inv.name} — Project Memory`);
  L.push("");
  L.push(
    `> Generated by \`cc init --memory\` on ${today} from an inventory of this folder.`,
  );
  L.push(
    "> `cc agent` auto-loads this file as authoritative project context — edit freely.",
  );
  L.push("");

  if (inv.synopsis || inv.description) {
    L.push("## Overview");
    L.push("");
    L.push(inv.synopsis || inv.description);
    L.push("");
  }

  L.push("## Stack");
  L.push("");
  if (inv.languages.length) {
    const langs = inv.languages
      .slice(0, 8)
      .map(([lang, n]) => `${lang} (${n})`)
      .join(", ");
    L.push(`- Languages by file count: ${langs}${inv.truncated ? " — scan truncated" : ""}`);
  }
  if (inv.packageManager) L.push(`- Package manager: ${inv.packageManager}`);
  if (inv.configs.length) L.push(`- Tooling: ${inv.configs.join(", ")}`);
  if (inv.ciWorkflows)
    L.push(`- CI: GitHub Actions (${inv.ciWorkflows} workflows)`);
  L.push("");

  if (inv.scripts.length) {
    L.push("## Commands");
    L.push("");
    const pm = inv.packageManager || "npm";
    for (const [name, cmd] of inv.scripts.slice(0, 12)) {
      L.push(`- \`${pm} run ${name}\` — \`${cmd}\``);
    }
    if (inv.scripts.length > 12) {
      L.push(`- … ${inv.scripts.length - 12} more scripts in package.json`);
    }
    L.push("");
  }

  if (inv.workspaces.length || inv.topDirs.length) {
    L.push("## Layout");
    L.push("");
    if (inv.workspaces.length) {
      L.push(`- Workspaces: ${inv.workspaces.join(", ")}`);
    }
    for (const [dir, n] of inv.topDirs.slice(0, 10)) {
      L.push(`- \`${dir}/\` — ${n} files`);
    }
    L.push("");
  }

  L.push("## Conventions");
  L.push("");
  L.push("- (add project rules here — code style, commit format, test policy)");
  L.push("");
  return L.join("\n");
}

export const _deps = { fs: fsDefault, path: pathDefault };
