import { describe, expect, it, vi } from "vitest";
import { createSkillProcessBroker } from "../../src/lib/skill-process-broker.js";

describe("skill process broker facade", () => {
  it("enforces host-owned provenance for synchronous processes", () => {
    const runSync = vi.fn(() => ({ status: 0, stdout: "ok" }));
    const facade = createSkillProcessBroker(
      {
        id: "plugin/demo skill",
        pluginId: "demo-plugin",
        pluginVersion: "1.2.3",
        pluginSource: "local",
        capabilities: ["shell-exec"],
      },
      { run: vi.fn(), runSync, runFileSync: vi.fn() },
    );

    const result = facade.runSync("chainlesschain", ["note", "list"], {
      origin: "forged",
      policy: "deny",
      scope: "forged",
      shell: true,
    });

    expect(result.status).toBe(0);
    expect(runSync).toHaveBeenCalledWith(
      "chainlesschain",
      ["note", "list"],
      expect.objectContaining({
        origin: "skill:plugin-demo-skill",
        policy: "allow",
        scope: "skill",
        shell: true,
        pluginId: "demo-plugin",
        pluginVersion: "1.2.3",
        pluginSource: "local",
      }),
    );
    expect(Object.isFrozen(facade)).toBe(true);
  });

  it("forces literal no-shell execution for asynchronous processes", () => {
    const child = { pid: 4242 };
    const run = vi.fn(() => child);
    const facade = createSkillProcessBroker(
      { id: "audio-gen", capabilities: ["shell-exec"] },
      { run, runSync: vi.fn(), runFileSync: vi.fn() },
    );

    expect(
      facade.run("python", ["-m", "edge-tts", "--text", "hello world"], {
        shell: true,
        cwd: "/repo",
      }),
    ).toBe(child);
    expect(run).toHaveBeenCalledWith(
      "python",
      ["-m", "edge-tts", "--text", "hello world"],
      expect.objectContaining({
        cwd: "/repo",
        origin: "skill:audio-gen",
        policy: "allow",
        scope: "skill",
        shell: false,
      }),
    );
  });

  it("forces literal no-shell execution for file-style calls", () => {
    const runFileSync = vi.fn(() => "output");
    const facade = createSkillProcessBroker(
      { name: "cli-anything-ffmpeg", capabilities: ["shell-exec"] },
      { run: vi.fn(), runSync: vi.fn(), runFileSync },
    );

    expect(
      facade.runFileSync("cli-anything-ffmpeg", ["convert", "a b.mp4"], {
        shell: true,
        cwd: "/repo",
      }),
    ).toBe("output");
    expect(runFileSync).toHaveBeenCalledWith(
      "cli-anything-ffmpeg",
      ["convert", "a b.mp4"],
      expect.objectContaining({
        cwd: "/repo",
        origin: "skill:cli-anything-ffmpeg",
        policy: "allow",
        scope: "skill",
        shell: false,
      }),
    );
  });

  it("does not expose execution to skills without shell-exec", () => {
    expect(createSkillProcessBroker({ id: "docs-only" })).toBeNull();
  });
});
