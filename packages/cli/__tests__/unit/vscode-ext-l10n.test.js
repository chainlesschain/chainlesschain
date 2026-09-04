/**
 * l10n coverage gate for the VS Code extension. Guards the "真·本地化" work:
 *  1. every %key% placeholder in package.json resolves in BOTH package.nls.json
 *     (English base) and package.nls.zh-cn.json (Chinese), with no orphan keys;
 *  2. the en/zh NLS files have identical key sets;
 *  3. every vscode.l10n.t("…") base string and every static message constant
 *     passed through the localize wrapper has a matching key in
 *     l10n/bundle.l10n.zh-cn.json (so a zh-cn IDE never falls back to a stray
 *     English string for a translated call), and the bundle has no dead keys.
 * A new user-facing string added without its translation fails here instead of
 * silently shipping mixed-language UI.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ext = (rel) =>
  fileURLToPath(new URL("../../../vscode-extension/" + rel, import.meta.url));
const readJson = (rel) => JSON.parse(readFileSync(ext(rel), "utf-8"));
const decodeStringLiteral = (literal) =>
  literal[0] === "'"
    ? JSON.parse(
        '"' +
          literal
            .slice(1, -1)
            .replace(/\\'/g, "'")
            .replace(/(?<!\\)"/g, '\\"') +
          '"',
      )
    : JSON.parse(literal);

const collectRuntimeL10nKeys = (source) => {
  // Match l10n.t( "…" ) or l10n.t( '…' ), tolerating a newline before the arg.
  const directRe = /l10n\.t\(\s*(("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*'))/g;
  const constantRe =
    /const\s+([A-Z][A-Z0-9_]*)\s*=\s*((?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*(?:\+\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*)*);/g;
  const localizedConstantRe =
    /localize\(\s*vscode\s*,\s*([A-Z][A-Z0-9_]*)\s*\)/g;
  const found = new Set();
  let match;

  while ((match = directRe.exec(source))) {
    // Interpret escapes (\n etc.) the same way the JS engine does.
    found.add(decodeStringLiteral(match[1]));
  }

  // Resolve long base strings passed through the localize compatibility
  // helper, but only when the constant is statically defined and used.
  const constants = new Map();
  while ((match = constantRe.exec(source))) {
    const literals = match[2].match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g);
    constants.set(match[1], literals.map(decodeStringLiteral).join(""));
  }
  while ((match = localizedConstantRe.exec(source))) {
    const value = constants.get(match[1]);
    if (value !== undefined) found.add(value);
  }
  return found;
};

describe("VS Code package.nls placeholder coverage", () => {
  const pkgRaw = readFileSync(ext("package.json"), "utf-8");
  const en = readJson("package.nls.json");
  const zh = readJson("package.nls.zh-cn.json");
  const used = [...pkgRaw.matchAll(/%([^%"]+)%/g)].map((m) => m[1]);

  it("uses placeholders and finds them all in the English base", () => {
    expect(used.length).toBeGreaterThan(20);
    expect(used.filter((k) => !(k in en))).toEqual([]);
  });

  it("translates every placeholder in zh-cn", () => {
    expect(used.filter((k) => !(k in zh))).toEqual([]);
  });

  it("has identical key sets in en and zh-cn (no orphans)", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });

  it("has no unused nls keys", () => {
    expect(Object.keys(en).filter((k) => !used.includes(k))).toEqual([]);
  });
});

describe("VS Code runtime l10n.t bundle coverage", () => {
  const bundle = readJson("l10n/bundle.l10n.zh-cn.json");
  const sources = [
    "src/extension.js",
    "src/ui/status-bar.js",
    "src/ui/tree-view.js",
    "src/vscode-facade.js",
    "src/ui/dashboard.js",
    "src/ui/evolution-workbench-view.js",
    "src/chat/chat-view.js",
  ];
  const found = new Set();
  for (const rel of sources) {
    for (const key of collectRuntimeL10nKeys(readFileSync(ext(rel), "utf-8"))) {
      found.add(key);
    }
  }

  it("tracks only statically used localization-wrapper constants", () => {
    const fixture = `
      const USED_MESSAGE = "used " + "message";
      const UNUSED_MESSAGE = "unused message";
      vscode.l10n.t("direct message");
      localize(vscode, USED_MESSAGE);
    `;
    expect([...collectRuntimeL10nKeys(fixture)].sort()).toEqual([
      "direct message",
      "used message",
    ]);
  });

  it("finds a meaningful number of localized runtime strings", () => {
    expect(found.size).toBeGreaterThan(30);
  });

  it("translates every runtime base string in the zh-cn bundle", () => {
    const missing = [...found].filter((k) => !(k in bundle));
    expect(missing).toEqual([]);
  });

  it("has no dead bundle keys", () => {
    const dead = Object.keys(bundle).filter((k) => !found.has(k));
    expect(dead).toEqual([]);
  });
});
