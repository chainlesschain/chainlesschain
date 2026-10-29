import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const directory = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(directory, "../../../..");
const artifacts = fs.realpathSync.native(process.argv[2]);
assert.equal(path.resolve(artifacts), artifacts);
Object.assign(process.env, {
  NODE_ENV: "test",
  TEMP: path.join(artifacts, "temp"),
  TMP: path.join(artifacts, "temp"),
  CHAINLESSCHAIN_HOME: path.join(artifacts, "home"),
  CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: path.join(artifacts, "anchors"),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: path.join(artifacts, "git-config"),
  GIT_TERMINAL_PROMPT: "0",
  CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP: "1",
});
fs.mkdirSync(process.env.TEMP);
fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, "");
const git = (repo, args) =>
  execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const bootstrap = path.join(artifacts, "bootstrap");
fs.mkdirSync(bootstrap);
git(bootstrap, ["init", "-b", "main"]);
process.chdir(bootstrap);
globalThis.fetch = async () => {
  throw new Error("No model/network permitted");
};
const sourceFiles = [
  "packages/cli/src/harness/worktree-isolator.js",
  "packages/cli/src/lib/sub-agent-context.js",
  "packages/cli/src/runtime/agent-core.js",
  "packages/cli/src/lib/ephemeral-worktree-scope.js",
];
const hashes = () =>
  Object.fromEntries(
    sourceFiles.map((file) => [
      file,
      createHash("sha256")
        .update(fs.readFileSync(path.join(workspace, file)))
        .digest("hex"),
    ]),
  );
