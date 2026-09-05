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

export function createEvidenceJsonTextBoundary(fail) {
  let nodes = 0;
  let bytes = 0;
  const reject = () => {
    throw fail(
      "Agent model JSON text is malformed, ambiguous or exceeds its budget",
    );
  };
  const parser = (text, start) => {
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
            return reject();
          }
        }
      }
      return reject();
    };
    const value = (depth = 0) => {
      if (
        ++nodes > EVIDENCE_JSON_POLICY.maxNodes ||
        depth > EVIDENCE_JSON_POLICY.maxDepth
      )
        reject();
      whitespace();
      const char = text[index];
      if (char === '"') return string();
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
            if (text[index] !== '"') reject();
            key = string();
            if (Object.hasOwn(output, key)) reject();
            whitespace();
            if (text[index++] !== ":") reject();
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
          if (text[index++] !== ",") reject();
          whitespace();
        }
        return reject();
      }
      const token =
        /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(
          text.slice(index),
        )?.[0];
      if (!token) return reject();
      index += token.length;
      const parsed = JSON.parse(token);
      if (
        typeof parsed === "number" &&
        (!Number.isFinite(parsed) ||
          (Number.isInteger(parsed) && !Number.isSafeInteger(parsed)))
      )
        reject();
      return parsed;
    };
    return {
      value,
      end: () => index,
      whitespace,
    };
  };

  return (text, { layer = 0, objectOnly = false, visit, plain, equal }) => {
    bytes += Buffer.byteLength(text, "utf8");
    if (bytes > EVIDENCE_JSON_POLICY.maxDecodedBytes) reject();
    const transform = (parsed) => {
      if (layer >= EVIDENCE_JSON_POLICY.maxLayers) reject();
      return visit(parsed, layer + 1);
    };
    if (objectOnly) {
      const reader = parser(text, 0);
      const parsed = reader.value();
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
    for (let index = 0; index < text.length;) {
      const char = text[index];
      const next =
        char === "{" || char === "["
          ? text.slice(index + 1).match(/^\s*(.)/u)?.[1]
          : undefined;
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
      if (!container && char !== '"') {
        index++;
        continue;
      }
      // A prose quotation can contain newlines/ordinary backslashes. Only a
      // lexically valid JSON string is a candidate outside JSON containers.
      if (
        !container &&
        // eslint-disable-next-line no-control-regex -- JSON strings exclude literal U+0000 through U+001F.
        !/^"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/u.test(
          text.slice(index),
        )
      ) {
        index++;
        continue;
      }
      const reader = parser(text, index);
      let parsed = reader.value();
      const valueEnd = reader.end();
      reader.whitespace();
      const pair = char === '"' && text[reader.end()] === ":";
      const assignmentKey =
        char === '"' && !pair
          ? // Scan backward once; an unanchored greedy key regex would retry at
            // every offset of a long ordinary prefix before a quoted fragment.
            assignmentKeyBefore(text, plainStart, index)
          : undefined;
      let end = valueEnd;
      if (pair) {
        const rhs = parser(text, reader.end() + 1);
        const entry = rhs.value();
        parsed = Object.defineProperty(Object.create(null), parsed, {
          value: entry,
          enumerable: true,
        });
        end = rhs.end();
      } else if (assignmentKey) {
        // Bare assignments followed by a quoted value cross a text/JSON span.
        // Reuse decoded field rules rather than a second credential-key list.
        parsed = Object.defineProperty(Object.create(null), assignmentKey, {
          value: parsed,
          enumerable: true,
        });
      }
      const safe = transform(parsed);
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
