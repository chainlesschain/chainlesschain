import { parse as parseSource, parseExpressionAt, tokenizer } from "acorn";

// Decode data only: no evaluation, revivers, prototype setters or permissive
// JSON repair. Budgets belong to the entire projection, including nested text.
export const EVIDENCE_JSON_POLICY = Object.freeze({
  version: 1,
  maxLayers: 4,
  maxDepth: 16,
  maxNodes: 4096,
  maxDecodedBytes: 4 * 1024 * 1024,
  duplicates: "reject-decoded-keys",
  malformed: "reject-recognized-json",
  arguments: "object-only",
  numbers: "finite-safe-integers-pii-to-string",
});

export const AGENT_CODE_TEXT_RESULT_TOOLS = Object.freeze([
  "run_code",
  "read_file",
  "run_shell",
  "check_shell",
  "git",
  "search_files",
]);

export const AGENT_FENCED_CODE_LANGUAGES = Object.freeze([
  "javascript",
  "js",
  "typescript",
  "ts",
  "jsx",
  "tsx",
  "python",
  "py",
]);

function fencedCodeRanges(text, languages) {
  const ranges = [];
  const fences = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)\r?$/gmu;
  let opening = null;
  for (const match of text.matchAll(fences)) {
    const marker = match[1];
    const info = match[2].trim().toLowerCase();
    if (opening === null) {
      opening = {
        marker,
        supported: languages.includes(info),
        start: match.index + match[0].length,
      };
    } else if (
      marker[0] === opening.marker[0] &&
      marker.length >= opening.marker.length &&
      info === ""
    ) {
      if (opening.supported) ranges.push([opening.start, match.index]);
      opening = null;
    }
  }
  // Unclosed/unknown fences never acquire code semantics.
  return ranges;
}

/* eslint-disable no-control-regex -- Quoted literals exclude unescaped control bytes. */
const JSON_STRING_PREFIX =
  /^"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/u;
const CODE_DOUBLE_QUOTED_PREFIX = /^"(?:[^"\\\x00-\x1f]|\\[\s\S])*"/u;
const CODE_SINGLE_QUOTED_PREFIX = /^'(?:[^'\\\x00-\x1f]|\\[\s\S])*'/u;
/* eslint-enable no-control-regex */

// Only closed, bounded display formats qualify. Never accept quotes, escapes,
// commas or nested containers here. Exponent-shaped hashes remain JSON numbers
// so non-finite/unsafe numeric values cannot evade the existing budget checks.
const DISPLAY_BRACKET_MARKER = new RegExp(
  "^\\[(?:" +
    "\\d+[ \\t]+\\d+(?:[ \\t]+\\d+)*|" +
    "\\d+[ \\t]*\\/[ \\t]*\\d+(?:[ \\t]+\\d{1,3}%)?|" +
    "\\d+[ \\t]+of[ \\t]+\\d+|" +
    "\\d{1,3}(?:\\.\\d+)?%|" +
    "\\d{4}-\\d{2}-\\d{2}(?:[ T]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?(?:Z|[+-]\\d{2}:\\d{2})?)?|" +
    "\\d{1,2}:\\d{2}(?::\\d{2}(?:\\.\\d{1,9})?)?|" +
    "v?\\d+\\.\\d+\\.\\d+|" +
    "[0-9]-[0-9]|" +
    "\\[[A-Za-z][A-Za-z0-9_./ #+-]*\\]|" +
    "[ \\t]+\\d+[ \\t]+-(?:eq|ne|lt|le|gt|ge)[ \\t]+\\d+[ \\t]+|" +
    "\\[[ \\t]+-[defrswx][ \\t]+[A-Za-z0-9_./-]+[ \\t]+\\]|" +
    "(?!\\d+[eE]\\d+\\])(?=[0-9a-f]{7,64}\\])(?=[0-9a-f]*[a-f])[0-9][0-9a-f]+|" +
    "[0-9a-f]{7,64}\\.\\.[0-9a-f]{7,64}" +
    ")\\]",
  "u",
);

export function isAgentToolArgumentsPath(path) {
  return (
    path.length === 6 &&
    path[0] === "messages" &&
    /^\d+$/u.test(path[1]) &&
    path[2] === "tool_calls" &&
    /^\d+$/u.test(path[3]) &&
    path[4] === "function" &&
    path[5] === "arguments"
  );
}

