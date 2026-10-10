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

const quotaMessage =
  "Error response from daemon: toomanyrequests: You have reached your unauthenticated pull rate limit. https://www.docker.com/increase-rate-limit\n";

function imageCommand(pulls, { repoDigests } = {}) {
  const calls = [];
  const command = (binary, args, options = {}) => {
    assert.equal(binary, "docker");
    calls.push(args);
    if (args[0] === "pull") {
      assert.ok(pulls.length, "unexpected extra pull");
      const result = { signal: null, stdout: "", stderr: "", ...pulls.shift() };
      options.onResult?.(result);
      if (result.error) throw result.error;
      return result;
    }
    if (args[0] === "image") {
      return {
        status: 0,
        stdout: JSON.stringify({
          Id: `sha256:${"a".repeat(64)}`,
          RepoDigests: repoDigests || [args.at(-1)],
        }),
      };
    }
    assert.equal(args[0], "run");
    return { status: 0, stdout: "container-id\n" };
  };
  return { calls, command };
}

test("successful canonical pull binds inspect, container execution and source evidence", () => {
  const fake = imageCommand([{ status: 0, stdout: "original pull\n" }]);
  const observation = {};
  const imageId = runner.startPinnedContainer(runner.PINNED_CONTAINER_IMAGE, {
    container: "test-container",
    containerHostname: "test-host",
    observation,
    command: fake.command,
  });
  assert.deepEqual(fake.calls[0], ["pull", runner.PINNED_CONTAINER_IMAGE]);
  assert.equal(fake.calls[1].at(-1), runner.PINNED_CONTAINER_IMAGE);
  assert.equal(fake.calls[2].at(-3), runner.PINNED_CONTAINER_IMAGE);
  assert.deepEqual(runner.containerImageSource(observation), {
    canonicalRef: runner.PINNED_CONTAINER_IMAGE,
    usedRef: runner.PINNED_CONTAINER_IMAGE,
    fallbackReason: null,
    imageId,
    repoDigests: [runner.PINNED_CONTAINER_IMAGE],
  });
  assert.equal(observation.attempts.length, 1);
});

test("only anonymous Hub quota uses the fixed same-digest mirror and preserves full pull output", () => {
  const originalOutput = "before quota\n".repeat(3000);
  const mirrorOutput = "mirror downloaded\n".repeat(3000);
  const fake = imageCommand([
    { status: 1, stdout: originalOutput, stderr: quotaMessage },
    { status: 0, stdout: mirrorOutput },
  ]);
  const observation = {};
  runner.startPinnedContainer(runner.PINNED_CONTAINER_IMAGE, {
    container: "test-container",
    containerHostname: "test-host",
    observation,
    command: fake.command,
  });
  assert.equal(
    runner.PINNED_CONTAINER_MIRROR,
    `mirror.gcr.io/library/${runner.PINNED_CONTAINER_IMAGE}`,
  );
  assert.deepEqual(fake.calls.slice(0, 2), [
    ["pull", runner.PINNED_CONTAINER_IMAGE],
    ["pull", runner.PINNED_CONTAINER_MIRROR],
  ]);
  assert.equal(fake.calls[2].at(-1), runner.PINNED_CONTAINER_MIRROR);
  assert.equal(fake.calls[3].at(-3), runner.PINNED_CONTAINER_MIRROR);
  assert.equal(observation.attempts[0].stdout, originalOutput);
  assert.equal(observation.attempts[0].stderr, quotaMessage);
  assert.equal(observation.attempts[1].stdout, mirrorOutput);
  assert.equal(observation.fallbackCause.attempt, 0);
  const source = runner.containerImageSource(observation);
  assert.equal(source.canonicalRef, runner.PINNED_CONTAINER_IMAGE);
  assert.equal(source.usedRef, runner.PINNED_CONTAINER_MIRROR);
  assert.equal(
    source.fallbackReason,
    "docker-hub-unauthenticated-pull-rate-limit",
  );
  assert.deepEqual(source.repoDigests, [runner.PINNED_CONTAINER_MIRROR]);
});

test("network, auth, generic rate limits and interrupted pulls do not select a mirror", () => {
  for (const result of [
    { status: 1, stderr: "TLS handshake timeout" },
    { status: 1, stderr: "unauthorized: authentication required" },
    { status: 1, stderr: "toomanyrequests: authenticated pull limit" },
    { status: 1, stdout: quotaMessage, stderr: "other failure" },
    { status: null, signal: "SIGTERM", stderr: quotaMessage },
  ]) {
    const fake = imageCommand([result]);
    const observation = {};
    assert.throws(
      () =>
        runner.startPinnedContainer(runner.PINNED_CONTAINER_IMAGE, {
          observation,
          command: fake.command,
        }),
      /docker pull .* failed/u,
    );
    assert.equal(fake.calls.length, 1);
    assert.equal(observation.fallbackReason, null);
    assert.equal(observation.usedRef, null);
  }
  const actual = new Error("spawn docker ENOENT");
  const fake = imageCommand([
    { status: null, error: actual, stderr: quotaMessage },
  ]);
  assert.throws(
    () =>
      runner.pullPinnedContainerImage(runner.PINNED_CONTAINER_IMAGE, {
        observation: {},
        command: fake.command,
      }),
    (error) => error === actual,
  );
  assert.equal(fake.calls.length, 1);
});

