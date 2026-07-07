/**
 * LIVE multi-language LSP verification (plan Phase 2 real-machine leftover).
 *
 * Runs `CodeIntelligence` (the exact production path behind `cc code-intel`)
 * against REAL language servers — gopls / rust-analyzer / jdtls — on tiny
 * fixture projects, asserting definition, references AND diagnostics (the
 * class the gopls normalizeUri drive-colon bug hid: publishes keyed under a
 * different URI form than the didOpen).
 *
 * Gating (no cosmetic green):
 *  - CC_LSP_LIVE=1 turns the suite on (off by default: needs toolchains).
 *  - A language whose server binary is missing SKIPS locally, but FAILS when
 *    it is listed in CC_LSP_LIVE_REQUIRE (comma list, e.g. "go,rust,java") —
 *    CI sets that after installing the servers, so a broken install can never
 *    silently skip its way to green.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CodeIntelligence } from "../../src/lib/lsp/code-intelligence.js";
import { resolveServer } from "../../src/lib/lsp/lsp-server-registry.js";

const LIVE = process.env.CC_LSP_LIVE === "1";
const REQUIRED = new Set(
  String(process.env.CC_LSP_LIVE_REQUIRE || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

function serverAvailable(languageId, root) {
  try {
    return Boolean(resolveServer(languageId, root));
  } catch {
    return false;
  }
}

/** Write a fixture tree { relPath: content } under a fresh temp dir. */
function writeFixture(prefix, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return dir;
}

/**
 * Per-language spec: fixture files, the file/position of a call site whose
 * definition must resolve, the expected definition file/line, and a file
 * seeded with a type error whose diagnostics must be non-empty.
 */
const LANGS = [
  {
    id: "go",
    prefix: "cc-lsp-go-",
    files: {
      "go.mod": "module example.com/demo\n\ngo 1.22\n",
      "main.go":
        'package main\n\nimport "fmt"\n\nfunc Greet(name string) string {\n\treturn "Hello, " + name\n}\n\nfunc main() {\n\tmsg := Greet("world")\n\tfmt.Println(msg)\n\tfmt.Println(Greet("again"))\n}\n',
      "broken.go":
        "package main\n\nfunc unusedHelper() int {\n\tvar x string = 42\n\treturn len(x)\n}\n",
    },
    call: { file: "main.go", line: 10, col: 9 },
    defAt: { file: "main.go", line: 5 },
    minRefs: 3,
    brokenFile: "broken.go",
    diagTimeoutMs: 60_000,
  },
  {
    id: "rust",
    prefix: "cc-lsp-rs-",
    files: {
      "Cargo.toml":
        '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n',
      "src/main.rs":
        'fn greet(name: &str) -> String {\n    format!("Hello, {name}")\n}\n\nfn main() {\n    let msg = greet("world");\n    println!("{msg}");\n    println!("{}", greet("again"));\n}\n',
      "src/broken.rs": "", // referenced below via mod? keep single-file: seed the error in main.rs instead
    },
    call: { file: "src/main.rs", line: 6, col: 15 },
    defAt: { file: "src/main.rs", line: 1 },
    minRefs: 3,
    // rust-analyzer diagnoses natively (no cargo check needed) — seed the
    // error in a dedicated file added below in beforeAll.
    brokenFile: "src/broken_type.rs",
    diagTimeoutMs: 90_000,
  },
  {
    id: "java",
    prefix: "cc-lsp-java-",
    files: {
      "src/Main.java":
        'public class Main {\n    static String greet(String name) {\n        return "Hello, " + name;\n    }\n\n    public static void main(String[] args) {\n        String msg = greet("world");\n        System.out.println(msg);\n        System.out.println(greet("again"));\n    }\n}\n',
      "src/Broken.java":
        "public class Broken {\n    static int bad() {\n        String x = 42;\n        return x.length();\n    }\n}\n",
    },
    call: { file: "src/Main.java", line: 7, col: 22 },
    defAt: { file: "src/Main.java", line: 2 },
    minRefs: 3,
    brokenFile: "src/Broken.java",
    diagTimeoutMs: 180_000,
  },
];

for (const lang of LANGS) {
  const probeRoot = process.cwd();
  const available = LIVE && serverAvailable(lang.id, probeRoot);
  const required = REQUIRED.has(lang.id);

  describe.runIf(LIVE)(`live LSP — ${lang.id}`, () => {
    it.runIf(LIVE && required && !available)(
      `${lang.id} server is REQUIRED in this environment but not installed`,
      () => {
        throw new Error(
          `CC_LSP_LIVE_REQUIRE includes "${lang.id}" but no server binary ` +
            `resolved — the CI install step is broken (this guard exists so ` +
            `a bad install can't silently skip to green).`,
        );
      },
    );

    describe.runIf(available)(`${lang.id} end to end`, () => {
      let dir;
      let ci;

      beforeAll(() => {
        const files = { ...lang.files };
        if (lang.id === "rust") {
          delete files["src/broken.rs"];
          files["src/broken_type.rs"] =
            "pub fn bad() -> usize {\n    let x: String = 42;\n    x.len()\n}\n";
          files["src/main.rs"] = "mod broken_type;\n" + files["src/main.rs"];
        }
        dir = writeFixture(lang.prefix, files);
        ci = new CodeIntelligence({ projectRoot: dir, coldStart: true });
      });

      afterAll(async () => {
        try {
          await ci.dispose();
        } catch {
          /* server teardown is best-effort */
        }
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          /* temp cleanup is best-effort */
        }
      });

      it(
        "definition resolves the call site to the declaration",
        { timeout: lang.diagTimeoutMs },
        async () => {
          // rust fixture prepended a `mod` line — shift the recorded positions.
          const shift = lang.id === "rust" ? 1 : 0;
          const res = await ci.definition(
            path.join(dir, lang.call.file),
            lang.call.line + shift,
            lang.call.col,
          );
          expect(res.available).toBe(true);
          expect(res.locations.length).toBeGreaterThan(0);
          const def = res.locations[0];
          expect(def.file.replaceAll("\\", "/")).toContain(
            lang.defAt.file.split("/").pop(),
          );
          expect(def.line).toBe(lang.defAt.line + shift);
        },
      );

      it(
        "references finds every call site",
        { timeout: lang.diagTimeoutMs },
        async () => {
          const shift = lang.id === "rust" ? 1 : 0;
          const res = await ci.references(
            path.join(dir, lang.defAt.file),
            lang.defAt.line + shift,
            lang.id === "java" ? 19 : 6,
          );
          expect(res.available).toBe(true);
          expect(res.locations.length).toBeGreaterThanOrEqual(lang.minRefs);
        },
      );

      it(
        "diagnostics reports the seeded type error (URI-form regression guard)",
        { timeout: lang.diagTimeoutMs },
        async () => {
          const res = await ci.diagnostics(path.join(dir, lang.brokenFile), {
            timeoutMs: lang.diagTimeoutMs,
          });
          expect(res.available).toBe(true);
          // The exact message differs per server; a seeded `String x = 42`-class
          // error must surface as at least one error-severity diagnostic.
          const errors = res.diagnostics.filter(
            (d) => d.severity === "error" || d.severity === 1,
          );
          expect(errors.length).toBeGreaterThan(0);
        },
      );
    });
  });
}

// Keep vitest happy when the whole suite is gated off.
describe.runIf(!LIVE)("live LSP (gated off)", () => {
  it("is skipped without CC_LSP_LIVE=1 (needs real language servers)", () => {
    expect(LIVE).toBe(false);
  });
});
