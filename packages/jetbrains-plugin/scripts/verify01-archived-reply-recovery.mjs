#!/usr/bin/env node
/** Manual Linux 2025.2 check of public .167 using one immutable archived reply. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import {
  loadVerify33Reply,
  validatePublicPlugin,
  assertRecoveryEvidence,
  digest,
  repository,
} from "./archived-reply-evidence.mjs";
import {
  launchLogged,
  requireSuccess,
  stopOwned,
  preserveFailureDuringCleanup,
} from "../../../scripts/lib/verify01-diagnostic-process.mjs";
import {
  assertPortFree,
  waitForPortFree,
} from "../../../scripts/lib/verify01-diagnostic-port.mjs";

const pkg = path.join(repository, "packages/jetbrains-plugin");
const peer = path.join(
  repository,
  "tests/fixtures/ide-roadmap/archived-reply-peer.mjs",
);
const shellQuote = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`;
const save = (root, name, value) =>
  fs.writeFileSync(
    path.join(root, name),
    JSON.stringify(value, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );

export function replyEnvironment(
  root,
  output,
  fixtureDigest,
  base = process.env,
) {
  // Deliberate allowlist: provider credentials and inherited Node preload flags
  // never reach the IDE, fixture, history command, or Gradle child.
  const env = {};
  for (const key of [
    "PATH",
    "JAVA_HOME",
    "GRADLE_USER_HOME",
    "DISPLAY",
    "XAUTHORITY",
    "LANG",
    "LC_ALL",
  ])
    if (base[key]) env[key] = base[key];
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  for (const name of ["cc", "chainlesschain", "clc", "clchain"])
    fs.writeFileSync(
      path.join(bin, name),
      `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(peer)} "$@"\n`,
      { flag: "wx", mode: 0o700 },
    );
  return {
    ...env,
    PATH: bin + path.delimiter + (env.PATH || ""),
    HOME: root,
    CHAINLESSCHAIN_HOME: path.join(root, "home"),
    CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: path.join(root, "security"),
    TEMP: root,
    TMP: root,
    TMPDIR: root,
    CC_UI_CANONICAL_ROOT: root,
    CC_UPDATE_NOTICE: "0",
    CI: "true",
    NO_COLOR: "1",
    CC_FORMAL_QUALITY_EVAL_HERMETIC: "1",
    CC_ARCHIVED_REPLY_MANIFEST: path.join(output, "fixture.json"),
    CC_ARCHIVED_REPLY_MANIFEST_DIGEST: fixtureDigest,
    CC_ARCHIVED_REPLY_TRACE: path.join(output, "peer.jsonl"),
    CC_IDE_REQUIRED_HOST_VERSION: "2025.2",
  };
}

export function verifyArchivedReplyOutput(output) {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(output, "fixture.json")),
  );
  assert.deepEqual(
    fixture,
    loadVerify33Reply(),
    "original candidate, receipt or reply evidence changed",
  );
  const binding = JSON.parse(
    fs.readFileSync(path.join(output, "binding.json")),
  );
  const plugin = validatePublicPlugin(
    binding.versionsFile,
    path.join(output, "public-plugin.zip"),
  );
  assert.deepEqual(plugin, binding.plugin);
  for (const source of binding.sources) {
    assert.ok(
      !/[\\:]/u.test(source.path) &&
        source.path
          .split("/")
          .every((part) => part && part !== "." && part !== ".."),
    );
    assert.equal(
      digest(fs.readFileSync(path.join(repository, source.path))),
      source.digest,
      "replay implementation changed since execution",
    );
  }
  const initial = JSON.parse(
    fs.readFileSync(path.join(output, "recovery-initial.json")),
  );
  assert.deepEqual(
    initial.liveSnapshot,
    JSON.parse(
      fs.readFileSync(path.join(output, "recovery-live-initial.json")),
    ),
  );
  const restart = JSON.parse(
    fs.readFileSync(path.join(output, "recovery-restart.json")),
  );
  const records = fs
    .readFileSync(path.join(output, "peer.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
  const result = assertRecoveryEvidence({
    fixture,
    initial,
    restart,
    records,
    plugin,
  });
  result.originalEvidence = {
    baselineEvidence: fixture.baselineEvidence,
    originalState: fixture.originalState,
    originalSummary: fixture.originalSummary,
    originalAcceptance: fixture.originalAcceptance,
    reusedCandidates: fixture.reusedCandidates,
  };
  result.sources = binding.sources;
  result.evidence = [
    "fixture.json",
    "binding.json",
    "recovery-live-initial.json",
    "recovery-initial.json",
    "recovery-restart.json",
    "peer.jsonl",
  ].map((name) => ({
    path: name,
    digest: digest(fs.readFileSync(path.join(output, name))),
  }));
  return result;
}

export async function runArchivedReplyRecovery({
  versionsFile,
  pluginArchive,
  output,
  prepareOnly = false,
}) {
  assert.ok(
    prepareOnly || process.platform === "linux",
    "real replay is restricted to Linux, matching verify-33",
  );
  assert.ok(path.isAbsolute(output) && path.isAbsolute(pluginArchive));
  assert.equal(
    fs.realpathSync(path.dirname(output)),
    path.dirname(output),
    "output parent must not redirect",
  );
  const fixture = loadVerify33Reply();
  const plugin = validatePublicPlugin(versionsFile, pluginArchive);
  fs.mkdirSync(output); // exclusive fresh evidence; cannot overwrite an earlier run
  fs.copyFileSync(
    pluginArchive,
    path.join(output, "public-plugin.zip"),
    fs.constants.COPYFILE_EXCL,
  );
  save(output, "fixture.json", fixture);
  const sources = [
    "tests/fixtures/ide-roadmap/archived-reply-peer.mjs",
    "tests/fixtures/ide-roadmap/canonical-transcript-peer.mjs",
    "packages/jetbrains-plugin/scripts/archived-reply-evidence.mjs",
    "packages/jetbrains-plugin/scripts/verify01-archived-reply-recovery.mjs",
    "packages/jetbrains-plugin/src/uiTest/java/com/chainlesschain/ide/uitest/ArchivedReplyRecoveryJourney.java",
    "packages/jetbrains-plugin/src/uiTest/java/com/chainlesschain/ide/uitest/ConversationRecoveryJourney.java",
    "packages/jetbrains-plugin/src/uiTest/resources/transcript-row-body.js",
    "packages/jetbrains-plugin/src/uiTest/java/com/chainlesschain/ide/uitest/IdeUiSmokeTest.java",
    "packages/jetbrains-plugin/build.gradle.kts",
  ].map((name) => ({
    path: name,
    digest: digest(fs.readFileSync(path.join(repository, name))),
  }));
  save(output, "binding.json", {
    versionsFile,
    pluginArchive: "public-plugin.zip",
    executionSourceCommit: process.env.GITHUB_SHA || null,
    plugin,
    sources,
    scope: fixture.scope,
  });
  if (prepareOnly)
    return {
      status: "PREPARED_NOT_EXECUTED",
      output,
      plugin,
      scope: fixture.scope,
    };
  const isolation = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-archived-reply-"),
  );
  fs.mkdirSync(path.join(isolation, "home"));
  const env = replyEnvironment(
    isolation,
    output,
    digest(fs.readFileSync(path.join(output, "fixture.json"))),
  );
  const journey = `archived-verify-33-${Date.now()}`;
  const base = [
    "--no-daemon",
    "--no-configuration-cache",
    "--console=plain",
    `-PuiJourneyRunId=${journey}`,
    `-PhostIdeVersion=${plugin.ideVersion}`,
    `-PpublicUiPluginArchive=${pluginArchive}`,
    `-PpublicUiPluginDigest=${plugin.digest}`,
  ];
  const params = [
    `-Dui.archivedReply.root=${output}`,
    `-Dui.plugin.archive=${pluginArchive}`,
  ];
  const deadline = Date.now() + 25 * 60 * 1000;
  const launch = (args, label) =>
    launchLogged(path.join(pkg, "gradlew"), args, {
      cwd: pkg,
      env,
      logFile: path.join(output, `${label}.log`),
    });
  try {
    await assertPortFree({ port: 8082 });
    await requireSuccess(
      launch(["compileUiTestJava", ...base], "prepare"),
      deadline,
      "archived reply UI test preparation",
    );
    for (const phase of ["initial", "restart"]) {
      const active = launch(
        ["runIdeForUiTests", ...base, ...params],
        `ide-${phase}`,
      );
      await preserveFailureDuringCleanup(
        async () => {
          const startup = Math.min(deadline, Date.now() + 8 * 60 * 1000);
          while (true) {
            assert.ok(
              !active.closed && Date.now() < startup,
              "real IDE readiness failed",
            );
            try {
              if (
                (
                  await fetch("http://127.0.0.1:8082", {
                    signal: AbortSignal.timeout(1000),
                  })
                ).ok
              )
                break;
            } catch {}
            await delay(500);
          }
          await requireSuccess(
            launch(
              [
                "uiSmokeTest",
                `-Dui.journey.phase=${phase}`,
                ...base,
                ...params,
              ],
              `test-${phase}`,
            ),
            deadline,
            `${phase} archived reply recovery`,
          );
        },
        async () => {
          await stopOwned(active, {
            requireRunningOwner: true,
            gracefulDeadline: Math.min(deadline, Date.now() + 30000),
            gracefulStop: async ({ signal }) => {
              const response = await fetch("http://127.0.0.1:8082/js/execute", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal,
                body: JSON.stringify({
                  runInEdt: false,
                  script:
                    "importClass(com.intellij.openapi.application.ApplicationManager); importClass(java.lang.Runnable); const app=ApplicationManager.getApplication(); app.invokeLater(new Runnable({run:function(){app.exit(Packages.com.intellij.openapi.application.ex.ApplicationEx.EXIT_CONFIRMED | Packages.com.intellij.openapi.application.ex.ApplicationEx.SAVE);}}));",
                }),
              });
              assert.ok(response.ok && !(await response.json()).exception);
            },
          });
        },
      );
      await waitForPortFree({
        port: 8082,
        deadline: Math.min(deadline, Date.now() + 30000),
      });
    }
    const result = verifyArchivedReplyOutput(output);
    save(output, "result.json", result);
    return result;
  } catch (error) {
    save(output, "failure.json", {
      status: "FAILED_ARCHIVED_REPLY_CHECK",
      failure: error.message,
      cleanupFailure: error.cleanupFailure,
      scope: fixture.scope,
      originalVerdict: fixture.originalVerdict,
    });
    throw error;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: {
      "versions-file": { type: "string" },
      "plugin-archive": { type: "string" },
      output: { type: "string" },
      "prepare-only": { type: "boolean" },
      verify: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(`Run from the repository root on Linux with IntelliJ 2025.2 dependencies and a display:
  xvfb-run -a node packages/jetbrains-plugin/scripts/verify01-archived-reply-recovery.mjs \\
    --versions-file docs/research/cli/verify01-package-sets/2026-10-18-task-quality-105.json \\
    --plugin-archive /absolute/public-readback/chainlesschain-jetbrains.zip \\
    --output /absolute/existing-parent/verify-33-recovery-new

The manifest must bind the exact approved public plugin version and ZIP bytes. The output must not exist.
Add --prepare-only to bind evidence without launching an IDE. Use a fresh output for the real run.
Offline readback: node packages/jetbrains-plugin/scripts/verify01-archived-reply-recovery.mjs --verify /absolute/evidence-output
Scope: deterministic archived reply and real plugin restoration only; no model requests, new task execution or public CLI verification. Original verdicts stay unchanged.`);
    process.exit(0);
  }
  assert.ok(
    values.verify ||
      (values["versions-file"] && values["plugin-archive"] && values.output),
    "--versions-file, --plugin-archive and --output are required; see --help",
  );
  console.log(
    JSON.stringify(
      values.verify
        ? verifyArchivedReplyOutput(path.resolve(values.verify))
        : await runArchivedReplyRecovery({
            versionsFile: values["versions-file"],
            pluginArchive: path.resolve(values["plugin-archive"]),
            output: path.resolve(values.output),
            prepareOnly: values["prepare-only"],
          }),
    ),
  );
}
