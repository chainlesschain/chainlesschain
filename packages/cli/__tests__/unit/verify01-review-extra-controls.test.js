import { it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { extraDiagnosticControl } from "../../scripts/verify01-review-diagnostic-extra-controls.mjs";
import { VERIFY01_REVIEW_SPECS } from "../../scripts/verify01-review-specs.mjs";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const require = createRequire(import.meta.url);
const vitest = path.join(
  path.dirname(require.resolve("vitest/package.json")),
  "vitest.mjs",
);

// Normal CI uses its checked-out source. A local frozen-project audit can bind
// this same behavioral test to the historical project without editing it.
function sourceBytes(relative) {
  const commit = process.env.VERIFY01_CONTROL_SOURCE_COMMIT;
  return commit
    ? execFileSync("git", ["show", `${commit}:${relative}`], {
        cwd: repository,
        encoding: "utf8",
        windowsHide: true,
      })
    : fs.readFileSync(path.join(repository, relative), "utf8");
}

function write(root, relative, bytes) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

function copySource(root, relative) {
  write(root, relative, sourceBytes(relative));
}

function isolateUnusedDependencies(root, taskId) {
  if (taskId === "verify-05") {
    for (const file of [
      "claude-code-bridge.js",
      "cowork-adapter.js",
      "evolution/agent-evolution-ingress.js",
      "model-failure-policy.js",
      "abort-utils.js",
    ])
      copySource(root, `packages/cli/src/lib/${file}`);
    write(
      root,
      "node_modules/@chainlesschain/session-core/package.json",
      JSON.stringify({
        type: "commonjs",
        exports: { "./runtime-claims": "./runtime-claims.js" },
      }),
    );
    write(
      root,
      "node_modules/@chainlesschain/session-core/runtime-claims.js",
      sourceBytes("packages/session-core/lib/runtime-claims.js"),
    );
    return `
import { vi } from "vitest";
vi.mock("./packages/cli/src/lib/claude-code-bridge.js", async () => {
  const { EventEmitter } = await import("node:events");
  const forbidden = () => { throw new Error("unexpected CLI execution"); };
  return { ClaudeCodePool: class extends EventEmitter {},
    detectClaudeCode: forbidden, detectCodex: forbidden };
});
vi.mock("./packages/cli/src/lib/cowork-adapter.js", () => ({
  createChatFn() { throw new Error("unexpected provider execution"); },
}));
vi.mock("./packages/cli/src/lib/evolution/agent-evolution-ingress.js", () => ({
  captureAgentEvolutionIngress() { throw new Error("unexpected model ingress"); },
}));
`;
  }
  if (taskId === "verify-11") {
    for (const file of [
      "interaction-binding.js",
      "session-transcript-structure.js",
    ])
      copySource(root, `packages/cli/src/lib/${file}`);
    copySource(root, "packages/cli/src/harness/jsonl-session-store.js");
    return `
import { vi } from "vitest";
vi.mock("./packages/cli/src/harness/jsonl-session-store.js", () => {
  const forbidden = () => { throw new Error("unexpected durable store access"); };
  return { appendAuthorityEventWithVerifiedProjection: forbidden,
    getSessionPresence: forbidden, readVerifiedEvents: forbidden,
    SESSION_PRESENCE: { ABSENT: "absent" } };
});
`;
  }
  return "";
}

it("extra diagnostic controls pass real APIs and reject every specified behavioral mutant", () => {
  const work = path.join(repository, ".work");
  fs.mkdirSync(work, { recursive: true });
  const root = fs.mkdtempSync(path.join(work, "verify01-extra-controls-"));
  const cases = [];
  try {
    write(root, "package.json", '{"type":"module"}');
    write(
      root,
      "vitest.config.mjs",
      `export default {
      test: { include: ["*/control.test.js"], maxWorkers: 1, testTimeout: 10000 },
    };`,
    );
    for (const taskId of ["verify-05", "verify-11", "verify-13", "verify-29"]) {
      const spec = VERIFY01_REVIEW_SPECS.find(
        (entry) => entry.taskId === taskId,
      );
      const original = sourceBytes(spec.sourcePath);
      for (const mutation of [null, ...spec.mutants]) {
        const name = `${taskId}-${mutation?.name || "baseline"}`;
        const fixture = path.join(root, name);
        let bytes = original;
        if (mutation) {
          expect(original.split(mutation.find)).toHaveLength(2);
          bytes = original.replace(mutation.find, mutation.replace);
        }
        write(fixture, spec.sourcePath, bytes);
        write(
          fixture,
          "packages/vscode-extension/package.json",
          '{"type":"commonjs"}',
        );
        const mocks = isolateUnusedDependencies(fixture, taskId);
        write(
          fixture,
          "control.test.js",
          mocks + extraDiagnosticControl(taskId, `./${spec.sourcePath}`),
        );
        cases.push({
          name,
          mutated: Boolean(mutation),
          tests: ["verify-11", "verify-13"].includes(taskId) ? 2 : 1,
        });
      }
    }
    const reportFile = path.join(root, "report.json");
    const result = spawnSync(
      process.execPath,
      [
        vitest,
        "run",
        "--root",
        root,
        "--config",
        path.join(root, "vitest.config.mjs"),
        "--reporter=json",
        "--outputFile",
        reportFile,
      ],
      {
        cwd: repository,
        encoding: "utf8",
        windowsHide: true,
        timeout: 60000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    expect(result.error).toBeUndefined();
    expect(fs.existsSync(reportFile), result.stdout + result.stderr).toBe(true);
    const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
    expect(report.testResults).toHaveLength(cases.length);
    for (const item of cases) {
      const suite = report.testResults.find((entry) =>
        entry.name
          .replaceAll("\\", "/")
          .endsWith(`/${item.name}/control.test.js`),
      );
      expect(suite, item.name).toBeDefined();
      expect(suite.assertionResults, suite.message).toHaveLength(item.tests);
      const failed = suite.assertionResults.filter(
        (entry) => entry.status === "failed",
      );
      expect(failed, item.name).toHaveLength(item.mutated ? 1 : 0);
      expect(
        suite.assertionResults.every((entry) =>
          ["passed", "failed"].includes(entry.status),
        ),
      ).toBe(true);
      if (item.mutated)
        expect(failed[0].failureMessages.join("\n")).toMatch(/AssertionError/);
    }
    expect(report.numFailedTests).toBe(6);
    expect(report.numPassedTests).toBe(10);
    expect(result.status).toBe(1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 90000);
