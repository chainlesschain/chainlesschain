"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const repositoryRoot = path.resolve(__dirname, "../../..");
const runner = require("./remote-ssh-container/run.cjs");

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

test("Remote-SSH supply-chain identity pins both transport and install bytes", () => {
  assert.deepEqual(runner.PINNED_REMOTE_SSH, {
    id: "ms-vscode-remote.remote-ssh",
    version: "0.120.0",
    source:
      "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/ms-vscode-remote/vsextensions/remote-ssh/0.120.0/vspackage",
    transportSha256:
      "sha256:4caa944dc6c81c8e1a345f3aefed2c0b8efacfe91ba46dff04cb6da2238b949e",
    sha256:
      "sha256:0fd6262ca183b486f6c067cb3516dccea2f87f32c049b642ff9eb77b0cea195d",
  });
  assert.equal(runner.PINNED_VSCODE_VERSION, "1.96.4");
  assert.equal(
    runner.PINNED_CONTAINER_IMAGE,
    "ubuntu@sha256:019e8eb29a85e74d64925745884f2ec79aa27e3feab36353d24656f4d6b89467",
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-remote-pin-"));
  try {
    const wrong = path.join(root, "wrong.vsix");
    fs.writeFileSync(wrong, "not the official extension", "utf8");
    assert.throws(
      () => runner.assertPinnedRemoteSshVsix(wrong),
      /VSIX digest mismatch/u,
    );
    assert.throws(
      () => runner.assertPinnedRemoteSshPayload(wrong),
      /transport payload digest mismatch/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("remote driver calls the existing real host journey after proving remote identity", () => {
  const remoteRunner = read(
    "packages/vscode-extension/test/remote-ssh-container/remote-runner.cjs",
  );
  const orchestrator = read(
    "packages/vscode-extension/test/remote-ssh-container/run.cjs",
  );
  const driverManifest = JSON.parse(
    read(
      "packages/vscode-extension/test/remote-ssh-container/remote-driver-package.json",
    ),
  );

  assert.deepEqual(driverManifest.extensionKind, ["workspace"]);
  assert.match(remoteRunner, /vscode\.env\.remoteName[\s\S]*?"ssh-remote"/u);
  assert.match(remoteRunner, /\["vscode-remote", "vscode-remote"\]/u);
  assert.match(remoteRunner, /config\.containerMarkerPath/u);
  assert.match(remoteRunner, /config\.candidateVsixSha256/u);
  assert.match(remoteRunner, /config\.candidateVsixBytes/u);
  assert.match(remoteRunner, /require\("\.\/smoke\.cjs"\)/u);
  assert.match(remoteRunner, /"bridge-verified"/u);
  assert.match(orchestrator, /--file-uri=vscode-remote:\/\//u);
  assert.match(orchestrator, /extensionDevelopmentPath: REMOTE_DRIVER/u);
  assert.match(orchestrator, /docker[\s\S]*?openssh-server/u);
  assert.match(orchestrator, /\/etc\/chainlesschain-remote-id/u);
  assert.match(orchestrator, /ssh_host_ed25519_key\.pub/u);
  assert.match(orchestrator, /waitForSshReady/u);
  assert.match(orchestrator, /ConnectTimeout 1/u);
  assert.match(orchestrator, /preCopyBinding/u);
  assert.match(orchestrator, /candidateBinding[\s\S]*?finalBinding/u);
  assert.match(orchestrator, /sha256sum \/tmp\/chainlesschain-ide\.vsix/u);
  assert.doesNotMatch(orchestrator, /ssh-keyscan/u);
  assert.match(
    orchestrator,
    /ubuntu@sha256:019e8eb29a85e74d64925745884f2ec79aa27e3feab36353d24656f4d6b89467/u,
  );
  assert.doesNotMatch(orchestrator, /transport:\s*"remote"/u);
});

test("workflow preserves diagnostics and aggregates one exact producer provenance", () => {
  const workflow = read(".github/workflows/ide-extensions.yml");
  const remoteJob = workflow.slice(
    workflow.indexOf("  vscode-remote-ssh-container:"),
    workflow.indexOf("  ide-roadmap-evidence-aggregate:"),
  );
  const advisoryStep = workflow.slice(
    workflow.indexOf(
      "      - name: Rehash artifact bytes as advisory evidence",
    ),
    workflow.indexOf("      - name: Upload trusted scoped aggregate"),
  );
  assert.match(workflow, /vscode-remote-ssh-container:/u);
  assert.match(
    workflow,
    /4caa944dc6c81c8e1a345f3aefed2c0b8efacfe91ba46dff04cb6da2238b949e[\s\S]*?gzip -dc[\s\S]*?0fd6262ca183b486f6c067cb3516dccea2f87f32c049b642ff9eb77b0cea195d/u,
  );
  assert.match(
    workflow,
    /Upload Remote-SSH diagnostics and trusted evidence\n\s+if: always\(\)/u,
  );
  assert.match(
    workflow,
    /ide-roadmap-evidence-aggregate:[\s\S]*?needs: vscode-remote-ssh-container[\s\S]*?always\(\)[\s\S]*?needs\.vscode-remote-ssh-container\.result == 'success'/u,
  );
  assert.match(workflow, /--case q4a-vscode-remote-ssh-container/u);
  assert.match(workflow, /--require-release-ready/u);
  assert.match(workflow, /--trusted-job vscode-remote-ssh-container/u);
  assert.match(workflow, /--trusted-artifact-name/u);
  assert.match(workflow, /--candidate-manifest "\$RUNNER_TEMP\//u);
  assert.match(workflow, /--server-url "\$GITHUB_SERVER_URL"/u);
  assert.match(advisoryStep, /github\.event_name == 'pull_request'/u);
  assert.doesNotMatch(advisoryStep, /--require-release-ready/u);
  assert.match(
    workflow,
    /vscode-remote-ssh-container,[\s\S]*?ide-roadmap-evidence-aggregate,[\s\S]*?needs\.vscode-remote-ssh-container\.result == 'success'[\s\S]*?needs\.ide-roadmap-evidence-aggregate\.result == 'success'/u,
  );
  assert.match(
    remoteJob,
    /actions\/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09/u,
  );
  assert.match(
    remoteJob,
    /path: \$\{\{ runner\.temp \}\}\/cc-vscode-candidate/u,
  );
  assert.match(
    remoteJob,
    /--vsix "\$RUNNER_TEMP\/cc-vscode-candidate\/chainlesschain-ide\.vsix"/u,
  );
  assert.doesNotMatch(
    remoteJob,
    /path: packages\/vscode-extension\s*(?:\r?\n|$)/u,
  );
  assert.doesNotMatch(workflow, /continue-on-error/u);
});

test("known_hosts is derived from the container host key without TOFU", () => {
  assert.equal(
    runner.createKnownHostsEntry(
      "127.0.0.1",
      22022,
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey container-comment",
    ),
    "[127.0.0.1]:22022 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey\n",
  );
  assert.throws(
    () =>
      runner.createKnownHostsEntry("127.0.0.1", 22022, "ssh-rsa AAAABadKey"),
    /host key algorithm/u,
  );
});

test("candidate replacement after initial verification fails closed", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-candidate-swap-"));
  try {
    const vsix = path.join(root, "chainlesschain-ide.vsix");
    const manifestPath = path.join(root, "manifest.json");
    const releaseCommit = "a".repeat(40);
    const workflowRun =
      "https://github.com/chainlesschain/chainlesschain/actions/runs/123";
    const writeCandidate = (suffix) => {
      fs.writeFileSync(vsix, `candidate-${suffix}`, "utf8");
      fs.writeFileSync(
        manifestPath,
        `${JSON.stringify({
          package: "chainlesschain-ide",
          publisher: "chainlesschain",
          version: "0.37.53",
          commit: releaseCommit,
          workflowRun,
          suffix,
        })}\n`,
        "utf8",
      );
    };
    const verifyReleaseArtifact = (_vsix, manifest, expected) => {
      assert.equal(manifest.package, expected.packageName);
      assert.equal(manifest.publisher, expected.publisher);
      assert.equal(manifest.version, expected.version);
      assert.equal(manifest.commit, expected.commit);
      assert.equal(manifest.workflowRun, expected.workflowRun);
    };
    const verify = () =>
      runner.verifyCandidateReleaseBinding({
        vsixPath: vsix,
        manifestPath,
        releaseCommit,
        repository: "chainlesschain/chainlesschain",
        runId: "123",
        serverUrl: "https://github.com",
        packageName: "chainlesschain-ide",
        publisher: "chainlesschain",
        version: "0.37.53",
        verifyReleaseArtifact,
      });
    writeCandidate("initial");
    const initial = await verify();
    writeCandidate("replacement");
    const replacement = await verify();
    assert.throws(
      () => runner.assertCandidateReleaseBindingUnchanged(initial, replacement),
      /changed during the remote journey/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("missing semantic artifacts fail the scoped negative control", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-remote-artifacts-"));
  try {
    const paths = Object.fromEntries(
      [
        "exact-commit",
        "host-environment",
        "remote-environment",
        "outcome-observations",
        "redacted-diagnostics",
        "artifact-digests",
        "candidate-vsix",
        "candidate-manifest",
      ].map((name) => {
        const filePath = path.join(root, `${name}.json`);
        fs.writeFileSync(filePath, "{}\n", "utf8");
        return [name, filePath];
      }),
    );
    assert.equal(runner.requiredArtifactNegativeControl(paths), true);
    fs.unlinkSync(paths["remote-environment"]);
    assert.throws(
      () => runner.requiredArtifactNegativeControl(paths),
      /missing required artifact/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
