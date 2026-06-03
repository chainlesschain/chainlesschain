/**
 * video_shot_trimming — 帧级精细分析：给定时间范围，返回断点 + 可用性评估
 */

import { promises as fs } from "fs";
import path from "path";

export const TOOL_DEF = {
  name: "video_shot_trimming",
  description:
    "Analyze video frames + transcripts within a time range, return detailed breakdowns with usability.",
  inputSchema: {
    type: "object",
    properties: {
      start_time: { type: "number", description: "Start time in seconds" },
      end_time: { type: "number", description: "End time in seconds" },
    },
    required: ["start_time", "end_time"],
  },
  isReadOnly: true,
  riskLevel: "LOW",
  availableInPlanMode: true,
};

export async function execute({ start_time, end_time }, context) {
  const captionPath = path.join(context.assetDir, "video_caption.json");
  const raw = await fs.readFile(captionPath, "utf-8");
  const { fps, captions } = JSON.parse(raw);

  const startFrame = Math.floor(start_time * fps);
  const endFrame = Math.ceil(end_time * fps);
  const relevantCaptions = captions.slice(
    Math.max(0, startFrame),
    Math.min(captions.length, endFrame + 1),
  );

  const subtitlePath = path.join(context.assetDir, "audio_caption.json");
  let subtitles = [];
  try {
    const audioRaw = await fs.readFile(subtitlePath, "utf-8");
    const audioData = JSON.parse(audioRaw);
    subtitles = (audioData.subtitles || []).filter(
      (s) => s.end >= start_time && s.start <= end_time,
    );
  } catch {}

  if (context.llmCall) {
    const result = await context.llmCall({
      type: "dense-caption",
      start_time,
      end_time,
      captions: relevantCaptions,
      subtitles,
    });
    return {
      time_range: { start: start_time, end: end_time },
      segments: result || [],
      frame_count: relevantCaptions.length,
    };
  }

  return {
    time_range: { start: start_time, end: end_time },
    segments: relevantCaptions.map((c, i) => ({
      frame_idx: startFrame + i,
      time: parseFloat(((startFrame + i) / fps).toFixed(3)),
      caption: c.caption,
      usability: "unknown",
    })),
    frame_count: relevantCaptions.length,
    subtitles,
  };
}
