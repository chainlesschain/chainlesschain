/**
 * video-extractor.js — 视频解构：ffmpeg 抽帧 + VLM caption
 *
 * 输出:
 *  - frames/      — 抽帧 png (按 VIDEO_FPS)
 *  - scene.json   — 场景切分 + caption
 */

import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";

const DEFAULT_FPS = 2;

export async function extractFrames(
  videoPath,
  outputDir,
  { fps = DEFAULT_FPS } = {},
) {
  const framesDir = path.join(outputDir, "frames");
  await fs.mkdir(framesDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const args = [
      "-i",
      videoPath,
      "-vf",
      `fps=${fps}`,
      "-q:v",
      "2",
      path.join(framesDir, "frame_%06d.png"),
    ];
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (code !== 0)
        return reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`));
      resolve(framesDir);
    });
    proc.on("error", reject);
  });
}

export async function detectScenes(
  videoPath,
  outputDir,
  { threshold = 0.3 } = {},
) {
  return new Promise((resolve, reject) => {
    const args = [
      "-i",
      videoPath,
      "-vf",
      `select='gt(scene,${threshold})',showinfo`,
      "-vsync",
      "vfr",
      "-f",
      "null",
      "-",
    ];
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", async (code) => {
      if (code !== 0) return reject(new Error(`scene detect exit ${code}`));
      const timestamps = parseSceneTimestamps(stderr);
      const scenePath = path.join(outputDir, "scene.json");
      await fs.writeFile(
        scenePath,
        JSON.stringify({ scenes: timestamps }, null, 2),
      );
      resolve(timestamps);
    });
    proc.on("error", reject);
  });
}

function parseSceneTimestamps(ffmpegStderr) {
  const scenes = [];
  const regex = /pts_time:(\d+\.?\d*)/g;
  let m;
  while ((m = regex.exec(ffmpegStderr)) !== null) {
    scenes.push({ time: parseFloat(m[1]) });
  }
  return scenes;
}

export async function captionFrames(
  framesDir,
  { llmCall, batchSize = 32 } = {},
) {
  const files = (await fs.readdir(framesDir))
    .filter((f) => f.endsWith(".png"))
    .sort();

  const captions = [];
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const framePaths = batch.map((f) => path.join(framesDir, f));

    if (llmCall) {
      const result = await llmCall({
        type: "scene-caption",
        frames: framePaths,
        frameIndices: batch.map((_, j) => i + j),
      });
      captions.push(...(Array.isArray(result) ? result : [result]));
    } else {
      for (const f of batch) {
        captions.push({ frame: f, caption: null });
      }
    }
  }
  return captions;
}

export async function runVideoExtractor(videoPath, outputDir, options = {}) {
  await fs.mkdir(outputDir, { recursive: true });

  const fps = options.fps || DEFAULT_FPS;
  const framesDir = await extractFrames(videoPath, outputDir, { fps });

  const scenes = await detectScenes(videoPath, outputDir, {
    threshold: options.sceneThreshold,
  });

  const captions = await captionFrames(framesDir, {
    llmCall: options.llmCall,
    batchSize: options.batchSize,
  });

  const captionPath = path.join(outputDir, "video_caption.json");
  await fs.writeFile(captionPath, JSON.stringify({ fps, captions }, null, 2));

  return { framesDir, scenes, captions, captionPath };
}
