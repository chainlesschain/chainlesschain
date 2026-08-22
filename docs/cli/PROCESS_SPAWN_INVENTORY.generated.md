# Process Spawn Inventory

> Generated from child process call-site scan. Do not edit by hand.
> Regenerate with `npm run docs:spawn-inventory --workspace=packages/cli`.

Total matches: 527 (runtime: 276, tooling: 221, test: 30).
Runtime audit: brokered: 200, audited-exemption: 36, non-executable: 40, unreviewed: 0.

## Policy

- `runtime` entries must migrate to `ProcessExecutionBroker` or carry an explicit audited exemption.
- `non-executable` entries are lexical scan noise (imports, declarations, comments, types, or security regexes).
- `unreviewed` must remain zero; `docs:spawn-inventory:check` fails closed otherwise.
- `tooling` entries are allowed for repository maintenance scripts but must not be used as runtime proof.
- `test` entries are inventory noise unless they launch real runtime processes; keep them visible for drift review.

## runtime

| File | Line | Disposition | Evidence | Match |
| --- | ---: | --- | --- | --- |
| `desktop-app-vue/src/main/ai-engine/code-agent/artifact-workbench-client.js` | 52 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `this.spawn = options.spawn \|\| _deps.spawn;` |
| `desktop-app-vue/src/main/ai-engine/code-agent/artifact-workbench-client.js` | 60 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `child = this.spawn(process.execPath, [this.cliEntry, ...args], {` |
| `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-bridge.js` | 111 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `this.serverProcess = _deps.spawn(process.execPath, args, {` |
| `desktop-app-vue/src/main/ai-engine/code-agent/sub-runtime-pool.js` | 362 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const raw = _deps.spawn(process.execPath, [_deps.entryFile], {` |
| `desktop-app-vue/src/main/ipc/advanced-features-ipc.js` | 158 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const child = _deps.spawn(process.execPath, [scriptPath, ...args], {` |
| `packages/agent-sdk/src/agent-session.ts` | 24 | `non-executable` | declaration/comment/type/regex lexical match | `import { spawn as nodeSpawn, spawnSync } from "node:child_process";` |
| `packages/agent-sdk/src/agent-session.ts` | 25 | `non-executable` | declaration/comment/type/regex lexical match | `import type { ChildProcess, SpawnOptions } from "node:child_process";` |
| `packages/agent-sdk/src/agent-session.ts` | 476 | `audited-exemption` | agent-sdk-client-host: The SDK is an external client host that launches the CLI itself; it is outside the child CLI broker trust boundary and uses argv APIs without a shell. | `spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);` |
| `packages/agent-sdk/src/cli-json.ts` | 8 | `non-executable` | declaration/comment/type/regex lexical match | `import { execFile } from "node:child_process";` |
| `packages/cli/src/auth/npm-auth.js` | 14 | `brokered` | call targets ProcessExecutionBroker | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/auth/npm-auth.js` | 22 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `return _deps.execFileSync(` |
| `packages/cli/src/commands/agenda.js` | 42 | `brokered` | call targets ProcessExecutionBroker | `spawn: (...args) => executionBroker.spawn(...args),` |
| `packages/cli/src/commands/agenda.js` | 43 | `brokered` | call targets ProcessExecutionBroker | `execSync: (...args) => executionBroker.execSync(...args),` |
| `packages/cli/src/commands/agenda.js` | 44 | `brokered` | call targets ProcessExecutionBroker | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/commands/agenda.js` | 746 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const child = _processDeps.spawn(` |
| `packages/cli/src/commands/agenda.js` | 820 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `return _processDeps.execFileSync(invocation.file, invocation.args, {` |
| `packages/cli/src/commands/agenda.js` | 831 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `return _processDeps.execSync(command, {` |
| `packages/cli/src/commands/background-session.js` | 913 | `brokered` | call targets ProcessExecutionBroker | `const child = executionBroker.spawn(` |
| `packages/cli/src/commands/batch.js` | 338 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `return _processDeps.spawn(command, args, {` |
| `packages/cli/src/commands/batch.js` | 347 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `return _processDeps.execFileSync("git", args, {` |
| `packages/cli/src/commands/checkpoint-managed.js` | 338 | `brokered` | call targets ProcessExecutionBroker | `proc = broker.spawn(command, args, {` |
| `packages/cli/src/commands/config.js` | 39 | `brokered` | call targets ProcessExecutionBroker | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/commands/config.js` | 98 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `return deps.spawnSync(file, [...editorArgs, configPath], {` |
| `packages/cli/src/commands/eval.js` | 67 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `_deps.spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {` |
| `packages/cli/src/commands/eval.js` | 119 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const child = _deps.spawn(process.execPath, args, {` |
| `packages/cli/src/commands/loop.js` | 87 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const child = _deps.spawn(cmd, args, {` |
| `packages/cli/src/commands/mcp.js` | 1027 | `brokered` | call targets ProcessExecutionBroker | `executionBroker.spawnSync(command, args, {` |
| `packages/cli/src/commands/memory.js` | 57 | `brokered` | call targets ProcessExecutionBroker | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/commands/memory.js` | 63 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `return deps.execFileSync(file, [...editorArgs, filePath], {` |
| `packages/cli/src/commands/review.js` | 45 | `brokered` | call targets ProcessExecutionBroker | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/commands/review.js` | 155 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const res = _deps.spawnSync("git", args, {` |
| `packages/cli/src/commands/review.js` | 497 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const res = _deps.spawnSync("gh", args, {` |
| `packages/cli/src/commands/routine.js` | 28 | `brokered` | call targets ProcessExecutionBroker | `spawn: (...args) => executionBroker.spawn(...args),` |
| `packages/cli/src/commands/routine.js` | 29 | `brokered` | call targets ProcessExecutionBroker | `execFile: (...args) => executionBroker.execFile(...args),` |
| `packages/cli/src/commands/routine.js` | 44 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const child = _deps.spawn(` |
| `packages/cli/src/commands/routine.js` | 95 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `_deps.execFile(` |
| `packages/cli/src/commands/session.js` | 75 | `brokered` | call targets ProcessExecutionBroker | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/commands/session.js` | 195 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const out = _deps.execFileSync("gh", args, {` |
| `packages/cli/src/commands/team-distributed.js` | 851 | `brokered` | call targets ProcessExecutionBroker | `const output = executionBroker.execFileSync(` |
| `packages/cli/src/commands/team-distributed.js` | 1262 | `brokered` | call targets ProcessExecutionBroker | `executionBroker.execFileSync("git", args, {` |
| `packages/cli/src/commands/team.js` | 69 | `brokered` | call targets ProcessExecutionBroker | `spawn: (...args) => executionBroker.spawn(...args),` |
| `packages/cli/src/commands/team.js` | 937 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const child = _deps.spawn(command, [], {` |
| `packages/cli/src/commands/team.js` | 1043 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `child = _deps.spawn(process.execPath, args, {` |
| `packages/cli/src/commands/update.js` | 19 | `brokered` | call targets ProcessExecutionBroker | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/commands/update.js` | 40 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const result = _deps.spawnSync(command, args, {` |
| `packages/cli/src/gateways/ws/ws-server.js` | 124 | `brokered` | call targets ProcessExecutionBroker | `spawn: (...args) => executionBroker.spawn(...args),` |
| `packages/cli/src/gateways/ws/ws-server.js` | 254 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `this._spawnProcess = options.spawn \|\| _deps.spawn;` |
| `packages/cli/src/harness/background-task-command-runner.js` | 8 | `brokered` | call targets ProcessExecutionBroker | `execSync: (...args) => executionBroker.execSync(...args),` |
| `packages/cli/src/harness/background-task-command-runner.js` | 9 | `brokered` | call targets ProcessExecutionBroker | `execFile: (...args) => executionBroker.execFile(...args),` |
| `packages/cli/src/harness/background-task-command-runner.js` | 166 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `return _backgroundTaskCommandDeps.execSync(command, {` |
| `packages/cli/src/harness/background-task-command-runner.js` | 221 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `_backgroundTaskCommandDeps.execFile(` |
| `packages/cli/src/harness/background-task-manager.js` | 31 | `brokered` | call targets ProcessExecutionBroker | `const result = executionBroker.spawnSync(` |
| `packages/cli/src/harness/background-task-manager.js` | 366 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `child = _deps.spawn(` |
| `packages/cli/src/harness/mcp-client.js` | 2748 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const proc = _deps.spawn(config.command, config.args \|\| [], {` |
| `packages/cli/src/lazy-dispatch.js` | 773 | `non-executable` | declaration/comment/type/regex lexical match | `// The broker must patch child_process before a command graph can cache a` |
| `packages/cli/src/lib/agent-ipc-bus.js` | 183 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const child = _deps.spawn(command, args, {` |
| `packages/cli/src/lib/agent-sandbox.js` | 14 | `brokered` | call targets ProcessExecutionBroker | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/lib/agent-sandbox.js` | 383 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const result = _deps.spawnSync("docker", args, {` |
| `packages/cli/src/lib/agent-sandbox.js` | 450 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const result = _deps.spawnSync("bwrap", args, {` |
| `packages/cli/src/lib/agent-sandbox.js` | 509 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const result = deps.spawnSync(probeArgs[0], probeArgs[1], {` |
| `packages/cli/src/lib/agent-team/team-merge-review-transaction.js` | 167 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `return _deps.execFileSync(executable, hardenedArgs, {` |
| `packages/cli/src/lib/agent-team/team-worktree.js` | 167 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `child = _processDeps.spawn(command, [], {` |
| `packages/cli/src/lib/agent-team/team-worktree.js` | 279 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `return _processDeps.execFileSync("git", args, {` |
| `packages/cli/src/lib/agent-team/team-worktree.js` | 290 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const value = _processDeps.execFileSync(` |
| `packages/cli/src/lib/agent-team/team-worktree.js` | 312 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const value = _processDeps.execFileSync(` |
| `packages/cli/src/lib/agent-team/team-worktree.js` | 338 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `_processDeps.execFileSync(` |
| `packages/cli/src/lib/agent-team/team-worktree.js` | 365 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const value = _processDeps.execFileSync("git", args, {` |
| `packages/cli/src/lib/agent-worktree.js` | 27 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const run = deps.execFileSync \|\| _deps.execFileSync;` |
| `packages/cli/src/lib/api-key-helper.js` | 37 | `brokered` | call targets ProcessExecutionBroker | `executionBroker.execSync(command, {` |
| `packages/cli/src/lib/background-agent-supervisor.js` | 269 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `return _deps.spawnSync(file, args, {` |
| `packages/cli/src/lib/background-agent-supervisor.js` | 2811 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `child = _deps.spawn(process.execPath, [worker, jobFile], {` |
| `packages/cli/src/lib/background-agent-supervisor.js` | 2825 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `keeperChild = _deps.spawn(process.execPath, [keeper, keeperJobFile], {` |
| `packages/cli/src/lib/background-interaction-resolver.js` | 284 | `non-executable` | declaration/comment/type/regex lexical match | `* @param {import("node:child_process").ChildProcess\|object} child` |
| `packages/cli/src/lib/checkpoint-store.js` | 33 | `brokered` | call targets ProcessExecutionBroker | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/lib/checkpoint-store.js` | 185 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const res = _deps.spawnSync("git", args, {` |
| `packages/cli/src/lib/chrome-connector.js` | 383 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const child = deps.spawn(executable, args, {` |
| `packages/cli/src/lib/claude-code-bridge.js` | 44 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `.execSync(`${command} --version`, {` |
| `packages/cli/src/lib/claude-code-bridge.js` | 163 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const proc = _deps.spawn(this.cliCommand, args, {` |
| `packages/cli/src/lib/cli-anything-bridge.js` | 24 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `return _deps.execFileSync(file, args, {` |
| `packages/cli/src/lib/cloud/bundle.js` | 17 | `brokered` | call targets ProcessExecutionBroker | `return executionBroker.execFileSync(file, args, {` |
| `packages/cli/src/lib/cloud/bundle.js` | 30 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `.execFileSync("git", args, {` |
| `packages/cli/src/lib/code-agent.js` | 227 | `non-executable` | declaration/comment/type/regex lexical match | `/child_process.*exec\s*\(\s*[`"'].*\$\{/,` |
| `packages/cli/src/lib/code-review.js` | 11 | `brokered` | call targets ProcessExecutionBroker | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/lib/code-review.js` | 29 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `return _deps.execFileSync("git", buildGitDiffArgs(target, options), {` |
| `packages/cli/src/lib/command-lifecycle-report.js` | 249 | `brokered` | call targets ProcessExecutionBroker | `return executionBroker.spawnSync("git", args, {` |
| `packages/cli/src/lib/computer-use/control-backend.js` | 13 | `brokered` | call targets ProcessExecutionBroker | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/lib/computer-use/control-backend.js` | 19 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const res = deps.spawnSync(` |
| `packages/cli/src/lib/computer-use/control-backend.js` | 150 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const res = deps.spawnSync(app, args, {` |
| `packages/cli/src/lib/delivery-production-adapter.js` | 83 | `brokered` | call targets ProcessExecutionBroker | `return executionBroker.spawnSync(file, args, options);` |
| `packages/cli/src/lib/doctor-checkup.js` | 67 | `brokered` | call targets ProcessExecutionBroker | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/lib/doctor-checkup.js` | 68 | `brokered` | call targets ProcessExecutionBroker | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/lib/doctor-checkup.js` | 168 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `spawnSync: deps.spawnSync,` |
| `packages/cli/src/lib/doctor-checkup.js` | 744 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `deps.execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {` |
| `packages/cli/src/lib/doctor-checkup.js` | 769 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `deps.execFileSync("git", ["worktree", "prune", "--dry-run", "-v"], {` |
| `packages/cli/src/lib/doctor-checkup.js` | 1042 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `spawnSync: deps.spawnSync,` |
| `packages/cli/src/lib/doctor-checkup.js` | 1345 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `deps.execFileSync("git", ["worktree", "prune"], {` |
| `packages/cli/src/lib/downloader.js` | 18 | `brokered` | call targets ProcessExecutionBroker | `return executionBroker.execFileSync(file, args, options);` |
| `packages/cli/src/lib/ensure-utf8.js` | 15 | `brokered` | call targets ProcessExecutionBroker | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/lib/ensure-utf8.js` | 39 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `_deps.execFileSync("cmd.exe", ["/d", "/s", "/c", "chcp 65001"], {` |
| `packages/cli/src/lib/eval/tasks.js` | 17 | `brokered` | call targets ProcessExecutionBroker | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/lib/eval/tasks.js` | 21 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `return _deps.execFileSync(process.execPath, [script], {` |
| `packages/cli/src/lib/execution-backend.js` | 18 | `brokered` | call targets ProcessExecutionBroker | `execSync: (...args) => executionBroker.execSync(...args),` |
| `packages/cli/src/lib/execution-backend.js` | 19 | `brokered` | call targets ProcessExecutionBroker | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/lib/execution-backend.js` | 23 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const result = _deps.spawnSync(command, args, options);` |
| `packages/cli/src/lib/execution-backend.js` | 82 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const stdout = _deps.execSync(command, {` |
| `packages/cli/src/lib/execution-location-local-supervisor.mjs` | 4 | `non-executable` | declaration/comment/type/regex lexical match | `import { spawn } from "node:child_process";` |
| `packages/cli/src/lib/execution-location-local-supervisor.mjs` | 67 | `audited-exemption` | execution-location-local-supervisor: The target-side resource supervisor must launch the already-resolved Node executable directly and cannot recursively route through its parent broker; it uses shell:false, a fixed CLI entry and governed command argv, plus bounded heap and CPU budgets. | `const child = spawn(` |
| `packages/cli/src/lib/execution-location-result-apply.js` | 29 | `brokered` | call targets ProcessExecutionBroker | `const result = broker.spawnSync("git", args, {` |
| `packages/cli/src/lib/execution-location-target.js` | 825 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `deps.spawnSync \|\|` |
| `packages/cli/src/lib/execution-location-target.js` | 827 | `brokered` | call targets ProcessExecutionBroker | `executionBroker.spawnSync(file, args, spawnOptions));` |
| `packages/cli/src/lib/execution-location-target.js` | 837 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const result = spawnSync(invocation.file, invocation.args, {` |
| `packages/cli/src/lib/execution-location-target.js` | 1001 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `deps.spawnSync \|\|` |
| `packages/cli/src/lib/execution-location-target.js` | 1003 | `brokered` | call targets ProcessExecutionBroker | `executionBroker.spawnSync(file, args, spawnOptions));` |
| `packages/cli/src/lib/execution-location-target.js` | 1006 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `result = spawnSync(invocation.file, invocation.args, {` |
| `packages/cli/src/lib/git-integration.js` | 10 | `brokered` | call targets ProcessExecutionBroker | `execSync: (...args) => executionBroker.execSync(...args),` |
| `packages/cli/src/lib/git-integration.js` | 11 | `brokered` | call targets ProcessExecutionBroker | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/lib/git-integration.js` | 88 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const res = _deps.spawnSync("git", args, {` |
| `packages/cli/src/lib/git-integration.js` | 114 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `return _deps.execSync(`git ${args}`, {` |
| `packages/cli/src/lib/git-integration.js` | 153 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const output = _deps.execSync("git status --porcelain", {` |
| `packages/cli/src/lib/goal-condition-engine.js` | 194 | `non-executable` | declaration/comment/type/regex lexical match | `const spawnSync = deps.spawnSync;` |
| `packages/cli/src/lib/goal-condition-engine.js` | 202 | `brokered` | goal-check-injected-runner: exit-zero evaluation has no ambient process fallback and fails closed unless its caller injects the broker-backed runner. | `const res = spawnSync(condition.command, {` |
| `packages/cli/src/lib/hook-manager.js` | 300 | `brokered` | call targets ProcessExecutionBroker | `const output = broker.execSync(cmd, {` |
| `packages/cli/src/lib/hooks-v2-runtime.js` | 863 | `brokered` | call targets ProcessExecutionBroker | `const child = await this.executionBroker.spawn(` |
| `packages/cli/src/lib/host-adb-bridge.js` | 37 | `brokered` | call targets ProcessExecutionBroker | `execFile: (...args) => executionBroker.execFile(...args),` |
| `packages/cli/src/lib/host-adb-bridge.js` | 42 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `_deps.execFile(file, args, options, (error, stdout, stderr) => {` |
| `packages/cli/src/lib/lan-pairing-preflight.js` | 28 | `brokered` | call targets ProcessExecutionBroker | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/lib/lan-pairing-preflight.js` | 320 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `_deps.execFileSync(probe, [cmd], {` |
| `packages/cli/src/lib/lsp/benchmark.js` | 21 | `brokered` | call targets ProcessExecutionBroker | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/lib/lsp/benchmark.js` | 174 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `{ execFileSync = _deps.execFileSync, platform = process.platform } = {},` |
| `packages/cli/src/lib/lsp/benchmark.js` | 179 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const csv = execFileSync(` |
| `packages/cli/src/lib/lsp/benchmark.js` | 201 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const out = execFileSync("ps", ["-o", "pid=,ppid=,rss="], {` |
| `packages/cli/src/lib/lsp/lsp-client.js` | 11 | `non-executable` | declaration/comment/type/regex lexical match | `* Testability: all process spawning goes through `_deps.spawn` so tests inject a` |
| `packages/cli/src/lib/lsp/lsp-client.js` | 12 | `non-executable` | declaration/comment/type/regex lexical match | `* fake stdio pair (see cli-dev.md `_deps` pattern — `vi.mock("child_process")`` |
| `packages/cli/src/lib/lsp/lsp-client.js` | 25 | `brokered` | call targets ProcessExecutionBroker | `spawn: (...args) => executionBroker.spawn(...args),` |
| `packages/cli/src/lib/lsp/lsp-client.js` | 85 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `: _deps.spawn;` |
| `packages/cli/src/lib/mcp-headers-helper.js` | 436 | `brokered` | call targets ProcessExecutionBroker | `deps.spawnSync \|\| executionBroker.spawnSync.bind(executionBroker);` |
| `packages/cli/src/lib/mcp-headers-helper.js` | 454 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {` |
| `packages/cli/src/lib/mcp-headers-helper.js` | 515 | `brokered` | call targets ProcessExecutionBroker | `const spawn = deps.spawn \|\| executionBroker.spawn.bind(executionBroker);` |
| `packages/cli/src/lib/mcp-headers-helper.js` | 590 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `child = spawn(invocation.file, invocation.argv, {` |
| `packages/cli/src/lib/mcp-oauth.js` | 39 | `brokered` | call targets ProcessExecutionBroker | `executionBroker.spawn(command, args, {` |
| `packages/cli/src/lib/mcp-oauth.js` | 825 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const child = _deps.spawn(cmd, args, { stdio: "ignore", detached: true });` |
| `packages/cli/src/lib/mcp-stdio-package-materialization.js` | 81 | `audited-exemption` | mcp-static-execution-context-builtin: This exact marked line is a static builtin-policy name inside CAPSULE_EXECUTION_CONTEXT_BUILTINS, not a module load or process call; execution-context capsules remain bound to the mandatory Process Broker OS sandbox contract. | `"child_process", // spawn-inventory-audit: static-execution-context-builtin` |
| `packages/cli/src/lib/orchestrator.js` | 34 | `brokered` | call targets ProcessExecutionBroker | `execSync: (...args) => executionBroker.execSync(...args),` |
| `packages/cli/src/lib/orchestrator.js` | 384 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const output = _deps.execSync(this.ciCommand, {` |
| `packages/cli/src/lib/packer/native-prebuild-collector.js` | 257 | `non-executable` | declaration/comment/type/regex lexical match | `// Generic fallback — a native fork (e.g. better-sqlite3-multiple-ciphers)` |
| `packages/cli/src/lib/packer/native-update-state.js` | 5 | `non-executable` | declaration/comment/type/regex lexical match | `import { spawn } from "node:child_process";` |
| `packages/cli/src/lib/packer/pack-update-applier.js` | 19 | `non-executable` | declaration/comment/type/regex lexical match | `import { spawn as nativeSpawn } from "node:child_process";` |
| `packages/cli/src/lib/packer/pack-update-applier.js` | 45 | `brokered` | call targets ProcessExecutionBroker | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/lib/packer/pack-update-applier.js` | 65 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `spawnImpl = _deps.spawn,` |
| `packages/cli/src/lib/packer/pack-update-applier.js` | 67 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `verifyImpl = _deps.spawnSync,` |
| `packages/cli/src/lib/packer/pack-update-applier.js` | 1871 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `spawnImpl = _deps.spawn,` |
| `packages/cli/src/lib/packer/pack-update-applier.js` | 1872 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `verifyImpl = _deps.spawnSync,` |
| `packages/cli/src/lib/packer/pkg-runner.js` | 21 | `brokered` | call targets ProcessExecutionBroker | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/lib/packer/pkg-runner.js` | 54 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const res = _deps.spawnSync(pkgBin.runtime, args, {` |
| `packages/cli/src/lib/packer/precheck.js` | 13 | `brokered` | call targets ProcessExecutionBroker | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/lib/packer/precheck.js` | 157 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `.execFileSync(` |
| `packages/cli/src/lib/packer/precheck.js` | 164 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `.execFileSync(` |
| `packages/cli/src/lib/packer/precheck.js` | 170 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const status = _deps.execFileSync(` |
| `packages/cli/src/lib/packer/smoke-runner.js` | 29 | `brokered` | call targets ProcessExecutionBroker | `spawn: (...args) => executionBroker.spawn(...args),` |
| `packages/cli/src/lib/packer/smoke-runner.js` | 87 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const child = _deps.spawn(exePath, ["ui", "--no-open"], {` |
| `packages/cli/src/lib/packer/smoke-runner.js` | 127 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `.spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], {` |
| `packages/cli/src/lib/packer/web-panel-builder.js` | 17 | `brokered` | call targets ProcessExecutionBroker | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/lib/packer/web-panel-builder.js` | 60 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const res = _deps.spawnSync(npmCmd, ["run", "build:web-panel"], {` |
| `packages/cli/src/lib/plugin-ecosystem.js` | 114 | `non-executable` | declaration/comment/type/regex lexical match | `/require\(\s*['"]child_process['"]\s*\)\|from\s+['"]child_process['"]/g,` |
| `packages/cli/src/lib/plugin-ecosystem.js` | 116 | `non-executable` | declaration/comment/type/regex lexical match | `message: "child_process import — review command usage",` |
| `packages/cli/src/lib/plugin-monitor-supervisor.js` | 31 | `brokered` | call targets ProcessExecutionBroker | `spawn: (...args) => executionBroker.spawn(...args),` |
| `packages/cli/src/lib/plugin-monitor-supervisor.js` | 44 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `this._spawn = opts.spawn \|\| _deps.spawn;` |
| `packages/cli/src/lib/plugin-runtime/install.js` | 118 | `brokered` | call targets ProcessExecutionBroker | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/lib/plugin-runtime/install.js` | 1977 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `return _deps.spawnSync(executable, hardenedArgs, {` |
| `packages/cli/src/lib/pr-create.js` | 11 | `brokered` | call targets ProcessExecutionBroker | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/lib/pr-create.js` | 15 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `return _deps.execFileSync("git", args, {` |
| `packages/cli/src/lib/pr-link-ledger.js` | 30 | `brokered` | call targets ProcessExecutionBroker | `execFile: (...args) => executionBroker.execFile(...args),` |
| `packages/cli/src/lib/pr-link-ledger.js` | 134 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `_deps.execFile(` |
| `packages/cli/src/lib/process-execution-broker/credential-transport-worker.js` | 5 | `non-executable` | declaration/comment/type/regex lexical match | `* answer a child while the broker's main thread is blocked in spawnSync().` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 15 | `non-executable` | declaration/comment/type/regex lexical match | `// 直接导入原生child_process，避免递归` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 24 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `} from "node:child_process";` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 4340 | `non-executable` | declaration/comment/type/regex lexical match | `spawn(command, args, options = {}) {` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 4616 | `non-executable` | declaration/comment/type/regex lexical match | `// child_process.spawn() has synchronously duplicated every stdio entry` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 4707 | `non-executable` | declaration/comment/type/regex lexical match | `spawnSync(command, args, options = {}) {` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 4923 | `non-executable` | declaration/comment/type/regex lexical match | `* boundary as child_process execution. Policy-free sessions retain native` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 4925 | `non-executable` | declaration/comment/type/regex lexical match | `* allocate a dedicated terminal; child_process then duplicates its slave` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 5045 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `const proc = ptyModule.spawn(command, filteredArgs, spawnOptions);` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 5238 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `return this.spawn(invocation.command, invocation.args, {` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 5244 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `return this.spawn(command, [], {` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 5251 | `non-executable` | declaration/comment/type/regex lexical match | `execSync(command, options = {}) {` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 5256 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `const result = this.spawnSync(invocation.command, invocation.args, {` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 5278 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `const result = this.spawnSync(command, [], spawnOpts);` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 5292 | `non-executable` | declaration/comment/type/regex lexical match | `execFile(file, args, options, callback) {` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 5307 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `const proc = this.spawn(file, args, options);` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 5385 | `non-executable` | declaration/comment/type/regex lexical match | `execFileSync(file, args, options = {}) {` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 5390 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `const result = this.spawnSync(file, args, options);` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 5405 | `non-executable` | declaration/comment/type/regex lexical match | `fork(modulePath, args, options = {}) {` |
| `packages/cli/src/lib/process-execution-broker/index.js` | 5406 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `return this.spawn(process.execPath, [modulePath, ...(args \|\| [])], {` |
| `packages/cli/src/lib/process-execution-broker/linux-generic-bwrap-runtime.js` | 13 | `non-executable` | declaration/comment/type/regex lexical match | `import { spawnSync as nativeSpawnSync } from "node:child_process";` |
| `packages/cli/src/lib/process-execution-broker/linux-generic-bwrap-runtime.js` | 674 | `non-executable` | declaration/comment/type/regex lexical match | `// Continue PATH resolution exactly as child_process would.` |
| `packages/cli/src/lib/process-execution-broker/linux-generic-bwrap-runtime.js` | 891 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `return runtime.spawnSync(launch.command, launch.args, {` |
| `packages/cli/src/lib/process-execution-broker/linux-generic-bwrap-runtime.js` | 1465 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `const result = runtime.spawnSync(` |
| `packages/cli/src/lib/process-execution-broker/patch-child-process.js` | 2 | `non-executable` | declaration/comment/type/regex lexical match | `* Monkey-patch node:child_process to route ALL spawn/exec calls through ExecutionBroker (M1)` |
| `packages/cli/src/lib/process-execution-broker/patch-child-process.js` | 10 | `non-executable` | declaration/comment/type/regex lexical match | `// Get the REAL native child_process module (unpatched, from Node.js internals)` |
| `packages/cli/src/lib/process-execution-broker/patch-child-process.js` | 11 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `const nativeCp = require("node:child_process");` |
| `packages/cli/src/lib/process-execution-broker/patch-child-process.js` | 16 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `return executionBroker.spawn(command, args, options);` |
| `packages/cli/src/lib/process-execution-broker/patch-child-process.js` | 20 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `return executionBroker.spawnSync(command, args, options);` |
| `packages/cli/src/lib/process-execution-broker/patch-child-process.js` | 28 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `return executionBroker.execSync(command, options);` |
| `packages/cli/src/lib/process-execution-broker/patch-child-process.js` | 32 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `return executionBroker.execFile(file, args, options, callback);` |
| `packages/cli/src/lib/process-execution-broker/patch-child-process.js` | 36 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `return executionBroker.execFileSync(file, args, options);` |
| `packages/cli/src/lib/process-execution-broker/patch-child-process.js` | 40 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `return executionBroker.fork(modulePath, args, options);` |
| `packages/cli/src/lib/process-execution-broker/patch-child-process.js` | 43 | `non-executable` | declaration/comment/type/regex lexical match | `// Also patch child_process for CommonJS require` |
| `packages/cli/src/lib/process-execution-broker/patch-child-process.js` | 44 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `const cpModule = require.cache[require.resolve("node:child_process")];` |
| `packages/cli/src/lib/process-execution-broker/platform-sandbox.js` | 30 | `non-executable` | declaration/comment/type/regex lexical match | `import { spawnSync as nativeSpawnSync } from "node:child_process";` |
| `packages/cli/src/lib/process-execution-broker/platform-sandbox.js` | 795 | `non-executable` | declaration/comment/type/regex lexical match | `* A native `spawn(..., { shell: true })` asks Node to execute one command` |
| `packages/cli/src/lib/process-execution-broker/platform-sandbox.js` | 891 | `non-executable` | declaration/comment/type/regex lexical match | `* synchronous. ProcessExecutionBroker.spawn() is synchronous, so strict mode` |
| `packages/cli/src/lib/process-execution-broker/platform-sandbox.js` | 1130 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `const result = runtime.spawnSync(command, args, {` |
| `packages/cli/src/lib/process-execution-broker/platform-sandbox.js` | 3363 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `probeResult = runtime.spawnSync(` |
| `packages/cli/src/lib/process-execution-broker/platform-sandbox.js` | 3507 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `result = runtime.spawnSync(invocation.command, invocation.args, {` |
| `packages/cli/src/lib/process-execution-broker/platform-sandbox.js` | 3844 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `const result = adapter.spawnSync(helperArgs, {` |
| `packages/cli/src/lib/process-execution-broker/platform-sandbox.js` | 4552 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `probeResult = adapter.spawnSync(` |
| `packages/cli/src/lib/process-execution-broker/platform-sandbox.js` | 4580 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `readinessResult = adapter.spawnSync(readinessArgs, {` |
| `packages/cli/src/lib/process-execution-broker/platform-sandbox.js` | 7893 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `result = runtime.spawnSync(invocation.command, invocation.args, {` |
| `packages/cli/src/lib/process-execution-broker/platform-sandbox.js` | 8015 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `result = runtime.spawnSync(LINUX_LDD_PATH, ["/proc/self/fd/3"], {` |
| `packages/cli/src/lib/process-execution-broker/platform-sandbox.js` | 8612 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `'const { spawnSync } = require("node:child_process");',` |
| `packages/cli/src/lib/process-execution-broker/platform-sandbox.js` | 8638 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `` const child = spawnSync("/opt/chainless/runtime/node", ["-e", ${JSON.stringify(` |
| `packages/cli/src/lib/process-execution-broker/platform-sandbox.js` | 8695 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `result = runtime.spawnSync(invocation.command, invocation.args, {` |
| `packages/cli/src/lib/process-execution-broker/platform-sandbox.js` | 8810 | `audited-exemption` | broker-native-boundary: The broker core is the sole trusted native child_process boundary; recursive self-routing is impossible. | `result = runtime.spawnSync(invocation.command, invocation.args, {` |
| `packages/cli/src/lib/process-manager.js` | 15 | `brokered` | call targets ProcessExecutionBroker | `spawn: (...args) => executionBroker.spawn(...args),` |
| `packages/cli/src/lib/process-manager.js` | 16 | `brokered` | call targets ProcessExecutionBroker | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/lib/process-manager.js` | 52 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const child = _deps.spawn(appPath, args, {` |
| `packages/cli/src/lib/process-manager.js` | 102 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `_deps.execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {` |
| `packages/cli/src/lib/process-tree-termination.js` | 75 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const result = spawnSync("taskkill", args, {` |
| `packages/cli/src/lib/publish-workspace.js` | 13 | `brokered` | call targets ProcessExecutionBroker | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/lib/publish-workspace.js` | 71 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `_deps.execFileSync("npm", args, {` |
| `packages/cli/src/lib/repl-bang-memorize.js` | 36 | `brokered` | call targets ProcessExecutionBroker | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/lib/repl-bang-memorize.js` | 115 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const spawnSync = opts.deps?.spawnSync \|\| _deps.spawnSync;` |
| `packages/cli/src/lib/repl-bang-memorize.js` | 132 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `? spawnSync(` |
| `packages/cli/src/lib/repl-bang-memorize.js` | 147 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `: spawnSync("/bin/sh", ["-c", cmd], {` |
| `packages/cli/src/lib/repl-goal.js` | 130 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `spawnSync: deps.spawnSync \|\| runReplGoalCommand,` |
| `packages/cli/src/lib/search-command.js` | 5 | `non-executable` | declaration/comment/type/regex lexical match | `* The pattern flows into execSync (a real shell), so a raw interpolation` |
| `packages/cli/src/lib/secret-store.js` | 50 | `brokered` | call targets ProcessExecutionBroker | `const result = executionBroker.spawnSync(file, args, {` |
| `packages/cli/src/lib/secure-fs.js` | 3 | `non-executable` | declaration/comment/type/regex lexical match | `import { spawnSync } from "node:child_process";` |
| `packages/cli/src/lib/secure-fs.js` | 620 | `audited-exemption` | secure-fs-windows-acl-boundary: Owner-only Windows storage must be established below paths/config and therefore cannot import the broker without a bootstrap cycle; the boundary invokes only a fixed PowerShell ACL program, disables profiles and interactivity, hides the window, bounds runtime, and passes single targets as literal argv or batches as UTF-8 JSON over stdin. | `const result = deps.spawnSync(` |
| `packages/cli/src/lib/secure-fs.js` | 659 | `audited-exemption` | secure-fs-windows-acl-boundary: Owner-only Windows storage must be established below paths/config and therefore cannot import the broker without a bootstrap cycle; the boundary invokes only a fixed PowerShell ACL program, disables profiles and interactivity, hides the window, bounds runtime, and passes single targets as literal argv or batches as UTF-8 JSON over stdin. | `const result = deps.spawnSync(` |
| `packages/cli/src/lib/service-manager.js` | 10 | `brokered` | call targets ProcessExecutionBroker | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/lib/service-manager.js` | 11 | `brokered` | call targets ProcessExecutionBroker | `spawn: (...args) => executionBroker.spawn(...args),` |
| `packages/cli/src/lib/service-manager.js` | 15 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `return _deps.execFileSync(command, args, {` |
| `packages/cli/src/lib/service-manager.js` | 112 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const child = _deps.spawn(` |
| `packages/cli/src/lib/slash-commands.js` | 32 | `brokered` | call targets ProcessExecutionBroker | `execSync: (...args) => executionBroker.execSync(...args),` |
| `packages/cli/src/lib/slash-commands.js` | 204 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const out = execSync(cmd, {` |
| `packages/cli/src/lib/slash-commands.js` | 239 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const execSync = opts.deps?.execSync \|\| _deps.execSync;` |
| `packages/cli/src/lib/turn-context.js` | 18 | `brokered` | call targets ProcessExecutionBroker | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/lib/turn-context.js` | 30 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `.execFileSync("git", args, {` |
| `packages/cli/src/lib/update-notice.js` | 22 | `brokered` | call targets ProcessExecutionBroker | `spawn: (...args) => executionBroker.spawn(...args),` |
| `packages/cli/src/lib/update-notice.js` | 94 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const child = deps.spawn(process.execPath, [refresher, cachePath(deps)], {` |
| `packages/cli/src/repl/clipboard-copy.js` | 82 | `brokered` | call targets ProcessExecutionBroker | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/repl/clipboard-copy.js` | 91 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const spawn = spawnSync \|\| _deps.spawnSync;` |
| `packages/cli/src/repl/clipboard-copy.js` | 97 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `res = spawn(cmd, args, {` |
| `packages/cli/src/repl/clipboard-image.js` | 256 | `brokered` | call targets ProcessExecutionBroker | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/repl/clipboard-image.js` | 482 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `return deps.spawnSync(candidate.cmd, candidate.args, {` |
| `packages/cli/src/repl/clipboard-image.js` | 579 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `const readResult = deps.spawnSync(` |
| `packages/cli/src/repl/pr-comments.js` | 15 | `brokered` | call targets ProcessExecutionBroker | `execFile: (...args) => executionBroker.execFile(...args),` |
| `packages/cli/src/repl/pr-comments.js` | 21 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `deps.execFile(` |
| `packages/cli/src/repl/prompt-editor.js` | 104 | `brokered` | call targets ProcessExecutionBroker | `spawnSync: (...args) => executionBroker.spawnSync(...args),` |
| `packages/cli/src/repl/prompt-editor.js` | 151 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `result = deps.spawnSync(executable, [...editorArgs, filePath], {` |
| `packages/cli/src/runtime/agent-core.js` | 6437 | `non-executable` | declaration/comment/type/regex lexical match | `// is the historical spawn(command, {shell:true}) byte-for-byte.` |
| `packages/cli/src/runtime/agent-core.js` | 6455 | `brokered` | call targets ProcessExecutionBroker | `child = broker.spawn(` |
| `packages/cli/src/runtime/agent-core.js` | 6471 | `brokered` | call targets ProcessExecutionBroker | `? broker.spawn(args.command, [], brokerOpts)` |
| `packages/cli/src/runtime/agent-core.js` | 6472 | `brokered` | call targets ProcessExecutionBroker | `: broker.spawn(shellInv.file, shellInv.argv, brokerOpts);` |
| `packages/cli/src/runtime/agent-core.js` | 6697 | `brokered` | call targets ProcessExecutionBroker | `const res = broker.spawnSync(` |
| `packages/cli/src/runtime/agent-core.js` | 6723 | `brokered` | call targets ProcessExecutionBroker | `output = broker.execSync(args.command, brokerExecOpts);` |
| `packages/cli/src/runtime/agent-core.js` | 6729 | `brokered` | call targets ProcessExecutionBroker | `const res = broker.spawnSync(shellInv.file, shellInv.argv, {` |
| `packages/cli/src/runtime/agent-core.js` | 6854 | `non-executable` | declaration/comment/type/regex lexical match | `// cannot inject a second command. Previously execSync(`git ${cmd}`) ran` |
| `packages/cli/src/runtime/agent-core.js` | 9782 | `non-executable` | declaration/comment/type/regex lexical match | `// fully-defaulted spawn (→ "default") touches neither tools nor confirmer nor gate.` |
| `packages/cli/src/runtime/agent-core.js` | 9834 | `non-executable` | declaration/comment/type/regex lexical match | `// sub-agent runs, so a policy hook can VETO the spawn (`block`) or INJECT` |
| `packages/cli/src/runtime/diagnostics.js` | 84 | `brokered` | call targets ProcessExecutionBroker | `execFileSync: (...args) => executionBroker.execFileSync(...args),` |
| `packages/cli/src/runtime/diagnostics.js` | 90 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `deps.execFileSync(file, args, {` |
| `packages/cli/src/skills/video-editing/media-process.js` | 4 | `brokered` | call targets ProcessExecutionBroker | `spawn: (...args) => executionBroker.spawn(...args),` |
| `packages/cli/src/skills/video-editing/media-process.js` | 13 | `brokered` | file default process seam is wired to ProcessExecutionBroker | `return _deps.spawn(file, args, {` |
| `packages/cli/src/workers/background-agent-worker.js` | 1011 | `brokered` | call targets ProcessExecutionBroker | `executionBroker.spawn(` |

## tooling

| File | Line | Match |
| --- | ---: | --- |
| `desktop-app-vue/scripts/aggressive-lint-fix.js` | 14 | `const { execSync } = require("child_process");` |
| `desktop-app-vue/scripts/aggressive-lint-fix.js` | 195 | `execSync("npm run lint", {` |
| `desktop-app-vue/scripts/benchmark-mcp.js` | 22 | `const { spawn } = require("child_process");` |
| `desktop-app-vue/scripts/build-win-with-deref.js` | 48 | `const { spawnSync } = require("child_process");` |
| `desktop-app-vue/scripts/build-win-with-deref.js` | 278 | `const result = spawnSync(process.execPath, [ebCli, ...ebArgs], {` |
| `desktop-app-vue/scripts/ci-performance-monitor.js` | 15 | `const { execSync } = require("child_process");` |
| `desktop-app-vue/scripts/ci-performance-monitor.js` | 31 | `const output = execSync(command, {` |
| `desktop-app-vue/scripts/conservative-lint-fix.js` | 15 | `const { execSync } = require("child_process");` |
| `desktop-app-vue/scripts/conservative-lint-fix.js` | 185 | `const result = execSync("npm run lint 2>&1", {` |
| `desktop-app-vue/scripts/cowork-ci-test-selector.js` | 4 | `const { spawnSync } = require("child_process");` |
| `desktop-app-vue/scripts/cowork-ci-test-selector.js` | 116 | `const result = spawn(` |
| `desktop-app-vue/scripts/cowork-ci-test-selector.js` | 668 | `const result = spawn(command.executable, command.args, {` |
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
| `desktop-app-vue/scripts/test-runner.js` | 48 | `const proc = this.spawn(command, args, {` |
| `desktop-app-vue/scripts/test-workflow-e2e.js` | 12 | `const { spawn } = require("child_process");` |
| `desktop-app-vue/scripts/test-workflow-e2e.js` | 50 | `const testProcess = spawn(` |
| `desktop-app-vue/scripts/verify-coding-agent-parity.js` | 1 | `const { spawnSync } = require("child_process");` |
| `desktop-app-vue/scripts/verify-coding-agent-parity.js` | 247 | `const result = spawnSync(step.command, step.args, {` |
| `packages/cli/scripts/ax-transcript-audit-fragment.mjs` | 5 | `import { execFileSync } from "node:child_process";` |
| `packages/cli/scripts/ax-transcript-audit-fragment.mjs` | 131 | `return execFileSync(` |
| `packages/cli/scripts/ax-transcript-audit-fragment.mjs` | 151 | `execFileSync(` |
| `packages/cli/scripts/background-agent-keeper-soak.mjs` | 14 | `import { spawnSync } from "node:child_process";` |
| `packages/cli/scripts/background-agent-keeper-soak.mjs` | 309 | `const result = spawnSync("git", args, {` |
| `packages/cli/scripts/background-agent-keeper-soak.mjs` | 355 | `'import { spawn } from "node:child_process";',` |
| `packages/cli/scripts/background-agent-keeper-soak.mjs` | 367 | `'const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {',` |
| `packages/cli/scripts/build-web-panel.mjs` | 15 | `import { execFileSync, execSync } from "node:child_process";` |
| `packages/cli/scripts/build-web-panel.mjs` | 200 | `execSync("npm ci --include=dev --include=optional --legacy-peer-deps", {` |
| `packages/cli/scripts/build-web-panel.mjs` | 211 | `execFileSync(` |
| `packages/cli/scripts/build-web-panel.mjs` | 227 | `execSync("npm run build:no-sync", {` |
| `packages/cli/scripts/check-cli-startup.mjs` | 3 | `import { spawnSync } from "node:child_process";` |
| `packages/cli/scripts/check-cli-startup.mjs` | 64 | `const result = spawnSync(process.execPath, [bin, ...entry.args], {` |
| `packages/cli/scripts/claude-code-increment-audit.mjs` | 4 | `import { execFileSync } from "node:child_process";` |
| `packages/cli/scripts/claude-code-increment-audit.mjs` | 516 | `return execFileSync("git", ["rev-parse", "HEAD"], {` |
| `packages/cli/scripts/claude-code-increment-audit.mjs` | 540 | `objectType = execFileSync("git", ["cat-file", "-t", objectName], {` |
| `packages/cli/scripts/claude-code-increment-audit.mjs` | 554 | `return execFileSync("git", ["cat-file", "blob", objectName], {` |
| `packages/cli/scripts/cli-mcp-security-soak.mjs` | 4 | `import { execFileSync, spawnSync } from "node:child_process";` |
| `packages/cli/scripts/cli-mcp-security-soak.mjs` | 200 | `execFileSync("git", ["rev-parse", "HEAD"], {` |
| `packages/cli/scripts/cli-mcp-security-soak.mjs` | 208 | `return execFileSync(` |
| `packages/cli/scripts/cli-mcp-security-soak.mjs` | 847 | `const result = spawnSync(` |
| `packages/cli/scripts/cli-reliability-soak.mjs` | 13 | `import { spawn, spawnSync } from "node:child_process";` |
| `packages/cli/scripts/cli-reliability-soak.mjs` | 282 | `const result = spawnSync("git", ["rev-parse", "HEAD"], {` |
| `packages/cli/scripts/cli-reliability-soak.mjs` | 292 | `const result = spawnSync(` |
| `packages/cli/scripts/cli-reliability-soak.mjs` | 482 | `spawn(process.execPath, args, {` |
| `packages/cli/scripts/cli-reliability-soak.mjs` | 536 | `const probe = spawnSync(` |
| `packages/cli/scripts/cli-reliability-soak.mjs` | 1436 | `const terminal = pty.spawn(` |
| `packages/cli/scripts/cli-reliability-soak.mjs` | 1476 | `const screenReaderTerminal = pty.spawn(` |
| `packages/cli/scripts/cli-reliability-soak.mjs` | 1593 | `const probe = pty.spawn(` |
| `packages/cli/scripts/cli-reliability-soak.mjs` | 1702 | `? spawnSync(` |
| `packages/cli/scripts/cli-reliability-soak.mjs` | 1715 | `: spawnSync("pbpaste", [], {` |
| `packages/cli/scripts/cli-reliability-soak.mjs` | 1760 | `const probe = spawnSync(` |
| `packages/cli/scripts/cli-reliability-soak.mjs` | 1787 | `spawn(` |
| `packages/cli/scripts/cli-reliability-soak.mjs` | 1838 | `spawn(` |
| `packages/cli/scripts/cli-reliability-soak.mjs` | 1881 | `spawnSync(` |
| `packages/cli/scripts/clipboard-image-host-smoke.mjs` | 313 | `const result = executionBroker.spawnSync(command, args, {` |
| `packages/cli/scripts/clipboard-image-host-smoke.mjs` | 486 | `spawn = (...args) => executionBroker.spawn(...args),` |
| `packages/cli/scripts/clipboard-image-host-smoke.mjs` | 490 | `const child = spawn("xclip", linuxClipboardOwnerArgs(filePath), {` |
| `packages/cli/scripts/clipboard-image-host-smoke.mjs` | 556 | `executionBroker.execFileSync("git", ["rev-parse", "HEAD"], {` |
| `packages/cli/scripts/event-runtime-recovery-drill.mjs` | 132 | `child = executionBroker.fork(scriptPath, ["--child", mode, dir], {` |
| `packages/cli/scripts/gen-process-spawn-inventory.mjs` | 3 | `* Generate (or byte-diff-check) an inventory of direct child_process usage.` |
| `packages/cli/scripts/gen-process-spawn-inventory.mjs` | 36 | `/(?:child_process\|node:child_process\|\b(?:cpDefault\|childProcess\|_deps\|deps)\.(?:spawn\|spawnSync\|exec\|execFile\|execSync\|execFileSync\|fork)\b\|\b(?:spawn\|spawnSync\|execFile\|execSync\|execFileSync\|fork)\s*\()/;` |
| `packages/cli/scripts/gen-process-spawn-inventory.mjs` | 105 | `/(?:child_process\|node:child_process)/.test(trimmed)` |
| `packages/cli/scripts/gen-process-spawn-inventory.mjs` | 118 | `/^message:\s*["'`].*child_process/.test(trimmed)` |
| `packages/cli/scripts/ide-input-performance-profile.mjs` | 7 | `import { execFileSync } from "node:child_process";` |
| `packages/cli/scripts/ide-input-performance-profile.mjs` | 319 | `const actual = execFileSync("git", ["rev-parse", "HEAD"], {` |
| `packages/cli/scripts/ide-input-performance-profile.mjs` | 325 | `execFileSync("git", ["ls-files", "--error-unmatch", "--", sourcePath], {` |
| `packages/cli/scripts/ide-input-performance-profile.mjs` | 330 | `execFileSync("git", ["diff", "--quiet", "HEAD", "--", ...SOURCE_PATHS], {` |
| `packages/cli/scripts/ide-roadmap-accessibility-performance.mjs` | 8 | `import { execFileSync } from "node:child_process";` |
| `packages/cli/scripts/ide-roadmap-accessibility-performance.mjs` | 302 | `return execFileSync("git", args, {` |
| `packages/cli/scripts/ide-roadmap-accessibility-performance.mjs` | 312 | `execFileSync("git", args, {` |
| `packages/cli/scripts/ide-roadmap-accessibility-performance.mjs` | 339 | `return execFileSync("git", ["show", `${commit}:${filePath}`], {` |
| `packages/cli/scripts/ide-roadmap-accessibility-performance.mjs` | 571 | `const output = execFileSync("lsof", ["-p", String(process.pid)], {` |
| `packages/cli/scripts/ide-roadmap-accessibility-performance.mjs` | 578 | `const output = execFileSync(` |
| `packages/cli/scripts/ide-roadmap-accessibility-performance.mjs` | 595 | `const output = execFileSync(` |
| `packages/cli/scripts/ide-roadmap-accessibility-performance.mjs` | 612 | `const output = execFileSync("ps", ["-Ao", "pid=,comm="], {` |
| `packages/cli/scripts/ide-roadmap-browser-evidence.mjs` | 9 | `import { execFileSync, spawn } from "node:child_process";` |
| `packages/cli/scripts/ide-roadmap-browser-evidence.mjs` | 141 | `return execFileSync("git", args, {` |
| `packages/cli/scripts/ide-roadmap-browser-evidence.mjs` | 423 | `return spawn(executable, args, {` |
| `packages/cli/scripts/ide-roadmap-context-permission-matrix.mjs` | 4 | `import { execFileSync, spawn } from "node:child_process";` |
| `packages/cli/scripts/ide-roadmap-context-permission-matrix.mjs` | 155 | `const head = execFileSync("git", ["rev-parse", "HEAD"], {` |
| `packages/cli/scripts/ide-roadmap-context-permission-matrix.mjs` | 159 | `const status = execFileSync(` |
| `packages/cli/scripts/ide-roadmap-context-permission-matrix.mjs` | 259 | `const child = spawn(process.execPath, args, {` |
| `packages/cli/scripts/ide-roadmap-context-permission-matrix.mjs` | 476 | `const sleeperChild = spawn(` |
| `packages/cli/scripts/ide-roadmap-execution-location-matrix.mjs` | 4 | `import { execFileSync } from "node:child_process";` |
| `packages/cli/scripts/ide-roadmap-execution-location-matrix.mjs` | 203 | `const head = execFileSync("git", ["rev-parse", "HEAD"], {` |
| `packages/cli/scripts/ide-roadmap-execution-location-matrix.mjs` | 208 | `const status = execFileSync(` |
| `packages/cli/scripts/ide-roadmap-live-provider-trajectory.mjs` | 1 | `import { execFileSync, fork } from "node:child_process";` |
| `packages/cli/scripts/ide-roadmap-live-provider-trajectory.mjs` | 489 | `head = execFileSync("git", ["rev-parse", "HEAD"], {` |
| `packages/cli/scripts/ide-roadmap-live-provider-trajectory.mjs` | 575 | `const child = fork(LOOPBACK_CHILD, [fixtureFile], {` |
| `packages/cli/scripts/ide-roadmap-marketplace-supply-chain.mjs` | 4 | `import { execFileSync, spawn } from "node:child_process";` |
| `packages/cli/scripts/ide-roadmap-marketplace-supply-chain.mjs` | 203 | `const head = execFileSync("git", ["rev-parse", "HEAD"], {` |
| `packages/cli/scripts/ide-roadmap-marketplace-supply-chain.mjs` | 208 | `const status = execFileSync(` |
| `packages/cli/scripts/ide-roadmap-marketplace-supply-chain.mjs` | 220 | `execFileSync(` |
| `packages/cli/scripts/ide-roadmap-marketplace-supply-chain.mjs` | 631 | `const child = spawn(process.execPath, args, {` |
| `packages/cli/scripts/ide-roadmap-mcp-security-gate.mjs` | 3 | `import { execFileSync, spawn } from "node:child_process";` |
| `packages/cli/scripts/ide-roadmap-mcp-security-gate.mjs` | 121 | `const child = spawn(plan.command, plan.args, plan.options);` |
| `packages/cli/scripts/ide-roadmap-mcp-security-gate.mjs` | 428 | `execFileSync("git", ["rev-parse", "HEAD"], {` |
| `packages/cli/scripts/ide-roadmap-safety-gate.mjs` | 182 | `const result = executionBroker.spawnSync("git", ["rev-parse", "HEAD"], {` |
| `packages/cli/scripts/ide-roadmap-safety-gate.mjs` | 451 | `child = executionBroker.fork(scriptPath, ["--worker", ...workerArgs], {` |
| `packages/cli/scripts/macos-mcp-launcher-build.mjs` | 7 | `import { spawnSync } from "node:child_process";` |
| `packages/cli/scripts/macos-mcp-launcher-build.mjs` | 72 | `const result = spawnSync(command, args, {` |
| `packages/cli/scripts/macos-mcp-launcher-live-test.mjs` | 8 | `import { spawn, spawnSync } from "node:child_process";` |
| `packages/cli/scripts/macos-mcp-launcher-live-test.mjs` | 232 | `child = spawn(plan.command, plan.args, plan.options);` |
| `packages/cli/scripts/macos-mcp-launcher-live-test.mjs` | 343 | `const result = spawnSync(` |
| `packages/cli/scripts/macos-mcp-launcher-live-test.mjs` | 423 | `const result = spawnSync(` |
| `packages/cli/scripts/macos-mcp-launcher-live-test.mjs` | 467 | `const invalid = spawnSync(protocol.helperInstallPath, ["--invalid"], {` |
| `packages/cli/scripts/macos-mcp-launcher-live-test.mjs` | 476 | `const gidZero = spawnSync(` |
| `packages/cli/scripts/macos-mcp-launcher-live-test.mjs` | 629 | `const watcher = spawn(` |
| `packages/cli/scripts/macos-mcp-launcher-live-test.mjs` | 774 | `child = executionBroker.spawn(prepared.command, prepared.args, {` |
| `packages/cli/scripts/macos-mcp-launcher-live-test.mjs` | 888 | `const upgrade = spawnSync(` |
| `packages/cli/scripts/macos-mcp-launcher-live-test.mjs` | 925 | `'const {spawn}=require("node:child_process");',` |
| `packages/cli/scripts/macos-mcp-launcher-live-test.mjs` | 929 | `'try{const child=spawn("/bin/sh",["-c","echo $$ > \\"$1\\"; sleep 60","cc-live",marker],{detached:true,stdio:"ignore"});',` |
| `packages/cli/scripts/macos-mcp-launcher-live-test.mjs` | 1042 | `const parent = spawn(` |
| `packages/cli/scripts/mcp-lifecycle-profile.mjs` | 2 | `import { execFile } from "node:child_process";` |
| `packages/cli/scripts/mcp-lifecycle-profile.mjs` | 248 | `execFile(` |
| `packages/cli/scripts/native-signed-install-gate.mjs` | 18 | `import { spawnSync } from "node:child_process";` |
| `packages/cli/scripts/native-signed-install-gate.mjs` | 227 | `const result = spawnSync(command, args, {` |
| `packages/cli/scripts/run-claude-security-map-tests.mjs` | 4 | `import { spawnSync } from "node:child_process";` |
| `packages/cli/scripts/run-claude-security-map-tests.mjs` | 85 | `const result = spawnSync(invocation.executable, invocation.args, {` |
| `packages/cli/scripts/run-vitest-with-worker-retry.mjs` | 3 | `import { spawn } from "node:child_process";` |
| `packages/cli/scripts/scheduler-kernel-soak.mjs` | 4 | `import { execFileSync, spawn } from "node:child_process";` |
| `packages/cli/scripts/scheduler-kernel-soak.mjs` | 357 | `const headSha = execFileSync("git", ["rev-parse", "HEAD"], options)` |
| `packages/cli/scripts/scheduler-kernel-soak.mjs` | 360 | `const changes = execFileSync(` |
| `packages/cli/scripts/scheduler-kernel-soak.mjs` | 948 | `const child = spawn(process.execPath, argumentsList, {` |
| `packages/cli/scripts/scheduler-kernel-soak.mjs` | 1203 | `// child_process "close" is authoritative for the spawned process. A` |
| `packages/cli/scripts/scheduler-kernel-soak.mjs` | 1249 | `const output = execFileSync(` |
| `packages/cli/scripts/scheduler-reliability-soak.mjs` | 4 | `import { execFileSync } from "node:child_process";` |
| `packages/cli/scripts/scheduler-reliability-soak.mjs` | 125 | `execFileSync("git", ["rev-parse", "HEAD"], {` |
| `packages/cli/scripts/scheduler-reliability-soak.mjs` | 133 | `return execFileSync(` |
| `packages/cli/scripts/session-host-consistency-gate.mjs` | 22 | `import { execFileSync, fork, spawn } from "node:child_process";` |
| `packages/cli/scripts/session-host-consistency-gate.mjs` | 191 | `return execFileSync("git", args, {` |
| `packages/cli/scripts/session-host-consistency-gate.mjs` | 201 | `execFileSync("git", args, {` |
| `packages/cli/scripts/session-host-consistency-gate.mjs` | 248 | `const child = spawn(process.execPath, [WS_CLAIM_RACE_WORKER, ...args], {` |
| `packages/cli/scripts/session-host-consistency-gate.mjs` | 1752 | `const child = fork(SESSION_HOST_LEASE_CHILD, [stateRoot, sessionId], {` |
| `packages/cli/scripts/session-scale-gate.mjs` | 17 | `import { spawn, execFileSync } from "node:child_process";` |
| `packages/cli/scripts/session-scale-gate.mjs` | 265 | `return execFileSync("git", args, {` |
| `packages/cli/scripts/session-scale-gate.mjs` | 275 | `execFileSync("git", args, {` |
| `packages/cli/scripts/session-scale-gate.mjs` | 308 | `const child = spawn(command, args, {` |
| `packages/cli/scripts/session-ux-audit-fragment.mjs` | 5 | `import { execFileSync } from "node:child_process";` |
| `packages/cli/scripts/session-ux-audit-fragment.mjs` | 257 | `return execFileSync("git", ["rev-parse", "HEAD"], {` |
| `packages/cli/scripts/session-ux-audit-fragment.mjs` | 288 | `return execFileSync(` |
| `packages/cli/scripts/session-ux-audit-fragment.mjs` | 308 | `execFileSync(` |
| `packages/cli/scripts/soak-host-metrics.mjs` | 1 | `import { spawnSync } from "node:child_process";` |
| `packages/cli/scripts/team-distributed-soak.mjs` | 3 | `import { execFileSync, spawn, spawnSync } from "node:child_process";` |
| `packages/cli/scripts/team-distributed-soak.mjs` | 385 | `const result = spawnSync("git", safeGitArguments(root, args), {` |
| `packages/cli/scripts/team-distributed-soak.mjs` | 1026 | `const result = spawnSync(` |
| `packages/cli/scripts/team-distributed-soak.mjs` | 1041 | `const result = spawnSync(` |
| `packages/cli/scripts/team-distributed-soak.mjs` | 1055 | `const result = spawnSync(` |
| `packages/cli/scripts/team-distributed-soak.mjs` | 1087 | `const unstaged = spawnSync(` |
| `packages/cli/scripts/team-distributed-soak.mjs` | 1097 | `const staged = spawnSync(` |
| `packages/cli/scripts/team-distributed-soak.mjs` | 1132 | `const result = spawnSync(` |
| `packages/cli/scripts/team-distributed-soak.mjs` | 1430 | `return execFileSync("git", safeGitArguments(repo, args), {` |
| `packages/cli/scripts/team-distributed-soak.mjs` | 1618 | `const child = spawn(` |
| `packages/cli/scripts/team-distributed-soak.mjs` | 1858 | `executionBroker.execFileSync("git", ["--version"], {` |
| `packages/cli/scripts/test-coding-agent-parity.mjs` | 34 | `import { spawnSync } from "node:child_process";` |
| `packages/cli/scripts/test-coding-agent-parity.mjs` | 103 | `const r = spawnSync(cmd, args, {` |
| `packages/cli/scripts/test-runtime-convergence.mjs` | 29 | `if (!broker \|\| typeof broker.spawn !== "function") throw new Error("missing spawn()");` |
| `packages/cli/scripts/test-runtime-e2e.cjs` | 59 | `broker.spawnSync(process.execPath, ["-e", "process.stdout.write('hello from e2e test')"], {` |
| `packages/cli/scripts/verify-claude-code-increment-source-runs.mjs` | 4 | `import { execFileSync } from "node:child_process";` |
| `packages/cli/scripts/verify-claude-code-increment-source-runs.mjs` | 374 | `execFileSync("git", ["show", `${commit}:${producerPath}`], {` |
| `packages/cli/scripts/verify-claude-security-map.mjs` | 5 | `import { execFileSync } from "node:child_process";` |
| `packages/cli/scripts/verify-claude-security-map.mjs` | 162 | `return execFileSync("git", ["rev-parse", "HEAD"], {` |
| `packages/cli/scripts/verify-claude-security-map.mjs` | 184 | `const bytes = execFileSync(` |
| `packages/cli/scripts/verify-ide-roadmap-browser-evidence.mjs` | 6 | `import { execFileSync } from "node:child_process";` |
| `packages/cli/scripts/verify-ide-roadmap-browser-evidence.mjs` | 120 | `const bytes = execFileSync(` |
| `packages/cli/scripts/verify-ide-roadmap-browser-evidence.mjs` | 135 | `execFileSync("git", ["rev-parse", "HEAD"], {` |
| `packages/cli/scripts/verify-ide-roadmap-execution-location.mjs` | 4 | `import { execFileSync } from "node:child_process";` |
| `packages/cli/scripts/verify-ide-roadmap-execution-location.mjs` | 403 | `const head = execFileSync("git", ["rev-parse", "HEAD"], {` |
| `packages/cli/scripts/verify-ide-roadmap-execution-location.mjs` | 415 | `execFileSync("git", ["cat-file", "-t", objectName], {` |
| `packages/cli/scripts/verify-ide-roadmap-execution-location.mjs` | 423 | `const bytes = execFileSync("git", ["cat-file", "blob", objectName], {` |
| `packages/cli/scripts/verify-ide-roadmap-fixtures.mjs` | 2 | `import { execFileSync as nodeExecFileSync } from "node:child_process";` |
| `packages/cli/scripts/verify-ide-roadmap-fixtures.mjs` | 957 | `execFileSync("git", ["rev-parse", "HEAD"], {` |
| `packages/cli/scripts/verify-ide-roadmap-fixtures.mjs` | 964 | `execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {` |
| `packages/cli/scripts/verify-ide-roadmap-marketplace-supply-chain.mjs` | 4 | `import { execFileSync } from "node:child_process";` |
| `packages/cli/scripts/verify-ide-roadmap-marketplace-supply-chain.mjs` | 115 | `return execFileSync("git", args, {` |
| `packages/cli/scripts/verify-mcp-lifecycle-increments.mjs` | 5 | `import { execFileSync, spawnSync } from "node:child_process";` |
| `packages/cli/scripts/verify-mcp-lifecycle-increments.mjs` | 114 | `execFileSync("git", ["rev-parse", "HEAD"], {` |
| `packages/cli/scripts/verify-mcp-lifecycle-increments.mjs` | 145 | `const objectType = execFileSync("git", ["cat-file", "-t", objectName], {` |
| `packages/cli/scripts/verify-mcp-lifecycle-increments.mjs` | 155 | `return execFileSync("git", ["cat-file", "blob", objectName], {` |
| `packages/cli/scripts/verify-mcp-lifecycle-increments.mjs` | 194 | `const result = spawnSync(` |
| `packages/cli/scripts/verify-rc-default-audit.mjs` | 4 | `import { execFileSync, spawnSync } from "node:child_process";` |
| `packages/cli/scripts/verify-rc-default-audit.mjs` | 128 | `execFileSync("git", ["rev-parse", "HEAD"], {` |
| `packages/cli/scripts/verify-rc-default-audit.mjs` | 148 | `const committed = execFileSync(` |
| `packages/cli/scripts/verify-rc-default-audit.mjs` | 181 | `const result = spawnSync(` |
| `packages/cli/scripts/verify-rc-default-audit.mjs` | 218 | `const result = spawnSync(` |
| `packages/cli/scripts/verify-session-message-fabric.mjs` | 8 | `import { execFileSync, spawn } from "node:child_process";` |
| `packages/cli/scripts/verify-session-message-fabric.mjs` | 119 | `const committed = execFileSync(` |
| `packages/cli/scripts/verify-session-message-fabric.mjs` | 192 | `const resolved = execFileSync(locator, [command], { encoding: "utf8" })` |
| `packages/cli/scripts/verify-session-message-fabric.mjs` | 209 | `const child = spawn(process.execPath, [SCRIPT_PATH, ...args], {` |
| `packages/cli/scripts/verify-session-message-fabric.mjs` | 285 | `const child = spawn(` |
| `packages/cli/scripts/verify-session-message-fabric.mjs` | 604 | `const recoveredRaw = execFileSync(` |
| `packages/cli/scripts/verify-session-message-fabric.mjs` | 752 | `execFileSync(javac, ["-encoding", "UTF-8", "-d", classes, ...javaSources], {` |
| `packages/cli/scripts/verify-session-message-fabric.mjs` | 757 | `execFileSync(` |
| `packages/cli/scripts/verify-session-message-fabric.mjs` | 775 | `const javaVersion = execFileSync(javac, ["-version"], {` |
| `packages/cli/scripts/verify-session-message-fabric.mjs` | 795 | `const current = execFileSync("git", ["rev-parse", "HEAD"], {` |
| `packages/cli/scripts/verify-session-message-fabric.mjs` | 868 | `const current = execFileSync("git", ["rev-parse", "HEAD"], {` |
| `packages/cli/scripts/verify-session-runtime-retention.mjs` | 4 | `import { execFileSync } from "node:child_process";` |
| `packages/cli/scripts/verify-session-runtime-retention.mjs` | 211 | `return execFileSync("git", args, {` |
| `packages/cli/scripts/verify-session-runtime-retention.mjs` | 235 | `return execFileSync("git", ["show", `${headSha}:${repoPath}`], {` |
| `packages/cli/scripts/verify-session-runtime-retention.mjs` | 345 | `execFileSync(` |
| `packages/cli/scripts/verify-session-runtime-retention.mjs` | 761 | `execFileSync(process.execPath, ["--expose-gc", SCRIPT_PATH], {` |

## test

| File | Line | Match |
| --- | ---: | --- |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/coding-agent-bridge.test.js` | 75 | `_deps.spawn = vi.fn(() => mockProcess);` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/coding-agent-bridge.test.js` | 98 | `expect(_deps.spawn).toHaveBeenCalledTimes(1);` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/coding-agent-bridge.test.js` | 99 | `expect(_deps.spawn.mock.calls[0][2]).toMatchObject({` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/coding-agent-bridge.test.js` | 111 | `_deps.spawn.mockClear();` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/coding-agent-bridge.test.js` | 114 | `expect(_deps.spawn).not.toHaveBeenCalled();` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/sub-runtime-pool.test.js` | 81 | `originalSpawn = poolMod._deps.spawn;` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/sub-runtime-pool.test.js` | 86 | `poolMod._deps.spawn = originalSpawn;` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/sub-runtime-pool.test.js` | 92 | `poolMod._deps.spawn = (execPath, args, options) => {` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/sub-runtime-pool.test.js` | 148 | `poolMod._deps.spawn = () => {` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/sub-runtime-pool.test.js` | 171 | `poolMod._deps.spawn = () => {` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/sub-runtime-pool.test.js` | 194 | `poolMod._deps.spawn = () => createFakeChild({}).child;` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/sub-runtime-pool.test.js` | 217 | `poolMod._deps.spawn = () => {` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/sub-runtime-pool.test.js` | 232 | `poolMod._deps.spawn = () =>` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/sub-runtime-pool.test.js` | 425 | `originalSpawn = poolMod._deps.spawn;` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/sub-runtime-pool.test.js` | 430 | `poolMod._deps.spawn = originalSpawn;` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/sub-runtime-pool.test.js` | 436 | `poolMod._deps.spawn = (_execPath, _args, _options) => {` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/sub-runtime-pool.test.js` | 515 | `poolMod._deps.spawn = (_e, _a, _o) => {` |
| `desktop-app-vue/src/main/ai-engine/code-agent/__tests__/sub-runtime-pool.test.js` | 577 | `poolMod._deps.spawn = (_e, _a, _o) => {` |
| `desktop-app-vue/src/main/ipc/__tests__/advanced-features-ipc-sanitize.test.js` | 14 | `const originalSpawn = AdvancedFeaturesIPC._deps.spawn;` |
| `desktop-app-vue/src/main/ipc/__tests__/advanced-features-ipc-sanitize.test.js` | 17 | `AdvancedFeaturesIPC._deps.spawn = originalSpawn;` |
| `desktop-app-vue/src/main/ipc/__tests__/advanced-features-ipc-sanitize.test.js` | 81 | `AdvancedFeaturesIPC._deps.spawn = vi.fn(() => child);` |
| `desktop-app-vue/src/main/ipc/__tests__/advanced-features-ipc-sanitize.test.js` | 96 | `expect(AdvancedFeaturesIPC._deps.spawn).toHaveBeenCalledWith(` |
| `packages/cli/src/lib/lsp/__tests__/lsp-client.test.js` | 4 | `* is injected through `_deps.spawn`; no real language server is spawned.` |
| `packages/cli/src/lib/lsp/__tests__/lsp-client.test.js` | 60 | `origSpawn = _deps.spawn;` |
| `packages/cli/src/lib/lsp/__tests__/lsp-client.test.js` | 63 | `_deps.spawn = origSpawn;` |
| `packages/cli/src/lib/lsp/__tests__/lsp-client.test.js` | 68 | `_deps.spawn = vi.fn(() => child);` |
| `packages/cli/src/lib/lsp/__tests__/lsp-client.test.js` | 88 | `expect(_deps.spawn).toHaveBeenCalledWith(` |
| `packages/cli/src/lib/lsp/__tests__/lsp-client.test.js` | 98 | `expect(_deps.spawn.mock.calls[0][2]).not.toHaveProperty("sandboxPolicy");` |
| `packages/cli/src/lib/lsp/__tests__/lsp-client.test.js` | 143 | `expect(_deps.spawn).not.toHaveBeenCalled();` |
| `packages/cli/src/lib/lsp/__tests__/lsp-manager.test.js` | 336 | `// Same tick, backoff disabled → immediate fresh spawn (prior behaviour).` |
