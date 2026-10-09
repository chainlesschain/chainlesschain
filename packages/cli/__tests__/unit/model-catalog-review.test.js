import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { reviewModelCatalog } from "../../src/lib/model-catalog-review.js";
const review = JSON.parse(
  readFileSync(
    new URL(
      "../fixtures/model-catalog-review-2026-10-05.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
describe("reviewed model catalog drift", () => {
  const stableRelease = {
    tag_name: "rust-v0.160.1",
    html_url: "https://github.com/openai/codex/releases/tag/rust-v0.160.1",
    draft: false,
    prerelease: false,
  };
  it("reads only the stable official repository release identity from GitHub JSON", () => {
    const result = reviewModelCatalog(review, {
      codex: JSON.stringify({
        ...stableRelease,
        name: "Unrelated display title 99.0.0",
        body: "Codex CLI 88.0.0 is mentioned in the notes",
      }),
    });
    expect(result.upstream[0]).toMatchObject({
      observedVersion: "0.160.1",
      reviewRequired: true,
    });
    expect(result.automaticEnablement).toBe(false);
  });
  it.each([
    { tag_name: "v0.160.1" },
    { tag_name: "rust-v0.160.1-alpha.1" },
    { tag_name: "rust-v00.160.1" },
    { html_url: "https://github.com/other/codex/releases/tag/rust-v0.160.1" },
    { html_url: "https://github.com/openai/codex/releases/tag/rust-v0.160.0" },
    {
      html_url:
        "https://github.com/openai/codex/releases/tag/rust-v0.160.1?x=1",
    },
    { draft: true },
    { prerelease: true },
    { draft: "false" },
    { prerelease: undefined },
    { tag_name: undefined },
    { html_url: undefined },
  ])("rejects incomplete or conflicting release metadata: %j", (change) => {
    expect(() =>
      reviewModelCatalog(review, {
        codex: JSON.stringify({ ...stableRelease, ...change }),
      }),
    ).toThrow(/Cannot identify/);
  });
  it.each([
    '{"message":"API rate limit exceeded"}',
    JSON.stringify([stableRelease]),
    JSON.stringify("<h2>Codex CLI 99.0.0</h2>"),
    '{"tag_name": "rust-v0.160.1",',
    "<script><h2>Codex CLI 99.0.0</h2></script>",
    "<style><h2>Codex CLI 99.0.0</h2></style>",
    "<nav><h2>Codex CLI 99.0.0</h2></nav>",
    "<!-- <h2>Codex CLI 99.0.0</h2> -->",
    "<h2>Service unavailable</h2><p>Codex CLI 99.0.0</p>",
  ])(
    "does not promote errors or inert page text to release identity: %s",
    (codex) => {
      expect(() => reviewModelCatalog(review, { codex })).toThrow(
        /Cannot identify/,
      );
    },
  );
  it("rejects the mixed changelog structure captured in October without taking mobile versions or an old tag", () => {
    // Minimized structure of the preserved official 2026-10-09 HTML snapshot.
    const codex = `<nav><a>Codex CLI</a></nav><ul>
      <li id="codex-2026-10-07-mobile" data-product="codex" data-codex-topics="codex-mobile">
        <time>2026-10-07</time><h3><span>ChatGPT for iOS <span>1.2026.272</span></span></h3>
        <article>Mobile release notes</article>
      </li>
      <li id="codex-2026-08-11-app" data-product="codex" data-codex-topics="codex-app,codex-cli">
        <time>2026-08-11</time><h3><span>Linux desktop preview and agent imports</span></h3>
        <article>Feature notes</article>
      </li>
      <li data-product="codex" data-codex-topics="general">
        <h3>Older update</h3><article><a href="https://github.com/openai/codex/releases/tag/rust-v0.36.0">latest release notes</a></article>
      </li></ul>`;
    expect(() => reviewModelCatalog(review, { codex })).toThrow(
      /Cannot identify/,
    );
  });
  it.each(["cacheWriteMultiplier", "longContext", "serviceMultipliers"])(
    "flags pricing term drift for %s",
    (field) => {
      const changed = structuredClone(review);
      changed.models[0].pricing[field] = null;
      expect(reviewModelCatalog(changed).mismatches).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ model: "gpt-6.1-sol", field }),
        ]),
      );
    },
  );
  it("reads the official Claude MDX release label without stripping its version", () => {
    const result = reviewModelCatalog(review, {
      claude:
        '<Update label="2.1.289" description="October 3, 2026">notes</Update>',
    });
    expect(result.upstream[0]).toMatchObject({
      observedVersion: "2.1.289",
      reviewRequired: false,
    });
  });
  it("does not read Claude release labels from script or style noise", () => {
    const result = reviewModelCatalog(review, {
      claude:
        '<script><Update label="99.0.0"></Update></script><style><Update label="88.0.0"></Update></style><Update label="2.1.295">notes</Update>',
    });
    expect(result.upstream[0].observedVersion).toBe("2.1.295");
  });
  it("keeps reviewed official model contracts in the ordinary CLI gate", () => {
    expect(reviewModelCatalog(review)).toMatchObject({
      localContractPassed: true,
      reviewRequired: false,
      automaticEnablement: false,
    });
  });
  it("flags a new upstream release for review without admitting any version", () => {
    const result = reviewModelCatalog(review, {
      claude: "# Changelog\n\n## 2.1.290\nNew model\n## 2.1.289\nold",
      codex: "<script>Codex CLI 99.0.0</script><h2>Codex CLI 0.160.0</h2>",
    });
    expect(result.upstream).toEqual([
      {
        name: "claude",
        reviewedVersion: "2.1.289",
        observedVersion: "2.1.290",
        reviewRequired: true,
      },
      {
        name: "codex",
        reviewedVersion: "0.160.0",
        observedVersion: "0.160.0",
        reviewRequired: false,
      },
    ]);
    expect(result.automaticEnablement).toBe(false);
  });
  it("cannot mistake an error page or unsupported future model for a successful review", () => {
    expect(() =>
      reviewModelCatalog(review, { codex: "Rate limit exceeded" }),
    ).toThrow(/Cannot identify/);
    const changed = structuredClone(review);
    changed.models[0].model = "gpt-unknown";
    expect(reviewModelCatalog(changed)).toMatchObject({
      localContractPassed: false,
      reviewRequired: true,
    });
  });
});
