/**
 * video-editing-smoke.test.js — CutClaw pipeline end-to-end smoke test
 *
 * Generates synthetic video (3-color concat for scene detection) + sine audio
 * via ffmpeg, runs VideoPipeline.run() with no LLM, and asserts:
 *  - All 4 phase events fire
 *  - Cache artifacts exist (scene/audio/caption/shot_plan/shot_point json)
 *  - Output mp4 exists with non-zero size
 *  - Second run reuses deconstruct cache
 *
 * Skipped when ffmpeg is not on PATH.
 */

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const ffmpegAvailable = (() => {
  try {
    const r = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return r.status === 0;
  } catch {
    return false;
  }
})();

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-y", ...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString("utf-8")));
    proc.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-300)}`)),
    );
    proc.on("error", reject);
  });
}

function probeDuration(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "ffprobe",
      [
        "-v",
        "quiet",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        filePath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.on("close", (code) =>
      code === 0
        ? resolve(parseFloat(stdout.trim()) || 0)
        : reject(new Error(`ffprobe exit ${code}`)),
    );
    proc.on("error", reject);
  });
}

describe.skipIf(!ffmpegAvailable)(
  "E2E: video-editing CutClaw pipeline smoke test",
  () => {
    let tmpDir;
    let videoPath;
    let audioPath;
    let outputPath;
    let cacheDir;

    beforeAll(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cc-video-smoke-"));
      videoPath = path.join(tmpDir, "input.mp4");
      audioPath = path.join(tmpDir, "input.wav");
      outputPath = path.join(tmpDir, "output.mp4");
      cacheDir = path.join(tmpDir, "cache");

      // 9-second video: 3s red → 3s green → 3s blue (3 strong scene cuts)
      // with a silent stereo audio track (audio-mix requires [0:a] stream).
      // -g 15 forces keyframes every 0.5s so -c copy clip extraction always
      // finds a seekable keyframe near the requested start time.
      await runFfmpeg([
        "-f",
        "lavfi",
        "-i",
        "color=red:size=320x240:rate=30:duration=3",
        "-f",
        "lavfi",
        "-i",
        "color=green:size=320x240:rate=30:duration=3",
        "-f",
        "lavfi",
        "-i",
        "color=blue:size=320x240:rate=30:duration=3",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-filter_complex",
        "[0:v][1:v][2:v]concat=n=3:v=1[v]",
        "-map",
        "[v]",
        "-map",
        "3:a",
        "-shortest",
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-c:a",
        "aac",
        "-g",
        "15",
        "-keyint_min",
        "15",
        videoPath,
      ]);

      // 9-second 440Hz sine audio matching the video duration.
      await runFfmpeg([
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=9",
        "-c:a",
        "pcm_s16le",
        audioPath,
      ]);
    }, 60000);

    afterAll(async () => {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    });

    test("runs deconstruct → plan → assemble → render and produces output mp4", async () => {
      const { VideoPipeline } =
        await import("../../src/skills/video-editing/pipeline.js");

      const events = [];
      const pipeline = new VideoPipeline({
        videoPath,
        audioPath,
        outputPath,
        cacheDir,
        fps: 2,
        llmCall: null,
      });
      pipeline.on("event", (ev) => events.push(ev));

      const result = await pipeline.run();

      const phaseStarts = events
        .filter((e) => e.type === "phase.start")
        .map((e) => e.phase);
      expect(phaseStarts).toEqual(
        expect.arrayContaining(["deconstruct", "plan", "assemble", "render"]),
      );

      const phaseEnds = events
        .filter((e) => e.type === "phase.end")
        .map((e) => e.phase);
      expect(phaseEnds).toEqual(
        expect.arrayContaining(["deconstruct", "plan", "assemble", "render"]),
      );

      expect(result.outputPath).toBe(outputPath);
      expect(result.shotPlan).toBeDefined();
      expect(result.shotPlan.sections.length).toBeGreaterThan(0);
      expect(Array.isArray(result.shotPoints)).toBe(true);

      const stat = await fs.stat(outputPath);
      expect(stat.size).toBeGreaterThan(1000);

      const duration = await probeDuration(outputPath);
      expect(duration).toBeGreaterThan(0);
      expect(duration).toBeLessThanOrEqual(10);

      await fs.access(path.join(cacheDir, "scene.json"));
      await fs.access(path.join(cacheDir, "audio_beats.json"));
      await fs.access(path.join(cacheDir, "audio_caption.json"));
      await fs.access(path.join(cacheDir, "video_caption.json"));
      await fs.access(path.join(cacheDir, "shot_plan.json"));
      await fs.access(path.join(cacheDir, "shot_point.json"));

      const scenes = JSON.parse(
        await fs.readFile(path.join(cacheDir, "scene.json"), "utf-8"),
      );
      expect(scenes.scenes.length).toBeGreaterThanOrEqual(1);
    }, 180000);

    test("second deconstruct call reuses cache and emits cached:true", async () => {
      const { VideoPipeline } =
        await import("../../src/skills/video-editing/pipeline.js");

      const events = [];
      const pipeline = new VideoPipeline({
        videoPath,
        audioPath,
        outputPath: path.join(tmpDir, "output2.mp4"),
        cacheDir,
        fps: 2,
        llmCall: null,
      });
      pipeline.on("event", (ev) => events.push(ev));

      await pipeline.deconstruct();

      const deconstructEnd = events.find(
        (e) => e.type === "phase.end" && e.phase === "deconstruct",
      );
      expect(deconstructEnd).toBeDefined();
      expect(deconstructEnd.cached).toBe(true);
    }, 30000);

    test("pipeline surfaces structured phase.progress events", async () => {
      const { VideoPipeline } =
        await import("../../src/skills/video-editing/pipeline.js");

      const events = [];
      const pipeline = new VideoPipeline({
        videoPath,
        audioPath,
        outputPath: path.join(tmpDir, "output3.mp4"),
        cacheDir,
        fps: 2,
        llmCall: null,
      });
      pipeline.on("event", (ev) => events.push(ev));

      await pipeline.run();

      const progressEvents = events.filter((e) => e.type === "phase.progress");
      expect(progressEvents.length).toBeGreaterThan(0);
      for (const ev of progressEvents) {
        expect(ev.phase).toMatch(/^(deconstruct|plan|assemble|render)$/);
        if (ev.pct !== undefined) {
          expect(ev.pct).toBeGreaterThanOrEqual(0);
          expect(ev.pct).toBeLessThanOrEqual(1);
        }
      }
    }, 180000);
  },
);
