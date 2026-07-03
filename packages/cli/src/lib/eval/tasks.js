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
];

/** Look up a suite by name (only "builtin" for now). */
export function getSuite(name = "builtin") {
  if (name === "builtin" || !name) return BUILTIN_TASKS;
  throw new Error(`unknown eval suite: "${name}" (available: builtin)`);
}
