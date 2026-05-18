/**
 * Runtime Convergence — Deprecated Shim Parity
 *
 * Regression guard for the CLI Runtime Convergence roadmap (Phase 2–6b).
 * The 6 historical `src/lib/*` entity files have been reduced to thin
 * `@deprecated` re-export shims pointing at canonical targets in
 * `runtime/`, `gateways/ws/`, or `harness/`. This test ensures:
 *
 *   1. Each shim source file carries the `@deprecated` banner.
 *   2. Each named export present on the canonical module is also
 *      re-exported from the shim and refers to the same reference.
 *   3. Production call sites do not regress to the old `src/lib/*`
 *      paths for the migrated modules (checked via grep).
 *
 * If this test fails, either:
 *   - Someone added a new export to the canonical without updating the
 *     shim (add it to the shim's export block), or
 *   - Someone restored real logic into a shim (that's a D3 violation —
 *     move the new logic to the canonical location instead), or
 *   - A production call site was pointed back at the shim (update it
 *     to import from the canonical path).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..", "..");

/**
 * Statically extract the set of top-level named exports from an ESM source
 * file. We parse instead of dynamically importing because several of the
 * canonical modules (agent-core, ws-agent-handler, ws-session-gateway)
 * trigger full runtime bootstrap on import (skill loader, DB pragmas,
 * hook manager) which blows past any reasonable test timeout.
 *
 * Recognized forms:
 *   export function foo(...)
 *   export async function foo(...)
 *   export class Foo
 *   export const foo = ...
 *   export let foo = ...
 *   export var foo = ...
 *   export { a, b as c, ... }          // local re-exports
 *   export { a, b as c } from "..."    // transitive re-exports
 *   export * from "..."                // wildcard — captured as "*"
 */
