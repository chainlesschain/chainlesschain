/**
 * video_review_clip — 检查候选片段与已 commit 片段的时间区间冲突
 */

export const TOOL_DEF = {
  name: "video_review_clip",
  description:
    "Check a candidate clip for overlap against previously committed clips.",
  inputSchema: {
    type: "object",
    properties: {
      start: { type: "number", description: "Candidate start time (seconds)" },
      end: { type: "number", description: "Candidate end time (seconds)" },
    },
    required: ["start", "end"],
  },
  isReadOnly: true,
  riskLevel: "LOW",
  availableInPlanMode: true,
};

export function execute({ start, end }, context) {
  const committed = context.committedClips || [];
  const overlaps = [];

  for (const clip of committed) {
    if (start < clip.end && end > clip.start) {
      overlaps.push({
        conflict_with: clip,
        overlap_start: Math.max(start, clip.start),
        overlap_end: Math.min(end, clip.end),
        overlap_duration: Math.min(end, clip.end) - Math.max(start, clip.start),
      });
    }
  }

  return {
    candidate: { start, end, duration: end - start },
    has_conflict: overlaps.length > 0,
    overlaps,
    suggestion:
      overlaps.length > 0
        ? `Avoid time ranges: ${overlaps.map((o) => `[${o.overlap_start.toFixed(1)}-${o.overlap_end.toFixed(1)}]`).join(", ")}`
        : "No conflicts, safe to commit.",
  };
}
