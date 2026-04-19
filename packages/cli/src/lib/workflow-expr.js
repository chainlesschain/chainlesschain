/**
 * Workflow expression sandbox — evaluate `when` conditions and resolve
 * typed step-result references for `forEach` expansion.
 *
 * SAFETY: hand-written tokenizer + recursive-descent parser, no
 * `Function` / `eval`. Only the operators below are supported.
 *
 * Grammar (informal):
 *
 *   expr    := or
 *   or      := and ( "||" and )*
 *   and     := not ( "&&" not )*
 *   not     := "!" not | cmp
 *   cmp     := primary ( OP primary )?        OP ∈ { == != < <= > >= contains }
 *   primary := "(" expr ")" | ref | string | number | bool | null
 *   ref     := "${" "step" "." ID "." ID "}"   OR  "${item}"
 *
 * String literals use single or double quotes; `\'` / `\"` / `\\` escapes.
 *
 * `evaluate(expr, ctx)` returns a boolean. `ctx` shape:
 *   {
 *     step: Map<stepId, { status, taskId, result: { summary, tokenCount, ... } }>,
 *     item: any,  // for forEach expansion
 *   }
 *
 * `resolveReference(ref, ctx)` returns the raw value of a `${...}` token
 * (used by forEach to materialize array sources).
 *
 * @module workflow-expr
 */

const TOKEN_OP = new Set([
  "==",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
  "contains",
  "&&",
  "||",
  "!",
  "(",
  ")",
]);

/**
 * Tokenize an expression string. Returns an array of `{ type, value }`.
 * Types: `op`, `ref`, `string`, `number`, `bool`, `null`.
 */
export function tokenize(src) {
  if (typeof src !== "string") throw new Error("expr must be a string");
  const tokens = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n") {
      i++;
      continue;
    }
    if (c === "(" || c === ")") {
      tokens.push({ type: "op", value: c });
      i++;
      continue;
    }
    if (c === "$" && src[i + 1] === "{") {
      const end = src.indexOf("}", i + 2);
      if (end === -1) throw new Error("unterminated reference");
      tokens.push({ type: "ref", value: src.slice(i + 2, end).trim() });
      i = end + 1;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let out = "";
      while (j < n && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < n) {
          out += src[j + 1];
          j += 2;
        } else {
          out += src[j];
          j++;
        }
      }
      if (j >= n) throw new Error("unterminated string literal");
      tokens.push({ type: "string", value: out });
      i = j + 1;
      continue;
    }
    if (/[0-9-]/.test(c)) {
      let j = i;
      if (src[j] === "-") j++;
      while (j < n && /[0-9.]/.test(src[j])) j++;
      const lit = src.slice(i, j);
      const num = Number(lit);
      if (!Number.isFinite(num)) throw new Error(`bad number: ${lit}`);
      tokens.push({ type: "number", value: num });
      i = j;
      continue;
    }
    // Multi-char ops
    const two = src.slice(i, i + 2);
    if (
      two === "==" ||
      two === "!=" ||
      two === "<=" ||
      two === ">=" ||
      two === "&&" ||
      two === "||"
    ) {
      tokens.push({ type: "op", value: two });
      i += 2;
      continue;
    }
    if (c === "<" || c === ">" || c === "!") {
      tokens.push({ type: "op", value: c });
      i++;
      continue;
    }
    // Identifiers: contains / true / false / null
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < n && /[a-zA-Z0-9_]/.test(src[j])) j++;
      const id = src.slice(i, j);
      if (id === "true" || id === "false") {
        tokens.push({ type: "bool", value: id === "true" });
      } else if (id === "null") {
        tokens.push({ type: "null", value: null });
      } else if (id === "contains") {
        tokens.push({ type: "op", value: "contains" });
      } else {
        throw new Error(`unknown identifier: ${id}`);
      }
      i = j;
      continue;
    }
    throw new Error(`unexpected char at ${i}: ${c}`);
  }
  return tokens;
}

/** Resolve a ref token like `step.fetch.summary` or `item` against ctx. */
export function resolveReference(ref, ctx) {
  if (ref === "item") return ctx?.item;
  const parts = ref.split(".");
  if (parts[0] !== "step") {
    throw new Error(`unknown reference root: ${parts[0]}`);
  }
  if (parts.length !== 3) {
    throw new Error(`ref must be step.<id>.<field>: ${ref}`);
  }
  const [, stepId, field] = parts;
  const entry = ctx?.step?.get?.(stepId);
  if (!entry) return undefined;
  if (field === "status") return entry.status;
  if (field === "taskId") return entry.taskId;
  if (field === "summary") return entry.result?.summary;
  if (field === "tokenCount") return entry.result?.tokenCount;
  if (field === "iterationCount") return entry.result?.iterationCount;
  if (field === "toolsUsed") return entry.result?.toolsUsed;
  if (field === "items") return entry.result?.items;
  // Generic fallback: look up directly on result
  return entry.result?.[field];
}

