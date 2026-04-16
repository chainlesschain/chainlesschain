/**
 * audio-extractor.js — 音频解构：ASR + beat/能量分析
 *
 * ASR 后端：
 *  - litellm (通过 LLM provider 的 ASR 能力)
 *  - whisper_cpp (本地)
 *  - ffmpeg-subtitle (如果用户已有 .srt 文件直接跳过)
 *
 * Beat 分析：
 *  - madmom Python sidecar (Phase 4)
 *  - 简化模式：ffmpeg volumedetect + 等间距伪 beat (MVP)
 */

import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";

export async function extractSubtitle(
  audioPath,
  outputDir,
  { existingSrt, llmCall } = {},
) {
  const srtPath = path.join(outputDir, "subtitle.srt");

  if (existingSrt) {
    await fs.copyFile(existingSrt, srtPath);
    return parseSrt(await fs.readFile(srtPath, "utf-8"));
  }

  if (llmCall) {
    const result = await llmCall({ type: "asr", audioPath });
    if (result && result.srt) {
      await fs.writeFile(srtPath, result.srt);
      return parseSrt(result.srt);
    }
  }

  return [];
}

export function parseSrt(content) {
  const blocks = content.trim().split(/\n\n+/);
  return blocks
    .map((block) => {
      const lines = block.split("\n");
      if (lines.length < 3) return null;
      const timeMatch = lines[1].match(
        /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/,
      );
      if (!timeMatch) return null;
      return {
        start: srtTimeToSeconds(timeMatch[1]),
        end: srtTimeToSeconds(timeMatch[2]),
        text: lines.slice(2).join(" "),
      };
    })
    .filter(Boolean);
}

function srtTimeToSeconds(t) {
  const [h, m, rest] = t.split(":");
  const [s, ms] = rest.replace(",", ".").split(".");
  return (
    parseInt(h) * 3600 +
    parseInt(m) * 60 +
    parseInt(s) +
    parseInt(ms || 0) / 1000
  );
}

export async function analyzeBeats(
  audioPath,
  outputDir,
  { useMadmom = false } = {},
) {
  if (useMadmom) {
    return analyzeBeatsMadmom(audioPath, outputDir);
  }
  return analyzeBeatsSimple(audioPath, outputDir);
}

async function analyzeBeatsSimple(audioPath, outputDir) {
  const duration = await getAudioDuration(audioPath);
  const minSegment = 3.0;
  const segments = [];
  let t = 0;
  let idx = 0;
  while (t < duration) {
    const segEnd = Math.min(t + minSegment + Math.random() * 2, duration);
    segments.push({
      idx: idx++,
      start: parseFloat(t.toFixed(3)),
      end: parseFloat(segEnd.toFixed(3)),
      label: classifySegment(t, duration),
    });
    t = segEnd;
  }
  const beatPath = path.join(outputDir, "audio_beats.json");
  await fs.writeFile(beatPath, JSON.stringify({ duration, segments }, null, 2));
  return { duration, segments };
}

function classifySegment(t, total) {
  const pct = t / total;
  if (pct < 0.1) return "intro";
  if (pct < 0.3) return "build-up";
  if (pct < 0.7) return "chorus";
  if (pct < 0.9) return "bridge";
  return "outro";
}

async function analyzeBeatsMadmom(audioPath, outputDir) {
  return new Promise((resolve, reject) => {
    const thisDir = path.dirname(
      new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
    );
    const script = path.join(
      thisDir,
      "..",
      "..",
      "..",
      "..",
      "scripts",
      "madmom-beats.py",
    );
    const proc = spawn("python", [script, audioPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString("utf8")));
    proc.stderr.on("data", (d) => (stderr += d.toString("utf8")));
    proc.on("close", async (code) => {
      if (code !== 0)
        return reject(
          new Error(`madmom sidecar exit ${code}: ${stderr.slice(-300)}`),
        );
      try {
        const data = JSON.parse(stdout);
        if (data.error) return reject(new Error(data.error));
        const beatPath = path.join(outputDir, "audio_beats.json");
        await fs.writeFile(beatPath, JSON.stringify(data, null, 2));
        resolve(data);
      } catch (e) {
        reject(new Error(`madmom output parse failed: ${e.message}`));
      }
    });
    proc.on("error", reject);
  });
}

export async function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    const args = [
      "-i",
      audioPath,
      "-show_entries",
      "format=duration",
      "-v",
      "quiet",
      "-of",
      "csv=p=0",
    ];
    const proc = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error("ffprobe failed"));
      resolve(parseFloat(stdout.trim()) || 0);
    });
    proc.on("error", reject);
  });
}

export async function captionAudioSegments(segments, { llmCall } = {}) {
  if (!llmCall) return segments;
  const result = await llmCall({ type: "audio-caption", segments });
  return result || segments;
}

export async function runAudioExtractor(audioPath, outputDir, options = {}) {
  await fs.mkdir(outputDir, { recursive: true });

  const subtitles = await extractSubtitle(audioPath, outputDir, {
    existingSrt: options.existingSrt,
    llmCall: options.llmCall,
  });

  const beats = await analyzeBeats(audioPath, outputDir, {
    useMadmom: options.useMadmom,
  });

  const captionedSegments = await captionAudioSegments(beats.segments, {
    llmCall: options.llmCall,
  });

  const captionPath = path.join(outputDir, "audio_caption.json");
  await fs.writeFile(
    captionPath,
    JSON.stringify(
      {
        duration: beats.duration,
        segments: captionedSegments,
        subtitles,
      },
      null,
      2,
    ),
  );

  return { subtitles, beats, captionPath };
}