function assignmentKeyBefore(text, start, end) {
  let index = end - 1;
  while (index >= start && /\s/u.test(text[index])) index--;
  if (text[index] !== ":" && text[index] !== "=") return undefined;
  index--;
  while (index >= start && /\s/u.test(text[index])) index--;
  const keyEnd = index + 1;
  while (index >= start && !/[\s"'{}[\],:=]/u.test(text[index])) index--;
  return keyEnd > index + 1 ? text.slice(index + 1, keyEnd) : undefined;
}

// New expression syntax retains all preceding decoded names, including targets
// across calls, destructuring and nested statements. Without a language parser,
// newline/semicolon cannot prove an enclosing sensitive assignment has ended.
// This check applies only to newly admitted syntax; historical code keeps its
// existing scanner. The cursor and shared budgets bound the additional work.
function createSourcePrefixTracker(text, requireSafeKey, rejectOpaque) {
  let cursor = 0;
  let candidates = [];
  return (until) => {
    while (cursor < until) {
      const char = text[cursor];
      if (char === "`") {
        let end = cursor + 1;
        for (; end < text.length; end++) {
          if (text[end] === "\\") end++;
          else if (text[end] === "`") break;
        }
        // Template interpolation has its own grammar. Do not grant new source
        // semantics inside it without a decoder for its escapes and bindings.
        if (end >= until) rejectOpaque();
        cursor = end + 1;
        continue;
      }
      if (char === '"' || char === "'") {
        const literal = (
          char === '"' ? CODE_DOUBLE_QUOTED_PREFIX : CODE_SINGLE_QUOTED_PREFIX
        ).exec(text.slice(cursor))?.[0];
        if (!literal) {
          cursor++;
          continue;
        }
        candidates.push({ literal });
        cursor += literal.length;
        continue;
      }
      const name =
        /^(?:[$_\p{ID_Start}]|\\u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]{1,6}\}))(?:[$\p{ID_Continue}]|\\u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]{1,6}\}))*/u.exec(
          text.slice(cursor),
        )?.[0];
      if (name) {
        candidates.push({ key: name });
        cursor += name.length;
        continue;
      }
      if (text.slice(cursor, cursor + 2) === "/*") {
        const end = text.indexOf("*/", cursor + 2);
        if (end < 0 || end >= until) rejectOpaque();
        cursor = end + 2;
        continue;
      }
      if (char === "#" && /\s/u.test(text[cursor + 1] ?? "")) {
        const newline = text.indexOf("\n", cursor);
        cursor = newline < 0 ? text.length : newline;
        continue;
      }
      cursor++;
    }
    for (const entry of candidates) requireSafeKey(entry);
    candidates = [];
  };
}

