/**
 * Pure renderer for the `/todos` REPL command — a user-facing view of the
 * agent's session TODO list (the one it maintains with the `todo_write` tool).
 * The data comes from todo-manager's getTodos(sessionId); this module only
 * formats it, so it stays deterministic and unit-testable.
 *
 * The agent uses todos to track multi-step work; before this command they were
 * only visible to the model. `/todos` surfaces them to the human, the way
 * Claude Code's /todos view does.
 */

/** A short status badge for one todo item. */
export function todoStatusLabel(status) {
  switch (status) {
    case "in_progress":
      return "▶ in progress";
    case "completed":
      return "✓ done";
    case "cancelled":
      return "✗ cancelled";
    case "pending":
      return "☐ pending";
    default:
      return status || "?";
  }
}

/** Count items by status (tolerant of unknown statuses). */
export function summarize(todos) {
  const counts = { pending: 0, in_progress: 0, completed: 0, cancelled: 0 };
  for (const t of Array.isArray(todos) ? todos : []) {
    if (counts[t?.status] !== undefined) counts[t.status] += 1;
  }
  return counts;
}

/**
 * Render the session TODO list as a plain-text block.
 * @param {Array} todos  from getTodos(sessionId): [{ id, content, status }]
 */
export function formatTodos(todos) {
  const list = Array.isArray(todos) ? todos : [];
  if (list.length === 0) {
    return (
      "No TODOs for this session.\n" +
      "  (The agent tracks multi-step work with the todo_write tool — " +
      "they appear here once it creates some.)"
    );
  }
  const c = summarize(list);
  const lines = [
    `Session TODOs (${list.length}: ${c.completed} done, ` +
      `${c.in_progress} in progress, ${c.pending} pending` +
      (c.cancelled ? `, ${c.cancelled} cancelled` : "") +
      `):`,
  ];
  for (const t of list) {
    const content = String(t?.content || "")
      .replace(/\s+/g, " ")
      .trim();
    const short = content.length > 80 ? content.slice(0, 80) + "…" : content;
    lines.push(`  ${todoStatusLabel(t?.status)}  ${short}`);
  }
  return lines.join("\n");
}
