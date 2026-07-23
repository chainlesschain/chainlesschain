# Process Spawn Inventory

> Generated from child process call-site scan. Do not edit by hand.
> Regenerate with `npm run docs:spawn-inventory --workspace=packages/cli`.

Total matches: 402 (runtime: 326, tooling: 53, test: 23).

## Policy

- `runtime` entries must migrate to `ProcessExecutionBroker` or carry an explicit audited exemption.
- `tooling` entries are allowed for repository maintenance scripts but must not be used as runtime proof.
- `test` entries are inventory noise unless they launch real runtime processes; keep them visible for drift review.

## runtime

| File | Line | Match |
| --- | ---: | --- |
| `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-bridge.js` | 2 | `const { spawn } = require("child_process");` |
| `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-bridge.js` | 109 | `this.serverProcess = _deps.spawn(process.execPath, args, {` |
| `desktop-app-vue/src/main/ai-engine/code-agent/sub-runtime-pool.js` | 17 | `* override them without the `vi.mock("child_process")` trap that plagues` |
| `desktop-app-vue/src/main/ai-engine/code-agent/sub-runtime-pool.js` | 22 | `const { spawn } = require("child_process");` |
| `desktop-app-vue/src/main/ai-engine/code-agent/sub-runtime-pool.js` | 296 | `* Wraps a raw child_process.ChildProcess with a JSON-lines event emitter.` |
| `desktop-app-vue/src/main/ai-engine/code-agent/sub-runtime-pool.js` | 361 | `const raw = _deps.spawn(process.execPath, [_deps.entryFile], {` |
| `desktop-app-vue/src/main/ipc/advanced-features-ipc.js` | 8 | `const { spawn } = require("child_process");` |
| `desktop-app-vue/src/main/ipc/advanced-features-ipc.js` | 154 | `const child = spawn("node", [scriptPath, ...args], {` |
| `packages/agent-sdk/src/agent-session.ts` | 24 | `import { spawn as nodeSpawn, spawnSync } from "node:child_process";` |
| `packages/agent-sdk/src/agent-session.ts` | 25 | `import type { ChildProcess, SpawnOptions } from "node:child_process";` |
| `packages/agent-sdk/src/agent-session.ts` | 452 | `spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);` |
| `packages/agent-sdk/src/cli-json.ts` | 8 | `import { execFile } from "node:child_process";` |
| `packages/cli/bin/chainlesschain.js` | 3 | `// FIRST: Patch child_process globally to route ALL spawn/exec through ProcessExecutionBroker (M1)` |
| `packages/cli/src/auth/npm-auth.js` | 14 | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/auth/npm-auth.js` | 22 | `return _deps.execFileSync(` |
| `packages/cli/src/commands/agenda.js` | 21 | `import { spawn, execSync } from "node:child_process";` |
| `packages/cli/src/commands/agenda.js` | 497 | `const child = spawn(` |
| `packages/cli/src/commands/agenda.js` | 517 | `return execSync(command, {` |
| `packages/cli/src/commands/background-session.js` | 463 | `const { spawn } = await import("node:child_process");` |
| `packages/cli/src/commands/background-session.js` | 527 | `const child = spawn(` |
| `packages/cli/src/commands/batch.js` | 22 | `import { spawn } from "child_process";` |
| `packages/cli/src/commands/batch.js` | 23 | `import { execFileSync } from "child_process";` |
| `packages/cli/src/commands/batch.js` | 199 | `const child = spawn(process.execPath, args, {` |
| `packages/cli/src/commands/batch.js` | 217 | `const child = spawn(command, {` |
| `packages/cli/src/commands/batch.js` | 237 | `execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });` |
| `packages/cli/src/commands/batch.js` | 238 | `const out = execFileSync("git", ["diff", "--cached", "--numstat"], {` |
| `packages/cli/src/commands/batch.js` | 261 | `execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });` |
| `packages/cli/src/commands/batch.js` | 262 | `execFileSync("git", ["commit", "-m", message, "--no-verify"], {` |
| `packages/cli/src/commands/batch.js` | 292 | `const child = spawn(process.execPath, args, {` |
| `packages/cli/src/commands/config.js` | 15 | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/commands/config.js` | 73 | `return deps.spawnSync(file, [...editorArgs, configPath], {` |
| `packages/cli/src/commands/eval.js` | 14 | `import { spawn, spawnSync } from "child_process";` |
| `packages/cli/src/commands/eval.js` | 60 | `spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {` |
| `packages/cli/src/commands/eval.js` | 108 | `const child = spawn(process.execPath, args, {` |
| `packages/cli/src/commands/init.js` | 611 | `const { execSync, spawn, spawnSync } = require("child_process");` |
| `packages/cli/src/commands/init.js` | 618 | `execSync(\`\${cmd} --version\`, { stdio: "ignore", encoding: "utf-8" });` |
| `packages/cli/src/commands/init.js` | 628 | `const proc = spawn("python", ["-m", ...args], { stdio: ["ignore", "pipe", "pipe"] });` |
| `packages/cli/src/commands/init.js` | 739 | `const r = spawnSync("piper", ["--output_file", outputPath], {` |
| `packages/cli/src/commands/init.js` | 801 | `execSync(\`python -c "import \${moduleName}"\`, { stdio: "ignore", encoding: "utf-8" });` |
| `packages/cli/src/commands/init.js` | 972 | `const { spawnSync, execSync } = require("child_process");` |
| `packages/cli/src/commands/init.js` | 980 | `execSync(\`\${cmd} --version\`, { stdio: "ignore", encoding: "utf-8" });` |
| `packages/cli/src/commands/init.js` | 1046 | `const result = spawnSync(` |
| `packages/cli/src/commands/init.js` | 1058 | `const result = spawnSync(` |
| `packages/cli/src/commands/init.js` | 1083 | `const askResult = spawnSync(` |
| `packages/cli/src/commands/init.js` | 1355 | `const { spawnSync, execSync } = require("child_process");` |
| `packages/cli/src/commands/init.js` | 1365 | `execSync(\`\${cmd} --version\`, { stdio: "ignore", encoding: "utf-8" });` |
| `packages/cli/src/commands/init.js` | 1435 | `const result = spawnSync(` |
| `packages/cli/src/commands/init.js` | 1604 | `const { execSync, spawnSync } = require("child_process");` |
| `packages/cli/src/commands/init.js` | 1611 | `const r = spawnSync(cmd, ["--version"], { encoding: "utf-8", timeout: 5000 });` |
| `packages/cli/src/commands/init.js` | 1620 | `execSync(\`\${pyCmd} -c "import \${moduleName}"\`, { stdio: "ignore", timeout: 10000 });` |
| `packages/cli/src/commands/init.js` | 1629 | `const r = spawnSync(` |
| `packages/cli/src/commands/init.js` | 1751 | `const r = spawnSync("pandoc", ["--version"], { encoding: "utf-8", timeout: 5000 });` |
| `packages/cli/src/commands/init.js` | 1754 | `spawnSync("pandoc", [inputFile, "-o", tmpMd], { encoding: "utf-8", timeout: 60000 });` |
| `packages/cli/src/commands/init.js` | 1763 | `spawnSync("pandoc", [tmpMd, "-o", outputFile], { encoding: "utf-8", timeout: 60000 });` |
| `packages/cli/src/commands/init.js` | 1787 | `const rv = spawnSync(soffice, ["--version"], { encoding: "utf-8", timeout: 5000, shell: process.platform === "win32" });` |
| `packages/cli/src/commands/init.js` | 1790 | `spawnSync(soffice, ["--headless", "--convert-to", "html", inputFile, "--outdir", tmpDir2], {` |
| `packages/cli/src/commands/init.js` | 1802 | `spawnSync(soffice, ["--headless", "--convert-to", "docx", htmlFile, "--outdir", path.dirname(outputFile)], {` |
| `packages/cli/src/commands/init.js` | 1857 | `const er = spawnSync(py.command, [tmpExtract], { encoding: "utf-8", timeout: 30000 });` |
| `packages/cli/src/commands/init.js` | 1907 | `const ar = spawnSync(py.command, [tmpApply], { encoding: "utf-8", timeout: 30000 });` |
| `packages/cli/src/commands/init.js` | 1964 | `const er = spawnSync(py.command, [tmpExtract], { encoding: "utf-8", timeout: 30000 });` |
| `packages/cli/src/commands/init.js` | 2015 | `const ar = spawnSync(py.command, [tmpApply], { encoding: "utf-8", timeout: 30000 });` |
| `packages/cli/src/commands/loop.js` | 26 | `import { spawn } from "node:child_process";` |
| `packages/cli/src/commands/loop.js` | 69 | `const child = spawn(cmd, args, {` |
| `packages/cli/src/commands/memory.js` | 57 | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/commands/memory.js` | 63 | `return deps.execFileSync(file, [...editorArgs, filePath], {` |
| `packages/cli/src/commands/review.js` | 44 | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/commands/review.js` | 60 | `const res = _deps.spawnSync("git", args, {` |
| `packages/cli/src/commands/review.js` | 373 | `const res = _deps.spawnSync("gh", args, {` |
| `packages/cli/src/commands/routine.js` | 23 | `spawn: (...args) => executionBroker.spawn(...args),` |
| `packages/cli/src/commands/routine.js` | 24 | `execFile: (...args) => executionBroker.execFile(...args),` |
| `packages/cli/src/commands/routine.js` | 39 | `const child = _deps.spawn(` |
| `packages/cli/src/commands/routine.js` | 90 | `_deps.execFile(` |
| `packages/cli/src/commands/session.js` | 67 | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/commands/session.js` | 166 | `const out = _deps.execFileSync("gh", args, {` |
| `packages/cli/src/commands/team.js` | 29 | `spawn: (...args) => executionBroker.spawn(...args),` |
| `packages/cli/src/commands/team.js` | 108 | `const child = _deps.spawn(command, [], {` |
| `packages/cli/src/commands/team.js` | 139 | `const child = _deps.spawn(process.execPath, args, {` |
| `packages/cli/src/commands/update.js` | 15 | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/commands/update.js` | 36 | `const result = _deps.spawnSync(command, args, {` |
| `packages/cli/src/gateways/ws/ws-server.js` | 118 | `spawn: (...args) => executionBroker.spawn(...args),` |
| `packages/cli/src/gateways/ws/ws-server.js` | 248 | `this._spawnProcess = options.spawn \|\| _deps.spawn;` |
| `packages/cli/src/harness/background-task-manager.js` | 4 | `* Tasks run in child_process.fork() for isolation.` |
| `packages/cli/src/harness/background-task-manager.js` | 11 | `import { fork } from "node:child_process";` |
| `packages/cli/src/harness/background-task-manager.js` | 117 | `const child = fork(` |
| `packages/cli/src/harness/background-task-worker.js` | 8 | `import { execSync } from "node:child_process";` |
| `packages/cli/src/harness/background-task-worker.js` | 20 | `result = execSync(command, {` |
| `packages/cli/src/harness/background-task-worker.js` | 27 | `result = execSync(command, {` |
| `packages/cli/src/harness/mcp-client.js` | 11 | `import { spawn } from "child_process";` |
| `packages/cli/src/harness/mcp-client.js` | 491 | `: _deps.spawn;` |
| `packages/cli/src/harness/worktree-isolator.js` | 10 | `import { execSync } from "node:child_process";` |
| `packages/cli/src/harness/worktree-isolator.js` | 96 | `branch = execSync("git rev-parse --abbrev-ref HEAD", {` |
| `packages/cli/src/harness/worktree-isolator.js` | 218 | `const porcelain = execSync("git status --porcelain", {` |
| `packages/cli/src/harness/worktree-isolator.js` | 693 | `const output = execSync("git status --porcelain", {` |
| `packages/cli/src/lazy-dispatch.js` | 105 | `async spawn(argv) {` |
| `packages/cli/src/lib/agent-ipc-bus.js` | 173 | `const { spawn } = await import("node:child_process");` |
| `packages/cli/src/lib/agent-ipc-bus.js` | 178 | `const child = spawn(command, args, {` |
| `packages/cli/src/lib/agent-sandbox.js` | 8 | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/lib/agent-sandbox.js` | 130 | `const result = _deps.spawnSync("docker", args, {` |
| `packages/cli/src/lib/agent-sandbox.js` | 197 | `const result = _deps.spawnSync("bwrap", args, {` |
| `packages/cli/src/lib/agent-sandbox.js` | 256 | `const result = deps.spawnSync(probeArgs[0], probeArgs[1], {` |
| `packages/cli/src/lib/agent-team/team-worktree.js` | 26 | `import { execFileSync, spawn } from "node:child_process";` |
| `packages/cli/src/lib/agent-team/team-worktree.js` | 52 | `const child = spawn(command, { cwd, shell: true, env: process.env });` |
| `packages/cli/src/lib/agent-team/team-worktree.js` | 66 | `execFileSync("git", ["add", "-A"], { cwd: worktreePath, stdio: "ignore" });` |
| `packages/cli/src/lib/agent-team/team-worktree.js` | 68 | `execFileSync(` |
| `packages/cli/src/lib/agent-worktree.js` | 14 | `import { execFileSync, execSync } from "child_process";` |
| `packages/cli/src/lib/agent-worktree.js` | 28 | `return (deps.execSync \|\| execSync)(`git ${cmd}`, {` |
| `packages/cli/src/lib/agent-worktree.js` | 141 | `const run = deps.execFileSync \|\| execFileSync;` |
| `packages/cli/src/lib/api-key-helper.js` | 37 | `executionBroker.execSync(command, {` |
| `packages/cli/src/lib/async-hook-supervisor.cjs` | 31 | `* `_deps.spawn` / `_deps.now` are injected so the whole supervisor is unit-` |
| `packages/cli/src/lib/async-hook-supervisor.cjs` | 35 | `const cpDefault = require("node:child_process");` |
| `packages/cli/src/lib/async-hook-supervisor.cjs` | 55 | `spawn: opts.spawn \|\| cpDefault.spawn,` |
| `packages/cli/src/lib/async-hook-supervisor.cjs` | 56 | `spawnSync: opts.spawnSync \|\| cpDefault.spawnSync,` |
| `packages/cli/src/lib/async-hook-supervisor.cjs` | 129 | `const r = this._deps.spawnSync(` |
| `packages/cli/src/lib/async-hook-supervisor.cjs` | 138 | `this._deps.spawnSync(` |
| `packages/cli/src/lib/async-hook-supervisor.cjs` | 267 | `? opts.broker.spawn(hook.command, [], {` |
| `packages/cli/src/lib/async-hook-supervisor.cjs` | 275 | `: this._deps.spawn(hook.command, spawnOptions);` |
| `packages/cli/src/lib/background-agent-supervisor.js` | 1 | `import { spawn, spawnSync } from "node:child_process";` |
| `packages/cli/src/lib/background-agent-supervisor.js` | 80 | `const r = spawnSync(` |
| `packages/cli/src/lib/background-agent-supervisor.js` | 104 | `const r = spawnSync(` |
| `packages/cli/src/lib/background-agent-supervisor.js` | 121 | `const r = spawnSync("ps", ["-o", "lstart=", "-p", String(target)], {` |
| `packages/cli/src/lib/background-agent-supervisor.js` | 150 | `const r = _deps.spawnSync(` |
| `packages/cli/src/lib/background-agent-supervisor.js` | 744 | `* Fail fast on an unusable cwd. Without this, spawn() surfaces a bad cwd as` |
| `packages/cli/src/lib/background-agent-supervisor.js` | 824 | `child = _deps.spawn(process.execPath, [worker, jobFile], {` |
| `packages/cli/src/lib/background-agent-supervisor.js` | 925 | `const killed = _deps.spawnSync(` |
| `packages/cli/src/lib/background-interaction-resolver.js` | 15 | `* @param {import('node:child_process').ChildProcess} child - agent 子进程实例` |
| `packages/cli/src/lib/checkpoint-store.js` | 26 | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/lib/checkpoint-store.js` | 48 | `const res = _deps.spawnSync("git", args, {` |
| `packages/cli/src/lib/chrome-connector.js` | 29 | `import { spawn } from "child_process";` |
| `packages/cli/src/lib/chrome-connector.js` | 214 | `const child = deps.spawn(executable, args, {` |
| `packages/cli/src/lib/claude-code-bridge.js` | 16 | `import { spawn, execSync } from "child_process";` |
| `packages/cli/src/lib/claude-code-bridge.js` | 48 | `.execSync("claude --version", { encoding: "utf-8", timeout: 5000 })` |
| `packages/cli/src/lib/claude-code-bridge.js` | 63 | `.execSync("codex --version", { encoding: "utf-8", timeout: 5000 })` |
| `packages/cli/src/lib/claude-code-bridge.js` | 151 | `const proc = _deps.spawn(this.cliCommand, args, {` |
| `packages/cli/src/lib/cli-anything-bridge.js` | 11 | `import { execSync } from "child_process";` |
| `packages/cli/src/lib/cli-anything-bridge.js` | 59 | `.execSync(`${cmd} --version`, {` |
| `packages/cli/src/lib/cli-anything-bridge.js` | 85 | `const out = _deps.execSync(`${py.command} -m pip show cli-anything`, {` |
| `packages/cli/src/lib/cli-anything-bridge.js` | 105 | `_deps.execSync(`${pythonCmd} -m pip install cli-anything`, {` |
| `packages/cli/src/lib/cli-anything-bridge.js` | 155 | `helpText = _deps.execSync(`${command} --help`, {` |
| `packages/cli/src/lib/cli-anything-bridge.js` | 255 | `const { execSync } = require("child_process");` |
| `packages/cli/src/lib/cli-anything-bridge.js` | 267 | `const output = execSync(\`${command} \${input}\`, {` |
| `packages/cli/src/lib/cloud/bundle.js` | 17 | `return executionBroker.execFileSync(file, args, {` |
| `packages/cli/src/lib/cloud/bundle.js` | 30 | `.execFileSync("git", args, {` |
| `packages/cli/src/lib/code-agent.js` | 227 | `/child_process.*exec\s*\(\s*[`"'].*\$\{/,` |
| `packages/cli/src/lib/code-review.js` | 11 | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/lib/code-review.js` | 29 | `return _deps.execFileSync("git", buildGitDiffArgs(target, options), {` |
| `packages/cli/src/lib/computer-use/control-backend.js` | 13 | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/lib/computer-use/control-backend.js` | 19 | `const res = deps.spawnSync(` |
| `packages/cli/src/lib/computer-use/control-backend.js` | 150 | `const res = deps.spawnSync(app, args, {` |
| `packages/cli/src/lib/doctor-checkup.js` | 26 | `import { execSync, spawnSync } from "node:child_process";` |
| `packages/cli/src/lib/doctor-checkup.js` | 552 | `deps.execSync("git rev-parse --is-inside-work-tree", {` |
| `packages/cli/src/lib/doctor-checkup.js` | 573 | `deps.execSync("git worktree prune --dry-run -v", {` |
| `packages/cli/src/lib/doctor-checkup.js` | 842 | `spawnSync: deps.spawnSync,` |
| `packages/cli/src/lib/doctor-checkup.js` | 1141 | `deps.execSync("git worktree prune", {` |
| `packages/cli/src/lib/downloader.js` | 18 | `return executionBroker.execFileSync(file, args, options);` |
| `packages/cli/src/lib/ensure-utf8.js` | 15 | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/lib/ensure-utf8.js` | 39 | `_deps.execFileSync("cmd.exe", ["/d", "/s", "/c", "chcp 65001"], {` |
| `packages/cli/src/lib/eval/tasks.js` | 14 | `import { execFileSync } from "node:child_process";` |
| `packages/cli/src/lib/eval/tasks.js` | 100 | `const out = execFileSync(process.execPath, ["bug.js"], {` |
| `packages/cli/src/lib/eval/tasks.js` | 189 | `const out = execFileSync(process.execPath, ["run-checks.mjs"], {` |
| `packages/cli/src/lib/eval/tasks.js` | 246 | `const out = execFileSync(process.execPath, ["main.js"], {` |
| `packages/cli/src/lib/eval/tasks.js` | 294 | `execFileSync(process.execPath, ["verify.mjs"], {` |
| `packages/cli/src/lib/eval/tasks.js` | 386 | `const out = execFileSync(process.execPath, ["app.mjs"], {` |
| `packages/cli/src/lib/eval/tasks.js` | 528 | `const out = execFileSync(process.execPath, ["build.mjs"], {` |
| `packages/cli/src/lib/eval/tasks.js` | 623 | `const out = execFileSync(process.execPath, ["run.mjs"], {` |
| `packages/cli/src/lib/execution-backend.js` | 18 | `execSync: (...args) => executionBroker.execSync(...args),` |
| `packages/cli/src/lib/execution-backend.js` | 19 | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/lib/execution-backend.js` | 23 | `const result = _deps.spawnSync(command, args, options);` |
| `packages/cli/src/lib/execution-backend.js` | 82 | `const stdout = _deps.execSync(command, {` |
| `packages/cli/src/lib/git-integration.js` | 10 | `execSync: (...args) => executionBroker.execSync(...args),` |
| `packages/cli/src/lib/git-integration.js` | 11 | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/lib/git-integration.js` | 88 | `const res = _deps.spawnSync("git", args, {` |
| `packages/cli/src/lib/git-integration.js` | 114 | `return _deps.execSync(`git ${args}`, {` |
| `packages/cli/src/lib/git-integration.js` | 153 | `const output = _deps.execSync("git status --porcelain", {` |
| `packages/cli/src/lib/goal-condition-engine.js` | 194 | `const spawnSync = deps.spawnSync;` |
| `packages/cli/src/lib/goal-condition-engine.js` | 202 | `const res = spawnSync(condition.command, {` |
| `packages/cli/src/lib/hook-manager.js` | 293 | `const output = broker.execSync(cmd, {` |
| `packages/cli/src/lib/hook-runner.cjs` | 20 | `* `_deps.spawnSync` is injected for unit tests (no real process needed).` |
| `packages/cli/src/lib/hook-runner.cjs` | 23 | `const cpDefault = require("node:child_process");` |
| `packages/cli/src/lib/hook-runner.cjs` | 31 | `const _deps = { spawnSync: cpDefault.spawnSync, spawn: cpDefault.spawn };` |
| `packages/cli/src/lib/hook-runner.cjs` | 244 | `res = opts.broker.spawnSync(` |
| `packages/cli/src/lib/hook-runner.cjs` | 257 | `res = _deps.spawnSync(inv.file, inv.argv, common);` |
| `packages/cli/src/lib/hook-runner.cjs` | 259 | `res = _deps.spawnSync(command, { ...common, shell: true });` |
| `packages/cli/src/lib/hook-runner.cjs` | 370 | `? opts.broker.spawn(inv.file, inv.argv, {` |
| `packages/cli/src/lib/hook-runner.cjs` | 379 | `: _deps.spawn(inv.file, inv.argv, { cwd: wd, env: spawnEnv });` |
| `packages/cli/src/lib/hook-runner.cjs` | 382 | `? opts.broker.spawn(command, [], {` |
| `packages/cli/src/lib/hook-runner.cjs` | 392 | `: _deps.spawn(command, { cwd: wd, env: spawnEnv, shell: true });` |
| `packages/cli/src/lib/hooks-v2-runtime.js` | 240 | `const child = await broker.spawn(` |
| `packages/cli/src/lib/host-adb-bridge.js` | 34 | `import { execFile } from "node:child_process";` |
| `packages/cli/src/lib/lan-pairing-preflight.js` | 28 | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/lib/lan-pairing-preflight.js` | 320 | `_deps.execFileSync(probe, [cmd], {` |
| `packages/cli/src/lib/lsp/benchmark.js` | 171 | `const { execFileSync } = await import("child_process");` |
| `packages/cli/src/lib/lsp/benchmark.js` | 175 | `const csv = execFileSync(` |
| `packages/cli/src/lib/lsp/benchmark.js` | 189 | `const out = execFileSync("ps", ["-o", "pid=,ppid=,rss="], {` |
| `packages/cli/src/lib/lsp/lsp-client.js` | 11 | `* Testability: all process spawning goes through `_deps.spawn` so tests inject a` |
| `packages/cli/src/lib/lsp/lsp-client.js` | 12 | `* fake stdio pair (see cli-dev.md `_deps` pattern — `vi.mock("child_process")`` |
| `packages/cli/src/lib/lsp/lsp-client.js` | 16 | `import { spawn as nodeSpawn } from "child_process";` |
| `packages/cli/src/lib/lsp/lsp-client.js` | 83 | `: _deps.spawn;` |
| `packages/cli/src/lib/lsp/lsp-server-registry.js` | 17 | `import { execFileSync } from "child_process";` |
| `packages/cli/src/lib/mcp-oauth.js` | 39 | `executionBroker.spawn(command, args, {` |
| `packages/cli/src/lib/mcp-oauth.js` | 680 | `const child = _deps.spawn(cmd, args, { stdio: "ignore", detached: true });` |
| `packages/cli/src/lib/orchestrator.js` | 25 | `import { execSync } from "child_process";` |
| `packages/cli/src/lib/orchestrator.js` | 382 | `const output = _deps.execSync(this.ciCommand, {` |
| `packages/cli/src/lib/packer/native-prebuild-collector.js` | 257 | `// Generic fallback — a native fork (e.g. better-sqlite3-multiple-ciphers)` |
| `packages/cli/src/lib/packer/pack-update-applier.js` | 30 | `import { spawn } from "node:child_process";` |
| `packages/cli/src/lib/packer/pkg-runner.js` | 21 | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/lib/packer/pkg-runner.js` | 54 | `const res = _deps.spawnSync(pkgBin.runtime, args, {` |
| `packages/cli/src/lib/packer/precheck.js` | 13 | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/lib/packer/precheck.js` | 157 | `.execFileSync(` |
| `packages/cli/src/lib/packer/precheck.js` | 164 | `.execFileSync(` |
| `packages/cli/src/lib/packer/precheck.js` | 170 | `const status = _deps.execFileSync(` |
| `packages/cli/src/lib/packer/smoke-runner.js` | 22 | `import { spawn } from "node:child_process";` |
| `packages/cli/src/lib/packer/smoke-runner.js` | 83 | `const child = spawn(exePath, ["ui", "--no-open"], {` |
| `packages/cli/src/lib/packer/smoke-runner.js` | 119 | `spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], {` |
| `packages/cli/src/lib/packer/web-panel-builder.js` | 17 | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/lib/packer/web-panel-builder.js` | 57 | `const res = _deps.spawnSync(npmCmd, ["run", "build:web-panel"], {` |
| `packages/cli/src/lib/plugin-ecosystem.js` | 114 | `/require\(\s*['"]child_process['"]\s*\)\|from\s+['"]child_process['"]/g,` |
| `packages/cli/src/lib/plugin-ecosystem.js` | 116 | `message: "child_process import — review command usage",` |
| `packages/cli/src/lib/plugin-monitor-supervisor.js` | 24 | `import { spawn } from "node:child_process";` |
| `packages/cli/src/lib/plugin-monitor-supervisor.js` | 42 | `this._spawn = opts.spawn \|\| _deps.spawn;` |
| `packages/cli/src/lib/plugin-runtime/install.js` | 22 | `import { spawnSync } from "child_process";` |
| `packages/cli/src/lib/plugin-runtime/install.js` | 271 | `_deps.spawnSync("git", args, {` |
| `packages/cli/src/lib/pr-create.js` | 11 | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/lib/pr-create.js` | 15 | `return _deps.execFileSync("git", args, {` |
| `packages/cli/src/lib/pr-link-ledger.js` | 25 | `execFile: (...args) => executionBroker.execFile(...args),` |
| `packages/cli/src/lib/pr-link-ledger.js` | 153 | `_deps.execFile(` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 14 | `// 直接导入原生child_process，避免递归` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 23 | `} from "node:child_process";` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 307 | `spawn(command, args, options = {}) {` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 492 | `spawnSync(command, args, options = {}) {` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 622 | `* boundary as child_process execution. node-pty owns the native PTY` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 691 | `const proc = ptyModule.spawn(command, filteredArgs, spawnOptions);` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 711 | `return this.spawn(command, [], {` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 718 | `execSync(command, options = {}) {` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 724 | `const result = this.spawnSync(command, [], spawnOpts);` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 738 | `execFile(file, args, options, callback) {` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 753 | `const proc = this.spawn(file, args, options);` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 829 | `execFileSync(file, args, options = {}) {` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 834 | `const result = this.spawnSync(file, args, options);` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 849 | `fork(modulePath, args, options = {}) {` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 850 | `return this.spawn(process.execPath, [modulePath, ...(args \|\| [])], {` |
| `packages/cli/src/lib/process-execution-broker/patch-child-process.js` | 2 | `* Monkey-patch node:child_process to route ALL spawn/exec calls through ExecutionBroker (M1)` |
| `packages/cli/src/lib/process-execution-broker/patch-child-process.js` | 11 | `// Get the REAL native child_process module (unpatched, from Node.js internals)` |
| `packages/cli/src/lib/process-execution-broker/patch-child-process.js` | 12 | `const nativeCp = require("node:child_process");` |
| `packages/cli/src/lib/process-execution-broker/patch-child-process.js` | 17 | `return executionBroker.spawn(command, args, options);` |
| `packages/cli/src/lib/process-execution-broker/patch-child-process.js` | 21 | `return executionBroker.spawnSync(command, args, options);` |
| `packages/cli/src/lib/process-execution-broker/patch-child-process.js` | 29 | `return executionBroker.execSync(command, options);` |
| `packages/cli/src/lib/process-execution-broker/patch-child-process.js` | 33 | `return executionBroker.execFile(file, args, options, callback);` |
| `packages/cli/src/lib/process-execution-broker/patch-child-process.js` | 37 | `return executionBroker.execFileSync(file, args, options);` |
| `packages/cli/src/lib/process-execution-broker/patch-child-process.js` | 41 | `return executionBroker.fork(modulePath, args, options);` |
| `packages/cli/src/lib/process-execution-broker/patch-child-process.js` | 44 | `// Also patch child_process for CommonJS require` |
| `packages/cli/src/lib/process-execution-broker/patch-child-process.js` | 45 | `const cpModule = require.cache[require.resolve("node:child_process")];` |
| `packages/cli/src/lib/process-execution-broker/platform-sandbox.js` | 217 | `* is to use `prlimit` (util-linux) wrapper and set `child_process` uid/gid/groups.` |
| `packages/cli/src/lib/process-manager.js` | 15 | `spawn: (...args) => executionBroker.spawn(...args),` |
| `packages/cli/src/lib/process-manager.js` | 16 | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/lib/process-manager.js` | 52 | `const child = _deps.spawn(appPath, args, {` |
| `packages/cli/src/lib/process-manager.js` | 102 | `_deps.execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {` |
| `packages/cli/src/lib/publish-workspace.js` | 13 | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/lib/publish-workspace.js` | 71 | `_deps.execFileSync("npm", args, {` |
| `packages/cli/src/lib/repl-bang-memorize.js` | 20 | `import { spawnSync as spawnSyncDefault } from "child_process";` |
| `packages/cli/src/lib/repl-bang-memorize.js` | 72 | `const spawnSync = opts.deps?.spawnSync \|\| _deps.spawnSync;` |
| `packages/cli/src/lib/repl-bang-memorize.js` | 81 | `? spawnSync("cmd.exe", ["/d", "/s", "/c", `chcp 65001 >nul && ${cmd}`], {` |
| `packages/cli/src/lib/repl-bang-memorize.js` | 87 | `: spawnSync("/bin/sh", ["-c", cmd], {` |
| `packages/cli/src/lib/repl-goal.js` | 113 | `spawnSync: deps.spawnSync,` |
| `packages/cli/src/lib/search-command.js` | 5 | `* The pattern flows into execSync (a real shell), so a raw interpolation` |
| `packages/cli/src/lib/secret-store.js` | 38 | `const result = executionBroker.spawnSync(file, args, {` |
| `packages/cli/src/lib/service-manager.js` | 7 | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/lib/service-manager.js` | 8 | `spawn: (...args) => executionBroker.spawn(...args),` |
| `packages/cli/src/lib/service-manager.js` | 12 | `return _deps.execFileSync(command, args, {` |
| `packages/cli/src/lib/service-manager.js` | 92 | `const child = _deps.spawn(` |
| `packages/cli/src/lib/skill-packs/generator.js` | 179 | `const { spawnSync } = require("child_process");` |
| `packages/cli/src/lib/skill-packs/generator.js` | 256 | `const result = spawnSync("chainlesschain", cliArgs, {` |
| `packages/cli/src/lib/skill-packs/generator.js` | 410 | `const { spawnSync } = require("child_process");` |
| `packages/cli/src/lib/skill-packs/generator.js` | 484 | `const result = spawnSync("chainlesschain", cliArgs, {` |
| `packages/cli/src/lib/slash-commands.js` | 24 | `import { execSync as execSyncDefault } from "node:child_process";` |
| `packages/cli/src/lib/slash-commands.js` | 189 | `const out = execSync(cmd, {` |
| `packages/cli/src/lib/slash-commands.js` | 215 | `const execSync = opts.deps?.execSync \|\| _deps.execSync;` |
| `packages/cli/src/lib/status-line.cjs` | 19 | `const cpDefault = require("node:child_process");` |
| `packages/cli/src/lib/status-line.cjs` | 24 | `spawnSync: cpDefault.spawnSync,` |
| `packages/cli/src/lib/status-line.cjs` | 197 | `res = _deps.spawnSync(config.command, {` |
| `packages/cli/src/lib/turn-context.js` | 18 | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/lib/turn-context.js` | 30 | `.execFileSync("git", args, {` |
| `packages/cli/src/lib/update-notice.js` | 22 | `spawn: (...args) => executionBroker.spawn(...args),` |
| `packages/cli/src/lib/update-notice.js` | 94 | `const child = deps.spawn(process.execPath, [refresher, cachePath(deps)], {` |
| `packages/cli/src/repl/agent-repl.js` | 5582 | `const cpMod = await import("node:child_process");` |
| `packages/cli/src/repl/clipboard-copy.js` | 82 | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/repl/clipboard-copy.js` | 91 | `const spawn = spawnSync \|\| _deps.spawnSync;` |
| `packages/cli/src/repl/clipboard-copy.js` | 97 | `res = spawn(cmd, args, {` |
| `packages/cli/src/repl/pr-comments.js` | 15 | `execFile: (...args) => executionBroker.execFile(...args),` |
| `packages/cli/src/repl/pr-comments.js` | 21 | `deps.execFile(` |
| `packages/cli/src/runtime/agent-core.js` | 19 | `import { execSync, spawn, spawnSync } from "child_process";` |
| `packages/cli/src/runtime/agent-core.js` | 240 | `const tk = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {` |
| `packages/cli/src/runtime/agent-core.js` | 317 | `const killed = spawnSync(` |
| `packages/cli/src/runtime/agent-core.js` | 733 | `execSync(`${py.command} -m pip --version`, {` |
| `packages/cli/src/runtime/agent-core.js` | 746 | `nodeVersion = execSync("node --version", {` |
| `packages/cli/src/runtime/agent-core.js` | 756 | `execSync("git --version", {` |
| `packages/cli/src/runtime/agent-core.js` | 3060 | `// is the historical spawn(command, {shell:true}) byte-for-byte.` |
| `packages/cli/src/runtime/agent-core.js` | 3069 | `? broker.spawn(args.command, [], brokerOpts)` |
| `packages/cli/src/runtime/agent-core.js` | 3070 | `: broker.spawn(shellInv.file, shellInv.argv, brokerOpts);` |
| `packages/cli/src/runtime/agent-core.js` | 3251 | `output = broker.execSync(args.command, brokerExecOpts);` |
| `packages/cli/src/runtime/agent-core.js` | 3257 | `const res = broker.spawnSync(shellInv.file, shellInv.argv, {` |
| `packages/cli/src/runtime/agent-core.js` | 3371 | `// cannot inject a second command. Previously execSync(`git ${cmd}`) ran` |
| `packages/cli/src/runtime/agent-core.js` | 3377 | `const res = spawnSync("git", gitArgs, {` |
| `packages/cli/src/runtime/agent-core.js` | 3983 | `const output = execSync(cmd, {` |
| `packages/cli/src/runtime/agent-core.js` | 4589 | `output = execSync(`${interpreter} "${scriptPath}"`, {` |
| `packages/cli/src/runtime/agent-core.js` | 4689 | `execSync(`${interpreter} -m pip install ${packageName}`, {` |
| `packages/cli/src/runtime/agent-core.js` | 4705 | `const retryOutput = execSync(`${interpreter} "${scriptPath}"`, {` |
| `packages/cli/src/runtime/agent-core.js` | 5208 | `// fully-defaulted spawn (→ "default") touches neither tools nor confirmer nor gate.` |
| `packages/cli/src/runtime/agent-core.js` | 5264 | `// sub-agent runs, so a policy hook can VETO the spawn (`block`) or INJECT` |
| `packages/cli/src/runtime/diagnostics.js` | 83 | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/runtime/diagnostics.js` | 89 | `deps.execFileSync(file, args, {` |
| `packages/cli/src/runtime/headless-runner.js` | 2060 | `gc.spawnSync \|\| (await import("node:child_process")).spawnSync;` |
| `packages/cli/src/skills/video-editing/extractors/audio-extractor.js` | 14 | `import { spawn } from "child_process";` |
| `packages/cli/src/skills/video-editing/extractors/audio-extractor.js` | 126 | `const proc = spawn("python", [script, audioPath], {` |
| `packages/cli/src/skills/video-editing/extractors/audio-extractor.js` | 164 | `const proc = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });` |
| `packages/cli/src/skills/video-editing/extractors/video-extractor.js` | 9 | `import { spawn } from "child_process";` |
| `packages/cli/src/skills/video-editing/extractors/video-extractor.js` | 33 | `const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });` |
| `packages/cli/src/skills/video-editing/extractors/video-extractor.js` | 62 | `const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });` |
| `packages/cli/src/skills/video-editing/render/audio-mix.js` | 8 | `import { spawn } from "child_process";` |
| `packages/cli/src/skills/video-editing/render/audio-mix.js` | 41 | `const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });` |
| `packages/cli/src/skills/video-editing/render/audio-mix.js` | 73 | `const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });` |
| `packages/cli/src/skills/video-editing/render/ffmpeg-concat.js` | 5 | `import { spawn } from "child_process";` |
| `packages/cli/src/skills/video-editing/render/ffmpeg-concat.js` | 33 | `const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });` |
| `packages/cli/src/skills/video-editing/render/ffmpeg-extract.js` | 5 | `import { spawn } from "child_process";` |
| `packages/cli/src/skills/video-editing/render/ffmpeg-extract.js` | 51 | `const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });` |
| `packages/cli/src/workers/background-agent-worker.js` | 15 | `import { spawn } from "node:child_process";` |
| `packages/cli/src/workers/background-agent-worker.js` | 118 | `child = spawn(process.execPath, [job.cliEntry, ...argv], {` |

## tooling

| File | Line | Match |
| --- | ---: | --- |
| `desktop-app-vue/scripts/aggressive-lint-fix.js` | 14 | `const { execSync } = require("child_process");` |
| `desktop-app-vue/scripts/aggressive-lint-fix.js` | 195 | `execSync("npm run lint", {` |
| `desktop-app-vue/scripts/auto-fix-runner.js` | 8 | `const { exec } = require('child_process');` |
| `desktop-app-vue/scripts/benchmark-mcp.js` | 22 | `const { spawn } = require("child_process");` |
| `desktop-app-vue/scripts/build-win-with-deref.js` | 48 | `const { spawnSync } = require("child_process");` |
| `desktop-app-vue/scripts/build-win-with-deref.js` | 278 | `const result = spawnSync(process.execPath, [ebCli, ...ebArgs], {` |
| `desktop-app-vue/scripts/ci-performance-monitor.js` | 15 | `const { execSync } = require("child_process");` |
| `desktop-app-vue/scripts/ci-performance-monitor.js` | 31 | `const output = execSync(command, {` |
| `desktop-app-vue/scripts/conservative-lint-fix.js` | 15 | `const { execSync } = require("child_process");` |
| `desktop-app-vue/scripts/conservative-lint-fix.js` | 185 | `const result = execSync("npm run lint 2>&1", {` |
| `desktop-app-vue/scripts/cowork-ci-test-selector.js` | 15 | `const { execSync } = require("child_process");` |
| `desktop-app-vue/scripts/cowork-ci-test-selector.js` | 41 | `const output = execSync(command, {` |
| `desktop-app-vue/scripts/cowork-ci-test-selector.js` | 455 | `execSync(defaultCommand, { stdio: "inherit", cwd: process.cwd() });` |
| `desktop-app-vue/scripts/cowork-ci-test-selector.js` | 496 | `execSync(command, { stdio: "inherit", cwd: process.cwd() });` |
| `desktop-app-vue/scripts/cowork-ci-test-selector.js` | 522 | `execSync(`npx vitest run tests/unit ${CI_VITEST_FLAGS}`, {` |
| `desktop-app-vue/scripts/cowork-doc-generator.js` | 16 | `const { execSync } = require("child_process");` |
| `desktop-app-vue/scripts/cowork-doc-generator.js` | 247 | `const output = execSync(command, { encoding: "utf-8", cwd: process.cwd() });` |
| `desktop-app-vue/scripts/cowork-pre-commit.js` | 14 | `const { execSync } = require("child_process");` |
| `desktop-app-vue/scripts/cowork-pre-commit.js` | 36 | `const output = execSync(` |
| `desktop-app-vue/scripts/cowork-test-selector.js` | 14 | `const { execSync } = require("child_process");` |
| `desktop-app-vue/scripts/cowork-test-selector.js` | 45 | `const output = execSync(command, {` |
| `desktop-app-vue/scripts/cowork-test-selector.js` | 339 | `execSync("npx vitest run", { stdio: "inherit" });` |
| `desktop-app-vue/scripts/cowork-test-selector.js` | 370 | `execSync(command, { stdio: "inherit", cwd: process.cwd() });` |
| `desktop-app-vue/scripts/cowork-test-selector.js` | 392 | `execSync("npx vitest run", { stdio: "inherit" });` |
| `desktop-app-vue/scripts/generate-icon.js` | 3 | `const { execSync } = require('child_process');` |
| `desktop-app-vue/scripts/generate-icon.js` | 36 | `execSync(`powershell -ExecutionPolicy Bypass -File "${tempScript}"`, {` |
| `desktop-app-vue/scripts/install-native-messaging.js` | 10 | `const { exec } = require('child_process');` |
| `desktop-app-vue/scripts/pre-release-check.js` | 10 | `const { execSync } = require("child_process");` |
| `desktop-app-vue/scripts/pre-release-check.js` | 33 | `return execSync(command, {` |
| `desktop-app-vue/scripts/release.js` | 30 | `const { execSync } = require("child_process");` |
| `desktop-app-vue/scripts/release.js` | 76 | `return execSync(command, {` |
| `desktop-app-vue/scripts/rules-validator.js` | 22 | `const { execSync } = require("child_process");` |
| `desktop-app-vue/scripts/rules-validator.js` | 590 | `pattern: /child_process\.exec\s*\(/,` |
| `desktop-app-vue/scripts/rules-validator.js` | 911 | `const auditResult = execSync("npm audit --json", {` |
| `desktop-app-vue/scripts/test-remote-e2e.js` | 7 | `const { spawn } = require('child_process');` |
| `desktop-app-vue/scripts/test-remote-e2e.js` | 34 | `const vitest = spawn('npx', ['vitest', 'run', testFile], {` |
| `desktop-app-vue/scripts/test-runner.js` | 6 | `const { spawn } = require('child_process');` |
| `desktop-app-vue/scripts/test-runner.js` | 33 | `const proc = spawn(command, args, {` |
| `desktop-app-vue/scripts/test-workflow-e2e.js` | 12 | `const { spawn } = require("child_process");` |
| `desktop-app-vue/scripts/test-workflow-e2e.js` | 50 | `const testProcess = spawn(` |
| `desktop-app-vue/scripts/verify-coding-agent-mvp.js` | 1 | `const { spawnSync } = require("child_process");` |
| `desktop-app-vue/scripts/verify-coding-agent-mvp.js` | 9 | `const result = spawnSync(command, args, {` |
| `desktop-app-vue/scripts/verify-coding-agent-parity.js` | 1 | `const { spawnSync } = require("child_process");` |
| `desktop-app-vue/scripts/verify-coding-agent-parity.js` | 247 | `const result = spawnSync(step.command, step.args, {` |
| `packages/cli/scripts/build-web-panel.mjs` | 15 | `import { execSync } from "node:child_process";` |
| `packages/cli/scripts/build-web-panel.mjs` | 192 | `execSync("npm install --legacy-peer-deps", {` |
| `packages/cli/scripts/build-web-panel.mjs` | 200 | `execSync("npm run build", {` |
| `packages/cli/scripts/gen-process-spawn-inventory.mjs` | 3 | `* Generate (or byte-diff-check) an inventory of direct child_process usage.` |
| `packages/cli/scripts/gen-process-spawn-inventory.mjs` | 35 | `/(?:child_process\|node:child_process\|\b(?:cpDefault\|childProcess\|_deps\|deps)\.(?:spawn\|spawnSync\|exec\|execFile\|execSync\|execFileSync\|fork)\b\|\b(?:spawn\|spawnSync\|execFile\|execSync\|execFileSync\|fork)\s*\()/;` |
| `packages/cli/scripts/test-coding-agent-parity.mjs` | 34 | `import { spawnSync } from "node:child_process";` |
| `packages/cli/scripts/test-coding-agent-parity.mjs` | 103 | `const r = spawnSync(cmd, args, {` |
| `packages/cli/scripts/test-runtime-convergence.mjs` | 29 | `if (!broker \|\| typeof broker.spawn !== "function") throw new Error("missing spawn()");` |
| `packages/cli/scripts/test-runtime-e2e.cjs` | 59 | `broker.spawnSync(process.execPath, ["-e", "process.stdout.write('hello from e2e test')"], {` |

## test

| File | Line | Match |
| --- | ---: | --- |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/coding-agent-bridge.test.js` | 75 | `_deps.spawn = vi.fn(() => mockProcess);` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/coding-agent-bridge.test.js` | 98 | `expect(_deps.spawn).toHaveBeenCalledTimes(1);` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/coding-agent-bridge.test.js` | 108 | `_deps.spawn.mockClear();` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/coding-agent-bridge.test.js` | 111 | `expect(_deps.spawn).not.toHaveBeenCalled();` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/sub-runtime-pool.test.js` | 81 | `originalSpawn = poolMod._deps.spawn;` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/sub-runtime-pool.test.js` | 86 | `poolMod._deps.spawn = originalSpawn;` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/sub-runtime-pool.test.js` | 92 | `poolMod._deps.spawn = (execPath, args, options) => {` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/sub-runtime-pool.test.js` | 147 | `poolMod._deps.spawn = () => {` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/sub-runtime-pool.test.js` | 170 | `poolMod._deps.spawn = () => {` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/sub-runtime-pool.test.js` | 193 | `poolMod._deps.spawn = () => createFakeChild({}).child;` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/sub-runtime-pool.test.js` | 216 | `poolMod._deps.spawn = () => {` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/sub-runtime-pool.test.js` | 231 | `poolMod._deps.spawn = () =>` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/sub-runtime-pool.test.js` | 424 | `originalSpawn = poolMod._deps.spawn;` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/sub-runtime-pool.test.js` | 429 | `poolMod._deps.spawn = originalSpawn;` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/sub-runtime-pool.test.js` | 435 | `poolMod._deps.spawn = (_execPath, _args, _options) => {` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/sub-runtime-pool.test.js` | 514 | `poolMod._deps.spawn = (_e, _a, _o) => {` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/sub-runtime-pool.test.js` | 576 | `poolMod._deps.spawn = (_e, _a, _o) => {` |
| `packages/cli/src/lib/lsp/__tests__/lsp-client.test.js` | 4 | `* is injected through `_deps.spawn`; no real language server is spawned.` |
| `packages/cli/src/lib/lsp/__tests__/lsp-client.test.js` | 59 | `origSpawn = _deps.spawn;` |
| `packages/cli/src/lib/lsp/__tests__/lsp-client.test.js` | 62 | `_deps.spawn = origSpawn;` |
| `packages/cli/src/lib/lsp/__tests__/lsp-client.test.js` | 67 | `_deps.spawn = vi.fn(() => child);` |
| `packages/cli/src/lib/lsp/__tests__/lsp-client.test.js` | 87 | `expect(_deps.spawn).toHaveBeenCalledWith(` |
| `packages/cli/src/lib/lsp/__tests__/lsp-manager.test.js` | 311 | `// Same tick, backoff disabled → immediate fresh spawn (prior behaviour).` |
