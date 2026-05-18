/**
 * cc video — 视频剪辑 Agent (借鉴 CutClaw)
 *
 * 子命令：
 *  edit          一键完整流程
 *  deconstruct   解构素材（抽帧+ASR+beat）
 *  plan          生成 shot_plan
 *  assemble      Editor ReAct 选时间戳
 *  render        ffmpeg 渲染成片
 *  assets        管理已解构素材缓存
 */

import { logger } from "../lib/logger.js";

export function registerVideoCommand(program) {
  const video = program
    .command("video")
    .description(
      "Video editing agent — long footage + music → montage (CutClaw-inspired)",
    );

  // ── cc video edit ─────────────────────────────────────────
  video
    .command("edit")
    .description("Full pipeline: deconstruct → plan → assemble → render")
    .requiredOption("--video <path>", "Input video file")
    .option("--audio <path>", "Background music file")
    .option("--instruction <text>", "Editing instruction", "")
    .option("--output <path>", "Output video path", "./output.mp4")
    .option("--srt <path>", "Existing subtitle file (skip ASR)")
    .option("--fps <n>", "Frame sampling FPS", "2")
    .option("--character <name>", "Main character name")
    .option("--parallel", "Run sections in parallel with conflict resolution")
    .option("--concurrency <n>", "Max parallel sections", "4")
    .option("--review", "Enable quality gate (VLM review before commit)")
    .option("--use-madmom", "Use madmom Python sidecar for beat detection")
    .option("--snap-beats", "Snap shot plan timestamps to nearest beat")
    .option("--ducking", "Enable dialogue ducking in audio mix")
    .option("--stream", "Emit NDJSON progress events to stdout")
    .option("--json", "JSON final output")
    .action(async (options) => {
      const { VideoPipeline } =
        await import("../skills/video-editing/pipeline.js");

      const pipeline = new VideoPipeline({
        videoPath: options.video,
        audioPath: options.audio,
        instruction: options.instruction,
        outputPath: options.output,
        existingSrt: options.srt,
        fps: parseInt(options.fps, 10),
        mainCharacter: options.character,
        useMadmom: !!options.useMadmom,
        snapBeats: !!options.snapBeats,
        ducking: !!options.ducking,
      });

      if (options.stream) {
        pipeline.on("event", (ev) => {
          process.stdout.write(`${JSON.stringify(ev)}\n`);
        });
      } else {
        pipeline.on("event", (ev) => {
          if (ev.type === "phase.start") logger.info(`▶ ${ev.phase}`);
          if (ev.type === "phase.progress")
            logger.info(`  ${ev.pct * 100}% ${ev.message || ""}`);
          if (ev.type === "phase.end") logger.info(`✓ ${ev.phase} done`);
          if (ev.type === "error") logger.error(`✗ ${ev.phase}: ${ev.error}`);
        });
      }

      try {
        const runOpts = {
          parallel: !!options.parallel,
          maxConcurrency: parseInt(options.concurrency, 10),
        };
        const result = options.review
          ? await pipeline.runWithReview(runOpts)
          : await pipeline.run(runOpts);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (!options.stream) {
          logger.info(`\nOutput: ${result.outputPath}`);
        }
      } catch (err) {
        if (options.stream) {
          process.stdout.write(
            `${JSON.stringify({ type: "error", error: err.message, ts: Date.now() })}\n`,
          );
        }
        logger.error(`Video edit failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ── cc video deconstruct ──────────────────────────────────
  video
    .command("deconstruct")
    .description("Extract frames + ASR + beat analysis (results cached)")
    .requiredOption("--video <path>", "Input video file")
    .option("--audio <path>", "Audio file for beat analysis")
    .option("--srt <path>", "Existing subtitle file")
    .option("--fps <n>", "Frame sampling FPS", "2")
    .option("--use-madmom", "Use madmom for beat detection")
    .option("--stream", "NDJSON events")
    .option("--json", "JSON output")
    .action(async (options) => {
      const { VideoPipeline } =
        await import("../skills/video-editing/pipeline.js");

      const pipeline = new VideoPipeline({
        videoPath: options.video,
        audioPath: options.audio,
        existingSrt: options.srt,
        fps: parseInt(options.fps, 10),
        useMadmom: !!options.useMadmom,
      });

      if (options.stream) {
        pipeline.on("event", (ev) =>
          process.stdout.write(`${JSON.stringify(ev)}\n`),
        );
      }

      try {
        const dir = await pipeline.deconstruct();
        if (options.json) {
          console.log(
            JSON.stringify({ assetDir: dir, hash: dir.split(/[/\\]/).pop() }),
          );
        } else if (!options.stream) {
          logger.info(`Assets cached: ${dir}`);
        }
      } catch (err) {
        logger.error(`Deconstruct failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ── cc video plan ─────────────────────────────────────────
  video
    .command("plan")
    .description("Generate shot_plan from deconstructed assets + instruction")
    .requiredOption("--asset-dir <path>", "Deconstructed asset directory")
    .option("--instruction <text>", "Editing instruction", "")
    .option("--character <name>", "Main character name")
    .option("--json", "JSON output")
    .action(async (options) => {
      const { VideoPipeline } =
        await import("../skills/video-editing/pipeline.js");

      const pipeline = new VideoPipeline({
        videoPath: "",
        instruction: options.instruction,
        mainCharacter: options.character,
        cacheDir: options.assetDir,
      });

      try {
        const plan = await pipeline.plan(options.assetDir);
        if (options.json) {
          console.log(JSON.stringify(plan, null, 2));
        } else {
          const shots = (plan.sections || []).reduce(
            (s, sec) => s + (sec.shots?.length || 0),
            0,
          );
          logger.info(
            `Shot plan: ${plan.sections?.length || 0} sections, ${shots} shots`,
          );
        }
      } catch (err) {
        logger.error(`Plan failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ── cc video assemble ─────────────────────────────────────
  video
    .command("assemble")
    .description("Run Editor ReAct loop to select timestamps from shot_plan")
    .requiredOption("--asset-dir <path>", "Deconstructed asset directory")
    .requiredOption("--plan <path>", "shot_plan.json path")
    .option("--parallel", "Run sections in parallel with conflict resolution")
    .option("--concurrency <n>", "Max parallel sections", "4")
    .option("--review", "Enable quality gate (VLM review before commit)")
    .option("--stream", "NDJSON events")
    .option("--json", "JSON output")
    .action(async (options) => {
      const { promises: fs } = await import("fs");
      const { VideoPipeline } =
        await import("../skills/video-editing/pipeline.js");

      const shotPlan = JSON.parse(await fs.readFile(options.plan, "utf-8"));
      const pipeline = new VideoPipeline({
        videoPath: "",
        cacheDir: options.assetDir,
      });

      if (options.stream) {
        pipeline.on("event", (ev) =>
          process.stdout.write(`${JSON.stringify(ev)}\n`),
        );
      }

      try {
        let points;
        if (options.parallel) {
          points = await pipeline.assembleParallel(shotPlan, options.assetDir, {
            maxConcurrency: parseInt(options.concurrency, 10),
          });
        } else {
          points = await pipeline.assemble(shotPlan, options.assetDir);
        }

        if (options.review) {
          const { approved } = await pipeline.review(points, options.assetDir);
          points = approved;
        }
        if (options.json) {
          console.log(JSON.stringify(points, null, 2));
        } else if (!options.stream) {
          logger.info(`Assembled ${points.length} shot points`);
        }
      } catch (err) {
        logger.error(`Assemble failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ── cc video render ───────────────────────────────────────
  video
    .command("render")
    .description("Render shot_point.json into final video via ffmpeg")
    .requiredOption("--video <path>", "Original video file")
    .requiredOption("--points <path>", "shot_point.json path")
    .option("--audio <path>", "Background music to mix")
    .option("--output <path>", "Output path", "./output.mp4")
    .option("--stream", "NDJSON events")
    .option("--json", "JSON output")
    .action(async (options) => {
      const { promises: fs } = await import("fs");
      const { VideoPipeline, getCacheDir } =
        await import("../skills/video-editing/pipeline.js");

      const shotPoints = JSON.parse(await fs.readFile(options.points, "utf-8"));
      const pipeline = new VideoPipeline({
        videoPath: options.video,
        audioPath: options.audio,
        outputPath: options.output,
        cacheDir: getCacheDir(options.video, options.audio),
      });

      if (options.stream) {
        pipeline.on("event", (ev) =>
          process.stdout.write(`${JSON.stringify(ev)}\n`),
        );
      }

      try {
        const outPath = await pipeline.render(shotPoints);
        if (options.json) {
          console.log(JSON.stringify({ outputPath: outPath }));
        } else if (!options.stream) {
          logger.info(`Rendered: ${outPath}`);
        }
      } catch (err) {
        logger.error(`Render failed: ${err.message}`);
        process.exit(1);
      }
    });

  // ── cc video assets ───────────────────────────────────────
  video
    .command("assets")
    .description("Manage deconstructed video asset cache")
    .argument("[action]", "list | show | prune", "list")
    .option("--hash <hash>", "Asset hash to show")
    .option("--older-than <days>", "Prune assets older than N days")
    .option("--json", "JSON output")
    .action(async (action, options) => {
      const { promises: fs } = await import("fs");
      const pathMod = await import("path");

      const base = process.env.APPDATA
        ? pathMod.join(
            process.env.APPDATA,
            "chainlesschain-desktop-vue",
            ".chainlesschain",
            "video-editing",
          )
        : pathMod.join(
            process.env.HOME || "~",
            ".chainlesschain",
            "video-editing",
          );

      if (action === "list") {
        try {
          const dirs = await fs.readdir(base);
          const assets = [];
          for (const d of dirs) {
            const metaPath = pathMod.join(base, d, "meta.json");
            try {
              const meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
              const stat = await fs.stat(metaPath);
              assets.push({
                hash: d,
                ...meta,
                modifiedAt: stat.mtime.toISOString(),
              });
            } catch {}
          }
          if (options.json) {
            console.log(JSON.stringify({ assets }, null, 2));
          } else {
            if (assets.length === 0) {
              logger.info("No cached assets.");
            } else {
              for (const a of assets) {
                logger.info(
                  `${a.hash}  ${a.videoPath || "?"}  ${a.modifiedAt}`,
                );
              }
            }
          }
        } catch {
          logger.info("No cached assets.");
        }
      } else if (action === "show" && options.hash) {
        const dir = pathMod.join(base, options.hash);
        try {
          const files = await fs.readdir(dir);
          if (options.json) {
            console.log(JSON.stringify({ hash: options.hash, files }));
          } else {
            logger.info(`Asset ${options.hash}:`);
            for (const f of files) logger.info(`  ${f}`);
          }
        } catch {
          logger.error(`Asset not found: ${options.hash}`);
        }
      } else if (action === "prune") {
        const days = parseInt(options.olderThan || "30", 10);
        const cutoff = Date.now() - days * 86400000;
        try {
          const dirs = await fs.readdir(base);
          let removed = 0;
          for (const d of dirs) {
            const dirPath = pathMod.join(base, d);
            const stat = await fs.stat(dirPath);
            if (stat.mtimeMs < cutoff) {
              await fs.rm(dirPath, { recursive: true, force: true });
              removed++;
            }
          }
          logger.info(`Pruned ${removed} asset(s) older than ${days} days.`);
        } catch {
          logger.info("Nothing to prune.");
        }
      }
    });
}
