import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createEnvironmentContext } from "../../../__tests__/helpers/bundled-skill-environment.js";
import { withTestFilesystemHandler } from "../../../__tests__/helpers/bundled-skill-filesystem.js";

const handler = withTestFilesystemHandler(
  require("../handler.js"),
  "code-runner",
);
const originalLoader = handler._deps.loadProcessBroker;
const temporaryRoots = [];
const environmentContext = createEnvironmentContext("code-runner", {
  PATH: "test-runtime-path",
});

function childThatCompletes(stdout = "ok") {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => {
    child.stdout.emit("data", Buffer.from(stdout));
    child.emit("close", 0);
  });
  return child;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  handler._deps.loadProcessBroker = originalLoader;
  for (const target of temporaryRoots.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("Code Runner security boundary", () => {
  it("executes only through ProcessExecutionBroker with a minimal env", async () => {
    const broker = {
      execFileSync: vi.fn(() => Buffer.from("node")),
      spawn: vi.fn(() => childThatCompletes("safe-output")),
    };
    handler._deps.loadProcessBroker = vi.fn(async () => broker);
    const previousSecret = process.env.AWS_SECRET_ACCESS_KEY;
    process.env.AWS_SECRET_ACCESS_KEY = "must-not-leak";
    try {
      const result = await handler.execute(
        { input: '--run "console.log(1)" --lang javascript' },
        { ...environmentContext, workspaceRoot: process.cwd() },
      );
      expect(result.success).toBe(true);
      expect(broker.spawn).toHaveBeenCalledOnce();
      expect(broker.spawn.mock.calls[0][2]).toMatchObject({
        origin: "skill:code-runner",
        scope: "cowork-skill",
        policy: "allow",
        shell: false,
        sandboxPolicy: {
          requiredBoundaries: ["filesystem", "network"],
        },
      });
      expect(Object.isFrozen(broker.spawn.mock.calls[0][2].sandboxPolicy)).toBe(
        true,
      );
      expect(
        broker.spawn.mock.calls[0][2].env.AWS_SECRET_ACCESS_KEY,
      ).toBeUndefined();
    } finally {
      if (previousSecret === undefined) {
        delete process.env.AWS_SECRET_ACCESS_KEY;
      } else {
        process.env.AWS_SECRET_ACCESS_KEY = previousSecret;
      }
    }
  });

  it("rejects script files outside the workspace before probing a runtime", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "cc-code-runner-test-"));
    temporaryRoots.push(base);
    const workspace = path.join(base, "workspace");
    const outside = path.join(base, "outside.js");
    fs.mkdirSync(workspace);
    fs.writeFileSync(outside, "console.log('outside')");
    const broker = { execFileSync: vi.fn(), spawn: vi.fn() };
    handler._deps.loadProcessBroker = vi.fn(async () => broker);

    const result = await handler.execute(
      { input: `--file ${outside} --lang javascript` },
      { ...environmentContext, workspaceRoot: workspace },
    );
    expect(result).toMatchObject({
      success: false,
      error: "Script path outside workspace",
    });
    expect(broker.execFileSync).not.toHaveBeenCalled();
    expect(broker.spawn).not.toHaveBeenCalled();
  });
});
