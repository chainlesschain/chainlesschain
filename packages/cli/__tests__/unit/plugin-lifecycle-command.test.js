import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerPluginCommand } from "../../src/commands/plugin.js";
import { discoverPlugins } from "../../src/lib/plugin-runtime/scopes.js";
import {
  getActiveVersion,
  installFromDirectory as installFromDirectoryImpl,
} from "../../src/lib/plugin-runtime/install.js";

let cwd;
let source;
let logSpy;

function installFromDirectory(sourceDir, opts = {}) {
  return installFromDirectoryImpl(sourceDir, {
    allowSourceSwitch: true,
    allowDowngrade: true,
    ...opts,
  });
}

function makeProgram() {
  const program = new Command();
  program.exitOverride();
  registerPluginCommand(program);
  return program;
}

async function run(...argv) {
  logSpy.mockClear();
  process.exitCode = 0;
  await makeProgram().parseAsync(["node", "cc", "plugin", ...argv]);
  return logSpy.mock.calls
    .map((call) => call.map((value) => String(value ?? "")).join(" "))
    .join("\n");
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-plugin-life-cwd-"));
  source = fs.mkdtempSync(path.join(os.tmpdir(), "cc-plugin-life-src-"));
  fs.writeFileSync(
    path.join(source, "plugin.json"),
    JSON.stringify({ name: "switchable", version: "1.0.0" }),
    "utf8",
  );
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  for (const dir of [cwd, source]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("cc plugin enable/disable --scope", () => {
  it("controls the unified runtime while retaining immutable versions", async () => {
    await run("add", source, "--scope", "project", "--json");

    expect(
      JSON.parse(
        await run("disable", "switchable", "--scope", "project", "--json"),
      ),
    ).toEqual({
      name: "switchable",
      scope: "project",
      enabled: false,
    });
    expect(
      discoverPlugins({ cwd, scopes: ["project"], skipPolicy: true }),
    ).toEqual([]);
    const disabledRows = JSON.parse(await run("installed", "--json"));
    expect(disabledRows.find((row) => row.name === "switchable")).toMatchObject(
      {
        name: "switchable",
        version: "1.0.0",
        versions: ["1.0.0"],
        enabled: false,
      },
    );

    expect(
      JSON.parse(
        await run("enable", "switchable", "--scope", "project", "--json"),
      ),
    ).toMatchObject({ enabled: true });
    expect(
      discoverPlugins({ cwd, scopes: ["project"], skipPolicy: true }),
    ).toHaveLength(1);
  });
});

describe("cc plugin activation authority", () => {
  function makeVersion(version) {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-plugin-life-version-"),
    );
    fs.writeFileSync(
      path.join(dir, "plugin.json"),
      JSON.stringify({ name: "activation-guard", version }),
      "utf8",
    );
    return dir;
  }

  it("requires explicit source-switch approval for plugin use", async () => {
    const first = makeVersion("1.0.0");
    const second = makeVersion("2.0.0");
    try {
      installFromDirectory(first, { scope: "project", cwd });
      installFromDirectory(second, { scope: "project", cwd });

      await run("use", "activation-guard", "1.0.0", "--scope", "project");
      expect(process.exitCode).toBe(1);
      expect(
        getActiveVersion("activation-guard", { scope: "project", cwd }),
      ).toBe("2.0.0");

      await run(
        "use",
        "activation-guard",
        "1.0.0",
        "--scope",
        "project",
        "--allow-source-switch",
      );
      expect(process.exitCode).toBe(0);
      expect(
        getActiveVersion("activation-guard", { scope: "project", cwd }),
      ).toBe("1.0.0");
    } finally {
      fs.rmSync(first, { recursive: true, force: true });
      fs.rmSync(second, { recursive: true, force: true });
    }
  });

  it("keeps uninstall fallback unchanged until source switching is approved", async () => {
    const first = makeVersion("1.0.0");
    const second = makeVersion("2.0.0");
    try {
      installFromDirectory(first, { scope: "project", cwd });
      installFromDirectory(second, { scope: "project", cwd });

      await run(
        "uninstall",
        "activation-guard",
        "--scope",
        "project",
        "--version",
        "2.0.0",
      );
      expect(process.exitCode).toBe(1);
      expect(
        getActiveVersion("activation-guard", { scope: "project", cwd }),
      ).toBe("2.0.0");

      await run(
        "uninstall",
        "activation-guard",
        "--scope",
        "project",
        "--version",
        "2.0.0",
        "--allow-source-switch",
      );
      expect(process.exitCode).toBe(0);
      expect(
        getActiveVersion("activation-guard", { scope: "project", cwd }),
      ).toBe("1.0.0");
    } finally {
      fs.rmSync(first, { recursive: true, force: true });
      fs.rmSync(second, { recursive: true, force: true });
    }
  });

  it("shows blocked pointer state without treating inspected bytes as active evidence", async () => {
    await run("add", source, "--scope", "project", "--json");
    const activeFile = path.join(
      cwd,
      ".chainlesschain",
      "plugins",
      "switchable",
      ".active",
    );
    fs.writeFileSync(activeFile, "9.9.9", "utf8");

    const installedOutput = await run("installed");
    expect(process.exitCode).toBe(0);
    expect(installedOutput).toContain("active=blocked (dangling)");
    expect(installedOutput).toContain("inspect=v1.0.0");
    expect(installedOutput).not.toContain("vnull");

    await run("evidence", "switchable", "--scope", "project", "--json");
    expect(process.exitCode).toBe(1);
  });

  it("removes an explicitly selected runtime-blocked install", async () => {
    await run("add", source, "--scope", "project", "--json");
    const nameDir = path.join(cwd, ".chainlesschain", "plugins", "switchable");
    fs.rmSync(path.join(nameDir, "1.0.0", "plugin.json"));

    const rows = JSON.parse(await run("installed", "--json"));
    expect(rows.find((row) => row.name === "switchable")).toMatchObject({
      runtimeBlocked: true,
      activePointer: { status: "manifest-invalid" },
    });

    await run("uninstall", "switchable", "--scope", "project");
    expect(process.exitCode).toBe(0);
    expect(fs.existsSync(nameDir)).toBe(false);
  });

  it("shows and removes retained install-recovery state", async () => {
    await run("add", source, "--scope", "project", "--json");
    const nameDir = path.join(cwd, ".chainlesschain", "plugins", "switchable");
    const recoveryRoot = path.join(nameDir, ".install-retained");
    fs.mkdirSync(recoveryRoot);
    fs.renameSync(
      path.join(nameDir, "1.0.0"),
      path.join(recoveryRoot, "previous"),
    );

    const rows = JSON.parse(await run("installed", "--json"));
    expect(rows.find((row) => row.name === "switchable")).toMatchObject({
      runtimeBlocked: true,
      activePointer: {
        status: "recovery-required",
        inspectionVersion: "1.0.0",
        recoveryPath: path.join(recoveryRoot, "previous"),
      },
    });

    await run("uninstall", "switchable", "--scope", "project");
    expect(process.exitCode).toBe(0);
    expect(fs.existsSync(nameDir)).toBe(false);
  });
});
