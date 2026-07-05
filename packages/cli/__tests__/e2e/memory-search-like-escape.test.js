import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { CLI_BIN, testHome } from "./_helpers/cli-e2e.js";

/**
 * E2E: `cc memory search <query>` escapes LIKE wildcards.
 *
 * searchMemory built its pattern as `%${query}%` and bound it into
 * `content LIKE ?` with NO escaping and NO `ESCAPE '\'` clause, so the user's
 * `%` / `_` acted as SQL wildcards:
 *   - `memory search "%"`   → pattern `%%%`  → matched EVERY entry
 *   - `memory search "50%"` → pattern `%50%%` → matched "5000…" too (over-match)
 * The sibling `deleteMemory` in the same file already does
 * `id LIKE ? ESCAPE '\'` via likePrefix — this search path was the outlier.
 * Fix routes the query through escapeLike() + `ESCAPE '\'`.
 */
describe("E2E: memory search escapes LIKE wildcards", () => {
  const t = testHome("memory-search-like");
  afterAll(() => t.cleanup());

  const run = (args) =>
    spawnSync(process.execPath, [CLI_BIN, ...args], {
      encoding: "utf-8",
      timeout: 30000,
      env: { ...t.env(), NODE_NO_WARNINGS: "1" },
    });

  const search = (q) => {
    const r = run(["memory", "search", q, "--json"]);
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    // --json prints a JSON array; drop stray `[Tag]` log-prefix lines (e.g.
    // "[AppConfig] …") that would otherwise swallow the array's opening `[`.
    const clean = r.stdout
      .split("\n")
      .filter((l) => !/^\s*\[[A-Za-z0-9_]+\]/.test(l))
      .join("\n");
    const jsonStart = clean.indexOf("[");
    return JSON.parse(clean.slice(jsonStart));
  };

  beforeAll(() => {
    // None of these contents contain a literal % or _ …
    run(["memory", "add", "alpha first body"]);
    run(["memory", "add", "beta second body"]);
    // … except one whose content contains a literal "50%"; another has "5000".
    run(["memory", "add", "save 50% today"]);
    run(["memory", "add", "we have 5000 units"]);
  });

  it('`memory search "%"` matches only entries with a literal % (wildcard escaped)', () => {
    const results = search("%");
    // After escaping, `%` is literal — only the "save 50% today" entry contains
    // a literal '%'. (Before the fix this matched all 4 entries.)
    const contents = results.map((e) => e.content).sort();
    expect(contents).toEqual(["save 50% today"]);
  });

  it('`memory search "50%"` matches only the literal-50% entry, not "5000"', () => {
    const results = search("50%");
    const contents = results.map((e) => e.content).sort();
    expect(contents).toEqual(["save 50% today"]);
  });

  it("a plain-word search still works", () => {
    const results = search("body");
    const contents = results.map((e) => e.content).sort();
    expect(contents).toEqual(["alpha first body", "beta second body"]);
  });
});