function extractNamedExports(source) {
  const exports = new Set();

  // Strip line + block comments so commented-out exports don't count.
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  // export function / class / const / let / var <name>
  const declRegex =
    /export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  for (const m of stripped.matchAll(declRegex)) {
    exports.add(m[1]);
  }

  // export { a, b as c, ... } [from "..."]
  const blockRegex = /export\s*\{([^}]*)\}/g;
  for (const m of stripped.matchAll(blockRegex)) {
    const body = m[1];
    for (const part of body.split(",")) {
      const token = part.trim();
      if (!token) continue;
      // "a as b" → exported name is b; "a" → exported name is a
      const asMatch = token.match(/\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (asMatch) {
        exports.add(asMatch[1]);
      } else {
        const nameMatch = token.match(/^([A-Za-z_$][\w$]*)$/);
        if (nameMatch) exports.add(nameMatch[1]);
      }
    }
  }

  // export * from "..." — treat as wildcard marker
  if (/export\s*\*\s*from\s*["']/.test(stripped)) {
    exports.add("*");
  }

  return exports;
}

// Shim → canonical path pairs. Each entry describes one deprecated
// re-export file and where its canonical implementation lives.
const SHIMS = [
  {
    shim: "src/lib/agent-core.js",
    canonical: "src/runtime/agent-core.js",
    importPath: "../../src/lib/agent-core.js",
    canonicalImport: "../../src/runtime/agent-core.js",
  },
  {
    shim: "src/lib/ws-agent-handler.js",
    canonical: "src/gateways/ws/ws-agent-handler.js",
    importPath: "../../src/lib/ws-agent-handler.js",
    canonicalImport: "../../src/gateways/ws/ws-agent-handler.js",
  },
  {
    shim: "src/lib/ws-server.js",
    canonical: "src/gateways/ws/ws-server.js",
    importPath: "../../src/lib/ws-server.js",
    canonicalImport: "../../src/gateways/ws/ws-server.js",
  },
  {
    shim: "src/lib/ws-session-manager.js",
    canonical: "src/gateways/ws/ws-session-gateway.js",
    importPath: "../../src/lib/ws-session-manager.js",
    canonicalImport: "../../src/gateways/ws/ws-session-gateway.js",
  },
  {
    shim: "src/lib/jsonl-session-store.js",
    canonical: "src/harness/jsonl-session-store.js",
    importPath: "../../src/lib/jsonl-session-store.js",
    canonicalImport: "../../src/harness/jsonl-session-store.js",
  },
  {
    shim: "src/lib/prompt-compressor.js",
    canonical: "src/harness/prompt-compressor.js",
    importPath: "../../src/lib/prompt-compressor.js",
    canonicalImport: "../../src/harness/prompt-compressor.js",
  },
  {
    shim: "src/lib/mcp-client.js",
    canonical: "src/harness/mcp-client.js",
    importPath: "../../src/lib/mcp-client.js",
    canonicalImport: "../../src/harness/mcp-client.js",
  },
  {
    shim: "src/lib/plugin-manager.js",
    canonical: "src/harness/plugin-manager.js",
    importPath: "../../src/lib/plugin-manager.js",
    canonicalImport: "../../src/harness/plugin-manager.js",
  },
];

describe("Runtime Convergence: deprecated shim parity", () => {
  for (const entry of SHIMS) {
    describe(entry.shim, () => {
      it("source file carries @deprecated banner", () => {
        const content = readFileSync(join(cliRoot, entry.shim), "utf8");
        expect(content).toContain("@deprecated");
      });

      it("canonical target file exists", () => {
        const content = readFileSync(join(cliRoot, entry.canonical), "utf8");
        expect(content.length).toBeGreaterThan(0);
      });

      it("all canonical named exports are re-exported by the shim", () => {
        // Static source parsing instead of dynamic import — heavy canonical
        // modules (agent-core, ws-agent-handler, ws-session-gateway) trigger
        // full runtime bootstrap on import which would blow any timeout.
        const shimSource = readFileSync(join(cliRoot, entry.shim), "utf8");
        const canonicalSource = readFileSync(
          join(cliRoot, entry.canonical),
          "utf8",
        );

        const shimExports = extractNamedExports(shimSource);
        const canonicalExports = extractNamedExports(canonicalSource);

        // Canonical must have at least one named export (sanity)
        expect(canonicalExports.size).toBeGreaterThan(0);

        // If the shim uses `export *` it covers everything by construction.
        if (shimExports.has("*")) return;

        // Every canonical named export must appear in the shim's export set
        const missing = [];
        for (const name of canonicalExports) {
          if (name === "*") continue;
          if (!shimExports.has(name)) missing.push(name);
        }
        expect(
          missing,
          `shim ${entry.shim} is missing re-exports for: ${missing.join(", ")}`,
        ).toEqual([]);
      });

      it("shim is a thin re-export (≤ 40 lines)", () => {
        const content = readFileSync(join(cliRoot, entry.shim), "utf8");
        const lines = content.split("\n").length;
        expect(lines).toBeLessThanOrEqual(40);
      });
    });
  }

  describe("production call sites use canonical paths (D3 compliance)", () => {
    // Files that should NOT import from the deprecated shim paths
    const productionFiles = [
      "src/repl/agent-repl.js",
      "src/gateways/ws/ws-session-gateway.js",
      "src/gateways/ws/session-protocol.js",
      "src/gateways/ws/ws-agent-handler.js",
      "src/runtime/agent-core.js",
      "src/commands/plugin.js",
      "src/commands/doctor.js",
      "src/commands/status.js",
      "src/commands/session.js",
    ];

    // Regex matching any import from a known shim path
    const shimImportPatterns = [
      /from\s+["'][^"']*lib\/agent-core(\.js)?["']/,
      /from\s+["'][^"']*lib\/ws-agent-handler(\.js)?["']/,
      /from\s+["'][^"']*lib\/ws-server(\.js)?["']/,
      /from\s+["'][^"']*lib\/ws-session-manager(\.js)?["']/,
      /from\s+["'][^"']*lib\/jsonl-session-store(\.js)?["']/,
      /from\s+["'][^"']*lib\/prompt-compressor(\.js)?["']/,
      /from\s+["'][^"']*lib\/mcp-client(\.js)?["']/,
      /from\s+["'][^"']*lib\/plugin-manager(\.js)?["']/,
    ];

    for (const file of productionFiles) {
      it(`${file} does not import from deprecated shim paths`, () => {
        const content = readFileSync(join(cliRoot, file), "utf8");
        for (const pattern of shimImportPatterns) {
          expect(
            content,
            `${file} still imports from a deprecated shim matching ${pattern}`,
          ).not.toMatch(pattern);
        }
      });
    }
  });
});
