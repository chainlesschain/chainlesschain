/**
 * ffmpeg-extract.js — 按 shot_point 从视频中抽取片段
 */

import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";

export async function extractClips(videoPath, shotPoints, workDir) {
  const clipsDir = path.join(workDir, "clips");
  await fs.mkdir(clipsDir, { recursive: true });

  const clipPaths = [];

  for (let i = 0; i < shotPoints.length; i++) {
    const entry = shotPoints[i];
    const clips = entry.clips || [];

    for (let j = 0; j < clips.length; j++) {
      const clip = clips[j];
      const outFile = path.join(clipsDir, `clip_${i}_${j}.mp4`);
      await extractSingle(
        videoPath,
        clip.start,
        clip.duration || clip.end - clip.start,
        outFile,
      );
      clipPaths.push(outFile);
    }
  }

  return clipPaths;
}

function extractSingle(videoPath, startSec, duration, outFile) {
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-ss",
      String(startSec),
      "-i",
      videoPath,
      "-t",
      String(duration),
      "-c",
      "copy",
      "-avoid_negative_ts",
      "make_zero",
      outFile,
    ];
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (code !== 0)
        return reject(
          new Error(`ffmpeg extract exit ${code}: ${stderr.slice(-300)}`),
        );
      resolve(outFile);
    });
    proc.on("error", reject);
  });
}

export async function extractSingleClip(videoPath, start, end, outFile) {
  return extractSingle(videoPath, start, end - start, outFile);
}
