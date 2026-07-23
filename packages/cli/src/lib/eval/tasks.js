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
import executionBroker from "../process-execution-broker/index.js";

export const _deps = {
  execFileSync: (...args) => executionBroker.execFileSync(...args),
};

function runTaskCheck(dir, script, options = {}) {
  return _deps.execFileSync(process.execPath, [script], {
    cwd: dir,
    timeout: 10000,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
    origin: "eval:task-check",
    policy: "allow",
    scope: "eval",
    shell: false,
  });
}

function read(dir, rel) {
  try {
    return fs.readFileSync(path.join(dir, rel), "utf8");
  } catch {
    return null;
  }
}

// The `stringutil` "dependency" at v2, used by BOTH the upgrade-dependency
// setup and its check so the task can verify the vendored dependency file was
// not edited (the agent must adapt the caller, not touch the dependency).
const STRINGUTIL_V2 =
  "export function toTitle(s) {\n" +
  "  const str = String(s);\n" +
  "  return str.charAt(0).toUpperCase() + str.slice(1);\n" +
  "}\n";

// Harness files the agent is told NOT to edit, shared by setup and check so the
// check can byte-compare them (same anti-cheat as STRINGUTIL_V2 above). A mere
// presence-regex is neuterable: prepending `console.log('ALL OK');
// process.exit(0)` keeps the assertion text present while never running it.
const RUN_CHECKS_MJS = [
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
].join("\n");

const BUILD_MJS =
  'import { banner } from "./app.mjs";\n' +
  'if (banner() !== "v1.0.0") {\n' +
  '  console.error("BUILD FAIL: " + banner());\n' +
  "  process.exit(1);\n" +
  "}\n" +
  'console.log("BUILD OK");\n';

const RUN_MJS =
  'import { label } from "./app.mjs";\n' +
  'if (label("hello") !== "Hello") {\n' +
  '  console.error("FAIL: " + label("hello"));\n' +
  "  process.exit(1);\n" +
  "}\n" +
  'console.log("OK");\n';

