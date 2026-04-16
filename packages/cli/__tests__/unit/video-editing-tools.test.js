/**
 * video-editing-tools.test.js — Editor 工具 + Extractors + Render 单元测试
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

// ── review-clip ─────────────────────────────────────────────

describe("video_review_clip", () => {
  let execute;
  beforeEach(async () => {
    const mod =
      await import("../../src/skills/video-editing/tools/review-clip.js");
    execute = mod.execute;
  });

  test("no conflict when no committed clips", () => {
    const result = execute({ start: 10, end: 15 }, { committedClips: [] });
    expect(result.has_conflict).toBe(false);
    expect(result.overlaps).toHaveLength(0);
  });

  test("detects overlap with committed clip", () => {
    const ctx = { committedClips: [{ start: 12, end: 18 }] };
    const result = execute({ start: 10, end: 15 }, ctx);
    expect(result.has_conflict).toBe(true);
    expect(result.overlaps).toHaveLength(1);
    expect(result.overlaps[0].overlap_start).toBe(12);
    expect(result.overlaps[0].overlap_end).toBe(15);
  });

  test("no conflict when ranges do not overlap", () => {
    const ctx = { committedClips: [{ start: 20, end: 25 }] };
    const result = execute({ start: 10, end: 15 }, ctx);
    expect(result.has_conflict).toBe(false);
  });

  test("detects multiple overlaps", () => {
    const ctx = {
      committedClips: [
        { start: 5, end: 12 },
        { start: 14, end: 20 },
      ],
    };
    const result = execute({ start: 10, end: 16 }, ctx);
    expect(result.has_conflict).toBe(true);
    expect(result.overlaps).toHaveLength(2);
  });

  test("suggestion includes time ranges on conflict", () => {
    const ctx = { committedClips: [{ start: 10, end: 20 }] };
    const result = execute({ start: 15, end: 25 }, ctx);
    expect(result.suggestion).toContain("Avoid");
  });

  test("TOOL_DEF has correct name and schema", async () => {
    const { TOOL_DEF } =
      await import("../../src/skills/video-editing/tools/review-clip.js");
    expect(TOOL_DEF.name).toBe("video_review_clip");
    expect(TOOL_DEF.isReadOnly).toBe(true);
  });
});

// ── commit ──────────────────────────────────────────────────

describe("video_commit_clip", () => {
  let execute;
  beforeEach(async () => {
    const mod = await import("../../src/skills/video-editing/tools/commit.js");
    execute = mod.execute;
  });

  test("commits a single clip", async () => {
    const ctx = { committedClips: [] };
    const result = await execute(
      { section_idx: 0, shot_idx: 0, clips: [{ start: 10, end: 15 }] },
      ctx,
    );
    expect(result.status).toBe("success");
    expect(result.total_duration).toBeCloseTo(5);
    expect(ctx.committedClips).toHaveLength(1);
  });

  test("rejects empty clips", async () => {
    const result = await execute(
      { section_idx: 0, shot_idx: 0, clips: [] },
      { committedClips: [] },
    );
    expect(result.status).toBe("error");
  });

  test("rejects more than 3 clips", async () => {
    const clips = Array.from({ length: 4 }, (_, i) => ({
      start: i * 10,
      end: i * 10 + 5,
    }));
    const result = await execute(
      { section_idx: 0, shot_idx: 0, clips },
      { committedClips: [] },
    );
    expect(result.status).toBe("error");
    expect(result.message).toContain("Max 3");
  });

  test("rejects invalid clip (start >= end)", async () => {
    const result = await execute(
      { section_idx: 0, shot_idx: 0, clips: [{ start: 20, end: 10 }] },
      { committedClips: [] },
    );
    expect(result.status).toBe("error");
  });

  test("detects conflict with committed clip", async () => {
    const ctx = { committedClips: [{ start: 10, end: 20 }] };
    const result = await execute(
      { section_idx: 0, shot_idx: 0, clips: [{ start: 15, end: 25 }] },
      ctx,
    );
    expect(result.status).toBe("conflict");
  });

  test("commits multiple clips (stitching)", async () => {
    const ctx = { committedClips: [] };
    const result = await execute(
      {
        section_idx: 1,
        shot_idx: 2,
        clips: [
          { start: 0, end: 3 },
          { start: 10, end: 14 },
        ],
      },
      ctx,
    );
    expect(result.status).toBe("success");
    expect(result.clips).toHaveLength(2);
    expect(result.total_duration).toBeCloseTo(7);
    expect(ctx.committedClips).toHaveLength(2);
  });

  test("TOOL_DEF has MEDIUM risk", async () => {
    const { TOOL_DEF } =
      await import("../../src/skills/video-editing/tools/commit.js");
    expect(TOOL_DEF.riskLevel).toBe("MEDIUM");
    expect(TOOL_DEF.availableInPlanMode).toBe(false);
  });
});

// ── semantic-retrieval ──────────────────────────────────────

describe("video_semantic_retrieval", () => {
  let execute;
  const mockFs = vi.hoisted(() => ({
    readFile: vi.fn(),
  }));

  vi.mock("fs", () => ({ promises: mockFs }));

  beforeEach(async () => {
    const mod =
      await import("../../src/skills/video-editing/tools/semantic-retrieval.js");
    execute = mod.execute;
  });

  test("returns candidates within range", async () => {
    const scenes = [
      { time: 0 },
      { time: 5 },
      { time: 10 },
      { time: 15 },
      { time: 20 },
    ];
    mockFs.readFile.mockResolvedValue(JSON.stringify({ scenes }));

    const result = await execute(
      { scene_start: 1, scene_end: 3 },
      { assetDir: "/mock" },
    );
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates[0].scene_idx).toBe(1);
    expect(result.range).toEqual([1, 3]);
  });

  test("clamps out-of-range indices", async () => {
    const scenes = [{ time: 0 }, { time: 5 }];
    mockFs.readFile.mockResolvedValue(JSON.stringify({ scenes }));

    const result = await execute(
      { scene_start: -5, scene_end: 100 },
      { assetDir: "/mock" },
    );
    expect(result.candidates).toHaveLength(2);
  });

  test("filters by query", async () => {
    const scenes = [
      { time: 0, label: "fight" },
      { time: 5, label: "romance" },
    ];
    mockFs.readFile.mockResolvedValue(JSON.stringify({ scenes }));

    const result = await execute(
      { scene_start: 0, scene_end: 1, query: "fight" },
      { assetDir: "/mock" },
    );
    expect(result.candidates).toHaveLength(1);
  });
});

// ── subtitle parser ─────────────────────────────────────────

describe("parseSrt", () => {
  let parseSrt;
  beforeEach(async () => {
    const mod =
      await import("../../src/skills/video-editing/extractors/audio-extractor.js");
    parseSrt = mod.parseSrt;
  });

  test("parses basic SRT content", () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
Hello world

2
00:00:05,000 --> 00:00:08,000
Goodbye world`;
    const result = parseSrt(srt);
    expect(result).toHaveLength(2);
    expect(result[0].start).toBeCloseTo(1.0);
    expect(result[0].end).toBeCloseTo(4.0);
    expect(result[0].text).toBe("Hello world");
    expect(result[1].text).toBe("Goodbye world");
  });

  test("handles empty content", () => {
    expect(parseSrt("")).toHaveLength(0);
  });
});

// ── subtitle extractor (VTT) ────────────────────────────────

describe("identifyCharacters", () => {
  test("returns empty speakers without llmCall", async () => {
    const { identifyCharacters } =
      await import("../../src/skills/video-editing/extractors/subtitle-extractor.js");
    const result = await identifyCharacters([{ text: "hello" }]);
    expect(result).toEqual({ speakers: {} });
  });

  test("groups speakers from bracketed text", async () => {
    const { identifyCharacters } =
      await import("../../src/skills/video-editing/extractors/subtitle-extractor.js");
    const mockLlm = vi
      .fn()
      .mockResolvedValue({ speakers: { JOE: { name: "Joe" } } });
    const result = await identifyCharacters(
      [{ text: "[JOE] Hello" }, { text: "[JOE] World" }],
      { llmCall: mockLlm },
    );
    expect(mockLlm).toHaveBeenCalled();
    expect(result.speakers.JOE.name).toBe("Joe");
  });
});

// ── pipeline getCacheDir ────────────────────────────────────

describe("getCacheDir", () => {
  test("returns deterministic hash-based path", async () => {
    const { getCacheDir } =
      await import("../../src/skills/video-editing/pipeline.js");
    const dir1 = getCacheDir("/a.mp4", "/b.mp3");
    const dir2 = getCacheDir("/a.mp4", "/b.mp3");
    expect(dir1).toBe(dir2);
    expect(dir1).toContain("video-editing");
  });

  test("different inputs produce different dirs", async () => {
    const { getCacheDir } =
      await import("../../src/skills/video-editing/pipeline.js");
    const dir1 = getCacheDir("/a.mp4", "/b.mp3");
    const dir2 = getCacheDir("/c.mp4", "/d.mp3");
    expect(dir1).not.toBe(dir2);
  });
});
