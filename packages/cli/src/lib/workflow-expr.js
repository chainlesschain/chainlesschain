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
