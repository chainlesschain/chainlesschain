/**
 * audio-mix.js — 混音：视频 + 背景音乐
 *
 * MVP: 简单叠加 + loudnorm
 * Phase 4 扩展: 对话区 ducking + 结尾 fade
 */

import { spawn } from "child_process";

export async function mixAudio(videoPath, audioPath, outputPath, options = {}) {
  const bgmVolume = options.bgmVolume ?? 0.3;

  return new Promise((resolve, reject) => {
    const filter = [
      `[1:a]volume=${bgmVolume},loudnorm=I=-16:LRA=11:TP=-1.5[bgm]`,
      `[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
    ].join(";");

    const args = [
      "-y",
      "-i",
      videoPath,
      "-i",
      audioPath,
      "-filter_complex",
      filter,
      "-map",
      "0:v",
      "-map",
      "[aout]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      outputPath,
    ];

    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (code !== 0)
        return reject(
          new Error(`ffmpeg mix exit ${code}: ${stderr.slice(-300)}`),
        );
      resolve(outputPath);
    });
    proc.on("error", reject);
  });
}

export async function mixAudioWithDucking(
  videoPath,
  audioPath,
  outputPath,
  options = {},
) {
  const bgmVolume = options.bgmVolume ?? 0.3;
  const fadeOutDuration = options.fadeOutDuration ?? 3;

  return new Promise((resolve, reject) => {
    const filter = [
      `[0:a]aresample=async=1[speech]`,
      `[1:a]volume=${bgmVolume},loudnorm=I=-16:LRA=11:TP=-1.5[bgm_norm]`,
      `[bgm_norm][speech]sidechaincompress=threshold=0.02:ratio=6:attack=200:release=1000[bgm_duck]`,
      `[speech][bgm_duck]amix=inputs=2:duration=first:dropout_transition=2,afade=t=out:d=${fadeOutDuration}:curve=tri[aout]`,
    ].join(";");

    const args = buildFfmpegArgs(videoPath, audioPath, outputPath, filter);
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString("utf8")));
    proc.on("close", (code) => {
      if (code !== 0)
        return reject(
          new Error(`ffmpeg ducking mix exit ${code}: ${stderr.slice(-300)}`),
        );
      resolve(outputPath);
    });
    proc.on("error", reject);
  });
}

export function buildDuckingFilter(options = {}) {
  const bgmVolume = options.bgmVolume ?? 0.3;
  const fadeOutDuration = options.fadeOutDuration ?? 3;
  return [
    `[0:a]aresample=async=1[speech]`,
    `[1:a]volume=${bgmVolume},loudnorm=I=-16:LRA=11:TP=-1.5[bgm_norm]`,
    `[bgm_norm][speech]sidechaincompress=threshold=0.02:ratio=6:attack=200:release=1000[bgm_duck]`,
    `[speech][bgm_duck]amix=inputs=2:duration=first:dropout_transition=2,afade=t=out:d=${fadeOutDuration}:curve=tri[aout]`,
  ].join(";");
}

export function buildSimpleFilter(options = {}) {
  const bgmVolume = options.bgmVolume ?? 0.3;
  return [
    `[1:a]volume=${bgmVolume},loudnorm=I=-16:LRA=11:TP=-1.5[bgm]`,
    `[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
  ].join(";");
}

function buildFfmpegArgs(videoPath, audioPath, outputPath, filter) {
  return [
    "-y",
    "-i",
    videoPath,
    "-i",
    audioPath,
    "-filter_complex",
    filter,
    "-map",
    "0:v",
    "-map",
    "[aout]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    outputPath,
  ];
}
