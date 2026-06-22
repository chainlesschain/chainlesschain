/**
 * pdh-load-error — shared rewritePdhLoadError + importPdh unit tests.
 *
 * This is the single source of truth for turning an incomplete-pdh-install
 * resolution failure into an actionable repair message, used by the hub
 * wiring, the ws system-data ingest, and the `cc hub collect-*` / `salvage`
 * forensics commands. The rewrite must fire for a missing pdh module and pass
 * everything else through untouched; importPdh must surface that rewrite on a
 * failed dynamic import and otherwise return the module namespace verbatim.
 */

import { describe, it, expect } from "vitest";
import { rewritePdhLoadError, importPdh } from "../pdh-load-error.js";

function missingPdhModuleError() {
  const err = new Error(
    "Cannot find module '.../@chainlesschain/personal-data-hub/lib/adapters/wechat/index.js'",
  );
  err.code = "ERR_MODULE_NOT_FOUND";
  err.url =
    "file:///.../@chainlesschain/personal-data-hub/lib/adapters/wechat/index.js";
  return err;
}

describe("rewritePdhLoadError", () => {
  it("rewrites a missing pdh module into the actionable repair error", () => {
    const err = missingPdhModuleError();
    const out = rewritePdhLoadError(err);
    expect(out).not.toBe(err);
    expect(out.code).toBe("PDH_INSTALL_INCOMPLETE");
    expect(out.cause).toBe(err);
    expect(out.message).toMatch(/incomplete/i);
    expect(out.message).toMatch(/npm i -g chainlesschain/);
  });

  it("rewrites when the package root itself is missing (no url)", () => {
    const err = new Error(
      "Cannot find package '@chainlesschain/personal-data-hub' imported from x",
    );
    err.code = "ERR_MODULE_NOT_FOUND";
    expect(rewritePdhLoadError(err).code).toBe("PDH_INSTALL_INCOMPLETE");
  });

  it("passes through a missing module that is NOT pdh", () => {
    const err = new Error("Cannot find module './other.js'");
    err.code = "ERR_MODULE_NOT_FOUND";
    expect(rewritePdhLoadError(err)).toBe(err);
  });

  it("passes through a real pdh runtime bug (TypeError)", () => {
    const err = new TypeError("x is not a function in personal-data-hub");
    expect(rewritePdhLoadError(err)).toBe(err);
  });

  it("is null/undefined safe", () => {
    expect(rewritePdhLoadError(null)).toBe(null);
    expect(rewritePdhLoadError(undefined)).toBe(undefined);
  });
});

describe("importPdh", () => {
  it("returns the module namespace for a resolvable specifier", async () => {
    // Self-import: the shared module is always resolvable.
    const ns = await importPdh(
      new URL("../pdh-load-error.js", import.meta.url),
    );
    expect(typeof ns.importPdh).toBe("function");
    expect(typeof ns.rewritePdhLoadError).toBe("function");
  });

  it("passes a non-pdh resolution failure through unchanged", async () => {
    // importPdh surfaces real failures; the rewrite is scoped to pdh, so a
    // missing local module rejects with its original (non-PDH) error. (The
    // actual missing-pdh-file → PDH_INSTALL_INCOMPLETE rewrite is covered by
    // the rewritePdhLoadError cases above; a real ERR_MODULE_NOT_FOUND for a
    // defined-but-missing pdh export can't be provoked without corrupting the
    // installed package.)
    let caught;
    try {
      await importPdh("./__no_such_local_module__.js");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeTruthy();
    expect(caught.code).not.toBe("PDH_INSTALL_INCOMPLETE");
  });
});
