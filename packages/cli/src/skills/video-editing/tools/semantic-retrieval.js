/**
 * video_semantic_retrieval — 在 scene 索引中按范围拉候选镜头
 */

import { promises as fs } from "fs";
import path from "path";

export const TOOL_DEF = {
  name: "video_semantic_retrieval",
  description:
    "Explore scene metadata within a bounded range to discover candidate shots.",
  inputSchema: {
    type: "object",
    properties: {
      scene_start: {
        type: "number",
        description: "Start scene index (inclusive)",
      },
      scene_end: { type: "number", description: "End scene index (inclusive)" },
      query: {
        type: "string",
        description: "Optional semantic query to filter by",
      },
    },
    required: ["scene_start", "scene_end"],
  },
  isReadOnly: true,
  riskLevel: "LOW",
  availableInPlanMode: true,
};

export async function execute({ scene_start, scene_end, query }, context) {
  const scenePath = path.join(context.assetDir, "scene.json");
  const raw = await fs.readFile(scenePath, "utf-8");
  const { scenes } = JSON.parse(raw);

  const start = Math.max(0, scene_start);
  const end = Math.min(scenes.length - 1, scene_end);
  let candidates = scenes.slice(start, end + 1).map((s, i) => ({
    scene_idx: start + i,
    ...s,
  }));

  if (query) {
    const q = query.toLowerCase();
    candidates = candidates.filter((c) =>
      JSON.stringify(c).toLowerCase().includes(q),
    );
  }

  return {
    total_scenes: scenes.length,
    range: [start, end],
    candidates,
  };
}
