import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { _SKILL_TEMPLATES } from "../../src/commands/init.js";

// Regression: the `doc-edit` skill handler is emitted as a standalone CJS
// module written to .chainlesschain/skills/doc-edit/handler.js. Its xlsx/pptx
// edit paths call firstBalancedJson(llmResult, "["), but the only import of
// that symbol lives at init.js MODULE scope — it is NOT carried into the
// emitted handler string. So the call resolved to an undefined free variable,
// threw ReferenceError, and the surrounding try/catch swallowed it into a
// misleading "LLM 返回格式不正确" — xlsx/pptx editing ALWAYS failed, even when
// the LLM returned perfectly valid JSON. Fix: inline firstBalancedJson into
// the handler template.

describe("doc-edit handler: firstBalancedJson is resolvable in the emitted module", () => {
  let dir;
  let mod;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "cc-docedit-"));
    const handler = _SKILL_TEMPLATES["doc-edit"].handler;
    // Append a probe that exercises firstBalancedJson in the handler's own
    // module scope (same scope its xlsx/pptx code uses it from). module.exports
    // was reassigned to the docEdit function; attach the probe as a property.
    const probed =
      handler +
      "\nmodule.exports.__probeFirstBalancedJson = () => firstBalancedJson('noise [1,2,3] tail', \"[\");\n";
    const file = join(dir, "handler.cjs");
    writeFileSync(file, probed, "utf-8");
    const require = createRequire(import.meta.url);
    mod = require(file);
  });

  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("resolves firstBalancedJson (no ReferenceError) and extracts the JSON array", () => {
    // Before the fix this threw ReferenceError: firstBalancedJson is not defined.
    expect(mod.__probeFirstBalancedJson()).toBe("[1,2,3]");
  });
});
