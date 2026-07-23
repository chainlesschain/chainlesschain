/**
 * Tests for the CLI-focused CHANGELOG parser (src/lib/changelog.js).
 *
 * The repo-root CHANGELOG.md is organized by PRODUCT version; the parser must
 * distill it into a CLI-only view. The tricky part is the gate: a block that
 * merely BUNDLES a new cli version (a PDH/Android collector release) must be
 * excluded, while a block that actually documents CLI changes must be kept.
 * Every case below pins one gate decision so a future regex loosening surfaces.
 */
import { describe, it, expect } from "vitest";
import {
  parseChangelog,
  extractCliVersions,
  compareSemver,
  hasCliVersion,
  latestCliVersion,
} from "../../src/lib/changelog.js";

describe("extractCliVersions", () => {
  it("captures the released (highest) CLI npm version", () => {
    const { primary, all } = extractCliVersions(
      "`chainlesschain` 0.162.149 → **0.162.150** 已发 npm",
    );
    // The parser captures the released ARROW TARGET, not the "from" version.
    expect(primary).toBe("0.162.150");
    expect(all).toContain("0.162.150");
  });

  it("captures a bundled 'cli 0.x' version from a bundle-roll note", () => {
    const { primary } = extractCliVersions("(pdh 0.4.6 / cli 0.162.48)");
    expect(primary).toBe("0.162.48");
  });

  it("never captures a 4-segment product version as a CLI version", () => {
    const { primary, all } = extractCliVersions(
      "## [v5.0.3.134] - 2026-07-03 — CLI fix (desktop 5.0.3-alpha.134)",
    );
    // Only CLI 0.x tokens survive the major-0 filter; product 5.0.3.x is dropped.
    expect(all.every((v) => v.startsWith("0."))).toBe(true);
    expect(primary).toBeNull();
  });

  it("returns null when no CLI version is present", () => {
    expect(extractCliVersions("just some desktop notes").primary).toBeNull();
  });
});

describe("compareSemver", () => {
  it("orders plain X.Y.Z numerically (not lexicographically)", () => {
    expect(compareSemver("0.162.9", "0.162.10")).toBeLessThan(0);
    expect(compareSemver("0.162.150", "0.162.148")).toBeGreaterThan(0);
    expect(compareSemver("0.162.1", "0.162.1")).toBe(0);
  });
});

describe("hasCliVersion", () => {
  it("checks both the primary and all versions covered by a release block", () => {
    const releases = [
      {
        cliVersion: "0.162.176",
        cliVersions: ["0.162.175", "0.162.176"],
      },
    ];
    expect(hasCliVersion(releases, "0.162.176")).toBe(true);
    expect(hasCliVersion(releases, "0.162.175")).toBe(true);
    expect(hasCliVersion(releases, "0.162.170")).toBe(false);
    expect(latestCliVersion(releases)).toBe("0.162.176");
  });
});

describe("parseChangelog — CLI-relevance gate", () => {
  it("splits CLI sections in Unreleased into independently limitable releases", () => {
    const md = [
      "## [Unreleased]",
      "",
      "### Added — cc CLI 0.162.176: newest",
      "",
      "> `chainlesschain` 0.162.175 → **0.162.176** (2026-07-23)",
      "- newest change",
      "",
      "### Fixed — cc CLI 0.162.175: previous",
      "",
      "> `chainlesschain` 0.162.174 → **0.162.175** (2026-07-21)",
      "- previous fix",
    ].join("\n");
    const rel = parseChangelog(md);
    expect(rel.map((item) => item.cliVersion)).toEqual([
      "0.162.176",
      "0.162.175",
    ]);
    expect(rel[0]).toMatchObject({
      productVersion: null,
      date: "2026-07-23",
    });
    expect(rel[0].sections).toHaveLength(1);
  });

  it("keeps a block with an uppercase-CLI ### section", () => {
    const md = [
      "## [v5.0.3.134] - 2026-07-03 — some release",
      "",
      "### Fixed — cc CLI 0.162.148: security fix",
      "",
      "- `chainlesschain` 0.162.147 → **0.162.148** 已发 npm",
      "- fixed a thing",
    ].join("\n");
    const rel = parseChangelog(md);
    expect(rel).toHaveLength(1);
    expect(rel[0].cliVersion).toBe("0.162.148");
    expect(rel[0].productVersion).toBe("v5.0.3.134");
    expect(rel[0].date).toBe("2026-07-03");
    expect(rel[0].sections).toHaveLength(1);
  });

  it("EXCLUDES a PDH release that only bundles a new cli version", () => {
    // Real-world false-positive shape: collector release, non-CLI ### heading,
    // cli version appears only in a bundle-roll note + boilerplate footer.
    const md = [
      "## [v5.0.3.108] - 2026-06-13 — 拼多多采集补全 (pdh 0.4.6 / cli 0.162.48)",
      "",
      "### Added — `social-pdd` 采集器",
      "",
      "> `@chainlesschain/personal-data-hub` 0.4.5 → 0.4.6、CLI `chainlesschain` 0.162.47 → 0.162.48 已发 npm",
      "- **Version surfaces**: CLI 0.162.47 → 0.162.48 / productVersion v5.0.3.107 → v5.0.3.108",
    ].join("\n");
    expect(parseChangelog(md)).toHaveLength(0);
  });

  it("keeps a section-less block whose ## TITLE names the CLI", () => {
    const md = [
      "## [v5.0.3.68] - 2026-05-20 — CLI npm 0.162.3 catch-up",
      "",
      "- bumps the npm package to **0.162.3**",
      "- **Version surfaces**: CLI 0.162.2 → 0.162.3",
    ].join("\n");
    const rel = parseChangelog(md);
    expect(rel).toHaveLength(1);
    expect(rel[0].cliVersion).toBe("0.162.3");
    expect(rel[0].sections[0].heading).toBe("");
  });

  it("EXCLUDES a section-less PDH block despite the boilerplate 'CLI 0.x' footer", () => {
    const md = [
      "## [v5.0.3.73] - 2026-05-20 — PDH test sweep 收口",
      "",
      "- fixed collectors",
      "- **Version surfaces**: CLI 0.162.8 → 0.162.9 / productVersion v5.0.3.72 → v5.0.3.73",
    ].join("\n");
    // Title has no uppercase "CLI"; the boilerplate footer must not let it in.
    expect(parseChangelog(md)).toHaveLength(0);
  });

  it("drops non-CLI ### sections from a mixed release, keeps CLI ones", () => {
    const md = [
      "## [v5.0.3.134] - 2026-07-03 — mixed release",
      "",
      "### Fixed — CLI 安全：OAuth fix",
      "",
      "- `chainlesschain` **0.162.148** 已发 npm",
      "",
      "### Fixed — 桌面 workflow-engine resume",
      "",
      "- desktop-only change",
    ].join("\n");
    const rel = parseChangelog(md);
    expect(rel).toHaveLength(1);
    expect(rel[0].sections).toHaveLength(1);
    expect(rel[0].sections[0].heading).toMatch(/CLI 安全/);
  });
});
