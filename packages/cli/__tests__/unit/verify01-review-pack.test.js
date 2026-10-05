import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { generateReviewPack } from "../../scripts/verify01-review-pack.mjs";
import {
  applyReviewMutation,
  parseReviewTests,
  reviewDockerArgs,
  reviewEnvironment,
  reviewStageDeadline,
} from "../../scripts/verify01-review-runtime.mjs";
import { evalDigest } from "../../src/lib/eval/evidence.js";

// CI uses shallow checkouts. Exercise blob addressing and byte pinning with a
// controlled Git fixture; these bytes are not frozen-source acceptance evidence.
// All syntax checks and nested Vitest executions retain the real child process.
const gitBlobFixture = vi.hoisted(() => ({
  projectCommit: "b2aa3aba082873570e85dce39b00754e5504ff37",
  paths: [
    "packages/cli/test/global-setup/windows-sandbox-adapter-temp-root.js",
    "packages/cli/test/setup/windows-sandbox-adapter-cleanup.js",
    "packages/cli/test/setup/agent-evolution-test-boundary.js",
  ],
  calls: [],
}));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    execFileSync(command, args, options) {
      if (command !== "git") return actual.execFileSync(command, args, options);
      const index = gitBlobFixture.paths.findIndex(
        (file) => args[3] === `${gitBlobFixture.projectCommit}:${file}`,
      );
      if (
        args.length !== 4 ||
        args[0] !== "-C" ||
        args[2] !== "show" ||
        index < 0
      )
        throw new Error("unexpected frozen Git blob request");
      gitBlobFixture.calls.push([...args]);
      return Buffer.from(`// synthetic Git support fixture ${index}\n`);
    },
  };
});

