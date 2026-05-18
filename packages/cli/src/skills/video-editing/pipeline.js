/**
 * pipeline.js — 视频剪辑编排入口
 *
 * 四阶段：deconstruct → plan → assemble → render
 * 通过 EventEmitter 吐统一进度事件（CLI --stream / Web stream.event 消费）
 */

import { EventEmitter } from "events";
import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";
import { runVideoExtractor } from "./extractors/video-extractor.js";
import { runAudioExtractor } from "./extractors/audio-extractor.js";
import * as semanticRetrieval from "./tools/semantic-retrieval.js";
import * as shotTrimming from "./tools/shot-trimming.js";
import * as reviewClip from "./tools/review-clip.js";
import * as commitClip from "./tools/commit.js";
import { ParallelShotOrchestrator } from "./parallel-orchestrator.js";
import { reviewEntry, createQualityCheckPolicy } from "./reviewer.js";
import { snapToBeats } from "./beat-snap.js";

export const TOOLS = [semanticRetrieval, shotTrimming, reviewClip, commitClip];

export function getCacheDir(videoPath, audioPath) {
  const hash = createHash("sha256")
    .update(videoPath)
    .update(audioPath || "")
    .digest("hex")
    .slice(0, 16);
  const base = process.env.APPDATA
    ? path.join(
        process.env.APPDATA,
        "chainlesschain-desktop-vue",
        ".chainlesschain",
      )
    : path.join(process.env.HOME || "~", ".chainlesschain");
  return path.join(base, "video-editing", hash);
}

export class VideoPipeline extends EventEmitter {
  constructor(options = {}) {
    super();
    this.videoPath = options.videoPath;
    this.audioPath = options.audioPath;
    this.instruction = options.instruction || "";
    this.outputPath = options.outputPath || "./output.mp4";
    this.llmCall = options.llmCall || null;
    this.existingSrt = options.existingSrt || null;
    this.fps = options.fps || 2;
    this.mainCharacter = options.mainCharacter || "";
    this.useMadmom = options.useMadmom || false;
    this.snapBeats = options.snapBeats || false;
    this.ducking = options.ducking || false;
    this.cacheDir =
      options.cacheDir || getCacheDir(this.videoPath, this.audioPath);
  }

  _emit(type, data = {}) {
    const ev = { type, ts: Date.now(), ...data };
    this.emit("event", ev);
    return ev;
  }

  // ── Phase 1: Deconstruct ──────────────────────────────────

  async deconstruct() {
    this._emit("phase.start", { phase: "deconstruct" });
    await fs.mkdir(this.cacheDir, { recursive: true });

    const meta = { videoPath: this.videoPath, audioPath: this.audioPath };
    const metaPath = path.join(this.cacheDir, "meta.json");

    try {
      const existing = JSON.parse(await fs.readFile(metaPath, "utf-8"));
      if (
        existing.videoPath === this.videoPath &&
        existing.audioPath === this.audioPath
      ) {
        this._emit("phase.progress", {
          phase: "deconstruct",
          pct: 1,
          message: "Using cache",
        });
        this._emit("phase.end", { phase: "deconstruct", cached: true });
        return this.cacheDir;
      }
    } catch {}

    this._emit("phase.progress", {
      phase: "deconstruct",
      pct: 0.1,
      message: "Extracting frames",
    });
    await runVideoExtractor(this.videoPath, this.cacheDir, {
      fps: this.fps,
      llmCall: this.llmCall,
    });

    this._emit("phase.progress", {
      phase: "deconstruct",
      pct: 0.6,
      message: "Analyzing audio",
    });
    if (this.audioPath) {
      await runAudioExtractor(this.audioPath, this.cacheDir, {
        existingSrt: this.existingSrt,
        llmCall: this.llmCall,
        useMadmom: this.useMadmom,
      });
    }

    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    this._emit("phase.end", { phase: "deconstruct" });
    return this.cacheDir;
  }

  // ── Phase 2: Plan (Screenwriter) ─────────────────────────

  async plan(assetDir) {
    this._emit("phase.start", { phase: "plan" });
    const dir = assetDir || this.cacheDir;

    let scenes = { scenes: [] };
    let audioCaption = { segments: [] };
    try {
      scenes = JSON.parse(
        await fs.readFile(path.join(dir, "scene.json"), "utf-8"),
      );
    } catch {}
    try {
      audioCaption = JSON.parse(
        await fs.readFile(path.join(dir, "audio_caption.json"), "utf-8"),
      );
    } catch {}

    let shotPlan;
    if (this.llmCall) {
      shotPlan = await this.llmCall({
        type: "shot-plan",
        instruction: this.instruction,
        mainCharacter: this.mainCharacter,
        scenes: scenes.scenes,
        audioSegments: audioCaption.segments,
      });
    } else {
      shotPlan = this._defaultShotPlan(
        audioCaption.segments || [],
        scenes.scenes || [],
      );
    }

    if (this.snapBeats) {
      try {
        const beatsData = JSON.parse(
          await fs.readFile(path.join(dir, "audio_beats.json"), "utf-8"),
        );
        if (beatsData.beats && beatsData.beats.length > 0) {
          shotPlan = snapToBeats(shotPlan, beatsData.beats);
          this._emit("phase.progress", {
            phase: "plan",
            pct: 0.9,
            message: "Beat-snapped",
          });
        }
      } catch {}
    }

    const planPath = path.join(dir, "shot_plan.json");
    await fs.writeFile(planPath, JSON.stringify(shotPlan, null, 2));
    this._emit("phase.end", { phase: "plan", output: planPath });
    return shotPlan;
  }

