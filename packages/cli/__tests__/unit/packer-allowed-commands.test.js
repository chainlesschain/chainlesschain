/**
 * Unit tests: Phase 3a — createProgram allowedCommands whitelist
 *
 * When cc pack --project embeds a project with pack.allowedSubcommands,
 * the packed exe sets CC_PROJECT_ALLOWED_SUBCOMMANDS before calling
 * createProgram(). Only the listed top-level commands should survive.
 * The opts.allowedCommands Set is the programmatic equivalent used here
 * for testing without touching the environment.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createProgram } from "../../src/index.js";

describe("createProgram — allowedCommands whitelist (Phase 3a)", () => {
  // ── opts.allowedCommands ───────────────────────────────────────────────
  it("returns all commands when allowedCommands is not provided", () => {
    const program = createProgram();
    expect(program.commands.length).toBeGreaterThan(10);
  });

  it("retains only listed commands when allowedCommands Set is given", () => {
    const allowed = new Set(["chat", "agent", "ui"]);
    const program = createProgram({ allowedCommands: allowed });
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("chat");
    expect(names).toContain("agent");
    expect(names).toContain("ui");
    // A command definitely registered but not in the allow-list must be gone
    expect(names).not.toContain("wallet");
    expect(names).not.toContain("dao");
    expect(names).not.toContain("setup");
  });

  it("empty allowedCommands Set is treated as no-filter (all commands retained)", () => {
    const program = createProgram({ allowedCommands: new Set() });
    expect(program.commands.length).toBeGreaterThan(10);
  });

  it("single-command whitelist leaves exactly that one command", () => {
    const program = createProgram({ allowedCommands: new Set(["chat"]) });
    const names = program.commands.map((c) => c.name());
    expect(names).toEqual(["chat"]);
  });

  it("unknown names in allowedCommands silently produce no commands", () => {
    const program = createProgram({
      allowedCommands: new Set(["nonexistent-command-xyz"]),
    });
    expect(program.commands.length).toBe(0);
  });

  // ── CC_PROJECT_ALLOWED_SUBCOMMANDS env var ────────────────────────────
  describe("env var CC_PROJECT_ALLOWED_SUBCOMMANDS", () => {
    const ENV_KEY = "CC_PROJECT_ALLOWED_SUBCOMMANDS";
    let saved;

    beforeEach(() => {
      saved = process.env[ENV_KEY];
      delete process.env[ENV_KEY];
    });

    afterEach(() => {
      if (saved !== undefined) {
        process.env[ENV_KEY] = saved;
      } else {
        delete process.env[ENV_KEY];
      }
    });

    it("filters commands via env var when opts.allowedCommands is absent", () => {
      process.env[ENV_KEY] = "chat,agent,skill";
      const program = createProgram();
      const names = program.commands.map((c) => c.name());
      expect(names).toContain("chat");
      expect(names).toContain("agent");
      expect(names).toContain("skill");
      expect(names).not.toContain("wallet");
    });

    it("opts.allowedCommands takes precedence over env var", () => {
      process.env[ENV_KEY] = "wallet,dao";
      // opts overrides env: only "chat" should survive
      const program = createProgram({ allowedCommands: new Set(["chat"]) });
      const names = program.commands.map((c) => c.name());
      expect(names).toEqual(["chat"]);
    });

    it("env var with whitespace around commas is trimmed correctly", () => {
      process.env[ENV_KEY] = "  chat , agent , ui  ";
      const program = createProgram();
      const names = program.commands.map((c) => c.name());
      expect(names).toContain("chat");
      expect(names).toContain("agent");
      expect(names).toContain("ui");
      expect(names).not.toContain("wallet");
    });

    it("unset env var retains all commands", () => {
      // env var is deleted in beforeEach
      const program = createProgram();
      expect(program.commands.length).toBeGreaterThan(10);
    });
  });
});