/** Recursive-descent parser returning an AST. */
function parse(tokens) {
  let pos = 0;
  function peek() {
    return tokens[pos];
  }
  function consume(expected) {
    const t = tokens[pos];
    if (!t) throw new Error("unexpected end of expression");
    if (expected && (t.type !== "op" || t.value !== expected)) {
      throw new Error(`expected ${expected}, got ${t.value ?? t.type}`);
    }
    pos++;
    return t;
  }
  function parseExpr() {
    return parseOr();
  }
  function parseOr() {
    let left = parseAnd();
    while (peek() && peek().type === "op" && peek().value === "||") {
      pos++;
      const right = parseAnd();
      left = { kind: "or", left, right };
    }
    return left;
  }
  function parseAnd() {
    let left = parseNot();
    while (peek() && peek().type === "op" && peek().value === "&&") {
      pos++;
      const right = parseNot();
      left = { kind: "and", left, right };
    }
    return left;
  }
  function parseNot() {
    if (peek() && peek().type === "op" && peek().value === "!") {
      pos++;
      return { kind: "not", expr: parseNot() };
    }
    return parseCmp();
  }
  function parseCmp() {
    const left = parsePrimary();
    const t = peek();
    const cmpOps = new Set(["==", "!=", "<", "<=", ">", ">=", "contains"]);
    if (t && t.type === "op" && cmpOps.has(t.value)) {
      pos++;
      const right = parsePrimary();
      return { kind: "cmp", op: t.value, left, right };
    }
    // bare value → truthiness check
    return { kind: "truthy", expr: left };
  }
  function parsePrimary() {
    const t = peek();
    if (!t) throw new Error("unexpected end of expression");
    if (t.type === "op" && t.value === "(") {
      pos++;
      const e = parseExpr();
      consume(")");
      return e;
    }
    if (t.type === "ref") {
      pos++;
      return { kind: "ref", name: t.value };
    }
    if (
      t.type === "string" ||
      t.type === "number" ||
      t.type === "bool" ||
      t.type === "null"
    ) {
      pos++;
      return { kind: "lit", value: t.value };
    }
    throw new Error(`unexpected token: ${t.value ?? t.type}`);
  }

  const ast = parseExpr();
  if (pos !== tokens.length) {
    throw new Error(`trailing tokens at ${pos}`);
  }
  return ast;
}

function evalAst(ast, ctx) {
  switch (ast.kind) {
    case "lit":
      return ast.value;
    case "ref":
      return resolveReference(ast.name, ctx);
    case "not":
      return !evalAst(ast.expr, ctx);
    case "and":
      return evalAst(ast.left, ctx) && evalAst(ast.right, ctx);
    case "or":
      return evalAst(ast.left, ctx) || evalAst(ast.right, ctx);
    case "truthy": {
      const v = evalAst(ast.expr, ctx);
      return !!v;
    }
    case "cmp": {
      const l = evalAst(ast.left, ctx);
      const r = evalAst(ast.right, ctx);
      switch (ast.op) {
        case "==":
          // Loose equality across string/number for ergonomic use
          // eslint-disable-next-line eqeqeq
          return l == r;
        case "!=":
          // eslint-disable-next-line eqeqeq
          return l != r;
        case "<":
          return l < r;
        case "<=":
          return l <= r;
        case ">":
          return l > r;
        case ">=":
          return l >= r;
        case "contains": {
          if (l == null) return false;
          if (Array.isArray(l)) return l.includes(r);
          return String(l).includes(String(r));
        }
        default:
          throw new Error(`unknown op: ${ast.op}`);
      }
    }
    default:
      throw new Error(`unknown node: ${ast.kind}`);
  }
}

/** Evaluate an expression string against a context. Returns a boolean. */
export function evaluate(src, ctx) {
  const tokens = tokenize(src);
  const ast = parse(tokens);
  const v = evalAst(ast, ctx);
  return !!v;
}

/** Evaluate an expression and return the raw (non-coerced) value. */
export function evaluateRaw(src, ctx) {
  const tokens = tokenize(src);
  let ast = parse(tokens);
  // Strip the implicit truthy-wrapper so bare refs return raw values.
  if (ast.kind === "truthy") ast = ast.expr;
  return evalAst(ast, ctx);
}