  _defaultShotPlan(segments, scenes) {
    return {
      sections: segments.map((seg, i) => ({
        section_idx: i,
        music_segment: { start: seg.start, end: seg.end, label: seg.label },
        shots: [
          {
            shot_idx: 0,
            target_duration: parseFloat((seg.end - seg.start).toFixed(3)),
            emotion: "neutral",
            visual_target: `Scene near segment ${i}`,
          },
        ],
      })),
    };
  }

  // ── Phase 3: Assemble (Editor ReAct) ─────────────────────

  async assemble(shotPlan, assetDir) {
    this._emit("phase.start", { phase: "assemble" });
    const dir = assetDir || this.cacheDir;
    const shotPointPath = path.join(dir, "shot_point.json");
    await fs.writeFile(shotPointPath, "[]");

    const committedClips = [];
    const context = {
      assetDir: dir,
      committedClips,
      shotPointPath,
      llmCall: this.llmCall,
    };

    const sections = shotPlan.sections || [];
    const totalShots = sections.reduce(
      (s, sec) => s + (sec.shots?.length || 0),
      0,
    );
    let done = 0;

    for (const section of sections) {
      for (const shot of section.shots || []) {
        this._emit("phase.progress", {
          phase: "assemble",
          pct: parseFloat((done / Math.max(totalShots, 1)).toFixed(2)),
          message: `Section ${section.section_idx} Shot ${shot.shot_idx}`,
        });

        await this._runEditorLoop(section, shot, context);
        done++;
      }
    }

    this._emit("phase.end", { phase: "assemble", output: shotPointPath });

    const result = JSON.parse(await fs.readFile(shotPointPath, "utf-8"));
    return result;
  }

  async _runEditorLoop(section, shot, context) {
    const musicSeg = section.music_segment || {};
    const scenes = await this._loadScenes(context.assetDir);
    const totalScenes = scenes.length;

    const sceneStart = Math.floor(
      (musicSeg.start / (musicSeg.end || 1)) * totalScenes,
    );
    const sceneEnd = Math.min(
      sceneStart + Math.ceil(totalScenes * 0.3),
      totalScenes - 1,
    );

    this._emit("agent.tool_call", {
      agent: "editor",
      tool: "video_semantic_retrieval",
      args: { scene_start: sceneStart, scene_end: sceneEnd },
    });
    const candidates = await semanticRetrieval.execute(
      { scene_start: sceneStart, scene_end: sceneEnd },
      context,
    );

    if (candidates.candidates.length === 0) return;

    const picked = candidates.candidates[0];
    const startTime = picked.time || 0;
    const endTime = startTime + (shot.target_duration || 3);

    this._emit("agent.tool_call", {
      agent: "editor",
      tool: "video_review_clip",
      args: { start: startTime, end: endTime },
    });
    const review = reviewClip.execute(
      { start: startTime, end: endTime },
      context,
    );

    if (review.has_conflict) {
      this._emit("review.fail", {
        reason: review.suggestion,
        willRerun: false,
      });
      return;
    }

    this._emit("agent.tool_call", {
      agent: "editor",
      tool: "video_commit_clip",
      args: {
        section_idx: section.section_idx,
        shot_idx: shot.shot_idx,
        clips: [{ start: startTime, end: endTime }],
      },
    });
    await commitClip.execute(
      {
        section_idx: section.section_idx,
        shot_idx: shot.shot_idx,
        clips: [{ start: startTime, end: endTime }],
      },
      context,
    );
  }

  async _loadScenes(assetDir) {
    try {
      const raw = await fs.readFile(path.join(assetDir, "scene.json"), "utf-8");
      return JSON.parse(raw).scenes || [];
    } catch {
      return [];
    }
  }

  // ── Phase 3b: Assemble (Parallel) ─────────────────────────