export function createEvidenceJsonTextBoundary(
  fail,
  policy = EVIDENCE_JSON_POLICY,
) {
  let nodes = 0;
  let sourceTokens = 0;
  let bytes = 0;
  const PARSE_FAILURE = Symbol("evidence-json-parse-failure");
  const reject = (
    message = "Agent model JSON text is malformed or ambiguous",
  ) => {
    throw fail(message);
  };
  const rejectParseFailure = (error) => {
    reject(
      error?.[PARSE_FAILURE] === "budget"
        ? "Agent model JSON text exceeds its budget"
        : "Agent model JSON text is malformed or ambiguous",
    );
  };
  const parserReject = (kind) => {
    const error = new Error(kind);
    Object.defineProperty(error, PARSE_FAILURE, { value: kind });
    throw error;
  };
  // Source syntax is admitted only at a known code field. Require an operand:
  // a bare spread/operator must never turn malformed JSON into plain text.
  // Do not admit templates or regex literals: their escapes are not decoded by
  // this boundary. Numeric operands retain the strict JSON number budget.
  const sourceOperand = (text) => {
    const rest = text.trimStart();
    if (/^[$_\p{ID_Start}('"[{]/u.test(rest)) return true;
    const token = /^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(rest)?.[0];
    if (!token || /[\w$.]/u.test(rest[token.length] ?? "")) return false;
    const number = Number(token);
    if (
      !Number.isFinite(number) ||
      (Number.isInteger(number) && !Number.isSafeInteger(number))
    )
      parserReject("budget");
    return true;
  };
  const sourcePrefix = (text, objectSpread = false) => {
    const token = (
      objectSpread ? /^(?:\*\*|\.\.\.)/u : /^(?:\.\.\.|\*{1,2}|[+!~]|-(?!\d))/u
    ).exec(text)?.[0];
    return token !== undefined && sourceOperand(text.slice(token.length));
  };
  const sourceContinuation = (text) => {
    // Existing call/member/conditional syntax keeps its historical handling.
    if (/^[.(?]/u.test(text)) return true;
    const token =
      /^(?:\*\*|\/\/|>>>?|<<|===?|!==?|<=?|>=?|&&?|\|\|?|[-+*/%&|^]|(?:and|or|if|in|is|not)\b)/u.exec(
        text,
      )?.[0];
    return token !== undefined && sourceOperand(text.slice(token.length));
  };
  const decodeSourceString = (literal, quote) => {
    let output = "";
    for (let index = 1; index < literal.length - 1; index++) {
      const char = literal[index];
      if (char !== "\\") {
        output += char;
        continue;
      }
      const escaped = literal[++index];
      if (/[0-7]/u.test(escaped ?? "")) {
        const digits = /^[0-7]{1,3}/u.exec(literal.slice(index))[0];
        output += String.fromCodePoint(Number.parseInt(digits, 8));
        index += digits.length - 1;
        continue;
      }
      // Python named Unicode escapes require a Unicode-name database. Refuse
      // them instead of treating an encoded sensitive key/value as plain text.
      if (escaped === "N" && literal[index + 1] === "{")
        return parserReject("syntax");
      const simple = {
        "'": "'",
        '"': '"',
        "\\": "\\",
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
        v: "\v",
        0: "\0",
      };
      if (escaped === quote || Object.hasOwn(simple, escaped)) {
        output += simple[escaped] ?? escaped;
        continue;
      }
      if (escaped === "x" || escaped === "u" || escaped === "U") {
        if (escaped === "u" && literal[index + 1] === "{") {
          const close = literal.indexOf("}", index + 2);
          const digits = close < 0 ? "" : literal.slice(index + 2, close);
          if (/^[0-9a-fA-F]{1,6}$/u.test(digits)) {
            const codePoint = Number.parseInt(digits, 16);
            if (codePoint <= 0x10ffff) {
              output += String.fromCodePoint(codePoint);
              index = close;
              continue;
            }
          }
        }
        const count = escaped === "x" ? 2 : escaped === "u" ? 4 : 8;
        const digits = literal.slice(index + 1, index + 1 + count);
        if (new RegExp(`^[0-9a-fA-F]{${count}}$`, "u").test(digits)) {
          const codePoint = Number.parseInt(digits, 16);
          if (codePoint <= 0x10ffff) {
            output += String.fromCodePoint(codePoint);
            index += count;
            continue;
          }
        }
        output += `\\${escaped}`;
        continue;
      }
      // Keep line continuations and language-specific escapes bounded to the
      // source literal. The decoded value is used only for evidence scanning.
      if (escaped === "\n") continue;
      if (escaped === "\r" && literal[index + 1] === "\n") {
        index++;
        continue;
      }
      output += escaped;
    }
    return output;
  };
  const parser = (
    text,
    start,
    {
      allowSingleQuotedStrings = false,
      allowSourceExpressions = false,
      allowSourceLiteralSyntax = false,
    } = {},
  ) => {
    let index = start;
    const whitespace = () => {
      while (/[ \t\r\n]/u.test(text[index] ?? "x")) index++;
    };
    const string = () => {
      const begin = index++;
      while (index < text.length) {
        const char = text[index++];
        if (char === "\\") index++;
        else if (char === '"') {
          try {
            return JSON.parse(text.slice(begin, index));
          } catch {
            if (allowSingleQuotedStrings)
              return decodeSourceString(text.slice(begin, index), '"');
            return parserReject("syntax");
          }
        }
      }
      return parserReject("syntax");
    };
    const singleQuotedString = () => {
      const begin = index++;
      while (index < text.length) {
        const char = text[index++];
        if (char === "\\") index++;
        else if (char === "'")
          return decodeSourceString(text.slice(begin, index), "'");
      }
      return parserReject("syntax");
    };
    const value = (depth = 0) => {
      if (++nodes > policy.maxNodes || depth > policy.maxDepth)
        parserReject("budget");
      whitespace();
      const char = text[index];
      if (char === '"') return string();
      if (char === "'" && allowSingleQuotedStrings) return singleQuotedString();
      if (char === "'") return parserReject("code-expression");
      if (char === "{" || char === "[") {
        const array = char === "[";
        const end = array ? "]" : "}";
        const output = array ? [] : Object.create(null);
        index++;
        whitespace();
        if (text[index] === end) {
          index++;
          return output;
        }
        while (index < text.length) {
          let key;
          if (!array) {
            if (allowSourceExpressions && sourcePrefix(text.slice(index), true))
              parserReject("source-expression");
            if (
              text[index] !== '"' &&
              !(allowSingleQuotedStrings && text[index] === "'")
            )
              parserReject(
                text[index] === "'" || /^[A-Za-z_$]/u.test(text[index] ?? "")
                  ? "code-expression"
                  : "syntax",
              );
            key = text[index] === "'" ? singleQuotedString() : string();
            if (Object.hasOwn(output, key)) parserReject("ambiguous");
            whitespace();
            if (text[index++] !== ":") parserReject("syntax");
          }
          const child = value(depth + 1);
          if (array) output.push(child);
          else
            Object.defineProperty(output, key, {
              value: child,
              enumerable: true,
            });
          whitespace();
          if (text[index] === end) {
            index++;
            return output;
          }
          if (text[index] !== ",") {
            if (
              allowSourceExpressions &&
              !/^[.(+*/?]/u.test(text[index] ?? "") &&
              sourceContinuation(text.slice(index))
            )
              parserReject("source-expression");
            // Slices, comprehensions and member/call/arithmetic expressions
            // are source syntax. Missing delimiters and trailing commas stay
            // malformed JSON, including in run_code output.
            parserReject(
              (array && text[index] === ":") ||
                /^[.(+*/?]/u.test(text[index] ?? "") ||
                /^for\b/u.test(text.slice(index))
                ? "code-expression"
                : "syntax",
            );
          }
          index++;
          whitespace();
          if (text[index] === end) {
            if (!allowSourceLiteralSyntax) parserReject("trailing-comma");
            index++;
            return output;
          }
        }
        return parserReject("syntax");
      }
      // JavaScript numeric separators/radices are never JSON syntax. Admit
      // them only in a container independently proven by the source parser.
      const sourceNumber =
        /^[+-]?(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][+-]?[0-9_]+)?)/u.exec(
          text.slice(index),
        )?.[0];
      if (
        sourceNumber &&
        (sourceNumber.includes("_") || /^[+-]?0[xXbBoO]/u.test(sourceNumber))
      ) {
        if (!allowSourceLiteralSyntax) parserReject("source-number");
        const unsigned = sourceNumber.replace(/^[+-]/u, "").replaceAll("_", "");
        const number =
          (sourceNumber.startsWith("-") ? -1 : 1) * Number(unsigned);
        if (
          !Number.isFinite(number) ||
          (Number.isInteger(number) && !Number.isSafeInteger(number))
        )
          parserReject("budget");
        index += sourceNumber.length;
        return number;
      }
      const token =
        /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(
          text.slice(index),
        )?.[0];
      if (!token) {
        if (allowSourceExpressions && sourcePrefix(text.slice(index)))
          parserReject("source-expression");
        return parserReject(
          /^[A-Za-z_$][A-Za-z0-9_$]*|^\(/u.test(text.slice(index))
            ? "code-expression"
            : "syntax",
        );
      }
      index += token.length;
      if (
        allowSourceExpressions &&
        /^-?\d/u.test(token) &&
        (/[\p{ID_Continue}$]/u.test(text[index] ?? "") ||
          (text[index] === "." &&
            !/^\.{1,2}[$_\p{ID_Start}]/u.test(text.slice(index))))
      )
        parserReject("syntax");
      // A primitive prefix is not a complete source expression. In particular,
      // redacting only `true` from trueSecretValue would expose the suffix of
      // a sensitive quoted assignment. Historical policies retain their parser.
      if (
        policy.proseQuotedPairPolicy &&
        /[\p{ID_Continue}$\\]/u.test(text[index] ?? "")
      )
        return parserReject("code-expression");
      const parsed = JSON.parse(token);
      if (
        typeof parsed === "number" &&
        (!Number.isFinite(parsed) ||
          (Number.isInteger(parsed) && !Number.isSafeInteger(parsed)))
      )
        parserReject("budget");
      return parsed;
    };
    return {
      value,
      end: () => index,
      whitespace,
    };
  };

  return function scanText(
    text,
    {
      layer = 0,
      objectOnly = false,
      codeText = false,
      sourceText = false,
      pythonFString = false,
      fencedCodeLanguages = null,
      visit,
      plain,
      equal,
    },
  ) {
    if (!objectOnly && !codeText && fencedCodeLanguages) {
      const ranges = fencedCodeRanges(text, fencedCodeLanguages);
      if (ranges.length > 0) {
        let output = "";
        let offset = 0;
        const options = { layer, visit, plain, equal };
        for (const [start, end] of ranges) {
          output += scanText(text.slice(offset, start), options);
          output += scanText(text.slice(start, end), {
            ...options,
            codeText: true,
            sourceText: layer === 0,
          });
          offset = end;
        }
        return output + scanText(text.slice(offset), options);
      }
    }
    bytes += Buffer.byteLength(text, "utf8");
    if (bytes > policy.maxDecodedBytes)
      reject("Agent model JSON text exceeds its budget");
    const transform = (parsed, textContext) => {
      if (layer >= policy.maxLayers)
        reject("Agent model JSON text exceeds its budget");
      return visit(parsed, layer + 1, textContext);
    };
    const requireSafeSourceKey = (key) => {
      const probe = Object.defineProperty(Object.create(null), key, {
        value: "source-expression",
        enumerable: true,
      });
      if (!equal(probe, transform(probe)))
        reject(
          "Agent model code expression under a sensitive key cannot be safely projected",
        );
    };
    const requireSafeSourceAssignments = createSourcePrefixTracker(
      text,
      ({ key, literal }) => {
        if (literal) {
          const reader = parser(literal, 0, { allowSingleQuotedStrings: true });
          key = reader.value();
        } else key = decodeSourceString(`"${key}"`, '"');
        requireSafeSourceKey(key);
      },
      () =>
        reject(
          "Agent model code expression under an opaque source context cannot be safely projected",
        ),
    );
    // Source syntax is a separate, explicit boundary. A paired tool's decoded
    // string values do not inherit it. JSON-shaped standalone expressions still
    // require strict JSON, even when they happen to parse as JavaScript arrays.
    let sourceRanges;
    let sourceBindings;
    let tokenStarts;
    let containerEnds;
    let interpolationStarts;
    const sourceOptions = {
      ecmaVersion: "latest",
      sourceType: "module",
      allowReturnOutsideFunction: true,
    };
    const sourceContainer = (start) => {
      if (
        !sourceText ||
        !codeText ||
        policy.sourceLiteralPolicy !== "explicit-source-containers-v1"
      )
        return null;
      const explicit = new Set([
        "VariableDeclarator",
        "FunctionDeclaration",
        "FunctionExpression",
        "ArrowFunctionExpression",
        "CallExpression",
        "NewExpression",
        "MemberExpression",
        "AssignmentExpression",
        "ReturnStatement",
      ]);
      const bindingNames = (root) => {
        const names = [];
        const pending = [root];
        while (pending.length) {
          const node = pending.pop();
          if (!node || typeof node.type !== "string") continue;
          if (
            (node.type === "MemberExpression" || node.type === "Property") &&
            node.computed
          )
            return null;
          if (["Identifier", "PrivateIdentifier"].includes(node.type))
            names.push(node.name);
          if (node.type === "Literal" && typeof node.value === "string")
            names.push(node.value);
          for (const child of Object.values(node)) {
            if (Array.isArray(child)) pending.push(...child);
            else if (child && typeof child === "object") pending.push(child);
          }
        }
        return names;
      };
      const collect = (root, admitted = false, bindings = null) => {
        const provenAncestry = bindings !== null;
        const stack = [[root, admitted, bindings]];
        while (stack.length) {
          const [node, parentSource, parentBindings] = stack.pop();
          if (!node || typeof node.type !== "string") continue;
          const isSource = parentSource || explicit.has(node.type);
          let ownBindings = [];
          if (node.type === "VariableDeclarator")
            ownBindings = bindingNames(node.id);
          if (["AssignmentExpression", "AssignmentPattern"].includes(node.type))
            ownBindings = bindingNames(node.left);
          if (
            ["Property", "PropertyDefinition", "MethodDefinition"].includes(
              node.type,
            )
          )
            ownBindings = node.computed ? null : bindingNames(node.key);
          const activeBindings =
            parentBindings && ownBindings
              ? [...parentBindings, ...ownBindings]
              : null;
          if (
            isSource &&
            ["ArrayExpression", "ObjectExpression"].includes(node.type)
          ) {
            sourceRanges.set(node.start, node.end);
            if (provenAncestry) sourceBindings.set(node.start, activeBindings);
          }
          if (node.type === "TemplateLiteral" && provenAncestry) {
            for (const quasi of node.quasis.slice(0, -1))
              sourceBindings.set(quasi.end + 1, activeBindings);
          }
          for (const value of Object.values(node)) {
            if (Array.isArray(value))
              for (const child of value)
                stack.push([child, isSource, activeBindings]);
            else if (value && typeof value === "object")
              stack.push([value, isSource, activeBindings]);
          }
        }
      };
      if (!sourceRanges) {
        sourceRanges = new Map();
        sourceBindings = new Map();
        tokenStarts = new Set();
        containerEnds = new Map();
        interpolationStarts = new Set();
        const templates = [];
        const delimiters = [];
        let completePrefixEnd = 0;
        try {
          for (const token of tokenizer(text, sourceOptions)) {
            if (++sourceTokens > (policy.maxSourceTokens ?? policy.maxNodes))
              parserReject("budget");
            tokenStarts.add(token.start);
            const label = token.type.label;
            if (label === "`") {
              if (templates.at(-1)?.inText) templates.pop();
              else templates.push({ start: token.start, inText: true });
            }
            if (label === "${" && templates.length) {
              templates.at(-1).inText = false;
            }
            if (["[", "{", "${", "("].includes(label)) {
              delimiters.push(token);
              if (label === "${") interpolationStarts.add(token.start);
            } else if (["]", "}", ")"].includes(label)) {
              const opening = delimiters.pop();
              if (
                opening?.type.label === "${" &&
                label === "}" &&
                templates.length
              )
                templates.at(-1).inText = true;
              if (
                opening &&
                ((opening.type.label === "[" && label === "]") ||
                  (opening.type.label === "(" && label === ")") ||
                  (["{", "${"].includes(opening.type.label) && label === "}"))
              )
                containerEnds.set(opening.start, token.end);
            }
            if (
              delimiters.length === 0 &&
              templates.length === 0 &&
              [";", "}"].includes(label)
            )
              completePrefixEnd = token.end;
          }
        } catch (error) {
          if (error?.[PARSE_FAILURE]) throw error;
          tokenStarts.clear();
          interpolationStarts.clear();
          return null;
        }
        try {
          collect(parseSource(text, sourceOptions), false, []);
        } catch {
          // A page may end inside a later statement. A fully parsed top-level
          // prefix still proves the ancestors of earlier complete constructs.
          // Try only one tokenizer-bounded prefix; partial/unproven constructs
          // retain the conservative source-prefix checks.
          if (completePrefixEnd > 0 && completePrefixEnd < text.length) {
            try {
              collect(
                parseSource(text.slice(0, completePrefixEnd), sourceOptions),
                false,
                [],
              );
            } catch {
              /* No complete program prefix was proven. */
            }
          }
        }
      }
      if (!sourceRanges.has(start) && tokenStarts.has(start)) {
        try {
          const end = containerEnds.get(start);
          if (!end) return null;
          const expression = parseExpressionAt(
            text.slice(0, end),
            start,
            sourceOptions,
          );
          // A complete member/call expression proves source syntax itself.
          // A declaration prefix can also prove a complete literal on a page
          // whose later statements are incomplete. Comments/strings cannot
          // nominate starts: only tokenizer-confirmed source tokens qualify.
          const declared =
            /(?:^|[;\n])\s*(?:const|let|var)\s+[$_A-Za-z][$_A-Za-z0-9]*\s*=\s*$/u.test(
              text.slice(0, start),
            );
          const iteration =
            /(?:^|[;\n])\s*for\s*\(\s*(?:const|let|var)\s+[$_A-Za-z][$_A-Za-z0-9]*\s+of\s*$/u.test(
              text.slice(0, start),
            );
          const member = /^\s*\.\s*[$_A-Za-z][$_A-Za-z0-9]*/u.exec(
            text.slice(end),
          );
          if (member) {
            const memberExpression = parseExpressionAt(
              text.slice(0, end + member[0].length),
              start,
              sourceOptions,
            );
            collect(memberExpression);
          }
          collect(expression, declared || iteration);
        } catch {
          /* No complete, explicit source expression. */
        }
      }
      return sourceRanges.get(start) ?? null;
    };
    if (objectOnly) {
      const reader = parser(text, 0);
      let parsed;
      try {
        parsed = reader.value();
      } catch (error) {
        rejectParseFailure(error);
      }
      reader.whitespace();
      if (
        reader.end() !== text.length ||
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      )
        reject();
      const safe = transform(parsed);
      return equal(parsed, safe) ? text : JSON.stringify(safe);
    }

    // Scan once, consuming each JSON span in full. Quoted scalar fragments
    // decode escaped secrets; quoted key/value fragments use the same key rules
    // as objects. Ordinary code braces and projection markers are not JSON.
    let output = "";
    let plainStart = 0;
    for (let index = 0; index < text.length; ) {
      const char = text[index];
      // A tokenizer-proven template interpolation is source punctuation,
      // not a JSON object. Its complete expression must parse independently;
      // the normal scanner still visits all literals inside it.
      if (
        sourceText &&
        codeText &&
        char === "{" &&
        text[index - 1] === "$" &&
        ['"', "'"].includes(text.slice(index + 1).trimStart()[0]) &&
        policy.sourceLiteralPolicy === "explicit-source-containers-v1"
      ) {
        sourceContainer(index);
        const end = containerEnds?.get(index - 1);
        if (interpolationStarts?.has(index - 1) && end) {
          try {
            const expression = parseExpressionAt(
              text.slice(0, end - 1),
              index + 1,
              sourceOptions,
            );
            if (text.slice(expression.end, end - 1).trim() === "") {
              const bindings = sourceBindings.get(index);
              if (!bindings)
                reject(
                  "Agent model code expression under an opaque source context cannot be safely projected",
                );
              bindings.forEach(requireSafeSourceKey);
              index++;
              continue;
            }
          } catch (error) {
            // Projection failures must propagate; only Acorn syntax failures
            // may fall back to the strict scanner.
            if (!(error instanceof SyntaxError)) throw error;
          }
        }
      }
      const next =
        char === "{" || char === "["
          ? text.slice(index + 1).match(/^\s*(.)/u)?.[1]
          : undefined;
      // Python's f"{'branch':<52}" formats a literal label; the colon is not
      // a JSON key/value separator. Grant this meaning only while scanning an
      // explicitly prefixed source string, with a complete bounded format.
      // Escaped braces, arbitrary expressions and malformed JSON retain the
      // strict scanner. Sensitive decoded labels still fail closed.
      if (
        codeText &&
        pythonFString &&
        policy.pythonFStringPolicy === "bounded-static-label-alignment-v1" &&
        char === "{" &&
        text[index - 1] !== "{"
      ) {
        const literalStart = index + 1;
        const literal =
          CODE_SINGLE_QUOTED_PREFIX.exec(text.slice(literalStart))?.[0] ??
          CODE_DOUBLE_QUOTED_PREFIX.exec(text.slice(literalStart))?.[0];
        const suffix = literal
          ? /^:[<>^]\d{1,4}s?\}/u.exec(
              text.slice(literalStart + literal.length),
            )?.[0]
          : undefined;
        if (suffix) {
          const reader = parser(text, literalStart, {
            allowSingleQuotedStrings: true,
          });
          let label;
          try {
            label = reader.value();
          } catch (error) {
            rejectParseFailure(error);
          }
          const probe = Object.defineProperty(Object.create(null), label, {
            value: "source-expression",
            enumerable: true,
          });
          if (!equal(probe, transform(probe)))
            reject(
              "Agent model code expression under a sensitive key cannot be safely projected",
            );
          const safe = transform(label);
          const end = reader.end() + suffix.length;
          const replacement = equal(label, safe)
            ? text.slice(index, end)
            : `{${JSON.stringify(safe)}${suffix}`;
          output += plain(text.slice(plainStart, index)) + replacement;
          index = end;
          plainStart = index;
          continue;
        }
      }
      // Human-readable status markers are not JSON arrays. Only complete,
      // bounded numeric formats qualify; quotes, escapes, commas and nested
      // containers must still go through strict parsing. Leave these spans in
      // plain text so the ordinary credential/PII sanitizer still sees them.
      if (
        char === "[" &&
        policy.bracketMarkerPolicy === "bounded-display-markers-v1"
      ) {
        // ANSI CSI controls in terminal output start with ESC followed by [.
        // Limit recognition to numeric parameters and a final control letter.
        const marker =
          (text[index - 1] === "\x1b"
            ? /^\[[0-9;:?]{0,64}[A-Za-z]/u.exec(text.slice(index, index + 128))
            : null) ??
          DISPLAY_BRACKET_MARKER.exec(text.slice(index, index + 128));
        if (marker) {
          index += marker[0].length;
          continue;
        }
      }
      const container =
        (char === "{" &&
          (next === '"' || next === "}" || next === "'" || next === "\\")) ||
        (char === "[" &&
          next !== undefined &&
          (["[", "{", '"', "]"].includes(next) ||
            /[0-9]/u.test(next) ||
            /^\s*(?:-\d|(?:true|false|null)(?=[\s,\]]))/u.test(
              text.slice(index + 1),
            )));
      const quoted = char === '"' || (codeText && char === "'");
      if (!container && !quoted) {
        index++;
        continue;
      }
      // A prose quotation can contain newlines/ordinary backslashes. Only a
      // lexically valid JSON string is a candidate outside JSON containers.
      if (
        !container &&
        char === '"' &&
        !(codeText
          ? CODE_DOUBLE_QUOTED_PREFIX.test(text.slice(index))
          : JSON_STRING_PREFIX.test(text.slice(index)))
      ) {
        index++;
        continue;
      }
      if (
        codeText &&
        char === "'" &&
        !CODE_SINGLE_QUOTED_PREFIX.test(text.slice(index))
      ) {
        index++;
        continue;
      }
      let reader = parser(text, index, {
        // A recognized container is always tried as strict JSON first, even
        // inside code. Only an explicit non-JSON token allows literal scanning.
        allowSingleQuotedStrings: codeText && !container,
        allowSourceExpressions:
          codeText &&
          policy.sourceExpressionPolicy === "bounded-source-tokens-v1",
      });
      let parsed;
      let valueEnd;
      try {
        parsed = reader.value();
        valueEnd = reader.end();
      } catch (error) {
        const kind = error?.[PARSE_FAILURE];
        let sourceEnd = null;
        if (["trailing-comma", "source-number"].includes(kind)) {
          try {
            sourceEnd = sourceContainer(index);
          } catch (sourceError) {
            rejectParseFailure(sourceError);
          }
        }
        if (sourceEnd !== null) {
          const bindings = sourceBindings.get(index);
          if (sourceBindings.has(index)) {
            if (!bindings)
              reject(
                "Agent model code expression under an opaque source context cannot be safely projected",
              );
            bindings.forEach(requireSafeSourceKey);
          } else requireSafeSourceAssignments(index);
          const key = assignmentKeyBefore(text, plainStart, index);
          if (key) requireSafeSourceKey(key);
          reader = parser(text, index, { allowSourceLiteralSyntax: true });
          try {
            parsed = reader.value();
            valueEnd = reader.end();
          } catch (sourceError) {
            rejectParseFailure(sourceError);
          }
          if (valueEnd !== sourceEnd) reject();
        } else {
          if (
            !codeText ||
            !["code-expression", "source-expression"].includes(kind)
          )
            rejectParseFailure(error);
          if (kind === "source-expression") {
            requireSafeSourceAssignments(index);
            const key = assignmentKeyBefore(text, plainStart, index);
            if (key) requireSafeSourceKey(key);
          }
          // Python/JavaScript containers may contain single quotes or expressions.
          // Scan their literals individually, preserving nested strict JSON scans.
          // Keep consumed nodes charged so repeated fallback cannot reset budgets.
          index++;
          continue;
        }
      }
      reader.whitespace();
      let pair = quoted && text[reader.end()] === ":";
      let pairValueEnd;
      const requireSafeExpressionKey = () => {
        // An expression cannot be visited as a decoded JSON value. Preserve
        // the decoded key boundary: otherwise a password list/call expression
        // could expose its string literals when scanning resumes inside it.
        requireSafeSourceKey(parsed);
      };
      if (pair) {
        const rhsStart = reader.end() + 1;
        const codeExpression = codeText
          ? /^\s*([A-Za-z_$][A-Za-z0-9_$]*)/u.exec(text.slice(rhsStart))?.[1]
          : undefined;
        if (
          codeExpression &&
          !["true", "false", "null"].includes(codeExpression)
        ) {
          requireSafeExpressionKey();
          pair = false;
        } else {
          try {
            const rhsContainer = /^[ \t\r\n]*[[{]/u.test(text.slice(rhsStart));
            const rhs = parser(text, rhsStart, {
              allowSingleQuotedStrings: codeText && !rhsContainer,
              allowSourceExpressions:
                codeText &&
                policy.sourceExpressionPolicy === "bounded-source-tokens-v1",
            });
            const entry = rhs.value();
            const entryEnd = rhs.end();
            rhs.whitespace();
            if (
              (codeText || policy.proseQuotedPairPolicy) &&
              (/^[+\-*/%?.([<>&|^=!"']/u.test(text[rhs.end()] ?? "") ||
                (codeText &&
                  policy.sourceExpressionPolicy ===
                    "bounded-source-tokens-v1" &&
                  sourceContinuation(text.slice(rhs.end()))))
            )
              requireSafeExpressionKey();
            parsed = Object.defineProperty(Object.create(null), parsed, {
              value: entry,
              enumerable: true,
            });
            pairValueEnd = entryEnd;
          } catch (error) {
            const kind = error?.[PARSE_FAILURE];
            if (kind === undefined) throw error;
            if (
              (!codeText && !policy.proseQuotedPairPolicy) ||
              (kind !== "code-expression" &&
                !(codeText && kind === "source-expression"))
            )
              rejectParseFailure(error);
            // A standalone prose label or a source key followed by an
            // expression is not a broken JSON container. Sensitive decoded
            // keys still fail closed before scanning resumes.
            // Resume the scan at the next literal so any string value still
            // receives key-aware or ordinary secret scanning.
            requireSafeExpressionKey();
            pair = false;
          }
        }
      }
      const pythonFStringPrefix =
        codeText &&
        quoted &&
        !pair &&
        policy.pythonFStringPolicy === "bounded-static-label-alignment-v1"
          ? /(?:^|[^\p{ID_Continue}$])(f|fr|rf)$/iu.exec(
              text.slice(Math.max(0, index - 3), index),
            )?.[1]
          : undefined;
      const assignmentKey =
        quoted && !pair
          ? // Scan backward once; an unanchored greedy key regex would retry at
            // every offset of a long ordinary prefix before a quoted fragment.
            assignmentKeyBefore(
              text,
              plainStart,
              index - (pythonFStringPrefix?.length ?? 0),
            )
          : undefined;
      let end = valueEnd;
      if (pair) {
        end = pairValueEnd;
      } else if (assignmentKey) {
        // Bare assignments followed by a quoted value cross a text/JSON span.
        // Reuse decoded field rules rather than a second credential-key list.
        parsed = Object.defineProperty(Object.create(null), assignmentKey, {
          value: parsed,
          enumerable: true,
        });
      }
      const safe = transform(
        parsed,
        pythonFStringPrefix ? { pythonFString: true } : undefined,
      );
      if (
        (codeText || policy.proseQuotedPairPolicy) &&
        assignmentKey &&
        !equal(parsed, safe) &&
        (/^\s*[+\-*/%?.([<>&|^=!"']/u.test(text.slice(end)) ||
          (codeText &&
            policy.sourceExpressionPolicy === "bounded-source-tokens-v1" &&
            sourceContinuation(text.slice(end).trimStart())))
      )
        reject(
          "Agent model code expression under a sensitive key cannot be safely projected",
        );
      let replacement = text.slice(index, end);
      if (!equal(parsed, safe)) {
        replacement = JSON.stringify(safe);
        if (pair) replacement = replacement.slice(1, -1);
        else if (assignmentKey) {
          if (!Object.hasOwn(safe, assignmentKey)) reject();
          replacement = JSON.stringify(safe[assignmentKey]);
        }
      }
      output += plain(text.slice(plainStart, index)) + replacement;
      index = end;
      plainStart = index;
    }
    return output + plain(text.slice(plainStart));
  };
}
