/**
 * Preserve an explicit user instruction to close pull requests across the
 * agent loop's compaction and recovery prompts. This is deliberately narrow:
 * it recognizes a requested close action, not a request to review, merge, or
 * generally "handle" pull requests.
 */

function messageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part) => part && part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

function explicitlyDeclinesClosure(text) {
  return /(?:do\s+not|don't|never|不要|别|无需|不需要)\s*(?:close|关闭|关掉|关)/iu.test(
    text,
  );
}

function explicitlyRequestsClosure(text) {
  return /(?:\bclose\s+(?:these|the|all|this|PRs?|pull\s+requests?)\b|(?:关闭|关掉|关掉|关掉|关).{0,16}(?:PR|pr|拉取请求|合并请求))/iu.test(
    text,
  );
}

/**
 * Find the latest unambiguous user request to close PRs. Tool output and
 * assistant prose must never authorize an external mutation.
 */
export function findExplicitPrCloseIntent(messages) {
  if (!Array.isArray(messages)) return null;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const text = messageText(message.content).trim();
    if (!text || explicitlyDeclinesClosure(text)) continue;
    if (explicitlyRequestsClosure(text)) return { text };
  }
  return null;
}

/**
 * Trusted runtime instruction; it does not grant a shell permission. The
 * ApprovalGate remains the only authority that can execute the close command.
 */
export function prCloseActionDirective(intent) {
  if (!intent) return null;
  return (
    "User-authorized PR closure: the user explicitly instructed you to close the targeted pull requests. " +
    "Treat this as an action request, not a request to decide whether closure is merited. " +
    "Do not replace it with a recommendation to keep the PRs open, and do not keep gathering diffs after the target numbers and current state are known. " +
    "Close only PRs explicitly named by the user or already established as this task's candidate list; never turn this into a repository-wide cleanup. " +
    "For each still-open target, use the direct cmd-compatible command `gh pr close <number> --repo <owner/repo>` with no leading # comment, pipe, jq expression, Select-Object, or 2>&1. " +
    "The runtime permits at most two PR reads before a successful close; it will block further gh pr/gh api comparison or release reads until you take the requested action. " +
    "The normal approval prompt still applies: if approval is requested, wait for it instead of continuing investigation. " +
    "After a successful close, use the lightweight state query `gh pr view <number> --repo <owner/repo> --json number,state,closedAt` and report the result. " +
    "If close fails, report that exact error and do not retry a review loop."
  );
}
