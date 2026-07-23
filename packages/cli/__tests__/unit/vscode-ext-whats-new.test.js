/**
 * What's New (cc changelog in the IDE) — pure logic: CLI argv, JSON parsing
 * of `cc changelog --json`, markdown rendering, and the one-shot upgrade
 * nudge decision. The extension command + toast are wired in extension.js
 * (registration covered by vscode-ext-activate-wiring.test.js).
 */
import { describe, it, expect } from "vitest";

import {
  buildChangelogArgs,
  parseChangelogJson,
  chooseChangelogReleases,
  reconcileChangelogReleases,
  loadBundledChangelog,
  changelogToMarkdown,
  upgradeNudge,
} from "../../../vscode-extension/src/whats-new.js";

const RELEASES = [
  {
    productVersion: "v5.0.3.135",
    cliVersion: "0.162.151",
    date: "2026-07-06",
    title: "cc changelog command",
    sections: [
      { heading: "Added — `cc changelog`", body: "> note\n\n- offline data" },
      { heading: "", body: "loose body" },
    ],
  },
  {
    productVersion: null,
    cliVersion: "0.162.150",
    date: null,
    title: "",
    sections: [{ heading: "Fixed", body: "- many things" }],
  },
];

describe("buildChangelogArgs", () => {
  it("asks for the recent releases as JSON", () => {
    expect(buildChangelogArgs({})).toEqual(["changelog", "-n", "5", "--json"]);
    expect(buildChangelogArgs({ limit: 2 })[2]).toBe("2");
  });
});

describe("parseChangelogJson", () => {
  it("extracts releases[] and rejects everything else", () => {
    expect(
      parseChangelogJson(JSON.stringify({ releases: RELEASES })),
    ).toHaveLength(2);
    // Old CLI: `changelog` is an unknown command → error text, not JSON.
    expect(parseChangelogJson("error: unknown command 'changelog'")).toBeNull();
    expect(parseChangelogJson('{"notReleases": []}')).toBeNull();
    expect(parseChangelogJson("")).toBeNull();
  });
});

describe("chooseChangelogReleases", () => {
  it("falls back when valid CLI JSON contains an empty release list", () => {
    const bundled = [{ cliVersion: "0.162.176" }];
    expect(chooseChangelogReleases([], bundled)).toBe(bundled);
    expect(chooseChangelogReleases(RELEASES, bundled)).toBe(RELEASES);
  });
});

describe("reconcileChangelogReleases", () => {
  it("makes a stale non-empty artifact explicit at the installed version", () => {
    const stale = [{ cliVersion: "0.162.170", cliVersions: ["0.162.170"] }];
    const result = reconcileChangelogReleases(stale, {
      installed: "0.162.176",
    });
    expect(result.stale).toBe(true);
    expect(result.releases[0].cliVersion).toBe("0.162.176");
    expect(result.releases[0].sections[0].body).toContain(
      "Newest bundled notes: `0.162.170`",
    );
  });

  it("recognizes the installed version in a multi-version release block", () => {
    const result = reconcileChangelogReleases(
      [{ cliVersion: "0.162.176", cliVersions: ["0.162.175", "0.162.176"] }],
      { installed: "0.162.175" },
    );
    expect(result.stale).toBe(false);
    expect(result.releases).toHaveLength(1);
  });
});

describe("loadBundledChangelog", () => {
  it("recovers from a Windows cc wrapper whose CLI returned empty JSON", () => {
    const reads = new Map([
      [
        "/nodejs/node_modules/chainlesschain/src/data/changelog.json",
        JSON.stringify({ releases: [{ cliVersion: "0.162.175" }] }),
      ],
    ]);
    const fakeFs = {
      existsSync: (filePath) => reads.has(filePath),
      readFileSync: (filePath) => reads.get(filePath),
    };
    const releases = loadBundledChangelog({
      command: "cc",
      env: { PATH: "/nodejs" },
      fsApi: fakeFs,
      pathApi: require("node:path/posix"),
    });
    expect(releases).toEqual([{ cliVersion: "0.162.175" }]);
  });
});

describe("changelogToMarkdown", () => {
  it("renders versions as headings, keeps section bodies, strips blockquotes", () => {
    const md = changelogToMarkdown(RELEASES);
    expect(md).toContain("# cc CLI — What's New");
    expect(md).toContain("## 0.162.151 (product v5.0.3.135, 2026-07-06)");
    expect(md).toContain("### Added — `cc changelog`");
    expect(md).toContain("- offline data");
    expect(md).toContain("## 0.162.150");
    expect(md).not.toContain("> note"); // blockquote marker stripped
    expect(md).not.toMatch(/\n{3,}/); // no blank-run bloat
  });

  it("marks the installed CLI version in the rendered heading", () => {
    expect(changelogToMarkdown(RELEASES, { installed: "0.162.151" })).toContain(
      "## 0.162.151 (product v5.0.3.135, 2026-07-06) ← installed",
    );
  });
});

describe("upgradeNudge", () => {
  it("fires only on a real version change with a remembered previous", () => {
    expect(upgradeNudge("0.162.150", "0.162.151")).toMatchObject({
      message: expect.stringContaining("0.162.150 → 0.162.151"),
      button: "What's New",
    });
    expect(upgradeNudge(null, "0.162.151")).toBeNull(); // first run: silent
    expect(upgradeNudge("0.162.151", "0.162.151")).toBeNull(); // unchanged
    expect(upgradeNudge("0.162.150", null)).toBeNull(); // cc missing now
  });

  it("does NOT fire on a downgrade (installing an older cc)", () => {
    // "updated 0.162.151 → 0.162.148" would be wrong, and the notes button
    // needs cc >= 0.162.151 anyway (the older CLI just errors).
    expect(upgradeNudge("0.162.151", "0.162.148")).toBeNull();
    expect(upgradeNudge("0.163.0", "0.162.151")).toBeNull();
  });
});