export const BUILTIN_TASKS = [
  {
    id: "create-file",
    expectedFiles: ["greeting.txt"],
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
    expectedFiles: ["bug.js"],
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
        const out = runTaskCheck(dir, "bug.js", {
          encoding: "utf8",
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
    expectedFiles: ["math.js"],
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
    expectedFiles: ["calc.js"],
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
        RUN_CHECKS_MJS,
        "utf8",
      );
    },
    check: (dir) => {
      // Objective: the test harness must actually pass. Byte-compare the
      // harness — a presence-regex alone is neuterable (prepend an early
      // `console.log('ALL OK'); process.exit(0)` and the assertion text is
      // still there but never runs).
      const checks = read(dir, "run-checks.mjs");
      if (checks == null)
        return { pass: false, detail: "run-checks.mjs missing" };
      if (checks !== RUN_CHECKS_MJS) {
        return {
          pass: false,
          detail: "run-checks.mjs was edited (fix calc.js instead)",
        };
      }
      try {
        const out = runTaskCheck(dir, "run-checks.mjs", {
          encoding: "utf8",
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
    expectedFiles: ["util.js", "main.js"],
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
        const out = runTaskCheck(dir, "main.js", {
          encoding: "utf8",
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
    expectedFiles: ["verify.mjs"],
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
      const run = () => runTaskCheck(dir, "verify.mjs");
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
    expectedFiles: ["greet.mjs", "app.mjs"],
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
        const out = runTaskCheck(dir, "app.mjs", {
          encoding: "utf8",
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
    expectedFiles: ["notes.mjs"],
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
  {
    id: "fix-build",
    expectedFiles: ["config.mjs", "app.mjs"],
    description:
      "Fix a cross-module build/link failure so the build passes (build-failure category)",
    prompt:
      "The build is broken: `node build.mjs` fails to LINK because of an " +
      "export/import name mismatch between app.mjs and config.mjs. Reconcile " +
      "them so `node build.mjs` prints BUILD OK. Do not edit build.mjs.",
    setup: (dir) => {
      // config exports `version` (lowercase) but app imports `VERSION` — an ESM
      // link error at build time, distinct from a single-file syntax typo.
      fs.writeFileSync(
        path.join(dir, "config.mjs"),
        'export const version = "1.0.0";\n',
        "utf8",
      );
      fs.writeFileSync(
        path.join(dir, "app.mjs"),
        'import { VERSION } from "./config.mjs";\n' +
          'export function banner() {\n  return "v" + VERSION;\n}\n',
        "utf8",
      );
      fs.writeFileSync(path.join(dir, "build.mjs"), BUILD_MJS, "utf8");
    },
    check: (dir) => {
      const build = read(dir, "build.mjs");
      if (build == null) return { pass: false, detail: "build.mjs missing" };
      // Guard: fix the modules, don't neuter the build harness. Byte-compare —
      // a presence-regex is satisfiable by a rewritten build.mjs that defines
      // its own banner() and never imports app.mjs.
      if (build !== BUILD_MJS) {
        return {
          pass: false,
          detail: "build.mjs was edited (reconcile config.mjs/app.mjs instead)",
        };
      }
      try {
        const out = runTaskCheck(dir, "build.mjs", {
          encoding: "utf8",
        });
        return out.includes("BUILD OK")
          ? { pass: true, detail: "build links + passes" }
          : {
              pass: false,
              detail: `unexpected output ${JSON.stringify(out.trim())}`,
            };
      } catch (err) {
        const first = String(err.message || "").split("\n")[0];
        return { pass: false, detail: `build still failing: ${first}` };
      }
    },
  },
  {
    id: "upgrade-dependency",
    expectedFiles: ["package.json", "app.mjs"],
    description:
      "Adapt code to a dependency's breaking upgrade + bump the manifest (dependency-upgrade category)",
    prompt:
      "The `stringutil` dependency was upgraded to 2.0.0. Breaking change: its " +
      "`capitalize` export was renamed to `toTitle` (same behavior). Do all of: " +
      "(1) bump stringutil to ^2.0.0 in package.json; (2) update app.mjs to " +
      "import and use `toTitle` instead of `capitalize`; (3) do NOT edit " +
      "stringutil.mjs or run.mjs. Afterwards `node run.mjs` must print OK.",
    setup: (dir) => {
      fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify(
          {
            name: "app",
            type: "module",
            dependencies: { stringutil: "1.0.0" },
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      // The upgraded (v2) dependency — vendored, must not be edited.
      fs.writeFileSync(path.join(dir, "stringutil.mjs"), STRINGUTIL_V2, "utf8");
      // The caller still uses the removed v1 `capitalize` export (link error).
      fs.writeFileSync(
        path.join(dir, "app.mjs"),
        'import { capitalize } from "./stringutil.mjs";\n' +
          "export function label(s) {\n  return capitalize(s);\n}\n",
        "utf8",
      );
      fs.writeFileSync(path.join(dir, "run.mjs"), RUN_MJS, "utf8");
    },
    check: (dir) => {
      // The dependency is vendored — the agent must adapt the caller, NOT edit
      // the dependency to re-add the old export and dodge the upgrade.
      const dep = read(dir, "stringutil.mjs");
      if (dep == null) return { pass: false, detail: "stringutil.mjs missing" };
      if (dep !== STRINGUTIL_V2) {
        return {
          pass: false,
          detail: "the stringutil dependency was edited (adapt the caller)",
        };
      }
      // The run harness is equally off-limits: without this guard an agent
      // could overwrite run.mjs with `console.log("OK")` and pass the textual
      // checks below without app.mjs ever being executed.
      const runner = read(dir, "run.mjs");
      if (runner == null) return { pass: false, detail: "run.mjs missing" };
      if (runner !== RUN_MJS) {
        return {
          pass: false,
          detail: "run.mjs was edited (adapt app.mjs/package.json instead)",
        };
      }
      const pkg = read(dir, "package.json");
      if (pkg == null || !/"stringutil"\s*:\s*"[\^~]?2\./.test(pkg)) {
        return {
          pass: false,
          detail: "package.json not bumped to stringutil 2.x",
        };
      }
      const app = read(dir, "app.mjs");
      if (app == null) return { pass: false, detail: "app.mjs missing" };
      if (/\bcapitalize\b/.test(app)) {
        return {
          pass: false,
          detail: "app.mjs still references the removed capitalize export",
        };
      }
      if (!/\btoTitle\b/.test(app)) {
        return { pass: false, detail: "app.mjs does not use the new toTitle" };
      }
      try {
        const out = runTaskCheck(dir, "run.mjs", {
          encoding: "utf8",
        });
        return out.trim() === "OK"
          ? { pass: true, detail: "adapted to new API + manifest bumped" }
          : {
              pass: false,
              detail: `run.mjs printed ${JSON.stringify(out.trim())}`,
            };
      } catch (err) {
        const first = String(err.message || "").split("\n")[0];
        return { pass: false, detail: `run.mjs failed: ${first}` };
      }
    },
  },
];

/** Look up a suite by name (only "builtin" for now). */
export function getSuite(name = "builtin") {
  if (name === "builtin" || !name) return BUILTIN_TASKS;
  throw new Error(`unknown eval suite: "${name}" (available: builtin)`);
}
