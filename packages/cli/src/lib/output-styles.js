/**
 * output-styles — Claude-Code `/output-style` parity. A named, reusable persona
 * layered onto the agent's system prompt, so `cc agent` can act as a different
 * kind of assistant while keeping its core coding capabilities.
 *
 * Styles are markdown files with frontmatter (`name`, `description`); the body
 * is appended to the system prompt (after the base + `--append-system-prompt`).
 * Discovered from `.chainlesschain/output-styles/` and `.claude/output-styles/`
 * (project) + `~/.claude/output-styles/` (personal); a couple of built-ins ship
 * so it works with no files. The active style comes from `--output-style`, then
 * the `outputStyle` field in `.claude/settings.json`.
 *
 * Pure + zero-dep frontmatter parse (mirrors slash-commands — no js-yaml).
 * `_deps` injection (fs / homedir) for tests.
 */

import fsDefault from "node:fs";
import pathDefault from "node:path";
import { homedir as homedirDefault } from "node:os";

export const _deps = {
  fs: fsDefault,
  path: pathDefault,
  homedir: homedirDefault,
};

/** Built-in styles (shadowed by a same-named file). `default` = no-op. */
export const BUILTIN_OUTPUT_STYLES = Object.freeze({
  default: {
    name: "default",
    description: "Standard coding assistant (no persona overlay).",
    body: "",
    builtin: true,
  },
  explanatory: {
    name: "explanatory",
    description: "Explains the reasoning and trade-offs behind changes.",
    body: [
      "## Output style: Explanatory",
      "As you work, weave in brief `★ Insight` notes that explain *why* you chose",
      "an approach and any non-obvious trade-offs, so the user learns from the",
      "changes. Keep insights short (1–2 sentences) and tied to what you just did;",
      "do not pad routine steps.",
    ].join("\n"),
    builtin: true,
  },
  learning: {
    name: "learning",
    description: "Collaborative — leaves small instructive pieces for the user.",
    body: [
      "## Output style: Learning",
      "Work collaboratively. When a small, well-scoped piece of the task would be",
      "instructive for the user to write themselves, pause and insert a",
      "`TODO(you):` marker with a one-line explanation of what to do and why,",
      "instead of writing that piece — then continue with the rest. Reserve this",
      "for genuinely educational spots, not boilerplate.",
    ].join("\n"),
    builtin: true,
  },
});

/** Parse `--- ... ---` frontmatter (zero-dep, camelCases keys). */
function parseFrontmatter(content) {
  const text = String(content || "");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text.trim() };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim();
    let value = trimmed.slice(colon + 1).trim();
    value = value.replace(/^(['"])([\s\S]*)\1$/, "$2");
    const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    data[camel] = value;
  }
  return { data, body: (m[2] || "").trim() };
}

/** Directories scanned for style files (project first, then personal). */
function styleDirs(cwd, home) {
  const { path } = _deps;
  return [
    { dir: path.join(cwd, ".chainlesschain", "output-styles"), scope: "project" },
    { dir: path.join(cwd, ".claude", "output-styles"), scope: "project" },
    { dir: path.join(home, ".claude", "output-styles"), scope: "personal" },
  ];
}

/** Discover all styles: built-ins + files (a file shadows a built-in by name). */
export function discoverOutputStyles(cwd = process.cwd(), opts = {}) {
  const { fs, path } = _deps;
  const home = opts.home || _deps.homedir();
  const byName = new Map();
  for (const b of Object.values(BUILTIN_OUTPUT_STYLES)) {
    byName.set(b.name, { ...b });
  }
  // Files win over built-ins; project wins over personal (scan personal first).
  for (const { dir, scope } of styleDirs(cwd, home).reverse()) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      const file = path.join(dir, e.name);
      let content;
      try {
        content = fs.readFileSync(file, "utf-8");
      } catch {
        continue;
      }
      const { data, body } = parseFrontmatter(content);
      const name = (data.name || e.name.replace(/\.md$/, "")).trim();
      if (!name) continue;
      byName.set(name, {
        name,
        description: data.description || "",
        body,
        scope,
        file,
        builtin: false,
      });
    }
  }
  return [...byName.values()];
}

/** Get one style by name (case-insensitive), or null. */
export function getOutputStyle(name, cwd = process.cwd(), opts = {}) {
  if (!name) return null;
  const target = String(name).trim().toLowerCase();
  return (
    discoverOutputStyles(cwd, opts).find(
      (s) => s.name.toLowerCase() === target,
    ) || null
  );
}

/** Read the `outputStyle` default from the settings.json hierarchy (last wins). */
export function settingsDefaultOutputStyle(cwd = process.cwd(), opts = {}) {
  const { fs, path } = _deps;
  const home = opts.home || _deps.homedir();
  const files = [
    path.join(home, ".claude", "settings.json"),
    path.join(cwd, ".claude", "settings.json"),
    path.join(cwd, ".claude", "settings.local.json"),
  ];
  let value = null;
  for (const f of files) {
    try {
      if (!fs.existsSync(f)) continue;
      const data = JSON.parse(fs.readFileSync(f, "utf-8"));
      if (data && typeof data.outputStyle === "string" && data.outputStyle.trim()) {
        value = data.outputStyle.trim();
      }
    } catch {
      // ignore malformed
    }
  }
  return value;
}

/**
 * Resolve the active style's body to append to the system prompt.
 * Precedence: explicit name → settings.json `outputStyle` → none.
 * Returns `{ name, body }` (body may be "" for `default`) or null if unresolved.
 */
export function resolveOutputStyle(explicitName, cwd = process.cwd(), opts = {}) {
  const name = (explicitName || settingsDefaultOutputStyle(cwd, opts) || "").trim();
  if (!name) return null;
  const style = getOutputStyle(name, cwd, opts);
  if (!style) return { name, body: "", missing: true };
  return { name: style.name, body: style.body || "" };
}