test("mirror failure retains both causes and cannot proceed to inspect or run", () => {
  for (const mirrorResult of [
    { status: 1, stderr: "mirror unavailable\n", stdout: "mirror started\n" },
    { status: null, error: new Error("mirror process failed") },
  ]) {
    const fake = imageCommand([
      { status: 1, stderr: quotaMessage },
      mirrorResult,
    ]);
    const observation = {};
    assert.throws(
      () =>
        runner.startPinnedContainer(runner.PINNED_CONTAINER_IMAGE, {
          observation,
          command: fake.command,
        }),
      (error) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors.length, 2);
        assert.equal(error.cause, error.errors[0]);
        assert.equal(error.errors[0].pull.stderr, quotaMessage);
        if (mirrorResult.error)
          assert.equal(error.errors[1], mirrorResult.error);
        else assert.equal(error.errors[1].pull.stderr, mirrorResult.stderr);
        return true;
      },
    );
    assert.equal(fake.calls.length, 2);
    assert.equal(observation.attempts.length, 2);
    assert.equal(observation.usedRef, null);
  }
});

test("other images, digests and transport references cannot use the mirror policy", () => {
  for (const reference of [
    "ubuntu:latest",
    `alpine@${runner.PINNED_CONTAINER_IMAGE.split("@")[1]}`,
    `ubuntu@sha256:${"b".repeat(64)}`,
    runner.PINNED_CONTAINER_MIRROR,
  ]) {
    const fake = imageCommand([{ status: 1, stderr: quotaMessage }]);
    assert.throws(
      () =>
        runner.pullPinnedContainerImage(reference, {
          observation: {},
          command: fake.command,
        }),
      /unexpected container image pin/u,
    );
    assert.equal(fake.calls.length, 0);
  }
  assert.throws(
    () =>
      runner.inspectPinnedContainerImage("other-registry/ubuntu:latest", {
        command: () => assert.fail("must reject before invoking Docker"),
      }),
    /unexpected used container image reference/u,
  );
});

test("inspection must bind the selected registry and exact digest before container creation", () => {
  for (const repoDigests of [
    [],
    [`mirror.gcr.io/library/ubuntu@sha256:${"b".repeat(64)}`],
    [runner.PINNED_CONTAINER_IMAGE],
  ]) {
    const fake = imageCommand(
      [{ status: 1, stderr: quotaMessage }, { status: 0 }],
      { repoDigests },
    );
    assert.throws(
      () =>
        runner.startPinnedContainer(runner.PINNED_CONTAINER_IMAGE, {
          observation: {},
          command: fake.command,
        }),
      /does not bind the used registry reference and pinned digest/u,
    );
    assert.equal(fake.calls.length, 3);
    assert.ok(fake.calls.every((args) => args[0] !== "run"));
  }
});

