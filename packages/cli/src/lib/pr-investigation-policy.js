// This selects a progress budget, never permission to close/merge a PR. Capture
// the user's request before compaction; tool output cannot select this policy.
export function isPrActionRequest(messages) {
  const latest = messages?.findLast((message) => message.role === "user");
  const text = (
    typeof latest?.content === "string"
      ? latest.content
      : Array.isArray(latest?.content)
        ? latest.content
            .filter((part) => part?.type === "text")
            .map((part) => part.text || "")
            .join("\n")
        : ""
  ).replace(/<ide-context\b[^>]*>[\s\S]*?<\/ide-context>/gi, "");
  return (
    /\bPRs?\b|pull[ /_-]requests?|github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+|拉取请求|合并请求/iu.test(
      text,
    ) &&
    /\b(?:handle|fix|resolve|close|merge)\b|处理|修复|解决|关闭|合并/iu.test(
      text,
    ) &&
    !/\b(?:watch|monitor|wait|review|explain)\b|等待|监控|观察|审查|评审|解释/iu.test(
      text,
    )
  );
}

export const PR_INVESTIGATION_LIMIT = 36;

export const PR_ACTION_GUIDANCE =
  "PR action workflow: retain the target, head/base commits, current checks and concrete next action. " +
  "Read metadata once, then inspect only the exact missing file patch or failed job. " +
  "gh pr checks exit code 1 can mean failed checks: inspect the returned check results, not just the exit code. " +
  "Do not rotate between gh api, gh pr and PR web pages to rediscover the same facts. " +
  "Use the correct repository cwd and actual remote names. Fix and validate when the evidence supports an authorized change; otherwise report the specific missing prerequisite. " +
  "A general request to handle a PR does not by itself authorize closing or merging it. Never make dummy edits to reset recovery.";

export const PR_INVESTIGATION_EXIT_GUIDANCE =
  "PR investigation budget exhausted without an actionable outcome. This is the final synthesis turn; no tools may execute. " +
  "Use the retained evidence to report what was verified, the concrete blocker or missing fact, and the smallest next step. " +
  "Explicitly say the task is incomplete. Do not claim a PR was fixed, closed or merged without successful tool evidence. " +
  "Do not promise another retry or restart the investigation.";
