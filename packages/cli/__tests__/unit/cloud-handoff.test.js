import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";

const testHome = join(tmpdir(), `cc-cloud-${Date.now()}`);
vi.mock("../../src/lib/paths.js", () => ({ getHomeDir: () => testHome }));

const {
  CloudClient,
  saveJob,
  readJob,
  listJobs,
  pollUntilDone,
  cloudJobsDir,
  TERMINAL_CLOUD_STATUS,
} = await import("../../src/lib/cloud/cloud-client.js");
const { bundleBranch, applyResultPatch, persistResultArtifacts } =
  await import("../../src/lib/cloud/bundle.js");

beforeEach(() => mkdirSync(testHome, { recursive: true }));
afterEach(() => rmSync(testHome, { recursive: true, force: true }));

/** Minimal fake fetch that scripts runner responses per path. */
function fakeFetch(routes) {
  return vi.fn(async (url, init) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const route = routes[`${init?.method || "GET"} ${path}`] || routes[path];
    if (!route) return { ok: false, status: 404, json: async () => ({}) };
    const body = typeof route === "function" ? route(init) : route;
    return { ok: true, status: 200, json: async () => body };
  });
}

describe("CloudClient", () => {
  it("requires a base URL", () => {
    expect(() => new CloudClient({})).toThrow(/no cloud runner/);
  });

  it("submits a job and returns the jobId, sending the bearer token", async () => {
    let seenAuth;
    const fetch = fakeFetch({
      "POST /v1/jobs": (init) => {
        seenAuth = init.headers.Authorization;
        return { jobId: "job-1" };
      },
    });
    const client = new CloudClient({
      baseUrl: "https://runner.local/",
      token: "sekret",
      deps: { fetch },
    });
    const res = await client.submit({
      task: "fix the bug",
      bundle: "YmFzZTY0",
      branch: "main",
      baseSha: "abc",
    });
    expect(res.jobId).toBe("job-1");
    expect(seenAuth).toBe("Bearer sekret");
  });

  it("throws on a non-ok runner response and a missing jobId", async () => {
    const client = new CloudClient({
      baseUrl: "https://r.local",
      deps: {
        fetch: vi.fn(async () => ({
          ok: false,
          status: 500,
          json: async () => ({}),
        })),
      },
    });
    await expect(client.status("x")).rejects.toThrow(/HTTP 500/);

    const client2 = new CloudClient({
      baseUrl: "https://r.local",
      deps: { fetch: fakeFetch({ "POST /v1/jobs": {} }) },
    });
    await expect(client2.submit({ task: "t", bundle: "b" })).rejects.toThrow(
      /did not return a jobId/,
    );
  });
});

describe("job ledger", () => {
  it("saves, reads, and lists jobs newest first", () => {
    saveJob({ jobId: "j1", task: "a", submittedAt: 10 });
    saveJob({ jobId: "j2", task: "b", submittedAt: 20 });
    expect(readJob("j1").task).toBe("a");
    expect(listJobs().map((j) => j.jobId)).toEqual(["j2", "j1"]);
    expect(cloudJobsDir()).toContain("cloud-jobs");
  });

  it("rejects an unsafe job id path", () => {
    expect(() => saveJob({ jobId: "../evil" })).toThrow(/invalid job id/);
  });
});

describe("pollUntilDone", () => {
  it("polls until a terminal status", async () => {
    const statuses = [
      { status: "queued" },
      { status: "running", summary: "50%" },
      { status: "done", summary: "ok" },
    ];
    let i = 0;
    const client = { status: vi.fn(async () => statuses[i++]) };
    const ticks = [];
    const final = await pollUntilDone(client, "j", {
      sleep: async () => {},
      onTick: (s) => ticks.push(s.status),
    });
    expect(final.status).toBe("done");
    expect(ticks).toEqual(["queued", "running", "done"]);
    expect(TERMINAL_CLOUD_STATUS.has("failed")).toBe(true);
  });

  it("returns timeout when the deadline passes", async () => {
    let t = 0;
    const client = { status: vi.fn(async () => ({ status: "running" })) };
    const final = await pollUntilDone(client, "j", {
      sleep: async () => {},
      now: () => (t += 1000),
      timeoutMs: 1500,
    });
    expect(final.status).toBe("timeout");
  });
});

describe("bundle + reflow (real git)", () => {
  let repo;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "cc-cloud-repo-"));
    const g = (args) =>
      execFileSync("git", args, { cwd: repo, stdio: "ignore" });
    g(["init", "-b", "main"]);
    g(["config", "user.email", "t@t.co"]);
    g(["config", "user.name", "t"]);
    writeFileSync(join(repo, "file.txt"), "original\n");
    g(["add", "."]);
    g(["commit", "-m", "init"]);
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("bundles the branch into base64 that git recognizes", () => {
    const snap = bundleBranch(repo);
    expect(snap.branch).toBe("main");
    expect(snap.baseSha).toMatch(/^[0-9a-f]{40}$/);
    expect(snap.bytes).toBeGreaterThan(0);
    // the base64 decodes to a valid git bundle (magic header)
    const decoded = Buffer.from(snap.bundle, "base64").toString("utf-8", 0, 40);
    expect(decoded).toContain("git bundle");
    expect(
      executionBroker
        .getAuditLog(20)
        .findLast((entry) => entry.origin === "cloud:git"),
    ).toMatchObject({
      origin: "cloud:git",
      scope: "cloud",
      policy: "allow",
      permissionDecision: "allow",
      shell: false,
      sync: true,
    });
  });

  it("applies a runner patch onto the local worktree", () => {
    const patch = [
      "diff --git a/file.txt b/file.txt",
      "index 0000000..1111111 100644",
      "--- a/file.txt",
      "+++ b/file.txt",
      "@@ -1 +1 @@",
      "-original",
      "+patched by runner",
      "",
    ].join("\n");
    const res = applyResultPatch(patch, repo);
    expect(res.applied).toBe(true);
    expect(readFileSync(join(repo, "file.txt"), "utf-8")).toContain(
      "patched by runner",
    );
  });

  it("reports a non-applying patch instead of throwing", () => {
    const res = applyResultPatch("not a real patch", repo);
    expect(res.applied).toBe(false);
    expect(res.reason).toMatch(/did not apply/);
    expect(applyResultPatch("", repo).reason).toMatch(/no patch/);
  });

  it("persists plan + artifacts under the destination dir", () => {
    const dest = join(testHome, "result");
    mkdirSync(dest, { recursive: true });
    const written = persistResultArtifacts(
      {
        plan: "# Plan\n1. do it",
        artifacts: [
          { name: "report.txt", content: "hello" },
          {
            name: "img.bin",
            content: Buffer.from("x").toString("base64"),
            encoding: "base64",
          },
        ],
      },
      dest,
    );
    expect(written).toHaveLength(3);
    expect(existsSync(join(dest, "plan.md"))).toBe(true);
    expect(readFileSync(join(dest, "report.txt"), "utf-8")).toBe("hello");
  });
});
