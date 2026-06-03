/**
 * Unit tests: commands/ui.js — command registration
 *
 * Verifies that registerUiCommand correctly registers the 'ui' command
 * with all expected options and defaults on a Commander program.
 * Does NOT start any real server.
 */

import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { registerUiCommand } from "../../src/commands/ui.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function buildProgram() {
  const program = new Command();
  program.exitOverride(); // prevent process.exit in tests
  registerUiCommand(program);
  return program;
}

function findCommand(program, name) {
  return program.commands.find((c) => c.name() === name) ?? null;
}

function findOption(cmd, longFlag) {
  return cmd.options.find((o) => o.long === longFlag) ?? null;
}

// ── command registration ──────────────────────────────────────────────────────

describe("registerUiCommand – registration", () => {
  it("registers a command named 'ui'", () => {
    const program = buildProgram();
    expect(findCommand(program, "ui")).not.toBeNull();
  });

  it("command has a non-empty description", () => {
    const program = buildProgram();
    const cmd = findCommand(program, "ui");
    expect(cmd.description()).toBeTruthy();
    expect(cmd.description().length).toBeGreaterThan(5);
  });
});

// ── options ───────────────────────────────────────────────────────────────────

describe("registerUiCommand – --port option", () => {
  it("has --port option", () => {
    const program = buildProgram();
    const cmd = findCommand(program, "ui");
    expect(findOption(cmd, "--port")).not.toBeNull();
  });

  it("--port default is '18810'", () => {
    const program = buildProgram();
    const cmd = findCommand(program, "ui");
    const opt = findOption(cmd, "--port");
    expect(opt.defaultValue).toBe("18810");
  });

  it("--port has short alias -p", () => {
    const program = buildProgram();
    const cmd = findCommand(program, "ui");
    const opt = findOption(cmd, "--port");
    expect(opt.short).toBe("-p");
  });
});

describe("registerUiCommand – --ws-port option", () => {
  it("has --ws-port option", () => {
    const program = buildProgram();
    const cmd = findCommand(program, "ui");
    expect(findOption(cmd, "--ws-port")).not.toBeNull();
  });

  it("--ws-port default is '18800'", () => {
    const program = buildProgram();
    const cmd = findCommand(program, "ui");
    const opt = findOption(cmd, "--ws-port");
    expect(opt.defaultValue).toBe("18800");
  });
});

describe("registerUiCommand – --host option", () => {
  it("has --host option", () => {
    const program = buildProgram();
    const cmd = findCommand(program, "ui");
    expect(findOption(cmd, "--host")).not.toBeNull();
  });

  it("--host default is '127.0.0.1'", () => {
    const program = buildProgram();
    const cmd = findCommand(program, "ui");
    const opt = findOption(cmd, "--host");
    expect(opt.defaultValue).toBe("127.0.0.1");
  });

  it("--host has short alias -H", () => {
    const program = buildProgram();
    const cmd = findCommand(program, "ui");
    const opt = findOption(cmd, "--host");
    expect(opt.short).toBe("-H");
  });
});

describe("registerUiCommand – --no-open option", () => {
  it("has --no-open (negation of --open)", () => {
    const program = buildProgram();
    const cmd = findCommand(program, "ui");
    // Commander stores negation as --no-open, which toggles the 'open' bool
    const negOpt = cmd.options.find(
      (o) => o.long === "--no-open" || (o.long === "--open" && o.negate),
    );
    expect(negOpt).not.toBeNull();
  });
});

describe("registerUiCommand – --token option", () => {
  it("has --token option", () => {
    const program = buildProgram();
    const cmd = findCommand(program, "ui");
    expect(findOption(cmd, "--token")).not.toBeNull();
  });

  it("--token has no default value (optional)", () => {
    const program = buildProgram();
    const cmd = findCommand(program, "ui");
    const opt = findOption(cmd, "--token");
    expect(opt.defaultValue).toBeUndefined();
  });
});

// ── option parsing (use parseOptions to avoid triggering async action) ────────

describe("registerUiCommand – option parsing", () => {
  function parseUiOpts(argv) {
    // Build a fresh program, get the 'ui' subcommand, and parse only its options
    // using parseOptions() which does NOT run the action handler.
    const program = buildProgram();
    const cmd = findCommand(program, "ui");
    cmd.parseOptions(argv);
    return cmd.opts();
  }

  it("parses --port 19000 correctly", () => {
    const opts = parseUiOpts(["--port", "19000", "--no-open"]);
    expect(opts.port).toBe("19000");
  });

  it("parses --ws-port 19001 correctly", () => {
    const opts = parseUiOpts(["--ws-port", "19001", "--no-open"]);
    expect(opts.wsPort).toBe("19001");
  });

  it("parses --no-open: sets opts.open to false", () => {
    const opts = parseUiOpts(["--no-open"]);
    expect(opts.open).toBe(false);
  });

  it("default opts.open is true when --no-open not passed", () => {
    // Without --no-open, Commander negation default is true
    const opts = parseUiOpts([]);
    expect(opts.open).toBe(true);
  });

  it("parses --token mysecret correctly", () => {
    const opts = parseUiOpts(["--token", "mysecret", "--no-open"]);
    expect(opts.token).toBe("mysecret");
  });
});

// ── --web-panel-dir option (v5.0.2.5) ────────────────────────────────────────

describe("registerUiCommand – --web-panel-dir option", () => {
  it("has --web-panel-dir option", () => {
    const program = buildProgram();
    const cmd = findCommand(program, "ui");
    expect(findOption(cmd, "--web-panel-dir")).not.toBeNull();
  });

  it("--web-panel-dir has no default value (auto-detect by default)", () => {
    const program = buildProgram();
    const cmd = findCommand(program, "ui");
    const opt = findOption(cmd, "--web-panel-dir");
    expect(opt.defaultValue).toBeUndefined();
  });

  it("parses --web-panel-dir /custom/dist correctly", () => {
    const program = buildProgram();
    const cmd = findCommand(program, "ui");
    cmd.parseOptions(["--web-panel-dir", "/custom/dist", "--no-open"]);
    expect(cmd.opts().webPanelDir).toBe("/custom/dist");
  });

  it("webPanelDir is undefined when not passed", () => {
    const program = buildProgram();
    const cmd = findCommand(program, "ui");
    cmd.parseOptions(["--no-open"]);
    expect(cmd.opts().webPanelDir).toBeUndefined();
  });
});

// ── --ui-mode option (Phase 0 of cc pack) ────────────────────────────────────

describe("registerUiCommand – --ui-mode option", () => {
  it("has --ui-mode option", () => {
    const program = buildProgram();
    const cmd = findCommand(program, "ui");
    expect(findOption(cmd, "--ui-mode")).not.toBeNull();
  });

  it('--ui-mode default is "auto"', () => {
    const program = buildProgram();
    const cmd = findCommand(program, "ui");
    cmd.parseOptions(["--no-open"]);
    expect(cmd.opts().uiMode).toBe("auto");
  });

  it("parses --ui-mode full", () => {
    const program = buildProgram();
    const cmd = findCommand(program, "ui");
    cmd.parseOptions(["--ui-mode", "full", "--no-open"]);
    expect(cmd.opts().uiMode).toBe("full");
  });

  it("parses --ui-mode minimal", () => {
    const program = buildProgram();
    const cmd = findCommand(program, "ui");
    cmd.parseOptions(["--ui-mode", "minimal", "--no-open"]);
    expect(cmd.opts().uiMode).toBe("minimal");
  });
});
