import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runStdioAppServer: vi.fn(async () => ({ closed: true })),
}));

vi.mock("../../src/lib/app-server/stdio-transport.js", () => ({
  runStdioAppServer: mocks.runStdioAppServer,
}));

import { registerServeCommand } from "../../src/commands/serve.js";
import { createEvolutionWorkbenchCliHost } from "../../src/lib/evolution/evolution-workbench-cli-host.js";

const roots = [];

afterEach(() => {
  vi.clearAllMocks();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function workbenchHost() {
  return createEvolutionWorkbenchCliHost({
    tenantId: "tenant:serve-launcher",
    projectionLoader: { load() {} },
    projectionAuthority: { retain() {} },
    identityProvider: { current() {} },
    activeStateReader: { read() {} },
    batchExecutor: { execute() {} },
    rollbackExecutor: { execute() {} },
  });
}

describe("serve governance host composition", () => {
  it("passes an injected branded Workbench host through the stdio registrar", async () => {
    const stateRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-serve-governance-"),
    );
    roots.push(stateRoot);
    const evolutionWorkbenchHost = workbenchHost();
    const program = new Command();
    program.exitOverride();
    registerServeCommand(program, { evolutionWorkbenchHost });

    await program.parseAsync([
      "node",
      "cc",
      "serve",
      "--app-server",
      "--app-server-state-dir",
      stateRoot,
    ]);

    expect(mocks.runStdioAppServer).toHaveBeenCalledOnce();
    expect(mocks.runStdioAppServer).toHaveBeenCalledWith(
      expect.objectContaining({ evolutionWorkbenchHost }),
    );
  });
});
