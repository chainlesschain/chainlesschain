import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  BROWSER_EVIDENCE_WORKFLOW_PATH,
  BROWSER_EVIDENCE_WORKFLOW_PROVENANCE_SCHEMA,
  browserEvidenceArtifactName,
  browserEvidenceDiffDigest,
  parseArgs as parseProducerArgs,
  removeBrowserEvidenceTemporaryRoot,
  scanArtifactJson,
  workflowProvenance,
} from "../../scripts/ide-roadmap-browser-evidence.mjs";
import {
  parseArgs as parseAggregateArgs,
  regularFiles,
} from "../../scripts/verify-ide-roadmap-browser-evidence.mjs";

const roots = [];
const HEAD_SHA = "a".repeat(40);
const WORKFLOW_SHA = "b".repeat(40);
const REPOSITORY = "chainlesschain/chainlesschain";
const WORKFLOW_REF = `${REPOSITORY}/${BROWSER_EVIDENCE_WORKFLOW_PATH}@refs/heads/main`;
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../../..");

function producerAuthorityArgs() {
  return [
    "--repository",
    REPOSITORY,
    "--ref",
    "refs/heads/main",
    "--workflow-ref",
    WORKFLOW_REF,
    "--workflow-sha",
    WORKFLOW_SHA,
    "--run-id",
    "123",
    "--run-attempt",
    "2",
    "--job-id",
    "browser-evidence-producer-linux",
  ];
}

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-browser-script-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("browser evidence complete diff digest", () => {
  it("hashes more than 64 MiB including the final bytes without changing git selectors", async () => {
    const chunk = Buffer.alloc(1024 * 1024, 0xa5);
    const hash = createHash("sha256");
    for (let index = 0; index < 65; index++) hash.update(chunk);
    hash.update("final-diff-bytes");
    const digest = await browserEvidenceDiffDigest(
      REPOSITORY_ROOT,
      WORKFLOW_SHA,
      HEAD_SHA,
      (command, args, options) => {
        expect(command).toBe("git");
        expect(args).toEqual([
          "diff",
          "--binary",
          "--no-ext-diff",
          WORKFLOW_SHA,
          HEAD_SHA,
          "--",
        ]);
        expect(options.cwd).toBe(REPOSITORY_ROOT);
        return spawn(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            'import fs from "node:fs"; const chunk = Buffer.alloc(1024 * 1024, 0xa5); for (let i = 0; i < 65; i++) fs.writeSync(1, chunk); fs.writeSync(1, "final-diff-bytes");',
          ],
          options,
        );
      },
    );
    expect(digest).toBe(`sha256:${hash.digest("hex")}`);
  });

  it("rejects a failed diff process even after it emits partial bytes", async () => {
    await expect(
      browserEvidenceDiffDigest(
        REPOSITORY_ROOT,
        WORKFLOW_SHA,
        HEAD_SHA,
        (_command, _args, options) =>
          spawn(
            process.execPath,
            [
              "-e",
              'process.stdout.write("partial diff"); process.stderr.write("diff unavailable"); process.exitCode = 7;',
            ],
            options,
          ),
      ),
    ).rejects.toThrow("git diff failed (7): diff unavailable");
  });

  it("rejects a diff command that cannot be spawned", async () => {
    await expect(
      browserEvidenceDiffDigest(
        REPOSITORY_ROOT,
        WORKFLOW_SHA,
        HEAD_SHA,
        (_command, _args, options) =>
          spawn(path.join(temporaryRoot(), "missing-git"), [], options),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("browser evidence producer arguments and secret gate", () => {
  it("requires exact producer artifact inputs", () => {
    expect(
      parseProducerArgs([
        "--artifact-dir",
        "build/browser",
        "--head-sha",
        HEAD_SHA,
        "--os",
        "linux",
        "--artifact-name",
        `browser-evidence-linux-${HEAD_SHA}-2`,
        ...producerAuthorityArgs(),
      ]),
    ).toMatchObject({
      "artifact-dir": "build/browser",
      "head-sha": HEAD_SHA,
      os: "linux",
      "artifact-name": `browser-evidence-linux-${HEAD_SHA}-2`,
      repository: REPOSITORY,
      ref: "refs/heads/main",
      "workflow-ref": WORKFLOW_REF,
      "workflow-sha": WORKFLOW_SHA,
      "run-id": "123",
      "run-attempt": "2",
      "job-id": "browser-evidence-producer-linux",
    });
    expect(() => parseProducerArgs(["--os", "linux"])).toThrow(
      /artifact-dir is required/u,
    );
  });

  it("binds executed workflow bytes to exact head and run provenance", () => {
    const calls = [];
    const provenance = workflowProvenance(
      REPOSITORY_ROOT,
      {
        headSha: HEAD_SHA,
        repository: REPOSITORY,
        ref: "refs/pull/123/merge",
        workflowRef: WORKFLOW_REF,
        workflowSha: WORKFLOW_SHA,
        runId: "123",
        runAttempt: "2",
      },
      {
        readGitBlob: (commitSha, sourcePath) => {
          calls.push([commitSha, sourcePath]);
          return Buffer.from("exact workflow bytes");
        },
      },
    );
    expect(provenance).toMatchObject({
      schema: BROWSER_EVIDENCE_WORKFLOW_PROVENANCE_SCHEMA,
      repository: REPOSITORY,
      ref: "refs/pull/123/merge",
      workflowRef: WORKFLOW_REF,
      workflowPath: BROWSER_EVIDENCE_WORKFLOW_PATH,
      executedWorkflowSha: WORKFLOW_SHA,
      exactHeadWorkflowSha: HEAD_SHA,
      runId: "123",
      runAttempt: "2",
    });
    expect(provenance.executedWorkflowDigest).toBe(
      provenance.exactHeadWorkflowDigest,
    );
    expect(calls).toEqual([
      [WORKFLOW_SHA, BROWSER_EVIDENCE_WORKFLOW_PATH],
      [HEAD_SHA, BROWSER_EVIDENCE_WORKFLOW_PATH],
    ]);

    expect(() =>
      workflowProvenance(
        REPOSITORY_ROOT,
        {
          headSha: HEAD_SHA,
          repository: REPOSITORY,
          ref: "refs/heads/main",
          workflowRef: WORKFLOW_REF,
          workflowSha: WORKFLOW_SHA,
          runId: "123",
          runAttempt: "2",
        },
        {
          readGitBlob: (commitSha) =>
            Buffer.from(commitSha === HEAD_SHA ? "head" : "executed"),
        },
      ),
    ).toThrow(/workflow bytes differ from exact head/u);
    expect(() =>
      workflowProvenance(
        REPOSITORY_ROOT,
        {
          headSha: HEAD_SHA,
          repository: "attacker/repository",
          ref: "refs/heads/main",
          workflowRef: WORKFLOW_REF,
          workflowSha: WORKFLOW_SHA,
          runId: "123",
          runAttempt: "2",
        },
        { readGitBlob: () => Buffer.from("same") },
      ),
    ).toThrow(/workflow ref authority/u);
  });

  it("uses an exact OS/head/attempt artifact identity", () => {
    expect(browserEvidenceArtifactName("linux", HEAD_SHA, "2")).toBe(
      `browser-evidence-linux-${HEAD_SHA}-2`,
    );
    expect(() => browserEvidenceArtifactName("linux", "main", "2")).toThrow(
      /exact head SHA/u,
    );
    expect(() => browserEvidenceArtifactName("linux", HEAD_SHA, "0")).toThrow(
      /positive run attempt/u,
    );
  });

  it("retries a Chrome profile cleanup race without hiding other failures", async () => {
    let attempts = 0;
    const pauses = [];
    await removeBrowserEvidenceTemporaryRoot("/tmp/browser-profile", {
      removeTree: async () => {
        attempts += 1;
        if (attempts < 3) {
          const error = new Error("Chrome is still flushing its profile");
          error.code = "ENOTEMPTY";
          throw error;
        }
      },
      sleep: async (milliseconds) => pauses.push(milliseconds),
    });
    expect(attempts).toBe(3);
    expect(pauses).toEqual([250, 250]);
    await expect(
      removeBrowserEvidenceTemporaryRoot("/tmp/browser-profile", {
        removeTree: async () => {
          const error = new Error("unexpected cleanup failure");
          error.code = "EACCES";
          throw error;
        },
      }),
    ).rejects.toThrow(/unexpected cleanup failure/u);
  });

  it("passes workflow SHA and exact artifact identity in Actions", () => {
    const workflow = fs.readFileSync(
      path.join(REPOSITORY_ROOT, ".github/workflows/ide-extensions.yml"),
      "utf8",
    );
    const browserJobs = workflow.slice(
      workflow.indexOf("  browser-evidence-producer:"),
      workflow.indexOf("  vscode-package:"),
    );
    expect(
      browserJobs.match(/--workflow-sha "\$GITHUB_WORKFLOW_SHA"/gu),
    ).toHaveLength(2);
    expect(
      browserJobs.match(
        /git fetch --no-tags --depth=2 origin "\$GITHUB_WORKFLOW_SHA"/gu,
      ),
    ).toHaveLength(2);
    expect(browserJobs).toMatch(
      /- name: Run real local two-origin browser evidence journey\s+shell: bash\s+run:/u,
    );
    expect(browserJobs).toMatch(
      /- name: Install browser evidence aggregate dependencies\s+run:\s+>-\s+npm ci --workspace packages\/cli --include-workspace-root=false/u,
    );
    expect(workflow).toContain(
      "browser-evidence-${{ matrix.slug }}-${{ env.IDE_RELEASE_COMMIT }}-${{ github.run_attempt }}",
    );
    expect(workflow).toContain(
      "pattern: browser-evidence-*-${{ env.IDE_RELEASE_COMMIT }}-${{ github.run_attempt }}",
    );
  });

  it("counts recall-first and journey-specific secret hits", () => {
    const root = temporaryRoot();
    fs.writeFileSync(
      path.join(root, "safe.json"),
      '{"authorization":"Bearer [REDACTED]"}\n',
    );
    expect(scanArtifactJson(root)).toEqual({ hits: 0, files: 1 });
    fs.mkdirSync(path.join(root, "attachments"));
    fs.writeFileSync(
      path.join(root, "attachments", "screenshot.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    expect(scanArtifactJson(root)).toEqual({ hits: 0, files: 2 });
    fs.writeFileSync(
      path.join(root, "leak.json"),
      '{"authorization":"Bearer abcdefghijklmnop"}\n',
    );
    expect(scanArtifactJson(root).hits).toBeGreaterThanOrEqual(1);
  });
});

describe("browser evidence aggregate input discovery", () => {
  it("parses aggregate authority and walks only regular files", () => {
    expect(
      parseAggregateArgs([
        "--input-dir",
        "build/producers",
        "--head-sha",
        HEAD_SHA,
        "--run-id",
        "123",
        "--run-attempt",
        "2",
        "--repository",
        REPOSITORY,
        "--ref",
        "refs/pull/123/merge",
        "--workflow-ref",
        WORKFLOW_REF,
        "--workflow-sha",
        WORKFLOW_SHA,
        "--output",
        "build/aggregate.json",
      ]),
    ).toEqual({
      "input-dir": "build/producers",
      "head-sha": HEAD_SHA,
      "run-id": "123",
      "run-attempt": "2",
      repository: REPOSITORY,
      ref: "refs/pull/123/merge",
      "workflow-ref": WORKFLOW_REF,
      "workflow-sha": WORKFLOW_SHA,
      output: "build/aggregate.json",
    });
    const root = temporaryRoot();
    fs.mkdirSync(path.join(root, "linux"));
    fs.writeFileSync(path.join(root, "linux", "fragment.json"), "{}\n");
    fs.mkdirSync(path.join(root, "empty"));
    expect(regularFiles(root)).toEqual([
      path.join(root, "linux", "fragment.json"),
    ]);
  });
});
