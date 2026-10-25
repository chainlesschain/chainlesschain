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
    "\\d{4}-\\d{2}-\\d{2}(?:[ T]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?(?:Z|[+-]\\d{2}:\\d{2})?)?|" +
    "\\d{1,2}:\\d{2}(?::\\d{2}(?:\\.\\d{1,3})?)?|" +
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

export function createEvidenceJsonTextBoundary(
  fail,
  policy = EVIDENCE_JSON_POLICY,
) {
  let nodes = 0;
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
  const parser = (text, start, { allowSingleQuotedStrings = false } = {}) => {
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
        }
        return parserReject("syntax");
      }
      const token =
        /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(
          text.slice(index),
        )?.[0];
      if (!token) {
        return parserReject(
          /^[A-Za-z_$][A-Za-z0-9_$]*|^\(/u.test(text.slice(index))
            ? "code-expression"
            : "syntax",
        );
      }
      index += token.length;
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
          });
          offset = end;
        }
        return output + scanText(text.slice(offset), options);
      }
    }
    bytes += Buffer.byteLength(text, "utf8");
    if (bytes > policy.maxDecodedBytes)
      reject("Agent model JSON text exceeds its budget");
    const transform = (parsed) => {
      if (layer >= policy.maxLayers)
        reject("Agent model JSON text exceeds its budget");
      return visit(parsed, layer + 1);
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
      const next =
        char === "{" || char === "["
          ? text.slice(index + 1).match(/^\s*(.)/u)?.[1]
          : undefined;
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
            ? /^\[[0-9;?]{0,64}[A-Za-z]/u.exec(text.slice(index, index + 128))
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
      const reader = parser(text, index, {
        // A recognized container is always tried as strict JSON first, even
        // inside code. Only an explicit non-JSON token allows literal scanning.
        allowSingleQuotedStrings: codeText && !container,
      });
      let parsed;
      let valueEnd;
      try {
        parsed = reader.value();
        valueEnd = reader.end();
      } catch (error) {
        const kind = error?.[PARSE_FAILURE];
        if (!codeText || kind !== "code-expression") rejectParseFailure(error);
        // Python/JavaScript containers may contain single quotes or expressions.
        // Scan their literals individually, preserving nested strict JSON scans.
        // Keep consumed nodes charged so repeated fallback cannot reset budgets.
        index++;
        continue;
      }
      reader.whitespace();
      let pair = quoted && text[reader.end()] === ":";
      let pairValueEnd;
      const requireSafeExpressionKey = () => {
        // An expression cannot be visited as a decoded JSON value. Preserve
        // the decoded key boundary: otherwise a password list/call expression
        // could expose its string literals when scanning resumes inside it.
        const probe = Object.defineProperty(Object.create(null), parsed, {
          value: "source-expression",
          enumerable: true,
        });
        if (!equal(probe, transform(probe)))
          reject(
            "Agent model code expression under a sensitive key cannot be safely projected",
          );
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
            const rhsContainer = /^[ \t\r\n]*[\[{]/u.test(text.slice(rhsStart));
            const rhs = parser(text, rhsStart, {
              allowSingleQuotedStrings: codeText && !rhsContainer,
            });
            const entry = rhs.value();
            const entryEnd = rhs.end();
            rhs.whitespace();
            if (
              codeText &&
              /^[+\-*/%?.([<>&|^=!"']/u.test(text[rhs.end()] ?? "")
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
              kind !== "code-expression"
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
      const assignmentKey =
        quoted && !pair
          ? // Scan backward once; an unanchored greedy key regex would retry at
            // every offset of a long ordinary prefix before a quoted fragment.
            assignmentKeyBefore(text, plainStart, index)
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
      const safe = transform(parsed);
      if (
        codeText &&
        assignmentKey &&
        !equal(parsed, safe) &&
        /^\s*[+\-*/%?.([<>&|^=!"']/u.test(text.slice(end))
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
