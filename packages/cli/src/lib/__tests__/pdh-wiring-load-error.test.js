/**
 * personal-data-hub-wiring — rewritePdhLoadError unit tests.
 *
 * Why this exists: after the lazy-load refactor, a partial/corrupt pdh
 * install (e.g. an interrupted `npm i -g` that left adapter files unwritten)
 * surfaces as a raw ESM `ERR_MODULE_NOT_FOUND` the first time a `cc hub …`
 * command touches the hub. That default error reads like a bug in the
 * package, not a local-install problem, so users can't self-fix. This rewrite
 * turns it into an actionable repair message. We must NOT swallow real bugs
 * inside pdh (a TypeError, or a missing module that isn't pdh) — those pass
 * through untouched. This suite pins both behaviors.
 */

import { describe, it, expect } from "vitest";
import { _rewritePdhLoadError } from "../personal-data-hub-wiring.js";

describe("rewritePdhLoadError", () => {
  it("rewrites ERR_MODULE_NOT_FOUND for a missing pdh adapter file", () => {
    const err = new Error(
      "Cannot find module '.../@chainlesschain/personal-data-hub/lib/adapters/wechat/index.js'",
    );
    err.code = "ERR_MODULE_NOT_FOUND";
    err.url =
      "file:///.../@chainlesschain/personal-data-hub/lib/adapters/wechat/index.js";
    const out = _rewritePdhLoadError(err);
    expect(out).not.toBe(err);
    expect(out.code).toBe("PDH_INSTALL_INCOMPLETE");
    expect(out.cause).toBe(err);
    expect(out.message).toMatch(/incomplete/i);
    expect(out.message).toMatch(/npm i -g chainlesschain/);
    // Keep the original error text for debugging.
    expect(out.message).toMatch(/adapters\/wechat\/index\.js/);
  });

  it("rewrites when the package root itself is missing (message-based, no url)", () => {
    const err = new Error(
      "Cannot find package '@chainlesschain/personal-data-hub' imported from x",
    );
    err.code = "ERR_MODULE_NOT_FOUND";
    const out = _rewritePdhLoadError(err);
    expect(out.code).toBe("PDH_INSTALL_INCOMPLETE");
  });

  it("passes through a missing module that is NOT pdh (unrelated dep)", () => {
    const err = new Error("Cannot find module './some-other-thing.js'");
    err.code = "ERR_MODULE_NOT_FOUND";
    expect(_rewritePdhLoadError(err)).toBe(err);
  });

  it("passes through a real pdh runtime bug (not a resolution failure)", () => {
    const err = new TypeError("foo is not a function in personal-data-hub");
    expect(_rewritePdhLoadError(err)).toBe(err);
  });

  it("is null/undefined safe", () => {
    expect(_rewritePdhLoadError(null)).toBe(null);
    expect(_rewritePdhLoadError(undefined)).toBe(undefined);
  });
});
