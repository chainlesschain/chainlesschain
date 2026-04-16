/**
 * subtitle-extractor.js — 独立 SRT/VTT 字幕提取 + 角色识别
 */

import { promises as fs } from "fs";
import path from "path";
import { parseSrt } from "./audio-extractor.js";

export async function loadSubtitle(filePath) {
  const content = await fs.readFile(filePath, "utf-8");
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".srt") return parseSrt(content);
  if (ext === ".vtt") return parseVtt(content);

  throw new Error(`Unsupported subtitle format: ${ext}`);
}

function parseVtt(content) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const entries = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].includes("-->")) {
      const timeMatch = lines[i].match(
        /(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/,
      );
      if (timeMatch) {
        const textLines = [];
        i++;
        while (i < lines.length && lines[i].trim() !== "") {
          textLines.push(lines[i].trim());
          i++;
        }
        entries.push({
          start: vttTimeToSeconds(timeMatch[1]),
          end: vttTimeToSeconds(timeMatch[2]),
          text: textLines.join(" "),
        });
      }
    }
    i++;
  }
  return entries;
}

function vttTimeToSeconds(t) {
  const [h, m, s] = t.split(":");
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s);
}

export async function identifyCharacters(subtitles, { llmCall } = {}) {
  if (!llmCall || subtitles.length === 0) {
    return { speakers: {} };
  }

  const grouped = {};
  for (const entry of subtitles) {
    const speakerMatch = entry.text.match(/^\[([^\]]+)\]\s*/);
    const speaker = speakerMatch ? speakerMatch[1] : "UNKNOWN";
    if (!grouped[speaker]) grouped[speaker] = [];
    grouped[speaker].push(entry.text.replace(/^\[[^\]]+\]\s*/, ""));
  }

  const result = await llmCall({
    type: "character-identify",
    speakers: grouped,
  });

  return result || { speakers: {} };
}

export async function runSubtitleExtractor(
  subtitlePath,
  outputDir,
  options = {},
) {
  const subtitles = await loadSubtitle(subtitlePath);
  const characters = await identifyCharacters(subtitles, {
    llmCall: options.llmCall,
  });

  const outputPath = path.join(outputDir, "subtitle_analysis.json");
  await fs.writeFile(
    outputPath,
    JSON.stringify({ subtitles, characters }, null, 2),
  );

  return { subtitles, characters, outputPath };
}
