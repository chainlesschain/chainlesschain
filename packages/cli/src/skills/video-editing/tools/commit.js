/**
 * video_commit_clip — 提交选定片段（最多 3 段拼接成一个镜头）
 */

import { promises as fs } from "fs";
import path from "path";

export const TOOL_DEF = {
  name: "video_commit_clip",
  description:
    "Finalize shot selection with multi-clip stitching (up to 3 clips per output).",
  inputSchema: {
    type: "object",
    properties: {
      section_idx: {
        type: "number",
        description: "Section index in shot plan",
      },
      shot_idx: { type: "number", description: "Shot index within section" },
      clips: {
        type: "array",
        items: {
          type: "object",
          properties: {
            start: { type: "number" },
            end: { type: "number" },
          },
          required: ["start", "end"],
        },
        maxItems: 3,
        description: "1-3 clips to stitch",
      },
    },
    required: ["section_idx", "shot_idx", "clips"],
  },
  isReadOnly: false,
  riskLevel: "MEDIUM",
  availableInPlanMode: false,
};

export async function execute({ section_idx, shot_idx, clips }, context) {
  if (!clips || clips.length === 0) {
    return { status: "error", message: "No clips provided." };
  }
  if (clips.length > 3) {
    return { status: "error", message: "Max 3 clips per commit." };
  }

  for (const clip of clips) {
    if (clip.end <= clip.start) {
      return {
        status: "error",
        message: `Invalid clip: start=${clip.start} >= end=${clip.end}`,
      };
    }
  }

  const committed = context.committedClips || [];
  for (const clip of clips) {
    for (const existing of committed) {
      if (clip.start < existing.end && clip.end > existing.start) {
        return {
          status: "conflict",
          message: `Clip [${clip.start}-${clip.end}] overlaps with committed [${existing.start}-${existing.end}]`,
        };
      }
    }
  }

  const totalDuration = clips.reduce((s, c) => s + (c.end - c.start), 0);
  const entry = {
    section_idx,
    shot_idx,
    clips: clips.map((c, i) => ({
      idx: i,
      start: c.start,
      end: c.end,
      duration: parseFloat((c.end - c.start).toFixed(3)),
    })),
    total_duration: parseFloat(totalDuration.toFixed(3)),
    committed_at: new Date().toISOString(),
  };

  committed.push(
    ...clips.map((c) => ({
      start: c.start,
      end: c.end,
      section_idx,
      shot_idx,
    })),
  );
  context.committedClips = committed;

  if (context.shotPointPath) {
    let existing = [];
    try {
      const raw = await fs.readFile(context.shotPointPath, "utf-8");
      existing = JSON.parse(raw);
    } catch {}
    existing.push(entry);
    await fs.writeFile(
      context.shotPointPath,
      JSON.stringify(existing, null, 2),
    );
  }

  return { status: "success", ...entry };
}