const before = hashes();
const mainWorktreesBefore = git(workspace, ["worktree", "list", "--porcelain"]);
const { SubAgentContext } = await import("../../src/lib/sub-agent-context.js");
const {
  executeTool,
  listBackgroundShellTasks,
  killAllBackgroundShellTasksSync,
} = await import("../../src/runtime/agent-core.js");
const approvalGate = {
  decide: async () => ({
    decision: "allow",
    via: "fixture",
    policy: "autopilot",
  }),
};
const q = (value) => {
  assert.ok(!/["\r\n%&|<>^!]/.test(value));
  return `"${value}"`;
};
function waitFile(file) {
  return new Promise((resolve, reject) => {
    const finish = () => {
      if (fs.existsSync(file)) {
        watcher.close();
        clearTimeout(timer);
        resolve();
      }
    };
    const watcher = fs.watch(path.dirname(file), finish);
    const timer = setTimeout(() => {
      watcher.close();
      reject(new Error("Handshake timeout: " + file));
    }, 15000);
    finish();
  });
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const cases = [];
let failure;
console.log("artifacts=" + artifacts);
try {
  for (const mode of [
    "refuse-normal",
    "refuse-cancel",
    "foreground",
    "foreground-cancel",
    "ordinary-background",
  ]) {
    const caseDir = path.join(artifacts, mode);
    fs.mkdirSync(caseDir);
    const repo = path.join(caseDir, "repo");
    fs.mkdirSync(repo);
    git(repo, ["init", "-b", "main"]);
    assert.equal(
      path.resolve(repo, git(repo, ["rev-parse", "--git-common-dir"])),
      path.join(repo, ".git"),
    );
    git(repo, ["config", "user.name", "Lifecycle Fixture"]);
    git(repo, ["config", "user.email", "fixture@example.invalid"]);
    fs.writeFileSync(
      path.join(repo, "README.md"),
      "synthetic fixture, still required by background consumer\n",
    );
    git(repo, ["add", "README.md"]);
    git(repo, [
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--no-verify",
      "-m",
      "fixture",
    ]);
    const controller = new AbortController();
    const isolated = mode !== "ordinary-background";
    const context = SubAgentContext.create({
      role: "lifetime-regression",
      task: "No model fixture",
      cwd: repo,
      useWorktree: isolated,
      memoryEnabled: false,
      signal: controller.signal,
    });
    let toolResult,
      ready,
      atAbort,
      taskId,
      runSettled = false;
    context._runCore = async function () {
      const command = `${q(process.execPath)} ${q(path.join(directory, "ephemeral-worktree-consumer.mjs"))} ${q(caseDir)} external-cwd ${q(this.cwd)}`;
      const background = mode.startsWith("refuse") || !isolated;
      const pending = executeTool(
        "run_shell",
        { command, run_in_background: background, cwd: caseDir },
        {
          cwd: this.cwd,
          approvalGate,
          additionalDirectories: [caseDir],
          nonBlockingShell: true,
          signal: this._runAbortController.signal,
        },
      );
      const observed = pending.then(
        (value) => ({ value }),
        (error) => ({
          error: { name: error.name, message: error.message, code: error.code },
        }),
      );
      if (mode.startsWith("refuse")) {
        const outcome = await observed;
        toolResult = outcome.value;
        assert.equal(
          toolResult?.code,
          "CC_EPHEMERAL_WORKTREE_CONSUMER_UNOWNED",
        );
        assert.equal(fs.existsSync(path.join(caseDir, "ready.json")), false);
        assert.equal(
          listBackgroundShellTasks().filter((t) => t.status === "running")
            .length,
          0,
        );
        if (mode === "refuse-cancel") {
          controller.abort();
          this._runAbortController.signal.throwIfAborted();
        }
      } else {
        await waitFile(path.join(caseDir, "ready.json"));
        ready = JSON.parse(fs.readFileSync(path.join(caseDir, "ready.json")));
        assert.equal(ready.worktree, this.cwd);
        assert.equal(alive(ready.pid), true);
        assert.equal(fs.existsSync(path.join(this.cwd, "README.md")), true);
        if (!isolated) {
          const outcome = await observed;
          toolResult = outcome.value;
          taskId = toolResult.task_id;
          assert.equal(toolResult.status, "running");
        } else {
          if (mode === "foreground-cancel") {
            controller.abort();
            await new Promise((resolve) => setImmediate(resolve));
            atAbort = {
              runSettled,
              childAlive: alive(ready.pid),
              worktreeExists: fs.existsSync(this.cwd),
              fileExists: fs.existsSync(path.join(this.cwd, "README.md")),
            };
            assert.equal(runSettled, false);
            assert.equal(atAbort.worktreeExists, true);
          }
          fs.writeFileSync(path.join(caseDir, "release.json"), "{}", {
            flag: "wx",
          });
          toolResult = await observed;
          const read = JSON.parse(
            fs.readFileSync(path.join(caseDir, "result.json")),
          );
          assert.equal(read.result.ok, true);
          assert.equal(alive(ready.pid), false);
          if (mode === "foreground-cancel")
            this._runAbortController.signal.throwIfAborted();
        }
      }
      this.status = "completed";
      this.completedAt = new Date().toISOString();
      return (this.result = {
        summary: "No-model fixture completed",
        artifacts: [],
        toolsUsed: ["run_shell"],
        tokenCount: 0,
        iterationCount: 0,
      });
    };
    const completion = await context.run("Fixture only").finally(() => {
      runSettled = true;
    });
    if (isolated) {
      assert.equal(
        fs.existsSync(context.cwd),
        false,
        JSON.stringify(completion),
      );
      assert.equal(
        git(repo, ["worktree", "list", "--porcelain"]).includes(
          "agent-lifetime-regression",
        ),
        false,
      );
    } else {
      assert.equal(alive(ready.pid), true);
      assert.equal(fs.existsSync(context.cwd), true);
      fs.writeFileSync(path.join(caseDir, "release.json"), "{}", {
        flag: "wx",
      });
      await waitFile(path.join(caseDir, "result.json"));
      const deadline = Date.now() + 5000;
      while (
        listBackgroundShellTasks().find((t) => t.id === taskId)?.status ===
          "running" &&
        Date.now() < deadline
      )
        await new Promise((resolve) => setImmediate(resolve));
      assert.equal(
        listBackgroundShellTasks().find((t) => t.id === taskId)?.status,
        "exited",
      );
      assert.equal(alive(ready.pid), false);
    }
    cases.push({
      mode,
      status: context.status,
      toolResult,
      ready,
      atAbort,
      completion,
      worktreeExistsAfter: fs.existsSync(context.cwd),
      passed: true,
    });
    console.log(JSON.stringify({ mode, passed: true, status: context.status }));
  }
} catch (error) {
  failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  killAllBackgroundShellTasksSync();
}
const after = hashes();
const mainWorktreesAfter = git(workspace, ["worktree", "list", "--porcelain"]);
const paths = (text) =>
  text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .sort();
const result = {
  node: process.version,
  artifacts,
  before,
  after,
  sourcesStable: JSON.stringify(before) === JSON.stringify(after),
  mainWorktreePathsUnchanged:
    JSON.stringify(paths(mainWorktreesBefore)) ===
    JSON.stringify(paths(mainWorktreesAfter)),
  mainWorktreesBefore,
  mainWorktreesAfter,
  cases,
  failure,
};
fs.writeFileSync(
  path.join(artifacts, "receipt.json"),
  JSON.stringify(result, null, 2) + "\n",
  { flag: "wx" },
);
if (!result.sourcesStable || !result.mainWorktreePathsUnchanged)
  process.exitCode = 1;
console.log(
  JSON.stringify({
    receipt: path.join(artifacts, "receipt.json"),
    passed: cases.length,
    failure,
  }),
);
