import { describe, expect, it } from "vitest";
import {
  assertGateJobs,
  jobPlatform,
  verifyWorkflowGate,
} from "../../scripts/verify-release-gates.mjs";

const gate = {
  workflow: "cli-ci.yml",
  name: "CLI CI",
  platforms: ["linux", "windows", "macos"],
};

function job(name, labels = []) {
  return { name, labels, status: "completed", conclusion: "success" };
}

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

describe("exact-SHA CLI release gates", () => {
  it("classifies runner labels and requires all three platforms", () => {
    expect(jobPlatform(job("test", ["ubuntu-latest"]))).toBe("linux");
    expect(jobPlatform(job("test", ["windows-latest"]))).toBe("windows");
    expect(jobPlatform(job("verify-cli (macos-15)"))).toBe("macos");
    expect(
      assertGateJobs(gate, [
        job("linux", ["ubuntu-latest"]),
        job("windows", ["windows-latest"]),
        job("mac", ["macos-15"]),
      ]),
    ).toEqual(["linux", "macos", "windows"]);
  });

  it("rejects skipped/failed jobs and an incomplete matrix", () => {
    expect(() =>
      assertGateJobs(gate, [
        job("linux", ["ubuntu-latest"]),
        { ...job("windows", ["windows-latest"]), conclusion: "skipped" },
        job("mac", ["macos-15"]),
      ]),
    ).toThrow(/non-success jobs/);
    expect(() =>
      assertGateJobs(gate, [
        job("linux", ["ubuntu-latest"]),
        job("windows", ["windows-latest"]),
      ]),
    ).toThrow(/missing required platform jobs: macos/);
  });

  it("permits only explicitly optional skipped jobs", () => {
    expect(
      assertGateJobs({ ...gate, optionalJobs: [/dry-run-publish/i] }, [
        job("linux", ["ubuntu-latest"]),
        job("windows", ["windows-latest"]),
        job("mac", ["macos-15"]),
        {
          ...job("dry-run-publish", ["ubuntu-latest"]),
          conclusion: "skipped",
        },
      ]),
    ).toEqual(["linux", "macos", "windows"]);
  });

  it("selects only a successful run attached to the exact release SHA", async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      if (url.includes("/workflows/")) {
        return response({
          workflow_runs: [
            { id: 1, head_sha: "old", conclusion: "success" },
            {
              id: 2,
              head_sha: "release-sha",
              conclusion: "success",
              updated_at: "2026-08-01T00:00:00Z",
              html_url: "https://example.test/runs/2",
            },
          ],
        });
      }
      return response({
        jobs: [
          job("linux", ["ubuntu-latest"]),
          job("windows", ["windows-latest"]),
          job("mac", ["macos-15"]),
        ],
      });
    };
    await expect(
      verifyWorkflowGate({
        fetchImpl,
        apiUrl: "https://api.example.test",
        repository: "org/repo",
        token: "test",
        sha: "release-sha",
        gate,
      }),
    ).resolves.toMatchObject({ sha: "release-sha", runId: 2 });
    expect(calls[1]).toContain("/actions/runs/2/jobs");
    expect(calls[1]).toContain("filter=latest");
  });

  it("rejects a green run belonging only to an older SHA", async () => {
    const fetchImpl = async () =>
      response({
        workflow_runs: [{ id: 1, head_sha: "old", conclusion: "success" }],
      });
    await expect(
      verifyWorkflowGate({
        fetchImpl,
        repository: "org/repo",
        token: "test",
        sha: "release-sha",
        gate,
      }),
    ).rejects.toThrow(/no successful completed run for exact SHA release-sha/);
  });

  it("waits for an active retry instead of failing on an older failed run", async () => {
    let runPolls = 0;
    const fetchImpl = async (url) => {
      if (!url.includes("/workflows/")) {
        return response({
          jobs: [
            job("linux", ["ubuntu-latest"]),
            job("windows", ["windows-latest"]),
            job("mac", ["macos-15"]),
          ],
        });
      }
      runPolls += 1;
      return response({
        workflow_runs:
          runPolls === 1
            ? [
                {
                  id: 4,
                  head_sha: "release-sha",
                  status: "completed",
                  conclusion: "failure",
                },
                {
                  id: 5,
                  head_sha: "release-sha",
                  status: "in_progress",
                  conclusion: null,
                },
              ]
            : [
                {
                  id: 5,
                  head_sha: "release-sha",
                  status: "completed",
                  conclusion: "success",
                },
              ],
      });
    };
    await expect(
      verifyWorkflowGate({
        fetchImpl,
        repository: "org/repo",
        token: "test",
        sha: "release-sha",
        gate,
        waitMs: 60_000,
        pollMs: 1,
        sleep: async () => {},
      }),
    ).resolves.toMatchObject({ runId: 5 });
  });
});