describe("operator acceptance pack", () => {
  it("keeps cleanup within the outer task budget and a watchdog in the container", () => {
    const now = 1000000;
    expect(reviewStageDeadline(now)).toBe(now + 600000);
    expect(reviewStageDeadline(now, now + 90000)).toBe(now + 50000);
    expect(() => reviewStageDeadline(now, now + 40000)).toThrow(/cleanup time/);
    expect(() => reviewStageDeadline(now, Number.NaN)).toThrow(
      /valid evaluator deadline/,
    );
    const args = reviewDockerArgs({
      workspace: path.resolve("workspace"),
      control: path.resolve("control"),
      containerName: "bounded",
      imageId: "sha256:" + "a".repeat(64),
      uid: 1001,
      gid: 1001,
      timeoutMs: 50000,
      command: ["node", "test.js"],
    });
    expect(args.slice(-6)).toEqual([
      "timeout",
      "--signal=TERM",
      "--kill-after=5s",
      "45s",
      "node",
      "test.js",
    ]);
  });
  it("generates all 72 self-contained pinned scripts, without answer files or task results", () => {
    const parent = fs.mkdtempSync(
      path.join(os.tmpdir(), "verify01-pack-test-"),
    );
    try {
      const root = path.join(parent, "pack");
      gitBlobFixture.calls.length = 0;
      const report = generateReviewPack({
        outputDir: root,
        imageId: "sha256:" + "a".repeat(64),
      });
      expect(report).toMatchObject({
        tasks: 36,
        generatedArtifacts: 72,
        executionStatus: "NOT_RUN",
        independentHumanReview: false,
        supportedAcceptancePlatform: "linux",
        providerAssessed: false,
      });
      expect(gitBlobFixture.calls).toHaveLength(3);
      expect(gitBlobFixture.calls.map((args) => args[1])).toEqual(
        Array(3).fill(path.resolve("../..") + path.sep),
      );
      const review = JSON.parse(
        fs.readFileSync(path.join(root, "review.json"), "utf8"),
      );
      for (const task of review.tasks)
        for (const stage of ["setup", "check"]) {
          const bytes = fs.readFileSync(path.join(root, task[stage].path));
          const spec = JSON.parse(
            bytes.toString().match(/\nconst spec = (.+);\nconst receipt =/u)[1],
          );
          expect(spec.testSupport).toEqual(
            gitBlobFixture.paths.map((file, index) => ({
              kind: index === 0 ? "globalSetup" : "setup",
              path: file,
              digest: evalDigest(
                Buffer.from(`// synthetic Git support fixture ${index}\n`),
              ),
            })),
          );
          expect(evalDigest(bytes)).toBe(task[stage].digest);
          expect(bytes.toString()).not.toMatch(/from ["']\.\.?\//u);
          const syntax = spawnSync(
            process.execPath,
            ["--check", "--input-type=module"],
            {
              input: bytes,
              encoding: "utf8",
              shell: false,
              windowsHide: true,
              timeout: 10000,
            },
          );
          expect(syntax.stderr).toBe("");
          expect(syntax.status).toBe(0);
        }
      const files = fs.readdirSync(root);
      expect(files).toHaveLength(75);
      expect(files).not.toContain("observations.json");
      expect(() =>
        generateReviewPack({
          outputDir: root,
          imageId: "sha256:" + "a".repeat(64),
        }),
      ).toThrow(/new/);
    } finally {
      fs.rmSync(parent, { recursive: true });
    }
  });
  it("does not forward credentials, loaders or user configuration into candidate tests", () => {
    expect(
      reviewEnvironment({
        PATH: "system-path",
        SystemRoot: "system-root",
        OPENAI_API_KEY: "secret",
        NODE_OPTIONS: "--import evil.mjs",
        HOME: "credential-home",
        NPM_TOKEN: "secret",
      }),
    ).toEqual({ PATH: "system-path", SystemRoot: "system-root" });
    const args = reviewDockerArgs({
      workspace: path.resolve("isolated-workspace"),
      control: path.resolve("trusted-control"),
      containerName: "test-run",
      command: ["node", "test.js"],
      imageId: "sha256:" + "a".repeat(64),
      uid: 1001,
      gid: 1001,
    });
    expect(
      args.slice(args.indexOf("--user"), args.indexOf("--user") + 2),
    ).toEqual(["--user", "1001:1001"]);
    expect(args).toContain("none");
    expect(args).toContain("--read-only");
    expect(args).toContain("ALL");
    expect(args.find((arg) => arg.includes("target=/review"))).toMatch(
      /readonly$/,
    );
    expect(args.find((arg) => arg.includes("target=/workspace"))).toMatch(
      /readonly$/,
    );
    expect(args).not.toContain("--env-file");
    expect(args).not.toContain("--privileged");
  });
  it("requires a numeric operator identity without widening container capabilities", () => {
    const options = {
      workspace: path.resolve("workspace"),
      control: path.resolve("control"),
      containerName: "operator-owned",
      command: ["node", "--version"],
      imageId: "sha256:" + "a".repeat(64),
      uid: 1001,
      gid: 1001,
    };
    for (const identity of [
      undefined,
      -1,
      0xffffffff,
      1.5,
      "root",
      "1001:0",
      NaN,
    ]) {
      expect(() => reviewDockerArgs({ ...options, uid: identity })).toThrow(
        /numeric UID/,
      );
      expect(() => reviewDockerArgs({ ...options, gid: identity })).toThrow(
        /numeric UID/,
      );
    }
    const setup = reviewDockerArgs({ ...options, setup: true });
    const check = reviewDockerArgs(options);
    for (const args of [setup, check]) {
      expect(args[args.indexOf("--user") + 1]).toBe("1001:1001");
      expect(args[args.indexOf("--cap-drop") + 1]).toBe("ALL");
      expect(args).toContain("--read-only");
      expect(args).toContain("no-new-privileges");
      expect(args).not.toContain("--cap-add");
    }
    expect(setup.find((arg) => arg.includes("target=/workspace"))).not.toMatch(
      /readonly/,
    );
    expect(check.find((arg) => arg.includes("target=/workspace"))).toMatch(
      /readonly$/,
    );
    expect(check[check.indexOf("--network") + 1]).toBe("none");
  });
  it("requires one non-equivalent mutation match and preserves surrounding code", () => {
    expect(
      applyReviewMutation("const x=1; const safe=true;", {
        name: "drop guard",
        find: "safe=true",
        replace: "safe=false",
      }),
    ).toBe("const x=1; const safe=false;");
    expect(() =>
      applyReviewMutation("guard guard", {
        name: "ambiguous",
        find: "guard",
        replace: "false",
      }),
    ).toThrow(/one exact match/);
    expect(() =>
      applyReviewMutation("changed implementation", {
        name: "stale",
        find: "guard",
        replace: "false",
      }),
    ).toThrow(/re-review/);
  });
});

describe("real Vitest reports, not implementation-shaped success flags", () => {
  function run(body) {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "verify01-real-report-"),
    );
    try {
      fs.writeFileSync(path.join(root, "candidate.test.js"), body);
      fs.writeFileSync(
        path.join(root, "vitest.config.mjs"),
        `export default ${JSON.stringify({
          test: {
            root,
            globals: true,
            include: ["candidate.test.js"],
            maxWorkers: 1,
            pool: "forks",
            cache: false,
          },
        })};`,
      );
      const result = spawnSync(
        process.execPath,
        [
          path.resolve("../../node_modules/vitest/vitest.mjs"),
          "run",
          "--config",
          path.join(root, "vitest.config.mjs"),
          "--configLoader",
          "native",
          "--reporter=json",
        ],
        {
          cwd: root,
          encoding: "utf8",
          shell: false,
          windowsHide: true,
          timeout: 30000,
        },
      );
      if (!result.stdout?.trim().startsWith("{")) {
        throw new Error(
          `Nested Vitest emitted no JSON: ${JSON.stringify({
            status: result.status,
            signal: result.signal,
            error: result.error?.message,
            stdout: result.stdout,
            stderr: result.stderr,
          })}`,
        );
      }
      return result;
    } finally {
      fs.rmSync(root, { recursive: true });
    }
  }
  it("accepts an executed positive control and requires an assertion failure for a mutant", () => {
    expect(
      parseReviewTests(run("it('positive', () => expect(2).toBe(2));")),
    ).toMatchObject({ total: 1, passed: 1 });
    const killed = run("it('mutant behavior', () => expect(2).toBe(3));");
    expect(parseReviewTests(killed, { mutant: true })).toMatchObject({
      total: 1,
      failed: 1,
    });
    expect(() => parseReviewTests(killed)).toThrow(/regression failed/);
  });
  it("rejects skipped tests and loader/syntax failures", () => {
    expect(() =>
      parseReviewTests(run("it.skip('empty acceptance', () => {});")),
    ).toThrow();
    expect(() =>
      parseReviewTests(
        run("import './nonexistent.js'; it('title', () => {});"),
        { mutant: true },
      ),
    ).toThrow();
  });
  it("recognizes real Promise matcher assertions while rejecting application errors", () => {
    for (const assertion of [
      "await expect(Promise.resolve([])).rejects.toThrow('cancelled');",
      "await expect(Promise.reject(Object.assign(new Error('commit published'), {published:true}))).rejects.toMatchObject({published:false});",
      "await expect(Promise.reject(new Error('unexpected'))).resolves.toBe(42);",
    ]) {
      const result = run(
        `it('Promise mismatch', async () => { ${assertion} });`,
      );
      expect(parseReviewTests(result, { mutant: true })).toMatchObject({
        total: 1,
        passed: 0,
        failed: 1,
      });
    }
    const applicationError = run(`it('application failure', async () => {
      throw new Error('promise resolved instead of rejecting');
    });`);
    expect(() => parseReviewTests(applicationError, { mutant: true })).toThrow(
      /must include an assertion/,
    );
  });
});
