/**
 * E2E smoke test: session-hooks helper as exported from the built CLI
 *
 * Goal: verify that the session-hooks API is importable from a node child
 * process the same way external tools (or a future CLI command like
 * `cc hook fire <event>`) would consume it. This catches packaging
 * regressions (missing exports, ESM/CJS interop drift) that unit tests
 * miss because they import from source.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..", "..");
const sessionHooksUrl = pathToFileURL(
  join(cliRoot, "src", "lib", "session-hooks.js"),
).href;

let tmpDir;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "session-hooks-e2e-"));
});

afterAll(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

function runNodeScript(name, source) {
  const file = join(tmpDir, `${name}.mjs`);
  writeFileSync(file, source, "utf-8");
  return execFileSync(process.execPath, [file], {
    encoding: "utf-8",
    timeout: 10000,
    cwd: cliRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("E2E smoke: session-hooks public surface", () => {
  it("exports fireSessionHook, fireUserPromptSubmit, SESSION_HOOK_EVENTS", () => {
    const script = `
      import { fireSessionHook, fireUserPromptSubmit, SESSION_HOOK_EVENTS }
        from ${JSON.stringify(sessionHooksUrl)};
      console.log(JSON.stringify({
        fire: typeof fireSessionHook,
        rewrite: typeof fireUserPromptSubmit,
        events: SESSION_HOOK_EVENTS,
      }));
    `;
    const out = runNodeScript("exports", script);
    const parsed = JSON.parse(out.trim().split(/\r?\n/).pop());
    expect(parsed.fire).toBe("function");
    expect(parsed.rewrite).toBe("function");
    expect(parsed.events).toEqual([
      "SessionStart",
      "UserPromptSubmit",
      "AssistantResponse",
      "SessionEnd",
    ]);
  });

  it("fireSessionHook is a no-op when hookDb is null (smoke)", async () => {
    const script = `
      import { fireSessionHook } from ${JSON.stringify(sessionHooksUrl)};
      const r = await fireSessionHook(null, 'SessionStart', { sessionId: 's1' });
      console.log(JSON.stringify({ ok: Array.isArray(r), len: r.length }));
    `;
    const out = runNodeScript("noop", script);
    const parsed = JSON.parse(out.trim().split(/\r?\n/).pop());
    expect(parsed.ok).toBe(true);
    expect(parsed.len).toBe(0);
  });

  it("fireUserPromptSubmit returns the original prompt when no hookDb", async () => {
    const script = `
      import { fireUserPromptSubmit } from ${JSON.stringify(sessionHooksUrl)};
      const r = await fireUserPromptSubmit(null, 'hello world');
      console.log(JSON.stringify({ prompt: r.prompt, abort: r.abort }));
    `;
    const out = runNodeScript("rewrite", script);
    const parsed = JSON.parse(out.trim().split(/\r?\n/).pop());
    expect(parsed.prompt).toBe("hello world");
    expect(parsed.abort).toBe(false);
  });
});
