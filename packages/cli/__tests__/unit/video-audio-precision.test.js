/**
 * video-audio-precision.test.js — Phase 4 tests
 * Covers: beat-snap, madmom output parsing, ducking filter, CLI flags
 */

import { describe, test, expect, vi } from "vitest";
import {
  snapToBeats,
  findNearestBeat,
  snapDurationToBeats,
  buildBeatGrid,
} from "../../src/skills/video-editing/beat-snap.js";
import {
  buildDuckingFilter,
  buildSimpleFilter,
} from "../../src/skills/video-editing/render/audio-mix.js";

// ── findNearestBeat ─────────────────────────────────────────

describe("findNearestBeat", () => {
  const beats = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];

  test("snaps to exact beat", () => {
    expect(findNearestBeat(1.0, beats)).toBe(1.0);
  });

  test("snaps to nearest beat within tolerance", () => {
    expect(findNearestBeat(1.15, beats, 0.3)).toBe(1.0);
  });

  test("snaps forward to closer beat", () => {
    expect(findNearestBeat(1.4, beats, 0.3)).toBe(1.5);
  });

  test("returns original if outside tolerance", () => {
    expect(findNearestBeat(1.3, beats, 0.1)).toBe(1.3);
  });

  test("returns original with empty beats", () => {
    expect(findNearestBeat(1.0, [])).toBe(1.0);
  });

  test("returns original with null beats", () => {
    expect(findNearestBeat(1.0, null)).toBe(1.0);
  });
});

// ── snapDurationToBeats ─────────────────────────────────────

describe("snapDurationToBeats", () => {
  const beats = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0];

  test("snaps duration to beat multiple", () => {
    const result = snapDurationToBeats(2.6, beats, 0.5);
    expect(result).toBe(2.5);
  });

  test("returns original if too far from any beat multiple", () => {
    const result = snapDurationToBeats(2.8, beats, 0.1);
    expect(result).toBe(2.8);
  });

  test("handles empty beats", () => {
    expect(snapDurationToBeats(3.0, [])).toBe(3.0);
  });

  test("handles single beat", () => {
    expect(snapDurationToBeats(3.0, [1.0])).toBe(3.0);
  });
});

// ── snapToBeats ─────────────────────────────────────────────

describe("snapToBeats", () => {
  const beats = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0];

  test("snaps music_segment start/end to beats", () => {
    const plan = {
      sections: [
        {
          section_idx: 0,
          music_segment: { start: 0.15, end: 2.85 },
          shots: [{ shot_idx: 0, target_duration: 2.6 }],
        },
      ],
    };
    const result = snapToBeats(plan, beats);
    expect(result.sections[0].music_segment.start).toBe(0);
    expect(result.sections[0].music_segment.end).toBe(3.0);
  });

  test("preserves structure with no beats", () => {
    const plan = { sections: [{ section_idx: 0, shots: [] }] };
    const result = snapToBeats(plan, []);
    expect(result).toEqual(plan);
  });

  test("preserves shot without target_duration", () => {
    const plan = {
      sections: [
        {
          section_idx: 0,
          shots: [{ shot_idx: 0, emotion: "happy" }],
        },
      ],
    };
    const result = snapToBeats(plan, beats);
    expect(result.sections[0].shots[0].emotion).toBe("happy");
    expect(result.sections[0].shots[0].target_duration).toBeUndefined();
  });

  test("does not mutate original plan", () => {
    const plan = {
      sections: [
        {
          section_idx: 0,
          music_segment: { start: 0.15, end: 2.85 },
          shots: [{ shot_idx: 0, target_duration: 2.6 }],
        },
      ],
    };
    snapToBeats(plan, beats);
    expect(plan.sections[0].music_segment.start).toBe(0.15);
  });
});

// ── buildBeatGrid ───────────────────────────────────────────

describe("buildBeatGrid", () => {
  test("builds bars from downbeats", () => {
    const beats = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0];
    const downbeats = [0.5, 2.5];
    const grid = buildBeatGrid(beats, downbeats);
    expect(grid.bars).toHaveLength(2);
    expect(grid.bars[0].start).toBe(0.5);
    expect(grid.bars[0].end).toBe(2.5);
    expect(grid.bars[0].beats).toHaveLength(4);
  });

  test("returns empty for no beats", () => {
    const grid = buildBeatGrid([], []);
    expect(grid.bars).toHaveLength(0);
    expect(grid.beatsPerBar).toBe(4);
  });

  test("uses default chunk when no downbeats", () => {
    const beats = Array.from({ length: 16 }, (_, i) => i * 0.5);
    const grid = buildBeatGrid(beats, []);
    expect(grid.bars.length).toBeGreaterThan(0);
  });

  test("detects 3/4 time signature", () => {
    const beats = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0];
    const downbeats = [0, 1.5, 3.0];
    const grid = buildBeatGrid(beats, downbeats);
    expect(grid.beatsPerBar).toBe(3);
  });
});

