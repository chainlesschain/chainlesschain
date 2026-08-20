import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

describe("IDE roadmap iOS remote-session recovery gate", () => {
  it("declares the macOS host-test deployment target used by SwiftPM", () => {
    const manifest = read("ios-app/Package.swift");
    expect(manifest).toContain(".iOS(.v16)");
    expect(manifest).toContain(".macOS(.v12)");
  });

  it("binds the simulator build and recovery tests to one exact commit", () => {
    const workflow = read(".github/workflows/ios-app-target-test.yml");
    expect(workflow).toContain(
      "IOS_RECOVERY_COMMIT: ${{ inputs.commit_sha || github.event.pull_request.head.sha || github.sha }}",
    );
    expect(workflow).toContain("swift test --filter RemoteSessionClientTests");
    expect(workflow).toContain("generic/platform=iOS Simulator");
    for (const action of workflow.matchAll(/^\s*uses:\s+([^\s#]+)/gmu)) {
      expect(action[1]).toMatch(/@[0-9a-f]{40}$/u);
    }
  });
});
