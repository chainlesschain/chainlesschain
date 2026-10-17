import { types } from "node:util";
import { createSkillDecisionRequest } from "../decision-layer/contracts.js";

const MAX_BYTES = 256 * 1024;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

// Capture descriptors before any authority await. Never evaluate source getters
// or allow caller mutation to change committed evidence or outbound bytes.
function snapshot(value) {
  let nodes = 0;
  let bytes = 0;
  const seen = new Set();
  const visit = (entry, depth) => {
    if (++nodes > 4096 || depth > 16)
      throw new TypeError("Skill decision input exceeds its structural budget");
    if (typeof entry === "string") {
      bytes += Buffer.byteLength(entry, "utf8");
      if (bytes > MAX_BYTES)
        throw new TypeError("Skill decision input exceeds its byte budget");
      return entry;
    }
    if (
      entry === null ||
      typeof entry === "boolean" ||
      (typeof entry === "number" && Number.isFinite(entry))
    )
      return entry;
    if (
      !entry ||
      typeof entry !== "object" ||
      types.isProxy(entry) ||
      seen.has(entry)
    )
      throw new TypeError(
        "Skill decision input must be acyclic plain JSON data",
      );
    const array = Array.isArray(entry);
    if (
      !array &&
      ![Object.prototype, null].includes(Object.getPrototypeOf(entry))
    )
      throw new TypeError("Skill decision input must use plain objects");
    const keys = Reflect.ownKeys(entry).filter(
      (key) => !(array && key === "length"),
    );
    if (
      array &&
      (keys.length !== entry.length ||
        keys.some((key, index) => key !== String(index)))
    )
      throw new TypeError("Skill decision arrays must be dense data");
    seen.add(entry);
    const output = array ? [] : Object.create(null);
    for (const key of keys) {
      const property = Object.getOwnPropertyDescriptor(entry, key);
      if (
        typeof key !== "string" ||
        !property?.enumerable ||
        !("value" in property)
      )
        throw new TypeError(
          "Skill decision input cannot contain accessors or symbols",
        );
      bytes += Buffer.byteLength(key, "utf8");
      if (bytes > MAX_BYTES)
        throw new TypeError("Skill decision input exceeds its byte budget");
      Object.defineProperty(output, key, {
        value: visit(property.value, depth + 1),
        enumerable: true,
      });
    }
    seen.delete(entry);
    return Object.freeze(output);
  };
  const result = visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_BYTES)
    throw new TypeError("Skill decision input exceeds its byte budget");
  return result;
}

function exact(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")
  )
    throw new TypeError("Skill decision has an unsupported protocol shape");
}

function text(value) {
  if (typeof value !== "string" || !value.length)
    throw new TypeError("Skill decision requires nonempty text");
}

export function snapshotSkillDecisionPayload(value) {
  const payload = snapshot(value);
  exact(payload, ["state", "questions"]);
  exact(payload.state, ["task", "candidates"]);
  text(payload.state.task);
  const candidates = payload.state.candidates;
  if (
    !Array.isArray(candidates) ||
    candidates.length < 1 ||
    candidates.length > 8
  )
    throw new TypeError("Skill decision requires bounded candidates");
  candidates.forEach((candidate, index) => {
    exact(candidate, [
      "candidateId",
      "name",
      "description",
      "category",
      "tags",
    ]);
    if (candidate.candidateId !== `c${index + 1}`)
      throw new TypeError("Skill decision candidate identity changed");
    for (const key of ["name", "description", "category"]) text(candidate[key]);
    if (!Array.isArray(candidate.tags) || candidate.tags.length > 32)
      throw new TypeError("Skill decision tags are unbounded");
    candidate.tags.forEach(text);
  });
  const ids = candidates.map(({ candidateId }) => candidateId);
  exact(payload.questions, [
    "needs_skill",
    "best_skill",
    ...ids.map((id) => `fits_${id}`),
  ]);
  for (const key of ["needs_skill", ...ids.map((id) => `fits_${id}`)]) {
    exact(payload.questions[key], ["type", "instructions"]);
    if (payload.questions[key].type !== "noul")
      throw new TypeError("Skill decision question type changed");
    text(payload.questions[key].instructions);
  }
  const choice = payload.questions.best_skill;
  exact(choice, ["type", "instructions", "criteria"]);
  if (choice.type !== "choice")
    throw new TypeError("Skill decision question type changed");
  text(choice.instructions);
  exact(choice.criteria, [...ids, "none"]);
  Object.values(choice.criteria).forEach(text);
  return payload;
}

export function snapshotSkillDecisionRequest(value) {
  const request = snapshot(value);
  const rebuilt = createSkillDecisionRequest({
    decisionId: request.decisionId,
    ...request.binding,
    query: request.payload?.state?.task,
    candidates: request.candidates,
  });
  if (canonical(request) !== canonical(rebuilt))
    throw new TypeError("Skill decision request identity or contract changed");
  snapshotSkillDecisionPayload(request.payload);
  return request;
}

function textPath(path) {
  return (
    /^state\.task$/u.test(path) ||
    /^state\.candidates\.\d+\.(?:name|description|category|tags\.\d+)$/u.test(
      path,
    ) ||
    /^questions\.best_skill\.criteria\.c[1-8]$/u.test(path)
  );
}

export function buildSkillDecisionPayload(original, projection) {
  if (
    projection.visibility !== "model-visible" ||
    projection.truncated ||
    (projection.redactionSummary?.byType?.["content-truncation"] ?? 0) > 0
  )
    throw new Error("Skill decision projection is opaque or truncated");
  const captured = snapshotSkillDecisionPayload(original);
  const projected = snapshotSkillDecisionPayload(projection.content);
  const compare = (before, after, path = "") => {
    if (
      typeof before === "string" &&
      typeof after === "string" &&
      textPath(path)
    )
      return;
    if (before === null || typeof before !== "object") {
      if (before !== after)
        throw new Error("Skill decision projection changed protocol metadata");
      return;
    }
    if (
      !after ||
      typeof after !== "object" ||
      Array.isArray(before) !== Array.isArray(after) ||
      Object.keys(before).sort().join("\0") !==
        Object.keys(after).sort().join("\0")
    )
      throw new Error("Skill decision projection changed protocol structure");
    for (const key of Object.keys(before))
      compare(before[key], after[key], path ? `${path}.${key}` : key);
  };
  compare(captured, projected);
  return projected;
}
