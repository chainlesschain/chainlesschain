import { describe, expect, it } from "vitest";
import { loadChangelog } from "../../src/lib/changelog.js";

describe("loadChangelog", () => {
  it("falls back to bundled data when a parent CHANGELOG is unrelated", () => {
    const bundled = {
      source: "CHANGELOG.md",
      releases: [{ cliVersion: "0.162.175", sections: [] }],
    };
    const fakeFs = {
      existsSync: () => true,
      readFileSync: (filePath) =>
        String(filePath).endsWith("changelog.json")
          ? JSON.stringify(bundled)
          : "# Node.js Changelog\n\n* Node 22\n",
    };

    const result = loadChangelog({
      fsApi: fakeFs,
      dirname: "/global/node_modules/chainlesschain/src/lib",
    });

    expect(result).toEqual(bundled);
  });
});
