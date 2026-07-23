/**
 * Unit tests for `cc changelog` (src/commands/changelog.js).
 * The bundled data loader is mocked with synthetic releases; the real command
 * selection / rendering runs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";

const RELEASES = [
  {
    productVersion: "Unreleased",
    cliVersion: "0.162.150",
    cliVersions: ["0.162.149", "0.162.150"],
    date: null,
    title: "",
    sections: [{ heading: "Fixed — cc CLI 0.162.150", body: "- a fix" }],
  },
  {
    productVersion: "v5.0.3.134",
    cliVersion: "0.162.148",
    cliVersions: ["0.162.148"],
    date: "2026-07-03",
    title: "OAuth injection fix",
    sections: [{ heading: "Fixed — CLI 安全", body: "- security fix" }],
  },
  {
    productVersion: "v5.0.3.68",
    cliVersion: "0.162.3",
    cliVersions: ["0.162.3"],
    date: "2026-05-20",
    title: "catch-up",
    sections: [{ heading: "", body: "- older notes" }],
  },
];

vi.mock("../../src/lib/changelog.js", () => ({
  loadChangelog: vi.fn(() => ({
    generatedAt: "2026-07-06T00:00:00.000Z",
    source: "CHANGELOG.md",
    releases: RELEASES,
  })),
  latestCliVersion: vi.fn(() => "0.162.150"),
}));
vi.mock("../../src/constants.js", () => ({ VERSION: "0.162.150" }));

const logs = [];
vi.mock("../../src/lib/logger.js", () => {
  const push = (m) => logs.push(String(m ?? ""));
  const logger = {
    log: push,
    info: push,
    warn: push,
    newline: () => logs.push(""),
    success: push,
  };
  return { default: logger, logger };
});

const { registerChangelogCommand } =
  await import("../../src/commands/changelog.js");

function run(...args) {
  logs.length = 0;
  const program = new Command();
  program.exitOverride();
  registerChangelogCommand(program);
  program.parse(["node", "cc", "changelog", ...args]);
  return logs.join("\n");
}

describe("cc changelog", () => {
  beforeEach(() => {
    logs.length = 0;
  });

  it("shows the N most recent releases by default (limit)", () => {
    const out = run("-n", "2");
    expect(out).toContain("Showing 2 of 3");
    expect(out).toContain("0.162.150");
    expect(out).toContain("0.162.148");
    expect(out).not.toContain("0.162.3");
  });

  it("marks the installed version", () => {
    const out = run();
    expect(out).toMatch(/0\.162\.150[\s\S]*installed/);
  });

  it("--all shows every release", () => {
    const out = run("--all");
    expect(out).toContain("Showing 3 of 3");
    expect(out).toContain("0.162.3");
  });

  it("filters by CLI version", () => {
    const out = run("0.162.148");
    expect(out).toContain("Showing 1 of 3");
    expect(out).toContain("OAuth injection fix");
    // The banner always prints "installed: 0.162.150", so assert the excluded
    // release's unique section heading is absent rather than the bare version.
    expect(out).not.toContain("Fixed — cc CLI 0.162.150");
  });

  it("filters by product version (bare tail and v-prefixed)", () => {
    expect(run("134")).toContain("0.162.148");
    expect(run("v5.0.3.134")).toContain("0.162.148");
  });

  it("reports an unknown version with the available list", () => {
    const out = run("9.9.9");
    expect(out).toMatch(/No CLI release notes found/i);
    expect(out).toContain("0.162.150");
    expect(out).toContain("0.162.3");
  });

  it("keeps version metadata when a JSON query has no matching release", () => {
    const json = JSON.parse(run("9.9.9", "--json"));
    expect(json.releases).toEqual([]);
    expect(json.installedVersion).toBe("0.162.150");
    expect(json.latestDocumentedVersion).toBe("0.162.150");
  });

  it("--json emits structured data for the selection", () => {
    const out = run("0.162.148", "--json");
    const json = JSON.parse(out);
    expect(json.releases).toHaveLength(1);
    expect(json.releases[0].cliVersion).toBe("0.162.148");
    expect(json.source).toBe("CHANGELOG.md");
    expect(json.installedVersion).toBe("0.162.150");
    expect(json.latestDocumentedVersion).toBe("0.162.150");
  });
});
