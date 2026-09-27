import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const helper = fileURLToPath(
  new URL("./helpers/session-resume-chat-process.mjs", import.meta.url),
);
// Exercise the installed command's lazy dispatch and canonical defaults.
const cli = fileURLToPath(
  new URL("../../bin/chainlesschain.js", import.meta.url),
);
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

it.each(["none", "agent", "chat"])(
  "real session resume uses the target chat deployment (%s)",
  (mode) => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-resume-chat-deployment-"),
    );
    roots.push(root);
    const env = {
      ...process.env,
      CHAINLESSCHAIN_HOME: path.join(root, "target-home", ".chainlesschain"),
      CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: path.join(root, "target-security"),
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    };
    delete env.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR;
    delete env.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT;
    const setup = spawnSync(process.execPath, [helper, root, mode], {
      env,
      encoding: "utf8",
      timeout: 90000,
    });
    expect(setup.status, setup.stderr).toBe(0);
    const run = (args, input = "") =>
      spawnSync(process.execPath, [cli, ...args], {
        env,
        input,
        encoding: "utf8",
        timeout: 90000,
      });
    const history = run([
      "session",
      "show",
      "--json",
      "--history",
      "--",
      "resume-auth-test",
    ]);
    expect(history.status, history.stderr).toBe(0);
    expect(history.stdout).toContain("saved user input");
    const resumed = run(["session", "resume", "resume-auth-test"], "/exit\n");
    if (mode === "chat") {
      expect(resumed.status, resumed.stderr).toBe(0);
      expect(resumed.stdout).toContain("ChainlessChain AI Chat");
      expect(resumed.stdout).toContain("Goodbye!");
    } else {
      expect(resumed.status).toBe(1);
      expect(resumed.stderr).toContain(
        "requires an authenticated evolution composition factory",
      );
      expect(resumed.stdout).not.toContain("ChainlessChain AI Chat");
    }
  },
  180000,
);
