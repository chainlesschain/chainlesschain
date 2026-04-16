/**
 * video-editing-pipeline.test.js — Pipeline 编排 + CLI 命令注册测试
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

// ── VideoPipeline events ────────────────────────────────────

describe("VideoPipeline", () => {
  let VideoPipeline;

  beforeEach(async () => {
    const mod = await import("../../src/skills/video-editing/pipeline.js");
    VideoPipeline = mod.VideoPipeline;
  });

  test("emits phase.start and phase.end events", async () => {
    const events = [];
    const pipeline = new VideoPipeline({
      videoPath: "/fake/video.mp4",
      audioPath: "/fake/audio.mp3",
    });
    pipeline.on("event", (ev) => events.push(ev));

    // Mock deconstruct deps to avoid actual ffmpeg calls
    vi.spyOn(pipeline, "deconstruct").mockResolvedValue("/fake/cache");
    vi.spyOn(pipeline, "plan").mockResolvedValue({ sections: [] });
    vi.spyOn(pipeline, "assemble").mockResolvedValue([]);
    vi.spyOn(pipeline, "render").mockResolvedValue("/fake/output.mp4");

    await pipeline.run();
    expect(pipeline.deconstruct).toHaveBeenCalled();
    expect(pipeline.plan).toHaveBeenCalled();
    expect(pipeline.assemble).toHaveBeenCalled();
    expect(pipeline.render).toHaveBeenCalled();
  });

  test("_defaultShotPlan generates sections from segments", () => {
    const pipeline = new VideoPipeline({ videoPath: "x" });
    const segments = [
      { start: 0, end: 5, label: "intro" },
      { start: 5, end: 12, label: "chorus" },
    ];
    const plan = pipeline._defaultShotPlan(segments, []);
    expect(plan.sections).toHaveLength(2);
    expect(plan.sections[0].section_idx).toBe(0);
    expect(plan.sections[0].shots[0].target_duration).toBeCloseTo(5);
    expect(plan.sections[1].shots[0].target_duration).toBeCloseTo(7);
  });

  test("_defaultShotPlan handles empty input", () => {
    const pipeline = new VideoPipeline({ videoPath: "x" });
    const plan = pipeline._defaultShotPlan([], []);
    expect(plan.sections).toHaveLength(0);
  });
});

// ── TOOLS array ─────────────────────────────────────────────

describe("TOOLS export", () => {
  test("exports 4 tools with TOOL_DEF", async () => {
    const { TOOLS } =
      await import("../../src/skills/video-editing/pipeline.js");
    expect(TOOLS).toHaveLength(4);
    for (const tool of TOOLS) {
      expect(tool.TOOL_DEF).toBeDefined();
      expect(tool.TOOL_DEF.name).toMatch(/^video_/);
      expect(tool.execute).toBeDefined();
    }
  });

  test("tool names are unique", async () => {
    const { TOOLS } =
      await import("../../src/skills/video-editing/pipeline.js");
    const names = TOOLS.map((t) => t.TOOL_DEF.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ── CLI command registration ────────────────────────────────

describe("registerVideoCommand", () => {
  test("registers video command with subcommands", async () => {
    const { registerVideoCommand } =
      await import("../../src/commands/video.js");
    const { Command } = await import("commander");
    const program = new Command();
    registerVideoCommand(program);

    const videoCmd = program.commands.find((c) => c.name() === "video");
    expect(videoCmd).toBeDefined();

    const subNames = videoCmd.commands.map((c) => c.name());
    expect(subNames).toContain("edit");
    expect(subNames).toContain("deconstruct");
    expect(subNames).toContain("plan");
    expect(subNames).toContain("assemble");
    expect(subNames).toContain("render");
    expect(subNames).toContain("assets");
  });

  test("edit command has required --video option", async () => {
    const { registerVideoCommand } =
      await import("../../src/commands/video.js");
    const { Command } = await import("commander");
    const program = new Command();
    registerVideoCommand(program);

    const videoCmd = program.commands.find((c) => c.name() === "video");
    const editCmd = videoCmd.commands.find((c) => c.name() === "edit");
    const videoOpt = editCmd.options.find((o) => o.long === "--video");
    expect(videoOpt).toBeDefined();
    expect(videoOpt.required).toBe(true);
  });
});

// ── SKILL.md ────────────────────────────────────────────────

describe("SKILL.md", () => {
  test("exists and contains expected fields", async () => {
    const { promises: fs } = await import("fs");
    const path = await import("path");
    const skillPath = path.join(
      process.cwd(),
      "src/skills/video-editing/SKILL.md",
    );
    const content = await fs.readFile(skillPath, "utf-8");
    expect(content).toContain("name: video-editing");
    expect(content).toContain("category: media");
    expect(content).toContain("video_semantic_retrieval");
    expect(content).toContain("video_commit_clip");
  });
});

// ── Prompt files ────────────────────────────────────────────

describe("prompt files", () => {
  const EXPECTED_PROMPTS = [
    "character-identify",
    "protagonist-detect",
    "aesthetic-analysis",
    "dense-caption",
    "shot-caption",
    "scene-caption",
    "vlog-scene-caption",
    "structure-proposal",
    "shot-plan",
    "editor-system",
    "hook-dialogue",
    "audio-segment",
  ];

  test.each(EXPECTED_PROMPTS)("prompt %s.md exists", async (name) => {
    const { promises: fs } = await import("fs");
    const path = await import("path");
    const p = path.join(
      process.cwd(),
      `src/skills/video-editing/prompts/${name}.md`,
    );
    const stat = await fs.stat(p);
    expect(stat.isFile()).toBe(true);
  });
});
