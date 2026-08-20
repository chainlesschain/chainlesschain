"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const { verifyCell } = require("./host-recovery-matrix/verify.cjs");

const ROOT = path.resolve(__dirname, "../../..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

test("host recovery workflow uses genuine WSL, devcontainer, and strict-SSH producers", () => {
  const workflow = read(".github/workflows/ide-roadmap-host-recovery.yml");
  const wsl = read(".github/scripts/run-ide-roadmap-wsl.ps1");
  const config = JSON.parse(
    read(".devcontainer/ide-roadmap/devcontainer.json"),
  );

  assert.match(
    workflow,
    /IDE_HOST_RECOVERY_COMMIT: \$\{\{ inputs\.commit_sha \|\| github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u,
  );
  assert.match(workflow, /runs-on: windows-2025/u);
  assert.match(wsl, /--import[\s\S]*?--version", "1"/u);
  assert.match(wsl, /wsl\/releases\/noble\/20240423/u);
  assert.match(
    wsl,
    /2a790896740b14d637dbdc583cce1ba081ac53b9e9cdb46dc09a2f73abbd9934/u,
  );
  assert.match(
    wsl,
    /e05a4d65232ae2b27b3d77da2e368522fb46b923335b8e0d5f77624c32484044/u,
  );
  assert.match(wsl, /GITHUB_WORKFLOW_SHA='\$env:GITHUB_WORKFLOW_SHA'/u);
  assert.match(wsl, /--environment-check wsl/u);
  assert.equal(
    config.image,
    "ubuntu@sha256:019e8eb29a85e74d64925745884f2ec79aa27e3feab36353d24656f4d6b89467",
  );
  assert.equal(config.containerEnv.CC_IDE_ROADMAP_TRANSPORT, "devcontainer");
  assert.match(workflow, /@devcontainers\/cli@0\.80\.3/u);
  assert.match(workflow, /devcontainer up/u);
  assert.match(workflow, /devcontainer exec/u);
  assert.match(workflow, /Normalize devcontainer artifact ownership/u);
  assert.match(workflow, /sudo chown -R "\$\(id -u\):\$\(id -g\)"/u);
  assert.match(workflow, /--environment-check devcontainer/u);
  assert.match(workflow, /ssh-host-recovery:/u);
  assert.match(workflow, /openssh-server/u);
  assert.match(workflow, /StrictHostKeyChecking=yes/u);
  assert.match(workflow, /UserKnownHostsFile=/u);
  assert.match(workflow, /CC_IDE_ROADMAP_TRANSPORT=ssh/u);
  assert.match(workflow, /--environment-check ssh/u);
  assert.doesNotMatch(workflow, /StrictHostKeyChecking=no/u);
});

test("aggregate fails closed unless all exact-head producers succeed", () => {
  const workflow = read(".github/workflows/ide-roadmap-host-recovery.yml");
  assert.match(
    workflow,
    /needs: \[wsl-host-recovery, devcontainer-host-recovery, ssh-host-recovery\]/u,
  );
  assert.match(workflow, /needs\.wsl-host-recovery\.result == 'success'/u);
  assert.match(
    workflow,
    /needs\.devcontainer-host-recovery\.result == 'success'/u,
  );
  assert.match(workflow, /needs\.ssh-host-recovery\.result == 'success'/u);
  assert.match(
    workflow,
    /Upload WSL diagnostics and evidence\n\s+if: always\(\)/u,
  );
  assert.match(
    workflow,
    /Upload devcontainer diagnostics and evidence\n\s+if: always\(\)/u,
  );
  assert.match(
    workflow,
    /Upload SSH diagnostics and evidence\n\s+if: always\(\)/u,
  );
  assert.match(workflow, /--workflow-sha "\$GITHUB_WORKFLOW_SHA"/u);
  assert.doesNotMatch(workflow, /continue-on-error/u);
});

test(
  "production bridge survives a dropped client and recovers durable state after kill",
  { timeout: 30000 },
  () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-host-recovery-test-"),
    );
    try {
      const commit = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: ROOT,
        encoding: "utf8",
      }).trim();
      execFileSync(
        process.execPath,
        [
          path.join(
            ROOT,
            "packages/vscode-extension/test/host-recovery-matrix/run.cjs",
          ),
          "--release-commit",
          commit,
          "--transport",
          "local",
          "--environment-check",
          "local",
          "--artifact-dir",
          root,
          "--artifact-name",
          "local-host-recovery",
        ],
        { cwd: ROOT, stdio: "inherit" },
      );
      const outcome = JSON.parse(
        fs.readFileSync(path.join(root, "outcome-observations.json"), "utf8"),
      );
      assert.equal(outcome.success, true);
      assert.equal(outcome.lostCheckpointCount, 0);
      assert.equal(fs.existsSync(path.join(root, "failure.json")), false);

      const hostPath = path.join(root, "host-environment.json");
      const outcomePath = path.join(root, "outcome-observations.json");
      const manifestPath = path.join(root, "manifest.json");
      const host = JSON.parse(fs.readFileSync(hostPath, "utf8"));
      host.transport = "wsl";
      host.platform = "linux";
      host.isWsl = true;
      outcome.transport = "wsl";
      fs.writeFileSync(hostPath, `${JSON.stringify(host)}\n`, "utf8");
      fs.writeFileSync(outcomePath, `${JSON.stringify(outcome)}\n`, "utf8");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      for (const [name, filePath] of [
        ["host-environment.json", hostPath],
        ["outcome-observations.json", outcomePath],
      ]) {
        const bytes = fs.readFileSync(filePath);
        manifest.files[name] = {
          sha256: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
          bytes: bytes.length,
        };
      }
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
      assert.doesNotThrow(() =>
        verifyCell(root, {
          transport: "wsl",
          releaseCommit: commit,
          provenance: outcome.provenance,
        }),
      );
      fs.appendFileSync(outcomePath, " ", "utf8");
      assert.throws(
        () =>
          verifyCell(root, {
            transport: "wsl",
            releaseCommit: commit,
            provenance: outcome.provenance,
          }),
        /digest drift/u,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
