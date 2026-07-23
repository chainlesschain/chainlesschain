import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { CLI_BIN, testHome } from "./_helpers/cli-e2e.js";

/**
 * E2E: `cc note search <query>` escapes LIKE wildcards.
 *
 * The search built its pattern as `%${query}%` and bound it into
 * `title LIKE ? OR content LIKE ?` with NO escaping and NO `ESCAPE '\'` clause,
 * so the user's `%` / `_` acted as SQL wildcards:
 *   - `note search "%"`   → pattern `%%%`  → matched EVERY note
 *   - `note search "50%"` → pattern `%50%%` → matched "5000…" too (over-match)
 * The sibling `id LIKE ? ESCAPE '\'` sites in the same file already escape via
 * likePrefix — this search path was the outlier. Fix routes the query through
 * escapeLike() + `ESCAPE '\'`.
 */
describe("E2E: note search escapes LIKE wildcards", () => {
  const t = testHome("note-search-like");
  afterAll(() => t.cleanup());

  const run = (args) =>
    spawnSync(process.execPath, [CLI_BIN, ...args], {
      encoding: "utf-8",
      timeout: 30000,
      env: { ...t.env(), NODE_NO_WARNINGS: "1" },
    });

  const mustRun = (args) => {
    const result = run(args);
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
  };

  const search = (q) => {
    const r = run(["note", "search", q, "--json"]);
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
    // None of these titles/contents contain a literal % or _.
    mustRun(["note", "add", "alpha", "-c", "first body"]);
    mustRun(["note", "add", "beta", "-c", "second body"]);
    // One note whose content contains a literal "50%"; another with "5000".
    mustRun(["note", "add", "discount", "-c", "save 50% today"]);
    mustRun(["note", "add", "inventory", "-c", "we have 5000 units"]);
  }, 120_000);

  it('`note search "%"` matches only notes with a literal % (wildcard escaped)', () => {
    const results = search("%");
    // After escaping, `%` is literal — only "discount" ("save 50% today")
    // contains a literal '%'. (Before the fix this matched all 4 notes.)
    const titles = results.map((n) => n.title).sort();
    expect(titles).toEqual(["discount"]);
  });

  it('`note search "50%"` matches only the literal-50% note, not "5000"', () => {
    const results = search("50%");
    const titles = results.map((n) => n.title).sort();
    expect(titles).toEqual(["discount"]);
  });

  it("a plain-word search still works", () => {
    const results = search("body");
    const titles = results.map((n) => n.title).sort();
    expect(titles).toEqual(["alpha", "beta"]);
  });
});
