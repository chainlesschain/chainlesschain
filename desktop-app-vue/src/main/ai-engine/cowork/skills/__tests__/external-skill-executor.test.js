import { spawn as nativeSpawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import {
  MAX_DATA_BYTES,
  MAX_HANDLER_BYTES,
  SANDBOX_POLICY,
  SkillCapabilityBroker,
  createExternalSkillExecutor,
} from "../external-skill-executor.js";

function request(handlerSource, overrides = {}) {
  return {
    skillId: "signed-external-skill",
    source: "workspace",
    handlerFileName: "handler.js",
    handlerSource,
    contentDigest: "a".repeat(64),
    publicKeySha256: "b".repeat(64),
    executionCapabilities: ["data:task", "data:result"],
    task: { value: "hello" },
    context: { marker: "context" },
    ...overrides,
  };
}

function nativeBrokerHarness() {
  const launches = [];
  return {
    launches,
    async loadProcessBroker() {
      return {
        spawn(command, args, options) {
          launches.push({ command, args, options });
          const nativeOptions = { ...options };
          delete nativeOptions.origin;
          delete nativeOptions.scope;
          delete nativeOptions.policy;
          delete nativeOptions.sandboxPolicy;
          return nativeSpawn(command, args, nativeOptions);
        },
      };
    },
  };
}

function harness(options = {}) {
  const processHarness = nativeBrokerHarness();
  const auditSink = vi.fn();
  const execute = createExternalSkillExecutor({
    loadProcessBroker: () => processHarness.loadProcessBroker(),
    auditSink,
    timeoutMs: 3_000,
    ...options,
  });
  return { execute, auditSink, launches: processHarness.launches };
}

describe("external Skill isolated executor", () => {
  it("ships the trusted worker outside app.asar in both packagers", () => {
    const desktopRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../../..",
    );
    const builderConfig = fs.readFileSync(
      path.join(desktopRoot, "electron-builder.yml"),
      "utf8",
    );
    const forgeConfig = fs.readFileSync(
      path.join(desktopRoot, "forge.config.js"),
      "utf8",
    );

    expect(builderConfig).toContain(
      "from: src/main/ai-engine/cowork/skills/runtime",
    );
    expect(builderConfig).toContain("to: skill-runtime");
    expect(forgeConfig).toContain('"skills",\n    "runtime"');
    expect(forgeConfig).toContain("extraResources.push(skillRuntimeDir)");
  });

  it("executes exact handler bytes in a one-shot restricted worker", async () => {
    const { execute, launches, auditSink } = harness();
    const result = await execute(
      request(`
        module.exports = {
          execute(task, context, skill) {
            return {
              value: task.value,
              marker: context.marker,
              skillId: skill.skillId,
              processType: typeof process,
              requireType: typeof require,
              globalType: typeof global
            };
          }
        };
      `),
    );

    expect(result).toEqual({
      value: "hello",
      marker: "context",
      skillId: "signed-external-skill",
      processType: "undefined",
      requireType: "undefined",
      globalType: "undefined",
    });
    expect(launches).toHaveLength(1);
    expect(launches[0].command).toBe(process.execPath);
    expect(launches[0].args).toEqual(
      expect.arrayContaining([
        "--permission",
        "--no-addons",
        "--disable-proto=delete",
      ]),
    );
    expect(launches[0].options).toMatchObject({
      origin: "skill:external:signed-external-skill",
      scope: "cowork-external-skill",
      shell: false,
      sandboxPolicy: SANDBOX_POLICY,
    });
    expect(launches[0].options.env).toEqual(
      expect.objectContaining({ ELECTRON_RUN_AS_NODE: "1" }),
    );
    expect(launches[0].options.env).not.toHaveProperty("NODE_OPTIONS");
    expect(auditSink).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "execution-finish",
        outcome: "succeeded",
      }),
    );
  });

  it("routes declared capability calls through an exact host port", async () => {
    const port = vi.fn(async ({ operation, input, skillId }) => ({
      operation,
      echoed: input.value,
      skillId,
    }));
    const { execute, auditSink } = harness({
      capabilityPorts: { "broker:echo": port },
    });
    const result = await execute(
      request(
        `
          module.exports = {
            async execute(task) {
              const pending = chainlesschain.capabilities.call(
                "broker:echo",
                "reflect",
                { value: task.value }
              );
              let constructorEscapeBlocked = false;
              try {
                pending.constructor.constructor("return process")();
              } catch (_error) {
                constructorEscapeBlocked = true;
              }
              return {
                ...(await pending),
                constructorEscapeBlocked
              };
            }
          };
        `,
        {
          executionCapabilities: ["data:task", "data:result", "broker:echo"],
        },
      ),
    );

    expect(result).toEqual({
      operation: "reflect",
      echoed: "hello",
      skillId: "signed-external-skill",
      constructorEscapeBlocked: true,
    });
    expect(port).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "broker:echo",
        operation: "reflect",
        input: { value: "hello" },
      }),
    );
    expect(auditSink).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "capability",
        outcome: "allowed",
        capability: "broker:echo",
      }),
    );
  });

  it("denies undeclared and disconnected capabilities", async () => {
    const undeclared = harness();
    await expect(
      undeclared.execute(
        request(`
          module.exports = {
            async execute() {
              return await chainlesschain.capabilities.call(
                "network:https", "request", { url: "https://example.com" }
              );
            }
          };
        `),
      ),
    ).rejects.toMatchObject({ code: "CC_SKILL_CAPABILITY_UNDECLARED" });

    const disconnected = harness();
    await expect(
      disconnected.execute(
        request(
          `
            module.exports = {
              async execute() {
                return await chainlesschain.capabilities.call(
                  "network:https", "request", { url: "https://example.com" }
                );
              }
            };
          `,
          {
            executionCapabilities: [
              "data:task",
              "data:result",
              "network:https",
            ],
          },
        ),
      ),
    ).rejects.toMatchObject({ code: "CC_SKILL_CAPABILITY_UNAVAILABLE" });
  });

  it("does not provide CommonJS or Node host access", async () => {
    const { execute } = harness();
    await expect(
      execute(
        request(`
          const fs = require("node:fs");
          module.exports = { execute() { return fs.readFileSync(__filename); } };
        `),
      ),
    ).rejects.toMatchObject({
      code: "CC_SKILL_HANDLER_EXECUTION_FAILED",
      phase: "execute",
    });
  });

  it("kills a worker that exceeds the execution deadline", async () => {
    const { execute, auditSink } = harness({ timeoutMs: 150 });
    await expect(
      execute(
        request(`
          module.exports = {
            execute() { while (true) {} }
          };
        `),
      ),
    ).rejects.toMatchObject({ code: "CC_SKILL_EXECUTION_TIMEOUT" });
    expect(auditSink).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "execution-finish",
        outcome: "failed",
        code: "CC_SKILL_EXECUTION_TIMEOUT",
      }),
    );
  });

  it("kills the one-shot worker when the caller aborts", async () => {
    const controller = new AbortController();
    const { execute } = harness({
      capabilityPorts: {
        "broker:wait": () => new Promise(() => {}),
      },
    });
    const running = execute(
      request(
        `
          module.exports = {
            async execute() {
              return await chainlesschain.capabilities.call(
                "broker:wait", "wait", {}
              );
            }
          };
        `,
        {
          executionCapabilities: ["data:task", "data:result", "broker:wait"],
          context: { signal: controller.signal },
        },
      ),
    );
    controller.abort();

    await expect(running).rejects.toMatchObject({
      code: "CC_SKILL_EXECUTION_ABORTED",
    });
  });

  it("rejects oversized and non-data requests before spawning", async () => {
    const { execute, launches } = harness();
    await expect(
      execute(
        request("module.exports = { execute() { return {}; } };", {
          task: { value: "x".repeat(MAX_DATA_BYTES + 1) },
        }),
      ),
    ).rejects.toMatchObject({ code: "CC_SKILL_EXECUTOR_DATA_TOO_LARGE" });
    await expect(
      execute(
        request("module.exports = { execute() { return {}; } };", {
          task: { callback() {} },
        }),
      ),
    ).rejects.toMatchObject({ code: "CC_SKILL_EXECUTOR_DATA_INVALID" });
    await expect(
      execute(request("x".repeat(MAX_HANDLER_BYTES + 1))),
    ).rejects.toMatchObject({ code: "CC_SKILL_EXECUTOR_SOURCE_INVALID" });
    await expect(
      execute(request("\\".repeat(MAX_HANDLER_BYTES))),
    ).rejects.toMatchObject({ code: "CC_SKILL_EXECUTOR_FRAME_TOO_LARGE" });
    expect(launches).toHaveLength(0);
  });

  it("rejects a handler result above the fixed output limit", async () => {
    const { execute } = harness();
    await expect(
      execute(
        request(`
          module.exports = {
            execute() { return { value: "x".repeat(1024 * 1024) }; }
          };
        `),
      ),
    ).rejects.toMatchObject({ code: "CC_SKILL_HANDLER_RESULT_TOO_LARGE" });
  });
});

describe("SkillCapabilityBroker", () => {
  it("fails closed when capability audit is unavailable", async () => {
    const broker = new SkillCapabilityBroker({
      ports: { "broker:echo": async () => ({ ok: true }) },
      auditSink() {
        throw new Error("audit offline");
      },
    });
    await expect(
      broker.invoke(
        {
          capability: "broker:echo",
          operation: "reflect",
          input: {},
        },
        {
          executionId: "execution",
          skillId: "skill",
          capabilities: new Set(["broker:echo"]),
          capabilityRequests: 0,
        },
      ),
    ).rejects.toMatchObject({
      code: "CC_SKILL_EXECUTOR_AUDIT_UNAVAILABLE",
    });
  });
});
