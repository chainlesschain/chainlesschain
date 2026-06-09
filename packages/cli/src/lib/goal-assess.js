/**
 * goal-assess — run-end LLM self-assessment of goal progress (cc goal Phase 2).
 *
 * After an agent run bound to a goal (--goal-assess), an LLM is asked to judge,
 * from the run transcript, whether the goal advanced — and to propose key-result
 * updates, a one-line progress note, and any concerns. The proposal is then
 * persisted through goal-store (progress / key results / agent note / drift).
 *
 * This is OPT-IN because it spends extra tokens (one bonus completion per run).
 * The LLM call is injected as `chat(promptString) => Promise<string>` so the
 * orchestration is deterministically unit-testable without a provider.
 *
 * Parsing is deliberately tolerant: models wrap JSON in prose / code fences, so
 * we extract the first balanced `{...}` block and validate the fields we use.
 */

import {
  recordProgress,
  setKeyResult,
  addDriftFlags,
  getGoal,
} from "./goal-store.js";

/** Bound the transcript we feed the judge so the assessment stays cheap. */
const MAX_FINAL_TEXT = 2000;
const MAX_TOOLS = 40;

/**
 * Build the assessment prompt. Asks for a strict JSON object describing whether
 * the goal advanced + proposed updates.
 * @param {object} goal
 * @param {object} transcript { prompt, finalText, toolCalls:[{tool,args}] }
 */
export function buildAssessPrompt(goal, transcript = {}) {
  const krLines = (goal.keyResults || [])
    .map(
      (k) =>
        `  - id=${k.id} | "${k.text}"` +
        (k.target != null ? ` | ${k.current ?? 0}/${k.target}` : "") +
        (k.done ? " | DONE" : ""),
    )
    .join("\n");

  const tools = (transcript.toolCalls || [])
    .slice(0, MAX_TOOLS)
    .map((t) => t.tool)
    .join(", ");

  const finalText = String(transcript.finalText || "").slice(0, MAX_FINAL_TEXT);

  return [
    "You are assessing whether a single agent run advanced a long-running goal.",
    "",
    `GOAL: ${goal.objective}`,
    `CURRENT PROGRESS: ${goal.progress ?? 0}%`,
    goal.keyResults?.length
      ? `KEY RESULTS:\n${krLines}`
      : "KEY RESULTS: (none)",
    "",
    `RUN TASK: ${String(transcript.prompt || "").slice(0, 500)}`,
    tools ? `TOOLS USED: ${tools}` : "TOOLS USED: (none)",
    `RUN RESULT:\n${finalText || "(no final text)"}`,
    "",
    "Reply with ONLY a JSON object (no prose, no code fence) of this shape:",
    "{",
    '  "advanced": true|false,            // did this run move the goal forward?',
    '  "progress": <0-100 or null>,        // your estimate of new overall progress, or null to leave unchanged',
    '  "keyResults": [                     // updates for specific key results (omit if none)',
    '    {"id": "<kr-id>", "current": <number or null>, "done": true|false}',
    "  ],",
    '  "note": "<one short sentence summarizing what changed>",',
    '  "concerns": ["<short concern>", ...]   // anything blocking/at-risk (omit if none)',
    "}",
  ].join("\n");
}

/**
 * Tolerantly parse the judge's reply into a normalized assessment, or null.
 * @param {string} text
 * @returns {{advanced:boolean, progress:number|null, keyResults:object[], note:string, concerns:string[]}|null}
 */
export function parseAssessment(text) {
  if (!text || typeof text !== "string") return null;
  const json = extractFirstJsonObject(text);
  if (!json) return null;
  let obj;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;

  const progress =
    obj.progress == null || obj.progress === "" ? null : clampPct(obj.progress);

  const keyResults = Array.isArray(obj.keyResults)
    ? obj.keyResults
        .filter((k) => k && k.id)
        .map((k) => ({
          id: String(k.id),
          current:
            k.current == null || k.current === "" ? null : Number(k.current),
          done: k.done === true,
        }))
    : [];

  const concerns = Array.isArray(obj.concerns)
    ? obj.concerns.map((c) => String(c)).filter(Boolean)
    : [];

  return {
    advanced: obj.advanced === true,
    progress,
    keyResults,
    note: obj.note ? String(obj.note) : "",
    concerns,
  };
}

function clampPct(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

/** Extract the first balanced top-level {...} block from text (fence-tolerant). */
function extractFirstJsonObject(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Persist a parsed assessment to the goal via goal-store. Each sub-update is
 * isolated (a bad key-result id can't void the progress note). Returns the
 * final goal state.
 * @param {string} goalId
 * @param {object} a  output of parseAssessment
 * @param {object} [opts] { root }
 */
export function applyAssessment(goalId, a, opts = {}) {
  if (!a) return getGoal(goalId, opts);

  // Key-result updates first (they may drive derived progress).
  for (const kr of a.keyResults || []) {
    try {
      setKeyResult(goalId, kr.id, { current: kr.current, done: kr.done }, opts);
    } catch {
      /* unknown / stale key-result id — skip, don't void the rest */
    }
  }

  // Explicit progress and/or the agent note.
  if (a.progress != null || a.note) {
    try {
      recordProgress(
        goalId,
        { pct: a.progress, note: a.note, by: "agent" },
        opts,
      );
    } catch {
      /* best-effort */
    }
  }

  // Drift: a no-advance run, plus any explicit concerns.
  const flags = [];
  if (!a.advanced) {
    flags.push({ kind: "no-progress", detail: "run did not advance the goal" });
  }
  for (const c of a.concerns || []) flags.push({ kind: "concern", detail: c });
  if (flags.length) {
    try {
      addDriftFlags(goalId, flags, opts);
    } catch {
      /* best-effort */
    }
  }

  return getGoal(goalId, opts);
}

/**
 * Full orchestration: prompt → chat → parse → apply. Returns
 * `{ assessment, goal }` (assessment is null when the judge gave no usable JSON).
 * @param {object} params { goal, transcript, chat, opts }
 *        chat: (promptString) => Promise<string>
 */
export async function assessGoalProgress({
  goal,
  transcript,
  chat,
  opts = {},
}) {
  if (!goal || typeof chat !== "function") {
    return { assessment: null, goal: goal || null };
  }
  const prompt = buildAssessPrompt(goal, transcript);
  let reply;
  try {
    reply = await chat(prompt);
  } catch {
    return { assessment: null, goal };
  }
  const assessment = parseAssessment(reply);
  if (!assessment) return { assessment: null, goal };
  const updated = applyAssessment(goal.id, assessment, opts);
  return { assessment, goal: updated };
}
