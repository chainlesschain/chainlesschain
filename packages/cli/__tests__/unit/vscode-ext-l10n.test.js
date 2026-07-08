/**
 * l10n coverage gate for the VS Code extension. Guards the "真·本地化" work:
 *  1. every %key% placeholder in package.json resolves in BOTH package.nls.json
 *     (English base) and package.nls.zh-cn.json (Chinese), with no orphan keys;
 *  2. the en/zh NLS files have identical key sets;
 *  3. every vscode.l10n.t("…") base string in the extension-host source has a
 *     matching key in l10n/bundle.l10n.zh-cn.json (so a zh-cn IDE never falls
 *     back to a stray English string for a translated call), and the bundle has
 *     no dead keys.
 * A new user-facing string added without its translation fails here instead of
 * silently shipping mixed-language UI.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ext = (rel) =>
  fileURLToPath(new URL("../../../vscode-extension/" + rel, import.meta.url));
const readJson = (rel) => JSON.parse(readFileSync(ext(rel), "utf-8"));

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
  ];
  // Match l10n.t( "…" ) or l10n.t( '…' ), tolerating a newline before the arg.
  const re = /l10n\.t\(\s*(("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*'))/g;
  const found = new Set();
  for (const rel of sources) {
    const s = readFileSync(ext(rel), "utf-8");
    let m;
    while ((m = re.exec(s))) {
      // Normalize a single- or double-quoted literal to its runtime value,
      // interpreting escapes (\n etc.) the same way the JS engine does — so a
      // single-quoted string with a \n matches the bundle key's real newline.
      const lit = m[1];
      const val =
        lit[0] === "'"
          ? JSON.parse(
              '"' +
                lit
                  .slice(1, -1)
                  .replace(/\\'/g, "'")
                  .replace(/(?<!\\)"/g, '\\"') +
                '"',
            )
          : JSON.parse(lit);
      found.add(val);
    }
  }

  it("finds a meaningful number of localized runtime strings", () => {
    expect(found.size).toBeGreaterThan(30);
  });

  it("translates every l10n.t base string in the zh-cn bundle", () => {
    const missing = [...found].filter((k) => !(k in bundle));
    expect(missing).toEqual([]);
  });

  it("has no dead bundle keys", () => {
    const dead = Object.keys(bundle).filter((k) => !found.has(k));
    expect(dead).toEqual([]);
  });
});