// =====================================================================
// workflow-expr V2 governance overlay (iter26)
// =====================================================================
export const WFEXGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "archived",
});
export const WFEXGOV_EVAL_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  EVALUATING: "evaluating",
  EVALUATED: "evaluated",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _wfexgovPTrans = new Map([
  [
    WFEXGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      WFEXGOV_PROFILE_MATURITY_V2.ACTIVE,
      WFEXGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    WFEXGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      WFEXGOV_PROFILE_MATURITY_V2.PAUSED,
      WFEXGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    WFEXGOV_PROFILE_MATURITY_V2.PAUSED,
    new Set([
      WFEXGOV_PROFILE_MATURITY_V2.ACTIVE,
      WFEXGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [WFEXGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _wfexgovPTerminal = new Set([WFEXGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _wfexgovJTrans = new Map([
  [
    WFEXGOV_EVAL_LIFECYCLE_V2.QUEUED,
    new Set([
      WFEXGOV_EVAL_LIFECYCLE_V2.EVALUATING,
      WFEXGOV_EVAL_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    WFEXGOV_EVAL_LIFECYCLE_V2.EVALUATING,
    new Set([
      WFEXGOV_EVAL_LIFECYCLE_V2.EVALUATED,
      WFEXGOV_EVAL_LIFECYCLE_V2.FAILED,
      WFEXGOV_EVAL_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [WFEXGOV_EVAL_LIFECYCLE_V2.EVALUATED, new Set()],
  [WFEXGOV_EVAL_LIFECYCLE_V2.FAILED, new Set()],
  [WFEXGOV_EVAL_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _wfexgovPsV2 = new Map();
const _wfexgovJsV2 = new Map();
let _wfexgovMaxActive = 8,
  _wfexgovMaxPending = 20,
  _wfexgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _wfexgovStuckMs = 60 * 1000;
function _wfexgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _wfexgovCheckP(from, to) {
  const a = _wfexgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid wfexgov profile transition ${from} → ${to}`);
}
function _wfexgovCheckJ(from, to) {
  const a = _wfexgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid wfexgov eval transition ${from} → ${to}`);
}
function _wfexgovCountActive(owner) {
  let c = 0;
  for (const p of _wfexgovPsV2.values())
    if (p.owner === owner && p.status === WFEXGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _wfexgovCountPending(profileId) {
  let c = 0;
  for (const j of _wfexgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === WFEXGOV_EVAL_LIFECYCLE_V2.QUEUED ||
        j.status === WFEXGOV_EVAL_LIFECYCLE_V2.EVALUATING)
    )
      c++;
  return c;
}
export function setMaxActiveWfexgovProfilesPerOwnerV2(n) {
  _wfexgovMaxActive = _wfexgovPos(n, "maxActiveWfexgovProfilesPerOwner");
}
export function getMaxActiveWfexgovProfilesPerOwnerV2() {
  return _wfexgovMaxActive;
}
export function setMaxPendingWfexgovEvalsPerProfileV2(n) {
  _wfexgovMaxPending = _wfexgovPos(n, "maxPendingWfexgovEvalsPerProfile");
}
export function getMaxPendingWfexgovEvalsPerProfileV2() {
  return _wfexgovMaxPending;
}
export function setWfexgovProfileIdleMsV2(n) {
  _wfexgovIdleMs = _wfexgovPos(n, "wfexgovProfileIdleMs");
}
export function getWfexgovProfileIdleMsV2() {
  return _wfexgovIdleMs;
}
export function setWfexgovEvalStuckMsV2(n) {
  _wfexgovStuckMs = _wfexgovPos(n, "wfexgovEvalStuckMs");
}
export function getWfexgovEvalStuckMsV2() {
  return _wfexgovStuckMs;
}
export function _resetStateWorkflowExprGovV2() {
  _wfexgovPsV2.clear();
  _wfexgovJsV2.clear();
  _wfexgovMaxActive = 8;
  _wfexgovMaxPending = 20;
  _wfexgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _wfexgovStuckMs = 60 * 1000;
}
export function registerWfexgovProfileV2({
  id,
  owner,
  language,
  metadata,
} = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_wfexgovPsV2.has(id))
    throw new Error(`wfexgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    language: language || "cel",
    status: WFEXGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _wfexgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateWfexgovProfileV2(id) {
  const p = _wfexgovPsV2.get(id);
  if (!p) throw new Error(`wfexgov profile ${id} not found`);
  const isInitial = p.status === WFEXGOV_PROFILE_MATURITY_V2.PENDING;
  _wfexgovCheckP(p.status, WFEXGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _wfexgovCountActive(p.owner) >= _wfexgovMaxActive)
    throw new Error(`max active wfexgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = WFEXGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function pauseWfexgovProfileV2(id) {
  const p = _wfexgovPsV2.get(id);
  if (!p) throw new Error(`wfexgov profile ${id} not found`);
  _wfexgovCheckP(p.status, WFEXGOV_PROFILE_MATURITY_V2.PAUSED);
  p.status = WFEXGOV_PROFILE_MATURITY_V2.PAUSED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveWfexgovProfileV2(id) {
  const p = _wfexgovPsV2.get(id);
  if (!p) throw new Error(`wfexgov profile ${id} not found`);
  _wfexgovCheckP(p.status, WFEXGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = WFEXGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchWfexgovProfileV2(id) {
  const p = _wfexgovPsV2.get(id);
  if (!p) throw new Error(`wfexgov profile ${id} not found`);
  if (_wfexgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal wfexgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getWfexgovProfileV2(id) {
  const p = _wfexgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listWfexgovProfilesV2() {
  return [..._wfexgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createWfexgovEvalV2({
  id,
  profileId,
  expression,
  metadata,
} = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_wfexgovJsV2.has(id))
    throw new Error(`wfexgov eval ${id} already exists`);
  if (!_wfexgovPsV2.has(profileId))
    throw new Error(`wfexgov profile ${profileId} not found`);
  if (_wfexgovCountPending(profileId) >= _wfexgovMaxPending)
    throw new Error(
      `max pending wfexgov evals for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    expression: expression || "",
    status: WFEXGOV_EVAL_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _wfexgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function evaluatingWfexgovEvalV2(id) {
  const j = _wfexgovJsV2.get(id);
  if (!j) throw new Error(`wfexgov eval ${id} not found`);
  _wfexgovCheckJ(j.status, WFEXGOV_EVAL_LIFECYCLE_V2.EVALUATING);
  const now = Date.now();
  j.status = WFEXGOV_EVAL_LIFECYCLE_V2.EVALUATING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeEvalWfexgovV2(id) {
  const j = _wfexgovJsV2.get(id);
  if (!j) throw new Error(`wfexgov eval ${id} not found`);
  _wfexgovCheckJ(j.status, WFEXGOV_EVAL_LIFECYCLE_V2.EVALUATED);
  const now = Date.now();
  j.status = WFEXGOV_EVAL_LIFECYCLE_V2.EVALUATED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failWfexgovEvalV2(id, reason) {
  const j = _wfexgovJsV2.get(id);
  if (!j) throw new Error(`wfexgov eval ${id} not found`);
  _wfexgovCheckJ(j.status, WFEXGOV_EVAL_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = WFEXGOV_EVAL_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelWfexgovEvalV2(id, reason) {
  const j = _wfexgovJsV2.get(id);
  if (!j) throw new Error(`wfexgov eval ${id} not found`);
  _wfexgovCheckJ(j.status, WFEXGOV_EVAL_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = WFEXGOV_EVAL_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getWfexgovEvalV2(id) {
  const j = _wfexgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listWfexgovEvalsV2() {
  return [..._wfexgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoPauseIdleWfexgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _wfexgovPsV2.values())
    if (
      p.status === WFEXGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _wfexgovIdleMs
    ) {
      p.status = WFEXGOV_PROFILE_MATURITY_V2.PAUSED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckWfexgovEvalsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _wfexgovJsV2.values())
    if (
      j.status === WFEXGOV_EVAL_LIFECYCLE_V2.EVALUATING &&
      j.startedAt != null &&
      t - j.startedAt >= _wfexgovStuckMs
    ) {
      j.status = WFEXGOV_EVAL_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getWorkflowExprGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(WFEXGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _wfexgovPsV2.values()) profilesByStatus[p.status]++;
  const evalsByStatus = {};
  for (const v of Object.values(WFEXGOV_EVAL_LIFECYCLE_V2))
    evalsByStatus[v] = 0;
  for (const j of _wfexgovJsV2.values()) evalsByStatus[j.status]++;
  return {
    totalWfexgovProfilesV2: _wfexgovPsV2.size,
    totalWfexgovEvalsV2: _wfexgovJsV2.size,
    maxActiveWfexgovProfilesPerOwner: _wfexgovMaxActive,
    maxPendingWfexgovEvalsPerProfile: _wfexgovMaxPending,
    wfexgovProfileIdleMs: _wfexgovIdleMs,
    wfexgovEvalStuckMs: _wfexgovStuckMs,
    profilesByStatus,
    evalsByStatus,
  };
}