  async assembleParallel(shotPlan, assetDir, options = {}) {
    this._emit("phase.start", { phase: "assemble" });
    const dir = assetDir || this.cacheDir;
    const shotPointPath = path.join(dir, "shot_point.json");
    await fs.writeFile(shotPointPath, "[]");

    const committedClips = [];
    const context = {
      assetDir: dir,
      committedClips,
      shotPointPath,
      llmCall: this.llmCall,
    };

    const orchestrator = new ParallelShotOrchestrator({
      maxConcurrency: options.maxConcurrency || 4,
      maxReruns: options.maxReruns || 3,
    });

    orchestrator.on("event", (ev) => this._emit(ev.type, ev));

    const runShot = async (section, shot, ctx) => {
      const mergedCtx = { ...context, ...ctx };
      await this._runEditorLoop(section, shot, mergedCtx);
      const lastCommit = mergedCtx.committedClips.slice(-1)[0];
      if (!lastCommit) return null;
      return {
        section_idx: section.section_idx,
        shot_idx: shot.shot_idx,
        clips: [{ start: lastCommit.start, end: lastCommit.end }],
        total_duration: lastCommit.end - lastCommit.start,
        music_segment: section.music_segment,
      };
    };

    const results = await orchestrator.run(
      shotPlan.sections || [],
      runShot,
      context,
    );

    await fs.writeFile(shotPointPath, JSON.stringify(results, null, 2));
    this._emit("phase.end", { phase: "assemble", output: shotPointPath });
    return results;
  }

  // ── Phase 3c: Review (Quality Gate) ──────────────────────

  async review(shotPoints, assetDir, options = {}) {
    this._emit("phase.start", { phase: "review" });
    const checkerNames = options.checkers || ["vision-protagonist"];
    const context = {
      llmCall: this.llmCall,
      mainCharacter: this.mainCharacter,
      thresholds: options.thresholds,
    };

    const approved = [];
    const rejected = [];

    for (const entry of shotPoints) {
      const result = await reviewEntry(entry, checkerNames, context);
      this._emit("phase.progress", {
        phase: "review",
        pct: (approved.length + rejected.length) / shotPoints.length,
        message: `S${entry.section_idx}:${entry.shot_idx} ${result.pass ? "pass" : "fail"} (${result.aggregateScore.toFixed(2)})`,
      });

      if (result.pass) {
        approved.push({ ...entry, review: result });
      } else {
        rejected.push({ ...entry, review: result });
        this._emit("review.fail", {
          section_idx: entry.section_idx,
          shot_idx: entry.shot_idx,
          checks: result.checks,
          willRerun: false,
        });
      }
    }

    this._emit("phase.end", {
      phase: "review",
      approved: approved.length,
      rejected: rejected.length,
    });

    return { approved, rejected };
  }

  // ── Phase 4: Render ──────────────────────────────────────

  async render(shotPoints, assetDir) {
    this._emit("phase.start", { phase: "render" });
    const dir = assetDir || this.cacheDir;

    const { extractClips } = await import("./render/ffmpeg-extract.js");
    const { concatClips } = await import("./render/ffmpeg-concat.js");
    const { mixAudio } = await import("./render/audio-mix.js");

    const clipPaths = await extractClips(this.videoPath, shotPoints, dir);
    this._emit("phase.progress", {
      phase: "render",
      pct: 0.4,
      message: "Clips extracted",
    });

    const concatPath = await concatClips(clipPaths, dir);
    this._emit("phase.progress", {
      phase: "render",
      pct: 0.7,
      message: "Concatenated",
    });

    let finalPath = concatPath;
    if (this.audioPath) {
      if (this.ducking) {
        const { mixAudioWithDucking } = await import("./render/audio-mix.js");
        finalPath = await mixAudioWithDucking(
          concatPath,
          this.audioPath,
          this.outputPath,
        );
      } else {
        finalPath = await mixAudio(concatPath, this.audioPath, this.outputPath);
      }
      this._emit("phase.progress", {
        phase: "render",
        pct: 0.95,
        message: "Audio mixed",
      });
    } else {
      await fs.copyFile(concatPath, this.outputPath);
      finalPath = this.outputPath;
    }

    this._emit("phase.end", { phase: "render", output: finalPath });
    return finalPath;
  }

  // ── Full Pipeline ────────────────────────────────────────

  async run(options = {}) {
    const assetDir = await this.deconstruct();
    const shotPlan = await this.plan(assetDir);

    const shotPoints = options.parallel
      ? await this.assembleParallel(shotPlan, assetDir, options)
      : await this.assemble(shotPlan, assetDir);

    const outputPath = await this.render(shotPoints, assetDir);
    return { assetDir, shotPlan, shotPoints, outputPath };
  }

  async runWithReview(options = {}) {
    const assetDir = await this.deconstruct();
    const shotPlan = await this.plan(assetDir);

    const shotPoints = options.parallel
      ? await this.assembleParallel(shotPlan, assetDir, options)
      : await this.assemble(shotPlan, assetDir);

    const { approved, rejected } = await this.review(
      shotPoints,
      assetDir,
      options,
    );
    const outputPath = await this.render(approved, assetDir);
    return { assetDir, shotPlan, shotPoints: approved, rejected, outputPath };
  }
}
