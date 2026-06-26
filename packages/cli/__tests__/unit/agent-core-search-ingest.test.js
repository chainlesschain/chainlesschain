/**
 * Unit tests for `_ingestSearchOutput` — the per-line ingestion shared by
 * search_files' success path AND its maxBuffer-overflow salvage path.
 *
 * Regression context: on Windows the search command (`findstr /s`, `dir /s`)
 * has no `head` cap, so a large tree can exceed execSync's maxBuffer and throw
 * ENOBUFS. The old code set no maxBuffer (1 MB default) and swallowed the throw
 * as "no matches", so a busy repo silently reported zero hits. The fix raises
 * maxBuffer to 8 MB AND salvages the partial `err.stdout` through this same
 * ingest — so partial output still yields hits instead of a false empty result.
 */

import { describe, it, expect } from "vitest";
import { _ingestSearchOutput } from "../../src/runtime/agent-core.js";

function ctx(over = {}) {
  return {
    isContent: false,
    root: "/repo",
    multiRoot: false,
    seen: new Set(),
    hits: [],
    redactedCreds: new Set(),
    credentialFileReason: () => null,
    ...over,
  };
}

describe("_ingestSearchOutput", () => {
  it("collects non-empty lines and dedups via `seen`", () => {
    const c = ctx();
    _ingestSearchOutput("a.js\nb.js\n\n  \na.js\nc.js\n", c);
    expect(c.hits).toEqual(["a.js", "b.js", "c.js"]); // blank + dup dropped
  });

  it("stops at the hit cap (default 20) even for huge output", () => {
    const c = ctx();
    const big = Array.from({ length: 5000 }, (_, i) => `f${i}.js`).join("\n");
    _ingestSearchOutput(big, c);
    expect(c.hits).toHaveLength(20);
    expect(c.hits[0]).toBe("f0.js");
    expect(c.hits[19]).toBe("f19.js");
  });

  it("labels hits with the root only when searching multiple roots", () => {
    const single = ctx({ multiRoot: false });
    _ingestSearchOutput("x.js\n", single);
    expect(single.hits).toEqual(["x.js"]);

    const multi = ctx({ multiRoot: true, root: "/pkg-a" });
    _ingestSearchOutput("x.js\n", multi);
    expect(multi.hits).toEqual(["/pkg-a: x.js"]);
  });

  it("redacts credential-file content hits (findstr file:line:text form)", () => {
    const c = ctx({
      isContent: true,
      credentialFileReason: (src) => (/\.env$/.test(src) ? "env file" : null),
    });
    _ingestSearchOutput(
      "src\\app.js:12:const key = readKey()\n" +
        "C:\\proj\\.env:3:API_KEY=supersecret\n",
      c,
    );
    // The .env match is redacted (recorded as a path, never its content)…
    expect(c.redactedCreds.has("C:/proj/.env")).toBe(true);
    // …and the secret line never reaches the hit list.
    expect(c.hits).toEqual(["src\\app.js:12:const key = readKey()"]);
    expect(c.hits.join("\n")).not.toContain("supersecret");
  });

  it("accumulates across two calls — the maxBuffer-salvage scenario", () => {
    // success then catch(err.stdout), or two roots: shared seen/hits carry over.
    const c = ctx();
    _ingestSearchOutput("a.js\nb.js\n", c);
    // simulates the catch branch ingesting a partial err.stdout after a throw:
    _ingestSearchOutput("b.js\nc.js\nd.js\n", c);
    expect(c.hits).toEqual(["a.js", "b.js", "c.js", "d.js"]); // dedup holds
  });

  it("tolerates empty/undefined output without throwing", () => {
    const c = ctx();
    expect(() => _ingestSearchOutput("", c)).not.toThrow();
    expect(() => _ingestSearchOutput(undefined, c)).not.toThrow();
    expect(c.hits).toEqual([]);
  });
});