// ── buildDuckingFilter ──────────────────────────────────────

describe("buildDuckingFilter", () => {
  test("produces valid filter with defaults", () => {
    const filter = buildDuckingFilter();
    expect(filter).toContain("sidechaincompress");
    expect(filter).toContain("afade");
    expect(filter).toContain("loudnorm");
    expect(filter).toContain("[aout]");
  });

  test("uses custom bgmVolume", () => {
    const filter = buildDuckingFilter({ bgmVolume: 0.5 });
    expect(filter).toContain("volume=0.5");
  });

  test("uses custom fadeOutDuration", () => {
    const filter = buildDuckingFilter({ fadeOutDuration: 5 });
    expect(filter).toContain("d=5");
  });

  test("sidechaincompress has correct input order [bgm][speech]", () => {
    const filter = buildDuckingFilter();
    const scIdx = filter.indexOf("sidechaincompress");
    const prefix = filter.slice(Math.max(0, scIdx - 30), scIdx);
    expect(prefix).toContain("[bgm_norm][speech]");
  });
});

// ── buildSimpleFilter ───────────────────────────────────────

describe("buildSimpleFilter", () => {
  test("produces valid filter with defaults", () => {
    const filter = buildSimpleFilter();
    expect(filter).toContain("[aout]");
    expect(filter).toContain("volume=0.3");
    expect(filter).toContain("amix");
  });

  test("does not contain sidechaincompress", () => {
    expect(buildSimpleFilter()).not.toContain("sidechaincompress");
  });
});

// ── madmom output parsing ───────────────────────────────────

describe("madmom output parsing", () => {
  test("madmom-beats.py output structure is parseable", () => {
    const sampleOutput = {
      duration: 180.5,
      tempo: 128.0,
      beats: [0.48, 0.96, 1.44, 1.92],
      downbeats: [0.48, 1.92],
      segments: [
        { idx: 0, start: 0, end: 12.5, label: "intro", beat_count: 16 },
      ],
    };
    expect(sampleOutput.beats).toHaveLength(4);
    expect(sampleOutput.segments[0].label).toBe("intro");
    const grid = buildBeatGrid(sampleOutput.beats, sampleOutput.downbeats);
    expect(grid.bars.length).toBeGreaterThan(0);
  });

  test("snapToBeats works with madmom-style beats", () => {
    const beats = [0.48, 0.96, 1.44, 1.92, 2.4, 2.88, 3.36, 3.84];
    const plan = {
      sections: [
        {
          section_idx: 0,
          music_segment: { start: 0.5, end: 3.0 },
          shots: [{ shot_idx: 0, target_duration: 2.5 }],
        },
      ],
    };
    const result = snapToBeats(plan, beats);
    expect(result.sections[0].music_segment.start).toBe(0.48);
    expect(result.sections[0].music_segment.end).toBe(2.88);
  });
});

// ── CLI flag wiring ─────────────────────────────────────────

describe("CLI video command flags", () => {
  test("video.js exports registerVideoCommand", async () => {
    const mod = await import("../../src/commands/video.js");
    expect(typeof mod.registerVideoCommand).toBe("function");
  });

  test("edit command accepts Phase 4 flags", async () => {
    const fs = await import("fs");
    const code = fs.readFileSync("src/commands/video.js", "utf-8");
    expect(code).toContain("--use-madmom");
    expect(code).toContain("--snap-beats");
    expect(code).toContain("--ducking");
    expect(code).toContain("useMadmom");
    expect(code).toContain("snapBeats");
  });

  test("deconstruct command accepts --use-madmom", async () => {
    const fs = await import("fs");
    const code = fs.readFileSync("src/commands/video.js", "utf-8");
    const deconstructSection = code.slice(
      code.indexOf("deconstruct"),
      code.indexOf("cc video plan"),
    );
    expect(deconstructSection).toContain("--use-madmom");
  });
});

// ── pipeline wiring ─────────────────────────────────────────

describe("pipeline Phase 4 wiring", () => {
  test("pipeline imports beat-snap", async () => {
    const fs = await import("fs");
    const code = fs.readFileSync(
      "src/skills/video-editing/pipeline.js",
      "utf-8",
    );
    expect(code).toContain("beat-snap.js");
    expect(code).toContain("snapToBeats");
    expect(code).toContain("useMadmom");
    expect(code).toContain("snapBeats");
    expect(code).toContain("ducking");
  });

  test("VideoPipeline constructor accepts Phase 4 options", async () => {
    const { VideoPipeline } =
      await import("../../src/skills/video-editing/pipeline.js");
    const p = new VideoPipeline({
      videoPath: "v.mp4",
      useMadmom: true,
      snapBeats: true,
      ducking: true,
    });
    expect(p.useMadmom).toBe(true);
    expect(p.snapBeats).toBe(true);
    expect(p.ducking).toBe(true);
  });
});
