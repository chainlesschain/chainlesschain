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