test("container startup failure remains the original failure without another pull", () => {
  const fake = imageCommand([{ status: 0 }]);
  const actual = new Error("docker run failed");
  const observation = {};
  let starts = 0;
  assert.throws(
    () =>
      runner.startPinnedContainer(runner.PINNED_CONTAINER_IMAGE, {
        container: "test-container",
        containerHostname: "test-host",
        observation,
        command: (binary, args, options) => {
          if (args[0] === "run") {
            starts++;
            throw actual;
          }
          return fake.command(binary, args, options);
        },
      }),
    (error) => error === actual,
  );
  assert.equal(starts, 1);
  assert.equal(fake.calls.filter((args) => args[0] === "pull").length, 1);
  assert.equal(observation.fallbackReason, null);
});

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
  assert.match(remoteRunner, /\["file", "file"\]/u);
  assert.match(
    remoteRunner,
    /workspaceUriPresentation: "remote-extension-host-native-file"/u,
  );
  assert.match(remoteRunner, /config\.containerMarkerPath/u);
  assert.match(remoteRunner, /config\.candidateVsixSha256/u);
  assert.match(remoteRunner, /config\.candidateVsixBytes/u);
  assert.match(
    remoteRunner,
    /path\.relative\(remoteHome, extensionHostCwd\)[\s\S]*?cwdRelativeToRemoteHome === ""/u,
  );
  assert.doesNotMatch(
    remoteRunner,
    /process\.cwd\(\)\.startsWith\("\/home\/cc-roadmap\/"\)/u,
  );
  assert.match(remoteRunner, /require\("\.\/smoke\.cjs"\)/u);
  assert.match(remoteRunner, /"bridge-verified"/u);
  assert.match(orchestrator, /--file-uri=vscode-remote:\/\//u);
  assert.match(
    orchestrator,
    /remoteDriverUri = `vscode-remote:\/\/\$\{remoteAuthority\}\$\{REMOTE_DRIVER\}`/u,
  );
  assert.match(orchestrator, /extensionDevelopmentPath: remoteDriverUri/u);
  assert.match(
    orchestrator,
    /extensionTestsPath: `\$\{remoteDriverUri\}\/remote-runner\.cjs`/u,
  );
  assert.doesNotMatch(
    orchestrator,
    /extension(?:Development|Tests)Path:\s*(?:REMOTE_DRIVER|`\$\{REMOTE_DRIVER\})/u,
  );
  assert.match(orchestrator, /docker[\s\S]*?openssh-server/u);
  assert.match(orchestrator, /\/etc\/chainlesschain-remote-id/u);
  assert.match(orchestrator, /ssh_host_ed25519_key\.pub/u);
  assert.match(orchestrator, /waitForSshReady/u);
  assert.match(orchestrator, /ConnectTimeout 1/u);
  assert.match(
    orchestrator,
    /retryTransientNetworkOperation\(\s*\(\) => downloadAndUnzipVSCode\(vscodeOptions\)/u,
  );
  assert.doesNotMatch(
    orchestrator,
    /const vscodeExecutablePath = await downloadAndUnzipVSCode\(vscodeOptions\)/u,
  );
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

test("remote workspace binds every root to the selected SSH authority", () => {
  const workspace = runner.createRemoteWorkspaceDefinition(
    "ssh-remote+cc-roadmap-test",
  );

  assert.equal(workspace.remoteAuthority, "ssh-remote+cc-roadmap-test");
  assert.deepEqual(workspace.folders, [
    {
      name: "primary",
      uri: "vscode-remote://ssh-remote+cc-roadmap-test/home/cc-roadmap/workspace-primary",
    },
    {
      name: "secondary",
      uri: "vscode-remote://ssh-remote+cc-roadmap-test/home/cc-roadmap/workspace-secondary",
    },
  ]);
  assert.ok(workspace.folders.every((folder) => !("path" in folder)));
  assert.throws(
    () => runner.createRemoteWorkspaceDefinition("file"),
    /workspace authority/u,
  );
});

test("container marker digest binds the exact bytes written remotely", () => {
  const marker = runner.createContainerMarker("a".repeat(24));

  assert.equal(
    marker,
    "chainlesschain-remote-ssh-container:aaaaaaaaaaaaaaaaaaaaaaaa",
  );
  assert.doesNotMatch(marker, /\r|\n/u);

  const orchestrator = read(
    "packages/vscode-extension/test/remote-ssh-container/run.cjs",
  );
  assert.match(orchestrator, /const markerDigest = sha256Buffer\(marker\)/u);
  assert.match(orchestrator, /printf '%s' '\$\{marker\}'/u);
  assert.doesNotMatch(orchestrator, /marker\.trim\(\)/u);
});

test("failed Remote-SSH host runs retain local and container diagnostics", () => {
  const orchestrator = read(
    "packages/vscode-extension/test/remote-ssh-container/run.cjs",
  );

  assert.match(
    orchestrator,
    /sourceRoots:[\s\S]*?remote-runtime[\s\S]*?vscode-remote-ssh\.log[\s\S]*?user-data[\s\S]*?remote-vscode-logs[\s\S]*?diagnosticsPath[\s\S]*?fs\.existsSync/u,
  );
  assert.match(
    orchestrator,
    /catch \(error\) \{\s+vscodeRunError = error;[\s\S]*?"cp"[\s\S]*?allowFailure: true/u,
  );
  assert.match(
    orchestrator,
    /new AggregateError\(\s*\[vscodeRunError, remoteCaptureError\]/u,
  );
  assert.match(orchestrator, /"remote\.SSH\.loglevel": "trace"/u);
  assert.match(
    orchestrator,
    /\.vscode-server\/data\/logs[\s\S]*?allowFailure: true/u,
  );
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
    remoteJob,
    /curl[\s\S]*?--retry 5 --retry-all-errors --retry-delay 2 --retry-max-time 120[\s\S]*?remote-ssh-0\.120\.0\.vsix\.gz/u,
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

test("outcome evidence closes its self-reference before trusted evidence is emitted", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-remote-outcome-"));
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
      ].map((name) => [name, path.join(root, `${name}.json`)]),
    );
    for (const [name, filePath] of Object.entries(paths)) {
      if (name !== "outcome-observations") {
        fs.writeFileSync(filePath, "{}\n", "utf8");
      }
    }

    assert.throws(
      () => runner.requiredArtifactNegativeControl(paths),
      /missing required artifact: outcome-observations/u,
    );
    runner.writeOutcomeObservations(paths, {
      credentialLeakCount: 0,
      remoteTransportExercised: true,
    });
    assert.deepEqual(
      JSON.parse(fs.readFileSync(paths["outcome-observations"], "utf8")),
      {
        schema: "chainlesschain.ide-roadmap-outcome-observations.v1",
        credentialLeakCount: 0,
        remoteTransportExercised: true,
        missingRequiredArtifactsFail: true,
      },
    );
    assert.doesNotThrow(() => runner.assertRequiredArtifacts(paths));

    fs.unlinkSync(paths["remote-environment"]);
    assert.throws(
      () =>
        runner.requiredArtifactNegativeControl(paths, {
          outcomePending: true,
        }),
      /missing required artifact: remote-environment/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
