/**
 * Built-in eval task suite (Phase 7). Each task is a small, deterministic,
 * self-checking coding problem: `setup` writes the starting files, `prompt` is
 * handed to the agent, and `check` verifies the outcome with a real filesystem
 * assertion (no LLM-graded fuzzy matching — pass/fail is objective).
 *
 * Kept intentionally small + provider-agnostic so `cc eval` can run against any
 * configured model (including a local Ollama). Extend by adding entries here or
 * loading an external suite file.
 */

import fs from "fs";
import path from "path";
import { execFileSync } from "node:child_process";

function read(dir, rel) {
  try {
    return fs.readFileSync(path.join(dir, rel), "utf8");
  } catch {
    return null;
  }
}

export const BUILTIN_TASKS = [
  {
    id: "create-file",
    description: "Create a new file with exact content",
    prompt:
      'Create a file named greeting.txt containing exactly the text "Hello, ChainlessChain!" (no trailing newline).',
    setup: () => {},
    check: (dir) => {
      const got = read(dir, "greeting.txt");
      if (got == null)
        return { pass: false, detail: "greeting.txt not created" };
      const trimmed = got.replace(/\n$/, "");
      return trimmed === "Hello, ChainlessChain!"
        ? { pass: true, detail: "content matches" }
        : { pass: false, detail: `content was ${JSON.stringify(got)}` };
    },
  },
  {
    id: "fix-syntax-error",
    description: "Fix a syntax error so the script runs",
    prompt:
      "The file bug.js has a syntax error. Fix it so that running `node bug.js` prints exactly OK.",
    setup: (dir) => {
      // Missing closing paren — a real, small bug to repair.
      fs.writeFileSync(path.join(dir, "bug.js"), 'console.log("OK";\n', "utf8");
    },
    check: (dir) => {
      const src = read(dir, "bug.js");
      if (src == null) return { pass: false, detail: "bug.js missing" };
      // Objective check: it must parse AND print OK. Re-run in a child so we
      // score the actual behavior, not a heuristic on the source.
      try {
        const out = execFileSync(process.execPath, ["bug.js"], {
          cwd: dir,
          encoding: "utf8",
          timeout: 10000,
          stdio: ["ignore", "pipe", "pipe"], // capture stderr, don't inherit
        });
        return out.trim() === "OK"
          ? { pass: true, detail: "node bug.js prints OK" }
          : { pass: false, detail: `printed ${JSON.stringify(out.trim())}` };
      } catch (err) {
        // Concise detail — the first line of the failure, not the whole stack.
        const first = String(err.message || "").split("\n")[0];
        return { pass: false, detail: `still broken: ${first}` };
      }
    },
  },
  {
    id: "add-function",
    description: "Add a function to an existing module",
    prompt:
      "In math.js, add a named export `add(a, b)` that returns a + b. Keep the existing `mul` export.",
    setup: (dir) => {
      fs.writeFileSync(
        path.join(dir, "math.js"),
        "export function mul(a, b) {\n  return a * b;\n}\n",
        "utf8",
      );
    },
    check: async (dir) => {
      const src = read(dir, "math.js");
      if (src == null) return { pass: false, detail: "math.js missing" };
      if (!/export\s+function\s+mul/.test(src)) {
        return { pass: false, detail: "mul export was removed" };
      }
      // Import the module and exercise both exports — behavioral, not textual.
      try {
        const url = "file://" + path.join(dir, "math.js").replace(/\\/g, "/");
        const mod = await import(url);
        if (typeof mod.add !== "function") {
          return { pass: false, detail: "add is not exported as a function" };
        }
        if (mod.add(2, 3) !== 5 || mod.mul(2, 3) !== 6) {
          return { pass: false, detail: "add/mul returned wrong values" };
        }
        return { pass: true, detail: "add + mul both work" };
      } catch (err) {
        return { pass: false, detail: `import failed: ${err.message}` };
      }
    },
  },
  {
    id: "fix-failing-test",
    description:
      "Fix a bug so an existing test suite passes (bug-fix category)",
    prompt:
      "calc.js has a bug — `sum` subtracts instead of adds. Fix calc.js so that " +
      "running `node run-checks.mjs` passes (it exits 0 and prints ALL OK). Do " +
      "not edit run-checks.mjs.",
    setup: (dir) => {
      // A buggy module + a real check harness that exercises it. The agent must
      // repair the MODULE, not the checks — verified by actually running them.
      fs.writeFileSync(
        path.join(dir, "calc.js"),
        "export function sum(a, b) {\n  return a - b;\n}\n",
        "utf8",
      );
      fs.writeFileSync(
        path.join(dir, "run-checks.mjs"),
        [
          "import { sum } from './calc.js';",
          "const cases = [[1,2,3],[10,5,15],[0,0,0]];",
          "for (const [a,b,want] of cases) {",
          "  if (sum(a,b) !== want) {",
          "    console.error(`FAIL sum(${a},${b})=${sum(a,b)} want ${want}`);",
          "    process.exit(1);",
          "  }",
          "}",
          "console.log('ALL OK');",
          "",
        ].join("\n"),
        "utf8",
      );
    },
    check: (dir) => {
      // Objective: the test harness must actually pass. Guard against the agent
      // "fixing" it by neutering run-checks.mjs — require the assertions to
      // still be present.
      const checks = read(dir, "run-checks.mjs");
      if (checks == null)
        return { pass: false, detail: "run-checks.mjs missing" };
      if (!/sum\(a,\s*b\)\s*!==\s*want/.test(checks)) {
        return {
          pass: false,
          detail: "run-checks.mjs assertions were altered",
        };
      }
      try {
        const out = execFileSync(process.execPath, ["run-checks.mjs"], {
          cwd: dir,
          encoding: "utf8",
          timeout: 10000,
          stdio: ["ignore", "pipe", "pipe"],
        });
        return out.includes("ALL OK")
          ? { pass: true, detail: "test suite passes" }
          : {
              pass: false,
              detail: `unexpected output ${JSON.stringify(out.trim())}`,
            };
      } catch (err) {
        const first = String(err.message || "").split("\n")[0];
        return { pass: false, detail: `checks still failing: ${first}` };
      }
    },
  },
  {
    id: "refactor-rename",
    description:
      "Rename a symbol across two files, keeping behavior (refactor)",
    prompt:
      "Rename the exported function `oldTotal` to `computeTotal` EVERYWHERE it " +
      "appears (both util.js which defines it and main.js which imports and " +
      "calls it). Behavior must be unchanged: `node main.js` must still print 6.",
    setup: (dir) => {
      fs.writeFileSync(
        path.join(dir, "util.js"),
        "export function oldTotal(nums) {\n  return nums.reduce((a, b) => a + b, 0);\n}\n",
        "utf8",
      );
      fs.writeFileSync(
        path.join(dir, "main.js"),
        "import { oldTotal } from './util.js';\nconsole.log(oldTotal([1, 2, 3]));\n",
        "utf8",
      );
    },
    check: (dir) => {
      const util = read(dir, "util.js");
      const main = read(dir, "main.js");
      if (util == null || main == null) {
        return { pass: false, detail: "util.js or main.js missing" };
      }
      // The old name must be gone from BOTH files (a real rename, not an alias).
      if (/\boldTotal\b/.test(util) || /\boldTotal\b/.test(main)) {
        return {
          pass: false,
          detail: "oldTotal still present (incomplete rename)",
        };
      }
      if (!/\bcomputeTotal\b/.test(util) || !/\bcomputeTotal\b/.test(main)) {
        return { pass: false, detail: "computeTotal not used in both files" };
      }
      // Behavior must be preserved: run main.js and check the output.
      try {
        const out = execFileSync(process.execPath, ["main.js"], {
          cwd: dir,
          encoding: "utf8",
          timeout: 10000,
          stdio: ["ignore", "pipe", "pipe"],
        });
        return out.trim() === "6"
          ? { pass: true, detail: "renamed + behavior preserved" }
          : {
              pass: false,
              detail: `main.js printed ${JSON.stringify(out.trim())}`,
            };
      } catch (err) {
        const first = String(err.message || "").split("\n")[0];
        return { pass: false, detail: `main.js broken after rename: ${first}` };
      }
    },
  },
  {
    id: "write-test",
    description:
      "Write a meaningful verifier for a module (test-completion category)",
    prompt:
      "Write a Node script `verify.mjs` that imports `slugify` from `./slug.mjs` " +
      "and checks it: exit 0 if slugify('Hello World') === 'hello-world' AND " +
      "slugify('  A_B ') === 'a-b' (lowercase; runs of spaces/underscores become a " +
      "single hyphen; trimmed), otherwise print what failed and exit 1. Do not " +
      "modify slug.mjs.",
    setup: (dir) => {
      fs.writeFileSync(
        path.join(dir, "slug.mjs"),
        "export function slugify(s) {\n" +
          "  return String(s).trim().toLowerCase().replace(/[\\s_]+/g, '-');\n" +
          "}\n",
        "utf8",
      );
    },
    check: (dir) => {
      const slug = read(dir, "slug.mjs");
      if (slug == null) return { pass: false, detail: "slug.mjs missing" };
      if (!/export\s+function\s+slugify/.test(slug)) {
        return { pass: false, detail: "slug.mjs export was changed" };
      }
      if (read(dir, "verify.mjs") == null) {
        return { pass: false, detail: "verify.mjs not created" };
      }
      const run = () =>
        execFileSync(process.execPath, ["verify.mjs"], {
          cwd: dir,
          timeout: 10000,
          stdio: ["ignore", "pipe", "pipe"],
        });
      // 1) The verifier must PASS against the correct implementation.
      try {
        run();
      } catch {
        return {
          pass: false,
          detail: "verify.mjs failed against the correct implementation",
        };
      }
      // 2) It must FAIL against a broken slugify — otherwise it's a no-op test
      // that would rubber-stamp any implementation.
      const good = slug;
      try {
        fs.writeFileSync(
          path.join(dir, "slug.mjs"),
          "export function slugify(s) {\n  return String(s);\n}\n", // identity = wrong
          "utf8",
        );
        let caughtFailure = false;
        try {
          run();
        } catch {
          caughtFailure = true;
        }
        if (!caughtFailure) {
          return {
            pass: false,
            detail:
              "verify.mjs passed even a broken slugify — the test is not meaningful",
          };
        }
      } finally {
        fs.writeFileSync(path.join(dir, "slug.mjs"), good, "utf8"); // restore
      }
      return {
        pass: true,
        detail: "verifier passes on the correct impl and catches a broken one",
      };
    },
  },
  {
    id: "migrate-signature",
    description:
      "Migrate a function's call convention and update all callers (api-upgrade category)",
    prompt:
      "In greet.mjs, change the exported `greet` to take a single options object " +
      "`greet({ name, excited })`, returning `Hello, <name>!` normally or " +
      "`Hello, <name>!!!` when `excited` is true. Update ALL callers in app.mjs to " +
      "the new signature. Running `node app.mjs` must print exactly two lines:\n" +
      "Hello, Ada!\nHello, Bob!!!",
    setup: (dir) => {
      fs.writeFileSync(
        path.join(dir, "greet.mjs"),
        "export function greet(name, excited) {\n" +
          "  return `Hello, ${name}!` + (excited ? '!!' : '');\n" +
          "}\n",
        "utf8",
      );
      fs.writeFileSync(
        path.join(dir, "app.mjs"),
        "import { greet } from './greet.mjs';\n" +
          "console.log(greet('Ada', false));\n" +
          "console.log(greet('Bob', true));\n",
        "utf8",
      );
    },
    check: (dir) => {
      const g = read(dir, "greet.mjs");
      const a = read(dir, "app.mjs");
      if (g == null || a == null)
        return { pass: false, detail: "greet.mjs / app.mjs missing" };
      // New signature: greet must destructure an object parameter.
      if (!/greet\s*\(\s*\{/.test(g)) {
        return {
          pass: false,
          detail: "greet was not migrated to an options object",
        };
      }
      // No caller may still pass the old positional (string-first) arguments.
      if (/greet\(\s*['"`]/.test(a)) {
        return {
          pass: false,
          detail: "a caller still uses the old positional signature",
        };
      }
      try {
        const out = execFileSync(process.execPath, ["app.mjs"], {
          cwd: dir,
          encoding: "utf8",
          timeout: 10000,
          stdio: ["ignore", "pipe", "pipe"],
        }).trim();
        return out === "Hello, Ada!\nHello, Bob!!!"
          ? { pass: true, detail: "signature migrated + callers updated" }
          : { pass: false, detail: `app.mjs printed ${JSON.stringify(out)}` };
      } catch (err) {
        const first = String(err.message || "").split("\n")[0];
        return { pass: false, detail: `app.mjs failed: ${first}` };
      }
    },
  },
  {
    id: "secure-path",
    description:
      "Fix a path-traversal vulnerability, verified by an exploit probe (security-fix category)",
    prompt:
      "notes.mjs's `readNote` is vulnerable to path traversal — a name like " +
      "'../secret.txt' escapes the notes directory. Fix `readNote` so it can ONLY " +
      "read files inside the notes directory (reject or neutralize both '../' and " +
      "absolute paths), while `readNote('hello.txt')` still returns 'hi'. Keep the " +
      "export name and signature.",
    setup: (dir) => {
      fs.mkdirSync(path.join(dir, "notes"), { recursive: true });
      fs.writeFileSync(path.join(dir, "notes", "hello.txt"), "hi", "utf8");
      // The secret lives OUTSIDE notes/ — a fixed readNote must never reach it.
      fs.writeFileSync(path.join(dir, "secret.txt"), "TOP_SECRET", "utf8");
      // BASE is anchored to the module's own dir (not process.cwd()) so the
      // check can import it from anywhere.
      fs.writeFileSync(
        path.join(dir, "notes.mjs"),
        "import fs from 'node:fs';\n" +
          "import path from 'node:path';\n" +
          "import { fileURLToPath } from 'node:url';\n" +
          "const BASE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'notes');\n" +
          "// VULNERABLE: `name` can contain ../ (or be absolute) and escape BASE.\n" +
          "export function readNote(name) {\n" +
          "  return fs.readFileSync(path.join(BASE, name), 'utf8');\n" +
          "}\n",
        "utf8",
      );
    },
    check: async (dir) => {
      const src = read(dir, "notes.mjs");
      if (src == null) return { pass: false, detail: "notes.mjs missing" };
      if (!/export\s+function\s+readNote/.test(src)) {
        return { pass: false, detail: "readNote export was removed/renamed" };
      }
      let mod;
      try {
        const url = "file://" + path.join(dir, "notes.mjs").replace(/\\/g, "/");
        mod = await import(url);
      } catch (err) {
        return { pass: false, detail: `import failed: ${err.message}` };
      }
      // 1) Behavior: a legitimate read still works.
      let hi;
      try {
        hi = mod.readNote("hello.txt");
      } catch (err) {
        return {
          pass: false,
          detail: `readNote('hello.txt') threw: ${err.message}`,
        };
      }
      if (String(hi).trim() !== "hi") {
        return {
          pass: false,
          detail: `readNote('hello.txt') = ${JSON.stringify(hi)}`,
        };
      }
      // 2) Exploit probe — relative traversal must NOT leak the secret.
      let leaked = null;
      try {
        leaked = mod.readNote("../secret.txt");
      } catch {
        leaked = null; // throwing is a valid way to reject
      }
      if (leaked != null && String(leaked).includes("TOP_SECRET")) {
        return {
          pass: false,
          detail: "relative traversal still reads files outside notes/",
        };
      }
      // 3) Exploit probe — an absolute path must NOT escape either.
      let leaked2 = null;
      try {
        leaked2 = mod.readNote(path.join(dir, "secret.txt"));
      } catch {
        leaked2 = null;
      }
      if (leaked2 != null && String(leaked2).includes("TOP_SECRET")) {
        return { pass: false, detail: "absolute path escapes notes/" };
      }
      return {
        pass: true,
        detail: "traversal neutralized, legitimate read preserved",
      };
    },
  },
];

/** Look up a suite by name (only "builtin" for now). */
export function getSuite(name = "builtin") {
  if (name === "builtin" || !name) return BUILTIN_TASKS;
  throw new Error(`unknown eval suite: "${name}" (available: builtin)`);
}
